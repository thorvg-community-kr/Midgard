import { advanceSieges, guardianSlam } from './dungeon-siege';
import { nativeRandomRadial } from './native-random-order';
// Translated from Town::stir in src/game/town_monsters.cpp.
import { TownState } from './town-state';
import { Role, type Monster, type Person } from './person';
import { Resources, Structure } from './building-catalog';
import type { Building } from './town-models';
import type { CampEconomy } from './camp-economy';
import { point, add, sub, scale, distance, type Point } from './geometry';
import { f32 as f, lround } from './numeric';
import { breedOf, monsterBite } from './town-monsters';
import { raidRoom, raidKind, raidWarning, RaidKind } from './raid-progression';
import { CombatCue, MonsterRank, combatRules } from './combat-events';
import { clearMuster, gateActive, musteredGates, musterRaid, raidSeat, updateGateOpenings } from './gate-progression';
import { belongsToFaction } from './faction';
import { losePrey, planRaiderApproach, pursueResident, separateMonsters } from './monster-navigation';
import { MeleeFront } from './monster-engagement';
import { choosePrey, raidRewardHealth, rankPace, slowedBy, tauntedBy } from './monster-ranks';
export interface EncounterTown extends TownState {
  wakeGiants(): void;
  stirWildlife(dt: number): void;
  camp(): Building | null;
  releaseMonster(at: Point): void;
  dayFraction(): number;
  summonRaid(kind?: RaidKind, warned?: readonly number[]): void;
  raiding(): boolean;
  giantsAwake(): boolean;
  roamGiant(beast: Monster, dt: number): void;
  staffed(kind: Structure): boolean;
  hurtGuest(person: Person, killed: boolean): void;
  wreck(beast: Monster, dt: number): void;
  settlementAt(at: Point): number;
  credit(gain: Resources, id: number): void;
  changeRenown(village: number, amount: number): void;
  rewardExperience(p: Person, points: number): void;
  economy(id: number): CampEconomy;
  defendSettlement(dt: number): void;
  realmKill(beast: Monster): void;
  tallyKill(beast: Monster): void;
  strikeDown(p: Person, cause: string, notice?: string): void;
  settlementOf(p: Person | Building): number;
  inRealm(p: Point): boolean;
}
function launchNightRaid(town: EncounterTown, day: number, kind: RaidKind, gates: number[]): void {
  if (gates.length && raidRoom(town) === 0) return;
  if (gates.length) town.summonRaid(kind, gates);
  town.raidedDay = day;
  clearMuster(town);
}
export function stir(this: EncounterTown, dt: number): void {
  this.blows = this.blows.filter((h) => !(this.time - h.at > 2));
  this.events = this.events.filter((event) => {
    const lifetime = event.cue === CombatCue.Telegraph ? Math.max(combatRules.eventSeconds, event.duration) : combatRules.eventSeconds;
    return this.time - event.at <= lifetime;
  });
  this.wakeGiants();
  this.stirWildlife(dt);
  const hour = this.dayFraction(), dark = this.climate().night > f(0.6), night = hour > f(0.5) && dark;
  // A wave held at capacity still belongs to the evening that reserved it, even after midnight.
  const previousDay = this.days - 1;
  if (this.raidedDay < previousDay) {
    const pending = dark && hour < f(0.5) ? musteredGates(this).filter(gate => gateActive(this, gate)) : [];
    launchNightRaid(this, previousDay, raidKind(this.world.seed(), previousDay), pending);
  }
  // Take the dusk muster before admitting a gate that awakens after dark.
  if (!night) updateGateOpenings(this);
  const fire = this.camp();
  if (this.raidedDay !== this.days && (night || (fire && hour > f(0.3) && this.raidWarnedDay !== this.days))) {
    const kind = raidKind(this.world.seed(), this.days);
    const gates = musterRaid(this, kind).filter(gate => gateActive(this, gate));
    if (night) {
      launchNightRaid(this, this.days, kind, gates);
    } else if (gates.length) {
      this.raidWarnedDay = this.days;
      const shape = kind === RaidKind.Pincer && gates.length === 1 ? RaidKind.Pack : kind;
      for (const gate of gates) {
        const seat = raidSeat(this, gate);
        if (seat) this.notify(raidWarning(shape, this.world.dungeons()[gate].name, seat.id));
      }
    }
  }
  if (night) updateGateOpenings(this);
  const raidOn = this.raiding();
  this.defendSettlement(dt);
  const front = new MeleeFront(this);
  for (const beast of this.beasts) {
    if (beast.health <= 0 || this.inRealm(beast.home)) continue;
    if (beast.giant() && (beast.insideLair || (!this.giantsAwake() && !beast.angry))) {
      front.release(beast);
      this.roamGiant(beast, dt);
      continue;
    }
    // Old saves and newly finished buildings can leave a creature on an impassable tile.
    if (!this.grid.walkable(beast.position)) beast.position = this.grid.nearestWalkable(beast.position);
    const breed = breedOf(this.world.dungeons()[beast.lair].kind), pace = rankPace(beast) * slowedBy(this, beast);
    const scent = beast.raider ? 9 : beast.angry ? 7 : 4;
    const warrior = tauntedBy(this, beast, scent * 1.5);
    const challenged = warrior && (!beast.raider || belongsToFaction(warrior)) ? warrior : null;
    const candidates = challenged ? [challenged] : this.folk.filter(p =>
      !p.inside && p.health > 0 && p.downedAt < 0 && (!beast.raider || belongsToFaction(p)) &&
      (!beast.giant() || (p.id === beast.provokedBy && distance(p.position, beast.home) <= 7)) &&
      distance(p.position, beast.position) < scent);
    // The guardian can strike the ground from behind its own front rank.
    if (beast.rank === MonsterRank.Guardian && guardianSlam(this, beast, choosePrey(beast, candidates) ?? undefined)) continue;
    const stepToFight = f(f(breed.speed * f(0.8) * pace) * f(dt));
    let claim = front.pick(beast, candidates);
    while (claim) {
      const goal = front.goal(claim);
      if (front.inPlace(beast, claim, goal)) {
        this.engage(claim.person);
        beast.prey = -1;
        if (beast.path.length) beast.path = [];
        if (this.time >= beast.ready) monsterBite(this, beast, claim.person, breed);
        break;
      }
      if (pursueResident(this, beast, claim.person, goal, stepToFight)) break;
      front.unreachable(beast, claim.person);
      claim = front.pick(beast, candidates);
    }
    if (claim) continue;
    if (challenged) {
      // Challenged raiders gather behind the fighters instead of resuming a building attack.
      const gap = distance(beast.position, challenged.position);
      const standOff = 1.6 + (beast.id % 5) * 0.16;
      if (gap > standOff + 0.2 && this.grid.sharesLand(beast.position, challenged.position)) {
        const wait = add(challenged.position, scale(sub(beast.position, challenged.position), standOff / gap));
        if (this.grid.walkable(wait) && pursueResident(this, beast, challenged, wait, stepToFight)) continue;
      }
      beast.prey = -1;
      beast.path = [];
      continue;
    }
    losePrey(beast);
    // Dungeon defenders hold outside a full front until a place opens. Raiders have a settlement to reach.
    if (candidates.length && !beast.raider && !beast.giant()) continue;
    beast.angry = false;
    beast.provokedBy = -1;
    if (beast.giant()) {
      this.roamGiant(beast, dt);
      continue;
    }
    if (beast.raider) {
      planRaiderApproach(this, beast);
    } else if (!beast.path.length && this.roll() < dt * 0.3) {
      const at = this.grid.nearestWalkable(add(beast.home, nativeRandomRadial(() => this.roll(), 1.5, 4, 6.2832)));
      beast.path = this.grid.clear(beast.position, at, Infinity, true) ? [at] : this.grid.path(beast.position, at, true).slice(1);
    }
    this.wreck(beast, dt);
    let step = f((beast.raider ? f(breed.speed * f(0.8) * pace) : f(0.5)) * f(dt));
    while (step > 0 && beast.path.length) {
      const gap = distance(beast.position, beast.path[0]),
        next =
          gap <= step
            ? { ...beast.path[0] }
            : add(beast.position, scale(sub(beast.path[0], beast.position), f(step / gap)));
      if (!this.grid.clear(beast.position, next, Infinity, true)) {
        // A leg can pass the coarse check and still clip the corner of a blocked cell. Refused outright, the
        // same step is planned again for ever and the raid never ends: the raider slides along the corner.
        const along = point(next.x, beast.position.y),
          aside = point(beast.position.x, next.y),
          wider = Math.abs(next.x - beast.position.x) >= Math.abs(next.y - beast.position.y),
          slide = !beast.raider
            ? undefined
            : (wider ? [along, aside] : [aside, along]).find(
                (to) => distance(to, beast.position) > f(1e-4) && this.grid.clear(beast.position, to, Infinity, true),
              );
        if (slide) beast.position = slide;
        else beast.path = [];
        break;
      }
      beast.position = next;
      if (gap <= step) {
        beast.path.shift();
        step = f(step - gap);
      } else step = 0;
    }
  }
  separateMonsters(this, dt);
  for (const beast of this.beasts) {
    if (beast.health > 0) continue;
    this.tallyKill(beast);
    if (this.inRealm(beast.home)) {
      this.realmKill(beast);
      continue;
    }
    const bounty = beast.raider && beast.vigor > 0 ? Math.max(1, lround(raidRewardHealth(beast) * 0.5)) :
        lround(f(breedOf(this.world.dungeons()[beast.lair].kind).health * (beast.raider ? f(0.5) : f(0.4)))),
      village = this.settlementAt(beast.position);
    this.credit(new Resources(bounty), village);
    this.economy(village).today.bounty += bounty;
    this.raidBounty += beast.raider ? bounty : 0;
    if (beast.raider) ++this.raidKills;
    else if (beast.brood < 0) this.notify((beast.giant() ? 'A giant is slain (+' : 'A monster is slain (+') + bounty + ' gold)');
  }
  this.beasts = this.beasts.filter((m) => m.health > 0);
  if (raidOn && !this.raiding()) {
    ++this.chronicle.raidsRepelled;
    this.notify(`The raid is beaten off (${this.raidKills} slain, +${this.raidBounty} gold)`);
    this.raidKills = this.raidBounty = 0;
  }
  advanceSieges(this);
}
