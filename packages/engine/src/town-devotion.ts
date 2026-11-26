import { TownState } from './town-state';
import { Activity, Calling, Person, Race, Role } from './person';
import { Resources, Structure, isHome, structureSpec } from './building-catalog';
import { Building } from './town-models';
import { CampReceipt } from './camp-economy';
import { canControl, sameFaction, belongsToFaction, livingResident } from './faction';
import { distance, type Point } from './geometry';
import { defaultOffering, offeringBonus, offeringFood, offeringReason, residentStartingLevel } from './prayer-offering';
import { applyCharacter, validCharacter, type CharacterPreset } from './character-preset';
import { altarCap, altarCapReason } from './altar-cap';

export const ceremonySeconds = 5;
export interface DevotionEvent {
  serial: bigint;
  altar: number;
  person: number;
  at: number;
  position: Point;
}
export function devotionEvents(this: TownState): readonly DevotionEvent[] {
  this.altarEvents = this.altarEvents.filter((event) => this.time - event.at <= 3);
  return this.altarEvents;
}
export interface AltarStatus {
  reason: string;
  pendingBirths: number;
  dueDay: number;
  cost: Resources;
}
export interface DevotionTown extends TownState {
  camp(id?: number): Building | null;
  settlementOf(item: Building | Person): number;
  stock(village?: number): Resources;
  population(id?: number): number;
  makePerson(role: Role, calling: Calling, at: Point, race?: Race): Person;
  assignHomes(): void;
  staff(): void;
  recordReceipt(receipt: CampReceipt): void;
  walkTo(person: Person, to: Point): boolean;
  setOrder(person: Person, task: Activity, site?: number): void;
  arrive(person: Person): void;
  processDevotion(): void;
  prayerReason(personId: number, altarId: number): string;
  trainingReason(personId: number, guildId: number, calling: Calling): string;
}
function altar(place: Building | null): place is Building {
  return !!place && place.kind === Structure.Shrine && place.built() && place.health > 0;
}
function localResidents(town: DevotionTown, place: Building): number {
  const village = town.settlementOf(place);
  return town.folk.filter((p) => livingResident(p, place.faction) && town.settlementOf(p) === village).length;
}
function localHousing(town: DevotionTown, place: Building): number {
  const village = town.settlementOf(place);
  return town.placed.reduce(
    (sum, b) =>
      sum +
      (b.built() &&
      b.health > 0 &&
      isHome(b.kind) &&
      sameFaction(b, place) &&
      town.settlementOf(b) === village
        ? structureSpec(b.kind).residents
        : 0),
    0,
  );
}
function reservedHomes(town: DevotionTown, place: Building, exceptPerson: number, village?: number): number {
  const pending = town.placed.filter(
    (b) => altar(b) && b.devotionDueDay >= 0 && sameFaction(b, place) &&
      (village === undefined || town.settlementOf(b) === village),
  ).length;
  // A walking or interrupted worshipper holds the same bed reservation as one already praying.
  const praying = new Set<number>();
  for (const p of town.folk) {
    if (
      p.id === exceptPerson ||
      p.role !== Role.Resident ||
      p.health <= 0 ||
      p.task !== Activity.Praying ||
      !sameFaction(p, place)
    )
      continue;
    const target = town.building(p.taskSite);
    if (
      altar(target) &&
      target.devotionDueDay < 0 &&
      sameFaction(target, place) &&
      (village === undefined || town.settlementOf(target) === village)
    )
      praying.add(target.id);
  }
  return pending + praying.size;
}
function altarReason(town: DevotionTown, id: number, personId = -1, checkFood = true): string {
  const place = town.building(id);
  if (!altar(place)) return 'Complete an altar first.';
  if (!belongsToFaction(place, town.controlFaction)) return 'This altar belongs to another settlement.';
  const camp = town.camp(town.settlementOf(place));
  if (!camp?.built() || !sameFaction(camp, place)) return 'Complete a camp for this altar.';
  if (place.devotionDueDay >= 0) return 'Waiting for a home.';
  if (
    town.folk.some(
      (p) => p.id !== personId && p.health > 0 && p.task === Activity.Praying && p.taskSite === id,
    )
  )
    return 'The altar is in use.';
  // The cap first: a new home would not help while it holds.
  if (town.population() + reservedHomes(town, place, personId) >= altarCap(town)) return altarCapReason;
  const reserved = reservedHomes(town, place, personId, town.settlementOf(place));
  if (localResidents(town, place) + reserved >= localHousing(town, place))
    return 'No free beds here.';
  if (checkFood && town.stock(camp.id).food < offeringFood) return 'Need 4 food.';
  return '';
}
export function altarStatus(this: DevotionTown, id: number): AltarStatus {
  const place = this.building(id);
  return {
    reason: altarReason(this, id),
    pendingBirths: altar(place) && place.devotionDueDay >= 0 ? 1 : 0,
    dueDay: altar(place) ? place.devotionDueDay : -1,
    cost: defaultOffering(),
  };
}
export function altarOfferingReason(this: DevotionTown, id: number, offering: Resources): string {
  const invalid = offeringReason(offering);
  if (invalid) return invalid;
  const reason = altarReason(this, id, -1, false);
  if (reason) return reason;
  const place = this.building(id)!;
  if (!this.folk.some(p => canControl(p, this.controlFaction) && sameFaction(p, place) &&
    this.settlementOf(p) === this.settlementOf(place) && p.activity !== Activity.Expedition))
    return 'No settlers available here.';
  if (!this.stock(this.settlementOf(place)).covers(offering)) return 'Not enough supplies.';
  return '';
}
export interface OfferingResult {
  born: Person | null;
}

