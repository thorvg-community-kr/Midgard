import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Calling, Monster, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { distance, point } from '../../packages/engine/src/geometry';
import { RaidKind } from '../../packages/engine/src/raid-progression';

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
  it('marches in a broad front, funnels through a pass, and spreads on the far side', () => {
    const town = fixture();
    for (const tile of town.world.tiles) tile.terrain = Terrain.Grass;
    for (let y = 0; y < town.world.rows; y++)
      if (y !== 18) town.world.at(22, y).terrain = Terrain.Mountain;
    town.open[0] = 1;
    town.days = 21;
    town.raidCount = 8;
    town.editHour(12);
    ++town.changes;
    town.tick(0);
    let searches = 0, longSearches = 0;
    const originalPath = town.grid.path.bind(town.grid);
    town.grid.path = (from, to, ...rest) => {
      ++searches;
      if (distance(from, to) >= 15) ++longSearches;
      return originalPath(from, to, ...rest);
    };
    town.summonRaid(RaidKind.Horde, [0]);
    const pack = town.monsters().filter(m => m.raider);
    expect(pack.length).toBeGreaterThanOrEqual(30);
    expect(longSearches).toBe(1);
    const musterSearches = searches;
    const crossings = [14, 22.5, 32].map(x => ({ x, byId: new Map<number, number>() }));
    for (let i = 0; i < 500 && crossings[2].byId.size < pack.length; ++i) {
      town.time += 0.1;
      const before = pack.map(m => m.position);
      town.stir(0.1);
      for (let n = 0; n < pack.length; ++n) {
        const { id, position } = pack[n];
        expect(town.grid.walkable(position)).toBe(true);
        for (const { x, byId } of crossings)
          if (!byId.has(id) && before[n].x < x && position.x >= x) byId.set(id, position.y);
      }
    }
    for (const section of crossings) expect(section.byId.size).toBe(pack.length);
    const widths = crossings.map(({ byId }) => Math.max(...byId.values()) - Math.min(...byId.values()));
    expect(widths[0]).toBeGreaterThan(3);
    expect(widths[1]).toBeLessThan(1);
    expect(widths[2]).toBeGreaterThan(3);
    // Walking the established routes, including the pass, does not demand fresh pathfinding every tick.
    expect(searches - musterSearches).toBeLessThan(pack.length * 2);
  });
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

describe('surface pursuit', () => {
  it.each(['shore', 'ridge', 'building'] as const)('keeps raiders on walkable ground while chasing a resident around a %s', (obstacle) => {
    const town = fixture(), start = point(28.5, 19.5), target = point(34, 19.5);
    for (let y = 10; y <= 20; ++y)
      for (const x of [30, 31])
        town.world.at(x,y).terrain = obstacle === 'shore' ? Terrain.Water : obstacle === 'ridge' ? Terrain.Mountain : Terrain.Grass;
    if (obstacle === 'building') town.placed.push(new Building(town.nextId++, Structure.Camp, point(31, 19.5), 0, 0));
    ++town.changes;
    town.tick(0);
    const resident = town.makePerson(Role.Resident, Calling.Settler, target);
    town.folk.push(resident);
    const beast = new Monster(town.nextMonster++, 0, start);
    beast.home = { ...start };
    beast.health = beast.vigor = 50;
    beast.raider = true;
    town.beasts.push(beast);
    expect(town.grid.clear(start, target, Infinity, true)).toBe(false);
    let searches = 0;
    const originalPath = town.grid.path.bind(town.grid);
    town.grid.path = (...args) => { ++searches; return originalPath(...args); };
    for (let i = 0; i < 180 && resident.health >= 1; ++i) {
      const from = { ...beast.position };
      town.time += .1;
      town.stir(.1);
      expect(town.grid.clear(from, beast.position, Infinity, true)).toBe(true);
    }
    expect(resident.health).toBeLessThan(1);
    expect(searches).toBeLessThan(8);
  });
  it.each(['building', 'ridge corner'] as const)('keeps a wandering dungeon defender out of a %s after losing sight of its prey', (obstacle) => {
    const town = fixture();
    const start = obstacle === 'building' ? point(25.5, 19.5) : point(29.99, 20.98);
    const goal = obstacle === 'building' ? point(34, 19.5) : point(30.03, 21.01);
    if (obstacle === 'building')
      town.placed.push(new Building(town.nextId++, Structure.Workbench, point(27, 19.5), 0, 0));
    else town.world.at(30, 20).terrain = Terrain.Mountain;
    ++town.changes;
    town.tick(0);
    const outdoors = new Monster(town.nextMonster++, 0, start, [goal]);
    outdoors.home = start;
    outdoors.brood = 42;
    town.beasts.push(outdoors);
    expect(town.grid.walkable(start)).toBe(true);
    expect(town.grid.walkable(goal)).toBe(true);
    expect(town.grid.clear(start, goal, Infinity, true)).toBe(false);
    for (let i = 0; i < 70; ++i) {
      const from = { ...outdoors.position };
      town.time += .1;
      town.stir(.1);
      expect(town.grid.clear(from, outdoors.position, Infinity, true)).toBe(true);
    }
  });
  it('paces failed searches when the settlement and its residents are on an unreachable shore', () => {
    const town = fixture();
    for (let y = 0; y < town.world.height(); ++y) for (const x of [30, 31]) town.world.at(x, y).terrain = Terrain.Water;
    ++town.changes;
    town.tick(0);
    const start = point(29.95, 18.5), resident = town.makePerson(Role.Resident, Calling.Settler, point(33, 18.5));
    town.folk.push(resident);
    const beast = new Monster(town.nextMonster++, 0, start);
    beast.home = start;
    beast.raider = true;
    town.beasts.push(beast);
    let framesWithSearch = 0;
    let searched = false;
    const path = town.grid.path.bind(town.grid);
    town.grid.path = (...args) => { searched = true; return path(...args); };
    for (let i = 0; i < 30; ++i) {
      searched = false;
      town.time += .1;
      town.stir(.1);
      if (searched) ++framesWithSearch;
    }
    expect(framesWithSearch).toBeLessThan(8);
    expect(town.grid.walkable(beast.position)).toBe(true);
    expect(resident.health).toBe(1);
  });

});
