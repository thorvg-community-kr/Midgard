import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, DungeonKind } from '../../packages/engine/src/world-types';
import { Building } from '../../packages/engine/src/town-models';
import { Activity, Calling, Person, Race, Role, Monster, AnimalKind } from '../../packages/engine/src/person';
import { Product, Resources, Structure } from '../../packages/engine/src/building-catalog';
import {
  defaultOffering, offeringBonus, offeringKeys, offeringReason, residentStartingLevel,
} from '../../packages/engine/src/prayer-offering';
import { altarCap, altarBaseCap, altarCapReason, altarCapLine } from '../../packages/engine/src/altar-cap';
import { burdenFrom, carryLimit } from '../../packages/engine/src/carried-resources';
import { characterPreset } from '../../packages/engine/src/character-preset';
import { korean } from '../../packages/localization/src/korean';
import { hasHangul } from '../../packages/localization/src/index';
import { offeringPhrases } from '../../packages/localization/src/korean/offering';
import { point } from '../../packages/engine/src/geometry';
import { copyNative } from '../../packages/engine/src/native-copy';
import { encodeTown, encodeTownPayload, decodeTown } from '../../packages/engine/src/save-game';
import { sharpAnchor } from '../../packages/engine/src/road-network';

let base: Town;
beforeAll(() => {
  const world = WorldMap.generate(5, 32, 32);
  world.ymir = world.fire = null;
  world.stream = { path: [], width: [] };
  for (const layer of world.layers) layer.fill(0.4);
  world.layer(Layer.Land).fill(1);
  world.layer(Layer.Ridge).fill(-1);
  for (let y = 0; y < 32; ++y)
    for (let x = 0; x < 32; ++x)
      Object.assign(world.at(x, y), { terrain: Terrain.Grass, trees: 0, revealed: true, dungeon: -1 });
  world.sites = [{ name: 'Test cave', kind: DungeonKind.Cave, origin: point(28, 28), discovered: false }];
  world.reveal(16, 16, 100);
  base = new Town(world, 32, false);
  base.placed = [
    new Building(0, Structure.Camp, point(10, 10), 0, 0),
    new Building(1, Structure.Shrine, point(14, 10), 0, 0),
  ];
  base.nextId = 2;
  base.migrateSettlements();
  Object.assign(base.stock(), new Resources(100, 100, 100, 100, 100, 100, 0, 0, 100));
  const p = new Person(0, 'Worshipper', Role.Resident, Calling.Settler, Race.Human, 5, point(11, 12));
  p.home = p.village = 0;
  p.food = p.hydration = p.health = p.rest = 1;
  p.autoMode = false;
  base.folk = [p];
  base.nextPerson = 1;
  base.wildlifeDay = base.days;
  base.editHour(12);
  base.tick(0);
});
const fixture = () => copyNative(base);
function offering(): Resources {
  return new Resources(2, 0, 3, 6, 0, 1, 0, 0, 4);
}
function fillBeds(town: Town, leave = 0): void {
  while (town.population() < town.housing() - leave) {
    const p = copyNative(town.people()[0]);
    p.id = town.nextPerson++;
    town.folk.push(p);
  }
}

