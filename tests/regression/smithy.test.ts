import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Rect } from '../../packages/native-ui/src';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { makeTile, Terrain, Layer } from '../../packages/engine/src/world-types';
import { Person, Role, Calling, Race, Activity, Monster } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure, structureSpec } from '../../packages/engine/src/building-catalog';
import { point } from '../../packages/engine/src/geometry';
import {
  addInventory,
  armorProtection,
  combatItem,
  itemCatalog,
  itemSpec,
  raisedShield,
  madeFrom,
  upgradeCost,
  upperTier,
  workEfficiency,
  workItem,
} from '../../packages/engine/src/equipment';
import { levelVariant, stationLevel, stationStep } from '../../packages/engine/src/craft-stations';
import { craftOrder, upgradeOrder } from '../../packages/engine/src/craft-orders';
import { monsterBite } from '../../packages/engine/src/town-monsters';
import { CombatCue } from '../../packages/engine/src/combat-events';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';
import { digest } from '../../packages/engine/src/save-archive';
import { GameAppState } from '../../apps/web/src/native/game-app-state';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';
import { inspector } from '../../apps/web/src/native/game-hud';
import { craftBars, freshMake, recipeOffer } from '../../apps/web/src/native/craft-station-hud';

// The workbench makes tools and the smithy weapons, shields and armor; both rise in levels, and gear rises in makes.
function fixture() {
  const size = 32,
    map = new WorldMap();
  map.columns = map.rows = size;
  map.mapSeed = 5;
  map.origin = point(12, 12);
  map.tiles = Array.from({ length: size * size }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array((size * 2 + 1) ** 2).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [];
  map.reveal(size / 2, size / 2, size * 2);
  const town = new Town(map, size, false),
    camp = new Building(0, Structure.Camp, point(12, 12), 0, 0),
    smith = new Building(1, Structure.Weaponsmith, point(18, 12), 0, levelVariant(1)),
    bench = new Building(2, Structure.Workbench, point(9, 15), 0, levelVariant(1));
  camp.village = smith.village = bench.village = 0;
  town.placed = [camp, smith, bench];
  town.nextId = 3;
  town.migrateSettlements();
  const folk = ['Asa', 'Bryn', 'Dag'].map((name, i) => {
    const p = new Person(i, name, Role.Resident, Calling.Settler, Race.Human, 5 + i, point(12 + i, 13));
    p.home = p.village = 0;
    p.autoMode = false;
    p.food = p.rest = p.health = p.hydration = 1;
    p.stress = 0;
    return p;
  });
  town.folk = folk;
  town.nextPerson = folk.length;
  town.animals = [];
  town.beasts = [];
  town.editHour(9);
  town.wildlifeDay = town.days;
  town.changes++;
  town.tick(0);
  town.orderStop(folk.map((p) => p.id));
  return { town, camp, smith, bench, a: folk[0], b: folk[1], c: folk[2] };
}
const step = (town: Town, seconds = 0.05) => {
  town.wildlifeDay = town.days;
  town.advance(seconds);
};
const run = (town: Town, p: Person, limit = 4000) => {
  for (let i = 0; i < limit && p.craftItem; ++i) step(town);
};
const holdIn = (town: Town, p: Person, id: string, slot: 'weapon' | 'offhand' | 'body') => {
  expect(addInventory(p, id)).toBe(true);
  return town.equipItem(p.id, p.inventory.findIndex((s) => s?.item === id) + 1, slot);
};

it('takes an upgrade with empty stores, gathers the raw materials and resumes it after saving', () => {
  const { town, a, bench } = fixture(), stock = town.stock();
  stock.wood = stock.stone = 0;
  for (let y = 16; y < 20; y++) for (let x = 10; x < 16; x++) {
    const t = town.map().at(x, y);
    if (x < 13) t.trees = 1;
    else { t.terrain = Terrain.Rock; t.quarried = false; }
  }
  town.changes++; town.tick(0);
  expect(town.orderStationUpgrade(a.id, bench.id)).toBe(true);
  expect([Activity.Felling, Activity.Mining]).toContain(a.activity);
  const loaded = decodeTown(encodeTown(town), map => new Town(map, 32, false)), crafter = loaded.person(a.id)!;
  const seen = new Set<Activity>();
  for (let i = 0; i < 5000 && crafter.craftItem; i++) { seen.add(crafter.activity); step(loaded, .1); }
  for (const act of [Activity.Felling, Activity.Mining, Activity.Crafting]) expect(seen.has(act), Activity[act]).toBe(true);
  expect(stationLevel(loaded.building(bench.id)!)).toBe(2);
  expect(crafter.craftItem).toBeNull();
});

it('works the sawmill and stoneworks to supply a station upgrade', () => {
  const { town, a, smith, bench } = fixture();
  bench.variant = smith.variant = levelVariant(2);
  for (const [kind, x] of [[Structure.Sawmill, 19], [Structure.Stoneworks, 23]] as const) {
    const b = new Building(town.nextId++, kind, point(x, 18), 0, 0);
    b.village = 0;
    town.placed.push(b);
  }
  while (town.folk.length < 8) {
    const p = town.makePerson(Role.Resident, Calling.Settler, point(12, 14));
    p.home = p.village = 0;
    town.folk.push(p); town.orderStop([p.id]);
  }
  Object.assign(town.stock(), { gold: 200, wood: 12, stone: 8, planks: 0, cutStone: 0, food: 30, water: 30 });
  town.changes++; town.tick(0);
  expect(town.orderStationUpgrade(a.id, bench.id), town.stationUpgradeReason(a.id, bench.id)).toBe(true);
  const worked = new Set<Structure>();
  for (let i = 0; i < 12500 && a.craftItem; i++) {
    if (a.activity === Activity.Working && !a.moving()) worked.add(town.building(a.target)!.kind);
    step(town, .1);
  }
  expect([...worked], `order ${a.craftItem}, planks ${town.stock().planks}, cut stone ${town.stock().cutStone}`).toEqual([Structure.Sawmill, Structure.Stoneworks]);
  expect(stationLevel(bench)).toBe(3);
  expect(town.stock()).toMatchObject({ wood: 0, stone: 0, planks: 0, cutStone: 0 });
});

describe('what each station level makes', () => {
  it.each([
    [Structure.TrainingYard, 'wooden-spear'],
    [Structure.Watchtower, 'short-bow'],
    [Structure.MageTower, 'wooden-staff'],
  ] as const)('a finished school opens its weapon family without a worker (%s)', (kind, id) => {
    const { town, smith, a } = fixture();
    town.stock().wood = 20;
    const school = new Building(town.nextId++, kind, point(24, 18), 0, 0);
    school.village = 0;
    school.faction = 1;
    town.placed.push(school);
    expect(town.craftReason(a.id, smith.id, id)).toBe('Complete ' + structureSpec(kind).name);
    school.faction = 0;
    school.progress = 0.9;
    expect(town.craftOffers(smith.id).some(o => o.item.id === id)).toBe(false);
    expect(town.orderCraft(a.id, smith.id, id)).toBe(false);
    school.progress = 1;
    expect(town.craftOffers(smith.id).find(o => o.item.id === id)).toMatchObject({ open: true, reason: '' });
    expect(town.orderSettlementCraft(smith.id, id)).toBe(true);
    const smithWorker = town.folk.find(p => p.craftItem === id)!;
    run(town, smithWorker);
    expect(smithWorker.inventory.some(stack => stack?.item === id)).toBe(true);
  });
  it('keeps the materials when the last school is lost during a weapon order', () => {
    const { town, smith, a } = fixture(),
      tower = new Building(town.nextId++, Structure.Watchtower, point(24, 18), 0, 0);
    town.placed.push(tower);
    town.stock().wood = 20;
    expect(town.orderCraft(a.id, smith.id, 'short-bow')).toBe(true);
    for (let i = 0; i < 500 && !a.craftProgress; ++i) step(town);
    expect(a.craftProgress).toBeGreaterThan(0);
    tower.faction = 1;
    step(town);
    expect(a.craftItem).toBeNull();
    expect(a.inventory.some(stack => stack?.item === 'short-bow')).toBe(false);
    expect(town.stock().wood).toBe(20);
  });
  it('opens wood at level 1, stone at 2 and iron at 3, and says which level a locked recipe needs', () => {
    const { town, smith, bench, a } = fixture();
    for (const [i, school] of [Structure.TrainingYard, Structure.Watchtower, Structure.MageTower].entries())
      town.placed.push(new Building(town.nextId++, school, point(24, 18 + 3 * i), 0, 0));
    Object.assign(town.stock(), new Resources(100, 100, 100, 0, 0, 0, 50, 50));
    Object.assign(town.stock(), { hides: 5, ironIngot: 5, embersteel: 5, boundFrostwood: 5 });
    a.level = 7;
    for (const item of itemCatalog.filter((i) => i.workshop === Structure.Workbench || i.workshop === Structure.Weaponsmith)) {
      const station = item.workshop === Structure.Workbench ? bench : smith,
        name = structureSpec(station.kind).name.toLowerCase(),
        below = madeFrom(item);
      // A better make is made from the one below it.
      a.inventory.fill(null);
      if (below) addInventory(a, below.id);
      for (const level of [1, 2, 3]) {
        station.variant = levelVariant(level);
        expect(stationLevel(station)).toBe(level);
        expect(town.craftReason(a.id, station.id, item.id), `${item.id} at ${level}`).toBe(
          level >= item.stationLevel ? '' : `Needs a level ${item.stationLevel} ${name}`,
        );
      }
    }
    // Nothing that is a weapon, shield or armor is made at the bench.
    for (const item of itemCatalog.filter((i) => i.workshop === Structure.Workbench))
      expect(item.category === 'tool' || item.visual === 'basket', item.id).toBe(true);
  });
  it('raises a station at its doorstep, paid only when done, with a new look and a notice', () => {
    const { town, bench, a } = fixture();
    Object.assign(town.stock(), new Resources(0, 30, 30));
    const before = town.stock().clone(),
      next = stationStep(Structure.Workbench, 2)!;
    expect(town.stationUpgradeReason(a.id, bench.id)).toBe('');
    expect(town.orderStationUpgrade(a.id, bench.id)).toBe(true);
    expect(craftOrder(a.craftItem)).toEqual({ kind: 'station', level: 2 });
    for (let i = 0; i < 4000 && a.craftProgress < next.seconds / 2; ++i) step(town);
    expect(town.stock()).toEqual(before);
    expect(town.orderName(a)).toBe('Workbench level 2');
    // Called off half way: nothing spent, the bench as it was.
    expect(town.cancelCraft(a.id)).toBe(true);
    expect(town.stock()).toEqual(before);
    expect(stationLevel(bench)).toBe(1);
    expect(town.orderStationUpgrade(a.id, bench.id)).toBe(true);
    run(town, a);
    expect(stationLevel(bench)).toBe(2);
    expect(bench.replaced).toEqual([{ kind: Structure.Workbench, variant: levelVariant(1), dx: 0, dy: 0 }]);
    expect(town.stock().wood).toBe(before.wood - next.cost.wood);
    expect(town.stock().stone).toBe(before.stone - next.cost.stone);
    expect(town.notices.at(-1)).toBe('Asa raised the workbench to level 2');
    addInventory(a, 'wooden-axe');
    expect(town.craftReason(a.id, bench.id, 'stone-axe')).toBe('');
  });
  it('asks the settlement for more before the higher levels, and says what first', () => {
    const { town, smith, bench, a } = fixture();
    Object.assign(town.stock(), new Resources(100, 100, 100, 0, 0, 0, 50, 50));
    expect(town.stationUpgradeReason(a.id, smith.id)).toBe('Complete Quarry');
    const quarry = new Building(town.nextId++, Structure.Quarry, point(24, 22), 0, 0);
    quarry.village = 0;
    town.placed.push(quarry);
    expect(town.stationUpgradeReason(a.id, smith.id)).toBe('Needs 4 residents');
    town.folk.push(town.makePerson(Role.Resident, Calling.Settler, point(14, 14)));
    expect(town.stationUpgradeReason(a.id, smith.id)).toBe('');
    smith.variant = levelVariant(2);
    expect(town.stationNeeds(smith.id).map((r) => r.text)).toEqual([
      'Complete Sawmill',
      'Complete Stoneworks',
      'Clear a floor beyond a gate',
      'Needs 8 residents',
    ]);
    // The bench's iron level waits for a smithy that works stone.
    bench.variant = levelVariant(2);
    smith.variant = levelVariant(1);
    expect(town.stationNeeds(bench.id).find((r) => !r.done)?.text).toBe('Complete Sawmill');
    expect(town.stationNeeds(bench.id).map((r) => r.text)).toContain('Needs a level 2 smithy');
    bench.variant = levelVariant(3);
    expect(town.stationUpgradeReason(a.id, bench.id)).toBe('Already at the highest level');
  });
  it('keeps the ground in front of a station clear, where its crafter works', () => {
    const { town, bench } = fixture();
    const door = bench.door(),
      out = { x: door.x - bench.center.x, y: door.y - bench.center.y },
      len = Math.hypot(out.x, out.y),
      front = point(door.x + (out.x / len) * 0.6, door.y + (out.y / len) * 0.6);
    expect(town.canPlace(Structure.Tent, front, 0).reason).toBe('Blocks a door');
  });
  it('lets only one resident raise a station at a time', () => {
    const { town, bench, a, b } = fixture();
    Object.assign(town.stock(), new Resources(0, 30, 30));
    expect(town.orderStationUpgrade(a.id, bench.id)).toBe(true);
    expect(town.stationUpgradeReason(b.id, bench.id)).toBe('Someone is already upgrading it');
  });
});

describe('upgrading an item', () => {
  it('turns a resident’s wooden weapon into the stone one for less, in the same hand', () => {
    const { town, smith, a } = fixture();
    smith.variant = levelVariant(2);
    a.level = 3;
    Object.assign(town.stock(), new Resources(0, 20, 20));
    // The stone make is never made new: it is the wooden one, upgraded.
    expect(town.craftReason(a.id, smith.id, 'flint-sword')).toBe('Made by upgrading a wooden sword');
    expect(town.orderCraft(a.id, smith.id, 'flint-sword')).toBe(false);
    expect(holdIn(town, a, 'wooden-sword', 'weapon')).toBe(true);
    const cost = upgradeCost(itemSpec('flint-sword')!);
    expect(cost.wood + cost.stone).toBeLessThan(itemSpec('flint-sword')!.cost.wood + itemSpec('flint-sword')!.cost.stone);
    const before = town.stock().clone();
    expect(town.orderCraft(a.id, smith.id, 'flint-sword')).toBe(true);
    expect(a.craftItem).toBe(upgradeOrder('flint-sword'));
    for (let i = 0; i < 4000 && a.craftProgress < 1; ++i) step(town);
    expect(town.cancelCraft(a.id)).toBe(true);
    expect(town.stock()).toEqual(before);
    expect(a.inventory[0]?.item).toBe('wooden-sword');
    expect(town.orderCraft(a.id, smith.id, 'flint-sword')).toBe(true);
    run(town, a);
    expect(a.inventory.filter(Boolean)).toEqual([{ item: 'flint-sword', quantity: 1 }]);
    expect(combatItem(a)?.id).toBe('flint-sword');
    expect(town.stock().wood).toBe(before.wood - cost.wood);
    expect(town.stock().stone).toBe(before.stone - cost.stone);
    expect(town.notices.at(-1)).toBe('Asa upgraded the Wooden sword to the Flint sword');
  });
  it('upgrades one step at a time, needs the station’s level, and waits until its owner can use the better make', () => {
    const { town, smith, bench, a } = fixture();
    town.placed.push(new Building(town.nextId++, Structure.TrainingYard, point(24, 18), 0, 0));
    Object.assign(town.stock(), new Resources(50, 50, 50), { ironIngot: 2 });
    expect(upperTier(itemSpec('wooden-shovel')!)?.id).toBe('shovel');
    expect(upperTier(itemSpec('sword')!)?.id).toBe('embersteel-sword');
    addInventory(a, 'wooden-axe');
    expect(town.craftReason(a.id, bench.id, 'stone-axe')).toBe('Needs a level 2 workbench');
    bench.variant = levelVariant(3);
    // Iron comes from stone, not from wood.
    expect(town.craftReason(a.id, bench.id, 'axe')).toBe('Made by upgrading a stone axe');
    expect(town.craftReason(a.id, bench.id, 'stone-axe')).toBe('');
    a.level = 1;
    expect(holdIn(town, a, 'flint-spear', 'weapon')).toBe(false);
    smith.variant = levelVariant(3);
    a.inventory = a.inventory.map(() => null);
    a.level = 3;
    expect(holdIn(town, a, 'flint-spear', 'weapon')).toBe(true);
    // The iron spear is for level 5: upgrading now would leave its owner empty-handed.
    expect(town.craftReason(a.id, smith.id, 'spear')).toBe('Needs level 5');
    expect(town.orderCraft(a.id, smith.id, 'spear')).toBe(false);
    a.level = 5;
    expect(town.orderCraft(a.id, smith.id, 'spear')).toBe(true);
    run(town, a);
    expect(a.inventory[0]?.item).toBe('spear');
    expect(combatItem(a)?.id).toBe('spear');
    expect(town.chronicle.weaponsForged).toBe(1);
  });
});

describe('shields and armor', () => {
  it('raises a shield only beside a one-handed weapon', () => {
    const { town, a } = fixture();
    a.level = 5;
    expect(holdIn(town, a, 'shield', 'offhand')).toBe(true);
    expect(raisedShield(a)?.id).toBe('shield');
    expect(holdIn(town, a, 'wooden-sword', 'weapon')).toBe(true);
    expect(raisedShield(a)?.id).toBe('shield');
    // A spear takes both hands: the shield goes back to the pack.
    expect(holdIn(town, a, 'wooden-spear', 'weapon')).toBe(true);
    expect(a.equipment.offhand).toBe(-1);
    expect(a.inventory.some((s) => s?.item === 'shield')).toBe(true);
    const shield = a.inventory.findIndex((s) => s?.item === 'shield') + 1;
    expect(town.equipItem(a.id, shield, 'offhand')).toBe(false);
    for (const id of ['short-bow', 'wooden-staff', 'spear', 'longbow'])
      expect(itemSpec(id)!.hands, id).toBe(2);
    for (const id of ['wooden-sword', 'wooden-club', 'mace', 'iron-mace']) expect(itemSpec(id)!.hands, id).toBe(1);
  });
  it('turns aside a share of blows with a "Block", the better make more often', () => {
    const blocked = (id: string) => {
      const { town, a } = fixture();
      a.level = 5;
      holdIn(town, a, id, 'offhand');
      const foe = new Monster(0, -1, point(a.position.x + 0.5, a.position.y));
      let count = 0,
        cue = false;
      for (let i = 0; i < 2000; ++i) {
        a.health = 1;
        town.blows = [];
        monsterBite(town, foe, a, { bite: 0.01, pause: 1 } as never);
        if (town.blows.some((hit) => hit.blocked)) ++count;
        cue ||= town.combatEvents().some((e) => e.cue === CombatCue.Block);
      }
      expect(cue).toBe(true);
      return count / 2000;
    };
    const wood = blocked('shield'),
      stone = blocked('reinforced-shield'),
      iron = blocked('iron-shield');
    expect(wood).toBeCloseTo(itemSpec('shield')!.block, 1);
    expect(wood).toBeLessThan(stone);
    expect(stone).toBeLessThan(iron);
  });
  it('takes part of every blow with armor, more for the better make, and weighs more', () => {
    const { town, a } = fixture();
    a.level = 5;
    const worn = ['wooden-armor', 'studded-armor', 'mail-armor'].map((id) => {
      a.inventory = a.inventory.map(() => null);
      a.equipment.body = -1;
      expect(holdIn(town, a, id, 'body')).toBe(true);
      return { cut: armorProtection(a), weight: itemSpec(id)!.weight };
    });
    expect(worn[0].cut).toBeGreaterThan(0);
    expect(worn[0].cut).toBeLessThan(worn[1].cut);
    expect(worn[1].cut).toBeLessThan(worn[2].cut);
    expect(worn[0].weight).toBeLessThan(worn[2].weight);
  });
});

describe('tools from the pack', () => {
  it('speeds work with a tool anywhere in the pack, the best of several, while a weapon waits for a hand', () => {
    const { a } = fixture();
    expect(workEfficiency(a, 'woodcutting')).toBe(0.4);
    addInventory(a, 'wooden-axe');
    expect(workItem(a, 'woodcutting')?.id).toBe('wooden-axe');
    addInventory(a, 'axe');
    addInventory(a, 'stone-axe');
    expect(workItem(a, 'woodcutting')?.id).toBe('axe');
    expect(workEfficiency(a, 'woodcutting')).toBeCloseTo(0.4 * 1.75);
    addInventory(a, 'stone-pick');
    expect(workItem(a, 'mining')?.id).toBe('stone-pick');
    // A sword in the pack is not in hand: the hardest-hitting tool is what the resident fights with.
    a.level = 5;
    addInventory(a, 'sword');
    expect(combatItem(a)?.id).toBe('axe');
  });
});

describe('saving station levels', () => {
  it('writes version 19 once a smithy stands and keeps levels and an upgrade order', () => {
    const { town, smith, bench, a } = fixture();
    smith.variant = levelVariant(2);
    bench.variant = levelVariant(3);
    Object.assign(town.stock(), new Resources(0, 20, 20));
    a.level = 3;
    holdIn(town, a, 'wooden-club', 'weapon');
    expect(town.orderCraft(a.id, smith.id, 'mace')).toBe(true);
    for (let i = 0; i < 2000 && a.craftProgress < 1; ++i) step(town);
    const encoded = encodeTown(town),
      loaded = decodeTown(encoded, (map) => new Town(map, 32, false, true));
    expect(encoded.startsWith('GoldFantasy-save\n13000000')).toBe(true);
    expect(encodeTown(loaded)).toBe(encoded);
    expect(stationLevel(loaded.building(smith.id)!)).toBe(2);
    expect(stationLevel(loaded.building(bench.id)!)).toBe(3);
    const p = loaded.person(a.id)!;
    expect(p.craftItem).toBe(upgradeOrder('mace'));
    run(loaded, p);
    expect(p.inventory[0]?.item).toBe('mace');
  });
  it('stays on the old format without a station', () => {
    const { town, smith, bench } = fixture();
    town.placed = town.placed.filter((b) => b !== smith && b !== bench);
    expect(encodeTown(town).startsWith('GoldFantasy-save\n13000000')).toBe(false);
  });
  it('reads an old weaponsmith and armorer as smithies by rule, and an old bench as level 1', () => {
    const { town, smith, bench, a } = fixture();
    const armorer = new Building(town.nextId++, Structure.Armorer, point(24, 18), 0, 0);
    armorer.village = 0;
    town.placed.push(armorer);
    // An old save held random looks and a worker at the armorer.
    smith.variant = 712345;
    armorer.variant = 99;
    bench.variant = 4242;
    a.job = armorer.id;
    addInventory(a, 'leather-armor');
    const old = (encoded: string, version: number) => {
      const bytes = Buffer.from(encoded.split('\n')[1], 'hex'),
        payload = bytes.subarray(0, -8);
      payload.writeUInt32LE(version, 0);
      bytes.writeBigUInt64LE(digest(payload), bytes.length - 8);
      return 'GoldFantasy-save\n' + bytes.toString('hex');
    };
    const load = (floors: number) => {
      town.depth = town.map().dungeons().map(() => floors);
      return decodeTown(old(encodeTown(town), 18), (map) => new Town(map, 32, false, true));
    };
    const fresh = load(0);
    expect(fresh.building(armorer.id)!.kind).toBe(Structure.Weaponsmith);
    expect(stationLevel(fresh.building(smith.id)!)).toBe(2);
    expect(stationLevel(fresh.building(armorer.id)!)).toBe(2);
    expect(stationLevel(fresh.building(bench.id)!)).toBe(1);
    expect(fresh.person(a.id)!.job).toBe(-1);
    expect(fresh.person(a.id)!.inventory[0]?.item).toBe('leather-armor');
    // Written again, it is a version 19 save that reads back the same.
    const again = encodeTown(fresh);
    expect(again.startsWith('GoldFantasy-save\n13000000')).toBe(true);
    expect(stationLevel(decodeTown(again, (map) => new Town(map, 32, false, true)).building(smith.id)!)).toBe(2);
  });
});

// The station panel, drawn for real.
class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return { putImageData() {}, clearRect() {} };
  }
}
let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({ renderer: 'sw', locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}` });
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});
function panel(town: Town, width = 1024, height = 900) {
  const canvas = new tvg.Canvas(new MemoryCanvas(width, height) as never, { width, height, enableDevicePixelRatio: false });
  const fonts = ['DejaVuSans', 'DejaVuSans-Bold'];
  for (const font of fonts) tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  const metrics = Object.fromEntries(
    fonts.map((font) => [font, parseFontMetrics(new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)))]),
  );
  const context = new Context(tvg, metrics);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the panel uses only GameAppState fields and these stubs.
  const app = new GameAppState(town, {} as never, context) as GameHudApp;
  app.selectTool = vi.fn();
  app.selectBuilding = vi.fn();
  app.selectPeople = vi.fn();
  app.reducedMotion = () => true;
  const controls = vi.spyOn(context, 'control'),
    labels = vi.spyOn(context, 'text');
  canvas.add(context.scene());
  return {
    app,
    words: () => labels.mock.calls.map(([, text]) => text),
    texts: () => labels.mock.calls,
    control: (id: string) => controls.mock.calls.find(([key]) => key === id),
    draw(station: Building, bounds = new Rect(100, 20, 620, 860)) {
      controls.mockClear();
      labels.mockClear();
      app.selected = station.id;
      context.begin(app.theme, new Rect(0, 0, width, height), 1);
      inspector.call(app, bounds, true);
      context.end();
      canvas.update().render();
    },
    click(id: string) {
      const found = controls.mock.calls.find(([key]) => key === id);
      expect(found, id).toBeDefined();
      const r = found![1];
      context.pointerDown(r.x + r.w / 2, r.y + r.h / 2);
      context.pointerUp(r.x + r.w / 2, r.y + r.h / 2);
    },
    dispose() {
      canvas.remove();
      context.dispose();
      app.campResources.dispose();
      canvas.destroy();
    },
  };
}
describe('the station panel', () => {
  it('shows the level, what the next one makes and costs and the upgrade button, and lists nothing a higher level makes', () => {
    const { town, bench, a, c } = fixture(),
      ui = panel(town);
    try {
      Object.assign(town.stock(), new Resources(0, 30, 30));
      // The nearest free resident does the upgrade, not the selected one.
      ui.app.chosen = [c.id];
      ui.draw(bench);
      expect(ui.words()).toEqual(
        expect.arrayContaining([
          'Workbench',
          'Level 1',
          'Next level makes stone tools, a flint sickle and a hunting knife',
          'Upgrade: 10 wood, 6 stone',
          'Ready to upgrade',
          'Wooden axe',
          'Wooden pick',
        ]),
      );
      // What the bench cannot make yet is not listed at all.
      for (const hidden of ['Needs a level 2 workbench', 'Stone axe', 'Iron axe', 'Flint sickle', 'Iron saw'])
        expect(ui.words(), hidden).not.toContain(hidden);
      expect(ui.control(`station-upgrade-${bench.id}`)?.[3]).toBe(true);
      ui.click(`station-upgrade-${bench.id}`);
      expect(craftOrder(a.craftItem)).toEqual({ kind: 'station', level: 2 });
    } finally {
      ui.dispose();
    }
  });
  it.each([[620, false], [366, true], [296, true]] as const)('gives the recipes the full board below the profiles at width %i', (width, touch) => {
    const { town, bench } = fixture(), ui = panel(town), bounds = new Rect(30, 20, width, 650);
    try {
      ui.app.touchMode = touch;
      ui.draw(bench, bounds);
      const tabs = ui.control(`station-group-tools-${bench.id}`)![1],
        lastTab = ui.control(`station-group-gear-${bench.id}`)![1],
        work = ui.texts().find(([, words]) => words.startsWith('Nobody'))![0],
        title = ui.texts().find(([, words]) => words === 'Workbench')![0];
      expect(tabs.x - bounds.x).toBeLessThanOrEqual(16);
      expect(bounds.x + bounds.w - lastTab.x - lastTab.w).toBe(tabs.x - bounds.x);
      // The header holds the name and the work under way, and no crafter to pick.
      expect(Math.abs(work.y + work.h / 2 - (title.y + title.h / 2))).toBeLessThan(18);
      expect(work.x).toBeGreaterThanOrEqual(title.x + title.w);
      expect(work.x + work.w).toBeLessThanOrEqual(bounds.x + bounds.w);
      expect(work.y + work.h).toBeLessThan(tabs.y);
      expect(ui.control(`station-crafter-next-${bench.id}`)).toBeUndefined();
    } finally {
      ui.dispose();
    }
  });
  it.each([[320, 667, 487], [844, 390, 330]])('keeps every tool and the footer reachable on a %i × %i phone', (width, height, maxHeight) => {
    const { town, bench } = fixture(), ui = panel(town),
      boardWidth = Math.min(620, width - 24), bounds = new Rect((width - boardWidth) / 2, height - 12 - maxHeight, boardWidth, maxHeight);
    try {
      ui.app.touchMode = true;
      ui.app.viewHeight = height;
      const seen = new Set<string>();
      for (let page = 0; page < 5; page++) {
        ui.draw(bench, bounds);
        for (const [, words] of ui.texts()) if (words.startsWith('Wooden ')) seen.add(words);
        const clear = ui.control('clear-target')![1], next = ui.control(`station-page-next-${bench.id}`);
        expect(clear.y + clear.h).toBeLessThanOrEqual(bounds.y + bounds.h);
        expect(next).toBeDefined();
        expect(next![1].y).toBe(clear.y);
        expect(clear.x + clear.w).toBeLessThan(next![1].x);
        if (!next![3]) break;
        ui.click(`station-page-next-${bench.id}`);
      }
      expect([...seen].sort()).toEqual(['Wooden axe', 'Wooden hoe', 'Wooden mallet', 'Wooden pick', 'Wooden shovel']);
    } finally {
      ui.dispose();
    }
  });
  it('names who gets each item whatever is selected, fades a kind everyone carries, and never lists a make that waits', () => {
    const { town, smith, a, b, c } = fixture(),
      ui = panel(town);
    try {
      town.placed.push(new Building(town.nextId++, Structure.Watchtower, point(24, 18), 0, 0));
      Object.assign(town.stock(), new Resources(0, 30, 30));
      for (const p of [a, b, c]) addInventory(p, 'wooden-sword');
      addInventory(c, 'wooden-club');
      // The smithy stands nearest Dag, then Bryn, then Asa: selecting Asa changes nothing.
      ui.app.chosen = [a.id];
      ui.draw(smith);
      expect(recipeOffer(town, smith, itemSpec('wooden-sword')!)).toMatchObject({ action: 'none', mark: 'Everyone has one' });
      expect(recipeOffer(town, smith, itemSpec('wooden-club')!)).toMatchObject({ action: 'craft', who: b, reason: '' });
      expect(ui.words()).toEqual(expect.arrayContaining(['Everyone has one', `Goes to ${b.name}`, `Goes to ${c.name}`]));
      for (const hidden of ['Needs a level 2 smithy', 'Flint sword', 'Reinforced shield', 'Crafter'])
        expect(ui.words(), hidden).not.toContain(hidden);
      expect(ui.control(`station-crafter-next-${smith.id}`)).toBeUndefined();
      ui.click('station-craft-wooden-club');
      expect(b.craftItem).toBe('wooden-club');
      // The same row pressed again equips the next resident without one.
      ui.draw(smith);
      ui.click('station-craft-wooden-club');
      expect(a.craftItem).toBe('wooden-club');
      // Nobody is left to take one: the row shows the order under way and can stop it.
      ui.draw(smith);
      expect(ui.control('station-craft-wooden-club')).toBeUndefined();
      expect(ui.control('station-cancel-wooden-club')?.[3]).toBe(true);
      // The level-2 smithy lists nothing of iron, for anyone.
      smith.variant = levelVariant(2);
      ui.app.chosen = [];
      ui.draw(smith);
      for (const hidden of ['Needs a level 3 smithy', 'Iron sword', 'Mail armor', 'Iron helmet'])
        expect(ui.words(), hidden).not.toContain(hidden);
    } finally {
      ui.dispose();
    }
  });
  it('marks a make New once a higher station level opens it, until the player has looked and turned away', () => {
    const { town, smith, a, b, c } = fixture(),
      ui = panel(town);
    try {
      Object.assign(town.stock(), new Resources(0, 30, 30));
      a.level = 3;
      holdIn(town, a, 'wooden-sword', 'weapon');
      for (const p of [b, c]) addInventory(p, 'wooden-sword');
      craftBars(ui.app, 1280, 900);
      ui.draw(smith);
      expect(ui.words()).not.toContain('Flint sword');
      expect(ui.words()).not.toContain('New');
      smith.variant = levelVariant(2);
      craftBars(ui.app, 1280, 900);
      ui.draw(smith);
      // The sword row now offers the stone make as an upgrade of the one in hand.
      expect(ui.words()).toEqual(expect.arrayContaining(['Flint sword', 'New', 'Upgrade']));
      expect(ui.words()).not.toContain('Wooden sword');
      expect(freshMake(town, itemSpec('flint-sword')!)).toBe(true);
      ui.app.selected = -1;
      craftBars(ui.app, 1280, 900);
      expect(freshMake(town, itemSpec('flint-sword')!)).toBe(false);
    } finally {
      ui.dispose();
    }
  });
  it('offers a tool to whoever lacks it, then says what a better make waits for', () => {
    const { town, smith, bench, a, b, c } = fixture();
    Object.assign(town.stock(), new Resources(0, 30, 30));
    addInventory(a, 'wooden-axe');
    addInventory(c, 'stone-axe');
    expect(recipeOffer(town, bench, itemSpec('wooden-axe')!)).toMatchObject({ action: 'craft', who: b, mark: '', hint: `Goes to ${b.name}` });
    addInventory(b, 'wooden-axe');
    expect(recipeOffer(town, bench, itemSpec('wooden-axe')!)).toMatchObject({
      action: 'none',
      mark: 'Everyone has one',
      hint: 'Upgrade at a level 2 workbench',
    });
    // With the bench raised the wait is over; a stone weapon waits for its wielder's level instead.
    bench.variant = levelVariant(2);
    expect(recipeOffer(town, bench, itemSpec('stone-axe')!)).toMatchObject({ action: 'upgrade', who: a, reason: '' });
    smith.variant = levelVariant(2);
    for (const p of [a, b, c]) addInventory(p, 'wooden-club');
    expect(recipeOffer(town, smith, itemSpec('wooden-club')!)).toMatchObject({ action: 'none', hint: 'Upgrade at level 3' });
    expect(recipeOffer(town, bench, itemSpec('wooden-pick')!)).toMatchObject({ action: 'craft', who: a, mark: '' });
  });
});
describe('crafting for the settlement', () => {
  const offer = (town: Town, station: Building, id: string) => town.craftOffers(station.id).find((o) => o.item.id === id);
  it('gives the item to the nearest resident who has none, and a second order to the next one', () => {
    const { town, bench, a, b, c } = fixture();
    Object.assign(town.stock(), new Resources(0, 30, 30));
    // The bench stands nearest Asa, then Bryn, then Dag.
    addInventory(a, 'wooden-axe');
    expect(offer(town, bench, 'wooden-axe')).toMatchObject({ who: b, open: true, reason: '' });
    expect(town.orderSettlementCraft(bench.id, 'wooden-axe')).toBe(true);
    expect([a.craftItem, b.craftItem, c.craftItem]).toEqual([null, 'wooden-axe', null]);
    expect(town.orderSettlementCraft(bench.id, 'wooden-axe')).toBe(true);
    expect([a.craftItem, b.craftItem, c.craftItem]).toEqual([null, 'wooden-axe', 'wooden-axe']);
    // Nobody is left without one: a third order is refused and nothing changes.
    expect(town.orderSettlementCraft(bench.id, 'wooden-axe')).toBe(false);
    expect(offer(town, bench, 'wooden-axe')).toMatchObject({ open: false });
    run(town, b);
    run(town, c);
    expect([b, c].map((p) => p.inventory.some((s) => s?.item === 'wooden-axe'))).toEqual([true, true]);
    expect(a.inventory.filter((s) => s?.item === 'wooden-axe').length).toBe(1);
  });
  it('upgrades the nearest lesser make once everyone has the kind, and never picks one who cannot use the item', () => {
    const { town, smith, a, b, c } = fixture();
    Object.assign(town.stock(), new Resources(0, 30, 30));
    smith.variant = levelVariant(2);
    for (const p of [a, b, c]) addInventory(p, 'wooden-club');
    // The mace asks level 3. The smithy stands nearest Dag, who is too young for it, then Bryn, then Asa.
    a.level = b.level = 3;
    c.level = 1;
    expect(offer(town, smith, 'mace')).toMatchObject({ who: b, open: true, reason: '' });
    expect(town.orderSettlementCraft(smith.id, 'mace')).toBe(true);
    expect(b.craftItem).toBe('upgrade:mace');
    expect(town.orderSettlementCraft(smith.id, 'mace')).toBe(true);
    expect(a.craftItem).toBe('upgrade:mace');
    expect(town.orderSettlementCraft(smith.id, 'mace')).toBe(false);
    expect(c.craftItem).toBeNull();
    run(town, b);
    expect(b.inventory.map((s) => s?.item).filter(Boolean)).toEqual(['mace']);
    // A first make is not handed to one too young for it either.
    const sword = itemSpec('wooden-sword')!.minimumLevel;
    a.level = b.level = c.level = sword - 1;
    expect(offer(town, smith, 'wooden-sword')?.who ?? null).toBeNull();
  });
  it('says nobody is free while those without the item are busy at another order', () => {
    const { town, bench, a, b, c } = fixture();
    Object.assign(town.stock(), new Resources(0, 30, 30));
    for (const id of ['wooden-axe', 'wooden-pick', 'wooden-hoe']) expect(town.orderSettlementCraft(bench.id, id)).toBe(true);
    expect([a, b, c].map((p) => p.craftItem)).toEqual(['wooden-axe', 'wooden-pick', 'wooden-hoe']);
    expect(offer(town, bench, 'wooden-mallet')).toMatchObject({ who: null, reason: 'Nobody is free to make it' });
    expect(town.orderSettlementCraft(bench.id, 'wooden-mallet')).toBe(false);
  });
});
describe('Korean for the smithy', () => {
  it('translates every new line the station panel, the notices and the goals show', async () => {
    const { korean } = await import('../../packages/localization/src/korean');
    const lines = [
      'Smithy · Level 2',
      'Next level makes stone weapons, a reinforced shield and stone-studded armor',
      'Upgrade: 16 wood, 12 stone',
      'Needs a level 2 smithy',
      'Needs a level 3 workbench',
      'Asa raised the workbench to level 2',
      'Asa upgraded the Wooden sword to the Flint sword',
      'Goes to Bryn',
      'Bryn is making it',
      'Everyone has one',
      'Nobody is free to make it',
      'Wooden axe in the pack · Felling efficiency +1 · Attack as a weapon +1 · Two-handed',
      'Block +24 · Off hand',
      'Defence +12',
      'Melee attack +3 · STR scaling +5 · DEX scaling +2 · Cleaves',
      'Ranged attack +1 · DEX scaling +3 · Reach +1.7 · Pierces · Two-handed',
      'Workbench level 2',
      'Asa stopped making the Smithy level 3',
      'The wooden spear takes both hands',
      'Tools from the pack: Wooden axe, Stone pick',
      'Main hand: Wooden spear · Wooden shield (needs a free hand)',
      'Made by upgrading a wooden axe',
      'Needs level 3',
      'Upgrade at a level 2 smithy',
      'Upgrade at level 3',
      'Weapons · New',
      'Upgrading · 40%',
      'Level 1 / 2',
      'Blocks a door',
    ];
    for (const line of lines) {
      const out = korean.translate(line);
      expect(out, line).not.toBe(line);
      // Only names stay in Latin letters.
      expect(out.replace(/Asa|Bryn|Lv/g, ''), line).not.toMatch(/[A-Za-z]{2}/);
    }
  });
});
