import type { TownState } from './town-state';
import { Activity, experienceForLevels, Monster, Person } from './person';
import { canControl, isPlayerResident } from './faction';
import { gateCenter, gateOrder, raidSeat } from './gate-progression';
import { gateSealed, sealable, sealFloors, sealProgress } from './gate-seals';
import { add, distance, normalized, point, rotated, scale, sub, type Point } from './geometry';
import { f32 } from './numeric';
import { CombatCue, MonsterRank } from './combat-events';
import { rankMonster, rankRules } from './monster-ranks';
import { breedOf, monsterEntrance, monsterBite, reachOf, shoots, type BiteTown } from './town-monsters';
import { worldHoard } from './realm-layout';
import { StrikeKind } from './skill-catalog';
import { type Resources } from './building-catalog';
import { World } from './world-types';

export interface DungeonSiege {
  health: number;
  summonAt: number;
  reviveAt: number;
  /** Every member of this particular challenge, including its guardian, carries this id as its brood. */
  guardian: number;
  village: number;
}
export const siegeRules = {
  summonSeconds: 3, reviveSeconds: 120, blastRadius: 4, knockback: 2.4,
  firstSlam: 3, slamPower: 0.9,
};
interface AttackTown extends TownState {
  setOrder(p: Person, task: Activity, target?: number): void;
  walkTo(p: Person, to: Point): boolean;
  walk(p: Person, dt: number): void;
  reveal(x: number, y: number, radius: number): void;
  blowStrength(p: Person): number;
  settlementOf(p: Person): number;
}
interface RewardTown extends TownState {
  credit(prize: Resources, village: number): void;
  changeRenown(village: number, amount: number): void;
  rewardExperience(p: Person, amount: number, includeDowned?: boolean): void;
}
/** Distance from the founding shore orders the campaign. Days, survivors and later camps cannot move a tier. */
export function dungeonChallenge(town: TownState, gate: number) {
  const tier = gateOrder(town).indexOf(gate) + 1;
  return { tier, level: Math.min(Person.maximumLevel, tier * 10), partySize: tier ? 9 + tier : 0 };
}
export function dungeonWeaponTier(tier: number): 'stone' | 'iron' | 'regional' {
  return tier <= 2 ? 'stone' : tier <= 4 ? 'iron' : 'regional';
}
type DungeonChallenge = ReturnType<typeof dungeonChallenge>;
function gateHealth(town: TownState, gate: number): number {
  const { partySize, level } = dungeonChallenge(town, gate);
  return Math.round(partySize * (48 + 2.4 * level));
}
export function dungeonStatus(town: TownState, gate: number) {
  const siege = town.sieges[gate], maxHealth = gateHealth(town, gate);
  const phase = gateSealed(town, gate) ? 'sealed' : !siege || siege.health > 0 ? 'standing'
    : siege.guardian < 0 ? 'summoning' : 'defending';
  return {
    phase, health: phase === 'sealed' ? 0 : siege?.health ?? maxHealth, maxHealth,
    remaining: siege && siege.health === 0 ? Math.max(0, (phase === 'summoning' ? siege.summonAt : siege.reviveAt) - town.time) : 0,
    creatures: phase === 'defending' && siege ? town.beasts.filter(b => b.health > 0 && b.lair === gate && b.brood === siege.guardian).length : 0,
  } as const;
}
export function dungeonAttackProblem(town: TownState, gate: number): string {
  const site = town.world.dungeons()[gate];
  if (!site?.discovered) return 'No known dungeon there';
  if (!sealable(site)) return 'A neutral giant dwelling';
  if (gateSealed(town, gate)) return 'This dungeon is sealed.';
  if (town.sieges[gate]?.health === 0) return 'Defeat the guardian and its horde.';
  return '';
}
/** Negative fighting targets below the no-target sentinel encode a structure, keeping ordinary orders saveable. */
export function targetedDungeon(p: Person): number {
  return p.ordered && p.task === Activity.Fighting && p.attackPerson < 0 && p.taskSite <= -2 ? -p.taskSite - 2 : -1;
}
export function orderAttackDungeon(this: AttackTown, ids: number[], gate: number): boolean {
  if (dungeonAttackProblem(this, gate)) return false;
  const entrance = this.grid.nearestWalkable(monsterEntrance(this.world.dungeons()[gate]));
  let ordered = false;
  for (const p of this.folk) {
    if (!ids.includes(p.id) || !canControl(p, this.controlFaction) || !this.walkTo(p, entrance)) continue;
    this.setOrder(p, Activity.Fighting, -gate - 2);
    p.goal = entrance;
    p.activity = Activity.Fighting;
    ordered = true;
  }
  return ordered;
}
function pushFrom(town: TownState, unit: Person | Monster, center: Point) {
  const gap = distance(unit.position, center);
  if (gap > siegeRules.blastRadius) return false;
  const away = gap < 0.01 ? rotated(point(1, 0), unit.id * 2.39996) : normalized(sub(unit.position, center));
  const start = unit.position;
  // Stop at the last clear point so the shock cannot throw a unit through the ridge or into water.
  for (let step = 1; step <= 8; ++step) {
    const next = add(start, scale(away, siegeRules.knockback * step / 8));
    if (!town.grid.walkable(next) || !town.grid.clear(start, next, Infinity)) break;
    unit.position = next;
  }
  unit.path = [];
  return true;
}
function collapse(town: AttackTown, gate: number, siege: DungeonSiege) {
  const site = town.world.dungeons()[gate], center = monsterEntrance(site);
  siege.summonAt = town.time + siegeRules.summonSeconds;
  siege.reviveAt = siege.summonAt + siegeRules.reviveSeconds;
  let fighters = 0;
  for (const p of town.folk) {
    const wasAttacking = targetedDungeon(p) === gate;
    const destination = p.path.at(-1);
    if (!p.inside && !p.crossingDoorway() && p.health > 0 && pushFrom(town, p, center) && !wasAttacking && destination)
      town.walkTo(p, destination);
    if (!wasAttacking) continue;
    ++fighters;
    // The attack becomes an attack-move to the breach. Late arrivals can still help their companions.
    p.task = Activity.Moving;
    p.taskSite = p.target = p.foe = -1;
    p.activity = Activity.Moving;
    p.goal = town.grid.nearestWalkable(center);
    p.aggressive = true;
    town.walkTo(p, p.goal);
  }
  for (const group of [town.beasts, town.animals])
    for (const m of group) if (m.health > 0 && !m.insideLair) pushFrom(town, m, center);
  ++town.chronicle.partiesLed;
  town.chronicle.largestParty = Math.max(town.chronicle.largestParty, fighters);
  town.emit(CombatCue.Slam, center, { gate, radius: siegeRules.blastRadius });
  town.notify(`${site.name} has fallen. A guardian is gathering its horde.`);
  ++town.changes;
}
export function attackDungeon(town: AttackTown, p: Person, gate: number, dt: number): void {
  if (dungeonAttackProblem(town, gate)) {
    p.path = [];
    p.ordered = false;
    p.task = p.activity = Activity.Idle;
    p.taskSite = p.target = -1;
    return;
  }
  p.activity = Activity.Fighting;
  const site = town.world.dungeons()[gate], mouth = monsterEntrance(site);
  const at = p.goal;
  if (p.inside || distance(p.position, at) > reachOf(p)) {
    if (!p.path.length && !town.walkTo(p, at)) return;
    town.walk(p, dt);
    if (!town.world.revealedWithin(p.position, 3.5)) town.reveal(p.position.x, p.position.y, 7.5);
    return;
  }
  p.path = [];
  if (town.time < p.ready) return;
  const siege = town.sieges[gate] ??= { health: gateHealth(town, gate), summonAt: -1, reviveAt: -1, guardian: -1, village: town.settlementOf(p) };
  if (!town.opened(gate)) town.open[gate] = 1;
  const damage = town.blowStrength(p);
  siege.health = Math.max(0, f32(siege.health - damage));
  p.ready = town.time + 1;
  p.swingAt = town.time;
  town.blows.push({ serial: town.nextBlow++, from: { ...p.position }, to: mouth, damage: Math.round(damage * 10),
    ranged: shoots(p), onPerson: false, person: p.id, attacker: p.id, at: town.time, strike: StrikeKind.Single, primary: true });
  if (siege.health === 0) collapse(town, gate, siege);
}
/** The guardian can weather the opening volley. Most of its brood fall to a single armed blow. */
function prepareDefender(town: TownState, monster: Monster, rank: MonsterRank, challenge: DungeonChallenge) {
  const { tier, level, partySize } = challenge;
  const guardian = rank === MonsterRank.Guardian, brute = rank === MonsterRank.Brute;
  monster.level = guardian || brute ? level : level - 2;
  const bite = guardian ? 0.035 + level * 0.013 : (brute ? 0.026 : 0.010) * (1 + level * 0.08);
  const guardianHealth = partySize * (64 + level * 3.2) * (1 + (tier - 1) * 0.08);
  monster.health = f32(guardian ? Math.round(guardianHealth) : brute ? 8 + 1.3 * level : 1.8 + 0.07 * level);
  monster.strength = f32(bite / breedOf(town.world.dungeons()[monster.lair].kind).bite);
  return rankMonster(monster, rank, false);
}
/** Earlier outdoor sieges used distance alone. Carry damage already dealt into the fixed campaign tiers. */
export function migrateSiegeStrength(town: TownState, gate: number, siege: DungeonSiege, version: number) {
  const far = distance(gateCenter(town.world.dungeons()[gate]), town.world.camp());
  const oldHealth = (32 + Math.min(96, Math.round(far))) * (version === 25 ? 1 : 5);
  siege.health = f32(gateHealth(town, gate) * Math.min(1, siege.health / oldHealth));
  if (siege.guardian < 0) return;
  const challenge = dungeonChallenge(town, gate);
  for (const monster of town.beasts) {
    if (monster.lair !== gate || monster.brood !== siege.guardian || monster.health <= 0) continue;
    const fraction = monster.vigor > 0 ? Math.min(1, monster.health / monster.vigor) : 1;
    prepareDefender(town, monster, monster.rank, challenge);
    monster.health = f32(monster.vigor * fraction);
  }
}
function summon(town: TownState, gate: number, siege: DungeonSiege) {
  const site = town.world.dungeons()[gate], at = town.grid.nearestWalkable(monsterEntrance(site));
  const challenge = dungeonChallenge(town, gate);
  const count = challenge.partySize * 2 + 2 * challenge.tier;
  siege.guardian = town.nextMonster;
  for (let i = 0; i <= count; ++i) {
    const slot = add(at, rotated(point(0.65 + (i % 4) * 0.34, 0), i * 2.39996));
    const position = i && town.grid.walkable(slot) && town.grid.clear(at, slot, Infinity) ? slot : { ...at };
    const monster = new Monster(town.nextMonster++, gate, position);
    const rank = i === 0 ? MonsterRank.Guardian : i % 10 === 0 ? MonsterRank.Brute : MonsterRank.Swarmer;
    monster.brood = siege.guardian;
    monster.home = { ...at };
    monster.bornAt = town.time;
    monster.angry = true;
    town.beasts.push(prepareDefender(town, monster, rank, challenge));
  }
  town.emit(CombatCue.SiegeHorde, at, { gate, creature: siege.guardian, amount: count + 1 });
  town.notify(`Defeat the guardian and every defender before ${site.name} rises again.`);
  ++town.changes;
}
function seal(town: RewardTown, gate: number, siege: DungeonSiege) {
  const site = town.world.dungeons()[gate], world = town.world.destination(site);
  while (town.depth.length <= gate) town.depth.push(0);
  town.depth[gate] = sealFloors;
  const hoard = worldHoard(world, 0, 4);
  hoard.gold += 150;
  hoard.ironOre += 4;
  if (world === World.Niflheim || world === World.Jotunheim) hoard.frostwood += 6;
  if (world === World.Muspelheim) hoard.cinderOre += 6;
  const village = town.villages.some(v => v.camp === siege.village) ? siege.village : raidSeat(town, gate)?.id ?? -1;
  town.credit(hoard, village);
  town.changeRenown(village, 15);
  const at = monsterEntrance(site);
  const experience = experienceForLevels(dungeonChallenge(town, gate).level, 5);
  for (const p of town.folk)
    if (isPlayerResident(p) && !p.inside && distance(p.position, at) <= 12) town.rewardExperience(p, experience, true);
  const { sealed, total } = sealProgress(town);
  town.notify(sealed === total ? `${site.name} is sealed. Every gate is closed: Midgard is safe!`
    : `${site.name} is sealed for good (${sealed} of ${total} gates closed)`);
}
export function advanceSieges(town: RewardTown) {
  for (let gate = 0; gate < town.sieges.length; ++gate) {
    const siege = town.sieges[gate];
    if (!siege || siege.health > 0) continue;
    if (siege.guardian < 0) {
      if (town.time >= siege.summonAt) summon(town, gate, siege);
      continue;
    }
    const defender = (b: Monster) => b.lair === gate && b.brood === siege.guardian;
    if (!town.beasts.some(b => b.health > 0 && defender(b))) seal(town, gate, siege);
    else if (town.time < siege.reviveAt) continue;
    else {
      town.beasts = town.beasts.filter(b => {
        if (!defender(b)) return true;
        town.combatState.forgetCreature(b.id);
        return false;
      });
      town.notify(`${town.world.dungeons()[gate].name} has risen again.`);
    }
    town.sieges[gate] = null;
    ++town.changes;
  }
  while (town.sieges.length && !town.sieges.at(-1)) town.sieges.pop();
}
/** The guardian stays rooted through the wind-up so a resident can move out of its circle. */
export function guardianSlam(town: BiteTown, beast: Monster, prey?: Person): boolean {
  if (beast.rank !== MonsterRank.Guardian || beast.brood !== beast.id) return false;
  if (beast.windupUntil >= 0) {
    if (town.time >= beast.windupUntil) {
      for (const p of town.folk)
        if (!p.inside && p.health > 0 && distance(p.position, beast.position) <= rankRules.slamRadius)
          monsterBite(town, beast, p, breedOf(town.world.dungeons()[beast.lair].kind), rankRules.slamPower * siegeRules.slamPower, true);
      town.emit(CombatCue.Slam, beast.position, { creature: beast.id, radius: rankRules.slamRadius });
      beast.windupUntil = -1;
      town.combatState.slamAt.set(beast.id, town.time + rankRules.slamPause);
    }
    return true;
  }
  if (!prey || distance(prey.position, beast.position) > rankRules.slamRadius) return false;
  const due = town.combatState.slamAt.get(beast.id);
  if (due === undefined) town.combatState.slamAt.set(beast.id, town.time + siegeRules.firstSlam);
  else if (town.time >= due) {
    beast.path = [];
    beast.windupUntil = town.time + rankRules.slamWindup;
    town.emit(CombatCue.Telegraph, beast.position, { creature: beast.id, radius: rankRules.slamRadius, duration: rankRules.slamWindup });
    return true;
  }
  return false;
}
