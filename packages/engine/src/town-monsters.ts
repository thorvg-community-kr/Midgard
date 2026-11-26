import { attackDungeon, dungeonAttackProblem, targetedDungeon } from './dungeon-siege';
import { belongsToFaction, canControl } from './faction';
// Native town_monsters.cpp combat, raids, expeditions and damage. Native RNG order is retained.
import { TownState } from './town-state';
import { Person, Monster, Expedition, Role, Calling, Activity, adventurer, experienceForLevel } from './person';
import { Building, Check } from './town-models';
import { Structure, Resources, isSeat, structureSpec, describe } from './building-catalog';
import { Dungeon, DungeonKind, impassable } from './world-types';
import { WorldMap } from './world-map';
import { Point, point, add, sub, scale, normalized, rotated, distance } from './geometry';
import { f32 as f, lround } from './numeric';
import { CampEconomy } from './camp-economy';
import { animalSpec } from './wildlife';
import { spreadFighter } from './person-navigation';
import { planRaiderApproach } from './monster-navigation';
import { campTier, dungeonThreat, raidKind, raidMight, raidMonsterLevel, raidMuster, raidShape, RaidKind, siegeMonsterLevel } from './raid-progression';
import { gateActive, gateCenter, inRaidedVillage, raidSeat, raidSources, updateGateOpenings } from './gate-progression';
import { attackDamage, attackReach, armorProtection, combatItem, equippedItem, raisedShield } from './equipment';
import { songOf, wardOf } from './calling-auras';
import { CombatCue, MonsterRank, combatRules } from './combat-events';
import { Boon, boon, boonRules } from './gate-boons';
import { inArea } from './realm-layout';
import { FirstSlam } from './expedition-record';
import { rankMonster, rankPause, rankRules, rankWorth, skillEffects, slowedBy } from './monster-ranks';
import { StrikeKind, strikeOf } from './skill-catalog';
/** The mage tower's ward rite: monster blows near the resident's own seat. */
const wardRite = { factor: 0.7, reach: 2 * TownState.campReach };
export interface CombatTown extends TownState {
  strikeDown(p: Person, cause: string, notice?: string): void;
  blowStrength(p: Person): number;
  hurtCreature(foe: Monster, damage: number, by: Person | null): boolean;
  blowAgainst(foe: Monster, damage: number): number;
  rallied(p: Person): boolean;
  walk(p: Person, dt: number): void;
  reveal(x: number, y: number, radius: number): void;
  walkTo(p: Person, at: Point): boolean;
  staffed(kind: Structure): boolean;
  camp(id?: number): Building | null;
  power(p: Person): number;
  settlementOf(p: Person | Building): number;
  settlementAt(at: Point): number;
  credit(gain: Resources, village: number): void;
  store(gain: Resources, village: number): void;
  rewardExperience(p: Person, points: number): void;
  creatureTarget(id: number): Monster | null;
  strike(p: Person, foe: Monster): void;
  hurtGuest(p: Person, killed: boolean): void;
  raiding(): boolean;
  arrive(p: Person): void;
  resumeOrder(p: Person): boolean;
  changeRenown(village: number, amount: number): void;
  raze(id: number): void;
  orderAttackDungeon(ids: number[], gate: number): boolean;
  setOrder(p: Person, task: Activity, target?: number): void;
}
export interface BiteTown extends TownState {
  hurtGuest(p: Person, killed: boolean): void;
  strikeDown(p: Person, cause: string, notice?: string): void;
  camp(id?: number): Building | null;
  settlementOf(p: Person | Building): number;
}
export const lairOf = gateCenter;
export const monsterEntrance = (site: Dungeon): Point =>
  point(f(site.origin.x + 1), f(site.origin.y + f(2.3)));
