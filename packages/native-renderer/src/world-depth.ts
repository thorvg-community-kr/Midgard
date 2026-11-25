import { Footprint, distance, project, unproject, type Point } from '../../engine/src/geometry';
import { f32, clamp } from '../../engine/src/numeric';
import { Giant, Volcano } from '../../engine/src/world-types';
import { WorldMap } from '../../engine/src/world-map';
import { Town } from '../../engine/src/town';
import { structureSpec } from '../../engine/src/building-catalog';
import { SceneNode, type PaintNode, type Shade } from './paint';
import type { WorldRendererState } from './world-renderer-state';
import { mistRules, mistTones, type MistField } from './mist-bands';
import { Rect } from '../../native-ui/src/types';
import { batchScenery } from './scenery-batches';

export interface GroundBaseline {
  left: Point;
  right: Point;
}
interface DepthItem {
  paint: PaintNode;
  centerY: number;
  /** A previously cached entry no longer describes the registered paint. */
  superseded?: boolean;
  baseline: GroundBaseline;
  key: string;
  bounds?: Rect;
  /** The box used for culling: `bounds`, or a generous one round the baseline. */
  box?: Rect;
  /** The tiles under the middle and the two ends of the baseline: where it stands in the mist. */
  feet?: Point[];
  /** The redraw of the mist this was last told from, whether the bank hides it, and how dim it is drawn. */
  mistAt?: number;
  hidden?: boolean;
  dim?: number;
}
const depthItems = new WeakMap<PaintNode, DepthItem>();

