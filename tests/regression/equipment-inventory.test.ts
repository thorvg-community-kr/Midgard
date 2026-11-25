import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { makeTile, Terrain, Layer } from '../../packages/engine/src/world-types';
import { Person, Role, Calling, Race, Activity, Monster } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Product, Resources, Structure } from '../../packages/engine/src/building-catalog';
import { point, distance } from '../../packages/engine/src/geometry';
import {
  addInventory,
  itemCatalog,
  inventorySlots,
  combatItem,
  attackDamage,
  combatAttributes,
  workItem,
  workEfficiency,
  armorProtection,
  itemSpec,
  madeFrom,
  type ItemSpec,
} from '../../packages/engine/src/equipment';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';
import { levelVariant } from '../../packages/engine/src/craft-stations';
import { digest } from '../../packages/engine/src/save-archive';
import * as mining from '../../packages/engine/src/mining';

function fixture(withWeaponSchools = false) {
  const map = new WorldMap();
  map.columns = map.rows = 32;
  map.mapSeed = 5;
  map.origin = point(12, 12);
  map.tiles = Array.from({ length: 1024 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(65 * 65).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.reveal(16, 16, 100);
  const town = new Town(map, 32, false),
    camp = new Building(0, Structure.Camp, point(12, 12), 0, 0),
    smith = new Building(1, Structure.Weaponsmith, point(18, 12), 0, 0),
    armorer = new Building(2, Structure.Armorer, point(18, 17), 0, 0),
    bench = new Building(3, Structure.Workbench, point(8, 17), 0, 0);
  camp.village = smith.village = armorer.village = bench.village = 0;
  // Both stations at their top level, so every recipe can be made here.
  smith.variant = bench.variant = levelVariant(3);
  town.placed = [camp, smith, armorer, bench];
  town.nextId = 4;
  if (withWeaponSchools) {
    for (const [i, kind] of [Structure.TrainingYard, Structure.Watchtower, Structure.MageTower].entries()) {
      const school = new Building(town.nextId++, kind, point(24, 10 + 4 * i), 0, 0);
      school.village = 0;
      town.placed.push(school);
    }
  }
  town.migrateSettlements();
  Object.assign(town.stock(), new Resources(100, 60, 60, 60, 20, 60, 20, 20));
  const person = new Person(0, 'Craftsperson', Role.Resident, Calling.Settler, Race.Human, 5, camp.door());
  person.home = person.village = 0;
  person.autoMode = false;
  person.food = person.rest = person.health = person.hydration = 1;
  town.folk = [person];
  town.nextPerson = 1;
  town.titleAutoplay = true;
  town.changes++;
  town.tick(0);
  town.orderStop([0]);
  return { town, person, camp, smith, armorer, bench };
}
function workshopFor(item: ItemSpec, places: { bench: Building; smith: Building; armorer: Building }): Building {
  return item.workshop === Structure.Weaponsmith ? places.smith : places.bench;
}
// Gear still made somewhere; retired pieces stay valid in saves but have no recipe.
const made = itemCatalog.filter((item) => item.category !== 'resource' && item.workshop !== null);
function advance(town: Town, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds * 20); ++i) town.advance(0.05);
}

