import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { Building, Season } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { AnimalKind, Calling, Role } from '../../packages/engine/src/person';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { Saga, sagaState, sealFloors, sealProgress } from '../../packages/engine/src/gate-seals';
import { RaidKind, raidDue, raidShape } from '../../packages/engine/src/raid-progression';
import { GoalBranch, buildingUnlock, currentGoal, settlementGoals } from '../../packages/engine/src/settlement-progression';
import { TownState } from '../../packages/engine/src/town-state';

function settlement() {
  const town = new Town(5, 32, false),
    camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(0);
  const gate = town.map().dungeons().findIndex((site) => site.kind !== DungeonKind.GiantHall);
  town.map().dungeons()[gate].discovered = true;
  return { town, camp, gate };
}
describe('saga end states', () => {
  it('is lost when no resident is left and won when every gate is sealed', () => {
    const { town } = settlement();
    expect(sagaState(town)).toBe(Saga.Defeat);
    town.placed[0].devotionDueDay = 3;
    expect(sagaState(town)).toBe(Saga.Playing);
    town.placed[0].devotionDueDay = -1;
    town.folk.push(town.makePerson(Role.Resident, Calling.Settler, town.map().camp()));
    expect(sagaState(town)).toBe(Saga.Playing);
    town.depth = town.map().dungeons().map(() => sealFloors);
    expect(sealProgress(town).sealed).toBe(sealProgress(town).total);
    expect(sealProgress(town).total).toBeGreaterThan(0);
    expect(sagaState(town)).toBe(Saga.Victory);
  });
});

describe('raid cadence and shapes', () => {
  it('gives two quiet opening nights and never more than two quiet nights in a row', () => {
    expect(raidDue(5, 0)).toBe(false);
    expect(raidDue(5, 1)).toBe(false);
    let quiet = 0,
      raids = 0;
    for (let day = 2; day < 200; ++day) {
      quiet = raidDue(5, day) ? 0 : quiet + 1;
      raids += raidDue(5, day) ? 1 : 0;
      expect(quiet).toBeLessThanOrEqual(2);
    }
    expect(raids).toBeLessThan(198);
    let winter = 0;
    for (let day = 2; day < 200; ++day) winter += raidDue(5, day, true) ? 1 : 0;
    expect(winter).toBeGreaterThan(raids);
  });
  it('shapes hordes as many weak raiders and brutes as few strong ones', () => {
    // A wave answers the settlement's might: more might, more swarm and more leaders.
    const strong = raidShape(RaidKind.Pack, 24);
    expect(raidShape(RaidKind.Horde, 24)).toMatchObject({ health: 0.8 });
    expect(raidShape(RaidKind.Horde, 24).swarm).toBeGreaterThan(strong.swarm);
    expect(raidShape(RaidKind.Horde, 24).count).toBeLessThan(strong.count);
    expect(raidShape(RaidKind.Brutes, 24)).toMatchObject({ health: 1.8 });
    expect(raidShape(RaidKind.Brutes, 24).swarm).toBeLessThan(strong.swarm);
    expect(raidShape(RaidKind.Pack, 3)).toMatchObject({ count: 0, brutes: 0, swarm: 10 });
    expect(strong.count).toBeGreaterThan(2);
    const { town } = settlement();
    town.days = 14;
    town.raidCount = 4;
    town.summonRaid(RaidKind.Pack);
    const pack = town.monsters().length,
      health = town.monsters()[0].health;
    town.beasts = [];
    town.summonRaid(RaidKind.Horde);
    expect(town.monsters().length).toBeGreaterThan(pack);
    expect(town.monsters()[0].health).toBeLessThan(health);
    expect(town.monsters().length).toBeLessThanOrEqual(TownState.maxRaiders);
  });
  it('lets a fortified seat shoot raiders while a bare camp cannot', () => {
    const { town, camp } = settlement();
    town.days = 14;
    town.summonRaid(RaidKind.Pack);
    const raider = town.monsters()[0];
    for (const beast of town.beasts) beast.position = { x: camp.center.x + 3, y: camp.center.y };
    const before = raider.health;
    town.stir(0.1);
    expect(town.monsters()[0].health).toBe(before);
    const waveHealth = () => town.monsters().reduce((sum, m) => sum + (m.raider ? m.health : 0), 0);
    const beforeVolley = waveHealth();
    camp.kind = Structure.Palisade;
    town.stir(0.1);
    expect(waveHealth()).toBeLessThan(beforeVolley);
    expect(town.hits().some((hit) => hit.ranged && hit.person === -1)).toBe(true);
  });
});

