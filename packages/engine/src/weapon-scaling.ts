import { Calling, type Person } from './person';

export type AttackAttribute = 'strength' | 'dexterity' | 'intelligence';
export type Attributes = Record<AttackAttribute, number>;
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E';
export type Scaling = Partial<Record<AttackAttribute, Grade>>;
export type WeaponShape = 'sword' | 'mace' | 'spear' | 'bow' | 'staff';
export const attributeNames: Record<AttackAttribute, string> = {
  strength: 'STR', dexterity: 'DEX', intelligence: 'INT',
};

/** Each column is one make, from wood through regional masterwork. */
export const weaponGrades: Record<WeaponShape, readonly Scaling[]> = {
  sword: [
    { strength: 'C', dexterity: 'E' }, { strength: 'B', dexterity: 'D' },
    { strength: 'A', dexterity: 'D' }, { strength: 'S', dexterity: 'C' },
  ],
  mace: [
    { strength: 'C', intelligence: 'D' }, { strength: 'B', intelligence: 'C' },
    { strength: 'A', intelligence: 'C' }, { strength: 'A', intelligence: 'B' },
  ],
  spear: [
    { dexterity: 'C', strength: 'D' }, { dexterity: 'B', strength: 'D' },
    { dexterity: 'B', strength: 'C' }, { dexterity: 'A', strength: 'B' },
  ],
  bow: [{ dexterity: 'C' }, { dexterity: 'B' }, { dexterity: 'A' }, { dexterity: 'S' }],
  staff: [{ intelligence: 'C' }, { intelligence: 'B' }, { intelligence: 'A' }, { intelligence: 'S' }],
};

// Strength, dexterity and intelligence before altar gifts and worn gear.
const callingStats: Record<keyof typeof Calling, readonly [number, number, number]> = {
  Settler: [2, 2, 1], Traveller: [2, 2, 2], Warrior: [4, 2, 1], Ranger: [2, 4, 1],
  Mage: [1, 1, 4], Cleric: [2, 1, 4], Bard: [1, 3, 3],
};
export function naturalAttributes(p: Person): Attributes {
  const [strength, dexterity, intelligence] = callingStats[Calling[p.calling] as keyof typeof Calling];
  const training = Math.floor(p.level / 10), specialty = Math.max(strength, dexterity, intelligence);
  return {
    strength: strength + p.birthStrength + training * (strength === specialty ? 2 : 1),
    dexterity: dexterity + training * (dexterity === specialty ? 2 : 1),
    intelligence: intelligence + training * (intelligence === specialty ? 2 : 1),
  };
}

export const gradeWeight: Record<Grade, number> = { E: 1, D: 2, C: 3, B: 4, A: 5, S: 6 };
/** Both attributes contribute before rounding, so a hybrid weapon can earn a point from the pair. */
export function scalingBonus(stats: Attributes, grades: Scaling): number {
  let weight = 0;
  for (const name of Object.keys(grades) as AttackAttribute[]) weight += stats[name] * gradeWeight[grades[name]!];
  return Math.floor(weight / 12);
}
