import type { TownState } from './town-state';
import type { Monster, Person } from './person';
import type { RealmArea } from './realm-layout';
import type { FlowField } from './combat-state';
import { PairMinHeap } from './priority-queue';
import { MonsterRank } from './combat-events';
import { contactReach, contactRing, meleeContact, withinWallReach } from './monster-engagement';
import type { Building } from './town-models';
import { Structure, isSeat } from './building-catalog';
import { inRaidedVillage, raidSeat } from './gate-progression';
import { add, distance, lerp, point, rotated, scale, sub, type Point } from './geometry';
import { f32 as f } from './numeric';

const spacing = f(0.6);
// Stable variation does not consume the simulation's gameplay random stream.
function variation(a: number, b: number): number {
  let bits = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b);
  bits ^= bits >>> 16;
  bits = Math.imul(bits, 0x7feb352d);
  bits ^= bits >>> 15;
  return (bits >>> 0) / 4294967296;
}
function attackPoints(building: Building): Point[] {
  const footprint = building.footprint(), extent = f(footprint.half + contactRing);
  const count = Math.max(3, Math.ceil(2 * extent / spacing)), points: Point[] = [];
  for (let side = 0; side < 4; ++side)
    for (let slot = 0; slot < count; ++slot) {
      const along = f(footprint.half * (-1 + 2 * slot / count));
      const local = side === 0 ? point(along, extent) : side === 1 ? point(extent, -along)
        : side === 2 ? point(-along, -extent) : point(-extent, along);
      points.push(add(building.center, rotated(local, building.angle)));
    }
  return points;
}
/** Neighbours in the muster take alternating sides of the route. The centre stays open for others. */
function flank(id: number): number {
  const file = id % 9;
  return Math.ceil(file / 2) * (file % 2 ? 0.85 : -0.85);
}
/** Fit a broad front to each long stretch of the walk. Gates and narrow passes retain the ordinary route.
 * Called only when planning. Each monster then follows the same saved waypoints as any other march. */
function spreadMarch(town: TownState, beast: Monster, path: Point[]): Point[] {
  const side = flank(beast.id);
  if (!side || path.length < 2) return path;
  const route = [path[0]];
  for (let i = 1; i < path.length; ++i) {
    const from = path[i - 1], to = path[i], span = distance(from, to);
    if (span >= 4) {
      const offset = Math.sign(side) * Math.min(Math.abs(side), span * 0.21);
      const lateral = scale(point(from.y - to.y, to.x - from.x), offset / span);
      const a = add(lerp(from, to, 0.28), lateral), b = add(lerp(from, to, 0.72), lateral);
      if (town.grid.clear(from, a, Infinity, true) && town.grid.clear(a, b, Infinity, true) &&
          town.grid.clear(b, to, Infinity, true)) route.push(a, b);
    }
    route.push(to);
  }
  return route;
}
/** Join the same wave's route near the mouth and leave it at the camp for an individual attack slot.
 * A wall or a headland between two nearby endpoints may require a short local walk. */
function joinMarch(town: TownState, from: Point, to: Point, route: readonly Point[]): Point[] {
  const grid = town.grid, first = route[0], last = route[route.length - 1];
  const entry = grid.clear(from, route[1], Infinity, true) ? [from, route[1]]
    : grid.clear(from, first, Infinity, true) ? [from, first, route[1]] : [];
  if (!entry.length) {
    const link = grid.path(from, first, true);
    if (!link.length) return [];
    entry.push(...link, route[1]);
  }
  const turn = Math.max(1, route.length - 2);
  entry.push(...route.slice(2, turn + 1));
  if (grid.clear(route[turn], to, Infinity, true)) return [...entry, to];
  const exit = grid.clear(last, to, Infinity, true) ? [last, to] : grid.path(last, to, true);
  return exit.length ? [...entry, ...exit] : [];
}
function approach(town: TownState, beast: Monster, target: Building, routes?: Map<number, Point[]>): Point[] | null {
  const reservations = town.beasts.filter(other => other !== beast && other.health > 0 &&
    other.raider && other.prey === target.id).map(other => other.path.at(-1) ?? other.position);
  const candidates = attackPoints(target).map((at, index) => {
    let crowd = 0;
    for (const taken of reservations) crowd += Math.max(0, 1 - distance(at, taken) / spacing) * 12;
    return { at, score: distance(beast.position, at) + crowd + variation(beast.id, index) * 0.35 };
  }).filter(candidate => town.grid.walkable(candidate.at));
  candidates.sort((a, b) => a.score - b.score);
  for (const { at } of candidates) {
    if (distance(beast.position, at) < f(0.02)) return [];
    if (town.grid.clear(beast.position, at, Infinity, true))
      return spreadMarch(town, beast, [beast.position, at]);
    // A striking foot can be on the apron of a cell whose centre lies inside the wall.
    const entry = pursuitEntry(town, at);
    const end = entry === at ? [] : [at];
    const corridor = routes?.get(target.id);
    if (corridor) {
      const joined = joinMarch(town, beast.position, entry, corridor);
      if (joined.length) return spreadMarch(town, beast, [...joined, ...end]);
    }
    const path = town.grid.path(beast.position, entry, true);
    if (path.length) {
      if (!corridor && path.length >= 2) routes?.set(target.id, path);
      return spreadMarch(town, beast, [...path, ...end]);
    }
  }
  return null;
}
function useful(target: Building): boolean {
  return target.kind !== Structure.Torch && (!isSeat(target.kind) || target.health > f(0.1));
}