/** The left-to-right tile diagonal is the building's ground baseline, independent of roof height. */
export function footprintBaseline(footprint: Footprint): GroundBaseline {
  const corners = footprint.corners().map((p) => project(p.x, p.y));
  const diagonals = [
    [corners[0], corners[2]],
    [corners[1], corners[3]],
  ];
  diagonals.sort(
    (a, b) =>
      Math.abs((a[1].y - a[0].y) / (a[1].x - a[0].x || 1e-9)) -
      Math.abs((b[1].y - b[0].y) / (b[1].x - b[0].x || 1e-9)),
  );
  const [a, b] = diagonals[0];
  return a.x <= b.x ? { left: a, right: b } : { left: b, right: a };
}
export function groundBaseline(at: Point): GroundBaseline {
  const foot = project(at.x, at.y);
  return { left: foot, right: foot };
}
export function registerDepth(paint: PaintNode, at: Point | Footprint, key: string, bounds?: Rect): void {
  const baseline = at instanceof Footprint ? footprintBaseline(at) : groundBaseline(at),
    old = depthItems.get(paint);
  if (
    old &&
    old.key === key &&
    old.baseline.left.x === baseline.left.x &&
    old.baseline.left.y === baseline.left.y &&
    old.baseline.right.x === baseline.right.x &&
    old.baseline.right.y === baseline.right.y &&
    old.bounds?.x === bounds?.x &&
    old.bounds?.y === bounds?.y &&
    old.bounds?.w === bounds?.w &&
    old.bounds?.h === bounds?.h
  )
    return;
  if (old) old.superseded = true;
  depthItems.set(paint, { paint, baseline, key, bounds, centerY: (baseline.left.y + baseline.right.y) / 2 });
}
export const baselineDepthAt = (line: GroundBaseline, x: number): number => {
  const width = line.right.x - line.left.x;
  return width ? line.left.y + ((line.right.y - line.left.y) * (x - line.left.x)) / width : line.left.y;
};
/** Compare the overlapping ground baselines, not animated body bounds or creation order. */
export function compareBaselines(a: GroundBaseline, b: GroundBaseline): number {
  const left = Math.max(a.left.x, b.left.x),
    right = Math.min(a.right.x, b.right.x);
  if (left <= right) return baselineDepthAt(a, (left + right) / 2) - baselineDepthAt(b, (left + right) / 2);
  return (a.left.y + a.right.y - b.left.y - b.right.y) / 2;
}
const centerOrder = (a: DepthItem, b: DepthItem) =>
  a.centerY - b.centerY ||
  (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const orderCache = new WeakMap<WorldRendererState, { entries: DepthItem[]; order: PaintNode[] }>();
/** Horizontal baselines already agree with the center sort. Only a tilted footprint can reverse a pair. */
function followsCenterOrder(entries: readonly DepthItem[]): boolean {
  let tilted = 0;
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i],
      line = item.baseline;
    if (i && centerOrder(entries[i - 1], item) === 0) return false;
    if (line.left.y === line.right.y) continue;
    // For a settlement with many tilted buildings, the spatial sweep is cheaper.
    if (++tilted > 4) return false;
    for (let j = 0; j < entries.length; j++) {
      const other = entries[j].baseline;
      if (line.right.x < other.left.x || other.right.x < line.left.x) continue;
      const delta = compareBaselines(line, other) || centerOrder(item, entries[j]);
      if ((j < i && delta < 0) || (j > i && delta > 0)) return false;
    }
  }
  return true;
}
function orderedPaints(items: readonly DepthItem[]): PaintNode[] {
  const entries = [...items].sort(centerOrder),
    count = entries.length;
  if (followsCenterOrder(entries)) return entries.map((item) => item.paint);
  const boxes = entries.map(
    (item) =>
      item.bounds ??
      new Rect(
        item.baseline.left.x - 28,
        Math.min(item.baseline.left.y, item.baseline.right.y) -
          (item.baseline.left.x === item.baseline.right.x ? 72 : 600),
        item.baseline.right.x - item.baseline.left.x + 56,
        Math.abs(item.baseline.right.y - item.baseline.left.y) +
          (item.baseline.left.x === item.baseline.right.x ? 88 : 640),
      ),
  );
  const edges: number[][] = Array.from({ length: count }, () => []),
    incoming = new Uint32Array(count);
  const sweep = entries.map((_, i) => i).sort((a, b) => boxes[a].x - boxes[b].x),
    active: number[] = [];
  for (const i of sweep) {
    const box = boxes[i];
    for (let a = active.length - 1; a >= 0; a--)
      if (boxes[active[a]].x + boxes[active[a]].w < box.x) active.splice(a, 1);
    for (const j of active) {
      const other = boxes[j];
      if (box.y > other.y + other.h || other.y > box.y + box.h) continue;
      const delta =
        compareBaselines(entries[i].baseline, entries[j].baseline) || centerOrder(entries[i], entries[j]);
      const before = delta < 0 ? i : j,
        after = delta < 0 ? j : i;
      edges[before].push(after);
      incoming[after]++;
    }
    active.push(i);
  }
  // Overlapping footprints are disallowed by the simulation. For unusual imported artwork
  // with cyclic overlap, break ties consistently instead of depending on Array.sort's probes.
  const ready: number[] = [],
    used = new Uint8Array(count),
    result: PaintNode[] = [];
  const enqueue = (id: number) => {
    let low = 0,
      high = ready.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (ready[mid] < id) low = mid + 1;
      else high = mid;
    }
    ready.splice(low, 0, id);
  };
  for (let i = 0; i < count; i++) if (!incoming[i]) enqueue(i);
  while (result.length < count) {
    let id = ready.shift();
    if (id === undefined) {
      id = used.findIndex((value) => !value);
    }
    if (used[id]) continue;
    used[id] = 1;
    result.push(entries[id].paint);
    for (const next of edges[id]) if (incoming[next] && --incoming[next] === 0 && !used[next]) enqueue(next);
  }
  return result;
}