describe('creating a resident at the altar', () => {
  it('does not replace a resident road assignment when a new resident is created', () => {
    const town = fixture(),
      p = town.people()[0];
    const path = [sharpAnchor(point(10, 8.8)), sharpAnchor(point(10, 4))];
    expect(town.buildRoad(path), town.canBuildRoad(path).reason).toBe(true);
    expect(town.orderRoadwork([p.id], town.roads().roads()[0].id)).toBe(true);
    town.advance(0.5);
    const worker = copyNative(p),
      clock = town.clock();
    expect(town.summonFromOffering(1, offering())).not.toBeNull();
    expect(p).toEqual(worker);
    expect(town.clock()).toBe(clock);
    expect(p.task).toBe(Activity.Roadwork);
  });
  it('pays all five configured resources once and preserves existing residents and simulation time', () => {
    const town = fixture();
    town.depth = [3];
    fillBeds(town, 1);
    const before = town.stock().clone(),
      gift = offering(),
      existing = encodeTown(town),
      worker = copyNative(town.people()[0]),
      clock = town.clock();
    expect(town.altarOfferingReason(1, gift)).toBe('');
    const born = town.summonFromOffering(1, gift)!;
    expect(born).not.toBeNull();
    expect(town.population()).toBe(town.housing());
    for (const key of offeringKeys) expect(town.stock()[key]).toBe(before[key] - gift[key]);
    expect(town.people()[0]).toEqual(worker);
    expect(town.clock()).toBe(clock);
    expect(born.inventory.every((item) => item === null)).toBe(true);
    expect(Object.values(born.equipment).every((slot) => slot === -1)).toBe(true);
    expect(born.purse).toBe(0);
    expect(born.home).toBe(0);
    expect(town.summonFromOffering(1, gift)).toBeNull(); // The only free bed was claimed atomically.
    for (const key of offeringKeys) expect(town.stock()[key]).toBe(before[key] - gift[key]);
    expect(encodeTown(town)).not.toBe(existing);
  });
  it('starts everyone as an untrained settler at half the living residents’ average rounded down', () => {
    const town = fixture(), first = town.folk[0];
    expect(residentStartingLevel(town)).toBe(1);
    first.level = 9;
    const ally = copyNative(first);
    ally.id = town.nextPerson++;
    ally.level = 6;
    town.folk.push(ally);
    // A fallen ally can still be revived. Visitors, neutrals and those who died do not count.
    ally.downedAt = town.clock();
    ally.health = 0;
    for (const overrides of [{ faction: 1 }, { role: Role.Guest }, { health: -1 }]) {
      const outsider = copyNative(first);
      Object.assign(outsider, { id: town.nextPerson++, level: 30 }, overrides);
      town.folk.push(outsider);
    }
    const born = town.offerAtAltar(1, offering()).born!;
    expect([born.race, born.calling, born.trained]).toEqual([Race.Human, Calling.Settler, false]);
    expect([born.level, born.experience]).toEqual([3, 0]);
    expect(residentStartingLevel(town)).toBe(3);
    first.level = 1;
    expect(residentStartingLevel(town)).toBe(1);
    expect(residentStartingLevel({ folk: [], controlFaction: 0 })).toBe(1);
  });
  it.each([0, 0.999])('guarantees one resident for the basic food cost at roll %s', (roll) => {
    const town = fixture(), before = town.stock().food;
    town.awaiting = true;
    vi.spyOn(town, 'roll').mockReturnValue(roll);
    const born = town.offerAtAltar(1, defaultOffering()).born!;
    expect([born.birthStrength, born.birthVitality]).toEqual(roll ? [0, 1] : [1, 0]);
    expect(town.stock().food).toBe(before - 4);
    expect(town.awaiting).toBe(false);
  });
  for (const invalid of [0, -1, 0.5, NaN, Infinity, 10000])
    it(`rejects invalid or empty amounts (${invalid}) without payment or RNG changes`, () => {
      const town = fixture(),
        gift = new Resources();
      gift.bones = invalid;
      const before = encodeTown(town);
      expect(town.altarOfferingReason(1, gift)).not.toBe('');
      expect(town.summonFromOffering(1, gift)).toBeNull();
      expect(encodeTown(town)).toBe(before);
    });
  it('rejects insufficient stock, forbidden materials, foreign altars and missing housing', () => {
    for (const change of [
      (t: Town, gift: Resources) => {
        t.stock().bones = gift.bones - 1;
      },
      (_t: Town, gift: Resources) => {
        gift.wood = 1;
      },
      (t: Town) => {
        t.building(1)!.faction = 7;
      },
      (t: Town) => {
        fillBeds(t);
      },
    ]) {
      const town = fixture(),
        gift = offering();
      change(town, gift);
      const before = encodeTown(town);
      expect(town.summonFromOffering(1, gift)).toBeNull();
      expect(encodeTown(town)).toBe(before);
    }
  });
  it('counts each full measure beyond four food equally and caps the goods at sixteen', () => {
    for (const key of offeringKeys) {
      for (let extra = 0; extra <= 13; ++extra) {
        const gift = defaultOffering();
        gift[key] += extra;
        expect(offeringReason(gift) === '').toBe(extra <= 12);
        expect(offeringBonus(gift)).toBe(Math.min(3, Math.floor(extra / 4)));
      }
    }
    expect(offeringReason(new Resources(0, 0, 16))).toContain('4 food');
  });
  it('gives one extra point for eight food, which could also feed two residents', () => {
    const town = fixture(), another = fixture();
    const born = town.offerAtAltar(1, new Resources(0, 0, 0, 8)).born!;
    expect(born.birthStrength + born.birthVitality).toBe(2);
    for (let i = 0; i < 2; ++i) {
      const p = another.offerAtAltar(1, defaultOffering()).born!;
      expect(p.birthStrength + p.birthVitality).toBe(1);
    }
    expect(town.stock()).toEqual(another.stock());
    expect(another.population()).toBe(town.population() + 1);
  });
  it('validates the identity before spending and keeps cosmetic choices independent of aptitude rolls', () => {
    const town = fixture(), original = encodeTown(town), other = fixture();
    const identity = characterPreset(town.folk[0]);
    identity.name = '  ';
    expect(town.offerAtAltar(1, offering(), identity).born).toBeNull();
    identity.name = 'Astrid';
    identity.calling = Calling.Mage;
    expect(town.offerAtAltar(1, offering(), identity).born).toBeNull();
    expect(encodeTown(town)).toBe(original);
    identity.calling = Calling.Settler;
    const born = town.offerAtAltar(1, offering(), identity).born!;
    const random = other.offerAtAltar(1, offering()).born!;
    expect(born.name).toBe('Astrid');
    expect(born.customLook).toEqual(identity.look);
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true)).person(born.id)!;
    expect(loaded.name).toBe(born.name);
    expect(loaded.customLook).toMatchObject(born.customLook!);
    expect([born.birthStrength, born.birthVitality]).toEqual([random.birthStrength, random.birthVitality]);
    expect(born.birthStrength + born.birthVitality).toBe(4);
    identity.look.hair.r = (identity.look.hair.r + 1) % 256;
    expect(born.customLook!.hair.r).not.toBe(identity.look.hair.r);
  });
  it('retains the aptitudes and their effects as a resident gains levels', () => {
    const town = fixture();
    const baseline = town.folk[0], gift = new Resources(0, 0, 0, 8);
    vi.spyOn(town, 'roll').mockReturnValueOnce(0).mockReturnValueOnce(0)
      .mockReturnValueOnce(0).mockReturnValueOnce(0.9);
    const born = town.offerAtAltar(1, gift).born!;
    expect([born.birthStrength, born.birthVitality]).toEqual([1, 1]);
    for (let level = 1; level <= 3; ++level) {
      expect(born.level).toBe(level);
      expect(carryLimit(born) - carryLimit(baseline)).toBe(3);
      expect(burdenFrom(born) - burdenFrom(baseline)).toBe(3);
      expect(born.vitalityMultiplier() - baseline.vitalityMultiplier()).toBeCloseTo(0.08);
      born.gainExperience(born.experienceToNextLevel());
      baseline.gainExperience(baseline.experienceToNextLevel());
    }
  });
  it('round trips bones and the real resident result without replaying an arrival', () => {
    const town = fixture(),
      born = town.summonFromOffering(1, offering())!;
    town.people()[0].inventory[0] = { item: 'bones', quantity: 3 };
    town.people()[0].carriedProduct = Product.Bones;
    town.people()[0].carrying = 2;
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true))!;
    expect(encodeTownPayload(town)[0]).toBe(20);
    expect(encodeTownPayload(fixture())[0]).toBeLessThan(20);
    expect(loaded.person(born.id)!.birthStrength).toBe(born.birthStrength);
    expect(loaded.person(born.id)!.birthVitality).toBe(born.birthVitality);
    expect(loaded.folk[0].birthStrength + loaded.folk[0].birthVitality).toBe(0);
    expect(loaded.stock().bones).toBe(town.stock().bones);
    expect(loaded.person(born.id)!.calling).toBe(born.calling);
    expect(loaded.person(born.id)!.level).toBe(born.level);
    expect(loaded.people()[0].inventory[0]).toEqual({ item: 'bones', quantity: 3 });
    expect(loaded.people()[0].carriedProduct).toBe(Product.Bones);
    loaded.advance(0.1);
    expect(loaded.population()).toBe(2);
  });
});

