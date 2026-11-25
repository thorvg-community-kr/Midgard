import { Camera, point, project, unproject, type Point } from '../../engine/src/geometry';
import type { Town } from '../../engine/src/town';
import { Terrain } from '../../engine/src/world-types';
import { SceneNode, type PaintNode } from './paint';
import { SceneryBatch } from './scenery-batches';
import type { WorldRendererState } from './world-renderer-state';
import { pickSource, type PickSource, type Stand } from './world-pick-registry';
import { wornCourse, stretch } from './road-painter';
import { ghostAreas, ghostTouches, hiddenUnitGhosts, type Ghost } from './hidden-unit-ghosts';
import {
  worldObjectKey,
  type PickBounds,
  type SelectionGeometry,
  type WorldHit,
  type WorldObjectRef,
  type GroundSelectionMarker,
  type ResolvedGroundSelectionMarker,
} from './world-picking-types';

interface Candidate {
  hit: WorldHit | null;
  bounds: PickBounds;
  rank: number;
  body?: readonly PaintNode[];
  batch?: SceneryBatch;
  scenery?: PickSource;
  road?: { line: Point[]; halfWidth: number };
  ghost?: Ghost;
}
const bucketSize = 96;
const overlap = (a: PickBounds, b: PickBounds) =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
const boxOf = (points: readonly Point[]): PickBounds => {
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return { x, y, w: Math.max(...points.map((p) => p.x)) - x, h: Math.max(...points.map((p) => p.y)) - y };
};
function combine(boxes: readonly PickBounds[]): PickBounds | null {
  const first = boxes[0];
  if (!first) return null;
  if (boxes.length === 1) return first;
  let x = first.x,
    y = first.y,
    right = x + first.w,
    bottom = y + first.h;
  for (let i = 1; i < boxes.length; i++) {
    const b = boxes[i];
    x = Math.min(x, b.x);
    y = Math.min(y, b.y);
    right = Math.max(right, b.x + b.w);
    bottom = Math.max(bottom, b.y + b.h);
  }
  return { x, y, w: right - x, h: bottom - y };
}
function pointSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}
const cross = (a: Point, b: Point, p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
function crossing(a: Point, b: Point, c: Point, d: Point): boolean {
  return (
    Math.min(a.x, b.x) <= Math.max(c.x, d.x) &&
    Math.min(c.x, d.x) <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= Math.max(c.y, d.y) &&
    Math.min(c.y, d.y) <= Math.max(a.y, b.y) &&
    cross(a, b, c) * cross(a, b, d) <= 0 &&
    cross(c, d, a) * cross(c, d, b) <= 0
  );
}
function inside(p: Point, polygon: readonly Point[]): boolean {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) yes = !yes;
  }
  return yes;
}
/** A swept road stroke against the actual marquee quadrilateral in map coordinates. */
function strokeIntersects(line: readonly Point[], halfWidth: number, polygon: readonly Point[]): boolean {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i];
    if (inside(a, polygon) || inside(b, polygon)) return true;
    for (let j = 0; j < polygon.length; j++) {
      const c = polygon[j],
        d = polygon[(j + 1) % polygon.length];
      if (
        crossing(a, b, c, d) ||
        Math.min(
          pointSegment(a, c, d),
          pointSegment(b, c, d),
          pointSegment(c, a, b),
          pointSegment(d, a, b),
        ) <= halfWidth
      )
        return true;
    }
  }
  return false;
}
function visibleSpans(line: readonly Point[], town: Town): Point[][] {
  const spans: Point[][] = [];
  let run: Point[] = [];
  const end = () => {
    if (run.length > 1) spans.push(run);
    run = [];
  };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4));
    for (let n = 0; n <= steps; n++) {
      const p = point(a.x + ((b.x - a.x) * n) / steps, a.y + ((b.y - a.y) * n) / steps);
      if (!town.map().revealed(p)) end();
      else if (!run.length || p.x !== run[run.length - 1].x || p.y !== run[run.length - 1].y) run.push(p);
    }
  }
  end();
  return spans;
}
interface RoadSpan {
  id: number;
  line: Point[];
  width: number;
  pass: number;
  order: number;
}

