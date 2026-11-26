import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { makeTile, Terrain, Layer } from '../../packages/engine/src/world-types';
import { AnimalKind, Activity, Calling, Monster, Person, Race, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Product, Resources, Structure } from '../../packages/engine/src/building-catalog';
import { point, type Point } from '../../packages/engine/src/geometry';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { TownState } from '../../packages/engine/src/town-state';
import {
  addInventory,
  attackReach,
  bareHandsRate,
  carryBonus,
  itemCatalog,
  itemSpec,
  stoneRate,
  woodenRate,
  workEfficiency,
  workItem,
} from '../../packages/engine/src/equipment';
import { gearEffect } from '../../packages/engine/src/gear-stats';
import {
  burdenFrom,
  burdenPace,
  burdenStart,
  carryCapacity,
  carryLimit,
  stowCargo,
} from '../../packages/engine/src/carried-resources';
import { CropStage, fieldWork } from '../../packages/engine/src/farm-work';
import { animalSpec } from '../../packages/engine/src/wildlife';
import { StrikeKind, strikeOf } from '../../packages/engine/src/skill-catalog';
import { recipeGroup, stationRecipes, type RecipeGroup } from '../../apps/web/src/native/craft-station-hud';
import { levelVariant } from '../../packages/engine/src/craft-stations';
import * as mining from '../../packages/engine/src/mining';

