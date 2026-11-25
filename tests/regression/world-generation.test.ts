import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WorldMap } from '../../packages/engine/src/world-map';
import { World, DungeonKind, Terrain } from '../../packages/engine/src/world-types';
import { WalkGrid } from '../../packages/engine/src/walk-paths';
import { RoadNetwork } from '../../packages/engine/src/road-network';
import { distance, normalized, point, sub } from '../../packages/engine/src/geometry';

const digest = (map: WorldMap) => createHash('sha256').update(JSON.stringify(map)).digest('hex');
// Complete maps catch divergence between scheduled generation and immediate new games.
const worlds = [
  [5, 64, '5e528db76d072770abe01f4b8f5a5f4ae1d28d49832aa5b18f2e0f443656abfe'],
  [11, 96, '1c39ae445782fc5534f968f91c705f7792d1dd4c2157865538a6360d8e12ba49'],
  [5, 176, 'efb7effc05b00a79e97013922bf1c56f27b5b21500aa63b52a30057ea0f153e2'],
  [4294967295, 64, 'aa5107e985b164ec7a66f120c91ece602796474050bc37ed1103019108da18d1'],
  // On this small map the founders can already see the slopes of Fire Mountain.
  [0, 32, 'dd7e6e2274243c062b2282dcbd2338a16d9128d8cd323425c38a48a876ba099d'],
] as const;
describe('cooperative world generation', () => {
  it.each(worlds)('preserves every field of seed %s on a %s tile map', (seed, size, expected) => {
    expect(digest(WorldMap.generate(seed, size, size))).toBe(expected);
  });
  it('yields to other work, then gives each caller an independent map', async () => {
    let turns = 0;
    const heartbeat = setInterval(() => ++turns, 0);
    try {
      await WorldMap.prepare(5, 64, 64);
      const map = WorldMap.generate(5, 64, 64);
      expect(turns).toBeGreaterThan(0);
      expect(digest(map)).toBe(worlds[0][2]);
      map.at(0, 0).trees = 123;
      expect(digest(WorldMap.generate(5, 64, 64))).toBe(worlds[0][2]);
    } finally {
      clearInterval(heartbeat);
    }
  });
});

describe('the sheltered founding shore', () => {
  it('turns the saddles inland where the coast hooks around the camp on seed 18', () => {
    const map = WorldMap.generate(18), grid = new WalkGrid();
    grid.rebuild(map, new RoadNetwork());
    for (const [entry, exit] of [
      [point(105.9, 64.7), point(111.3, 71.9)],
      [point(100.2, 66.5), point(99.8, 75.5)],
    ]) {
      expect(grid.path(map.camp(), entry).length).toBeGreaterThan(0);
      expect(grid.clear(entry, exit, Infinity)).toBe(true);
      expect(grid.walkable(exit)).toBe(true);
    }
  });
  // Seed 6 has high ground across a pass. On seed 8, a lake runs up against the back of the rim.
  it.each([1, 5, 6, 8, 11])('leaves passes through the ridges and one nearby hostile cave on seed %i', (seed) => {
    const map = WorldMap.generate(seed), camp = map.camp(), grid = new WalkGrid();
    grid.rebuild(map, new RoadNetwork());
    const hostile = map.dungeons().filter(site => site.kind !== DungeonKind.GiantHall);
    const halls = map.dungeons().filter(site => site.kind === DungeonKind.GiantHall);
    const range = (site: (typeof hostile)[number]) => distance(camp, point(site.origin.x + 1, site.origin.y + 1));
    expect(hostile).toHaveLength(8);
    expect(hostile.filter(site => range(site) <= 18)).toEqual([hostile[0]]);
    expect(hostile[0].kind).toBe(DungeonKind.Cave);
    expect(map.destination(hostile[0])).toBe(World.Jotunheim);
    expect(range(hostile[0])).toBeLessThanOrEqual(11.5);
    expect(hostile.slice(1).every(site => range(site) >= 38)).toBe(true);
    expect(halls).toHaveLength(2);
    expect(range(halls[1])).toBeGreaterThan(range(halls[0]));
    for (const site of map.dungeons()) {
      const door = point(site.origin.x + 1, site.origin.y + 2.3);
      expect(grid.path(camp, door).length, site.name).toBeGreaterThan(0);
    }

    // The rear crest lies inland of the cave. Both shoulders curve back to the shore.
    const inland = normalized(sub(camp, map.giant()!.center()));
    const beside = (side: number, forward: number) =>
      point(camp.x + inland.x * forward - inland.y * side, camp.y + inland.y * forward + inland.x * side);
    const peaks = (left: number, right: number, near: number, far: number): number => {
      let count = 0;
      for (let f = near; f <= far; ++f) for (let s = left; s <= right; ++s)
        if (map.cell(beside(s, f))?.terrain === Terrain.Mountain) ++count;
      return count;
    };
    expect(peaks(-5, 5, 0, 7)).toBe(0);
    expect(peaks(-3, 3, 12, 18)).toBeGreaterThan(10);
    for (const side of [-1, 1]) {
      expect(peaks(side < 0 ? -18 : 6, side < 0 ? -6 : 18, 1, 8)).toBeGreaterThan(12);
      // A pass accommodates several rays side by side from the basin through the rim.
      let run = 0, widest = 0;
      for (let i = 3; i < 30; ++i) {
        const angle = side * i * .04;
        const inner = beside(9 * Math.sin(angle), 9 * Math.cos(angle));
        const outer = beside(18 * Math.sin(angle), 18 * Math.cos(angle));
        const clear = grid.walkable(inner) && grid.walkable(outer) &&
          grid.clear(inner, outer, Infinity) && grid.path(camp, inner).length > 0;
        run = clear ? run + 1 : 0;
        widest = Math.max(run, widest);
      }
      expect(widest).toBeGreaterThanOrEqual(4);
    }
  });
});
