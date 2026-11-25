import { Rect, tag, tone, well, type Context } from '../../../../packages/native-ui/src';
import { combatItem, equippedItem, madeFrom, workItem, type ItemSpec } from '../../../../packages/engine/src/equipment';
import type { GearField } from '../../../../packages/engine/src/gear-stats';
import type { Person } from '../../../../packages/engine/src/person';
import { wrapText } from './game-combat-hud';
import { drawGearTable, gearTable } from './gear-stat-layout';
import { itemIllustration } from './item-icon';

export function comparesWith(item: ItemSpec, p: Person): string {
  const below = madeFrom(item);
  if (below) return `Upgrades from ${below.name}`;
  if (item.category === 'weapon') return `Currently using ${combatItem(p)?.name ?? 'Bare hands'}`;
  if (item.category === 'tool' && item.work.length)
    return `Currently using ${workItem(p, item.work[0])?.name ?? 'Bare hands'}`;
  const worn = item.slots.length ? equippedItem(p, item.slots[0]) : null;
  return worn ? `Currently using ${worn.name}` : '';
}

/** Measure and draw the same sheet in the pack, a personal order or a station. */
export function itemSheet(c: Context, item: ItemSpec, fields: GearField[], width: number, compact: boolean,
  subtitle: string, notes: readonly { text: string; warning?: boolean }[] = [], headerReserve = 0) {
  const t = c.theme(), pad = compact ? 7 : 13, inner = width - 2 * pad;
  const mount = compact ? 25 : 40, gap = compact ? 6 : 10;
  const font = compact ? 11 : 13, leading = compact ? 14 : 21, title = compact ? 12 : 16;
  const titleW = inner - mount - gap - headerReserve;
  const heading = Math.max(mount, (compact ? 16 : 23) + (subtitle ? (compact ? 13 : 18) : 0));
  const table = gearTable(c, fields, inner, font, true);
  const lines = notes.flatMap(note => wrapText(c, note.text, inner, font, Infinity).map(text => ({ text, warning: note.warning })));
  const top = pad + heading + (compact ? 4 : 9), footer = lines.length ? (compact ? 3 : 8) + leading * lines.length : 0;
  const height = top + table.rows.length * leading + footer + pad;
  return { height, draw(x: number, y: number) {
    tag(c, new Rect(x, y, width, height), { lip: 1 });
    const at = x + pad, textX = at + mount + gap;
    well(c, new Rect(at, y + pad, mount, mount), t.surface);
    itemIllustration(c, new Rect(at + 1, y + pad + 1, mount - 2, mount - 2), item);
    c.text(new Rect(textX, y + pad, titleW, subtitle ? (compact ? 16 : 23) : mount), c.elideText(item.name, titleW, title, true), t.ink, title, true);
    if (subtitle) c.text(new Rect(textX, y + pad + (compact ? 15 : 23), titleW, compact ? 14 : 18),
      c.elideText(subtitle, titleW, compact ? 10 : 11), t.inkAccent, compact ? 10 : 11);
    c.rect(new Rect(at, y + top - 2, inner, 1), tone(t.paper, t.ink, 0.23));
    let bottom = drawGearTable(c, table, at, y + top, leading, true, item.category === 'weapon' ? 0 : Math.max(1, item.work.length));
    if (lines.length) bottom += compact ? 3 : 8;
    for (const line of lines) {
      c.text(new Rect(at, bottom, inner, leading), line.text, line.warning ? t.inkDanger : t.ink, font);
      bottom += leading;
    }
  }};
}