describe('branching progression', () => {
  it('opens arms and faith without the trade branch', () => {
    const { town } = settlement();
    const add = (kind: Structure) => {
      const b = new Building(town.nextId++, kind, town.map().camp(), 0, 0);
      b.village = 0;
      town.placed.push(b);
    };
    for (let i = 0; i < 16; ++i) town.folk.push(town.makePerson(Role.Resident, Calling.Settler, town.map().camp()));
    add(Structure.Quarry);
    expect(buildingUnlock(town, Structure.Guild).available).toBe(true);
    expect(buildingUnlock(town, Structure.Chapel).reason).toBe('Complete Altar of Odin');
    add(Structure.Shrine);
    expect(buildingUnlock(town, Structure.Chapel).available).toBe(true);
    expect(buildingUnlock(town, Structure.MageTower).reason).toBe('Complete Apothecary');
    expect(buildingUnlock(town, Structure.MarketStalls).available).toBe(false);
  });
  it('tracks each branch separately and ends the saga with every gate sealed', () => {
    const { town } = settlement();
    const goals = settlementGoals();
    expect(goals[currentGoal(town, GoalBranch.Core)].title).toBe('Lay a road');
    expect(goals[currentGoal(town, GoalBranch.Arms)].title).toBe('Build a guild');
    expect(goals[currentGoal(town, GoalBranch.Saga)].title).toBe('Lead a party of three');
    town.chronicle.largestParty = 3;
    expect(goals[currentGoal(town, GoalBranch.Saga)].title).toBe('Slay a dungeon guardian');
    expect(goals.at(-1)!.title).toBe('Seal every gate');
  });
});

describe('winter scarcity', () => {
  it('stocks fewer animals in winter and restocks one of each kind a day', () => {
    const summer = new Town(5, 64, false);
    summer.populateWildlife();
    const full = summer.wildlife().length;
    const winter = new Town(5, 64, false);
    winter.days = 45;
    expect(winter.calendar().season).toBe(Season.Winter);
    winter.populateWildlife();
    expect(winter.wildlife().length).toBeLessThan(full);
    summer.animals = [];
    summer.days = 1;
    summer.populateWildlife();
    expect(summer.wildlife().length).toBeLessThanOrEqual(6);
    expect(summer.wildlife().length).toBeGreaterThan(0);
  });
});

describe('sleeping animals', () => {
  it('keeps herd animals still at night, wakes them when struck and lets wolves prowl', () => {
    const town = new Town(5, 64, false);
    town.populateWildlife();
    const cow = town.wildlife().find((animal) => animal.animal === AnimalKind.Cow)!,
      wolf = town.wildlife().find((animal) => animal.animal === AnimalKind.Wolf)!;
    town.editHour(12);
    expect(town.animalAsleep(cow)).toBe(false);
    town.editHour(1);
    expect(town.climate().night).toBeGreaterThan(0.6);
    expect(town.animalAsleep(cow)).toBe(true);
    expect(town.animalAsleep(wolf)).toBe(false);
    cow.path = [{ x: cow.position.x + 1, y: cow.position.y }];
    const at = { ...cow.position };
    cow.ready = 0;
    for (let i = 0; i < 50; ++i) {
      town.time += 0.2;
      town.stirWildlife(0.2);
    }
    expect(cow.position).toEqual(at);
    expect(cow.path).toHaveLength(0);
    cow.angry = true;
    expect(town.animalAsleep(cow)).toBe(false);
  });
});
