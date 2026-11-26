import { centroid, distance, lerp, point, project, type Outline, type Point } from '../../engine/src/geometry';
import { Structure } from '../../engine/src/building-catalog';
import { pastureOutline } from '../../engine/src/pasture-geometry';
import { pastureOpening } from '../../engine/src/pasture-roaming';
import type { Building } from '../../engine/src/town-models';
import { Rect } from '../../native-ui/src/types';
import { SceneNode, ShapeNode } from './paint';
import { appendPolygon, polygon } from './vector-paint';
import { registerDepth } from './world-depth';
import { registerPick } from './world-pick-registry';

export function paintPastureGround(ground: SceneNode, pen: Building): void {
  const yard = pen.pasture;
  if (!yard.length) return;
  const grass = polygon(yard, [142, 148, 80, 52]);
  if (!pen.built()) grass.strokeWidth(.06).strokeDash([.24, .16]).strokeFill(214, 186, 120, 210);
  ground.add(grass);
  registerPick(grass, { ref: { kind: 'building', id: pen.id }, body: [grass], foot: centroid(yard), groundOutline: yard });
}

interface FenceSpan { start: Point; end: Point; endPost: boolean }
/** Posts are shared at the corners and at the ends of adjoining rails. The gate has a post on each side. */
export function pastureRails(yard: Outline, door: Point): FenceSpan[] {
  const gate = pastureOpening(yard, door), spans: FenceSpan[] = [];
  for (let i = 0; i < yard.length; ++i) {
    const a = yard[i], b = yard[(i + 1) % yard.length];
    const intervals = gate?.edge === i ? [[0, gate.along - gate.half], [gate.along + gate.half, 1]] : [[0, 1]];
    for (const [lo, hi] of intervals) {
      const count = Math.ceil(distance(a, b) * (hi - lo) / 1.15);
      let start = lerp(a, b, lo);
      for (let part = 1; part <= count; ++part) {
        const end = lerp(a, b, lo + (hi - lo) * part / count);
        spans.push({ start, end, endPost: part === count && hi < 1 });
        start = end;
      }
    }
  }
  return spans;
}

function post(shade: ShapeNode, face: ShapeNode, p: Point, height: number): void {
  const { x, y } = p;
  appendPolygon(shade, [point(x - 1.9, y - height), point(x, y - height - 1.2), point(x + 2, y - height),
    point(x + 2, y), point(x, y + .9), point(x - 1.9, y)]);
  appendPolygon(face, [point(x - 1.9, y - height), point(x, y - height - 1.2), point(x, y + .9), point(x - 1.9, y)]);
}
interface StandingRail { row: number; paint: SceneNode }
const fences = new WeakMap<Building, { outline: Outline; center: Point; angle: number; rails: StandingRail[] }>();
/** Each rail stands at its own depth so the herd can pass both behind and in front of the fence. */
function buildRails(pen: Building): StandingRail[] {
  const rails: StandingRail[] = [];
  const yard = pastureOutline(pen), height = pen.kind === Structure.Cowshed ? 10 : 7.5;
  for (const [i, span] of pastureRails(yard, pen.door()).entries()) {
    const a = project(span.start.x, span.start.y), b = project(span.end.x, span.end.y);
    const face = new ShapeNode().fill(163, 126, 84), shade = new ShapeNode().fill(103, 80, 65);
    for (const y of [height * .31, height * .76]) {
      appendPolygon(shade, [point(a.x, a.y - y), point(b.x, b.y - y), point(b.x, b.y - y + 2.1), point(a.x, a.y - y + 2.1)]);
      appendPolygon(face, [point(a.x, a.y - y - .6), point(b.x, b.y - y - .6), point(b.x, b.y - y + .5), point(a.x, a.y - y + .5)]);
    }
    post(shade, face, a, height);
    if (span.endPost) post(shade, face, b, height);
    const rail = new SceneNode().add(shade).add(face), foot = lerp(span.start, span.end, .5);
    registerDepth(rail, foot, `pasture:${pen.id}:${i}`,
      new Rect(Math.min(a.x, b.x) - 2, Math.min(a.y, b.y) - height - 2, Math.abs(a.x - b.x) + 4, Math.abs(a.y - b.y) + height + 4));
    rails.push({ row: Math.floor(foot.x) + Math.floor(foot.y), paint: rail });
  }
  return rails;
}
export function paintPastureFence(rows: SceneNode[], pen: Building): void {
  if (!pen.built()) return;
  let fence = fences.get(pen);
  if (!fence || fence.outline !== pen.pasture || fence.center !== pen.center || fence.angle !== pen.angle) {
    fence = { outline: pen.pasture, center: pen.center, angle: pen.angle, rails: buildRails(pen) };
    fences.set(pen, fence);
  }
  for (const rail of fence.rails) rows[Math.max(0, Math.min(rows.length - 1, rail.row))].add(rail.paint);
}
