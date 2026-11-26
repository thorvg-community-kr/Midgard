import {
  add, closestOnSegment, contains, distance, lerp, point, rotated, segmentDistance, segmentsCross,
  type Outline, type Point,
} from './geometry';
import { hash01 } from './numeric';
import { AnimalKind, type Monster } from './person';
import type { Building } from './town-models';
import type { TownState } from './town-state';
import { animalSpec } from './wildlife';

interface Opening { edge: number; along: number; half: number; inside: Point }
/** The gap in the rails and a point just inside it, shared by the drawing and the herder. */
export function pastureOpening(outline: Outline, door: Point): Opening | null {
  let opening: Opening | null = null, nearest = Infinity;
  for (let i = 0; i < outline.length; ++i) {
    const a = outline[i], b = outline[(i + 1) % outline.length], span = distance(a, b);
    if (span < 1) continue;
    const half = Math.min(.53, span * .34), inset = (half + .12) / span;
    const along = Math.max(inset, Math.min(1 - inset, distance(a, closestOnSegment(door, a, b)) / span));
    const middle = lerp(a, b, along), gap = distance(door, middle);
    if (gap >= nearest) continue;
    const nx = -(b.y - a.y) / span * .40, ny = (b.x - a.x) / span * .40;
    for (const side of [1, -1]) {
      const inside = point(middle.x + nx * side, middle.y + ny * side);
      if (!contains(outline, inside)) continue;
      opening = { edge: i, along, half: half / span, inside };
      nearest = gap;
      break;
    }
  }
  return opening;
}
export function pastureGateFor(outline: Outline, door: Point): Point | null {
  return pastureOpening(outline, door)?.inside ?? null;
}
const gates = new WeakMap<Outline, Point>();
export function pastureGate(pen: Building): Point {
  const known = gates.get(pen.pasture);
  if (known) return known;
  const door = pen.door();
  const gate = pen.pasture.length ? pastureGateFor(pen.pasture, door) ?? door : door;
  gates.set(pen.pasture, gate);
  return gate;
}

interface Yard { boundary: Outline; left: number; top: number; width: number; height: number }
const yards = new WeakMap<Outline, Yard>();
function yardOf(pen: Building): Yard {
  const known = yards.get(pen.pasture);
  if (known) return known;
  // Old coops and sheds have a small strip of grass in front of the shelter and beside its trough.
  const boundary = pen.pasture.length ? pen.pasture :
    [point(-.79, .01), point(.53, .01), point(.53, .85), point(-.79, .85)]
      .map(p => add(pen.center, rotated(p, pen.angle)));
  const xs = boundary.map(p => p.x), ys = boundary.map(p => p.y);
  const left = Math.min(...xs), top = Math.min(...ys);
  const yard = { boundary, left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  yards.set(pen.pasture, yard);
  return yard;
}

/** The pen is assigned once the animal has walked to its gate. Its saved path carries it through. */
export function admitToPasture(town: TownState, pen: Building, animal: Monster): boolean {
  const gate = pastureGate(pen);
  if (pen.pasture.length && !town.grid.walkable(gate)) return false;
  const home = pen.pasture.length ? gate : add(pen.center, rotated(point(0, .62), pen.angle));
  animal.pen = pen.id;
  animal.home = { ...home };
  animal.path = distance(animal.position, home) > .01 ? [home] : [];
  animal.ready = town.time;
  return true;
}

function grazingSpot(town: TownState, pen: Building, animal: Monster): Point | null {
  const yard = yardOf(pen), fence = yard.boundary;
  const margin = animal.animal === AnimalKind.Cow && pen.pasture.length ? .30 : .15;
  for (let i = 0; i < 12; ++i) {
    const beat = Math.floor(town.time * 2) * 12 + i;
    const to = point(yard.left + yard.width * hash01(town.world.seed(), animal.id, beat, 194),
      yard.top + yard.height * hash01(town.world.seed(), animal.id, beat, 195));
    if (distance(animal.position, to) < .25 || !contains(fence, to)) continue;
    if (fence.some((a, j) => {
      const b = fence[(j + 1) % fence.length];
      // The compact legacy lawn is convex. Older animals can start at a stall just outside it.
      return segmentDistance(to, a, b) < margin ||
        (pen.pasture.length > 0 && (segmentsCross(animal.position, to, a, b) || segmentDistance(a, animal.position, to) < margin));
    })) continue;
    // A straight walk wholly inside the fence never needs a map-wide path search.
    if (pen.pasture.length && !town.grid.clear(animal.position, to, Infinity, true)) continue;
    return to;
  }
  return null;
}

export function grazeInPasture(town: TownState, pen: Building, animal: Monster, dt: number): void {
  if (dt <= 0) return;
  const speed = animalSpec(animal.animal!).speed * .45;
  if (!animal.path.length) {
    if (town.time < animal.ready || town.climate().night > .6) return;
    const next = grazingSpot(town, pen, animal);
    animal.ready = town.time + 1.5 + 2.5 * hash01(town.world.seed(), animal.id, Math.floor(town.time), 197);
    if (!next) return;
    animal.path.push(next);
    animal.ready += distance(animal.position, next) / speed;
  }
  // A legacy save can contain two waypoints on the walk in from the old gate.
  let left = speed * dt;
  while (left > 0 && animal.path.length) {
    const to = animal.path[0], gap = distance(animal.position, to);
    if (gap > left) {
      animal.position = lerp(animal.position, to, left / gap);
      return;
    }
    animal.position = { ...to };
    animal.path.shift();
    left -= gap;
  }
}