/** Rows are geometry caches only. All visible objects share one retained painter order. */
/** The part of the world the camera shows, with a margin for what is about to enter. */
export function viewRect(s: WorldRendererState): Rect {
  const margin = 64 / s.view.zoom;
  return new Rect(
    s.view.x - s.viewWidth / s.view.zoom / 2 - margin,
    s.view.y - s.viewHeight / s.view.zoom / 2 - margin,
    (s.viewWidth + 128) / s.view.zoom,
    (s.viewHeight + 128) / s.view.zoom,
  );
}
/** A generous box round whatever stands on a baseline: a figure with its tool, or a building. */
function standingBox(baseline: GroundBaseline): Rect {
  const wide = baseline.right.x - baseline.left.x,
    tall = wide > 1 ? 300 : 150,
    top = Math.min(baseline.left.y, baseline.right.y) - tall;
  return new Rect(
    baseline.left.x - 72,
    top,
    wide + 144,
    Math.max(baseline.left.y, baseline.right.y) + 48 - top,
  );
}
/** Whether someone standing at a tile could show anywhere on screen; true until a camera is set. */
export function standsInView(s: WorldRendererState, view: Rect, at: Point): boolean {
  if (s.viewWidth <= 0 || s.viewHeight <= 0) return true;
  const overlap = standingBox(groundBaseline(at)).intersect(view);
  return overlap.w > 0 && overlap.h > 0;
}
/** Culls a figure by where it is drawn, not by its depth baseline (a doorway's, mid-crossing). */
export function cullAround(paint: PaintNode, at: Point): void {
  const item = depthItems.get(paint);
  if (item) item.box = standingBox(groundBaseline(at));
}
/** The veil's tone on a thing, a step stronger each redraw until it is as dim as the ground it stands on. */
const dimmed = (whole: boolean): (Shade | undefined)[] =>
  Array.from({ length: mistRules.steps + 1 }, (_, step) =>
    step ? { tone: mistTones.veil, strength: (mistTones.memory * step) / mistRules.steps, whole } : undefined,
  );
const shades = { own: dimmed(false), whole: dimmed(true) };
/**
 * Tells a thing from the ground it stands on: gone in the bank, dimmed in the veil, plain in sight. It is
 * told whole, by its foot, so a tree in sight keeps its top against the mist behind it and nothing shows on
 * the black. A landmark is too wide for one foot: it is gone only when the bank has all of its baseline.
 */