function fixture(size = 48) {
  const map = new WorldMap();
  map.columns = map.rows = size;
  map.mapSeed = 5;
  map.origin = point(12, 12);
  map.tiles = Array.from({ length: size * size }, () => ({
    ...makeTile(),
    terrain: Terrain.Grass,
    revealed: true,
  }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array((size * 2 + 1) ** 2).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [];
  map.reveal(size / 2, size / 2, size * 2);
  const town = new Town(map, size, false),
    camp = new Building(0, Structure.Camp, point(12, 12), 0, 0),
    bench = new Building(1, Structure.Workbench, point(9, 15), 0, 0);
  camp.village = bench.village = 0;
  town.placed = [camp, bench];
  town.nextId = 2;
  town.migrateSettlements();
  const p = new Person(0, 'Asa', Role.Resident, Calling.Settler, Race.Human, 5, camp.door());
  p.home = p.village = 0;
  p.autoMode = false;
  p.food = p.rest = p.health = p.hydration = 1;
  p.stress = 0;
  p.level = 3;
  town.folk = [p];
  town.nextPerson = 1;
  town.animals = [];
  town.beasts = [];
  town.editHour(9);
  town.wildlifeDay = town.days;
  town.changes++;
  town.tick(0);
  town.orderStop([0]);
  return { town, p, camp, bench };
}
function hold(town: Town, p: Person, ids: readonly string[]): void {
  for (const id of ids) {
    expect(addInventory(p, id), id).toBe(true);
    const slot = p.inventory.findIndex(
      (s, i) => s?.item === id && !Object.values(p.equipment).includes(i + 1),
    );
    expect(town.equipItem(p.id, slot + 1), id).toBe(true);
  }
}
const step = (town: Town, dt = 0.05) => {
  town.wildlifeDay = town.days;
  town.advance(dt);
};
const tools = (id: string | null): string[] => (id ? id.split('+') : []);

/** Seconds from the first blow to a tree's or a load's wood or stone in hand. */
function harvestTime(tool: string | null, stone: boolean): number {
  const { town, p } = fixture(32),
    map = town.map();
  let cell = 18 * map.width() + 15;
  if (!stone) map.at(15, 18).trees = 1;
  else {
    cell = -1;
    for (let x = 20; x < 26 && cell < 0; ++x) {
      map.at(x, 22).terrain = Terrain.Rock;
      if (mining.deposit(map, x, 22)) cell = 22 * map.width() + x;
    }
  }
  hold(town, p, tools(tool));
  expect(stone ? town.orderMine([0], cell) : town.orderChop([0], cell)).toBe(true);
  const working = stone ? Activity.Mining : Activity.Felling;
  for (let i = 0; i < 2000 && (p.activity !== working || p.moving()); ++i) step(town);
  const started = town.clock();
  for (let i = 0; i < 2000 && !p.carrying; ++i) step(town);
  expect(p.carrying).toBe(3);
  return town.clock() - started;
}
/** Seconds to raise a tent whose materials are on site. */
function buildTime(tool: string | null): number {
  const { town, p, camp } = fixture(32);
  hold(town, p, tools(tool));
  expect(town.place(Structure.Tent, point(camp.center.x - 5, camp.center.y + 4), 0)).toBe(true);
  const tent = town.buildings().at(-1)!;
  tent.materials.delivered = tent.materials.required.clone();
  expect(town.orderBuild([0], tent.id)).toBe(true);
  for (let i = 0; i < 4000 && (p.activity !== Activity.Building || p.moving()); ++i) step(town);
  const started = town.clock();
  for (let i = 0; i < 8000 && !tent.built(); ++i) step(town);
  expect(tent.built()).toBe(true);
  return town.clock() - started;
}
/** Seconds of road work to lay an 8-tile road whose materials are already on it. */
function roadTime(tool: string | null): number {
  const { town, p } = fixture(32);
  Object.assign(town.stock(), new Resources(100, 100, 100, 100, 100, 100));
  hold(town, p, tools(tool));
  const path = [sharpAnchor(point(13.2, 12)), sharpAnchor(point(21, 12))];
  expect(town.buildRoad(path)).toBe(true);
  const road = town.roads().roads()[0];
  road.materials.delivered = road.materials.required.clone();
  expect(town.orderRoadwork([p.id], road.id)).toBe(true);
  let worked = 0;
  for (let i = 0; i < 20000 && road.built < 1; ++i) {
    const before = road.built;
    step(town);
    if (road.built > before) worked += 0.05;
  }
  expect(road.built).toBe(1);
  return worked;
}
/** A farm, its hand and a 12-acre plot; `tilled` breaks it in beforehand. */
function farmFixture(tool: string | null, tilled: boolean, summer: boolean) {
  const { town, p } = fixture(64);
  if (summer) {
    town.days = TownState.daysPerMonth * 4;
    town.editHour(9);
    town.wildlifeDay = town.days;
  }
  const farm = new Building(town.nextId++, Structure.Farm, point(16, 12), 0, 0);
  farm.village = 0;
  town.placed.push(farm);
  town.migrateSettlements();
  p.position = point(15, 13);
  p.job = farm.id;
  p.autoMode = true;
  farm.workers = 1;
  hold(town, p, tools(tool));
  expect(town.plantField([point(17.5, 13), point(21.5, 13), point(21.5, 16), point(17.5, 16)])).toBe(true);
  const field = town.fields()[0];
  if (tilled) field.tilled = 1;
  return { town, p, farm, field };
}
/** Seconds of field work to break in the plot. */
function tillTime(tool: string | null): number {
  const { town, p, field } = farmFixture(tool, false, false);
  let started = -1;
  for (let i = 0; i < 20000 && field.tilled < 1; ++i) {
    step(town);
    if (started < 0 && p.workField === field.id && p.activity === Activity.Working && !p.moving())
      started = town.clock();
  }
  expect(field.tilled).toBe(1);
  return town.clock() - started;
}
/** Field work a farmhand puts toward the harvest per second at a tilled plot, over a minute. */
function tendRate(tool: string | null, harvesting: boolean): number {
  const { town, p, farm, field } = farmFixture(tool, true, false);
  field.cropProgress = harvesting ? CropStage.Harvesting : CropStage.Sowing;
  for (
    let i = 0;
    i < 4000 && !(p.workField === field.id && p.activity === Activity.Working && !p.moving());
    ++i
  )
    step(town);
  const before = farm.workedSeconds,
    started = town.clock();
  for (let i = 0; i < 1200; ++i) step(town);
  return (farm.workedSeconds - before) / (town.clock() - started);
}
function report(name: string, rows: Record<string, number>) {
  console.log(
    name +
      ': ' +
      Object.entries(rows)
        .map(([k, v]) => `${k} ${v.toFixed(2)}`)
        .join(', '),
  );
}

describe('a tool line reads wood, stone, iron', () => {
  it('puts a stone make of each main tool between wood and iron, made at the bench from wood and stone', () => {
    for (const [stone, wood, iron] of [
      ['stone-axe', 'wooden-axe', 'axe'],
      ['stone-pick', 'wooden-pick', 'pickaxe'],
      ['stone-hammer', 'wooden-mallet', 'hammer'],
      ['stone-hoe', 'wooden-hoe', 'hoe'],
    ]) {
      const s = itemSpec(stone)!,
        w = itemSpec(wood)!,
        i = itemSpec(iron)!;
      expect(s.material).toBe('stone');
      expect(s.workshop).toBe(Structure.Workbench);
      expect(s.cost.gold).toBe(0);
      expect(s.cost.stone).toBeGreaterThan(0);
      expect(s.visual).toBe(w.visual);
      expect(s.work).toEqual(w.work);
      expect([w.rate, s.rate, i.rate]).toEqual([woodenRate, stoneRate, bareHandsRate * 1.75]);
      expect(w.attackBonus).toBeLessThanOrEqual(s.attackBonus);
      expect(s.attackBonus).toBeLessThan(i.attackBonus);
    }
  });
  it('fells a tree', () => {
    const [bare, wood, stone, iron] = [null, 'wooden-axe', 'stone-axe', 'axe'].map((t) =>
      harvestTime(t, false),
    );
    report('felling s', { bare, wood, stone, iron });
    expect(stone).toBeLessThan(wood * 0.9);
    expect(iron).toBeLessThan(stone * 0.9);
    expect(stone).toBeCloseTo(6 / stoneRate, 0);
  });
  it('breaks a load of stone', () => {
    const [bare, wood, stone, iron] = [null, 'wooden-pick', 'stone-pick', 'pickaxe'].map((t) =>
      harvestTime(t, true),
    );
    report('mining s', { bare, wood, stone, iron });
    expect(wood).toBeCloseTo(bare / 1.25, 0);
    expect(stone).toBeLessThan(wood * 0.9);
    expect(iron).toBeLessThan(stone * 0.9);
  });
  it('raises a building', () => {
    const [bare, wood, stone, iron] = [null, 'wooden-mallet', 'stone-hammer', 'hammer'].map(buildTime);
    report('tent s', { bare, wood, stone, iron });
    expect(stone).toBeLessThan(wood * 0.9);
    expect(iron).toBeLessThan(stone * 0.95);
  });
  it('breaks in a field', () => {
    const [bare, wood, stone, iron] = [null, 'wooden-hoe', 'stone-hoe', 'hoe'].map(tillTime);
    report('tilling s', { bare, wood, stone, iron });
    expect(stone).toBeLessThan(wood * 0.9);
    expect(iron).toBeLessThan(stone * 0.95);
  });
});

describe('the shovel lays roads and breaks in fields', () => {
  it('lays a road at the same efficiency as a hammer of its make', () => {
    const times = Object.fromEntries(
      [null, 'wooden-mallet', 'wooden-shovel', 'hammer', 'shovel', 'hammer+wooden-shovel'].map((t) => [
        t ?? 'bare',
        roadTime(t),
      ]),
    );
    report('road s', times);
    expect(times['wooden-shovel']).toBeCloseTo(times['wooden-mallet'], 2);
    expect(times.shovel).toBeCloseTo(times.hammer, 2);
    expect(times.shovel).toBeLessThan(times['wooden-shovel'] * 0.8);
    // The hammer's road pace is set by its own rate, as before the shovel existed.
    expect(times.hammer).toBeCloseTo(times.bare / 1.75, 0);
    // With both in hand the better tool does the work, and nothing gets slower.
    expect(times['hammer+wooden-shovel']).toBeLessThanOrEqual(times.hammer + 0.1);
  });
  it('shows the shovel in hand on the road, not on a building', () => {
    const { town, p } = fixture(32);
    hold(town, p, ['hammer', 'shovel']);
    p.activity = Activity.Roadwork;
    expect(workItem(p, 'construction')?.id).toBe('shovel');
    p.activity = Activity.Building;
    expect(workItem(p, 'construction')?.id).toBe('hammer');
    expect(workEfficiency(p, 'construction') / bareHandsRate).toBeCloseTo(1.75);
  });
  it('breaks in a field at the same efficiency as a hoe of its make', () => {
    const times = Object.fromEntries(
      [null, 'wooden-hoe', 'wooden-shovel', 'hoe', 'shovel', 'hoe+wooden-shovel'].map((t) => [
        t ?? 'bare',
        tillTime(t),
      ]),
    );
    report('tilling s', times);
    expect(times['wooden-shovel']).toBeCloseTo(times['wooden-hoe'], 2);
    expect(times.shovel).toBeCloseTo(times.hoe, 2);
    expect(times['hoe+wooden-shovel']).toBeLessThanOrEqual(times.hoe + 0.2);
  });
});

describe('the sickle tends the standing crop', () => {
  it('speeds up harvest work and leaves sowing to the hoe', () => {
    const harvest = Object.fromEntries(
      [null, 'stone-hoe', 'hoe', 'flint-sickle', 'sickle', 'hoe+sickle'].map((t) => [
        t ?? 'bare',
        tendRate(t, true),
      ]),
    );
    const sow = {
      bare: tendRate(null, false),
      sickle: tendRate('sickle', false),
      hoe: tendRate('hoe', false),
    };
    report('harvest field work per s', harvest);
    report('sow field work per s', sow);
    expect(harvest['flint-sickle']).toBeCloseTo(harvest['stone-hoe'], 2);
    expect(harvest.sickle).toBeGreaterThan(harvest['flint-sickle'] * 1.05);
    expect(harvest['hoe+sickle']).toBeCloseTo(harvest.sickle, 2);
    expect(sow.sickle).toBeCloseTo(sow.bare, 2);
    expect(sow.hoe).toBeCloseTo(harvest.hoe, 2);
  });
  it('names the kinds of field work a farmhand’s tools count for', () => {
    const { town, p, field } = farmFixture(null, false, true);
    p.workField = field.id;
    expect(fieldWork(town, p)).toEqual(['digging', 'farming']);
    field.tilled = 1;
    expect(fieldWork(town, p)).toEqual(['farming']);
    field.cropProgress = CropStage.Watering;
    expect(fieldWork(town, p)).toEqual(['watering']);
    field.cropProgress = CropStage.Harvesting;
    expect(fieldWork(town, p)).toEqual(['reaping', 'farming']);
  });
});

describe('the hunting knife', () => {
  function hunt(knife: boolean, kind = AnimalKind.Cow) {
    const { town, p } = fixture(32);
    if (knife) hold(town, p, ['hunting-knife']);
    const animal = new Monster(town.nextMonster++, -1, point(16, 16));
    animal.animal = kind;
    animal.home = point(16, 16);
    animal.health = 0;
    animal.provokedBy = p.id;
    town.animals.push(animal);
    p.hunting = true;
    p.foe = animal.id;
    p.food = 1;
    const bones = town.stock().bones;
    step(town);
    return { food: p.carrying, bones: town.stock().bones - bones };
  }
  it('brings more food and bones home from a kill', () => {
    for (const kind of [AnimalKind.Cow, AnimalKind.Pig, AnimalKind.Chicken]) {
      const bare = hunt(false, kind),
        knife = hunt(true, kind);
      report(`${animalSpec(kind).name} food/bones`, {
        food: bare.food,
        bones: bare.bones,
        knifeFood: knife.food,
        knifeBones: knife.bones,
      });
      expect(bare.food).toBe(animalSpec(kind).food);
      expect(knife.food).toBe(Math.round(animalSpec(kind).food * 1.5));
      expect(knife.bones).toBeGreaterThan(bare.bones);
    }
  });
});

describe('the pack basket', () => {
  it('raises this resident’s carry and slowing marks, leaving everyone else’s numbers as they were', () => {
    const { town, p } = fixture(32);
    expect([carryLimit(p), burdenFrom(p), carryCapacity, burdenStart]).toEqual([30, 15, 30, 15]);
    // 25 kg of wood in the pack.
    expect(addInventory(p, 'wood', 20)).toBe(true);
    expect(addInventory(p, 'wood', 5)).toBe(true);
    const bare = burdenPace(p);
    hold(town, p, ['pack-basket']);
    expect(carryBonus(p)).toBe(15);
    expect([carryLimit(p), burdenFrom(p)]).toEqual([45, 30]);
    const basket = burdenPace(p);
    report('pace at 25 kg', { bare, basket });
    expect(bare).toBeLessThan(0.75);
    expect(basket).toBe(1);
    // 8 more kg in hand: past 30 kg only the basket still takes it into the pack.
    p.carriedProduct = Product.Wood;
    p.carrying = 8;
    expect(stowCargo(p)).toBe(true);
    expect(town.unequipItem(p.id, 'accessory')).toBe(true);
    p.carriedProduct = Product.Wood;
    p.carrying = 3;
    expect(stowCargo(p)).toBe(false);
  });
  it('walks a load faster than a resident without one', () => {
    const walk = (basket: boolean) => {
      const { town, p } = fixture(32);
      if (basket) hold(town, p, ['pack-basket']);
      expect(addInventory(p, 'stone', 20)).toBe(true);
      expect(addInventory(p, 'stone', 6)).toBe(true);
      p.position = point(8, 20);
      town.orderMove([p.id], point(24, 20));
      expect(p.moving()).toBe(true);
      const started = town.clock();
      for (let i = 0; i < 4000 && (p.moving() || p.activity === Activity.Moving); ++i) step(town);
      return town.clock() - started;
    };
    const bare = walk(false),
      basket = walk(true);
    report('16-tile walk with 26 kg, s', { bare, basket });
    expect(basket).toBeLessThan(bare * 0.85);
  });
});

describe('the spear', () => {
  function fight(weapon: string | null) {
    const { town, p } = fixture(32);
    town.roll = () => 0.99;
    p.level = 5;
    if (weapon) {
      p.inventory[0] = { item: weapon, quantity: 1 };
      p.equipment.weapon = 1;
    }
    const foe = (at: Point) => {
      const m = new Monster(town.nextMonster++, 0, at);
      m.home = { ...at };
      m.health = m.vigor = 100;
      m.angry = true;
      m.ready = town.clock() + 1000;
      town.beasts.push(m);
      return m;
    };
    p.position = point(20, 20);
    const target = foe(point(21.2, 20)),
      behind = foe(point(22.2, 20.1)),
      blow = town.blowStrength(p);
    town.strike(p, target);
    return { target: 100 - target.health, behind: 100 - behind.health, blow, reach: attackReach(p) };
  }
  it('reaches farther than a sword and hits only its target', () => {
    expect(strikeOf('spear').kind).toBe(StrikeKind.Single);
    const sword = fight('sword'),
      spear = fight('spear'),
      wooden = fight('wooden-spear'),
      bare = fight(null);
    report('spear', {
      swordReach: sword.reach,
      spearReach: spear.reach,
      swordBehind: sword.behind,
      spearBehind: spear.behind,
    });
    expect(spear.reach).toBeGreaterThan(sword.reach);
    expect(wooden.reach).toBe(spear.reach);
    expect(sword.behind).toBe(0);
    expect(bare.behind).toBe(0);
    expect(spear.behind).toBe(0);
    expect(wooden.behind).toBe(0);
    expect(wooden.target).toBeGreaterThan(bare.target);
    expect(spear.target).toBeGreaterThan(wooden.target);
  });
});

describe('the station lists', () => {
  it('lists one row a kind, the make the next order gives, and nothing that waits for a level', () => {
    const { town, p, bench } = fixture(),
      smith = new Building(town.nextId++, Structure.Weaponsmith, point(18, 12), 0, 0),
      armorer = new Building(town.nextId++, Structure.Armorer, point(24, 18), 0, 0);
    smith.village = armorer.village = 0;
    town.placed.push(smith, armorer);
    const ids = (station: Building, group: RecipeGroup) => stationRecipes(town, station).get(group)?.map((i) => i.id) ?? [];
    // A first bench and smithy and a resident with nothing: the first make of each kind that level 1 opens.
    p.level = 1;
    expect([...stationRecipes(town, bench).keys()]).toEqual(['Tools', 'Gear']);
    expect(ids(bench, 'Tools')).toEqual(['wooden-axe', 'wooden-pick', 'wooden-mallet', 'wooden-hoe', 'wooden-shovel']);
    expect(ids(bench, 'Gear')).toEqual(['pack-basket']);
    expect([...stationRecipes(town, smith).keys()]).toEqual(['Weapons', 'Shields', 'Armor', 'Gear']);
    expect(ids(smith, 'Gear')).toEqual(['boots']);
    expect(ids(smith, 'Weapons')).toEqual(['wooden-sword', 'wooden-club']);
    for (const [i, kind] of [Structure.Watchtower, Structure.TrainingYard, Structure.MageTower].entries()) {
      const school = new Building(town.nextId++, kind, point(28, 12 + 4 * i), 0, 0);
      school.village = 0;
      town.placed.push(school);
    }
    expect(ids(smith, 'Weapons')).toEqual(['wooden-sword', 'wooden-club', 'short-bow', 'wooden-spear', 'wooden-staff']);
    expect(ids(smith, 'Shields')).toEqual(['shield']);
    expect(ids(smith, 'Armor')).toEqual(['wooden-armor']);
    // What is carried keeps its row until the station can better it; then the row is the next make.
    addInventory(p, 'wooden-axe');
    addInventory(p, 'wooden-sword');
    expect(ids(bench, 'Tools')[0]).toBe('wooden-axe');
    bench.variant = smith.variant = levelVariant(2);
    expect(ids(bench, 'Tools')).toEqual(['stone-axe', 'wooden-pick', 'wooden-mallet', 'wooden-hoe', 'wooden-shovel', 'flint-sickle']);
    expect(ids(bench, 'Gear')).toEqual(['hunting-knife', 'pack-basket']);
    // The flint sword is for level 3: until then the row keeps the wooden one.
    expect(ids(smith, 'Weapons')[0]).toBe('wooden-sword');
    p.level = 3;
    expect(ids(smith, 'Weapons')[0]).toBe('flint-sword');
    // Iron comes one make at a time: the bench at its top still offers stone for a wooden axe.
    bench.variant = smith.variant = levelVariant(3);
    expect(ids(bench, 'Tools')).toEqual([
      'stone-axe',
      'wooden-pick',
      'wooden-mallet',
      'wooden-hoe',
      'wooden-shovel',
      'flint-sickle',
      'watering-can',
      'saw',
    ]);
    expect(ids(smith, 'Armor')).toEqual(['wooden-armor', 'helmet']);
    // The armorer makes nothing now: old ones become smithies when a save loads.
    expect([...stationRecipes(town, armorer).keys()]).toEqual([]);
    for (const item of itemCatalog.filter((i) => i.workshop !== null)) {
      expect(['Tools', 'Weapons', 'Shields', 'Armor', 'Gear', 'Materials']).toContain(recipeGroup(item));
      expect(gearEffect(item), item.id).not.toBe('');
      expect(item.seconds, item.id).toBeGreaterThan(0);
    }
  });
});
