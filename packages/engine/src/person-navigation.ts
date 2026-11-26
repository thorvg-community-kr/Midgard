import { Terrain } from './world-types';
import type { Town } from './town';
import type { TownState } from './town-state';
import type { Building } from './town-models';
import { Activity, type Person } from './person';
import { footBounds, footBoxesOverlap, footSeparation, footSegmentBlockedBy } from './person-collision';
import { add, sub, scale, point, normalized, distance, Footprint, closestOnSegment, type Point } from './geometry';

/** A miner can reach a blocked basalt face from either mouth of the pass. */
export function approachBasalt(town: Pick<Town, 'world' | 'grid' | 'walkTo'>, p: Person, foot: Point): boolean {
  const sides = [point(-0.7, 0), point(0.7, 0), point(0, -0.7), point(0, 0.7)].map((offset) => add(foot, offset));
  const cost = (at: Point) => distance(p.position, at) + (town.world.cell(at)?.terrain === Terrain.Lava ? 100 : 0);
  sides.sort((a, b) => cost(a) - cost(b));
  return sides.some((at) => town.grid.walkable(at) && town.walkTo(p, at));
}

// Apply simultaneous lateral nudges after walking. They do not re-plan paths,
// reverse forward progress, push through walls, or move a worker off a work target.
export function separatePeople(town: TownState, dt: number): void {
  const people = town.folk.filter(
    (p) =>
      p.health > 0 &&
      !p.inside &&
      !p.crossingDoorway() &&
      p.activity !== Activity.Expedition &&
      p.activity !== Activity.Leaving,
  );
  const movable = (p: Person) =>
    p.moving() || (!p.ordered && (p.activity === Activity.Idle || p.activity === Activity.Holding));
  const shifts = people.map(() => point()),
    limits = people.map(() => 0.4);
  for (let i = 0; i < people.length; ++i)
    for (let j = i + 1; j < people.length; ++j) {
      const a = people[i],
        b = people[j],
        movesA = movable(a),
        movesB = movable(b);
      if (!movesA && !movesB) continue;
      if (movesA !== movesB) {
        // Predict only the next few footfalls. Body-sized personal space used to
        // steer walkers away while their boots were still far from another unit.
        const index = movesA ? i : j,
          mover = people[index],
          anchor = movesA ? b : a,
          forward = mover.path.length ? normalized(sub(mover.path[0], mover.position)) : point(1, 0),
          side = point(-forward.y, forward.x),
          delta = sub(mover.position, anchor.position),
          reach = Math.max(footBounds.halfX * 2, town.grid.speedAt(mover.position) * Math.max(0, dt) * 2),
          ahead = add(mover.position, scale(forward, reach)),
          overlap = footBoxesOverlap(mover.position, anchor.position),
          approaching =
            mover.moving() &&
            footSegmentBlockedBy(mover.position, ahead, new Footprint(anchor.position, footBounds.halfX, 0));
        if (!overlap && !approaching) continue;
        const near = approaching ? closestOnSegment(anchor.position, mover.position, ahead) : mover.position,
          relative = sub(near, anchor.position),
          lateral = delta.x * side.x + delta.y * side.y,
          sign = Math.abs(lateral) > 0.001 ? Math.sign(lateral) : mover.id < anchor.id ? 1 : -1,
          direction = scale(side, sign),
          amount = Math.min(footSeparation(relative, direction), Math.max(0, dt) * 0.8);
        shifts[index] = add(shifts[index], scale(direction, amount));
        limits[index] = 0.8;
        continue;
      }
      if (!footBoxesOverlap(a.position, b.position)) continue;
      const delta = sub(a.position, b.position),
        forward = a.moving()
          ? normalized(sub(a.path[0], a.position))
          : b.moving()
            ? normalized(sub(b.path[0], b.position))
            : point(1, 0);
      let side = point(-forward.y, forward.x);
      const cross = delta.x * side.x + delta.y * side.y;
      side = scale(side, Math.abs(cross) > 0.001 ? Math.sign(cross) : a.id < b.id ? 1 : -1);
      const push = scale(side, Math.min(footSeparation(delta, side) * 0.5, Math.max(0, dt) * 0.4));
      shifts[i] = add(shifts[i], push);
      shifts[j] = sub(shifts[j], push);
    }
  for (let i = 0; i < people.length; ++i) {
    const p = people[i],
      amount = distance(point(), shifts[i]);
    if (amount < 0.0001) continue;
    const offset = scale(shifts[i], Math.min(1, (dt * limits[i]) / amount)),
      at = add(p.position, offset);
    if (!town.grid.walkable(at) || !town.grid.clear(p.position, at, Infinity)) continue;
    if (
      p.path.length &&
      (!town.grid.clear(at, p.path[0], Infinity) ||
        distance(at, p.path[0]) > distance(p.position, p.path[0]) + 0.03)
    )
      continue;
    p.position = at;
  }
}