const stalledRaiders = new WeakMap<Monster, { revision: bigint; retry: number }>();

/** Keep the chosen building and perimeter slot until they become unavailable. */
export function planRaiderApproach(town: TownState, beast: Monster, waveRoutes?: Map<number, Point[]>): void {
  const stalled = stalledRaiders.get(beast);
  if (stalled && stalled.revision === town.walkRevision && town.time < stalled.retry) return;
  const seat = raidSeat(town, beast.lair);
  const inVillage = (b: Building): boolean => inRaidedVillage(town, b, seat);
  const previous = town.building(beast.prey);
  const chosen = previous && inVillage(previous) ? previous : null;
  const end = beast.path.at(-1);
  // The planning pass assigns the least crowded slot. Once the perimeter fills, arrivals may share it
  // without rerunning a path search every tick while their wave is still marching.
  const valid = !!chosen && (!end
    ? withinWallReach(chosen.footprint(), beast.position)
    : withinWallReach(chosen.footprint(), end) && town.grid.walkable(end) &&
      town.grid.clear(beast.position, beast.path[0], Infinity));
  if (chosen) {
    // The Camp's existing minimum health still applies. Once reached, prefer
    // other damageable buildings, retaining the Camp if none can be reached.
    const seekAnother = !useful(chosen) && town.time >= beast.ready &&
      town.placed.some(building => building.id !== chosen.id && useful(building) && inVillage(building));
    if (!seekAnother && valid) return;
  }
  const candidates = town.placed.filter(inVillage).sort((a, b) => {
    if (a.id === chosen?.id && useful(a)) return -1;
    if (b.id === chosen?.id && useful(b)) return 1;
    return Number(useful(b)) - Number(useful(a)) || Number(b === seat) - Number(a === seat) ||
      distance(a.center, beast.position) - distance(b.center, beast.position) || a.id - b.id;
  });
  for (const target of candidates) {
    if (target === chosen && valid) return;
    const path = approach(town, beast, target, waveRoutes);
    if (path === null) continue;
    beast.prey = target.id;
    beast.path = path;
    return;
  }
  beast.prey = -1;
  beast.path = [];
  stalledRaiders.set(beast, { revision: town.walkRevision, retry: town.time + 1.2 + (beast.id % 7) * .05 });
}

/** A building can cover the centre of an otherwise walkable tile. Join the ordinary grid through an
 * adjacent cell on the same side of the building, as a resident leaves a workbench apron. */
function pursuitEntry(town: TownState, at: Point): Point {
  const x = Math.floor(at.x), y = Math.floor(at.y), grid = town.grid;
  if (grid.cost(x, y) > 0) return at;
  let nearest = at, gap = Infinity;
  for (const [dx, dy] of neighbours) {
    const next = point(x + dx + 0.5, y + dy + 0.5), d = distance(at, next);
    if (d < gap && grid.walkable(next) && grid.clear(at, next, Infinity, true)) {
      nearest = next;
      gap = d;
    }
  }
  return nearest;
}

/** Keep the route to a moving resident until the resident moves away from its end. Failed searches retry
 * on a staggered clock. A raider with no route keeps marching against the settlement in between. */