describe('bones are stored spoils', () => {
  it('awards bones once from an actual hunt, including food carried by a hungry hunter', () => {
    const town = fixture(),
      hunter = town.people()[0],
      before = town.stock().bones,
      animal = new Monster(99, -1, point(12, 12));
    animal.animal = AnimalKind.Pig;
    animal.health = 0;
    animal.provokedBy = hunter.id;
    hunter.hunting = true;
    hunter.foe = animal.id;
    hunter.food = 0.1;
    town.animals.push(animal);
    town.stirWildlife(0.1);
    expect(town.stock().bones).toBeGreaterThan(before);
    const after = town.stock().bones;
    town.stirWildlife(0.1);
    expect(town.stock().bones).toBe(after);
    expect(hunter.food).toBe(1);
  });
  it('awards bones on a lethal monster strike once, without touching food cargo', () => {
    const town = fixture(),
      p = town.people()[0],
      before = town.stock().bones,
      monster = new Monster(100, 0, point(12, 12));
    monster.health = 0.001;
    town.beasts.push(monster);
    town.strike(p, monster);
    expect(monster.health).toBeLessThanOrEqual(0);
    expect(town.stock().bones).toBe(before + 2);
    town.strike(p, monster);
    expect(town.stock().bones).toBe(before + 2);
  });
  it('includes bones in capacity and preserves stock when storage shrinks', () => {
    const town = fixture(),
      limit = town.capacity().bones;
    expect(limit).toBeGreaterThan(0);
    const gain = new Resources();
    gain.bones = limit * 2;
    town.store(gain, 0);
    expect(town.stock().bones).toBe(limit);
    expect(town.receipts().at(-1)!.gain.bones).toBe(limit - 100);
    expect(new Resources(0, 0, 0, 0, 0, 0, 0, 0, 4).clone().bones).toBe(4);
  });
});

