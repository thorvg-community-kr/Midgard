import { distance, lerp, point, segmentDistance, type Point } from './geometry';
import type { RealmPlan } from './realm-layout';
import type { WorldMap } from './world-map';
import { Terrain, World } from './world-types';

export interface RealmPassage {
  snow: boolean;
  room: number;
  from: Point;
  to: Point;
  middle: Point;
  horizontal: boolean;
  shelf?: [Point, Point];
}

/** Cut through a wall between neighboring rooms, keeping the original corridors as the safe route. */
export function planPassage(plan: RealmPlan, world: World, denRooms: number[]): RealmPassage | undefined {
  const snow = world === World.Niflheim || world === World.Jotunheim;
  if (!snow && world !== World.Muspelheim) return;
  const { area, chambers } = plan, cell = (area.size - 8) / (area.size >= 40 ? 3 : 2);
  let start = 0, room = chambers[0].links.find((i) => denRooms.includes(i)) ?? chambers[0].links[0], best = -Infinity;
  for (const target of denRooms) {
    const b = chambers[target];
    for (const source of [0, ...denRooms]) {
      if (source === target || b.links.includes(source)) continue;
      const a = chambers[source], span = distance(a.center, b.center), mid = lerp(a.center, b.center, 0.5);
      if (span > cell * 1.6) continue;
      const existingLane = chambers.some((c, i) => distance(c.center, mid) <= c.radius + 1 ||
        c.links.some((j) => j > i && segmentDistance(mid, c.center, chambers[j].center) < 2.4));
      if (existingLane) continue;
      // Prefer a thin wall into a far den over a diagonal across two rooms.
      const score = distance(chambers[0].center, b.center) - span * 3;
      if (score > best) { start = source; room = target; best = score; }
    }
  }
  const from = chambers[start].center, to = chambers[room].center, mid = lerp(from, to, 0.5);
  const middle = point(Math.floor(mid.x) + 0.5, Math.floor(mid.y) + 0.5);
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const space = horizontal ? area.y + area.size / 2 - mid.y : area.x + area.size / 2 - mid.x;
  const offset = (space >= 0 ? 1 : -1) * Math.min(5.5, distance(from, to) * 0.53);
  const bend = (t: number) => {
    const p = lerp(from, to, t);
    return point(p.x + (horizontal ? 0 : offset), p.y + (horizontal ? offset : 0));
  };
  const path: RealmPassage = { snow, room, from, to, middle, horizontal };
  // Even a two-room floor gets a safe way around its crossing.
  if (best === -Infinity) path.shelf = [bend(0.22), bend(0.78)];
  return path;
}

export function passageGap(path: RealmPassage, p: Point): number {
  const { from, to, middle } = path;
  // One tile across at the basalt face. Mining that tile opens the passage in either direction.
  const neck = Math.abs(path.horizontal ? p.x - middle.x : p.y - middle.y) < 1;
  const width = path.snow ? 1.25 : neck ? 0.48 : 0.95;
  const gap = Math.min(segmentDistance(p, from, middle), segmentDistance(p, middle, to)) - width;
  if (!path.shelf) return gap;
  const [a, b] = path.shelf;
  return Math.min(gap, Math.min(segmentDistance(p, from, a), segmentDistance(p, a, b), segmentDistance(p, b, to)) - 1.45);
}

export function inDrift(path: RealmPassage, p: Point): boolean {
  const { from, middle, to } = path;
  const along = Math.abs(path.horizontal ? p.x - middle.x : p.y - middle.y);
  return path.snow && along <= Math.abs(path.horizontal ? to.x - from.x : to.y - from.y) * 0.23 &&
    Math.min(segmentDistance(p, from, middle), segmentDistance(p, middle, to)) <= 1.6;
}

/** The saved map already contains its terrain and quarry marks. Restore only the cells with special footing. */
export function markPassage(map: WorldMap, plan: RealmPlan): void {
  const path = plan.passage;
  if (!path) { map.passageCells = undefined; return; }
  const deepSnow = new Set<number>();
  map.passageCells = { deepSnow, basaltCell: -1 };
  if (!path.snow) {
    map.passageCells.basaltCell = Math.floor(path.middle.y) * map.width() + Math.floor(path.middle.x);
    return;
  }
  for (let y = Math.floor(Math.min(path.from.y, path.to.y)) - 2; y <= Math.ceil(Math.max(path.from.y, path.to.y)) + 2; ++y)
    for (let x = Math.floor(Math.min(path.from.x, path.to.x)) - 2; x <= Math.ceil(Math.max(path.from.x, path.to.x)) + 2; ++x) {
      const p = point(x + 0.5, y + 0.5);
      if (inDrift(path, p) && map.cell(p)?.terrain === Terrain.Ice) deepSnow.add(y * map.width() + x);
    }
}