const pursuit = new WeakMap<Monster, { goal: Point; person: number; retry: number; failed: boolean }>();
export function pursueResident(town: TownState, beast: Monster, resident: Person, goal: Point, step: number): boolean {
  const grid = town.grid, remembered = pursuit.get(beast);
  const sameGoal = remembered?.person === resident.id && distance(remembered.goal, goal) <= 0.8;
  if (sameGoal && remembered.failed && town.time < remembered.retry) return false;
  if (beast.path.length && (beast.prey >= 0 || !sameGoal)) beast.path = [];
  beast.prey = -1;
  let waypoint = beast.path[0] ?? goal;
  if (!beast.path.length && (beast.raider || beast.brood >= 0)) {
    const remaining = distance(beast.position, goal), axis = sub(goal, beast.home);
    const span = Math.hypot(axis.x, axis.y);
    if (span > 1 && remaining > 1.4) {
      const width = flank(beast.id) * Math.min(1, (remaining - 1.4) / 5) / span;
      const side = add(goal, point(-axis.y * width, axis.x * width));
      if (grid.walkable(side)) waypoint = side;
    }
  }
  if (!beast.path.length) {
    // An attacker assigned the far side rounds the defender's feet on its final approach.
    const from = sub(beast.position, resident.position), to = sub(goal, resident.position);
    const radius = Math.hypot(from.x, from.y);
    if (radius > 0.12 && radius < 1.4 && from.x * to.x + from.y * to.y < radius * contactRing * 0.52) {
      const cross = from.x * to.y - from.y * to.x;
      const turn = Math.abs(cross) > 0.001 ? Math.sign(cross) : (beast.id % 2 ? 1 : -1);
      const arc = add(resident.position, rotated(scale(from, (contactRing + 0.07) / radius), turn * 0.8));
      if (grid.clear(beast.position, arc, Infinity, true)) waypoint = arc;
    }
  }
  const gap = distance(beast.position, waypoint);
  const next = step >= gap ? { ...waypoint } : add(beast.position, scale(sub(waypoint, beast.position), step / gap));
  if (grid.clear(beast.position, next, Infinity, true)) {
    beast.position = next;
    if (step >= gap && beast.path.length) beast.path.shift();
    return true;
  }
  if (sameGoal && town.time < remembered.retry) return true;
  const entry = pursuitEntry(town, beast.position), exit = pursuitEntry(town, goal);
  const route = grid.path(entry, exit, true);
  beast.path = entry === beast.position ? route.slice(1) : route;
  if (route.length && exit !== goal) beast.path.push({ ...goal });
  const failed = !beast.path.length;
  pursuit.set(beast, { person: resident.id, goal: { ...goal }, failed,
    retry: town.time + 0.8 + (beast.id % 7) * 0.05 });
  return !failed;
}

/** Release the old approach when a resident slips away. A raider can resume a building order immediately. */
export function losePrey(beast: Monster): void {
  if (pursuit.delete(beast) && beast.prey < 0) beast.path = [];
}

const largestRadius = 0.62;
function bodyRadius(rank: MonsterRank): number {
  switch (rank) {
    case MonsterRank.Swarmer: return 0.31;
    case MonsterRank.Brute: return 0.47;
    case MonsterRank.Guardian: return largestRadius;
    case MonsterRank.Den: return 0.58;
    default: return 0.37;
  }
}

const passLookAhead = 1.4;

/** Bend the next few steps around the body in our lane without giving up our march waypoint. */
function passResident(town: TownState, beast: Monster, people: readonly Person[], first: number, dt: number): Point {
  const at = beast.position, ahead = beast.path[0], radius = bodyRadius(beast.rank) + 0.3;
  const dx = ahead.x - at.x, dy = ahead.y - at.y, len = Math.hypot(dx, dy);
  if (len < 0.01) return at;
  const ux = dx / len, uy = dy / len;
  let nearest = Infinity, shift = 0;
  for (let i = first; i < people.length && people[i].position.x < at.x + passLookAhead; ++i) {
    const p = people[i].position, x = at.x - p.x, y = at.y - p.y;
    const side = -x * uy + y * ux, forward = -x * ux - y * uy;
    if (Math.abs(side) >= radius || forward < -radius || forward > Math.min(passLookAhead, len + radius)) continue;
    const gap = x * x + y * y;
    if (gap >= nearest || gap > passLookAhead * passLookAhead) continue;
    nearest = gap;
    const sign = Math.abs(side) < 0.015 ? ((beast.id + people[i].id) % 2 ? 1 : -1) : Math.sign(side);
    shift = sign * Math.min(radius - Math.abs(side), dt * 1.9);
  }
  if (!shift) return at;
  const next = point(at.x - uy * shift, at.y + ux * shift);
  return town.grid.clear(at, next, Infinity, true) ? next : at;
}

