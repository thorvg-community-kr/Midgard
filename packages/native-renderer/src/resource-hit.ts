import { project, type Point } from '../../engine/src/geometry';
import { TreeWorkKind, type TreeWorkEvent } from '../../engine/src/person';
import type { Town } from '../../engine/src/town';
import * as mining from '../../engine/src/mining';
import { treePosition } from '../../engine/src/world-map';
import { SceneNode, identity, type Matrix } from './paint';
import { inFront } from './combat-depth';
import { buildingDust, dustSeconds, harvestDebris, type HarvestDebris } from './harvest-debris';
import { registerDepth, standingRow } from './world-depth';
import { buildingContact } from './work-motion';
import type { WorldRendererState } from './world-renderer-state';

type ResourceKind = 'tree' | 'rock';
interface Resource {
  kind: ResourceKind;
  cell: number;
  index: number;
  foot: Point;
  wind: Matrix;
}
interface Hit extends HarvestDebris {
  at: number;
  foot: Point;
  row: number;
}
interface Reactions {
  town: Town;
  lastSerial: bigint;
  time: number;
  hits: Map<bigint, Hit>;
  touched: Map<SceneNode, Resource>;
}
const resources = new WeakMap<SceneNode, Resource>(),
  reactions = new WeakMap<WorldRendererState, Reactions>();
const duration = (kind: ResourceKind) => (kind === 'tree' ? 0.34 : 0.24);

export function registerResourceHit(
  paint: SceneNode,
  kind: ResourceKind,
  cell: number,
  index: number,
  foot: Point,
): void {
  resources.set(paint, { kind, cell, index, foot: { ...foot }, wind: identity });
}

/** Wind remains the base pose even while the short impact is composed over it. */
export function setResourceWind(paint: SceneNode, matrix: Matrix): void {
  const resource = resources.get(paint);
  if (resource) resource.wind = matrix;
  paint.transform(matrix);
}

export function hasResourceHits(state: WorldRendererState): boolean {
  const current = reactions.get(state);
  return !!current && (current.hits.size > 0 || current.touched.size > 0);
}

export function resetResourceHits(state: WorldRendererState): void {
  const current = reactions.get(state);
  if (!current) return;
  for (const [paint, resource] of current.touched) paint.transform(resource.wind);
  for (const hit of current.hits.values()) state.rows[hit.row]?.remove(hit.paint);
  reactions.delete(state);
}

function inView(state: WorldRendererState, foot: Point): boolean {
  if (state.currentVisibility.sample(foot) < 119) return false;
  const screen = state.view.toScreen(project(foot.x, foot.y), state.viewWidth, state.viewHeight);
  return screen.x >= -64 && screen.x <= state.viewWidth + 64 && screen.y >= -64 && screen.y <= state.viewHeight + 128;
}

function bend(kind: ResourceKind, age: number): number {
  const t = age / duration(kind);
  if (t < 0 || t >= 1) return 0;
  const strike = Math.sin((Math.min(1, age / 0.025) * Math.PI) / 2),
    settle = (1 - t) * (1 - t);
  return (kind === 'tree' ? 0.065 : 0.05) * strike * settle * Math.cos(t * Math.PI * 2);
}

function addDebris(state: WorldRendererState, current: Reactions, event: TreeWorkEvent, foot: Point, row: number, debris: HarvestDebris): void {
  registerDepth(debris.paint, inFront(foot), `resource-hit:${event.serial}`);
  current.hits.set(event.serial, { ...debris, row, foot, at: event.at });
  state.rows[row].add(debris.paint);
}

