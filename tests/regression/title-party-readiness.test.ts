import { describe, expect, it, vi } from 'vitest';
import { Activity, Calling, Monster, Person, Race, Role } from '../../packages/engine/src/person';
import { addInventory } from '../../packages/engine/src/equipment';
import { point } from '../../packages/engine/src/geometry';
import { partyLevel, partyVerdict, Verdict } from '../../apps/web/src/native/swarm-hud';
import { commandSiege, defend, readyParty, sendParty, partyState } from '../../apps/web/src/native/title-party';
import { firstWeapon } from '../../apps/web/src/native/title-gear';
import { available } from '../../apps/web/src/native/title-roster';
import { staffJobs } from '../../apps/web/src/native/title-workforce';
import { OrderLedger } from '../../apps/web/src/native/title-orders';
import { Traffic } from '../../apps/web/src/native/title-traffic';
import { Town } from '../../packages/engine/src/town';
import { Building, Field } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { dungeonChallenge, dungeonStatus, targetedDungeon } from '../../packages/engine/src/dungeon-siege';
import { monsterEntrance } from '../../packages/engine/src/town-monsters';
import { sealable } from '../../packages/engine/src/gate-seals';
import { WorkEfficiency } from '../../packages/engine/src/work-efficiency';

function fighter(id: number, level: number, weapon: string): Person {
  const p = new Person(id, `Fighter ${id}`, Role.Resident, Calling.Warrior, Race.Human, 0, point(10, 10));
  p.level = level;
  addInventory(p, weapon);
  p.equipment.weapon = 1;
  return p;
}
function expeditionTown() {
  const town = new Town(5, 176, false), camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.foundSettlement(0);
  const gate = town.map().dungeons().findIndex(sealable);
  town.map().dungeons()[gate].discovered = true;
  town.open[gate] = 1;
  town.editHour(10);
  return { town, camp };
}
function context(town: Town) {
  return { town, free: [...town.folk], party: new Set<number>(), step: 0, seed: 5, ledger: new OrderLedger(),
    later: new Map<string, number>(), staffed: new Map<number, number>(), efficiency: new WorkEfficiency(town), traffic: new Traffic() };
}
it('supplies the first field with water and shares both jobs after a loss', () => {
  const { town, camp } = expeditionTown();
  const farm = new Building(1, Structure.Farm, camp.door(), 0, 0);
  const well = new Building(2, Structure.Well, camp.door(), 0, 0);
  farm.village = well.village = camp.id;
  town.placed.push(farm, well);
  town.farmland.push(new Field(0, [point(10, 10), point(15, 10), point(15, 14), point(10, 14)], camp.id));
  town.stock().water = 0;
  town.folk = [fighter(0, 1, 'wooden-sword'), fighter(1, 1, 'wooden-sword')];
  for (const p of town.folk) p.home = p.village = camp.id;
  const ctx = context(town);
  staffJobs(ctx);
  expect([farm.workers, well.workers]).toEqual([1, 1]);
  town.setWorkers(farm.id, 2);
  expect([farm.workers, well.wanted]).toEqual([2, 0]);
  staffJobs(ctx);
  expect([farm.workers, well.workers]).toEqual([1, 1]);

  town.folk.pop();
  staffJobs(ctx);
  expect([farm.workers, well.workers]).toEqual([0, 1]);
  town.stock().water = 6;
  staffJobs(ctx);
  expect([farm.workers, well.workers]).toEqual([1, 0]);
  town.folk = [];
  staffJobs(ctx);
  expect([farm.wanted, well.wanted]).toEqual([0, 0]);
});
describe('the title party', () => {
  it('arms the unarmed guard even when the settlement recipe names a closer archer', () => {
    const { town, camp } = expeditionTown();
    const smith = new Building(1, Structure.Weaponsmith, camp.center, 0, 0);
    smith.village = 0;
    town.placed.push(smith);
    town.stock().wood = 30;
    const archer = fighter(50, 10, 'short-bow');
    archer.position = smith.door();
    archer.calling = Calling.Ranger;
    const guard = new Person(51, 'Guard', Role.Resident, Calling.Settler, Race.Human, 0,
      point(archer.position.x + 0.25, archer.position.y));
    guard.village = archer.village = 0;
    town.folk = [archer, guard];
    expect(town.craftOffers(smith.id).find(o => o.item.id === 'wooden-sword')?.who?.id).toBe(archer.id);
    const choice = firstWeapon(town, [archer, guard]);
    expect(choice?.person.id).toBe(guard.id);
    expect(choice?.item.id).toBe('wooden-sword');
    expect(town.orderCraft(guard.id, smith.id, choice!.item.id)).toBe(true);
    expect(guard.craftItem).toBe('wooden-sword');
    expect(firstWeapon(town, [archer, guard])).toBeNull();
  });
  it('weighs endurance and actual weapon damage independently before sending a party', () => {
    const wooden = [9, 9, 8, 8].map((level, id) => fighter(id, level, 'wooden-sword'));
    const forged = [9, 9, 8, 8].map((level, id) => fighter(id, level, 'flint-sword'));
    expect(partyLevel(wooden)).toBe(9);
    expect(partyLevel(forged)).toBe(9);
    expect(partyVerdict(wooden, 0, 1)).toBe(Verdict.Ready);
    expect(partyVerdict(wooden, 1, 1)).toBe(Verdict.Hard);
    expect(partyVerdict(forged, 1, 1)).toBe(Verdict.Ready);
  });
  it('waits for a suitable force and sizes it to the actual dungeon tier', () => {
    const { town, camp } = expeditionTown();
    const bring = (level: number) => {
      const p = fighter(town.folk.length, level, 'wooden-sword');
      p.position = camp.door();
      town.folk.push(p);
      return p;
    };
    const first = bring(4);
    expect(town.orderAttackDungeon([first.id], 0)).toBe(true);
    for (let i = 1; i < 10; ++i) bring(10);
    expect(readyParty(town)).toBeNull();
    first.level = 10;
    expect(readyParty(town)?.members).toHaveLength(10);
    const next = town.map().dungeons().map((site, gate) => ({ site, gate }))
      .filter(({ site, gate }) => sealable(site) && gate > 0)
      .sort((a, b) => dungeonChallenge(town, a.gate).tier - dungeonChallenge(town, b.gate).tier)[0];
    town.depth[0] = 3;
    next.site.discovered = true;
    bring(20);
    expect(readyParty(town)).toBeNull();
    for (const ally of town.folk) ally.level = 20;
    expect(readyParty(town)).toMatchObject({ gate: next.gate });
    expect(readyParty(town)?.members).toHaveLength(11);
  });
  it('lets veterans cover a trained archer when the whole company meets the recommendation', () => {
    const { town } = expeditionTown();
    const veterans = Array.from({ length: 9 }, (_, i) => fighter(i, 12, 'flint-sword'));
    const swordsman = fighter(9, 6, 'wooden-sword'), archer = fighter(10, 6, 'short-bow');
    archer.calling = Calling.Ranger;
    town.folk = [...veterans, swordsman, archer];
    expect(readyParty(town)?.members).toContain(archer);
    veterans[0].level = 9;
    expect(readyParty(town)).toBeNull();
    veterans[0].level = 12;
    archer.level = 2;
    expect(readyParty(town)).toBeNull();
  });
  it('keeps an armed pair home on a warned raid day', () => {
    const { town, camp } = expeditionTown();
    town.raidWarnedDay = town.days;
    for (let id = 0; id < 12; ++id) {
      const p = fighter(id, 10, 'flint-sword');
      if (id >= 10) p.calling = Calling.Settler;
      p.home = p.village = 0;
      p.position = camp.door();
      p.health = p.food = p.rest = p.hydration = 1;
      town.folk.push(p);
    }
    const state = partyState();
    const ctx = context(town);
    expect(sendParty(ctx, state)).toBe(true);
    expect(state.members).toHaveLength(10);
    expect(state.members).not.toContain(10);
    expect(state.members).not.toContain(11);
  });
  it('keeps settlers at work until a raider closes on the camp door', () => {
    const { town, camp } = expeditionTown(), door = camp.door();
    const settler = fighter(0, 10, 'flint-sword');
    settler.position = town.grid.nearestWalkable(point(door.x + 8, door.y));
    settler.task = Activity.Working;
    town.folk.push(settler);
    const raider = new Monster(town.nextMonster++, 0, point(door.x + 12, door.y));
    raider.raider = true;
    town.beasts.push(raider);
    const ctx = context(town), state = partyState();
    expect(defend(ctx, state)).toBe(false);
    expect(ctx.free).toContain(settler);
    expect(settler).toMatchObject({ ordered: false, task: Activity.Working });

    raider.position = point(door.x + 4, door.y);
    expect(defend(ctx, state)).toBe(true);
    expect(ctx.free).not.toContain(settler);
    expect(settler).toMatchObject({ ordered: true, task: Activity.Moving, aggressive: true });
  });
  it('sends its only helper to the casualty who will bleed out first', () => {
    const { town, camp } = expeditionTown();
    const [first, wounded, helper] = [0, 1, 2].map(id => fighter(id, 10, 'flint-sword'));
    town.folk.push(first, wounded, helper);
    for (const p of town.folk) p.position = camp.door();
    town.strikeDown(first, 'Killed by monsters');
    ++town.time;
    wounded.woundDays = 1;
    town.strikeDown(wounded, 'Killed by monsters');
    expect(town.bleedOutLeft(wounded)).toBeLessThan(town.bleedOutLeft(first));
    defend(context(town), partyState());
    expect(helper).toMatchObject({ task: Activity.Tending, taskSite: wounded.id });
  });
  it('keeps an armed helper off the settlement roster and out of a new assault until the casualty is up', () => {
    const { town, camp } = expeditionTown();
    for (let i = 0; i < 11; ++i) {
      const p = fighter(i, 10, 'flint-sword');
      p.position = camp.door();
      town.folk.push(p);
    }
    const [helper, hurt] = town.folk;
    town.strikeDown(hurt, 'Killed by monsters');
    expect(available(town, helper)).toBe(true);
    expect(readyParty(town)?.members).toContain(helper);
    expect(town.orderTend([helper.id], hurt.id)).toBe(true);
    expect(available(town, helper)).toBe(false);
    expect(readyParty(town)).toBeNull();
    town.time = helper.until;
    town.tend(helper);
    expect(hurt.downedAt).toBe(-1);
    expect(available(town, helper)).toBe(true);
    expect(readyParty(town)?.members).toContain(helper);
  });
  it('clears the wave guarding the dungeon, keeps a helper tending, then resumes the siege', () => {
    const { town } = expeditionTown();
    const mouth = town.grid.nearestWalkable(monsterEntrance(town.map().dungeons()[0]));
    for (let i = 0; i < 10; ++i) {
      const p = fighter(i, 10, 'flint-sword');
      p.position = { ...mouth };
      town.folk.push(p);
    }
    const ctx = context(town), state = partyState();
    expect(sendParty(ctx, state)).toBe(true);
    const [hurt, helper, ...fighters] = town.folk;
    const firstDefender = town.nextMonster;
    const strength = vi.spyOn(town, 'blowStrength').mockReturnValueOnce(dungeonStatus(town, state.gate).maxHealth / 4);
    town.fight(fighters[0], 0);
    strength.mockRestore();
    const defenders = town.monsters().filter(m => m.lair === state.gate && m.id >= firstDefender);
    expect(defenders.length).toBeGreaterThan(0);
    const bystander = new Monster(town.nextMonster++, state.gate, mouth);
    town.beasts.push(bystander);
    town.strikeDown(hurt, 'Killed by monsters');
    expect(town.orderTend([helper.id], hurt.id)).toBe(true);
    commandSiege(ctx, state);
    const defenderIds = defenders.map(m => m.id);
    expect(fighters.every(p => p.task === Activity.Fighting && defenderIds.includes(p.taskSite))).toBe(true);
    expect(helper).toMatchObject({ task: Activity.Tending, taskSite: hurt.id });
    for (const m of defenders) m.health = 0;
    town.time += 3;
    commandSiege(ctx, state);
    expect(fighters.every(p => targetedDungeon(p) === state.gate)).toBe(true);
    expect(bystander.health).toBeGreaterThan(0);
    expect(helper).toMatchObject({ task: Activity.Tending, taskSite: hurt.id });
  });
});