/** A simultaneous, bounded displacement keeps neighbouring bodies apart. A fighter with its feet
 * planted yields to another planted fighter only; passing monsters go around the front. */
export function separateMonsters(town: TownState, dt: number): void {
  const beasts = town.beasts.filter(beast => beast.health > 0 && !beast.insideLair && !beast.giant())
    .sort((a, b) => a.position.x - b.position.x || a.id - b.id);
  if (!beasts.length || dt <= 0) return;
  const contacts = beasts.map(meleeContact), radii = beasts.map(b => bodyRadius(b.rank));
  const fixed = beasts.map(b => b.rank === MonsterRank.Den || b.windupUntil >= 0);
  const shifts = beasts.map(() => point());
  const maxStep = Math.min(dt * 0.95, 0.18);
  for (let i = 0; i < beasts.length; ++i)
    for (let j = i + 1; j < beasts.length && beasts[j].position.x - beasts[i].position.x < radii[i] + largestRadius; ++j) {
      const spacing = radii[i] + radii[j], dx = beasts[i].position.x - beasts[j].position.x;
      const dy = beasts[i].position.y - beasts[j].position.y, gap = Math.hypot(dx, dy);
      if (gap >= spacing - 0.002) continue;
      const plantedI = !!contacts[i] || fixed[i], plantedJ = !!contacts[j] || fixed[j];
      const shareI = !fixed[i] && (!plantedI || plantedJ), shareJ = !fixed[j] && (!plantedJ || plantedI);
      const push = Math.min((spacing - gap) * (shareI && shareJ ? 0.5 : 1), maxStep);
      // A coincident spawn also has a reproducible escape direction.
      const angle = gap < 0.001 ? variation(beasts[i].id, beasts[j].id) * Math.PI * 2 : 0;
      const x = push * (gap < 0.001 ? Math.cos(angle) : dx / gap);
      const y = push * (gap < 0.001 ? Math.sin(angle) : dy / gap);
      if (shareI) { shifts[i].x += x; shifts[i].y += y; }
      if (shareJ) { shifts[j].x -= x; shifts[j].y -= y; }
    }
  const people = town.folk.filter(p => !p.inside && p.health > 0 && p.downedAt < 0)
    .sort((a, b) => a.position.x - b.position.x || a.id - b.id);
  let first = 0;
  for (let i = 0; i < beasts.length; ++i) {
    const beast = beasts[i];
    if (fixed[i]) continue;
    while (first < people.length && people[first].position.x <= beast.position.x - passLookAhead) ++first;
    if (beast.raider && beast.prey >= 0 && beast.path.length && first < people.length)
      beast.position = passResident(town, beast, people, first, dt);
    const amount = Math.hypot(shifts[i].x, shifts[i].y);
    if (amount < 0.001) continue;
    const at = add(beast.position, scale(shifts[i], Math.min(1, maxStep / amount)));
    const contact = contacts[i];
    if (contact && distance(at, contact.position) > contactReach) continue;
    const target = beast.raider && !beast.path.length ? town.building(beast.prey) : null;
    if (target && withinWallReach(target.footprint(), beast.position) && !withinWallReach(target.footprint(), at)) continue;
    if (town.grid.clear(beast.position, at, Infinity, true)) beast.position = at;
  }
}