export interface Breed {
  health: number;
  bite: number;
  speed: number;
  pause: number;
}
// The breed supplies the base stats. A raiding pack and a dungeon guardian use different scales.
export function breedOf(kind: DungeonKind): Breed {
  switch (kind) {
    case DungeonKind.Cave:
      return { health: f(13.5), bite: f(0.028), speed: f(1.45), pause: 1 };
    case DungeonKind.Crypt:
      return { health: 21, bite: f(0.023), speed: f(0.9), pause: f(1.3) };
    case DungeonKind.Portal:
      return { health: f(10.5), bite: f(0.04), speed: f(1.25), pause: f(0.9) };
    case DungeonKind.Ruin:
      return { health: f(16.5), bite: f(0.025), speed: f(1.1), pause: 1 };
    case DungeonKind.GiantHall:
      return { health: 48, bite: f(0.06), speed: f(0.85), pause: f(1.6) };
    default:
      return { health: 18, bite: f(0.04), speed: 1, pause: 1 };
  }
}
export function steps(map: WorldMap, to: Point): boolean {
  const tile = map.cell(to);
  return !!tile && !impassable(tile.terrain);
}
export const reachOf = (p: Person): number => f(attackReach(p));
/** A bow or staff shoots; every other weapon, however long, strikes hand to hand. */
export const shoots = (p: Person): boolean => {
  const shape = combatItem(p)?.visual;
  return shape === 'bow' || shape === 'staff';
};
export const blowOf = (p: Person): number => f(attackDamage(p));
export function power(this: CombatTown, p: Person): number {
  return f(attackDamage(p));
}
export function raiding(this: TownState): boolean {
  return this.beasts.some((m) => m.raider);
}
/** What a raid weighs itself against: the residents at home, their arms and levels, watchtowers and walls. */
function settlementMight(town: CombatTown): number {
  let might = 0;
  for (const p of town.folk)
    if (
      p.role === Role.Resident && p.faction === town.controlFaction && p.health > 0 && p.downedAt < 0 &&
      p.activity !== Activity.Expedition && p.activity !== Activity.Leaving && !(town.realmGate >= 0 && inArea(town.realmArea, p.position))
    )
      might += raidMuster.perBlow * f(attackDamage(p)) * p.vitalityMultiplier();
  for (const b of town.placed) {
    if (!b.built() || b.faction !== town.controlFaction) continue;
    if (b.kind === Structure.Watchtower) might += raidMuster.perTower;
    if (isSeat(b.kind)) might += raidMuster.perTier * campTier(b.kind);
  }
  return might;
}
export function summonRaid(this: CombatTown, kind = raidKind(this.world.seed(), this.days), warned?: readonly number[]): void {
  if (!warned) updateGateOpenings(this);
  const sources = (warned ?? raidSources(this, kind)).filter(gate => gateActive(this, gate))
    .flatMap(index => {
      const seat = raidSeat(this, index);
      return seat ? [{ index, site: this.world.dungeons()[index], seat, routes: new Map<number, Point[]>() }] : [];
    });
  if (!sources.length) return;
  if (kind === RaidKind.Pincer && sources.length < 2) kind = RaidKind.Pack;
  const prowling = this.beasts.filter((m) => m.raider).length,
    level = raidMonsterLevel(this.days, this.raidCount),
    pressure = dungeonThreat(this.days, lairOf(sources[0].site), this.placed, level),
    shape = raidShape(kind, raidMight(settlementMight(this), this.raidCount ? pressure.week : 0)),
    // Leaders first, then the few brutes, then the swarm: a full settlement loses swarmers first.
    ranks = [
      ...Array<MonsterRank>(shape.count).fill(kind === RaidKind.Brutes ? MonsterRank.Brute : MonsterRank.Grunt),
      ...Array<MonsterRank>(shape.brutes).fill(MonsterRank.Brute),
      ...Array<MonsterRank>(shape.swarm).fill(MonsterRank.Swarmer),
    ].slice(0, Math.max(0, TownState.maxRaiders - prowling));
  if (!ranks.length) return;
  ranks.forEach((rank, i) => {
    const source = sources[i % sources.length],
      entrance = this.grid.nearestWalkable(monsterEntrance(source.site)),
      place = Math.floor(i / sources.length),
      // Fill the mouth from the centre out. A blocked side stays tucked inside the entrance.
      slot = add(entrance, rotated(point(0.48 * Math.sqrt(place), 0), place * 2.39996)),
      at = this.grid.walkable(slot) && this.grid.clear(entrance, slot, Infinity, true) ? slot : entrance,
      beast = new Monster(this.nextMonster++, source.index, at);
    beast.raider = true;
    beast.home = { ...beast.position };
    beast.prey = source.seat.id;
    const leader = i < shape.count;
    beast.level = level;
    beast.health = f(breedOf(source.site.kind).health * 0.24 * pressure.health * (leader ? shape.health : 1));
    beast.strength = f(0.25 * pressure.damage * (leader ? shape.damage : 1));
    // The shape already makes leading brutes tough; the rank gives them their gait and look.
    rankMonster(beast, rank, !leader);
    if (level === 1) beast.vigor = beast.health = Math.min(1, beast.health);
    if (rank === MonsterRank.Swarmer) beast.strength = f(beast.strength * raidMuster.swarmBite);
    this.beasts.push(beast);
    planRaiderApproach(this, beast, source.routes);
  });
  ++this.raidCount;
  sources.slice(0, ranks.length).forEach((source, i) => {
    this.open[source.index] = 1;
    const amount = Math.ceil((ranks.length - i) / sources.length);
    this.emit(CombatCue.Wave, monsterEntrance(source.site), { gate: source.index, amount });
    this.notify(`Raiders from ${source.site.name} march on Camp #${source.seat.id + 1}`);
  });
}
export function canSendExpedition(
  this: CombatTown,
  ids: number[],
  dungeon: number,
  _floor?: number,
): Check {
  const check = new Check();
  check.reason = dungeonAttackProblem(this, dungeon);
  if (!check.reason && !this.folk.some(p => ids.includes(p.id) && canControl(p, this.controlFaction)))
    check.reason = 'Select residents to send';
  check.ok = !check.reason;
  return check;
}
/** Older clients' gate order now fights the structure on the main map. */
export function sendExpedition(this: CombatTown, ids: number[], dungeon: number, _floor?: number): boolean {
  return this.orderAttackDungeon(ids, dungeon);
}
/** One monster blow against a resident, shared by the overworld and the worlds beyond. */
export function monsterBite(
  town: BiteTown,
  beast: Monster,
  prey: Person,
  breed: Breed,
  power = 1,
  area = false,
  ranged = false,
): void {
  const slowed = slowedBy(town, beast);
  beast.ready = town.time + (breed.pause * rankPause(beast)) / slowed;
  beast.swingAt = town.time;
  // A slam hits everyone around the guardian together, with no turn toward the last victim.
  beast.swingHeading = area ? point() : sub(prey.position, beast.position);
  const shield = area ? null : raisedShield(prey);
  if (shield && town.roll() < shield.block) {
    town.blows.push({
      serial: town.nextBlow++,
      from: { ...beast.position },
      to: { ...prey.position },
      damage: 0,
      onPerson: true,
      ranged,
      at: town.time,
      person: prey.id,
      blocked: true,
      strike: StrikeKind.Single,
      primary: true,
    });
    town.emit(CombatCue.Block, prey.position, { person: prey.id, creature: beast.id });
    return;
  }
  const seat = prey.role === Role.Resident ? town.camp(town.settlementOf(prey)) : null,
    warded = town.time < town.wardUntil && !!seat && distance(seat.center, prey.position) <= wardRite.reach,
    challenged = prey.calling === Calling.Warrior && prey.abilityUntil > town.time,
    soak = area ? 1 - armorProtection(prey) / 2 : 1 - armorProtection(prey),
    disheartened = (town.combatState.dirged.get(beast.id) ?? -1) > town.time,
    bite = f(
      breed.bite * beast.strength * power * soak * wardOf(town.folk, prey) *
        (warded ? wardRite.factor : 1) * (challenged ? 0.5 : 1) * (disheartened ? skillEffects.dirgeBite : 1),
    );
  prey.health = f(prey.health - f(bite / prey.vitalityMultiplier()));
  town.blows.push({
    serial: town.nextBlow++,
    from: { ...beast.position },
    to: { ...prey.position },
    damage: Math.max(1, lround(f(bite * 100))),
    onPerson: true,
    ranged,
    at: town.time,
    person: prey.id,
    strike: StrikeKind.Single,
    primary: true,
  });
  const alarm = beast.raider ? Math.min(1, beast.strength) : 1;
  prey.stress = Math.min(1, f(prey.stress + f(0.03 * alarm)));
  town.hurtGuest(prey, prey.health <= 0);
  if (prey.health <= 0) {
    const cause = beast.giant()
      ? 'Killed by a provoked giant'
      : beast.rank === MonsterRank.Guardian
        ? 'Killed by the guardian'
        : 'Killed by monsters';
    town.strikeDown(prey, cause, prey.name + ' was ' + cause.toLowerCase());
  }
}
export function monsterAt(this: TownState, p: Point, reach: number): number {
  let best: Monster | null = null;
  for (const group of [this.beasts, this.animals])
    for (const beast of group)
      if (
        !beast.insideLair &&
        beast.health > 0 &&
        distance(beast.position, p) <= reach &&
        (!best || distance(beast.position, p) < distance(best.position, p))
      )
        best = beast;
  return best?.id ?? -1;
}
export function rewardExperience(this: TownState, p: Person, points: number, includeDowned = false): void {
  if (boon(this, Boon.Lore)) points = Math.round(points * boonRules.loreExperience);
  if (p.gainExperience(points, includeDowned) > 0) {
    this.notify(p.name + ' reached level ' + p.level + '!');
    this.emit(CombatCue.LevelUp, p.position, { person: p.id, amount: p.level });
  }
}
/** The weapon and its wielder's attributes set the blow before songs, rally, Valor and crits. */
export function blowStrength(this: CombatTown, p: Person): number {
  return f(
    blowOf(p) * songOf(this.folk, p) * (this.rallied(p) ? 1.25 : 1) *
      (boon(this, Boon.Valor) ? boonRules.valorAttack : 1),
  );
}
/** What a blow of `damage` leaves after the hide of a monster beyond a gate. */
export function blowAgainst(this: TownState, foe: Monster, damage: number): number {
  if (foe.animal !== null || this.realmGate < 0 || !inArea(this.realmArea, foe.home)) return damage;
  return f(Math.max(damage * 0.2, damage - rankRules.hide));
}
/** Damages a creature; the resident who lands the killing blow earns the kill and its experience. */
export function hurtCreature(this: CombatTown, foe: Monster, damage: number, by: Person | null): boolean {
  if (foe.health <= 0) return false;
  if (foe.rank === MonsterRank.Den) this.combatState.struckAt.set(foe.id, this.time);
  foe.health = f(foe.health - damage);
  if (foe.health > 0) return false;
  if (!by) return true;
  this.combatState.slayers.set(foe.id, by.id);
  if (foe.animal === null) {
    const remains = new Resources();
    // A swarm leaves scraps: one bone for every few small ones.
    remains.bones = foe.giant() ? 6 : rankWorth(foe) >= 1 ? 2 : foe.id % 3 === 0 ? 1 : 0;
    if (foe.rank === MonsterRank.Brute || foe.giant()) remains.hides = 1;
    if (this.realmGate >= 0 && inArea(this.realmArea, foe.home)) this.realmLoot.add(remains);
    else if (!remains.empty()) this.store(remains, this.settlementOf(by));
  }
  const health =
      foe.animal !== null ? animalSpec(foe.animal).health : breedOf(this.world.dungeons()[foe.lair].kind).health,
    ordinary = foe.raider && foe.vigor > 0 ? Math.max(1, Math.round(foe.vigor * 1.33)) :
      lround(f(health * (foe.animal !== null ? 2 : rankWorth(foe)))),
    points = foe.animal === null && foe.level > 1 ? Math.max(ordinary,
      Math.round(experienceForLevel(Math.min(foe.level, Person.maximumLevel - 1)) * rankWorth(foe) / 40)) : ordinary;
  for (const ally of this.folk)
    if (
      ally.health > 0 &&
      (ally.id === by.id ||
        (!ally.inside && ally.activity === Activity.Fighting && distance(ally.position, foe.position) <= 6))
    )
      this.rewardExperience(ally, points);
  return true;
}
/** Counts a dead creature once, for the killer, the chronicle and the presentation. */
export function tallyKill(this: TownState, foe: Monster): void {
  const by = this.combatState.slayers.get(foe.id) ?? -1,
    killer = by >= 0 ? this.person(by) : null;
  this.combatState.forgetCreature(foe.id);
  if (killer) ++killer.kills;
  if (foe.animal === null) ++this.chronicle.monstersSlain;
  if (foe.rank === MonsterRank.Guardian && foe.brood === foe.id) ++this.chronicle.guardiansSlain;
  this.emit(CombatCue.Kill, foe.position, { person: killer?.id ?? -1, creature: foe.id });
  if (foe.rank === MonsterRank.Den)
    this.emit(CombatCue.DenDestroyed, foe.position, { person: killer?.id ?? -1, creature: foe.id });
}
/** An Aimed Shot breaks a guardian's wind-up; the slam comes again later. */
export function breakWindup(this: TownState, beast: Monster): void {
  if (beast.id === this.realmGuardian && beast.windupUntil >= 0 && this.firstExpedition.slam === FirstSlam.Winding)
    this.firstExpedition.slam = FirstSlam.Interrupted;
  beast.windupUntil = -1;
  this.combatState.slamAt.set(beast.id, this.time + rankRules.slamBroken);
}
/** Enemies a shaped blow also catches besides its target, nearest first. */
function caughtBy(town: CombatTown, p: Person, foe: Monster, spec: ReturnType<typeof strikeOf>): Monster[] {
  if (spec.most <= 1 || spec.reach <= 0) return [];
  const along = sub(foe.position, p.position),
    span = Math.max(f(0.001), distance(foe.position, p.position)),
    out: { beast: Monster; gap: number }[] = [];
  for (const m of town.beasts) {
    if (m === foe || m.health <= 0 || m.insideLair || (m.giant() && !m.angry)) continue;
    const gap = distance(m.position, foe.position);
    if (gap > spec.reach + (spec.kind === StrikeKind.Pierce ? 0.5 : 0)) continue;
    if (spec.kind === StrikeKind.Pierce) {
      // Behind the target, close to the line of flight.
      const ahead = ((m.position.x - foe.position.x) * along.x + (m.position.y - foe.position.y) * along.y) / span,
        aside = Math.abs((m.position.x - foe.position.x) * along.y - (m.position.y - foe.position.y) * along.x) / span;
      if (ahead <= 0 || ahead > spec.reach || aside > 0.55) continue;
    } else if (spec.kind === StrikeKind.Cleave && distance(m.position, p.position) > reachOf(p) + 0.6) continue;
    out.push({ beast: m, gap });
  }
  return out
    .sort((a, b) => a.gap - b.gap || a.beast.id - b.beast.id)
    .slice(0, spec.most - 1)
    .map((entry) => entry.beast);
}
export function strike(this: CombatTown, p: Person, foe: Monster): void {
  if (foe.health <= 0 || foe.insideLair) return;
  const critChance =
      combatRules.critChance * (p.calling === Calling.Ranger ? 2 : 1) + (boon(this, Boon.Ember) ? boonRules.emberCrit : 0),
    crit = this.roll() < critChance,
    blow = this.blowAgainst(foe, f(this.blowStrength(p) * (crit ? combatRules.critDamage : 1))),
    spec = strikeOf(combatItem(p)?.visual),
    ranged = shoots(p),
    others = caughtBy(this, p, foe, spec);
  p.swingAt = this.time;
  this.hurtCreature(foe, blow, p);
  if (spec.stagger > 0 && foe.health > 0) foe.ready = Math.max(foe.ready, this.time) + spec.stagger;
  for (const other of others) {
    const share = this.blowAgainst(other, f(this.blowStrength(p) * (crit ? combatRules.critDamage : 1) * spec.share));
    this.hurtCreature(other, share, p);
    if (!other.raider) other.angry = true;
    if (other.giant()) other.provokedBy = p.id;
    this.blows.push({
      serial: this.nextBlow++,
      from: { ...(spec.kind === StrikeKind.Pierce ? foe.position : p.position) },
      to: { ...other.position },
      damage: lround(f(share * 10)),
      onPerson: false,
      ranged,
      at: this.time,
      person: p.id,
      attacker: p.id,
      strike: spec.kind,
      primary: false,
    });
  }
  if (foe.animal !== null && (!foe.angry || foe.health <= 0))
    this.animalCalls.push({
      serial: this.nextAnimalCall++,
      kind: foe.animal,
      position: { ...foe.position },
      at: this.time,
    });
  if ((foe.giant() || foe.animal !== null) && !foe.angry) foe.ready = this.time + 0.15;
  if (!foe.raider) foe.angry = true;
  if (foe.giant() || foe.animal !== null) foe.provokedBy = p.id;
  p.ready = this.time + 1;
  this.blows.push({
    serial: this.nextBlow++,
    from: { ...p.position },
    to: { ...foe.position },
    damage: lround(f(blow * 10)),
    onPerson: false,
    ranged,
    at: this.time,
    person: p.id,
    attacker: p.id,
    strike: spec.kind,
    primary: true,
    ...(crit ? { crit: true } : {}),
  });
  if (crit) this.emit(CombatCue.Crit, foe.position, { person: p.id, creature: foe.id, amount: lround(f(blow * 10)) });
}
/** Hold position: strike the nearest enemy within reach, never step toward one. */
function holdGround(town: CombatTown, p: Person, dt: number): void {
  const reach = reachOf(p);
  let foe: Monster | null = null;
  for (const group of [town.beasts, town.animals])
    for (const m of group) {
      if (m.health <= 0 || m.insideLair || (m.giant() && !m.angry)) continue;
      if (m.animal !== null && !(m.angry && animalSpec(m.animal).defends)) continue;
      const gap = distance(m.position, p.position);
      if (gap > reach || !town.world.revealed(m.position)) continue;
      if (!foe || gap < distance(foe.position, p.position) || (m.id === p.foe && gap <= distance(foe.position, p.position) + 0.3))
        foe = m;
    }
  p.path = [];
  if (!foe) {
    p.foe = -1;
    if (p.activity === Activity.Fighting) p.activity = Activity.Holding;
    return;
  }
  p.foe = foe.id;
  p.activity = Activity.Fighting;
  if (town.time >= p.ready) town.strike(p, foe);
}
// Threats interrupt an order without replacing its task/site. When combat ends,
// the original move, resource or construction transaction resumes.
export function fight(this: CombatTown, p: Person, dt: number): void {
  if (
    p.faction !== this.controlFaction || p.health <= 0 ||
    p.activity === Activity.Expedition || p.activity === Activity.Leaving || p.crossingDoorway()
  ) return;
  // The player's Move outranks self-defence: a unit told to go, goes. Attack-move
  // (aggressive) and every other order still answer a threat.
  if (p.ordered && (p.task === Activity.Moving || p.task === Activity.Tending) && !p.aggressive) {
    p.foe = -1;
    if (p.activity === Activity.Fighting) p.activity = Activity.Moving;
    return;
  }
  if (p.holding) return holdGround(this, p, dt);
  const dungeon = targetedDungeon(p);
  if (dungeon >= 0) return attackDungeon(this, p, dungeon, dt);
  const notice = this.raiding() ? 10 : 5;
  // Distance first: the fog test walks every sight circle on the map.
  const threats = [...this.beasts, ...this.animals].filter(m =>
    m.health > 0 && !m.insideLair && distance(m.position, p.position) <= notice && (!m.giant() || m.angry) &&
    (m.animal === null || (m.angry && animalSpec(m.animal).defends)) &&
    (m.raider || m.angry || distance(m.position,p.position) < 2.5) && this.world.revealed(m.position));
  threats.sort((a,b) => distance(a.position,p.position)-distance(b.position,p.position) || a.id-b.id);
  // A target the player picked is fought before whatever happens to stand closer.
  const chosen = p.ordered && p.task === Activity.Fighting && p.attackPerson < 0 ? this.creatureTarget(p.taskSite) : null;
  let foe: Monster | null =
    (chosen && chosen.health > 0 && !chosen.insideLair ? chosen : null) ??
    threats.find(m => m.id === p.foe) ?? threats[0] ?? null;
  let person: Person | null = null;
  if (foe && p.hunting && foe.id !== p.foe) p.hunting = false;
  if (!foe && p.ordered && p.task === Activity.Fighting) {
    if (p.attackPerson >= 0) person = this.person(p.attackPerson);
    else foe = this.creatureTarget(p.taskSite);
  }
  if (!foe && !person && p.hunting) foe = this.creatureTarget(p.foe);
  if (foe && (foe.health <= 0 || foe.insideLair)) foe = null;
  if (person && (person.health <= 0 || person.id === p.id || person.activity === Activity.Leaving)) person = null;
  if (!foe && !person) {
    p.foe = -1;
    if (p.activity === Activity.Fighting || p.task === Activity.Fighting) {
      p.path = []; p.activity = Activity.Idle; p.until = this.time;
      // Combat borrows the movement path, including an automatic builder's
      // approach. Restore that transaction now: its approach marker otherwise
      // makes the scheduler wait forever for a path that combat discarded.
      // A dead explicit target completes immediately, without walking to its
      // obsolete click position. resumeOrder applies the normal return-to-Auto.
      if (p.task === Activity.Fighting) p.approachingOrder = false;
      this.resumeOrder(p);
    }
    return;
  }
  // Explicit Stop holds position, but does not make a resident ignore an attacker.
  const target = foe ?? person!, at = target.position, gap = distance(at,p.position);
  p.foe = foe?.id ?? -1;
  p.activity = Activity.Fighting;
  if (p.inside) {
    this.walkTo(p, at);
    return;
  }
  if (gap > reachOf(p)) {
    if (!p.path.length || distance(p.path[p.path.length-1],at) > .7) {
      if (!this.walkTo(p, at)) { p.foe = -1; p.activity = Activity.Idle; p.until = this.time + .5; return; }
    }
    this.walk(p, dt);
    if (!this.world.revealedWithin(p.position, f(3.5))) this.reveal(p.position.x,p.position.y,f(7.5));
    return;
  }
  p.path = [];
  spreadFighter(this,p,target,reachOf(p),dt);
  if (this.time < p.ready) return;
  if (foe) this.strike(p,foe);
  else {
    const damage = f(this.blowStrength(p) * .1 * (1 - armorProtection(person!)) / person!.vitalityMultiplier());
    person!.health = f(person!.health - damage);
    p.ready = this.time + 1;
    p.swingAt = this.time;
    this.blows.push({serial:this.nextBlow++,from:{...p.position},to:{...person!.position},damage:lround(damage*100),onPerson:true,ranged:shoots(p),at:this.time,person:person!.id,attacker:p.id,strike:StrikeKind.Single,primary:true});
    this.hurtGuest(person!,person!.health <= 0);
    if (person!.health <= 0) this.strikeDown(person!, 'Killed by ' + p.name, person!.name + ' was killed');
  }
}
export function releaseMonster(this: CombatTown, at: Point): void {
  let lair = -1;
  for (let d = 0; d < this.world.dungeons().length; ++d)
    if (
      gateActive(this, d) &&
      (lair < 0 ||
        distance(lairOf(this.world.dungeons()[d]), at) < distance(lairOf(this.world.dungeons()[lair]), at))
    )
      lair = d;
  if (lair < 0) return;
  const beast = new Monster(this.nextMonster++, lair, this.grid.nearestWalkable(at));
  const site = this.world.dungeons()[lair];
  beast.level = siegeMonsterLevel(this.days, distance(lairOf(site), this.world.camp()));
  beast.health = f(breedOf(site.kind).health * (1 + 0.18 * (beast.level - 1)));
  beast.strength = f(1 + 0.08 * (beast.level - 1));
  beast.home = { ...beast.position };
  rankMonster(beast, MonsterRank.Grunt);
  this.beasts.push(beast);
}
export function hurtGuest(this: CombatTown, p: Person, killed: boolean): void {
  if (p.role !== Role.Guest) return;
  this.changeRenown(this.settlementOf(p), killed ? -8 : f(-0.4));
  if (killed) this.notify("A guest was killed: the settlement's renown suffers");
}
export function wreck(this: CombatTown, beast: Monster, dt: number): void {
  const breed = breedOf(this.world.dungeons()[beast.lair].kind),
    match = this.network.distance(beast.position),
    lane = match.id ?? -1;
  if (match.distance < f(0.6) && lane >= 0) {
    const road = this.network.road(lane);
    if (road && (!beast.raider || belongsToFaction(road)) && road.built >= 1 && road.wear < 1) {
      road.wear = Math.min(1, f(road.wear + f(f(dt) * (road.paved ? f(0.012) : f(0.025)))));
      if (road.wear >= 1) {
        this.notify(road.paved ? 'Monsters tore up a paved road' : 'Monsters tore up a road');
        this.roadChanged();
      }
    }
  }
  if (this.time < beast.ready) return;
  const seat = beast.raider ? raidSeat(this, beast.lair) : null;
  const target = beast.raider ? this.building(beast.prey) : null;
  const nearby = target ? [target, ...this.placed.filter(item => item !== target)] : this.placed;
  for (const item of nearby) {
    if (!item.footprint().contains(beast.position, f(0.7))) continue;
    if (beast.raider && !inRaidedVillage(this, item, seat)) continue;
    const blow = f(breed.bite * beast.strength * f(0.25) * (boon(this, Boon.Bulwark) ? boonRules.bulwarkBuildingDamage : 1));
    beast.ready = this.time + breed.pause;
    beast.swingAt = this.time;
    beast.swingHeading = sub(item.center, beast.position);
    this.blows.push({
      serial: this.nextBlow++,
      from: { ...beast.position },
      to: { ...item.center },
      damage: Math.max(1, lround(f(blow * 100))),
      onPerson: true,
      ranged: false,
      at: this.time,
      person: -1,
      strike: StrikeKind.Single,
      primary: true,
    });
    if (!item.built()) {
      item.progress = f(item.progress - blow);
      if (item.progress <= 0) {
        this.notify('Monsters wrecked the ' + structureSpec(item.kind).name + ' site');
        this.raze(item.id);
      }
      return;
    }
    item.health = f(item.health - blow);
    if (isSeat(item.kind) && item.health < f(0.1)) item.health = f(0.1);
    else if (item.health <= 0) {
      this.notify('Monsters destroyed the ' + structureSpec(item.kind).name);
      this.raze(item.id);
    }
    return;
  }
}
