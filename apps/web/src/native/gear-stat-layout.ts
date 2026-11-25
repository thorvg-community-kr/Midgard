import { translate } from '../../../../packages/localization/src';
import type { GearField } from '../../../../packages/engine/src/gear-stats';
import { Align, Rect, tone, type Context } from '../../../../packages/native-ui/src';
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

/** Each stat keeps its own row and the same value column, including when a translated label wraps. */
export function gearTable(c: Context, fields: readonly GearField[], width: number, size: number, fullWidth = false) {
  const localized = fields.map(field => ({ ...field, label: translate(field.label) }));
  const values = localized.filter(field => field.value !== undefined);
  const valueW = Math.ceil(Math.max(22, ...values.map(field => c.textWidth(field.value!, size, false, field.label) + 2)));
  const tableW = fullWidth ? width : Math.min(width, Math.max(148, ...values.map(field => c.textWidth(field.label, size) + valueW + 12)));
  const labelW = tableW - valueW - 8;
  const rows = localized.flatMap(field => {
    const labels = field.value === undefined ? gearStatRows(c, [field.label], width, size)
      : wrapText(c, field.label, labelW, size, Infinity);
    return labels.map((label, i) => ({ label, value: i === labels.length - 1 ? field.value : undefined,
      labelW: field.value === undefined ? width : labelW, change: field.change }));
  });
  return { rows, tableW, valueW, size };
}

export function drawGearTable(c: Context, table: ReturnType<typeof gearTable>, x: number, y: number, leading: number, paper = false, primaryRows = 0): number {
  const t = c.theme();
  for (const [i, { label, value, labelW, change }] of table.rows.entries()) {
    const color = change === undefined || change === 0 ? (paper ? t.ink : t.text)
      : change > 0 ? (paper ? tone(t.ink, t.success, 0.28) : t.success) : (paper ? t.inkDanger : t.danger);
    if (paper && (primaryRows ? i < primaryRows : change !== undefined))
      c.rect(new Rect(x - 3, y, table.tableW + 6, leading), tone(t.paper, t.inkAccent, 0.12), 2);
    c.text(new Rect(x, y, labelW, leading), label, change === undefined ? (paper ? t.ink : t.muted) : color, table.size);
    if (value !== undefined)
      c.text(new Rect(x + table.tableW - table.valueW, y, table.valueW, leading), value, color, table.size, false, Align.End, 0, label);
    y += leading;
  }
  return y;
}