function standInMist(s: WorldRendererState, item: DepthItem, mist: MistField): void {
  if (!item.feet) {
    const { left, right } = item.baseline;
    item.feet = [unproject((left.x + right.x) / 2, (left.y + right.y) / 2)];
    if (item.key.startsWith('landmark:')) item.feet.push(unproject(left.x, left.y), unproject(right.x, right.y));
  }
  const foot = item.feet[0];
  let bank = mist.depth('bank', foot.x, foot.y);
  for (let i = 1; i < item.feet.length; i++) {
    const edge = item.feet[i],
      depth = mist.depth('bank', edge.x, edge.y);
    if (!Number.isNaN(depth) && (Number.isNaN(bank) || depth < bank)) bank = depth;
  }
  // If every foot lies outside the sampled field, keep the last known appearance.
  if (Number.isNaN(bank)) return;
  const tick = s.mistTick,
    hidden = bank > 0,
    // As dim as the ground under it is tinted, so a thing fades with the mist instead of changing colour at its edge.
    veil = hidden ? 0 : mist.tint(foot.x, foot.y),
    want = hidden ? 0 : Number.isNaN(veil) ? (item.dim ?? 0) : Math.round(veil * mistRules.steps),
    // What comes into view, or out of the bank, is at once as the land round it; the rest goes by steps.
    sudden = s.reducedMotion || item.hidden !== false || item.mistAt !== tick - 1,
    dim = sudden ? want : (item.dim ?? 0) + Math.sign(want - (item.dim ?? 0));
  item.mistAt = tick;
  item.hidden = hidden;
  shadeItem(item, dim);
  // A landmark once seen is known whole: the bank then keeps off all of its ground, so it never stands on black.
  if (!hidden && item.feet.length > 1 && !s.mistKnown.has(item.key))
    s.mistKnown.set(item.key, { center: item.feet[0], radius: distance(item.feet[1], item.feet[2]) / 2 + 0.5 });
}
function shadeItem(item: DepthItem, dim: number): void {
  if (item.dim === dim) return;
  item.dim = dim;
  // A building is a Lottie picture: its colours are not ours to change one by one.
  if (item.paint instanceof SceneNode)
    item.paint.shaded((item.key.startsWith('building:') ? shades.whole : shades.own)[dim]);
}
function rowItem(paint: PaintNode, row: number, category: number, order: number): DepthItem {
  let item = depthItems.get(paint);
  if (!item) {
    const y = (row + 1) * 16;
    item = {
      paint,
      baseline: { left: { x: -1e8, y }, right: { x: 1e8, y } },
      centerY: y,
      key: `row:${row}:${category}:${order}`,
    };
    depthItems.set(paint, item);
  }
  return item;
}
const treeItems = new WeakMap<SceneNode, { source: DepthItem[]; order: DepthItem[] }>();
/** Tree rows keep their depth order while the viewport and the mist move past them. */
function treeOrder(row: SceneNode, index: number): DepthItem[] {
  const cached = treeItems.get(row),
    children = row.children;
  if (
    cached &&
    cached.source.length === children.length &&
    cached.source.every((item, i) => !item.superseded && item.paint === children[i])
  )
    return cached.order;
  const source = children.map((paint, i) => rowItem(paint, index, 2, i)),
    order = source.slice().sort(centerOrder);
  treeItems.set(row, { source, order });
  return order;
}
export function sortWorldObjects(s: WorldRendererState): void {
  const visible = viewRect(s),
    right = Math.fround(visible.x + visible.w),
    bottom = Math.fround(visible.y + visible.h),
    // Mist only exists once vision has run; the editors and scene views show everything.
    mist = !s.editorView && s.fogged && !s.mistLifted ? s.mistField : null,
    // Without a camera nothing is known to be off screen; only registered bounds are trusted.
    framed = s.viewWidth > 0 && s.viewHeight > 0;
  const entries: DepthItem[] = [];
  const collect = (item: DepthItem, category: number) => {
    // Switched off (a figure out of sight, a spent effect): nothing to draw or to keep in step.
    if (!item.paint.alpha) return;
    // Landmarks tower over any box; they are few and stay in.
    if (!item.key.startsWith('landmark:')) {
      const box = (item.box ??= item.bounds ?? standingBox(item.baseline));
      if (item.bounds || framed) {
        if (
          Math.min(Math.fround(box.x + box.w), right) <= Math.max(box.x, visible.x) ||
          Math.min(Math.fround(box.y + box.h), bottom) <= Math.max(box.y, visible.y)
        )
          return;
      }
    }
    // Figures and effects are shown by sight itself; everything else by the ground it stands on.
    if (mist && category !== 3) {
      if (item.mistAt !== s.mistTick) standInMist(s, item, mist);
      if (item.hidden) return;
    } else if (item.dim || item.hidden) {
      item.hidden = false;
      item.mistAt = undefined;
      shadeItem(item, 0);
    }
    entries.push(item);
  };
  for (const [category, rows] of [s.rowBuildings, s.rowLamps, s.rowTrees, s.rows].entries()) {
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (!row.alpha || !row.children.length) continue;
      if (category === 2) {
        for (const item of treeOrder(row, index)) collect(item, category);
      } else {
        for (let i = 0; i < row.children.length; i++)
          collect(rowItem(row.children[i], index, category, i), category);
      }
    }
  }
  const cached = orderCache.get(s),
    unchanged =
      cached &&
      cached.entries.length === entries.length &&
      entries.every((item, i) => item === cached.entries[i]);
  const order = unchanged ? cached.order : orderedPaints(entries);
  if (!unchanged) orderCache.set(s, { entries, order });
  const next = mist ? batchScenery(order, s.view.zoom) : order;
  if (next.length !== s.objects.children.length || next.some((paint, i) => s.objects.children[i] !== paint)) {
    s.objects.children = next;
    s.objects.version++;
  }
}
export const giantFootprint = (g: Giant): Footprint => new Footprint(g.center(), f32(Giant.size / 2), 0);
export const volcanoFootprint = (v: Volcano): Footprint =>
  new Footprint(v.center(), f32(Volcano.size / 2), 0);