/** Cooperative road workers keep distinct positions beside the same work front. */
export function roadWorkSpot(town: TownState, person: Person, road: import('./road-network').Road) {
  const front = road.workPoint(),
    jobs = town as TownState & { roadWorkTarget(id: number): number };
  // A mate who is off felling a tree of the way or carrying wood home keeps their place at the front:
  // the others must not shuffle sideways each time one of them leaves and comes back.
  const crew = town.folk.filter(
    (p) =>
      p.health > 0 &&
      (p === person ||
        ((p.task === Activity.Roadwork || p.task === Activity.Building) &&
          ((p.activity === Activity.Roadwork && p.target === road.id) ||
            (p.supplyRoad && p.supplyTarget === road.id))) ||
        (p.task === Activity.Roadwork &&
          p.activity !== Activity.Roadwork &&
          (p.taskSite === road.id || jobs.roadWorkTarget(p.taskSite) === road.id))),
  );
  crew.sort((a, b) => a.id - b.id);
  if (crew.length < 2) return front;
  let tangent = point(1, 0),
    best = Infinity;
  for (let i = 1; i < road.line.length; ++i) {
    const a = road.line[i - 1],
      b = road.line[i],
      delta = sub(b, a),
      len2 = delta.x * delta.x + delta.y * delta.y;
    if (len2 < 1e-8) continue;
    const t = Math.max(0, Math.min(1, ((front.x - a.x) * delta.x + (front.y - a.y) * delta.y) / len2)),
      gap = distance(front, add(a, scale(delta, t)));
    if (gap < best) {
      best = gap;
      tangent = normalized(delta);
    }
  }
  const index = crew.indexOf(person),
    row = Math.floor(index / 3),
    rowColumns = Math.min(3, crew.length - row * 3),
    side = point(-tangent.y, tangent.x),
    offset = ((index % 3) - (rowColumns - 1) / 2) * 0.2,
    reverse =
      road.built < 1 && road.constructionStart > 0 && road.built >= 1 - road.constructionStart ? -1 : 1;
  for (const sign of [-1, 1]) {
    const spot = add(add(front, scale(side, offset)), scale(tangent, sign * reverse * row * 0.2));
    if (town.grid.walkable(spot) && town.grid.clear(front, spot, Infinity)) return spot;
  }
  return front;
}

/** The way the front of a road moves as it is laid or paved, or null where it stands still (mending). */
export function roadWorkHeading(road: import('./road-network').Road): Point | null {
  const paving = road.built >= 1;
  if (paving && road.paving < 0) return null;
  const at = paving ? road.paving : road.built,
    hair = 0.25 / Math.max(1, road.length()),
    spot = (share: number) => (paving ? road.along(share) : road.constructionPoint(share)),
    // At the very end of the way the last stretch still tells the direction.
    heading = at + hair <= 1 ? sub(spot(at + hair), spot(at)) : sub(spot(at), spot(Math.max(0, at - hair)));
  return distance(point(), heading) > 1e-6 ? normalized(heading) : null;
}

/** How far ahead of their place at the front a road worker may stand and still lay. */
export const roadLayReach = 0.9;
/**
 * True for a worker who stands a step ahead of their place at the front, as after felling the tree that stopped
 * it: they lay from where they stand and the front comes to them, so nobody walks back along the road.
 */
export function waitsForFront(road: import('./road-network').Road, spot: Point, at: Point): boolean {
  const heading = roadWorkHeading(road),
    off = distance(at, spot);
  return !!heading && off > 0.0001 && off <= roadLayReach && (at.x - spot.x) * heading.x + (at.y - spot.y) * heading.y > 0;
}

