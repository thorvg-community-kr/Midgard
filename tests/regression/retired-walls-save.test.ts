import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { Structure } from '../../packages/engine/src/building-catalog';
import { point } from '../../packages/engine/src/geometry';
import { Activity } from '../../packages/engine/src/person';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { Town } from '../../packages/engine/src/town';
import type { WorldMap } from '../../packages/engine/src/world-map';

// Captured with the v25 writer. The camp and workbench precede the walls in the archive.
const original = gunzipSync(readFileSync(new URL('./fixtures/retired-walls-v25.goldfantasy.gz', import.meta.url))).toString();
const restore = (text: string) => decodeTown(text, (map: WorldMap) => new Town(map, 32, false, true));

it('retires finished, unfinished and damaged sections without disturbing the fortified camp or its road', () => {
  let town = restore(original);
  for (let load = 0; load < 2; ++load) {
    expect(town.placed.map(b => [b.id, b.kind])).toEqual([[0, Structure.Palisade], [1, Structure.Workbench]]);
    expect(town.nextId).toBe(6);
    expect(town.grid.walkable(point(8, 8))).toBe(false);
    expect(town.grid.walkable(point(12, 8))).toBe(false);
    expect(town.grid.clear(point(13.5, 12.5), point(17.5, 12.5), Infinity)).toBe(true);
    expect(town.network.road(2)).toMatchObject({ village: 0, built: .5 });
    // The stone repair had received four stones. Its original construction cost was three.
    expect(town.stock(0)).toMatchObject({ wood: 12, stone: 19 });
    expect(town.provisions.stock.wood).toBe(4);
    town = restore(encodeTown(town));
  }
});

it('releases crews and raiders while preserving cargo, resting residents and matching road or monster IDs', () => {
  const town = restore(original);
  const person = (name: string) => town.folk.find(p => p.name === name);
  for (const name of ['Builder', 'Repairer']) {
    expect(person(name)).toMatchObject({
      task: Activity.Idle, taskSite: -1, activity: Activity.Idle, target: -1,
      supplyTarget: -1, ordered: false, approachingOrder: false, autoMode: true, path: [],
    });
  }
  expect(person('Builder')?.carrying).toBe(1);
  expect(person('Resting builder')).toMatchObject({ task: Activity.Idle, activity: Activity.Sleeping, target: 0, inside: true });
  expect(person('Road worker')).toMatchObject({
    task: Activity.Roadwork, taskSite: 2, activity: Activity.Roadwork, target: 2,
    ordered: true, autoMode: false, supplyRoad: true, supplyTarget: 2, path: [point(12, 13)],
  });
  expect(person('Road supplier')).toMatchObject({
    task: Activity.Roadwork, taskSite: 2, activity: Activity.Idle, target: -1,
    ordered: true, autoMode: false, supplyRoad: true, supplyTarget: 2, path: [],
  });
  expect(person('Fighter')).toMatchObject({ task: Activity.Fighting, taskSite: 2, target: 2, foe: 2, ordered: true });
  expect(town.creature(2)).toMatchObject({ raider: true, prey: -1, path: [] });
});
