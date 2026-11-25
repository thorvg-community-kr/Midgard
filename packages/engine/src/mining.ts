// Translated from src/game/mining.h.
import { point, segmentDistance, type Footprint, type Point } from './geometry';
import { hash01, f32 as f } from './numeric';
import { Terrain, isWater } from './world-types';
import type { WorldMap } from './world-map';
import { harvestTiming } from './work-timing';
export const workSeconds = harvestTiming.duration,
  collectSeconds = 0.65,
  stonePerRock = 3;
export const position = (x: number, y: number): Point => point(f(x + f(0.5)), f(y + f(0.55)));
export const size = (map: WorldMap, x: number, y: number): number =>
  map.basaltCell === y * map.width() + x ? 20 : f(6 + f(hash01(map.seed(), x, y, 61) * 7));
const neighbors = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;
export function deposit(map: WorldMap, x: number, y: number): boolean {
  if (!map.inside(x, y)) return false;
  const tile = map.at(x, y);
  if (tile.quarried) return false;
  if (map.basaltCell === y * map.width() + x) return true;
  if (tile.terrain === Terrain.Rock) return hash01(map.seed(), x, y, 60) < f(0.55);
  // Veins are exposed where snow or ash meets another kind of ground. The middle of a lane stays clear.
  if ((tile.terrain !== Terrain.Frost && tile.terrain !== Terrain.Ash) || tile.wild || tile.trees || tile.dungeon >= 0)
    return false;
  if (hash01(map.seed(), x, y, 62) >= (tile.terrain === Terrain.Frost ? 0.24 : 0.16)) return false;
  return neighbors.some(([dx, dy]) => {
    if (!map.inside(x + dx, y + dy)) return false;
    const other = map.at(x + dx, y + dy).terrain;
    return other !== tile.terrain && !isWater(other);
  });
}

/** A staked foundation covers the deposits rooted inside it, including on rotated plots. */
export function coverDeposits(map: WorldMap, plot: Footprint): void {
  const corners = plot.corners();
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  const right = Math.min(map.width() - 1, Math.floor(Math.max(...xs)));
  const bottom = Math.min(map.height() - 1, Math.floor(Math.max(...ys)));
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= bottom; ++y)
    for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= right; ++x)
      if (plot.contains(position(x, y)) && deposit(map, x, y)) map.at(x, y).quarried = true;
}

/** Clear ordinary stone piles rooted within the surveyed road, including bends and end caps. */
export function coverRoadDeposits(map: WorldMap, line: readonly Point[], halfWidth: number): void {
  for (let i = 1; i < line.length; ++i) {
    const a = line[i - 1], b = line[i];
    const left = Math.max(0, Math.floor(Math.min(a.x, b.x) - halfWidth));
    const right = Math.min(map.width() - 1, Math.floor(Math.max(a.x, b.x) + halfWidth));
    const top = Math.max(0, Math.floor(Math.min(a.y, b.y) - halfWidth));
    const bottom = Math.min(map.height() - 1, Math.floor(Math.max(a.y, b.y) + halfWidth));
    for (let y = top; y <= bottom; ++y) {
      for (let x = left; x <= right; ++x) {
        const tile = map.at(x, y);
        if (tile.terrain === Terrain.Rock && y * map.width() + x !== map.basaltCell &&
            deposit(map, x, y) && segmentDistance(position(x, y), a, b) <= halfWidth)
          tile.quarried = true;
      }
    }
  }
}
