import { describe, expect, it } from 'vitest';
import { Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { addInventory } from '../../packages/engine/src/equipment';
import { point } from '../../packages/engine/src/geometry';
import { partyLevel, partyVerdict, Verdict } from '../../apps/web/src/native/swarm-hud';
import { readyParty, sendParty, partyState } from '../../apps/web/src/native/title-party';
import { OrderLedger } from '../../apps/web/src/native/title-orders';
import { Traffic } from '../../apps/web/src/native/title-traffic';
import { Town } from '../../packages/engine/src/town';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { dungeonChallenge } from '../../packages/engine/src/dungeon-siege';
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
describe('the title party', () => {
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
    const ctx = { town, free: [...town.folk], party: new Set<number>(), step: 0, seed: 5, ledger: new OrderLedger(),
      later: new Map<string, number>(), staffed: new Map<number, number>(), efficiency: new WorkEfficiency(town), traffic: new Traffic() };
    expect(sendParty(ctx, state)).toBe(true);
    expect(state.members).toHaveLength(10);
    expect(state.members).not.toContain(10);
    expect(state.members).not.toContain(11);
  });
});
