import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Monster } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { distance, point } from '../../packages/engine/src/geometry';

/** Open grass with a camp to the south-east and a long pond in the raider's way: the way round is by its south end. */
function fixture() {
  const size = 48,
    map = new WorldMap();
  map.columns = map.rows = size;
  map.mapSeed = 5;
  map.origin = { x: 40, y: 26 };
  map.tiles = Array.from({ length: size * size }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  for (let y = 10; y <= 20; ++y) for (const x of [30, 31]) map.tiles[y * size + x].terrain = Terrain.Water;
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(97 * 97).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [{ name: 'Raid source', kind: DungeonKind.Cave, origin: { x: 6, y: 6 }, discovered: true }];
  const town = new Town(map, size, false);
  town.placed.push(new Building(0, Structure.Camp, point(40, 26), 0, 0));
  town.nextId = 1;
  town.migrateSettlements();
  town.folk = [];
  town.editHour(12);
  town.wildlifeDay = town.days;
  town.tick(0);
  return town;
}

describe('a raider pressed against a blocked cell', () => {
  it('slides round the corner instead of standing there for the rest of the raid', () => {
    const town = fixture(),
      // The last sliver of open ground west of the pond's south end: the first step toward the camp clips its corner.
      start = point(29.9998, 20.9017);
    expect(town.grid.walkable(start)).toBe(true);
    expect(town.grid.walkable(point(30.5, 20.5))).toBe(false);
    const raider = new Monster(town.nextMonster++, 0, { ...start });
    raider.home = { ...start };
    raider.health = raider.vigor = 100;
    raider.raider = true;
    town.beasts.push(raider);
    for (let i = 0; i < 60; ++i) {
      town.wildlifeDay = town.days;
      town.advance(0.1);
    }
    expect(distance(raider.position, start)).toBeGreaterThan(3);
  });
});
