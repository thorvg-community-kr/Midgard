import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Calling, Monster, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { distance, point, type Point } from '../../packages/engine/src/geometry';
import { RaidKind } from '../../packages/engine/src/raid-progression';
import { CombatCue, MonsterRank } from '../../packages/engine/src/combat-events';

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

describe('surface melee targeting', () => {
  function resident(town: Town, position: Point, calling = Calling.Settler) {
    const person = town.makePerson(Role.Resident, calling, position);
    town.folk.push(person);
    return person;
  }

  function raider(town: Town, position: Point) {
    const beast = new Monster(town.nextMonster++, 0, position);
    beast.home = { ...position };
    beast.raider = true;
    beast.strength = 0.05;
    town.beasts.push(beast);
    return beast;
  }

  function fight(town: Town, seconds: number) {
    const victims: number[] = [];
    for (let tick = 0; tick < Math.round(seconds * 10); ++tick) {
      town.time += 0.1;
      town.stir(0.1);
      for (const hit of town.blows)
        if (hit.at === town.time && hit.onPerson && hit.person >= 0) victims.push(hit.person);
    }
    return victims;
  }

  it('finds a reachable defender when the closest resident is across an impassable river', () => {
    const town = fixture();
    for (let y = 0; y < town.world.rows; ++y)
      for (const x of [30, 31]) town.world.at(x, y).terrain = Terrain.Water;
    ++town.changes;
    town.tick(0);
    raider(town, point(29.9, 18.5));
    const across = resident(town, point(32.2, 18.5));
    const nearBank = resident(town, point(26.5, 18.5));
    const hits = fight(town, 10);
    expect(hits).toContain(nearBank.id);
    expect(hits).not.toContain(across.id);
  });

  it('keeps fighting an accessible opponent when a neighbour edges closer, then replaces a lost target', () => {
    const town = fixture();
    raider(town, point(18, 18));
    const first = resident(town, point(18.42, 18));
    const other = resident(town, point(8, 18));
    expect(fight(town, 2)).toContain(first.id);
    other.position = point(17.64, 18);
    const contestedHits = fight(town, 4);
    expect(new Set(contestedHits)).toEqual(new Set([first.id]));
    first.inside = true;
    expect(fight(town, 3)).toContain(other.id);
  });

  it('obeys a reachable warrior’s taunt while already engaged', () => {
    const town = fixture();
    const beast = raider(town, point(18, 18));
    const first = resident(town, point(18.42, 18));
    const warrior = resident(town, point(16.5, 18), Calling.Warrior);
    expect(fight(town, 2)).toContain(first.id);
    town.combatState.taunts.set(beast.id, { by: warrior.id, until: town.time + 12 });
    const challengedHits = fight(town, 7);
    expect(new Set(challengedHits)).toEqual(new Set([warrior.id]));
  });

  it('keeps challenged raiders off the camp until the warrior’s challenge ends', () => {
    const town = fixture(), camp = town.placed[0];
    const warrior = resident(town, point(36.6, 26), Calling.Warrior);
    town.world.reveal(36, 26, 6);
    for (let i = 0; i < 11; ++i)
      raider(town, point(36.1 - (i % 3) * 0.5, 25.5 + Math.floor(i / 3) * 0.5));
    expect(town.useSkill([warrior.id], 0)).toBe(1);
    expect(fight(town, 4.9)).toContain(warrior.id);
    expect(camp.health).toBe(1);
    fight(town, 8);
    expect(camp.health).toBeLessThan(1);
  });

  it('lets a newly summoned guardian reach slam range when its horde already fills the front', () => {
    const town = fixture();
    resident(town, point(21, 26));
    function defender(position: Point, rank: MonsterRank) {
      const beast = raider(town, position);
      beast.raider = false;
      beast.angry = true;
      beast.brood = beast.id;
      beast.rank = rank;
      return beast;
    }
    for (let i = 0; i < 5; ++i) defender(point(20, 26 + (i - 2) * 0.5), MonsterRank.Swarmer);
    fight(town, 4);
    const guardian = defender(point(24.6, 26), MonsterRank.Guardian);
    for (let tick = 0; tick < 120; ++tick) {
      fight(town, 0.1);
      if (town.events.some(e => e.creature === guardian.id && e.cue === CombatCue.Slam)) return;
    }
    expect.fail('The guardian never reached the defender to land its slam');
  });

  it('splits a packed wave between two defenders who both have room to fight', () => {
    const town = fixture();
    const front = resident(town, point(21, 26));
    const behind = resident(town, point(23.5, 26));
    for (let i = 0; i < 10; ++i)
      raider(town, point(18 - Math.floor(i / 5) * 0.72, 26 + ((i % 5) - 2) * 0.72));
    fight(town, 12);
    const hits = fight(town, 5);
    const onFront = hits.filter(id => id === front.id).length;
    const onRear = hits.filter(id => id === behind.id).length;
    expect(onFront).toBeGreaterThan(0);
    expect(onRear).toBeGreaterThan(0);
    expect(Math.min(onFront, onRear)).toBeGreaterThanOrEqual(Math.max(onFront, onRear) / 2);
  });

  it('sends surplus raiders to their camp objective while the front keeps the defender engaged', () => {
    const town = fixture();
    const defender = resident(town, point(29, 26));
    const camp = town.placed[0];
    for (let i = 0; i < 14; ++i)
      raider(town, point(26 - Math.floor(i / 5) * 0.72, 26 + ((i % 5) - 2) * 0.72));
    fight(town, 24);
    const hits = fight(town, 3);
    expect(hits).toContain(defender.id);
    expect(camp.health).toBeLessThan(1);
    const inContact = town.beasts.filter(beast => distance(defender.position, beast.position) < 0.9);
    expect(inContact.length).toBeGreaterThanOrEqual(3);
    expect(inContact.length).toBeLessThanOrEqual(6);
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