/** Only real contact events drive the response; the model and harvest cadence are untouched. */
export function updateResourceHits(state: WorldRendererState, town: Town): void {
  const now = town.clock();
  let current = reactions.get(state);
  if (!current || current.town !== town || now < current.time) {
    resetResourceHits(state);
    current = { town, time: now, lastSerial: -1n, hits: new Map(), touched: new Map() };
    reactions.set(state, current);
  }
  current.time = now;
  for (const [paint, resource] of current.touched) paint.transform(resource.wind);
  current.touched.clear();
  const map = town.map(),
    events = town.treeEvents(),
    poses = new Map<SceneNode, { resource: Resource; event: TreeWorkEvent; side: number }>();
  for (const event of events) {
    const wall = event.kind === TreeWorkKind.Hammer ? event.wall : undefined;
    if (!wall && event.kind !== TreeWorkKind.Chop && event.kind !== TreeWorkKind.Mine) continue;
    const age = now - event.at;
    if (age < 0) continue;
    const fresh = event.serial > current.lastSerial;
    if (fresh) current.lastSerial = event.serial;
    const showDebris = fresh && !state.reducedMotion && current.hits.size < 64;
    if (wall) {
      if (!showDebris || age >= dustSeconds || !inView(state, event.worker)) continue;
      const foot = event.worker, row = standingRow(town, foot, state.rows.length);
      if (!state.rows[row]) continue;
      const figure = state.figures.get(event.person),
        side = figure?.facing ?? (project(wall.x - foot.x, wall.y - foot.y).x >= 0 ? 1 : -1),
        base = project(foot.x, foot.y),
        grip = figure && !figure.striding ? buildingContact(figure.parts) : { x: 8, y: -6 },
        at = { x: base.x + side * grip.x, y: base.y + grip.y };
      addDebris(state, current, event, foot, row, buildingDust(at, side, map.seed(), event));
      continue;
    }
    const kind = event.kind === TreeWorkKind.Chop ? 'tree' : 'rock';
    const recoiling = age < duration(kind);
    if (!recoiling && (!fresh || age >= 2 || state.reducedMotion)) continue;
    const x = event.cell % map.width(),
      y = Math.floor(event.cell / map.width()),
      row = x + y;
    if (!map.inside(x, y) || !state.rows[row]) continue;
    let target: { paint: SceneNode; resource: Resource } | undefined;
    for (const paint of state.rowTrees[row]?.children ?? []) {
      if (!(paint instanceof SceneNode)) continue;
      const resource = resources.get(paint);
      if (resource?.kind === kind && resource.cell === event.cell && resource.index === event.index) {
        target = { paint, resource };
        break;
      }
    }
    const terminal = (fresh || !target) && events.some(
      (end) =>
        end.cell === event.cell && end.person === event.person && end.at === event.at &&
        (kind === 'rock' || end.index === event.index) &&
        end.kind === (kind === 'tree' ? TreeWorkKind.Fall : TreeWorkKind.Shatter),
    );
    if (!target && !terminal) continue;
    const foot = target?.resource.foot ?? (kind === 'tree' ? treePosition(map, x, y, event.index) : mining.position(x, y));
    if (!inView(state, foot)) continue;
    const side = project(foot.x, foot.y).x >= project(event.worker.x, event.worker.y).x ? 1 : -1;
    if (target && recoiling) {
      const previous = poses.get(target.paint);
      if (!previous || previous.event.at <= event.at)
        poses.set(target.paint, { resource: target.resource, event, side });
    }
    if (showDebris) {
      const debris = harvestDebris(state, map, town.climate(), event, side, terminal, target?.resource.wind ?? identity);
      if (age < debris.life) addDebris(state, current, event, foot, row, debris);
    }
  }
  for (const [paint, pose] of poses) {
    const k = pose.side * bend(pose.resource.kind, now - pose.event.at),
      base = project(pose.resource.foot.x, pose.resource.foot.y).y,
      wind = pose.resource.wind;
    paint.transform([
      wind[0],
      wind[1] - wind[0] * k,
      wind[2] + wind[0] * k * base,
      wind[3],
      wind[4] - wind[3] * k,
      wind[5] + wind[3] * k * base,
      0,
      0,
      1,
    ]);
    current.touched.set(paint, pose.resource);
  }
  for (const [serial, hit] of current.hits) {
    const age = now - hit.at;
    if (age >= hit.life || state.reducedMotion) {
      state.rows[hit.row]?.remove(hit.paint);
      current.hits.delete(serial);
    } else {
      const alpha = inView(state, hit.foot) ? 255 : 0;
      if (hit.paint.alpha !== alpha) hit.paint.opacity(alpha);
      if (alpha) hit.draw(age);
    }
  }
}