describe('owned equipment, personal inventory and crafting', () => {
  it('starts founders and every profession without a free tool or weapon', () => {
    const town = new Town(5, 32);
    for (const person of town.people()) {
      expect(inventorySlots(person)).toHaveLength(16);
      expect(person.inventory.every((item) => item === null)).toBe(true);
      for (const calling of [
        Calling.Settler,
        Calling.Warrior,
        Calling.Ranger,
        Calling.Mage,
        Calling.Cleric,
        Calling.Bard,
      ]) {
        person.calling = calling;
        expect(combatItem(person)).toBeNull();
        expect(town.power(person)).toBeCloseTo(1);
        expect(workItem(person, 'construction')).toBeNull();
      }
    }
  });
  it('levels improve vitality while unarmed attack stays at one', () => {
    const { town, person } = fixture();
    person.gear = 3;
    const foe = new Monster(0, -1, point(13, 13));
    foe.health = 100;
    town.strike(person, foe);
    const first = 100 - foe.health;
    person.gainExperience(100000);
    expect(person.level).toBe(Person.maximumLevel);
    expect(person.vitalityMultiplier()).toBeGreaterThan(1);
    town.strike(person, foe);
    expect(first).toBe(1);
    expect(100 - first - foe.health).toBe(first);
    expect(town.power(person)).toBe(first);
  });
  it('uses the weapon grades and the wielder’s attributes for previews and real strikes at any eligible level', () => {
    const { town, person } = fixture();
    const sword = itemSpec('embersteel-sword')!, staff = itemSpec('frostwood-staff')!;
    town.roll = () => 0.99;
    person.level = 7;
    addInventory(person, sword.id);
    addInventory(person, staff.id);
    for (const [calling, blade, spell] of [[Calling.Warrior, 7, 5], [Calling.Mage, 5, 7]] as const) {
      person.calling = calling;
      for (const [slot, item, expected] of [[1, sword, blade], [2, staff, spell]] as const) {
        expect(attackDamage(person, item)).toBe(expected);
        expect(town.equipItem(person.id, slot, 'weapon')).toBe(true);
        const foe = new Monster(10, -1, point(13, 13));
        foe.health = 100;
        town.strike(person, foe);
        expect(100 - foe.health).toBe(expected);
        person.level = 30;
        expect(attackDamage(person)).toBe(expected);
        person.level = 7;
      }
    }
    person.calling = Calling.Ranger;
    expect(attackDamage(person, itemSpec('frostwood-bow'))).toBe(7);
    expect(attackDamage(person, staff)).toBe(5);
  });
  it('counts altar strength and worn armor when they improve the scaling of a weapon', () => {
    const { town, person } = fixture();
    person.level = 5;
    person.calling = Calling.Warrior;
    addInventory(person, 'flint-sword');
    addInventory(person, 'mail-armor');
    town.equipItem(person.id, 1, 'weapon');
    expect(attackDamage(person)).toBe(4);
    town.equipItem(person.id, 2, 'body');
    expect(combatAttributes(person).strength).toBe(5);
    expect(attackDamage(person)).toBe(5);
    town.unequipItem(person.id, 'body');
    person.birthStrength = 1;
    expect(attackDamage(person)).toBe(5);
    expect(attackDamage(person, itemSpec('staff'))).toBe(3);
    const restored = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true)).person(person.id)!;
    expect(combatAttributes(restored)).toEqual(combatAttributes(person));
    expect(attackDamage(restored)).toBe(5);
  });
  it('uses tools from the pack, a weapon only when equipped, and enforces required level', () => {
    const { town, person } = fixture();
    addInventory(person, 'hammer');
    addInventory(person, 'axe');
    addInventory(person, 'sword');
    // Tools work and fight straight from the pack; the sword waits until it is in hand.
    expect(combatItem(person)?.id).toBe('axe');
    expect(workEfficiency(person, 'construction')).toBeCloseTo(0.4 * 1.75);
    expect(workEfficiency(person, 'mining')).toBe(0.4);
    expect(town.equipItem(0, 3, 'weapon')).toBe(false);
    while (person.level < 5) person.gainExperience(person.experienceToNextLevel());
    expect(combatItem(person)?.id).toBe('axe');
    expect(town.equipItem(0, 3)).toBe(true);
    expect(combatItem(person)?.id).toBe('sword');
    expect(attackDamage(person)).toBe(5);
    expect(town.unequipItem(0, 'weapon')).toBe(true);
    expect(combatItem(person)?.id).toBe('axe');
    expect(town.equipItem(0, 1, 'head')).toBe(false);
  });
  it('moves equipped inventory references without creating duplicate items', () => {
    const { town, person } = fixture();
    // Old saves hold tools in the tool slots; the references still follow the stacks.
    addInventory(person, 'axe');
    addInventory(person, 'hammer');
    town.equipItem(0, 1, 'tool1');
    town.equipItem(0, 2, 'tool2');
    expect(town.transferInventory(0, 1, 9)).toBe(true);
    expect(person.equipment.tool1).toBe(9);
    expect(town.transferInventory(0, 9, 2)).toBe(true);
    expect(person.equipment.tool1).toBe(2);
    expect(person.equipment.tool2).toBe(9);
    expect(combatItem(person)?.id).toBe('axe');
    expect(person.inventory.filter(Boolean)).toHaveLength(2);
  });
  it.each(['axe', 'pickaxe'])('harvests faster with an %s in the pack, equipped or not', (tool) => {
    const remaining = (carried: boolean, equip: boolean) => {
      const { town, person } = fixture();
      const map = town.map();
      let cell = 18 * map.width() + 15;
      if (tool === 'axe') map.at(15, 18).trees = 1;
      else {
        cell = -1;
        for (let x = 20; x < 26 && cell < 0; ++x) {
          map.at(x, 22).terrain = Terrain.Rock;
          if (mining.deposit(map, x, 22)) cell = 22 * map.width() + x;
        }
        expect(cell).toBeGreaterThan(0);
      }
      if (carried) addInventory(person, tool);
      expect(tool === 'axe' ? town.orderChop([0], cell) : town.orderMine([0], cell)).toBe(true);
      for (let i = 0; i < 500 && (person.moving() || person.until > town.clock() + 100); ++i) town.advance(0.05);
      const left = person.until - town.clock();
      // Putting it in a slot or taking it out changes nothing: tools work from the pack.
      if (equip) {
        expect(town.equipItem(0, 1, 'tool1')).toBe(true);
        expect(person.until - town.clock()).toBeCloseTo(left, 5);
        expect(town.unequipItem(0, 'tool1')).toBe(true);
        expect(person.until - town.clock()).toBeCloseTo(left, 5);
      }
      return left;
    };
    const bare = remaining(false, false),
      packed = remaining(true, true);
    expect(packed).toBeCloseTo(bare / 1.75, 1);
  });
  it('withdraws and deposits real finite materials and displays the live work cargo', () => {
    const { town, person } = fixture(),
      before = town.stock().wood;
    expect(town.withdrawInventory(0, Product.Wood, 7)).toBe(true);
    expect(town.stock().wood).toBe(before - 7);
    expect(inventorySlots(person)[1].quantity).toBe(7);
    expect(town.transferInventory(0, 1, 0)).toBe(true);
    expect(person.carrying).toBe(7);
    expect(person.carriedProduct).toBe(Product.Wood);
    expect(inventorySlots(person)[0].quantity).toBe(7);
    expect(town.depositInventory(0, 0, 3)).toBe(true);
    expect(person.carrying).toBe(4);
    expect(town.stock().wood).toBe(before - 4);
    expect(town.transferInventory(0, 0, 5)).toBe(true);
    expect(person.carrying).toBe(0);
    expect(town.depositInventory(0, 5)).toBe(true);
    expect(town.stock().wood).toBe(before);
    expect(town.withdrawInventory(0, Product.Goods, 5)).toBe(true);
    expect(town.stock().gold).toBe(95);
    expect(town.depositInventory(0, 1)).toBe(true);
    expect(town.stock().gold).toBe(100);
  });
  it('rejects full bags and distant or foreign storage without spending stock', () => {
    const { town, person } = fixture();
    for (let i = 0; i < 15; ++i) expect(addInventory(person, 'axe')).toBe(true);
    const before = town.stock().wood;
    expect(town.withdrawInventory(0, Product.Wood, 1)).toBe(false);
    expect(town.stock().wood).toBe(before);
    person.inventory[0] = null;
    person.position = point(30, 30);
    expect(town.withdrawInventory(0, Product.Wood, 1)).toBe(false);
    person.position = town.camp()!.door();
    person.faction = 1;
    expect(town.withdrawInventory(0, Product.Wood, 1)).toBe(false);
    expect(town.stock().wood).toBe(before);
  });
  it('crafts through physical travel and work, pays exactly once, and puts a new tool to work from the pack', () => {
    const { town, person, bench } = fixture(),
      before = town.stock().clone();
    expect(town.orderCraft(0, bench.id, 'wooden-axe')).toBe(true);
    expect(person.path.length).toBeGreaterThan(0);
    advance(town, 3);
    expect(person.inventory.every((item) => !item)).toBe(true);
    expect(town.stock().wood).toBe(before.wood);
    // The work is done in the open within reach of the tabletop.
    const workSpot = town.craftSpot(bench);
    let atBench = false;
    for (let i = 0; i < 800 && person.craftItem; ++i) {
      town.advance(0.05);
      expect(person.inside).toBe(false);
      atBench ||= person.activity === Activity.Crafting && distance(person.position, workSpot) < 0.06;
    }
    expect(atBench).toBe(true);
    expect(person.inventory[0]?.item).toBe('wooden-axe');
    expect(town.stock().wood).toBe(before.wood - 3);
    expect(town.stock().stone).toBe(before.stone);
    expect(town.stock().gold).toBe(before.gold);
    expect(person.autoMode).toBe(true);
    // The new axe works from the pack at once, and the notice says what it changed.
    expect(person.equipment.tool1).toBe(-1);
    expect(workItem(person, 'woodcutting')?.id).toBe('wooden-axe');
    expect(town.notices.slice(-2)).toEqual(['Craftsperson crafted Wooden axe', 'Wooden axe in the pack · Felling efficiency +1 · Attack as a weapon +1 · Two-handed']);
  });
  it('provides a recipe for every wearable and tool: the first make new, each better one from the make below', () => {
    const places = fixture(true),
      { town, person, smith, armorer } = places;
    person.level = 7;
    Object.assign(town.stock(), { hides: 5, ironIngot: 5, embersteel: 5, boundFrostwood: 5 });
    expect(made.length).toBeGreaterThan(15);
    for (const item of made) {
      const workshop = workshopFor(item, places),
        below = madeFrom(item);
      person.inventory.fill(null);
      if (below) {
        expect(town.craftReason(0, workshop.id, item.id)).toContain(below.name.toLowerCase());
        expect(town.orderCraft(0, workshop.id, item.id)).toBe(false);
        addInventory(person, below.id);
      }
      expect(town.craftOptions(0, workshop.id).some((option) => option.item.id === item.id)).toBe(true);
      expect(town.craftReason(0, workshop.id, item.id)).toBe('');
      expect(town.craftReason(0, workshop.id === smith.id ? places.bench.id : smith.id, item.id)).not.toBe('');
      // The old armorer makes nothing any more.
      expect(town.craftReason(0, armorer.id, item.id)).not.toBe('');
      expect(town.craftReason(0, places.camp.id, item.id)).not.toBe('');
    }
  });
  it('finishes the same physical crafting job faster with an equipped hammer than with bare hands', () => {
    const workTime = (equipped: boolean) => {
      const { town, person, bench: smith } = fixture();
      if (equipped) {
        addInventory(person, 'hammer');
        expect(town.equipItem(0, 1, 'tool1')).toBe(true);
      }
      expect(town.orderCraft(0, smith.id, 'wooden-axe')).toBe(true);
      for (let i = 0; i < 300 && !person.craftProgress; ++i) town.advance(0.05);
      expect(person.craftProgress).toBeGreaterThan(0);
      const started = town.clock();
      for (let i = 0; i < 1000 && person.craftItem; ++i) town.advance(0.05);
      expect(person.craftItem).toBeNull();
      expect(person.inventory.some((stack) => stack?.item === 'wooden-axe')).toBe(true);
      return town.clock() - started;
    };
    const bareHands = workTime(false),
      hammer = workTime(true);
    expect(bareHands).toBeGreaterThan(itemSpec('wooden-axe')!.seconds / 0.4 - 0.2);
    expect(hammer).toBeCloseTo(bareHands / 1.75, 0);
  });
  it('pauses a full-bag craft without spending and resumes after a real inventory transfer', () => {
    const { town, person, bench: smith } = fixture(),
      before = town.stock().clone();
    expect(town.orderCraft(0, smith.id, 'wooden-axe')).toBe(true);
    for (let i = 0; i < 300 && person.craftProgress < 1; ++i) town.advance(0.05);
    const progress = person.craftProgress;
    expect(progress).toBeGreaterThan(0);
    expect(addInventory(person, 'wood', 300)).toBe(true);
    advance(town, 20);
    expect(person.craftProgress).toBe(progress);
    expect(town.stock()).toMatchObject(before);
    expect(town.transferInventory(0, 1, 0)).toBe(true);
    expect(person.carrying).toBe(20);
    // Checked the moment it is done, before the crafter goes on to carry the pack to the store.
    for (let i = 0; i < 700 && person.craftItem; ++i) town.advance(0.05);
    expect(person.craftItem).toBeNull();
    expect(person.inventory[0]?.item).toBe('wooden-axe');
    expect(town.stock().wood).toBe(before.wood - 3);
    expect(town.stock().stone).toBe(before.stone);
    expect(town.stock().gold).toBe(before.gold);
  });
  it.each(made)(
    'physically produces $name from its recipe',
    (item) => {
      const places = fixture(true),
        { town, person } = places,
        workshop = workshopFor(item, places),
        below = madeFrom(item);
      // A better make is the one below it, upgraded, by someone of a level to use it.
      person.level = item.minimumLevel;
      town.stock().add(item.cost);
      if (below) addInventory(person, below.id);
      expect(town.orderCraft(0, workshop.id, item.id)).toBe(true);
      for (let i = 0; i < 2000 && person.craftItem; ++i) town.advance(0.05);
      expect(person.inventory.filter((stack) => stack?.item === item.id)).toHaveLength(1);
      expect(person.craftItem).toBeNull();
    },
  );
  it('hits a resident only after an explicit Attack and identifies the attacker in the visual event', () => {
    const { town, person } = fixture(),
      other = new Person(
        1,
        'Ally',
        Role.Resident,
        Calling.Settler,
        Race.Human,
        6,
        point(person.position.x + 0.4, person.position.y),
      );
    other.home = other.village = 0;
    // Companions cannot be attacked; a resident of another settlement can.
    other.faction = 1;
    other.autoMode = false;
    other.food = other.rest = other.hydration = 1;
    town.folk.push(other);
    town.nextPerson = 2;
    advance(town, 2);
    expect(other.health).toBe(1);
    expect(town.orderAttackPerson([0], 1)).toBe(true);
    advance(town, 0.2);
    expect(other.health).toBeLessThan(1);
    const hit = town.hits().at(-1)!;
    expect(hit.person).toBe(1);
    expect(hit.attacker).toBe(0);
    expect(hit.onPerson).toBe(true);
    expect(person.task).toBe(Activity.Fighting);
  });
  it('cancels crafting without payment and refuses foreign workshops', () => {
    const { town, person, bench: smith } = fixture(),
      before = town.stock().clone();
    expect(town.orderCraft(0, smith.id, 'wooden-mallet')).toBe(true);
    advance(town, 5);
    town.orderStop([0]);
    advance(town, 20);
    expect(person.craftItem).toBeNull();
    expect(person.inventory.every((item) => !item)).toBe(true);
    expect(town.stock()).toMatchObject(before);
    smith.faction = 1;
    expect(town.orderCraft(0, smith.id, 'wooden-mallet')).toBe(false);
  });
  it('saves and resumes in-progress crafting without a second cost or losing equipment', () => {
    const { town, person, bench: smith } = fixture();
    addInventory(person, 'hammer');
    town.equipItem(0, 1);
    expect(town.orderCraft(0, smith.id, 'wooden-pick')).toBe(true);
    for (let i = 0; i < 200 && person.craftProgress < 1; ++i) town.advance(0.05);
    expect(person.craftProgress).toBeGreaterThan(0);
    const encoded = encodeTown(town),
      loaded = decodeTown(encoded, (map) => new Town(map, 32, false, true));
    // A smithy stands, so the save carries station levels (version 19).
    expect(encoded.startsWith('GoldFantasy-save\n13000000')).toBe(true);
    expect(encodeTown(loaded)).toBe(encoded);
    const p = loaded.person(0)!;
    expect(p.equipment.tool1).toBe(1);
    expect(p.craftItem).toBe('wooden-pick');
    const wood = loaded.stock().wood;
    advance(loaded, 20);
    expect(p.inventory.some((item) => item?.item === 'wooden-pick')).toBe(true);
    expect(loaded.stock().wood).toBe(wood - 3);
    expect(p.craftItem).toBeNull();
  });
  it('validates inventory on write and rejects tampered stack quantities on read', () => {
    const { town, person } = fixture();
    addInventory(person, 'axe');
    const encoded = encodeTown(town),
      bytes = Buffer.from(encoded.split('\n')[1], 'hex'),
      payload = bytes.subarray(0, -8),
      at = payload.indexOf(Buffer.from([3, 0, 0, 0, 97, 120, 101]));
    expect(at).toBeGreaterThan(0);
    payload.writeInt32LE(2, at + 7);
    bytes.writeBigUInt64LE(digest(payload), bytes.length - 8);
    expect(() =>
      decodeTown('GoldFantasy-save\n' + bytes.toString('hex'), (map) => new Town(map, 32, false, true)),
    ).toThrow(/inventory/i);
    person.inventory[0]!.quantity = 2;
    expect(() => encodeTown(town)).toThrow(/inventory/i);
  });
  it('leaves old empty-inventory archives on the historical format and does not grant gear on load', () => {
    const town = new Town(5, 32, false),
      encoded = encodeTown(town);
    expect(encoded.startsWith('GoldFantasy-save\n07000000')).toBe(true);
    expect(encodeTown(decodeTown(encoded, (map) => new Town(map, 32, false, true)))).toBe(encoded);
  });
  it('makes armor an owned wearable benefit instead of a global workshop bonus', () => {
    const { town, person } = fixture();
    expect(armorProtection(person)).toBe(0);
    addInventory(person, 'leather-armor');
    expect(town.equipItem(0, 1)).toBe(true);
    expect(armorProtection(person)).toBe(0.1);
    town.unequipItem(0, 'body');
    expect(armorProtection(person)).toBe(0);
  });
});
