import { describe, expect, it } from 'vitest';
import { Product, Resources, Structure } from '../../packages/engine/src/building-catalog';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Activity, Calling, Monster, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { point } from '../../packages/engine/src/geometry';
import { MonsterRank } from '../../packages/engine/src/combat-events';
import { canHarvest, harvestProduct } from '../../packages/engine/src/harvest-material';
import { deposit } from '../../packages/engine/src/mining';
import { addInventory, attackDamage, equippedItem, itemCatalog, itemSpec, workEfficiency } from '../../packages/engine/src/equipment';
import { gearEffect } from '../../packages/engine/src/gear-stats';
import { korean } from '../../packages/localization/src/korean';
import { heldAmount } from '../../packages/engine/src/carried-resources';
import { buildingUnlock } from '../../packages/engine/src/settlement-progression';
import { decodeTown, encodeTown, encodeTownPayload } from '../../packages/engine/src/save-game';
import { recipeOffer, stationRecipes } from '../../apps/web/src/native/craft-station-hud';

function village() {
  const map = new WorldMap();
  map.columns = map.rows = 32;
  map.mapSeed = 5;
  map.origin = point(12, 12);
  map.tiles = Array.from({ length: 1024 }, () => ({ ...makeTile(), revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(65 * 65).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.reveal(16, 16, 50);
  const town = new Town(map, 32, false);
  const building = (kind: Structure, x: number, y: number, variant = 0) => {
    const b = new Building(town.nextId++, kind, point(x, y), 0, variant);
    b.village = 0;
    town.placed.push(b);
    return b;
  };
  const camp = building(Structure.Camp, 12, 12), smith = building(Structure.Weaponsmith, 16, 12, 2);
  town.foundSettlement(camp.id);
  const p = town.makePerson(Role.Resident, Calling.Settler, point(15, 15));
  p.home = p.village = camp.id;
  p.level = 7;
  p.autoMode = false;
  p.rest = p.food = p.hydration = 1;
  town.folk.push(p);
  town.tick(0);
  town.orderStop([p.id]);
  return { town, p, building, smith };
}
function until(town: Town, ready: () => boolean) {
  for (let i = 0; i < 1600 && !ready(); ++i) {
    town.wildlifeDay = town.days;
    town.advance(0.05);
  }
  expect(ready()).toBe(true);
}

describe('regional materials and gear', () => {
  it.each([
    [Terrain.Frost, Product.IronOre, 'stone-pick', 3],
    [Terrain.Ash, Product.CinderOre, 'pickaxe', 2],
    [Terrain.Frost, Product.Frostwood, 'stone-axe', 3],
  ] as const)('harvests regional cargo through an ordinary work order (%s, %s)', (terrain, product, tool, amount) => {
    const { town, p } = village(), map = town.map(), stone = product !== Product.Frostwood;
    let cell = -1;
    for (let y = 17; y < 29 && cell < 0; ++y)
      for (let x = 4; x < 28 && cell < 0; ++x) {
        const tile = map.at(x, y);
        tile.terrain = terrain;
        if (!stone) tile.wild = tile.trees = 1;
        if (!stone || deposit(map, x, y)) cell = y * map.width() + x;
      }
    expect(cell).toBeGreaterThanOrEqual(0);
    const x = cell % 32, y = Math.floor(cell / 32), tile = map.at(x, y);
    expect(harvestProduct(map, x, y, stone)).toBe(product);
    const gather = () => stone ? town.orderMine([p.id], cell) : town.orderChop([p.id], cell);
    expect(gather()).toBe(false);
    addInventory(p, tool);
    expect(gather()).toBe(true);
    until(town, () => heldAmount(p, product) === amount && !p.carrying);
    expect(stone ? tile.quarried : tile.trees === 0).toBe(true);
    expect(gather()).toBe(false);
    expect(heldAmount(p, stone ? Product.Stone : Product.Wood)).toBe(0);
    const loaded = decodeTown(encodeTown(town), (m) => new Town(m, 32, false, true));
    expect(heldAmount(loaded.person(p.id)!, product)).toBe(amount);
    expect(deposit(loaded.map(), x, y)).toBe(false);
  });

  it('opens the foundry after both workshops, a sawmill and six residents', () => {
    const { town, building } = village();
    building(Structure.Stoneworks, 8, 9);
    building(Structure.Sawmill, 8, 12);
    expect(buildingUnlock(town, Structure.Foundry).available).toBe(false);
    while (town.population() < 6) town.folk.push(town.makePerson(Role.Resident, Calling.Settler, point(10, 10)));
    expect(buildingUnlock(town, Structure.Foundry).available).toBe(true);
  });

  it('refines a batch repeatedly, charges only at completion and resumes once after loading', () => {
    const { town, p, building } = village(), forge = building(Structure.Foundry, 18, 17);
    const stock = town.stock();
    stock.wood = 2;
    addInventory(p, 'iron-ore', 4);
    const start = () => town.orderCraft(p.id, forge.id, 'iron-ingot');
    expect(start()).toBe(true);
    until(town, () => p.craftProgress > 0);
    expect(town.cancelCraft(p.id)).toBe(true);
    expect([stock.wood, heldAmount(p, Product.IronOre), stock.ironIngot]).toEqual([2, 4, 0]);
    expect(start()).toBe(true);
    until(town, () => p.craftProgress > 0);
    const loaded = decodeTown(encodeTown(town), (m) => new Town(m, 32, false, true));
    const worker = loaded.person(p.id)!, station = loaded.building(forge.id)!;
    until(loaded, () => !worker.craftItem);
    expect([loaded.stock().ironIngot, loaded.stock().wood, heldAmount(worker, Product.IronOre)]).toEqual([1, 1, 2]);
    expect(loaded.withdrawInventory(p.id, Product.IronIngot, 1)).toBe(false);
    addInventory(worker, 'iron-ingot');
    expect(stationRecipes(loaded, station).get('Materials')?.map((i) => i.id))
      .toEqual(['iron-ingot', 'bound-frostwood', 'embersteel']);
    expect(recipeOffer(loaded, station, itemSpec('iron-ingot')!)).toMatchObject({ action: 'craft', who: worker });
    expect(loaded.orderCraft(worker.id, station.id, 'iron-ingot')).toBe(true);
    until(loaded, () => !worker.craftItem);
    expect([loaded.stock().ironIngot, loaded.stock().wood, heldAmount(worker, Product.IronOre)]).toEqual([2, 0, 0]);
    expect(loaded.orderCraft(worker.id, station.id, 'iron-ingot')).toBe(false);
    loaded.stock().wood = 1;
    loaded.stock().ironOre = 2;
    loaded.stock().ironIngot = loaded.capacity().ironIngot;
    expect(loaded.craftReason(worker.id, station.id, 'iron-ingot')).toBe('The village stores are full');
  });

  it('sends the nearest free resident to refine for the settlement, and the next one on a second order', () => {
    const { town, p, building } = village(), forge = building(Structure.Foundry, 18, 17);
    const far = town.makePerson(Role.Resident, Calling.Settler, point(6, 6));
    far.home = far.village = p.village;
    far.autoMode = false;
    far.rest = far.food = far.hydration = 1;
    town.folk.push(far);
    town.orderStop([far.id]);
    town.stock().wood = 4;
    town.stock().ironOre = 8;
    // A material is nobody's gear: one already in the nearer pack does not send the work elsewhere.
    addInventory(p, 'iron-ingot');
    expect(town.craftOffers(forge.id).find((o) => o.item.id === 'iron-ingot')).toMatchObject({ who: p, open: true, reason: '' });
    expect(town.orderSettlementCraft(forge.id, 'iron-ingot')).toBe(true);
    expect([p.craftItem, far.craftItem]).toEqual(['iron-ingot', null]);
    expect(town.orderSettlementCraft(forge.id, 'iron-ingot')).toBe(true);
    expect([p.craftItem, far.craftItem]).toEqual(['iron-ingot', 'iron-ingot']);
    // Both are at work: the row stays, and says nobody is free.
    expect(town.craftOffers(forge.id).find((o) => o.item.id === 'iron-ingot')).toMatchObject({ who: null, reason: 'Nobody is free to make it' });
    expect(town.orderSettlementCraft(forge.id, 'iron-ingot')).toBe(false);
    until(town, () => !p.craftItem && !far.craftItem);
    expect(town.stock().ironIngot).toBe(2);
  });

  it('turns a brute kill and regional harvests into upgrades in the same slots', () => {
    const { town, p, building, smith } = village(), forge = building(Structure.Foundry, 18, 17),
      bench = building(Structure.Workbench, 9, 16, 2);
    town.map().sites.push({ kind: DungeonKind.Cave, origin: point(3, 3), name: 'Hill cave', discovered: true });
    const brute = new Monster(0, 0, point(6, 6));
    brute.rank = MonsterRank.Brute;
    expect(town.hurtCreature(brute, 100, p)).toBe(true);
    expect(town.stock()).toMatchObject({ bones: 2, hides: 1 });
    expect(town.hurtCreature(brute, 100, p)).toBe(false);
    town.stock().add(Resources.from({ frostwood: 2, bones: 3, hides: 3, ironIngot: 2, cinderOre: 4 }));
    const craft = (at: Building, item: string) => {
      const reason = town.craftReason(p.id, at.id, item);
      expect(town.orderCraft(p.id, at.id, item), item + ": " + reason).toBe(true);
      until(town, () => !p.craftItem);
    };
    craft(forge, 'bound-frostwood');
    craft(forge, 'embersteel');
    craft(forge, 'embersteel');
    expect(town.stock()).toMatchObject({ bones: 0, frostwood: 0, ironIngot: 0, cinderOre: 0, embersteel: 2, boundFrostwood: 1 });
    craft(smith, 'boots');
    const feet = p.equipment.feet;
    expect(equippedItem(p, 'feet')?.id).toBe('boots');
    town.climate().snow = 0;
    const leather = town.walkingSpeed(p);
    town.unequipItem(p.id, 'feet');
    const bare = town.walkingSpeed(p);
    expect(leather / bare).toBeCloseTo(1.1);
    town.equipItem(p.id, feet, 'feet');
    craft(smith, 'snow-boots');
    expect(p.equipment.feet).toBe(feet);
    town.climate().snow = 0;
    expect(town.walkingSpeed(p) / bare).toBeCloseTo(1.18);
    town.climate().snow = 1;
    expect(town.walkingSpeed(p) / bare).toBeCloseTo(1.18 * 0.825);
    town.climate().snow = 0;
    town.map().cell(p.position)!.terrain = Terrain.Frost;
    expect(town.walkingSpeed(p) / bare).toBeCloseTo(1.18 * 1.0875);
    town.unequipItem(p.id, 'feet');
    expect(town.walkingSpeed(p) / bare).toBeCloseTo(1);
    addInventory(p, 'sword');
    const hand = p.inventory.findIndex((s) => s?.item === 'sword') + 1;
    town.equipItem(p.id, hand, 'weapon');
    const iron = attackDamage(p);
    craft(smith, 'embersteel-sword');
    expect(equippedItem(p, 'weapon')?.id).toBe('embersteel-sword');
    expect(p.equipment.weapon).toBe(hand);
    expect(attackDamage(p)).toBeGreaterThan(iron);
    addInventory(p, 'pickaxe');
    expect(town.orderCraft(p.id, bench.id, 'embersteel-pick')).toBe(true);
    town.stock().embersteel = 2;
    until(town, () => !p.craftItem);
    expect(workEfficiency(p, 'mining')).toBeCloseTo(0.4 * 2);
    expect(canHarvest(p, Product.CinderOre)).toBe(true);
  });

  it('smelts a missing ingot at the foundry, saves mid-batch and returns to upgrade the carried pick', () => {
    const { town, p, building } = village();
    const forge = building(Structure.Foundry, 18, 17), bench = building(Structure.Workbench, 9, 16, 2);
    addInventory(p, 'stone-pick');
    const slot = p.inventory.findIndex(stack => stack?.item === 'stone-pick');
    Object.assign(town.stock(), { wood: 8, stone: 8, ironOre: 0, ironIngot: 0 });
    const map = town.map();
    for (let x = 8; x < 24; x++) map.at(x, 20).terrain = Terrain.Frost;
    expect(Array.from({ length: 16 }, (_, offset) => deposit(map, offset + 8, 20)).some(Boolean)).toBe(true);
    town.changes++; town.tick(0);
    expect(town.orderCraft(p.id, bench.id, 'pickaxe')).toBe(true);
    expect(p.activity).toBe(Activity.Mining);
    until(town, () => p.refineProgress > 1);
    expect(town.craftingAt(forge.id)).toBe(p);
    expect(town.craftingAt(bench.id)).toBeNull();
    expect(p.inventory[slot]?.item).toBe('stone-pick');
    const loaded = decodeTown(encodeTown(town), map => new Town(map, 32, false)), worker = loaded.person(p.id)!;
    expect(worker.refineProgress).toBeCloseTo(p.refineProgress);
    until(loaded, () => !worker.craftItem);
    expect(worker.inventory[slot]?.item).toBe('pickaxe');
    expect(loaded.stock().ironOre + heldAmount(worker, Product.IronOre)).toBe(1);
    expect(loaded.stock().ironIngot).toBe(0);
  });

  it('only writes the new format for a settlement using it', () => {
    const { town, p } = village();
    expect(encodeTownPayload(town)[0]).toBe(19);
    town.stock().cinderOre = 2;
    expect(encodeTownPayload(town)[0]).toBe(21);
    town.stock().cinderOre = 0;
    addInventory(p, 'snow-boots');
    expect(encodeTownPayload(town)[0]).toBe(21);
  });

  it('crosses lava on command, burns while standing there and protects only worn embersteel boots', () => {
    const { town, p, smith } = village(), map = town.map();
    const dry = point(5.5, 23.5), lava = point(8.5, 23.5), far = point(13.5, 23.5);
    for (let y = 22; y <= 24; ++y)
      for (let x = 7; x <= 10; ++x) map.at(x, y).terrain = Terrain.Lava;
    town.grid.rebuild(map, town.network);
    p.position = dry;
    const pass = (target: typeof dry) => {
      town.orderMove([p.id], target);
      let touched = false;
      for (let i = 0; i < 1500 && p.path.length; ++i) {
        town.walk(p, 0.05);
        touched ||= map.cell(p.position)?.terrain === Terrain.Lava;
      }
      expect(p.position).toEqual(target);
      return touched;
    };
    expect(pass(far)).toBe(false);
    expect(pass(lava)).toBe(true);
    town.orderStop([p.id]);
    addInventory(p, 'snow-boots');
    town.equipItem(p.id, 1, 'feet');
    town.climate().snow = 0;
    const slow = town.walkingSpeed(p);
    p.position = dry;
    expect(slow / town.walkingSpeed(p)).toBeCloseTo(0.5);
    p.position = lava;
    town.advance(2);
    expect(p.health).toBeCloseTo(0.93, 3);
    p.position = dry;
    town.stock().add(Resources.from({ embersteel: 3, hides: 2 }));
    expect(town.orderCraft(p.id, smith.id, 'embersteel-boots')).toBe(true);
    until(town, () => !p.craftItem);
    expect(equippedItem(p, 'feet')?.id).toBe('embersteel-boots');
    expect(p.equipment.feet).toBe(1);
    p.position = dry;
    expect(pass(far)).toBe(true);
    const pace = town.walkingSpeed(p);
    p.position = lava;
    expect(town.walkingSpeed(p)).toBe(pace);
    const loaded = decodeTown(encodeTown(town), (m) => new Town(m, 32, false, true)), walker = loaded.person(p.id)!;
    loaded.orderStop([p.id]);
    const health = walker.health;
    loaded.advance(2);
    expect(walker.health).toBeGreaterThanOrEqual(health);
    loaded.unequipItem(p.id, 'feet');
    loaded.advance(1);
    expect(walker.health).toBeLessThan(health);
    walker.health = 0.01;
    loaded.advance(0.5);
    expect(walker.downedAt).toBeGreaterThanOrEqual(0);
    expect(loaded.combatState.downedBy.get(p.id)).toBe('Burned by lava');
  });

  it('translates the names, sources, effects, costs and stock counts of regional gear', () => {
    const lines = itemCatalog.filter((item) => item.product > Product.Bones || item.tier === 4 || item.walkBonus)
      .flatMap((item) => [item.name, item.description, gearEffect(item)]).filter(Boolean);
    lines.push('Iron ingot · 1 in store', 'Iron ingot 0 / 1 for Iron helmet', '2 cinder ore, 1 iron ingot, 2 bones',
      'Made by upgrading a pair of leather boots', 'Frostwood spruce', 'Needs an iron pick or better');
    for (const line of lines) expect(korean.translate(line).replace(/\b[SABCDE]\b/g, ''), line).not.toMatch(/[A-Za-z]/);
  });
});
