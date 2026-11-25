import { burdenFrom, carriedWeight, carryLimit } from '../../../../packages/engine/src/carried-resources';
import { Rect, button, ButtonStyle, Align, well, type Context } from '../../../../packages/native-ui/src';
import {
  inventorySlots,
  equipmentSlots,
  equippedItem,
  itemCatalog,
  attackDamage,
  combatAttributes,
  combatItem,
  armorProtection,
  workItem,
  itemSpec,
  isShield,
  raisedShield,
  carriedTools,
  type ItemSpec,
} from '../../../../packages/engine/src/equipment';
import { attackPreview, attributeLine, gearStats, modifierPoints } from '../../../../packages/engine/src/gear-stats';
import { staffCrook } from '../../../../packages/native-renderer/src/staff-art';
import { Activity } from '../../../../packages/engine/src/person';
import { residentServices } from './resident-services';
import { equipBlock } from '../../../../packages/engine/src/town-equipment';
import { canControl } from '../../../../packages/engine/src/faction';
import type { Person } from '../../../../packages/engine/src/person';
import type { GameHudApp } from './game-hud-contract';
import { actionButton } from './hud-actions';
import { hudPaint } from './hud-paint';
import { gearStatRows } from './gear-stat-layout';

export function itemIcon(c: Context, r: Rect, item: ItemSpec | null, placeholder = false, active = false): void {
  const t = c.theme(),
    x = r.x + r.w / 2,
    y = r.y + r.h / 2,
    s = Math.min(r.w, r.h) / 32;
  const ink = active ? t.accentText : placeholder ? t.muted : t.accent;
  const line = (a: number, b: number, d: number, e: number, w = 2) =>
    c.line(x + a * s, y + b * s, x + d * s, y + e * s, ink, w * s);
  if (!item) return;
  if (item.category === 'resource') {
    if (item.id === 'wood' || item.id === 'frostwood' || item.id === 'bound-frostwood') {
      line(-8, 7, 7, -7, 7);
      line(-9, 6, 5, -8, 1);
      if (item.id === 'bound-frostwood') line(-4, -4, 3, 3, 3);
    } else if (item.id === 'planks') {
      for (const offset of [-7, 0, 7]) {
        line(-10, offset - 2, 10, offset - 2, 1.5);
        line(10, offset - 2, 10, offset + 2, 1.5);
        line(10, offset + 2, -10, offset + 2, 1.5);
        line(-10, offset + 2, -10, offset - 2, 1.5);
        line(-6, offset, 5, offset, 0.8);
      }
    } else if (item.id === 'hides') {
      line(-7, -7, -3, -3, 5); line(7, -7, 3, -3, 5);
      line(-6, 8, -2, 3, 5); line(6, 8, 2, 3, 5);
      c.rect(new Rect(x - 5 * s, y - 5 * s, 10 * s, 11 * s), ink, 3 * s);
    } else if (item.id === 'iron-ingot' || item.id === 'embersteel') {
      line(-8, 3, 7, -2, 8); line(-7, -1, 6, -5, 3);
    } else if (item.id === 'stone' || item.id === 'iron-ore' || item.id === 'cinder-ore') {
      line(-9, 7, -6, -5);
      line(-6, -5, 4, -9);
      line(4, -9, 10, 5);
      line(10, 5, -9, 7);
      line(-6, -5, 1, 1);
      line(1, 1, 10, 5);
    } else if (item.id === 'cut-stone') {
      for (const [left, top, width] of [
        [-10, 1, 9],
        [1, 1, 9],
        [-6, -7, 12],
      ]) {
        line(left, top, left + width, top, 1.5);
        line(left + width, top, left + width, top + 6, 1.5);
        line(left + width, top + 6, left, top + 6, 1.5);
        line(left, top + 6, left, top, 1.5);
      }
    } else if (item.id === 'bones') {
      line(-7, 6, 7, -6, 5);
      for (const [dx, dy] of [[-9, 4], [-6, 8], [6, -8], [9, -4]])
        c.rect(new Rect(x + (dx - 3) * s, y + (dy - 3) * s, 6 * s, 6 * s), ink, 3 * s);
    } else if (item.id === 'water') {
      line(0, -10, -7, 3);
      line(-7, 3, 0, 9);
      line(0, 9, 7, 3);
      line(7, 3, 0, -10);
    } else c.rect(new Rect(x - 7 * s, y - 7 * s, 14 * s, 14 * s), ink, 7 * s);
  } else if (item.id === 'cap' || item.id === 'helmet') {
    line(-9, 5, -7, -4);
    line(-7, -4, 0, -9);
    line(0, -9, 7, -4);
    line(7, -4, 9, 5);
    line(-10, 5, 10, 5);
    line(0, -8, 0, 3, 1);
  } else if (item.slots.includes('feet')) {
    line(-8, -9, -8, 7);
    line(-8, 7, -1, 7);
    line(-1, 7, -1, 2);
    line(-1, 2, -4, 1);
    line(-4, 1, -4, -9);
    line(2, -9, 2, 7);
    line(2, 7, 10, 7);
    line(10, 7, 9, 2);
    line(9, 2, 6, 1);
    line(6, 1, 6, -9);
  } else if (item.id === 'gloves') {
    line(-6, 9, -9, 0);
    line(-9, 0, -6, -2);
    line(-6, -2, -4, 2);
    line(-4, 2, -4, -8);
    line(-1, -7, -1, 0);
    line(2, -9, 2, 0);
    line(5, -6, 5, 4);
    line(5, 4, 2, 9);
    line(2, 9, -6, 9);
  } else if (isShield(item)) {
    line(-9, -8, 9, -8);
    line(9, -8, 7, 4);
    line(7, 4, 0, 10);
    line(0, 10, -7, 4);
    line(-7, 4, -9, -8);
    line(-6, -3, 6, -3, 1);
    line(0, -6, 0, 7, 1);
  } else if (item.id === 'cloak') {
    line(-4, -9, 4, -9);
    line(4, -9, 10, 10);
    line(10, 10, -10, 10);
    line(-10, 10, -4, -9);
    line(-4, -6, 0, -3);
    line(0, -3, 4, -6);
  } else if (item.visual === 'basket') {
    line(-8, -6, 8, -6);
    line(8, -6, 6, 9);
    line(6, 9, -6, 9);
    line(-6, 9, -8, -6);
    line(-7, -1, 7, -1, 1);
    line(-6, 4, 6, 4, 1);
    line(-4, -6, -2, -11, 1.5);
    line(-2, -11, 2, -11, 1.5);
    line(2, -11, 4, -6, 1.5);
  } else if (item.category === 'armor') {
    line(-9, -7, -3, -10);
    line(-3, -10, 3, -10);
    line(3, -10, 9, -7);
    line(9, -7, 6, 9);
    line(6, 9, -6, 9);
    line(-6, 9, -9, -7);
    line(0, -8, 0, 7, 1);
  } else if (item.visual === 'bow') {
    line(-5, -10, 2, -7);
    line(2, -7, 6, 0);
    line(6, 0, 2, 7);
    line(2, 7, -5, 10);
    line(-5, -10, -5, 10, 1);
    line(-9, 0, 10, 0, 1);
  } else if (item.visual === 'spear') {
    line(-9, 11, 6, -6, 2);
    line(6, -6, 4, -11, 2);
    line(4, -11, 10, -10, 2);
    line(10, -10, 6, -6, 2);
  } else if (item.visual === 'knife') {
    line(-8, 9, -3, 4, 3);
    line(-4, 3, 2, 1, 2);
    line(-1, 5, 8, -8, 3);
  } else if (item.visual === 'staff') {
    c.paint(JSON.stringify(['staff-icon', x, y, s, ink]), () => {
      const staff = staffCrook().strokeWidth(2).strokeFill(ink.r, ink.g, ink.b, ink.a);
      return hudPaint(c, staff.transform([s, 0, x - 3.2 * s, 0, s, y + 6 * s, 0, 0, 1]));
    });
  } else if (item.visual === 'sword' || item.visual === 'mace') {
    line(-7, 10, 7, -10, 3);
    line(-8, 4, -2, 9);
    if (item.visual === 'mace') c.rect(new Rect(x + 2 * s, y - 12 * s, 8 * s, 8 * s), ink, 3 * s);
  } else {
    line(-7, 10, 4, -8, 2);
    if (item.visual === 'hammer') line(-1, -10, 10, -3, 5);
    else if (item.visual === 'shovel') {
      line(2, -6, 9, -13, 7);
      line(1, -5, 6, -10, 3);
    } else if (item.visual === 'sickle') {
      line(4, -8, 9, -9);
      line(9, -9, 11, -4);
      line(11, -4, 8, 1);
    }
    else if (item.visual === 'axe') {
      line(1, -8, 10, -8, 5);
      line(10, -8, 10, 0, 3);
    } else line(-3, -10, 10, -3, 2);
  }
}

