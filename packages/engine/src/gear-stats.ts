import { Structure } from './building-catalog';
import { attackDamage, bareReach, combatItem, efficiencyAtRate, isShield, type ItemSpec, type WorkKind } from './equipment';
import type { Person } from './person';
import { StrikeKind, strikeOf } from './skill-catalog';
import { attributeNames, gradeWeight, type AttackAttribute, type Attributes } from './weapon-scaling';

const workStats: Record<WorkKind, string> = {
  woodcutting: 'Felling efficiency',
  mining: 'Mining efficiency',
  construction: 'Building efficiency',
  farming: 'Farming efficiency',
  watering: 'Watering efficiency',
  sawing: 'Sawing efficiency',
  crafting: 'Crafting efficiency',
  digging: 'Digging efficiency',
  reaping: 'Reaping efficiency',
};
const strikeTags: Partial<Record<StrikeKind, string>> = {
  [StrikeKind.Cleave]: 'Cleaves',
  [StrikeKind.Crush]: 'Staggers',
  [StrikeKind.Pierce]: 'Pierces',
  [StrikeKind.Splash]: 'Splashes',
};
export const attributeLine = (stats: Attributes): string =>
  `STR ${stats.strength} · DEX ${stats.dexterity} · INT ${stats.intelligence}`;
/** One point represents a tenth of a defensive, movement or yield modifier. Reach is measured in tiles. */
export const modifierPoints = (share: number): number => Math.round(share * 100) / 10;
export interface GearField {
  label: string;
  value?: string;
  /** Present only on a resident's total, including when it stays the same. */
  change?: number;
}
export const gearFieldText = ({ label, value }: GearField): string => value === undefined ? label : `${label} ${value}`;

/** Item bonuses, traits, then the optional resident's actual attack, in display order. */
export function gearFields(item: ItemSpec, person?: Person | null): GearField[] {
  if (item.category === 'resource') return [];
  const out: GearField[] = [],
    stat = (label: string, amount: number) => {
      const value = Math.round(amount * 10) / 10;
      if (value) out.push({ label, value: value > 0 ? `+${value}` : String(value) });
    },
    shot = item.visual === 'bow' || item.visual === 'staff';
  for (const kind of item.work) stat(workStats[kind], efficiencyAtRate(item.rate));
  const attack = item.category === 'tool' ? 'Attack as a weapon' : shot ? 'Ranged attack' : 'Melee attack';
  stat(attack, item.attackBonus);
  for (const key of Object.keys(attributeNames) as AttackAttribute[]) {
    const grade = item.scaling?.[key];
    if (grade) stat(`${attributeNames[key]} scaling`, gradeWeight[grade]);
  }
  if (item.attribute) stat(attributeNames[item.attribute], 1);
  stat('Reach', item.reach - bareReach);
  stat('Defence', modifierPoints(item.defense));
  stat('Shield block', modifierPoints(item.block));
  stat('Carry', item.carry);
  stat('Walking speed', modifierPoints(item.walkBonus));
  stat('Snow footing', modifierPoints(item.snowGrip));
  stat('Hunt yield', modifierPoints(item.huntBonus));
  const tags = [
    item.lavaProof ? 'Ignores lava damage and slowdown' : undefined,
    item.id === 'embersteel-pick' ? 'Breaks cooled basalt' : undefined,
    item.category === 'weapon' ? strikeTags[strikeOf(item.visual).kind] : undefined,
    item.hands === 2 ? 'Two-handed' : undefined,
    isShield(item) ? 'Off hand' : undefined,
  ].filter((tag): tag is string => !!tag);
  if (tags.length) out.push({ label: tags.join(' · ') });
  if (person && person.level >= item.minimumLevel && (item.category === 'weapon' || item.category === 'tool')) {
    const tool = item.category === 'tool', before = attackDamage(person),
      after = attackDamage(person, tool ? combatItem(person, item) : item);
    out.push({
      label: tool ? 'Attack with tool in pack' : 'Attack if equipped',
      value: before === after ? String(after) : `${before} → ${after}`,
      change: after - before,
    });
  }
  return out;
}
/** The personal attack row, when the resident can use this make. */
export function attackPreview(person: Person, item: ItemSpec): string {
  const preview = gearFields(item, person).find(field => field.change !== undefined);
  return preview ? gearFieldText(preview) : '';
}
export const gearStats = (item: ItemSpec, person?: Person): string[] => gearFields(item, person).map(gearFieldText);
/** The stats of gear on one line; a refined material says what it is for. */
export function gearEffect(item: ItemSpec): string {
  return item.workshop === Structure.Foundry ? item.description : gearStats(item).join(' · ');
}
