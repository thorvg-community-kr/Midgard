import { Structure } from './building-catalog';
import type { ItemSpec } from './equipment';
import { Calling } from './person';

export const guildLevel = 3;
/** A finished school teaches the guild its calling and the smithy its weapon family. */
export const callingSchools: Partial<Record<Calling, Structure>> = {
  [Calling.Warrior]: Structure.TrainingYard,
  [Calling.Ranger]: Structure.Watchtower,
  [Calling.Mage]: Structure.MageTower,
  [Calling.Cleric]: Structure.Shrine,
  [Calling.Bard]: Structure.Tavern,
};
export function weaponSchool(item: ItemSpec): Structure | undefined {
  if (item.category !== 'weapon') return;
  switch (item.visual) {
    case 'spear': return callingSchools[Calling.Warrior];
    case 'bow': return callingSchools[Calling.Ranger];
    case 'staff': return callingSchools[Calling.Mage];
  }
}
/** A completed watchtower shoots the nearest raider or angry monster in reach. */
export const towerVolley = { reach: 9, pause: 1.2, damage: 1.5 };
/** Grief multiplier while a runestone stands. */
export const runestoneComfort = 0.5;
