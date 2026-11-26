import { Structure, structureSpec } from './building-catalog';
import {
  type Outline, type Point, Footprint, add, area, centroid, contains, distance, point, rotated, selfIntersects, sub,
} from './geometry';
import type { Town } from './town';
import { Check, Placement } from './town-models';
import { TownState } from './town-state';

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const inBox = (b: Box, p: Point): boolean => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
/** The part of a→b that lies in the box, as two shares of the way; null when it misses the box. */
function span(b: Box, a: Point, c: Point): [number, number] | null {
  let t0 = 0,
    t1 = 1;
  for (const [from, step, low, high] of [
    [a.x, c.x - a.x, b.x0, b.x1],
    [a.y, c.y - a.y, b.y0, b.y1],
  ]) {
    if (Math.abs(step) < 1e-9) {
      if (from < low || from > high) return null;
      continue;
    }
    const near = (low - from) / step,
      far = (high - from) / step;
    t0 = Math.max(t0, Math.min(near, far));
    t1 = Math.min(t1, Math.max(near, far));
  }
  return t0 < t1 ? [t0, t1] : null;
}
/** How far round the box's rim a point on it lies: 0 to 4, one for each side from the first corner. */
function rim(b: Box, p: Point): number {
  const w = b.x1 - b.x0,
    h = b.y1 - b.y0,
    gaps = [Math.abs(p.y - b.y0), Math.abs(p.x - b.x1), Math.abs(p.y - b.y1), Math.abs(p.x - b.x0)],
    side = gaps.indexOf(Math.min(...gaps));
  return side + [(p.x - b.x0) / w, (p.y - b.y0) / h, (b.x1 - p.x) / w, (b.y1 - p.y) / h][side];
}
/** `outline` with the box cut out of its edge; null unless the outline enters the box once and leaves it once. */
function cutOut(outline: Outline, b: Box): Outline | null {
  const corners = [point(b.x0, b.y0), point(b.x1, b.y0), point(b.x1, b.y1), point(b.x0, b.y1)],
    out: Outline = [];
  let cuts = 0;
  for (let i = 0; i < outline.length; ++i) {
    const a = outline[i],
      c = outline[(i + 1) % outline.length],
      within = span(b, a, c);
    if (!inBox(b, a)) out.push(a);
    if (inBox(b, a) === inBox(b, c)) {
      if (!inBox(b, a) && within) return null;
      continue;
    }
    if (!within) return null;
    const at = (t: number): Point => point(a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t);
    if (inBox(b, c)) {
      // The outline goes in here: follow the box's rim to where it comes out again.
      const enter = at(within[0]);
      let leave: Point | null = null;
      for (let j = 1; j <= outline.length && !leave; ++j) {
        const p = outline[(i + j) % outline.length],
          q = outline[(i + j + 1) % outline.length],
          crossing = span(b, p, q);
        if (inBox(b, p) && !inBox(b, q) && crossing)
          leave = point(p.x + (q.x - p.x) * crossing[1], p.y + (q.y - p.y) * crossing[1]);
      }
      if (!leave || ++cuts > 1) return null;
      const from = rim(b, enter),
        ahead = (rim(b, leave) - from + 4) % 4,
        ways: Outline[] = [[], []];
      for (let k = Math.floor(from) + 1; k - from < ahead - 1e-6; ++k) ways[0].push(corners[k % 4]);
      for (let k = Math.ceil(from) - 1; from - k < 4 - ahead - 1e-6; --k) ways[1].push(corners[(k + 8) % 4]);
      const inside = ways.find((way) => way.length && way.every((p) => contains(outline, p))),
        way = inside ?? ways.find((w) => !w.length);
      if (!way) return null;
      out.push(enter, ...way, leave);
    }
  }
  return cuts === 1 && out.length >= 3 ? out : null;
}
/** Fit a shelter in a corner of a drawn plot, giving both the usable yard and the entrance toward the road. */
export function shelteredLayout(town: Town, drawn: Outline, kind: Structure, tooSmall: string, noCorner: string,
  yardProblem: (yard: Outline, house: Placement) => string): { check: Check; house: Placement | null; yard: Outline } {
  const half = structureSpec(kind).size / 2,
    origin = drawn[0],
    angle = Math.atan2(drawn[1].y - origin.y, drawn[1].x - origin.x),
    local = drawn.map((p) => rotated(sub(p, origin), -angle)),
    world = (p: Point): Point => add(origin, rotated(p, angle)),
    xs = local.map((p) => p.x),
    ys = local.map((p) => p.y),
    low = point(Math.min(...xs), Math.min(...ys)),
    high = point(Math.max(...xs), Math.max(...ys));
  if (high.x - low.x < 2 * half || high.y - low.y < 2 * half) return { check: new Check(false, tooSmall), house: null, yard: [] };
  // The shelter takes the corner nearest a road, or nearest the camp where no road runs close.
  const roads = town.roads(),
    seat = town.camp(town.settlementAt(centroid(drawn))) ?? town.camp(),
    corners = [low.x, high.x].flatMap((x) => [low.y, high.y].map((y) => point(x, y))),
    byRoad = corners.some((c) => roads.distance(world(c)).distance <= TownState.farmReach),
    toward = (p: Point): Point => (byRoad ? roads.distance(p).onRoad! : (seat?.center ?? p)),
    gap = (c: Point): number => distance(world(c), toward(world(c)));
  corners.sort((a, b) => gap(a) - gap(b));
  let refusal = '';
  for (const corner of corners) {
    const inward = point(corner.x === low.x ? 1 : -1, corner.y === low.y ? 1 : -1),
      centre = point(corner.x + inward.x * half, corner.y + inward.y * half),
      center = world(centre),
      // Shrunk a hair: a wall on the drawn line itself still counts as inside the area.
      walls = new Footprint(centre, half - 0.02, 0).corners();
    if (!walls.every((p) => contains(local, p))) {
      refusal ||= noCorner;
      continue;
    }
    const reach = 2 * half + 0.15,
      plot = cutOut(local, {
        x0: Math.min(corner.x - inward.x, corner.x + inward.x * reach),
        x1: Math.max(corner.x - inward.x, corner.x + inward.x * reach),
        y0: Math.min(corner.y - inward.y, corner.y + inward.y * reach),
        y1: Math.max(corner.y - inward.y, corner.y + inward.y * reach),
      });
    if (!plot || selfIntersects(plot) || area(plot) < 1) {
      refusal ||= tooSmall;
      continue;
    }
    const field = plot.map(world),
      // The door opens out of the area, on the side that looks to the road or the camp.
      away = sub(toward(center), center),
      doors = [rotated(point(-inward.x, 0), angle), rotated(point(0, -inward.y), angle)].sort(
        (a, b) => b.x * away.x + b.y * away.y - (a.x * away.x + a.y * away.y),
      );
    for (const door of doors) {
      const house = new Placement(center, Math.atan2(-door.x, door.y), true),
        check = town.canPlace(kind, house.center, house.angle);
      if (check.ok) {
        const problem = yardProblem(field, house);
        if (!problem) return { check, house, yard: field };
        refusal ||= problem;
      }
      refusal ||= check.reason;
    }
  }
  return { check: new Check(false, refusal || tooSmall), house: null, yard: [] };
}