export function summonFromOffering(this: DevotionTown, id: number, offering: Resources): Person | null {
  return offerAtAltar.call(this, id, offering).born;
}

function createResident(town: DevotionTown, place: Building, extraPoints: number, identity?: CharacterPreset): Person {
  const village = town.settlementOf(place);
  const born = town.makePerson(Role.Resident, Calling.Settler, town.grid.nearestWalkable(place.door()), Race.Human);
  if (identity) applyCharacter(born, identity);
  born.faction = place.faction;
  born.village = village;
  born.faith = place.faith;
  born.level = residentStartingLevel(town);
  for (let point = 0; point <= extraPoints; ++point) {
    if (town.roll() < 0.5) ++born.birthStrength;
    else ++born.birthVitality;
  }
  born.past = 'Given breath at the altar of Odin.';
  born.food = born.rest = born.hydration = born.health = 1;
  born.stress = born.purse = 0;
  town.folk.push(born);
  town.altarEvents = town.altarEvents.filter((event) => town.time - event.at <= 3);
  town.altarEvents.push({
    serial: town.nextDevotionEvent++, altar: place.id, person: born.id,
    at: town.time, position: { ...born.position },
  });
  town.assignHomes();
  town.staff();
  town.recordReceipt(new CampReceipt(0n, village, new Resources(), 0, 0, 1));
  town.notify(born.name + ' joins the settlement');
  ++town.changes;
  return born;
}

/** The draft is free to edit. Only a valid, confirmed creation pays or rolls aptitudes. */
export function offerAtAltar(
  this: DevotionTown, id: number, offering: Resources, identity?: CharacterPreset,
): OfferingResult {
  if (altarOfferingReason.call(this, id, offering)) return { born: null };
  if (identity && (
    identity.calling !== Calling.Settler || identity.race !== Race.Human || !identity.look || !validCharacter(identity)
  )) return { born: null };
  const place = this.building(id)!;
  this.stock(this.settlementOf(place)).subtract(offering);
  this.commanded();
  return { born: createResident(this, place, offeringBonus(offering), identity) };
}