describe('the altar cap', () => {
  const withDepth = (depth: number[]) => {
    const town = fixture();
    town.depth = depth;
    return town;
  };
  it('starts at twelve and rises by four per floor and four more per seal', () => {
    expect(altarBaseCap).toBe(12);
    expect([[], [0], [1], [2], [3]].map((d) => altarCap(withDepth(d)))).toEqual([12, 12, 16, 20, 28]);
  });
  it('refuses at the cap and spends nothing', () => {
    const town = fixture();
    while (town.population() < altarCap(town)) {
      const p = copyNative(town.people()[0]);
      p.id = town.nextPerson++;
      town.folk.push(p);
    }
    fillBeds(town, 1);
    const stock = town.stock().clone(),
      people = town.population(),
      rolls = vi.spyOn(town, 'roll');
    expect(town.altarOfferingReason(1, defaultOffering())).toBe(altarCapReason);
    expect(town.summonFromOffering(1, defaultOffering())).toBeNull();
    expect(town.stock()).toEqual(stock);
    expect(town.population()).toBe(people);
    expect(rolls).not.toHaveBeenCalled();
    expect(altarCapReason).toBe('Seal a dungeon to make room for more residents.');
    town.depth = [1];
    // Leave one bed free: the fixture's homes hold fewer than the base cap.
    while (town.population() > town.housing() - 1) town.folk.pop();
    expect(town.altarOfferingReason(1, defaultOffering())).toBe('');
  });
  it('counts a bed held by a fallen ally and a spot promised by another altar', () => {
    const town = fixture();
    fillBeds(town);
    const fallen = town.folk.at(-1)!;
    fallen.health = 0;
    fallen.downedAt = town.clock();
    expect(town.altarOfferingReason(1, defaultOffering())).toContain('No free resident bed');
    // A paid promise in a different settlement holds one of the faction's remaining spots.
    const camp = new Building(town.nextId++, Structure.Camp, point(21, 24), 0, 0);
    camp.village = camp.id;
    const altar = new Building(town.nextId++, Structure.Shrine, point(25, 24), 0, 0);
    altar.village = camp.id;
    altar.devotionDueDay = town.days + 1;
    town.placed.push(camp, altar);
    town.foundSettlement(camp.id);
    while (town.population() < altarBaseCap - 1) {
      const p = copyNative(town.folk[0]);
      p.id = town.nextPerson++;
      p.village = p.home = camp.id;
      town.folk.push(p);
    }
    // Open a local bed so the only remaining obstacle is the colony-wide promise.
    town.folk[1].village = town.folk[1].home = camp.id;
    const original = town.stock().clone();
    expect(town.altarOfferingReason(1, defaultOffering())).toBe(altarCapReason);
    expect(town.offerAtAltar(1, defaultOffering()).born).toBeNull();
    expect(town.stock()).toEqual(original);
    altar.devotionDueDay = -1;
    expect(town.altarOfferingReason(1, defaultOffering())).toBe('');
  });
  it('shows the raise in the reward lines text', () => {
    expect(altarCapLine(6)).toBe('Your settlement can now grow to 6 residents.');
  });
  it('is read from the saved depth, so a loaded town keeps it', () => {
    const town = withDepth([2]),
      loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true))!;
    expect(altarCap(loaded)).toBe(altarCap(town));
  });
});

describe('the offering words in Korean', () => {
  it('preserve placeholders and translate capacity and validation messages', () => {
    const marks = (text: string) => [...text.matchAll(/\{(\d+)\}/g)].map((hit) => hit[1]).sort();
    for (const [key, value] of Object.entries(offeringPhrases)) expect(marks(value), key).toEqual(marks(key));
    const lines = [
      altarCapLine(6), altarCapReason, offeringReason(new Resources()),
      offeringReason(new Resources(0, 0, 0, 20)), offeringReason(new Resources(0, 0, 0, -1)),
    ];
    for (const line of lines) expect(hasHangul(korean.translate(line)), line).toBe(true);
    const welcome = korean.translate('Runa joins the settlement · Level 4 · Strength +1 · Vitality +2');
    expect(welcome).toContain('Runa');
    expect(welcome).not.toMatch(/joins|Level|Strength|Vitality/);
    expect(welcome.match(/\d+/g)).toEqual(['4', '1', '2']);
  });
});
