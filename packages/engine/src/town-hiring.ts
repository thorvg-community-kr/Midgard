import { TownState } from './town-state';
import { Person, Role, Calling, Activity, callingName } from './person';
import { Resources, Structure, structureSpec } from './building-catalog';
import type { Building } from './town-models';
import type { Point } from './geometry';
import { canControl, sameFaction, belongsToFaction } from './faction';
import { finishCeremony } from './town-devotion';
import { callingSchools, guildLevel } from './progression-rules';
import { completedFacility } from './settlement-progression';

/** Compatibility only: lodging visitors and generated offers cannot be hired. */
export interface HireOffer {
  key: string;
  person: Person;
  cost: Resources;
  existing: boolean;
  village: number;
}
export function recruitmentOffers(this: TownState, _village = -1): HireOffer[] {
  return [];
}
export function recruitmentReason(this: TownState, _offer: HireOffer): string {
  return 'Guests visit for a while. Prepare food and a free bed to welcome a resident at the altar.';
}
export function hireGuest(this: TownState, _key: string): boolean {
  return false;
}

export interface GuildTrainingOption {
  calling: Calling;
  name: string;
  description: string;
  cost: Resources;
  reason: string;
}
export interface TrainingTown extends TownState {
  settlementOf(item: Person | Building): number;
  inRealm(at: Point): boolean;
  walkTo(p: Person, at: Point): boolean;
  setOrder(p: Person, task: Activity, site?: number): void;
  arrive(p: Person): void;
  trainingReason(personId: number, guildId: number, calling: Calling): string;
}
const professions: readonly { calling: Calling; description: string }[] = [
  { calling: Calling.Warrior, description: 'Draws foes away from allies and sweeps through nearby enemies.' },
  { calling: Calling.Ranger, description: 'Interrupts heavy blows and rains arrows on groups.' },
  { calling: Calling.Mage, description: 'Strikes groups with runes and slows them with frost.' },
  { calling: Calling.Cleric, description: 'Heals the wounded and revives fallen allies.' },
  { calling: Calling.Bard, description: 'Songs rally allies and weaken nearby foes.' },
  { calling: Calling.Settler, description: 'Return to the Settler calling.' },
];
function guild(place: Building | null): place is Building {
  return (
    !!place &&
    (place.kind === Structure.Guild || place.kind === Structure.GuildHall) &&
    place.built() &&
    place.health > 0
  );
}
export function guildTrainingOptions(
  this: TrainingTown,
  personId: number,
  guildId: number,
): GuildTrainingOption[] {
  return professions.map(({ calling, description }) => ({
    calling,
    name: callingName(calling),
    description,
    cost: new Resources(),
    reason: this.trainingReason(personId, guildId, calling),
  }));
}
export function trainingReason(
  this: TrainingTown,
  personId: number,
  guildId: number,
  calling: Calling,
): string {
  const p = this.person(personId),
    place = this.building(guildId);
  if (!guild(place)) return 'Complete a guild first.';
  if (!belongsToFaction(place, this.controlFaction)) return 'This guild belongs to another settlement.';
  if (!canControl(p, this.controlFaction))
    return p?.role === Role.Guest
      ? 'Guests cannot train or become residents.'
      : 'Choose an available resident of this settlement.';
  if (!sameFaction(p, place) || this.settlementOf(p) !== this.settlementOf(place) ||
      this.inRealm(p.position) !== this.inRealm(place.center))
    return "Choose a resident who lives in this guild's settlement.";
  if (!professions.some((option) => option.calling === calling)) return 'Choose a guild profession.';
  if (p.calling === calling) return 'Current calling';
  if (p.level < guildLevel) return `Needs level ${guildLevel}`;
  const school = callingSchools[calling];
  if (school !== undefined && !completedFacility(this, school)) return 'Complete ' + structureSpec(school).name;
  if (p.task === Activity.Training && (p.taskSite !== guildId || p.trainingCalling !== calling))
    return 'Finish or cancel the current training.';
  return '';
}
export function orderTrainAtGuild(
  this: TrainingTown,
  personId: number,
  guildId: number,
  calling: Calling,
): boolean {
  const p = this.person(personId),
    place = this.building(guildId);
  if (!p || !place || p.task === Activity.Training || this.trainingReason(personId, guildId, calling) || !this.walkTo(p, place.door()))
    return false;
  this.setOrder(p, Activity.Training, guildId);
  p.trainingCalling = calling;
  p.aggressive = false;
  p.activity = Activity.Training;
  if (!p.moving()) this.arrive(p);
  ++this.changes;
  return true;
}
export function completeGuildTraining(this: TrainingTown, p: Person): boolean {
  if (
    p.task !== Activity.Training ||
    p.activity !== Activity.Training ||
    p.target !== p.taskSite ||
    !p.inside ||
    p.crossingDoorway() ||
    p.moving() ||
    this.time < p.until
  )
    return false;
  const calling = p.trainingCalling,
    place = this.building(p.taskSite),
    reason = this.trainingReason(p.id, p.taskSite, calling);
  if (reason || !guild(place)) {
    finishCeremony(this, p);
    if (reason) this.notify(reason);
    return false;
  }
  if (!p.trained) ++place.trainingCount;
  p.calling = calling;
  p.trained = true;
  // End the old calling's effects. Keep cooldowns so changing back cannot refresh a skill.
  p.abilityUntil = p.abilityUntil2 = 0;
  p.abilityAuto = p.abilityAuto2 = -1;
  p.cast = '';
  p.castUntil = p.playingUntil = p.phraseDue = -1;
  finishCeremony(this, p);
  this.notify(`${p.name} is now a ${callingName(calling)}.`);
  ++this.changes;
  return true;
}
