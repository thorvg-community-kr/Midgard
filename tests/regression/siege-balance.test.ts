import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Calling, Person, Role } from '../../packages/engine/src/person';
import { gateOrder } from '../../packages/engine/src/gate-progression';
import { monsterEntrance } from '../../packages/engine/src/town-monsters';
import { isShield, itemCatalog } from '../../packages/engine/src/equipment';
import { CombatCue } from '../../packages/engine/src/combat-events';
import { dungeonChallenge, dungeonStatus, dungeonWeaponTier } from '../../packages/engine/src/dungeon-siege';

const letters: Record<string, Calling> = { W: Calling.Warrior, R: Calling.Ranger, M: Calling.Mage, C: Calling.Cleric };
const shape = (c: Calling) => (c === Calling.Warrior ? 'sword' : c === Calling.Ranger ? 'bow' : c === Calling.Mage ? 'staff' : 'mace');
type Gear = 'wood' | 'stone' | 'iron' | 'regional';
const tierOf: Record<Gear, number> = { wood: 1, stone: 2, iron: 3, regional: 4 };
// Regional weapons are worn with the same iron protection as their predecessors.
function arm(p: Person, gear: Gear) {
  const made = itemCatalog.filter((i) => i.workshop !== null && i.minimumLevel <= p.level),
    weapon = made.find((i) => i.tier === tierOf[gear] && i.category === 'weapon' && i.visual === shape(p.calling)),
    protection = made.filter((i) => i.tier === Math.min(3, tierOf[gear])),
    shield = weapon?.hands === 1 ? protection.find(isShield) : undefined,
    armor = protection.find((i) => i.category === 'armor' && i.slots.includes('body'));
  let slot = 0;
  for (const [item, place] of [[weapon, 'weapon'], [shield, 'offhand'], [armor, 'body']] as const) {
    if (!item) continue;
    p.inventory[slot] = { item: item.id, quantity: 1 };
    p.equipment[place] = ++slot;
  }
}

function assault(map: WorldMap, tier: number, gear: Gear, size?: number, level?: number) {
  const town = new Town(map, 176, false), camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(0);
  const gate = gateOrder(town)[tier - 1], site = town.map().dungeons()[gate];
  site.discovered = true;
  const challenge = dungeonChallenge(town, gate), mouth = monsterEntrance(site);
  const members = Array.from({ length: size ?? challenge.partySize }, (_, i) => {
    const angle = i * 2.39996, radius = Math.sqrt(i) * 0.55;
    const slot = { x: mouth.x + Math.cos(angle) * radius, y: mouth.y + Math.sin(angle) * radius };
    const at = town.grid.walkable(slot) && town.grid.clear(mouth, slot, Infinity) ? slot : town.grid.nearestWalkable(mouth);
    const p = town.makePerson(Role.Resident, letters['WRMC'[i % 4]], at);
    p.level = level ?? challenge.level;
    p.village = camp.id;
    p.stress = 0;
    p.food = p.rest = p.hydration = 1;
    arm(p, gear);
    town.folk.push(p);
    return p;
  });
  town.reveal(mouth.x, mouth.y, 14);
  expect(town.orderAttackDungeon(members.map(p => p.id), gate)).toBe(true);
  const structureHealth = dungeonStatus(town, gate).maxHealth;
  let seconds = 0, breachAt = -1, finalWave = 0, guardianHealth = 0, summonedAt = -1, warned = false;
  for (; seconds < 290; seconds += 0.2) {
    town.advance(0.2);
    const status = dungeonStatus(town, gate);
    if (status.phase === 'summoning' && breachAt < 0) breachAt = seconds;
    const guardian = town.sieges[gate]?.guardian;
    for (const cue of town.events) {
      if (cue.cue === CombatCue.SiegeHorde && cue.gate === gate && summonedAt < 0) {
        finalWave = cue.amount;
        guardianHealth = town.creature(cue.creature)!.vigor;
        expect(town.creature(cue.creature)!.level).toBe(challenge.level);
        summonedAt = seconds;
      }
      if (cue.cue === CombatCue.Telegraph && cue.creature === guardian) warned = true;
    }
    if (status.phase === 'sealed' || (breachAt >= 0 && status.phase === 'standing')) break;
  }
  const defenderWaves = town.notices.filter(line => line === `Defenders pour out of ${site.name}.`).length;
  return { town, gate, challenge, seconds, breachAt, defenderWaves, finalWave, members, structureHealth, guardianHealth, summonedAt, warned };
}

describe('outdoor dungeon campaign difficulty', () => {
  let map: WorldMap;
  beforeAll(() => { map = WorldMap.generate(5); }, 120000);

  // Mixed parties carry the gear available as the settlement grows. They use ordinary orders and automatic skills.
  const gearByTier: Gear[] = ['stone', 'stone', 'iron', 'iron', 'regional', 'regional', 'regional', 'regional'];
  it.each(gearByTier.map((gear, i) => [i + 1, gear] as const))(
    'lets the recommended party seal tier %i using %s equipment', (tier, gear) => {
      const r = assault(map, tier, gear);
      expect(r.challenge).toEqual({ tier, level: 10 * tier, partySize: 9 + tier });
      expect(dungeonWeaponTier(tier)).toBe(gear);
      expect(r.breachAt).toBeGreaterThan(8);
      expect(r.defenderWaves).toBe(3);
      expect(r.finalWave).toBeGreaterThan(2 * r.members.length);
      expect(r.guardianHealth).toBeGreaterThan(r.structureHealth);
      expect(r.warned).toBe(true);
      expect(r.seconds - r.summonedAt).toBeGreaterThan(8);
      expect(dungeonStatus(r.town, r.gate).phase).toBe('sealed');
    }, 120000,
  );

  it('lets the recommended final party clear the defenders on another approach', () => {
    const r = assault(WorldMap.generate(3), 8, 'regional');
    expect(r.defenderWaves).toBe(3);
    expect(dungeonStatus(r.town, r.gate).phase).toBe('sealed');
  }, 120000);

  it.each([[1, 4, 4, 'wood'], [8, 40, 13, 'iron']] as const)(
    'lets tier %i revive against an understrength party of level %i', (tier, level, size, gear) => {
      const r = assault(map, tier, gear, size, level);
      expect(r.summonedAt).toBeGreaterThan(0);
      expect(dungeonStatus(r.town, r.gate)).toMatchObject({ phase: 'standing', health: r.structureHealth });
    }, 120000,
  );
});
