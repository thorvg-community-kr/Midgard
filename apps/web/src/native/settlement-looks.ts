import { encodeAppearanceCode } from '../../../../packages/engine/src/appearance-code';
import { likenessOf } from '../../../../packages/engine/src/character-cast';
import { livingResident } from '../../../../packages/engine/src/faction';
import { Race } from '../../../../packages/engine/src/person';
import type { Town } from '../../../../packages/engine/src/town';
import type { ResidentPreset } from './resident-presets';

/** Recover the authored designs that the player can reuse, including ones from earlier settlements. */
export function settlementLooks(town: Town): ResidentPreset[] {
  const rows: ResidentPreset[] = [];
  for (const person of town.people()) {
    if (!person.customLook || person.race !== Race.Human || !livingResident(person, town.controlFaction))
      continue;
    // The founders wear the leaf of their own tree even if a saved studio look is present.
    if (likenessOf(person).leaf) continue;
    try {
      rows.push({ name: person.name, code: encodeAppearanceCode(person.customLook) });
    } catch (error) {
      // A studio look outside the creatable range cannot be reproduced by this version of the code.
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return rows;
}