export function prayerReason(this: DevotionTown, personId: number, altarId: number): string {
  const p = this.person(personId),
    place = this.building(altarId);
  if (!canControl(p, this.controlFaction))
    return p?.role === Role.Guest
      ? 'Guests cannot pray for a new resident.'
      : 'Choose an available resident of this settlement.';
  if (!place || !sameFaction(p, place) || this.settlementOf(p) !== this.settlementOf(place))
    return "Choose a resident who lives in this altar's settlement.";
  return altarReason(this, altarId, personId);
}
export function orderPrayAtAltar(this: DevotionTown, ids: number[], altarId: number): boolean {
  const place = this.building(altarId);
  if (!place) return false;
  for (const id of ids) {
    const p = this.person(id);
    if (!p || this.prayerReason(id, altarId) || !this.walkTo(p, place.door())) continue;
    this.setOrder(p, Activity.Praying, altarId);
    p.trainingCalling = -1;
    p.aggressive = false;
    p.activity = Activity.Praying;
    if (!p.moving()) this.arrive(p);
    ++this.changes;
    return true; // One completed offering creates one resident at this altar.
  }
  return false;
}
/** Both ceremonies use the ordinary doorway, needs interruption, and saved direct-order lifecycle. */
export function resumeDevotionOrder(this: DevotionTown, p: Person): boolean {
  if (p.task !== Activity.Praying && p.task !== Activity.Training) return false;
  const reason =
    p.task === Activity.Praying
      ? this.prayerReason(p.id, p.taskSite)
      : this.trainingReason(p.id, p.taskSite, p.trainingCalling);
  const place = this.building(p.taskSite);
  if (reason || !place) {
    finishCeremony(this, p);
    if (reason) this.notify(reason);
    return true;
  }
  if (!this.walkTo(p, place.door())) {
    p.path = [];
    p.activity = Activity.Holding;
    p.until = this.time + 1;
    return true;
  }
  p.activity = p.task;
  p.target = place.id;
  if (!p.moving()) this.arrive(p);
  return true;
}
export function finishCeremony(town: TownState, p: Person): void {
  p.task = Activity.Idle;
  p.taskSite = -1;
  p.trainingCalling = -1;
  p.autoMode = true;
  p.ordered = p.aggressive = p.approachingOrder = false;
  p.activity = Activity.Idle;
  p.target = -1;
  p.path = [];
  p.inside = false;
  p.until = town.time;
}
export function completeAltarPrayer(this: DevotionTown, p: Person): boolean {
  if (
    p.task !== Activity.Praying ||
    p.activity !== Activity.Praying ||
    p.target !== p.taskSite ||
    p.crossingDoorway() ||
    p.moving() ||
    this.time < p.until
  )
    return false;
  const place = this.building(p.taskSite),
    reason = this.prayerReason(p.id, p.taskSite);
  if (place && distance(p.position, place.door()) > 0.05) return false;
  if (reason || !altar(place)) {
    finishCeremony(this, p);
    if (reason) this.notify(reason);
    return false;
  }
  this.stock(this.settlementOf(place)).food -= offeringFood;
  place.devotionDueDay = this.days;
  p.prayedAt = this.time;
  finishCeremony(this, p);
  this.processDevotion();
  ++this.changes;
  return true;
}
export function processDevotion(this: DevotionTown): void {
  for (const place of [...this.placed].sort((a, b) => a.id - b.id)) {
    if (
      !altar(place) ||
      !belongsToFaction(place, this.controlFaction) ||
      place.devotionDueDay < 0 ||
      place.devotionDueDay > this.days
    )
      continue;
    const village = this.settlementOf(place),
      camp = this.camp(village);
    if (
      !camp?.built() ||
      !sameFaction(camp, place) ||
      localResidents(this, place) >= localHousing(this, place)
    )
      continue;
    place.devotionDueDay = -1;
    createResident(this, place, 0);
  }
}
