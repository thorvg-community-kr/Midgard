import { Resources, resourceKeys } from './building-catalog';
import { livingResident } from './faction';
import type { TownState } from './town-state';

export const offeringKeys = ['water', 'bones', 'gold', 'food', 'stone'] as const;
export type OfferingKey = (typeof offeringKeys)[number];
export const offeringFood = 4;
export const offeringStep = 4;
export const maxOfferingBonus = 3;
export const maxOfferingGoods = offeringFood + offeringStep * maxOfferingBonus;
export const defaultOffering = (): Resources => new Resources(0, 0, 0, offeringFood);

export const offeringTotal = (offering: Resources): number =>
  offeringKeys.reduce((sum, key) => sum + offering[key], 0);

/** Every full measure beyond the food for one resident grants another aptitude point. */
export const offeringBonus = (offering: Resources): number =>
  Math.max(0, Math.min(maxOfferingBonus, Math.floor((offeringTotal(offering) - offeringFood) / offeringStep)));

export function offeringReason(offering: Resources): string {
  if (resourceKeys.some((key) => !Number.isSafeInteger(offering[key]) || offering[key] < 0))
    return 'Offering amounts must be whole, nonnegative numbers.';
  if (resourceKeys.some((key) => !offeringKeys.includes(key as OfferingKey) && offering[key] !== 0))
    return 'Only water, bones, gold, food and stone can be offered.';
  if (offering.food < offeringFood) return 'Need 4 food for the altar offering.';
  if (offeringTotal(offering) > maxOfferingGoods) return 'The altar holds up to 16 goods.';
  return '';
}

export function residentStartingLevel(town: Pick<TownState, 'folk' | 'controlFaction'>): number {
  let levels = 0, residents = 0;
  for (const person of town.folk) {
    if (!livingResident(person, town.controlFaction)) continue;
    levels += person.level;
    ++residents;
  }
  return residents ? Math.max(1, Math.floor(levels / residents / 2)) : 1;
}