/** The tool doing the work under way, e.g. " · with a Wooden axe". */
export function workPace(p: Person): string {
  if (p.moving() || (p.activity !== Activity.Felling && p.activity !== Activity.Mining)) return '';
  const tool = workItem(p, p.activity === Activity.Felling ? 'woodcutting' : 'mining');
  return tool ? ` · with a ${tool.name}` : ' · by hand';
}
/** The selection shortcut opens this resident's workshop orders inside their profile. */
export function openWorkbench(app: GameHudApp, p: Person): void {
  app.rosterOpen = true;
  app.rosterTab = 'units';
  app.rosterSelected = `units:${p.id}`;
  app.equipmentTab = 'craft';
  app.craftWorkshopFilter = null;
  app.craftPage = 0;
  app.inventorySelected = -1;
}
export const workbenchTip = () => 'Craft or upgrade equipment for this resident';
/** Inventory owns real finite stacks; gear slots reference those same stacks. */
export function equipmentPanel(app: GameHudApp, p: Person, panel: Rect): void {
  const c = app.context, t = app.theme, enabled = canControl(p);
  let top = panel.y + 33;
  const tabs = [['equipment', 'Equipment'], ['craft', 'Craft'], ['guild', 'Guild']] as const;
  const tabWidth = Math.min(80, (panel.w - 8) / 3);
  for (const [index, [tab, name]] of tabs.entries())
    button(c, tab === 'craft' ? 'equipment-workbench' : `equipment-tab-${tab}`, new Rect(panel.x + index * (tabWidth + 4), panel.y, tabWidth, 27), name,
      () => { app.equipmentTab = tab; app.craftPage = 0; app.inventorySelected = -1; },
      app.equipmentTab === tab ? ButtonStyle.Primary : ButtonStyle.Default, true, undefined, false, { fontSize: 11 });
  if (app.equipmentTab === 'craft' || app.equipmentTab === 'guild') {
    residentServices(app, p, new Rect(panel.x, top, panel.w, panel.h - 33));
    return;
  }
  const statsLeft = (tabWidth + 4) * 3;
  const aptitudes = attributeLine(combatAttributes(p)) + (p.birthVitality ? ` · Vitality +${p.birthVitality}` : '');
  const stackedStats = c.textWidth(aptitudes, 11) > panel.w - statsLeft;
  if (stackedStats) {
    for (const words of gearStatRows(c, [aptitudes], panel.w, 11)) {
      c.text(new Rect(panel.x, top, panel.w, 17), words, t.text, 11);
      top += 17;
    }
  } else c.text(new Rect(panel.x + statsLeft, panel.y, panel.w - statsLeft, 28), aptitudes, t.text, 11);
  const available = panel.y + panel.h - top;
  const gridCell = Math.max(16, Math.min(45, Math.floor((panel.w - 18) / 7), Math.floor((available - 52) / 4)));
  // Reserve a readable column where the grids fit beside it, otherwise keep space for stats below both grids.
  const sideCell = Math.floor((panel.w - 30 - 170) / 7);
  const cell = sideCell >= Math.min(24, gridCell) ? Math.min(sideCell, gridCell)
    : Math.max(16, Math.min(gridCell, Math.floor((available - 138) / 4)));
  const bagW = cell * 4,
    gearX = panel.x + bagW + 14;
  const slots = inventorySlots(p);
  slots.forEach((slot, index) => {
    const r = new Rect(panel.x + (index % 4) * cell, top + Math.floor(index / 4) * cell, cell - 3, cell - 3),
      selected = app.inventorySelected === slot.slot;
    const state = button(
      c,
      `inventory-slot-${slot.slot}`,
      r,
      '',
      () => {
        if (
          app.inventorySelected >= 0 &&
          app.inventorySelected !== slot.slot &&
          !slot.item &&
          app.town.transferInventory(p.id, app.inventorySelected, slot.slot)
        )
          app.inventorySelected = -1;
        else app.inventorySelected = app.inventorySelected === slot.slot ? -1 : slot.slot;
      },
      selected ? ButtonStyle.Primary : ButtonStyle.Default,
      true,
      undefined,
      false,
      { sunken: true },
    );
    itemIcon(c, r, slot.item, false, selected);
    if (slot.quantity)
      c.text(
        new Rect(r.x + 2, r.y + r.h - 16, r.w - 4, 15),
        String(slot.quantity),
        selected ? t.accentText : t.text,
        10,
        true,
        Align.End,
      );
    if (slot.equipped.length) c.rect(new Rect(r.x + 3, r.y + 3, 4, 4), t.success, 2);
    if (slot.cargo) c.text(new Rect(r.x + 2, r.y + 1, r.w - 4, 11), '↧', t.muted, 9);
    if (state.hovered)
      c.text(
        new Rect(panel.x, panel.y + panel.h - 22, panel.w, 20),
        slot.item
          ? `${slot.item.name} · ${slot.quantity}${slot.equipped.length ? ' · equipped' : ''}`
          : 'Empty inventory slot',
        t.muted,
        10,
      );
  });
  // Tools work straight from the pack, so only what is held or worn has a slot here.
  equipmentSlots.filter((slot) => slot !== 'tool1' && slot !== 'tool2').forEach((slot, index) => {
    const item = equippedItem(p, slot),
      r = new Rect(gearX + (index % 3) * cell, top + Math.floor(index / 3) * cell, cell - 3, cell - 3);
    const state = button(
      c,
      `equipment-slot-${slot}`,
      r,
      '',
      () => {
        if (app.inventorySelected > 0) {
          const chosen = itemSpec(p.inventory[app.inventorySelected - 1]?.item ?? ''),
            blocked = chosen ? equipBlock(p, chosen, slot) : '';
          if (!app.town.equipItem(p.id, app.inventorySelected, slot))
            app.status = blocked || (chosen?.category === 'tool' ? 'Tools work from the pack' : 'This item does not fit that slot or requires a higher level');
        } else app.town.unequipItem(p.id, slot);
      },
      item ? ButtonStyle.Primary : ButtonStyle.Default,
      enabled,
      undefined,
      false,
      { sunken: true },
    );
    const placeholders = {
      weapon: 'sword',
      tool1: 'hammer',
      tool2: 'axe',
      head: 'helmet',
      body: 'wooden-armor',
      feet: 'boots',
      hands: 'gloves',
      offhand: 'shield',
      accessory: 'cloak',
    };
    itemIcon(c, r, item ?? itemCatalog.find((i) => i.id === placeholders[slot]) ?? null, !item, !!item);
    if (state.hovered)
      c.text(
        new Rect(panel.x, panel.y + panel.h - 22, panel.w, 20),
        `${slot}: ${item?.name ?? 'empty'} · ${app.inventorySelected > 0 ? 'equip selected item' : 'click to unequip'}`,
        t.muted,
        10,
      );
  });
  const selected = slots.find((s) => s.slot === app.inventorySelected),
    y = top + cell * 3 + 4;
  actionButton(
    c,
    'inventory-equip',
    new Rect(gearX, y, 36, 28),
    'gear',
    'Equip selected item',
    () => {
      if (app.inventorySelected > 0 && !app.town.equipItem(p.id, app.inventorySelected))
        app.status = 'Select suitable gear and meet its level requirement';
    },
    false,
    enabled && !!selected?.item?.slots.length,
  );
  actionButton(
    c,
    'inventory-deposit',
    new Rect(gearX + 40, y, 36, 28),
    'bag',
    'Deposit selected resources',
    () => {
      if (!app.town.depositInventory(p.id, app.inventorySelected))
        app.status = app.town.inventoryTransferReason(p.id) || 'Storage cannot accept these resources';
    },
    false,
    enabled && selected?.item?.category === 'resource',
  );
  const resources = itemCatalog.filter((item) => item.category === 'resource');
  resources.slice(0, 4).forEach((item, index) => {
    const r = new Rect(gearX + index * cell * 0.7, top + cell * 4 + 5, cell * 0.65, 25);
    const state = button(
      c,
      `inventory-withdraw-${item.id}`,
      r,
      '',
      () => {
        if (!app.town.withdrawInventory(p.id, item.product, 1))
          app.status =
            app.town.inventoryTransferReason(p.id) || `No ${item.name.toLowerCase()} or inventory space`;
      },
      ButtonStyle.Quiet,
      enabled,
    );
    itemIcon(c, r, item);
    if (state.hovered)
      c.text(
        new Rect(panel.x, panel.y + panel.h - 22, panel.w, 20),
        `Take 1 ${item.name.toLowerCase()} from settlement storage`,
        t.muted,
        10,
      );
  });
  const detailX = gearX + cell * 3 + 16,
    detailW = panel.x + panel.w - detailX,
    change = selected?.item?.scaling ? attackDamage(p, selected.item) - attackDamage(p) : 0,
    previewColor = change < 0 ? t.danger : change > 0 ? t.success : t.text;
  const combatStats = () => `Attack ${attackDamage(p)} · Defence ${modifierPoints(armorProtection(p))}`;
  const item = selected?.item, stats = item ? gearStats(item) : [];
  const preview = item?.scaling ? attackPreview(p, item) : '';
  if (detailW >= 150) {
    const box = new Rect(detailX, top, detailW, Math.min(available - 22, 240));
    well(c, box);
    const text = (at: number, value: string, color = t.text, size = 11, bold = false) => {
      if (at + 21 > box.h) return;
      c.text(
        new Rect(box.x + 12, box.y + at, box.w - 24, 21),
        c.elideText(value, box.w - 24, size, bold),
        color,
        size,
        bold,
      );
    };
    if (item && selected) {
      itemIcon(c, new Rect(box.x + 9, box.y + 4, 25, 25), item);
      const titleW = box.w - 50;
      c.text(new Rect(box.x + 42, box.y + 4, titleW, 22), c.elideText(item.name, titleW, 12, true), t.accent, 12, true);
      text(26, `Level ${item.minimumLevel} · ${item.category}`, p.level < item.minimumLevel ? t.danger : t.muted);
      const lines = gearStatRows(c, stats.length ? stats : [`Quantity ${selected.quantity} / ${item.maximumStack}`], box.w - 24, 11);
      if (preview) lines.unshift(preview);
      lines.forEach((line, i) => {
        const y = 47 + i * 16;
        if (y + 16 <= box.h)
          c.text(new Rect(box.x + 12, box.y + y, box.w - 24, 16), line, i === 0 && preview ? previewColor : t.text, 11);
      });
      const below = 50 + lines.length * 16;
      text(below, item.description, t.muted, 10);
      text(
        below + 23,
        selected.equipped.length ? `Equipped: ${selected.equipped.join(', ')}` : 'In the backpack',
        t.success,
        10,
      );
    } else {
      text(12, 'Equipment', t.accent, 14, true);
      text(43, combatStats());
      const shield = equippedItem(p, 'offhand');
      text(
        69,
        `Main hand: ${combatItem(p)?.name ?? 'Bare hands'}` +
          (shield ? ` · ${shield.name}${raisedShield(p) ? '' : ' (needs a free hand)'}` : ''),
        t.muted,
      );
      text(95, `Tools from the pack: ${carriedTools(p).map((item) => item.name).join(', ') || 'none'}`, t.muted);
      // Live load against this resident's own limit, which a pack basket raises.
      const weight = carriedWeight(p),
        slowed = weight > burdenFrom(p),
        used = slots.filter((slot) => !slot.cargo && slot.item).length;
      text(
        121,
        `Backpack ${used} / 15 · ${weight.toFixed(1)} / ${carryLimit(p)} kg` + (slowed ? ' · slowed' : ''),
        slowed ? t.danger : t.muted,
      );
      text(157, 'Select an item, then choose a gear slot.', t.muted, 10);
    }
  } else {
    let y = top + cell * 4 + 32;
    if (item) {
      c.text(new Rect(panel.x, y, panel.w, 18), item.name, t.accent, 12, true);
      y += 18;
    }
    const lines = gearStatRows(c, item ? stats : [combatStats()], panel.w, 11);
    if (preview) lines.unshift(preview);
    for (const [i, words] of lines.entries()) {
      if (y + 16 <= panel.y + panel.h - 20)
        c.text(new Rect(panel.x, y, panel.w, 16), words, i === 0 && preview ? previewColor : t.text, 11);
      y += 16;
    }
  }

}