export function rowOf(value: Footprint | Point, rows: number): number {
  if (value instanceof Footprint) {
    let front = -1e9;
    for (const p of value.corners()) front = Math.max(front, f32(p.x + p.y));
    return clamp(f32(Math.floor(f32(front + f32(0.01))) - 2), 0, f32(rows - 1));
  }
  return clamp(f32(Math.floor(f32(value.x + value.y)) - 1), 0, f32(rows - 1));
}
export function drawRow(map: WorldMap, footprint: Footprint, rows: number): number {
  let row = rowOf(footprint, rows),
    low = 1e9,
    high = -1e9;
  for (const p of footprint.corners()) {
    low = Math.min(low, f32(p.x - p.y));
    high = Math.max(high, f32(p.x - p.y));
  }
  const u = f32(footprint.center.x - footprint.center.y),
    s = f32(footprint.center.x + footprint.center.y),
    before = (stone: Footprint, half: number) => {
      const column = f32(stone.center.x - stone.center.y);
      if (high <= f32(column - half) || low >= f32(column + half)) return;
      const front = f32(
        f32(f32(stone.center.x + stone.center.y) + half) - Math.min(Math.abs(f32(u - column)), half),
      );
      if (s > front) row = Math.max(row, rowOf(stone, rows));
    };
  const giant = map.giant(),
    volcano = map.volcano();
  if (giant) before(giantFootprint(giant), Giant.size);
  if (volcano) before(volcanoFootprint(volcano), Volcano.size);
  return row;
}
export function standingRow(town: Town, p: Point, rows: number): number {
  let row = rowOf(p, rows),
    atLeast = -1,
    atMost = rows,
    nearestFront = 1e9,
    nearestBehind = 1e9;
  const u = f32(p.x - p.y),
    s = f32(p.x + p.y);
  const weigh = (footprint: Footprint, size: number) => {
    const gap = distance(footprint.center, p);
    if (gap > f32(size + f32(1.5))) return;
    const corners = footprint.corners();
    let front = -1e9,
      back = 1e9;
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i],
        b = corners[f32(i + 1) % corners.length],
        ua = f32(a.x - a.y),
        ub = f32(b.x - b.y);
      if (u < Math.min(ua, ub) || u > Math.max(ua, ub) || ua === ub) continue;
      const t = f32(f32(u - ua) / f32(ub - ua)),
        edge = f32(f32(a.x + a.y) + f32(f32(f32(b.x + b.y) - f32(a.x + a.y)) * t));
      front = Math.max(front, edge);
      back = Math.min(back, edge);
    }
    if (front < back) return;
    const own = drawRow(town.map(), footprint, rows);
    if (s >= f32(front - f32(0.02))) {
      atLeast = Math.max(atLeast, own);
      nearestFront = Math.min(nearestFront, gap);
    } else if (s > f32(back - f32(1.5))) {
      atMost = Math.min(atMost, f32(own - 1));
      nearestBehind = Math.min(nearestBehind, gap);
    }
  };
  for (const building of town.buildings()) weigh(building.footprint(), structureSpec(building.kind).size);
  const giant = town.map().giant(),
    volcano = town.map().volcano();
  if (giant) weigh(giantFootprint(giant), Giant.size);
  if (volcano) weigh(volcanoFootprint(volcano), Volcano.size);
  if (atLeast <= atMost) row = clamp(row, Math.max(atLeast, 0), Math.min(atMost, f32(rows - 1)));
  else row = nearestFront <= nearestBehind ? atLeast : atMost;
  return clamp(row, 0, f32(rows - 1));
}