/** Immutable geometry and native handles from one completed Canvas frame. */
export class WorldPicker {
  private ready = false;
  private frame = 0;
  private dpr = 1;
  private candidates: Candidate[] = [];
  private lookup: 'fresh' | 'scanned' | 'indexed' = 'fresh';
  private buckets = new Map<string, number[]>();
  private geometries = new Map<string, WorldHit>();
  private view = new Camera();
  private width = 0;
  private height = 0;
  private sightMap?: ReturnType<Town['map']>;
  private sightValues: number[] = [];
  private sightRevision = 0;
  private knownFeet = new WeakMap<PickSource, { x: number; y: number; revealed: boolean; revision: number }>();
  private roadCache: { town: Town; revision: bigint; sight: number; spans: RoadSpan[] } | null = null;
  constructor(private readonly state: WorldRendererState) {}

  beginFrame(): void {
    this.ready = false;
  }
  invalidate(): void {
    this.ready = false;
    this.candidates = [];
    this.lookup = 'fresh';
    this.buckets.clear();
    this.geometries.clear();
    this.sightMap = undefined;
    this.sightValues.length = 0;
    this.knownFeet = new WeakMap();
    this.roadCache = null;
  }
  presented(town: Town, dpr: number): void {
    const s = this.state;
    this.dpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    this.frame++;
    this.view = new Camera(s.view.x, s.view.y, s.view.zoom);
    this.width = s.viewWidth;
    this.height = s.viewHeight;
    this.candidates = [];
    this.lookup = 'fresh';
    this.buckets.clear();
    this.geometries.clear();
    this.syncExploration(town);
    let rank = 0;
    const layer = (root: SceneNode) => {
      for (const paint of root.children) {
        if (paint instanceof SceneryBatch) {
          const m = s.world.matrix;
          for (const { paint: member, bounds } of paint.members) {
            const source = pickSource(member);
            if (!source) continue;
            const order = rank++;
            if (!this.eligible(town, source, member.alpha, true)) continue;
            const screen = {
              x: bounds.x * m[0] + m[2],
              y: bounds.y * m[4] + m[5],
              w: bounds.w * m[0],
              h: bounds.h * m[4],
            };
            if (overlap(screen, { x: 0, y: 0, w: this.width, h: this.height }))
              this.candidates.push({ hit: null, bounds: screen, rank: order, batch: paint, scenery: source });
          }
          continue;
        }
        const source = pickSource(paint);
        if (source) this.addPaint(town, paint, source, rank++);
      }
    };
    layer(s.farmland);
    layer(s.ornaments);
    rank = this.addRoads(town, rank);
    // This is the exact painter order, including the baseline-overlap tie breaking.
    layer(s.objects);
    this.addGhosts(town, rank);
    this.ready = true;
  }
  selectionGeometry(ref: WorldObjectRef): SelectionGeometry | null {
    const exact = this.geometries.get(worldObjectKey(ref));
    if (exact) return exact.geometry;
    // Legacy cell selections have no instance. An explicit missing tree instance
    // must disappear instead of jumping to the last tree remaining in that cell.
    if (ref.kind === 'tree' || ref.kind === 'rock') {
      for (let i = this.candidates.length - 1; i >= 0; --i) {
        const candidate = this.candidates[i], object = candidate.scenery?.ref ?? candidate.hit;
        if (
          object?.kind === ref.kind && object.id === ref.id &&
          (ref.instanceIndex === undefined || ref.instanceIndex === object.instanceIndex)
        )
          return this.hitOf(candidate)?.geometry ?? null;
      }
    }
    return null;
  }
  /** Ground feedback uses this frame's model metadata, never stale prepared native bounds. */
  groundSelection(
    markers: readonly GroundSelectionMarker[],
    town: Town | null,
  ): ResolvedGroundSelectionMarker[] {
    if (!markers.length) return [];
    const s = this.state,
      requested = new Map(markers.map((marker) => [marker.key, marker])),
      current = new Map<string, ResolvedGroundSelectionMarker>(),
      seen = new Set<string>(),
      screen = (p: Point) => s.view.toScreen(project(p.x, p.y), s.viewWidth, s.viewHeight);
    const resolve = (paint: PaintNode) => {
      const source = pickSource(paint);
      if (!source?.ref) return;
      const ref = source.ref,
        marker =
          requested.get(worldObjectKey(ref)) ??
          (ref.kind === 'tree' ? requested.get(`tree:${ref.id}`) : undefined);
      if (!marker) return;
      seen.add(marker.key);
      if (
        !paint.alpha ||
        !source.body.some((body) => body.alpha > 0) ||
        (town && !this.eligible(town, source, paint.alpha))
      )
        return;
      current.set(marker.key, {
        ...marker,
        geometry: {
          foot: screen(source.foot),
          opacity: paint.alpha,
          groundOutline: source.groundOutline?.map(screen),
          ellipse: source.ellipse
            ? { rx: source.ellipse.rx * s.view.zoom, ry: source.ellipse.ry * s.view.zoom }
            : undefined,
        },
      });
    };
    // Unit selection is the common case (including the title's followed resident).
    // Their retained paints are indexed already; do not inspect every tree and building for each ring.
    let scan = false;
    for (const marker of markers) {
      const unit = marker.kind === 'person' || marker.kind === 'monster' || marker.kind === 'animal';
      if (!unit) {
        if (marker.kind !== 'road') scan = true;
        continue;
      }
      const id = Number(marker.key.slice(marker.key.indexOf(':') + 1)),
        paint = (marker.kind === 'person' ? s.figures : s.beasts).get(id)?.paint;
      if (!paint) scan = true;
      if (paint && s.objects.children.includes(paint)) resolve(paint);
    }
    if (scan)
      for (const layer of [s.farmland, s.ornaments, s.objects])
        for (const paint of layer.children) {
          if (paint instanceof SceneryBatch) for (const member of paint.members) resolve(member.paint);
          else resolve(paint);
        }
    if (town && markers.some((marker) => marker.kind === 'road')) {
      for (const span of this.roadSpans(town)) {
        const key = `road:${span.id}`,
          marker = requested.get(key);
        if (!marker) continue;
        let resolved = current.get(key);
        if (!resolved) {
          resolved = {
            ...marker,
            geometry: { foot: screen(span.line[Math.floor(span.line.length / 2)]), paths: [], opacity: 255 },
          };
          current.set(key, resolved);
        }
        resolved.geometry.paths!.push(span.line.map(screen));
      }
    }
    return markers.flatMap(
      (marker) =>
        current.get(marker.key) ??
        (!town && !seen.has(marker.key) && marker.geometry ? { ...marker, geometry: marker.geometry } : []),
    );
  }
  pick(screen: Point): WorldHit | null {
    if (!this.ready) return null;
    const region = {
      x: Math.floor(screen.x * this.dpr) / this.dpr,
      y: Math.floor(screen.y * this.dpr) / this.dpr,
      w: 1 / this.dpr,
      h: 1 / this.dpr,
    };
    for (const candidate of this.query(region)) if (this.intersects(candidate, region)) return this.hitOf(candidate);
    return null;
  }
  querySelection(region: PickBounds): WorldHit[] {
    if (!this.ready || region.w <= 0 || region.h <= 0) return [];
    const hits = new Map<string, WorldHit>();
    for (const candidate of this.query(region)) {
      if (!candidate.hit && !candidate.scenery?.ref) continue;
      if (candidate.hit && hits.has(candidate.hit.key)) continue;
      if (this.intersects(candidate, region)) {
        const hit = this.hitOf(candidate)!;
        hits.set(hit.key, hit);
      }
    }
    return [...hits.values()];
  }
  private project(p: Point): Point {
    return this.view.toScreen(project(p.x, p.y), this.width, this.height);
  }
  private standBox(foot: Point, stand: Stand): PickBounds {
    const zoom = this.view.zoom;
    return {
      x: foot.x - stand.half * zoom,
      y: foot.y - stand.above * zoom,
      w: 2 * stand.half * zoom,
      h: (stand.above + stand.below) * zoom,
    };
  }
  /** Exact map-coordinate visibility can be reused until any sight circle changes. */
  private syncExploration(town: Town): void {
    const map = town.map(), sights = map.sights(), values = this.sightValues;
    const previousLength = values.length;
    let reset = this.sightMap !== map || previousLength > sights.length * 3;
    for (let i = 0; i < sights.length; i++) {
      const { center, radius } = sights[i], j = i * 3;
      if (values[j] === center.x && values[j + 1] === center.y && values[j + 2] === radius) continue;
      if (j < previousLength) reset = true;
      values[j] = center.x;
      values[j + 1] = center.y;
      values[j + 2] = radius;
    }
    if (reset) this.knownFeet = new WeakMap();
    if (reset || previousLength !== sights.length * 3) this.sightRevision++;
    values.length = sights.length * 3;
    this.sightMap = map;
  }
  private knownFoot(town: Town, source: PickSource): boolean {
    const { x, y } = source.foot;
    const known = this.knownFeet.get(source);
    // Appending a sight can reveal hidden ground. Previously discovered ground stays known.
    if (known && known.x === x && known.y === y && (known.revealed || known.revision === this.sightRevision))
      return known.revealed;
    const revealed = town.map().revealed(source.foot);
    this.knownFeet.set(source, { x, y, revealed, revision: this.sightRevision });
    return revealed;
  }
  private eligible(town: Town, source: PickSource, alpha: number, presenting = false): boolean {
    if (!alpha) return false;
    const ref = source.ref;
    if (ref?.kind === 'landmark' && ref.id === 0) return !!town.map().giant();
    if (ref?.kind === 'person') {
      const p = town.person(ref.id);
      return (
        !!p &&
        p.health > 0 &&
        (p.visibility() > 0 || !!this.state.figures.get(p.id)?.arrival?.rising) &&
        (this.state.sceneView || this.state.currentVisibility.sample(source.foot) >= 119)
      );
    }
    if (ref?.kind === 'monster' || ref?.kind === 'animal') {
      const p = town.creature(ref.id);
      return !!p && p.health > 0 && !p.insideLair && this.state.currentVisibility.sample(p.position) >= 119;
    }
    // With zero or one sight, a direct check costs less than a cache lookup.
    const revealed = presenting && this.sightValues.length > 3
      ? this.knownFoot(town, source)
      : town.map().revealed(source.foot);
    if (!revealed) return false;
    if (ref?.kind === 'tree') {
      const x = ref.id % town.map().width(),
        y = Math.floor(ref.id / town.map().width());
      return town.map().inside(x, y) && (ref.instanceIndex ?? 0) < town.map().at(x, y).trees;
    }
    if (ref?.kind === 'building') return !!town.building(ref.id);
    if (ref?.kind === 'dungeon') return !!town.map().dungeons()[ref.id]?.discovered;
    return true;
  }
  private addPaint(town: Town, paint: PaintNode, source: PickSource, rank: number): void {
    if (!this.eligible(town, source, paint.alpha, true)) return;
    let body = source.body;
    let bounds: PickBounds | null;
    if (body.length === 1) {
      if (!(body[0].alpha > 0)) return;
      bounds = this.state.adapter.renderedBounds(body[0]);
    } else {
      body = body.filter((node) => node.alpha > 0);
      bounds = combine(
        body.map((node) => this.state.adapter.renderedBounds(node)).filter((b): b is PickBounds => !!b),
      );
    }
    if (!bounds) return;
    const screen = {
      x: bounds.x / this.dpr,
      y: bounds.y / this.dpr,
      w: bounds.w / this.dpr,
      h: bounds.h / this.dpr,
    };
    if (!overlap(screen, { x: 0, y: 0, w: this.width, h: this.height })) return;
    this.candidates.push({ hit: this.makeHit(source, screen, rank, paint.alpha), bounds: screen, rank, body });
  }
  /** Distant scenery is immutable. Only a queried member needs its full selection geometry. */
  private hitOf(candidate: Candidate): WorldHit | null {
    if (!candidate.hit && candidate.scenery)
      candidate.hit = this.makeHit(candidate.scenery, candidate.bounds, candidate.rank, 255);
    return candidate.hit;
  }
  private makeHit(source: PickSource, screen: PickBounds, rank: number, alpha: number): WorldHit | null {
    if (!source.ref) return null;
    const geometry: SelectionGeometry = {
      foot: this.project(source.foot),
      bounds: screen,
      labelAnchor: point(screen.x + screen.w / 2, screen.y),
      opacity: alpha,
      ...(source.groundOutline ? { groundOutline: source.groundOutline.map((p) => this.project(p)) } : {}),
      ...(source.ellipse
        ? { ellipse: { rx: source.ellipse.rx * this.view.zoom, ry: source.ellipse.ry * this.view.zoom } }
        : {}),
    };
    if (source.stand) geometry.stand = this.standBox(geometry.foot, source.stand);
    const hit = { ...source.ref, key: worldObjectKey(source.ref), drawRank: rank, frameId: this.frame, geometry };
    this.geometries.set(hit.key, hit);
    return hit;
  }
  /** A unit hidden behind a tree or peak is picked by its ghost, above everything it stands behind. */
  private addGhosts(town: Town, rank: number): void {
    const zoom = this.view.zoom;
    for (const ghost of hiddenUnitGhosts(this.state)) {
      if (!this.eligible(town, { ref: ghost.ref, body: [], foot: ghost.foot }, 255)) continue;
      const parts = ghostAreas(ghost).map((e) => {
          const c = this.view.toScreen(point(e.x, e.y), this.width, this.height);
          return { x: c.x - e.rx * zoom, y: c.y - e.ry * zoom, w: 2 * e.rx * zoom, h: 2 * e.ry * zoom };
        }),
        bounds = combine(parts)!,
        key = worldObjectKey(ghost.ref),
        foot = this.project(ghost.foot),
        hit = this.geometries.get(key) ?? {
          ...ghost.ref,
          key,
          drawRank: rank,
          frameId: this.frame,
          geometry: {
            foot,
            bounds,
            labelAnchor: point(bounds.x + bounds.w / 2, bounds.y),
            stand: this.standBox(foot, { above: ghost.height, below: 3, half: 8 }),
            opacity: 255,
          },
        };
      this.geometries.set(key, hit);
      this.candidates.push({ hit, bounds, rank: rank++, ghost });
    }
  }
  private index(bounds: PickBounds, id: number): void {
    const left = Math.max(0, Math.floor(bounds.x / bucketSize)),
      top = Math.max(0, Math.floor(bounds.y / bucketSize));
    const right = Math.min(
      Math.floor(this.width / bucketSize),
      Math.floor((bounds.x + bounds.w) / bucketSize),
    );
    const bottom = Math.min(
      Math.floor(this.height / bucketSize),
      Math.floor((bounds.y + bounds.h) / bucketSize),
    );
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) {
        const key = `${x}:${y}`,
          bucket = this.buckets.get(key);
        if (bucket) bucket.push(id);
        else this.buckets.set(key, [id]);
      }
  }
  private query(region: PickBounds): Candidate[] {
    // One hover query is common. Build buckets only when more queries can reuse them.
    if (
      this.lookup === 'fresh' && region.x >= 0 && region.y >= 0 &&
      region.x + region.w <= this.width && region.y + region.h <= this.height
    ) {
      this.lookup = 'scanned';
      return this.candidates.filter((c) => overlap(c.bounds, region)).sort((a, b) => b.rank - a.rank);
    }
    if (this.lookup !== 'indexed') {
      this.candidates.forEach((candidate, id) => this.index(candidate.bounds, id));
      this.lookup = 'indexed';
    }
    const ids = new Set<number>();
    const left = Math.max(0, Math.floor(region.x / bucketSize)),
      top = Math.max(0, Math.floor(region.y / bucketSize));
    const right = Math.min(
      Math.floor(this.width / bucketSize),
      Math.floor((region.x + region.w) / bucketSize),
    );
    const bottom = Math.min(
      Math.floor(this.height / bucketSize),
      Math.floor((region.y + region.h) / bucketSize),
    );
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) for (const id of this.buckets.get(`${x}:${y}`) ?? []) ids.add(id);
    return [...ids]
      .map((id) => this.candidates[id])
      .filter((c) => overlap(c.bounds, region))
      .sort((a, b) => b.rank - a.rank);
  }
  private intersects(candidate: Candidate, region: PickBounds): boolean {
    if (candidate.ghost) {
      const corner = this.view.toWorld(point(region.x, region.y), this.width, this.height),
        zoom = this.view.zoom;
      // A couple of screen pixels of slack, so a small ghost is easy to tap.
      return ghostTouches(
        candidate.ghost,
        { x: corner.x, y: corner.y, w: region.w / zoom, h: region.h / zoom },
        2 / zoom,
      );
    }
    if (candidate.road) {
      const world = (x: number, y: number) => {
        const p = this.view.toWorld(point(x, y), this.width, this.height);
        return unproject(p.x, p.y);
      };
      return strokeIntersects(candidate.road.line, candidate.road.halfWidth, [
        world(region.x, region.y),
        world(region.x + region.w, region.y),
        world(region.x + region.w, region.y + region.h),
        world(region.x, region.y + region.h),
      ]);
    }
    if (candidate.batch) {
      // Only this member's part of the shared native outline can answer a marquee.
      const b = candidate.bounds, x = Math.max(region.x, b.x), y = Math.max(region.y, b.y);
      region = {
        x, y,
        w: Math.min(region.x + region.w, b.x + b.w) - x,
        h: Math.min(region.y + region.h, b.y + b.h) - y,
      };
    }
    const x = Math.floor(region.x * this.dpr + 1e-8),
      y = Math.floor(region.y * this.dpr + 1e-8);
    const physical = {
      x,
      y,
      w: Math.max(1, Math.ceil((region.x + region.w) * this.dpr - 1e-8) - x),
      h: Math.max(1, Math.ceil((region.y + region.h) * this.dpr - 1e-8) - y),
    };
    if (candidate.batch) return this.state.adapter.intersectsRendered(candidate.batch, physical);
    return candidate.body?.some((node) => this.state.adapter.intersectsRendered(node, physical)) ?? false;
  }
  private roadSpans(town: Town): RoadSpan[] {
    const revision = town.roadRevision(),
      sight = this.state.exploredVisibility.revision();
    if (
      this.roadCache?.town === town &&
      this.roadCache.revision === revision &&
      this.roadCache.sight === sight
    )
      return this.roadCache.spans;
    const spans: RoadSpan[] = [];
    town
      .roads()
      .roads()
      .forEach((road, order) => {
        const course = wornCourse(road);
        let laid = stretch(course, road.laidEnd(), true);
        if (road.laidEnd() > 0) laid = stretch(laid, road.laidBegin() / road.laidEnd(), false);
        if (road.built <= 0) laid = [];
        const paved = road.paved ? 1 : road.paving >= 0 ? road.paving : 0;
        const append = (line: Point[], width: number, pass: number) => {
          for (const span of visibleSpans(line, town))
            spans.push({ id: road.id, line: span, width, pass, order });
        };
        append(
          road.wear >= 1 ? laid : stretch(laid, paved, false),
          road.wear >= 1 ? 0.4 : 0.46,
          road.wear >= 1 ? 3 : 0,
        );
        if (paved > 0 && road.wear < 1) append(stretch(course, paved, true), 0.5, 1);
        if (road.laidBegin() > 0) append(stretch(course, road.laidBegin(), true), 0.07, 4);
        if (road.laidEnd() < 1) append(stretch(course, road.laidEnd(), false), 0.07, 4);
        // Bridge decks/rails are the final road paint pass, wider than the dirt stroke.
        let bridge: Point[] = [];
        for (let i = 0; i < laid.length; i++) {
          const wet = town.map().terrainAt(laid[i]) === Terrain.Water;
          if (wet && !bridge.length && i) bridge.push(laid[i - 1]);
          if (wet || bridge.length) bridge.push(laid[i]);
          if (!wet && bridge.length > 1) {
            append(bridge, 0.62, 5);
            bridge = [];
          }
        }
        if (bridge.length > 1) append(bridge, 0.62, 5);
      });
    spans.sort((a, b) => a.pass - b.pass || a.order - b.order);
    this.roadCache = { town, revision, sight, spans };
    return spans;
  }
  private addRoads(town: Town, rank: number): number {
    const grouped = new Map<number, { hit: WorldHit; parts: Candidate[] }>();
    for (const span of this.roadSpans(town)) {
      const path = span.line.map((p) => this.project(p)),
        raw = boxOf(path);
      const padX = (span.width * 32 * Math.SQRT2 * this.view.zoom) / 2,
        padY = (span.width * 16 * Math.SQRT2 * this.view.zoom) / 2;
      const bounds = { x: raw.x - padX, y: raw.y - padY, w: raw.w + padX * 2, h: raw.h + padY * 2 };
      const drawRank = rank++;
      if (!overlap(bounds, { x: 0, y: 0, w: this.width, h: this.height })) continue;
      const ref: WorldObjectRef = { kind: 'road', id: span.id };
      let item = grouped.get(span.id);
      if (!item) {
        const geometry: SelectionGeometry = {
          foot: { ...path[Math.floor(path.length / 2)] },
          bounds,
          labelAnchor: point(raw.x + raw.w / 2, raw.y),
          opacity: 255,
          paths: [],
        };
        item = {
          hit: { ...ref, key: worldObjectKey(ref), drawRank, frameId: this.frame, geometry },
          parts: [],
        };
        grouped.set(span.id, item);
      }
      item.hit.drawRank = drawRank;
      item.hit.geometry.paths!.push(path);
      item.parts.push({
        hit: item.hit,
        bounds,
        rank: drawRank,
        road: { line: span.line, halfWidth: span.width / 2 },
      });
    }
    for (const { hit, parts } of grouped.values()) {
      hit.geometry.bounds = combine(parts.map((p) => p.bounds))!;
      hit.geometry.labelAnchor = point(
        hit.geometry.bounds.x + hit.geometry.bounds.w / 2,
        hit.geometry.bounds.y,
      );
      if (hit.geometry.paths!.length === 1) hit.geometry.path = hit.geometry.paths![0];
      this.geometries.set(hit.key, hit);
      for (const part of parts) this.candidates.push(part);
    }
    return rank;
  }
}
