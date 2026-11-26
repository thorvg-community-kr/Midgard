import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Town } from '../../packages/engine/src/town';
import { Activity, Calling, Monster, Role } from '../../packages/engine/src/person';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Building } from '../../packages/engine/src/town-models';
import { CombatCue, MonsterRank } from '../../packages/engine/src/combat-events';
import { dungeonChallenge, dungeonStatus, siegeRules, targetedDungeon } from '../../packages/engine/src/dungeon-siege';
import { gateActive } from '../../packages/engine/src/gate-progression';
import { gateSealed } from '../../packages/engine/src/gate-seals';
import { add, distance, point } from '../../packages/engine/src/geometry';
import { breedOf, monsterBite, monsterEntrance } from '../../packages/engine/src/town-monsters';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';

function settlement() {
  const map = new WorldMap(), size = 64;
  map.columns = map.rows = size;
  map.mapSeed = 7;
  map.origin = point(6, 7);
  map.tiles = Array.from({ length: size * size }, (_, i) => ({
    ...makeTile(), terrain: Math.floor(i / size) < 22 ? Terrain.Grass : Terrain.Sea, revealed: true,
  }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array((size * 2 + 1) ** 2));
  map.layer(Layer.Land).fill(1);
  map.sites = [
    { kind: DungeonKind.Cave, origin: point(16, 8), name: 'East Gate', discovered: true },
    { kind: DungeonKind.Crypt, origin: point(31, 8), name: 'Far Gate', discovered: true },
    { kind: DungeonKind.GiantHall, origin: point(40, 8), name: 'Stone Hall', discovered: true },
  ];
  const town = new Town(map, size, false), camp = new Building(0, Structure.Camp, map.camp(), 0, 0);
  town.placed.push(camp);
  town.nextId = 1;
  town.migrateSettlements();
  const mouth = monsterEntrance(map.sites[0]);
  const members = [-0.7, 0.7].map(offset => {
    const p = town.makePerson(Role.Resident, Calling.Warrior, add(mouth, point(offset, 0)));
    p.village = 0;
    town.folk.push(p);
    return p;
  });
  town.reveal(mouth.x, mouth.y, 12);
  return { town, mouth, members, ids: members.map(p => p.id) };
}
const resume = (town: Town) => decodeTown(encodeTown(town), map => new Town(map, 64, false, true));
function hitDungeon(town: Town, resident: number, damage: number, gate = 0) {
  const first = town.nextMonster, before = dungeonStatus(town, gate).health, p = town.person(resident)!;
  p.ready = town.time;
  const strength = vi.spyOn(town, 'blowStrength').mockReturnValueOnce(damage);
  town.fight(p, 0);
  strength.mockRestore();
  expect(dungeonStatus(town, gate).health).toBe(Math.max(0, before - damage));
  return town.beasts.filter(m => m.id >= first && m.lair === gate);
}
function breach() {
  const game = settlement(), { town, ids, members } = game;
  expect(town.orderAttackDungeon(ids, 0)).toBe(true);
  town.fight(members[0], 0);
  town.sieges[0]!.health = 0.2;
  const before = members.map(p => ({ ...p.position }));
  town.fight(members[1], 0);
  expect(dungeonStatus(town, 0).phase).toBe('summoning');
  return { ...game, before };
}
function emerge(town: Town) {
  town.time = town.sieges[0]!.summonAt;
  town.stir(0);
  const state = town.sieges[0]!;
  return town.beasts.filter(b => b.lair === 0 && b.brood === state.guardian);
}
describe('sieges in Midgard', () => {
  it('rates hostile dungeons by their distance from the founding shore, independently of the day', () => {
    const { town } = settlement();
    const cave = town.world.sites[0];
    town.world.sites = [town.world.sites[2], ...Array.from({ length: 9 }, (_, index) =>
      ({ ...cave, origin: point(10 + index * 4, 8) })).reverse()];
    expect(dungeonChallenge(town, 0).tier).toBe(0);
    expect(dungeonChallenge(town, 9)).toEqual({ tier: 1, level: 10, partySize: 10 });
    town.days = 90;
    town.depth[9] = 3;
    expect(dungeonChallenge(town, 1)).toEqual({ tier: 9, level: 90, partySize: 18 });
  });
  it('upgrades the strengths in a version 25 battle without taking away damage already dealt', () => {
    // The second dungeon was half broken. The first had summoned its guardian, with 60% health left.
    const archive = gunzipSync(readFileSync(new URL('./fixtures/outdoor-siege-v25.goldfantasy.gz', import.meta.url))).toString();
    const loaded = decodeTown(archive, map => new Town(map, 64, false, true));
    const damaged = dungeonStatus(loaded, 1), guardian = loaded.creature(loaded.sieges[0]!.guardian)!;
    expect(damaged.health).toBe(damaged.maxHealth / 2);
    expect(guardian.vigor).toBeCloseTo(1248);
    expect(guardian.level).toBeGreaterThan(1);
    expect(guardian.health / guardian.vigor).toBeCloseTo(0.6);
    const savedAgain = resume(loaded);
    expect(dungeonStatus(savedAgain, 1)).toEqual(damaged);
    expect(savedAgain.creature(guardian.id)?.health).toBe(guardian.health);
    const entrance = monsterEntrance(savedAgain.world.sites[1]);
    const p = savedAgain.makePerson(Role.Resident, Calling.Warrior, entrance);
    savedAgain.folk.push(p);
    expect(savedAgain.orderAttackDungeon([p.id], 1)).toBe(true);
    p.position = { ...p.goal };
    expect(hitDungeon(savedAgain, p.id, 1, 1)).toHaveLength(0);
    expect(hitDungeon(savedAgain, p.id, damaged.maxHealth / 4 - 1, 1).length).toBeGreaterThan(0);
  });
  it('retunes wounded version 27 monsters once while preserving first-raid health and livestock', () => {
    // This archive was written before the rebalance with a wounded guardian, two raiders and a cow.
    const archive = gunzipSync(readFileSync(new URL('./fixtures/outdoor-monsters-v27.goldfantasy.gz', import.meta.url))).toString();
    const loaded = decodeTown(archive, map => new Town(map, 64, false, true));
    const guardian = loaded.creature(loaded.sieges[0]!.guardian)!;
    const raider = loaded.creature(24)!, scout = loaded.creature(43)!;
    expect(guardian.vigor).toBeCloseTo(960 * 1.3);
    expect(guardian.health / guardian.vigor).toBeCloseTo(0.6);
    expect(raider.vigor).toBeCloseTo(8.2656 * 1.3);
    expect(raider.health / raider.vigor).toBeCloseTo(0.5);
    expect(raider.strength).toBeCloseTo(0.29 * 0.8);
    expect(scout).toMatchObject({ level: 1, health: 0.25, vigor: 1 });
    expect(scout.strength).toBeCloseTo(0.25 * 0.8);
    expect(loaded.animals.find(a => a.id === 44)).toMatchObject({ health: 10, vigor: 12, strength: 1 });
    const saved = encodeTown(loaded);
    expect(Buffer.from(saved.slice(17), 'hex').readUInt32LE(0)).toBe(28);
    expect(encodeTown(resume(loaded))).toBe(saved);

    // The extra health still earns the same bounty and experience for this third-level raider.
    const fighter = loaded.folk[0], experience = vi.spyOn(loaded, 'rewardExperience');
    const ledger = loaded.economy(loaded.settlementAt(raider.position)).today, bounty = ledger.bounty;
    loaded.hurtCreature(raider, raider.health, fighter);
    expect(experience).toHaveBeenCalledWith(fighter, 11);
    loaded.stir(0);
    expect(ledger.bounty - bounty).toBe(4);
  });
  it('gives the first guardian and its horde more staying power and softer individual hits', () => {
    const { town, mouth } = breach(), horde = emerge(town);
    const target = town.makePerson(Role.Resident, Calling.Settler, mouth);
    const breed = breedOf(town.world.sites[0].kind);
    for (const [rank, health, bite] of [
      [MonsterRank.Swarmer, 3.25, 0.0144],
      [MonsterRank.Brute, 27.3, 0.03744],
      [MonsterRank.Guardian, 1248, 0.132],
    ] as const) {
      const beast = horde.find(m => m.rank === rank)!;
      expect(beast.health).toBeCloseTo(health);
      target.health = 1;
      monsterBite(town, beast, target, breed);
      const damage = (1 - target.health) * target.vitalityMultiplier();
      expect(damage).toBeCloseTo(bite, 5);
    }
  });
  it('releases a larger, stronger wave at each quarter, including across saves and hits from different settlers', () => {
    const game = settlement(), { ids, mouth } = game;
    let town = game.town;
    expect(town.orderAttackDungeon(ids, 0)).toBe(true);
    const full = dungeonStatus(town, 0).maxHealth;
    const waves: Monster[][] = [];
    for (const quarter of [3, 2, 1]) {
      const threshold = full * quarter / 4;
      expect(hitDungeon(town, ids[0], dungeonStatus(town, 0).health - threshold - 1)).toHaveLength(0);
      const wave = hitDungeon(town, ids[1], 1);
      expect(wave.length).toBeGreaterThan(0);
      expect(wave.every(m => m.rank !== MonsterRank.Guardian && m.angry && town.grid.walkable(m.position))).toBe(true);
      for (const m of wave) expect(distance(m.position, mouth)).toBeLessThan(4);
      waves.push(wave);
      town = resume(town);
      for (const m of wave)
        expect(town.creature(m.id)).toMatchObject({ rank: m.rank, level: m.level, health: m.health, strength: m.strength });
      expect(hitDungeon(town, ids[0], 1)).toHaveLength(0);
    }
    expect(hitDungeon(town, ids[0], dungeonStatus(town, 0).health)).toHaveLength(0);
    expect(dungeonStatus(town, 0).phase).toBe('summoning');
    const next = town.nextMonster;
    emerge(town);
    const final = town.beasts.filter(m => m.id >= next && m.lair === 0);
    expect(final.filter(m => m.rank === MonsterRank.Guardian)).toHaveLength(1);
    waves.push(final);
    for (let i = 1; i < waves.length; ++i) {
      expect(waves[i].length).toBeGreaterThan(waves[i - 1].length);
      for (const stat of ['vigor', 'strength', 'level'] as const)
        expect(Math.min(...waves[i].map(m => m[stat]))).toBeGreaterThan(Math.min(...waves[i - 1].map(m => m[stat])));
    }
  });
  it('releases every crossed wave on a single lethal strike and summons the guardian only after the collapse', () => {
    const slow = settlement(), fast = settlement();
    const full = dungeonStatus(slow.town, 0).maxHealth;
    expect(slow.town.orderAttackDungeon(slow.ids, 0)).toBe(true);
    expect(fast.town.orderAttackDungeon(fast.ids, 0)).toBe(true);
    const expected = [];
    for (let quarter = 0; quarter < 4; ++quarter) expected.push(...hitDungeon(slow.town, slow.ids[0], full / 4));
    expect(expected.length).toBeGreaterThan(0);
    const waves = hitDungeon(fast.town, fast.ids[0], full + 1);
    const stats = (m: Monster) => [m.rank, m.level, m.vigor, m.strength];
    expect(waves.map(stats)).toEqual(expected.map(stats));
    expect(waves.some(m => m.rank === MonsterRank.Guardian)).toBe(false);
    const loaded = resume(fast.town);
    emerge(loaded);
    loaded.stir(0);
    expect(loaded.beasts.filter(m => m.rank === MonsterRank.Guardian)).toHaveLength(1);
  });
  it.each(['seal', 'revive'])('requires survivors of the first wave to fall, with %s as the outcome', outcome => {
    const game = settlement(), { ids, mouth } = game;
    let town = game.town;
    const full = dungeonStatus(town, 0).maxHealth;
    expect(town.orderAttackDungeon(ids, 0)).toBe(true);
    const firstWave = hitDungeon(town, ids[0], full / 4);
    expect(firstWave.length).toBeGreaterThan(0);
    const survivor = firstWave[0].id;
    hitDungeon(town, ids[1], full);
    emerge(town);
    for (const m of town.beasts) if (m.id !== survivor) m.health = 0;
    const raider = new Monster(town.nextMonster++, 0, mouth);
    raider.raider = true;
    town.beasts.push(raider);
    town.stir(0);
    town = resume(town);
    expect(dungeonStatus(town, 0)).toMatchObject({ phase: 'defending', creatures: 1 });
    if (outcome === 'seal') town.creature(survivor)!.health = 0;
    town.time = town.sieges[0]!.reviveAt;
    town.stir(0);
    expect(town.creature(raider.id)?.health).toBeGreaterThan(0);
    expect(town.creature(survivor)).toBeNull();
    expect(gateSealed(town, 0)).toBe(outcome === 'seal');
    if (outcome === 'revive') {
      expect(dungeonStatus(town, 0)).toMatchObject({ phase: 'standing', health: full });
      expect(town.orderAttackDungeon(ids, 0)).toBe(true);
      const p = town.person(ids[0])!;
      p.position = { ...p.goal };
      expect(hitDungeon(town, p.id, full / 4)).toHaveLength(firstWave.length);
    }
  });
  it('walks and strikes in the open, and a new Move cancels an attack before arrival', () => {
    const { town, members, ids } = settlement();
    members.forEach((p, i) => { p.position = point(6 + i, 10); });
    expect(town.orderAttackDungeon(ids, 2)).toBe(false);
    expect(town.sendExpedition(ids, 0)).toBe(true);
    const continued = resume(town);
    expect(targetedDungeon(continued.person(ids[0])!)).toBe(0);
    continued.orderMove([ids[0]], point(5, 9));
    const status = () => dungeonStatus(continued, 0);
    for (let i = 0; i < 400 && status().health === status().maxHealth; ++i) continued.advance(0.1);
    expect(status().health).toBeLessThan(status().maxHealth);
    expect(continued.hits().some(hit => hit.attacker === ids[1])).toBe(true);
    expect(targetedDungeon(continued.person(ids[0])!)).toBe(-1);
    expect(continued.realmActive()).toBe(false);
    expect(continued.parties).toHaveLength(0);
    expect(resume(continued).sieges[0]).toEqual(continued.sieges[0]);
  });
  it('knocks back residents, waits for the circle and summons one guardian with its own horde after a load', () => {
    const { town, mouth, before, members } = breach();
    for (const [i, p] of members.entries()) {
      expect(distance(p.position, mouth)).toBeGreaterThan(distance(before[i], mouth) + 1);
      expect(town.grid.clear(before[i], p.position, Infinity)).toBe(true);
    }
    expect(town.chronicle.largestParty).toBe(2);
    expect(gateActive(town, 0)).toBe(false);
    const saved = resume(town);
    saved.time += siegeRules.summonSeconds / 2;
    saved.stir(0);
    expect(dungeonStatus(saved, 0)).toMatchObject({ phase: 'summoning', remaining: siegeRules.summonSeconds / 2 });
    expect(saved.beasts.filter(b => b.brood >= 0)).toHaveLength(0);
    const brood = emerge(saved);
    expect(saved.events.some(e => e.cue === CombatCue.Wave)).toBe(false);
    expect(saved.events.find(e => e.cue === CombatCue.SiegeHorde)).toMatchObject({ creature: saved.sieges[0]!.guardian, gate: 0, amount: brood.length });
    expect(brood.filter(b => b.rank === MonsterRank.Guardian)).toHaveLength(1);
    expect(brood.filter(b => b.rank === MonsterRank.Swarmer).length).toBeGreaterThan(4);
    for (const m of brood) expect(distance(m.position, mouth)).toBeLessThan(2);
    const loaded = resume(saved);
    expect(dungeonStatus(loaded, 0)).toEqual(dungeonStatus(saved, 0));
    expect(loaded.beasts.map(b => [b.id, b.health, b.brood])).toEqual(saved.beasts.map(b => [b.id, b.health, b.brood]));
  });
  it.each(['guardian', 'swarmer'])('restores the dungeon at full strength with even one %s alive, preserving unrelated monsters', (survivor) => {
    const { town, mouth } = breach(), brood = emerge(town);
    const living = brood.find(b => b.rank === (survivor === 'guardian' ? MonsterRank.Guardian : MonsterRank.Swarmer))!;
    for (const m of brood) if (m !== living) m.health = 0;
    const other = new Monster(town.nextMonster++, 0, mouth);
    other.home = mouth;
    town.beasts.push(other);
    town.stir(0);
    expect(dungeonStatus(town, 0)).toMatchObject({ phase: 'defending', creatures: 1 });
    const saved = resume(town);
    saved.time = saved.sieges[0]!.reviveAt;
    saved.stir(0);
    expect(dungeonStatus(saved, 0)).toMatchObject({ phase: 'standing', health: dungeonStatus(saved, 0).maxHealth });
    expect(saved.beasts.some(b => b.id === living.id)).toBe(false);
    expect(saved.beasts.some(b => b.id === other.id)).toBe(true);
    expect(gateActive(saved, 0)).toBe(true);
    expect(saved.chronicle.guardiansSlain).toBe(survivor === 'guardian' ? 0 : 1);
  });
  it('seals and pays exactly once on the last kill, even when the deadline falls on that tick', () => {
    const { town, members, mouth } = breach(), brood = emerge(town);
    const bystander = (activity: Activity) => {
      const p = town.makePerson(Role.Resident, Calling.Settler, mouth);
      p.activity = activity;
      town.folk.push(p);
      return p;
    };
    const logger = bystander(Activity.Felling), hunter = bystander(Activity.Fighting), idle = bystander(Activity.Idle);
    const medic = bystander(Activity.Tending), bard = bystander(Activity.Holding);
    bard.calling = Calling.Bard;
    hunter.hunting = true;
    medic.target = members[1].id;
    for (const defender of brood) defender.health = 0;
    town.time = town.sieges[0]!.reviveAt;
    members[0].level = 1;
    members[0].experience = 0;
    members[1].level = 10;
    town.strikeDown(members[1], 'Killed by monsters');
    town.stir(0);
    expect(members[1]).toMatchObject({ level: 15, health: 0, activity: Activity.Downed });
    expect(members[0]).toMatchObject({ level: 6, experience: 0 });
    for (const p of [medic, bard]) expect(p).toMatchObject({ level: 6, experience: 0 });
    for (const p of [logger, hunter, idle]) expect(p).toMatchObject({ level: 1, experience: 0 });
    expect(gateSealed(town, 0)).toBe(true);
    expect(gateSealed(town, 1)).toBe(false);
    expect(town.chronicle.guardiansSlain).toBe(1);
    expect(town.stock(0).gold).toBeGreaterThanOrEqual(150);
    expect(town.stock(0).ironOre).toBeGreaterThan(0);
    const saved = resume(town), prize = saved.stock(0).gold;
    saved.stir(0);
    expect(saved.chronicle.guardiansSlain).toBe(1);
    expect(saved.stock(0).gold).toBe(prize);
    expect(gateActive(saved, 0)).toBe(false);
    expect(saved.orderAttackDungeon(saved.folk.map(p => p.id), 0)).toBe(false);
  });
  it('telegraphs the outdoor guardian slam and lets a player evade or interrupt it', () => {
    const { town, members } = breach(), boss = emerge(town)[0];
    for (const m of town.beasts) if (m !== boss) m.health = 0;
    const [bait, walker] = members;
    bait.position = { ...boss.position };
    walker.position = add(bait.position, point(0.8, 0));
    boss.ready = Infinity;
    town.combatState.slamAt.set(boss.id, town.time);
    town.stir(0);
    expect(town.events.some(e => e.cue === CombatCue.Telegraph && e.creature === boss.id)).toBe(true);
    const evaded = resume(town);
    for (const p of evaded.folk) p.position = add(boss.position, point(4, 0));
    evaded.time = boss.windupUntil;
    evaded.stir(0);
    expect(evaded.folk.every(p => p.health === 1)).toBe(true);
    const saved = resume(town), loaded = saved.beasts.find(m => m.id === boss.id)!;
    expect(saved.events.find(e => e.cue === CombatCue.Telegraph)?.creature).toBe(boss.id);
    // Both fighters stay in reach; only the closest takes the heavy strike.
    saved.time = loaded.windupUntil;
    saved.stir(0);
    expect(saved.person(bait.id)!.health).toBeLessThan(1);
    expect(saved.person(walker.id)!.health).toBe(1);
    // A surviving party can use the recovery to move out before the guardian gives chase.
    saved.person(bait.id)!.inside = true;
    saved.person(walker.id)!.position = add(bait.position, point(4, 0));
    const impact = { ...loaded.position };
    saved.time += siegeRules.slamRecovery / 2;
    saved.stir(0.2);
    expect(loaded.position).toEqual(impact);
    saved.time += siegeRules.slamRecovery;
    saved.stir(0.2);
    expect(distance(loaded.position, impact)).toBeGreaterThan(0);
    walker.calling = Calling.Ranger;
    walker.foe = boss.id;
    expect(town.useAbility([walker.id])).toBe(1);
    expect(boss.windupUntil).toBe(-1);
  });
  it('restores battle speed during a saved guardian wind-up only when the guardian is engaging the player', () => {
    const { town, members } = breach(), boss = emerge(town)[0];
    for (const m of town.beasts) if (m !== boss) m.health = 0;
    const [target, companion] = members;
    target.position = { ...boss.position };
    companion.position = add(boss.position, point(10, 0));
    town.combatState.slamAt.set(boss.id, town.time);
    town.stir(0);
    expect(boss.windupUntil).toBeGreaterThan(town.time);
    expect(resume(town).inCombat()).toBe(true);

    target.faction = 1;
    target.village = -1;
    const neutralFight = resume(town);
    expect(neutralFight.events.some(e => e.cue === CombatCue.Telegraph && e.creature === boss.id)).toBe(true);
    expect(neutralFight.inCombat()).toBe(false);
  });
  it('recovers an old island, its wounded party and earned hoard while keeping an existing seal', () => {
    const { town, members, ids, mouth } = settlement();
    town.open[0] = 1;
    town.depth = [1, 3, 0];
    for (const p of members) { p.inside = true; p.activity = Activity.Expedition; }
    town.parties.push({ dungeon: 0, floor: 0, members: ids });
    // Build exactly the island and return stone an old writer saved.
    town.advanceRealm(0);
    expect(town.realmActive()).toBe(true);
    expect(town.world.sites.at(-1)?.kind).toBe(DungeonKind.Return);
    const area = town.realmArea!;
    const neutral = town.makePerson(Role.Guest, Calling.Traveller, members[0].position);
    neutral.faction = 2;
    town.folk.push(neutral);
    town.strikeDown(members[1], 'Killed by monsters');
    town.realmLoot.ironOre = 13;
    const loaded = resume(town);
    expect(loaded.world.sites).toHaveLength(3);
    expect(loaded.realmActive()).toBe(false);
    expect(loaded.world.at(area.x + Math.floor(area.size / 2), area.y + Math.floor(area.size / 2)).terrain).toBe(Terrain.Sea);
    expect(loaded.person(ids[1])?.activity).toBe(Activity.Downed);
    expect(loaded.stock(0).ironOre).toBe(13);
    expect(loaded.person(neutral.id)?.faction).toBe(2);
    expect(gateSealed(loaded, 1)).toBe(true);
    expect(loaded.depth[0]).toBe(1);
    for (const p of loaded.folk) expect(distance(p.position, mouth)).toBeLessThan(3);
    expect(resume(loaded).stock(0).ironOre).toBe(13);
  });
});
