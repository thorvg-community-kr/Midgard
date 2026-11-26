import { Faith, Product } from './building-catalog';
import { distance, point, type Point } from './geometry';
import { clamp, f32 } from './numeric';
import type { Appearance } from './person-appearance';
import { backpackSize, emptyEquipment, type ItemStack } from './equipment';
import { MonsterRank, type AbilityId } from './combat-events';
import type { StrikeKind } from './skill-catalog';
export enum Role { Resident, Guest }
export enum Calling { Settler, Traveller, Warrior, Ranger, Mage, Cleric, Bard }
export enum Race { Human, God, Giant }
export enum Activity { Idle, Moving, Holding, Building, Roadwork, Working, Eating, Sleeping, Relaxing, Exploring, Brooding, Arriving, Leaving, Guarding, Fighting, Expedition, Praying, Shopping, Hauling, Felling, Collecting, Mining, Treating, FetchingMaterials, DeliveringMaterials, WaitingMaterials, Drinking, Training, Crafting, /** Struck down and bleeding out; lies still until tended or dead. */ Downed, /** Kneeling by a downed resident (`target` is their id). */ Tending, Herding, GatheringEggs, Milking }
export enum AnimalKind { Cow, Pig, Chicken, Wolf, Dog, Cat, Count }
export const callingName = (calling: Calling): string => ['Settler', 'Traveller', 'Warrior', 'Ranger', 'Mage', 'Cleric', 'Bard'][calling] || '';
export const raceName = (race: Race): string => ['Human', 'God', 'Giant'][race] || '';
export const activityName = (activity: Activity): string => ['Idle', 'Moving on orders', 'Holding position', 'Building', 'Working on a road', 'Working', 'Eating', 'Resting', 'Relaxing at the tavern', 'Delving the dungeon', 'Brooding', 'Arriving', 'Leaving', 'On watch', 'Fighting', 'On an expedition', 'Praying', 'Buying gear', 'Carrying goods', 'Felling a tree', 'Collecting resources', 'Mining stone', 'Receiving treatment', 'Fetching supplies', 'Delivering materials', 'Waiting for materials', 'Drinking water', 'Training at the guild', 'Crafting equipment', 'Downed', 'Tending the fallen', 'Leading livestock', 'Collecting eggs', 'Collecting milk'][activity] || '';
export class Monster {
  level = 1;
  health = 3; strength = 1; raider = false; angry = false; ready = 0; home = point(); prey = -1; race: Race | null = null; insideLair = false; provokedBy = -1; animal: AnimalKind | null = null;
  /** What kind of fighter this is; decides its size and manner. */
  rank = MonsterRank.Grunt;
  /** Full health, or zero when an older save has no record of it. */
  vigor = 0;
  /** Clock time a telegraphed guardian slam lands, or -1. */
  windupUntil = -1;
  /** Clock time of its last bite or spit, for presentation; not saved. */
  swingAt = -1;
  /** Direction of that strike at contact; later crowd movement must not turn the swing around. */
  swingHeading?: Point;
  /** Clock time it climbed out of a den, or -1; not saved. */
  bornAt = -1;
  /** Its den or guardian, its own id when defending a standing dungeon, or -1 if unaffiliated. */
  brood = -1;
  /** Ranch this animal belongs to. */
  pen = -1;
  constructor(public id: number, public lair: number, public position: Point, public path: Point[] = []) {}
  giant(): boolean { return this.race === Race.Giant; }
}
export interface Hit { serial: bigint; from: Point; to: Point; damage: number; onPerson: boolean; ranged: boolean; at: number; person: number; attacker?: number; /** The creature struck, or -1 for a structure; absent on old hits. */ creature?: number; /** A blow for extra damage. */ crit?: boolean; /** Turned aside by a shield; `damage` is 0. */ blocked?: boolean; /** How the blow landed; absent means `StrikeKind.Single`. */ strike?: StrikeKind; /** False for enemies caught by a staff bolt beside its target; absent means true. */ primary?: boolean; }
export interface Expedition { dungeon: number; members: number[]; /** Floor of the world beyond the gate the party will enter. */ floor: number; }
export class Person {
  static readonly maximumLevel = 100;
  inventory: (ItemStack | null)[] = Array.from({ length: backpackSize }, () => null);
  equipment = emptyEquipment();
  craftItem: string | null = null;
  craftWorkshop = -1;
  craftProgress = 0;
  /** A foundry batch made on the way to completing the main upgrade. */
  refining = Product.None;
  refineProgress = 0;
  faction = 0;
  stressRecovery = false;
  lastBreakdownAt = -1;
  trained = false;
  /** Aptitudes granted at the altar and kept when training or gaining levels. */
  birthStrength = 0;
  birthVitality = 0;
  trainingCalling = -1;
  // Temporary rest can span a meal or combat without replacing the assigned work.
  /** Resident this one is walking to for a hand-to-hand delivery; not saved. */
  giver = -1;
  /** Most recent physical transfer of supplies, for presentation only. */
  transfer: { taking: boolean; at: number; toward?: Point } | null = null;
  recoveringRest = false;
  /** Clock time until which a resident the player got out of bed stays up; not saved. */
  awakeUntil = -1;
  recoveringHealth = false;
  /** Clock time this resident was struck down, or -1 while standing. */
  downedAt = -1;
  /** Monsters and animals this resident has killed. */
  kills = 0;
  /** Clock time the calling ability is ready again, and until when its effect lasts. */
  abilityReadyAt = 0;
  abilityUntil = 0;
  /** Auto-use of the ability: -1 follows the calling's default, 0 off, 1 on. */
  abilityAuto = -1;
  /** The same for the calling's second skill. */
  abilityReadyAt2 = 0;
  abilityUntil2 = 0;
  abilityAuto2 = -1;
  /** Skill being cast and its timing, for presentation; not saved. */
  cast: AbilityId | '' = '';
  castAt = -1;
  castUntil = -1;
  /** A bard's lyre phrase (index into the bank, -1 before the first), when it began and ends; not saved. */
  phrase = -1;
  phraseAt = -1;
  playingUntil = -1;
  /** Clock time a bard may begin the next phrase, or -1 while none is planned; not saved. */
  phraseDue = -1;
  /** Clock time of the last ordinary blow, for presentation; not saved. */
  swingAt = -1;
  /** Serial of the clearing job this resident is on, or -1; not saved. Any other order clears it. */
  clearing = -1;
  /** Hold position: stand, strike whatever comes into reach, never chase. Any other order clears it. */
  holding = false;
  /** Days of a lasting wound left; while positive, health stays at or below combatRules.woundedHealth. */
  woundDays = 0;
  hydration = 1;
  hunting = false;
  /** The animal being led or the grown offspring chosen for meat. */
  herdAnimal = -1;
  attackPerson = -1;
  workField = -1;
  activity = Activity.Idle; target = -1; until = 0; inside = false; ordered = false; task = Activity.Idle; taskSite = -1;
  food = f32(.8); rest = f32(.9); health = 1; home = -1; job = -1; bed = -1; autoMode = true;
  ready = 0; foe = -1; tree = -1; carrying = 0; carriedProduct = Product.Wood; aggressive = false; approachingOrder = false; goal = point(); days = 0; loot = 0;
  relaxedAt = -1e9; prayedAt = -1e9; load = 0; breaking = 0; gear = 0; level = 1; experience = 0; purse = 0; worked = 0; unpaid = false; sleptOutside = false;
  customLook: Appearance | null = null; lookRevision = 0n; entrance = point(); threshold = point(); doorway = 0; faith = Faith.Dawn; past = ''; village = -1; supplyTarget = -1; supplyRoad = false; scheduleAt = 0;
  /** Physical tiredness and strain use one reserve. Legacy callers express it from the tired end. */
  get stress(): number { return 1 - this.rest; }
  set stress(value: number) { this.rest = f32(clamp(1 - value, 0, 1)); }
  constructor(public id: number, public name: string, public role: Role, public calling: Calling, public race: Race, public look: number, public position: Point, public path: Point[] = []) {}
  experienceToNextLevel(): number { return experienceForLevel(this.level); }
  /** Experience improves endurance. Weapons and their attribute scaling determine attack. */
  static vitalityPerLevel = 0.2;
  vitalityMultiplier(): number { return f32(1 + f32(f32(Person.vitalityPerLevel) * (this.level - 1)) + this.birthVitality * 0.08); }
  gainExperience(points: number, includeDowned = false): number {
    const downedSurvivor = includeDowned && this.downedAt >= 0 && this.health > -0.5;
    if (points <= 0 || (this.health <= 0 && !downedSurvivor) || this.level >= Person.maximumLevel) return 0;
    let gained = 0, remaining = this.experience + points;
    while (this.level < Person.maximumLevel && remaining >= this.experienceToNextLevel()) {
      remaining -= this.experienceToNextLevel();
      this.level++;
      gained++;
      if (this.health > 0) this.health = Math.min(1, f32(this.health + f32(.2)));
    }
    this.experience = this.level === Person.maximumLevel ? 0 : remaining; return gained;
  }
  moving(): boolean { return this.path.length > 0; }
  crossingDoorway(): boolean { return this.inside ? this.doorway < 1 : this.doorway > 0; }
  visibility(): number { const gap = distance(this.entrance, this.threshold); let visible = clamp(f32(f32(f32(1 - this.doorway) * gap) / Math.max(f32(.001), Math.min(f32(.35), gap))), 0, 1); if (gap < f32(.001)) visible = f32(1 - this.doorway); return f32(f32(visible * visible) * f32(3 - f32(2 * visible))); }
}
/** Keep the experience already saved toward each level and extend the same curve through the campaign. */
export function experienceForLevel(level: number): number {
  const n = level - 1;
  return level >= Person.maximumLevel ? 0 : 40 + 30 * n + 3 * n * n;
}
export function experienceForLevels(start: number, count: number): number {
  let total = 0;
  for (let level = start; level < Math.min(start + count, Person.maximumLevel); ++level) total += experienceForLevel(level);
  return total;
}
export const adventurer = (p: Person): boolean => p.calling === Calling.Warrior || p.calling === Calling.Ranger || p.calling === Calling.Mage || p.calling === Calling.Cleric;
export interface AnimalCall { serial: bigint; kind: AnimalKind; position: Point; at: number; }
export enum TreeWorkKind { Chop, Fall, Mine, Shatter, Regrow, Produced, Hammer }
export interface TreeWorkEvent { serial: bigint; kind: TreeWorkKind; person: number; cell: number; index: number; worker: Point; at: number; wall?: Point; stoneStage?: number; }