const flowAge = 0.4;
/** Cells along a route a hunting monster looks ahead for a waypoint it can walk to straight. */
const lookAhead = 5;
const steerPause = 0.3;
const neighbours = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
/** Walking distance to the prey's tile from every tile of `area`, shared by all who hunt it and kept a moment. */
export function flowTo(town: TownState, area: RealmArea, prey: Person): FlowField | null {
  const x = Math.floor(prey.position.x) - area.x,
    y = Math.floor(prey.position.y) - area.y;
  if (x < 0 || y < 0 || x >= area.size || y >= area.size) return null;
  const cell = y * area.size + x,
    cached = town.combatState.flows.get(prey.id);
  if (
    cached &&
    cached.distance.length === area.size * area.size &&
    (cached.cell === cell || town.time - cached.at < flowAge) &&
    town.time >= cached.at
  )
    return cached;
  const grid = town.grid,
    size = area.size,
    field = cached?.distance.length === size * size ? cached.distance : new Float64Array(size * size),
    open = new PairMinHeap(),
    cost = (cx: number, cy: number) => grid.cost(cx + area.x, cy + area.y);
  field.fill(Infinity);
  field[cell] = 0;
  open.push([0, cell]);
  while (!open.empty()) {
    const [d, n] = open.pop();
    if (d > field[n]) continue;
    const cx = n % size,
      cy = (n - cx) / size;
    for (const [dx, dy] of neighbours) {
      const nx = cx + dx,
        ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size || cost(nx, ny) <= 0) continue;
      if (dx && dy && (cost(cx + dx, cy) <= 0 || cost(cx, cy + dy) <= 0)) continue;
      const next = d + ((dx && dy ? 1.4142 : 1) * (cost(cx, cy) + cost(nx, ny))) / 2,
        m = ny * size + nx;
      if (next < field[m]) {
        field[m] = next;
        open.push([next, m]);
      }
    }
  }
  const flow = { cell, at: town.time, distance: field };
  town.combatState.flows.set(prey.id, flow);
  return flow;
}
/** The farthest tile down the route that can be walked to straight from where the monster stands. */
function waypoint(town: TownState, area: RealmArea, field: FlowField, from: Point): Point | null {
  const size = area.size;
  let x = Math.floor(from.x) - area.x,
    y = Math.floor(from.y) - area.y;
  if (x < 0 || y < 0 || x >= size || y >= size || !Number.isFinite(field.distance[y * size + x])) return null;
  const cells: Point[] = [];
  for (let i = 0; i < lookAhead; ++i) {
    let best = field.distance[y * size + x],
      bx = -1,
      by = -1;
    for (const [dx, dy] of neighbours) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (dx && dy && (!Number.isFinite(field.distance[y * size + nx]) || !Number.isFinite(field.distance[ny * size + x])))
        continue;
      const d = field.distance[ny * size + nx];
      if (d < best) {
        best = d;
        bx = nx;
        by = ny;
      }
    }
    if (bx < 0) break;
    x = bx;
    y = by;
    cells.push(point(x + area.x + 0.5, y + area.y + 0.5));
  }
  for (let i = cells.length - 1; i > 0; --i) if (town.grid.clear(from, cells[i], Infinity)) return cells[i];
  return cells[0] ?? null;
}
/** Moves a hunting monster up to `step` toward `goal`: straight while it sees it in the open, otherwise down the
 * shared route to its prey; the way is looked for again on a timer, never every tick. */
export function huntStep(
  town: TownState,
  beast: Monster,
  goal: Point,
  area: RealmArea | null,
  prey: Person | null,
  step: number,
): void {
  const steering = town.combatState.steering,
    way = steering.get(beast.id);
  if (!way || town.time >= way.at || !beast.path.length) {
    const direct = town.grid.clear(beast.position, goal, Infinity);
    let path: Point[] = [];
    if (direct) path = [{ ...goal }];
    else {
      const field = area && prey ? flowTo(town, area, prey) : null,
        next = field ? waypoint(town, area!, field, beast.position) : null;
      path = next ? [next] : town.grid.path(beast.position, goal).slice(1);
    }
    beast.path = path;
    // Spread out the looks so a swarm does not search all on one tick.
    steering.set(beast.id, { at: town.time + steerPause + (beast.id % 7) * 0.03, direct });
  } else if (way.direct) beast.path = [{ ...goal }];
  walkPath(beast, step);
}
/** Walks a monster along its path. */
export function walkPath(beast: Monster, step: number): void {
  while (step > 0 && beast.path.length) {
    const target = beast.path[0],
      gap = distance(beast.position, target);
    if (gap <= step) {
      beast.position = { ...target };
      beast.path.shift();
      step = f(step - gap);
    } else {
      beast.position = add(beast.position, scale(sub(target, beast.position), f(step / gap)));
      step = 0;
    }
  }
}
