import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { Calling, Person, Role } from '../../packages/engine/src/person';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { sealable } from '../../packages/engine/src/gate-seals';
import { lairOf } from '../../packages/engine/src/town-monsters';
import { add, point } from '../../packages/engine/src/geometry';
import { CombatCue, MonsterRank } from '../../packages/engine/src/combat-events';
import { RaidKind } from '../../packages/engine/src/raid-progression';
import { itemCatalog } from '../../packages/engine/src/equipment';

const cues = (town: Town, cue: CombatCue) => town.combatEvents().filter((event) => event.cue === cue);
/** The best weapon of a shape the resident may wield. */
function arm(p: Person, visual: string) {
  const item = itemCatalog
    .filter((i) => i.category === 'weapon' && i.visual === visual && i.minimumLevel <= p.level)
    .sort((a, b) => b.attackBonus - a.attackBonus)[0];
  const index = p.inventory.findIndex((stack) => !stack);
  p.inventory[index] = { item: item.id, quantity: 1 };
  p.equipment.weapon = index + 1;
}
describe('raids come as waves', () => {
  function settlement() {
    const town = new Town(5, 48, false),
      camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    Object.assign(town.stock(0), new Resources(200, 60, 60, 60, 0, 60, 20, 20));
    const gate = town.map().dungeons().findIndex((site) => site.kind !== DungeonKind.GiantHall && sealable(site));
    town.map().dungeons()[gate].discovered = true;
    return { town, camp, gate };
  }
  it('sends many weak monsters with a few leaders and says so', () => {
    const { town } = settlement();
    town.days = 35;
    town.raidCount = 12;
    town.summonRaid(RaidKind.Pack);
    const raiders = town.monsters(),
      swarm = raiders.filter((m) => m.rank === MonsterRank.Swarmer);
    expect(swarm.length).toBeGreaterThan(raiders.length / 2);
    expect(raiders.some((m) => m.rank === MonsterRank.Brute)).toBe(true);
    expect(swarm[0].health).toBeLessThan(raiders[0].health / 3);
    expect(cues(town, CombatCue.Wave)).toEqual([expect.objectContaining({ amount: raiders.length })]);
  });
  it('is held at the first raids by an unstaffed watchtower, the ward and a few fighters', () => {
    const { town, camp, gate } = settlement(),
      at = camp.center,
      tower = new Building(town.nextId++, Structure.Watchtower, town.grid.nearestWalkable(add(at, point(3, 3))), 0, 0);
    tower.village = 0;
    town.placed.push(tower);
    town.tick(0);
    const fighter = (calling: Calling, visual: string, offset: number) => {
      const p = town.makePerson(Role.Resident, calling, town.grid.nearestWalkable(add(at, point(offset, -2))));
      town.folk.push(p);
      p.level = 2;
      p.home = p.village = 0;
      p.food = p.rest = p.hydration = 1;
      p.stress = 0;
      arm(p, visual);
      return p;
    };
    const guard = fighter(Calling.Settler, 'bow', 0),
      party = [fighter(Calling.Warrior, 'sword', -1), fighter(Calling.Warrior, 'sword', 1), fighter(Calling.Ranger, 'bow', 2)];
    guard.position = tower.door();
    town.wardUntil = Infinity;
    town.days = 2;
    town.editHour(22);
    town.summonRaid(RaidKind.Pack);
    const size = town.monsters().filter((m) => m.raider).length;
    expect(size).toBeGreaterThan(4);
    // The raiders find the settlement; the fighters meet them.
    town.orderAttackMove(
      party.map((p) => p.id),
      lairOf(town.map().dungeons()[gate]),
    );
    for (let i = 0; i < 1800 && town.raiding(); ++i) {
      town.wildlifeDay = town.days;
      town.advance(0.1);
      if (i % 50 === 0) town.orderAttackMove(party.map((p) => p.id), town.monsters().find((m) => m.raider)?.position ?? at);
    }
    expect(town.raiding()).toBe(false);
    expect(town.chronicle.raidsRepelled).toBe(1);
    expect(town.fallen).toHaveLength(0);
    expect(town.building(camp.id)).not.toBeNull();
  }, 120000);
});
