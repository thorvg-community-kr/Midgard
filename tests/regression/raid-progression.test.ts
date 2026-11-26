import { describe, expect, it } from 'vitest';
import { dungeonThreat, raidMight, raidMuster, raidShape, RaidKind, seatVolley, siegeMonsterLevel, threatWeeks } from '../../packages/engine/src/raid-progression';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { MonsterRank } from '../../packages/engine/src/combat-events';
import { applyMonsterBalance, raidRewardHealth, rankRules } from '../../packages/engine/src/monster-ranks';
import { Calling, Monster, Role } from '../../packages/engine/src/person';
import { monsterBite } from '../../packages/engine/src/town-monsters';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { point } from '../../packages/engine/src/geometry';
import { Town } from '../../packages/engine/src/town';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { breedOf } from '../../packages/engine/src/town-monsters';

describe('weekly dungeon pressure', () => {
  it('keeps an armed young town below the late-game horde and increases the muster each week', () => {
    const horde = (week: number) => {
      const wave = raidShape(RaidKind.Horde, raidMight(100, week));
      return Math.min(Town.maxRaiders, wave.count + wave.brutes + wave.swarm);
    };
    expect([0, 1, 2].map(horde)).toEqual([21, 35, 51]);
    expect(horde(3)).toBeGreaterThan(horde(2));
    expect(horde(threatWeeks)).toBe(Town.maxRaiders);
    expect(raidMight(2, 1)).toBeLessThan(raidMight(100, 1));
    expect(raidMight(100, 100)).toBe(raidMight(100, threatWeeks));
  });
  it('holds pressure within the week and raises numbers and strength at the next week', () => {
    const camp = new Building(0, Structure.Camp, point(3, 3), 0, 0);
    const opening = dungeonThreat(0, point(), [camp]);
    expect(dungeonThreat(6, point(), [camp])).toEqual(opening);
    const next = dungeonThreat(7, point(), [camp]);
    expect(next.count).toBeGreaterThan(opening.count);
    expect(next.health).toBeGreaterThan(opening.health);
    expect(next.damage).toBeGreaterThan(opening.damage);
    expect(dungeonThreat(13, point(), [camp])).toEqual(next);
  });
  it('uses the nearby completed camp rather than a far castle or unfinished keep', () => {
    const camp = new Building(0, Structure.Camp, point(2, 2), 0, 0);
    const castle = new Building(1, Structure.Castle, point(100, 100), 0, 0);
    const keep = new Building(2, Structure.Keep, point(1, 1), 0, 0);
    keep.progress = 0.8;
    expect(dungeonThreat(14, point(), [castle, camp, keep]).tier).toBe(0);
    expect(dungeonThreat(14, point(), [castle]).tier).toBe(0);
    keep.progress = 1;
    expect(dungeonThreat(14, point(), [castle, camp, keep]).tier).toBe(2);
    // Fortifying the seat must never make the raids themselves worse.
    expect({ ...dungeonThreat(14, point(), [keep]), tier: 0 }).toEqual(dungeonThreat(14, point(), [camp]));
  });
  it('bounds both swarm size and strength', () => {
    const castle = new Building(0, Structure.Castle, point(), 0, 0),
      cap = dungeonThreat(threatWeeks * 7, point(), [castle]);
    expect(dungeonThreat(700, point(), [castle]).count).toBe(12);
    expect(dungeonThreat(700, point(), [castle])).toEqual({ ...cap, week: 100 });
    expect(cap.health).toBeGreaterThan(dungeonThreat(threatWeeks * 7 - 1, point(), [castle]).health);
  });
  it('keeps the weekly strength increase out of the notice feed', () => {
    const town = new Town(5, 32, false),
      camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.foundSettlement(0);
    town.days = 6;
    town.notices = [];
    town.newDay();
    expect(town.notices.some((text) => text.startsWith('Week 1:'))).toBe(false);
  });
  it('lets a fortified seat shoot hard enough to matter', () => {
    const town = new Town(5, 32, false),
      seat = new Building(0, Structure.Keep, town.map().camp(), 0, 0);
    seat.village = 0;
    town.placed.push(seat);
    town.foundSettlement(0);
    const lair = town.map().dungeons().findIndex((d) => d.kind !== DungeonKind.GiantHall),
      beast = new Monster(town.nextMonster++, lair, { x: seat.center.x + 3, y: seat.center.y });
    beast.raider = true;
    beast.health = breedOf(town.map().dungeons()[lair].kind).health;
    town.beasts.push(beast);
    const before = beast.health;
    town.stir(0.1);
    expect(before - beast.health).toBeCloseTo(seatVolley.damagePerTier * 2);
    for (let t = 0; t < 12 && beast.health > 0; t += 0.1) {
      town.time += 0.1;
      town.stir(0.1);
    }
    expect(beast.health).toBeLessThanOrEqual(0);
  });
  it('gives clerics a ward and bards a song that help the fighters around them', () => {
    const town = new Town(5, 32, false),
      at = town.map().camp(),
      lair = town.map().dungeons().findIndex((d) => d.kind !== DungeonKind.GiantHall),
      breed = breedOf(town.map().dungeons()[lair].kind),
      fighter = town.makePerson(Role.Resident, Calling.Warrior, at),
      friend = town.makePerson(Role.Resident, Calling.Settler, { x: at.x + 2, y: at.y });
    town.folk.push(fighter, friend);
    const bite = () => {
        fighter.health = 1;
        monsterBite(town, new Monster(99, lair, at), fighter, breed);
        return 1 - fighter.health;
      },
      blow = () => {
        const foe = new Monster(98, lair, at);
        foe.health = 100;
        town.strike(fighter, foe);
        return 100 - foe.health;
      },
      plainBite = bite(),
      plainBlow = blow();
    friend.calling = Calling.Cleric;
    expect(bite()).toBeCloseTo(plainBite * 0.8);
    expect(blow()).toBeCloseTo(plainBlow);
    friend.calling = Calling.Bard;
    expect(bite()).toBeCloseTo(plainBite);
    expect(blow()).toBeCloseTo(plainBlow * 1.15);
    friend.position = { x: at.x + 9, y: at.y };
    expect(blow()).toBeCloseTo(plainBlow);
    fighter.calling = Calling.Bard;
    expect(blow()).toBeCloseTo(plainBlow);
  });
  it('lets an unarmed founder defeat even the leader of a delayed first raid with one ordinary blow', () => {
    const town = new Town(5, 32, false), seat = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    seat.village = 0;
    town.placed.push(seat);
    town.foundSettlement(0);
    const gate = town.map().dungeons().findIndex(d => d.kind !== DungeonKind.GiantHall);
    town.map().dungeons()[gate].discovered = true;
    town.open[gate] = 1;
    town.days = 45;
    town.summonRaid(RaidKind.Brutes, [gate]);
    const founder = town.makePerson(Role.Resident, Calling.Settler, seat.door());
    const raiders = town.beasts.filter(m => m.raider);
    expect(raiders.some(m => m.rank === MonsterRank.Brute)).toBe(true);
    for (const m of raiders) {
      expect(m.level).toBe(1);
      expect(m.health).toBeLessThanOrEqual(town.blowStrength(founder));
      town.strike(founder, m);
      expect(m.health).toBeLessThanOrEqual(0);
    }
  });
  it('recognises a wounded raider from before levels were saved by its full health', () => {
    const raider = new Monster(1, 0, point());
    raider.raider = true;
    raider.vigor = 8;
    raider.health = 0.8;
    applyMonsterBalance(raider);
    expect(raider.vigor).toBeCloseTo(10.4);
    expect(raider.health).toBeCloseTo(1.04);
    expect(raidRewardHealth(raider)).toBeCloseTo(8);
  });
  it('applies the weekly increase to actual spawned dungeon raiders', () => {
    const town = new Town(5, 32, false),
      camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.foundSettlement(0);
    const lair = town
      .map()
      .dungeons()
      .find((d) => d.kind !== DungeonKind.GiantHall)!;
    lair.discovered = true;
    town.days = 6;
    town.summonRaid(RaidKind.Pack);
    const opening = town.monsters().length,
      scout = town.monsters()[0];
    expect(scout.level).toBe(1);
    const settler = town.makePerson(Role.Resident, Calling.Settler, scout.position);
    expect(town.blowStrength(settler)).toBe(1);
    for (const raider of town.monsters()) {
      town.strike(settler, raider);
      expect(raider.health).toBeLessThanOrEqual(0);
    }
    town.beasts = [];
    town.days = 7;
    town.summonRaid(RaidKind.Pack);
    expect(town.monsters().length).toBeGreaterThanOrEqual(opening);
    expect(town.monsters()[0].health).toBeGreaterThan(scout.vigor);
    // An empty camp only draws a probe of swarmers: they too grow with the week.
    const swarmer = town.monsters()[0];
    expect(swarmer.rank).toBe(MonsterRank.Swarmer);
    expect(swarmer.level).toBe(2);
    expect(swarmer.strength).toBeCloseTo(0.2 * 1.08 * rankRules.swarmerStrength * raidMuster.swarmBite, 4);
    expect(swarmer.health).toBeCloseTo(breedOf(lair.kind).health * 0.312 * 1.32 * rankRules.swarmerHealth, 3);
    swarmer.health = Math.fround(swarmer.vigor * 0.4);
    town.days = 35;
    const saved = decodeTown(encodeTown(town), map => new Town(map, 32, false, true));
    expect(saved.creature(swarmer.id)).toMatchObject({
      level: 2, vigor: swarmer.vigor, health: swarmer.health, strength: swarmer.strength,
    });
    saved.beasts = [];
    saved.summonRaid(RaidKind.Horde);
    expect(saved.monsters()[0].level).toBe(6);
    expect(siegeMonsterLevel(0, 11)).toBe(1);
    expect(siegeMonsterLevel(14, 48)).toBe(6);
  });
});
