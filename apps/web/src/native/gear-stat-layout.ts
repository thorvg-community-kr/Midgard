import { translate } from '../../../../packages/localization/src';
import type { Context } from '../../../../packages/native-ui/src';
import { wrapText } from './game-combat-hud';

/** Keep each stat with its value. A resident's own name may have no translation. */
export function gearStatRows(c: Context, stats: readonly string[], width: number, size: number): string[] {
  const rows: string[] = [];
  for (const stat of stats) {
    for (const field of stat.split(' · ')) {
      if (!field) continue;
      const label = translate(field), last = rows.length - 1;
      const joined = last >= 0 ? `${rows[last]} · ${label}` : '';
      if (joined && c.textWidth(joined, size) <= width) rows[last] = joined;
      else if (c.textWidth(label, size) <= width) rows.push(label);
      else rows.push(...wrapText(c, label, width, size, Infinity));
    }
  }
  return rows;
}