const siteSpots = new WeakMap<Building, { revision: bigint; crew: number; slots: Map<number, Point> }>();

/** Work successive sections of the front wall. Each short step stays on the clear apron. */
export function frameWorkSpot(
  town: TownState, building: Building, index: number, crew: number, progress: number,
): Point {
  const section = Math.max(0, Math.min(2, Math.floor(progress * 3 - (index % 3) * 0.1)));
  let spots = siteSpots.get(building);
  if (!spots || spots.revision !== town.walkRevision || spots.crew !== crew) {
    spots = { revision: town.walkRevision, crew, slots: new Map() };
    siteSpots.set(building, spots);
  }
  const key = index * 3 + section;
  const known = spots.slots.get(key);
  if (known) return known;
  const door = building.door(),
    outward = normalized(sub(door, building.threshold())),
    side = point(-outward.y, outward.x),
    row = Math.floor(index / 3),
    columns = Math.min(3, crew - row * 3),
    span = Math.min(0.52, building.footprint().half * 0.55),
    offset = ((index % 3) - (columns - 1) / 2) * 0.34 + [0, span, -span][section];
  let at = door;
  for (const share of [1, 0.5]) {
    const candidate = add(door, add(scale(side, offset * share), scale(outward, row * 0.22)));
    if (
      town.grid.cost(Math.floor(candidate.x), Math.floor(candidate.y)) > 0 &&
      town.grid.walkable(candidate) && town.grid.clear(door, candidate, Infinity, true)
    ) {
      at = candidate;
      break;
    }
  }
  spots.slots.set(key, at);
  return at;
}

/** Keep shared building work outside, on distinct reachable apron positions. */
export function buildingWorkSpot(
  town: TownState,
  person: Person,
  building: Building,
) {
  const crew = town.folk.filter(
    (p) =>
      p.health > 0 &&
      (p === person ||
        (p.task === Activity.Building && p.taskSite === building.id) ||
        p.job === building.id ||
        (p.activity === Activity.Working && p.target === building.id)),
  );
  crew.sort((a, b) => a.id - b.id);
  const index = crew.indexOf(person);
  if (index < 0) return building.door();
  const repairing = building.health < 1 && (person.activity === Activity.Building || person.task === Activity.Building);
  if (!building.built() || repairing)
    return frameWorkSpot(town, building, index, crew.length, building.built() ? building.health : building.progress);
  const door = building.door();
  if (crew.length < 2) return door;
  const outward = normalized(sub(door, building.threshold())),
    side = point(-outward.y, outward.x),
    row = Math.floor(index / 3),
    columns = Math.min(3, crew.length - row * 3),
    offset = ((index % 3) - (columns - 1) / 2) * 0.2;
  for (let extra = 0; extra < 5; ++extra) {
    const spot = add(add(door, scale(side, offset)), scale(outward, row * 0.2 + extra * 0.1));
    if (town.grid.walkable(spot) && town.grid.clear(door, spot, Infinity)) return spot;
  }
  return door;
}

/** Spread melee fighters inside their existing attack radius, without changing targets. */
export function spreadFighter(
  town: TownState,
  person: Person,
  target: { id: number; position: import('./geometry').Point },
  reach: number,
  dt: number,
): void {
  if (
    !town.folk.some(
      (p) =>
        p !== person &&
        p.health > 0 &&
        !p.inside &&
        p.activity === Activity.Fighting &&
        footBoxesOverlap(p.position, person.position),
    )
  )
    return;
  const angle = person.id * 2.399963229728653 + target.id * 0.17,
    radius = reach * 0.72;
  for (let i = 0; i < 8; ++i) {
    const turn = angle + (i * Math.PI) / 4,
      spot = add(target.position, point(Math.cos(turn) * radius, Math.sin(turn) * radius));
    if (!town.grid.walkable(spot) || !town.grid.clear(person.position, spot, Infinity)) continue;
    const gap = distance(person.position, spot);
    if (gap < 0.001) return;
    const at = add(person.position, scale(sub(spot, person.position), Math.min(1, (dt * 0.45) / gap)));
    if (distance(at, target.position) <= reach) person.position = at;
    return;
  }
}
