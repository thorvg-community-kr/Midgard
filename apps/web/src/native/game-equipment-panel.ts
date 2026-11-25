import { burdenFrom, carriedWeight, carryLimit } from '../../../../packages/engine/src/carried-resources';
import { Rect, button, ButtonStyle, Align, well, tag, meter } from '../../../../packages/native-ui/src';
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
  raisedShield,
  carriedTools,
} from '../../../../packages/engine/src/equipment';
import { attributeLine, gearFields, modifierPoints } from '../../../../packages/engine/src/gear-stats';
import { itemIcon, itemIllustration } from './item-icon';
import { itemSheet } from './gear-item-sheet';
export { itemIcon } from './item-icon';
import { Activity } from '../../../../packages/engine/src/person';
import { itemUpgrade, residentServices } from './resident-services';
import { equipBlock } from '../../../../packages/engine/src/town-equipment';
import { canControl } from '../../../../packages/engine/src/faction';
import type { Person } from '../../../../packages/engine/src/person';
import type { GameHudApp } from './game-hud-contract';
import { resourceAmount } from '../../../../packages/engine/src/construction-materials';
import { Structure } from '../../../../packages/engine/src/building-catalog';
import { tooltip } from './game-combat-hud';
import { gearStatRows, gearTable } from './gear-stat-layout';
import { touchTarget } from './mobile-layout';

// The pack uses 0 for cargo and positive indices for stacks. Storage is a transient view of the same panel.
const storageSelection = -2;

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
  const c = app.context, tabH = app.touchMode ? touchTarget : 27;
  const tabs = [['equipment', 'Equipment'], ['craft', 'Craft'], ['guild', 'Guild']] as const;
  const tabWidth = Math.min(80, (panel.w - 8) / 3);
  for (const [index, [tab, name]] of tabs.entries())
    button(c, tab === 'craft' ? 'equipment-workbench' : `equipment-tab-${tab}`, new Rect(panel.x + index * (tabWidth + 4), panel.y, tabWidth, tabH), name,
      () => { app.equipmentTab = tab; app.craftPage = 0; app.inventorySelected = -1; },
      app.equipmentTab === tab ? ButtonStyle.Primary : ButtonStyle.Default, true, undefined, false, { fontSize: app.touchMode ? 13 : 11 });
  const view = new Rect(panel.x, panel.y + tabH + 6, panel.w, panel.h - tabH - 6);
  const draw = (r: Rect) => app.equipmentTab === 'craft' || app.equipmentTab === 'guild'
    ? residentServices(app, p, r) : inventoryPanel(app, p, r, (tabWidth + 4) * 3);
  if (!app.touchMode) {
    draw(view);
    return;
  }
  const scroll = app.rosterScroll;
  const inspected = app.inventorySelected === storageSelection || !!p.inventory[app.inventorySelected - 1]?.item ||
    (app.inventorySelected === 0 && p.carrying > 0);
  const key = [p.id, app.equipmentTab, inspected ? app.inventorySelected : '', view.w, view.h].join('/');
  if (scroll.key !== key) { scroll.key = key; scroll.offset = 0; scroll.drag = null; }
  scroll.bounds = view;
  if (view.h <= 0) return;
  c.clip(view, () => {
    const body = new Rect(view.x, view.y - scroll.offset, view.w - 5, Math.max(view.h, 320));
    const end = draw(body);
    scroll.limit = Math.max(0, Math.ceil(end - body.y + 4 - view.h));
  });
  if (scroll.offset > scroll.limit) { scroll.offset = scroll.limit; c.requestAnimationFrame(); }
  if (scroll.limit > 0) {
    const h = Math.max(16, view.h * view.h / (view.h + scroll.limit));
    c.rect(new Rect(view.x + view.w - 2, view.y + scroll.offset / scroll.limit * (view.h - h), 2, h), app.theme.muted, 1);
  }
}

/** Returns the bottom of the actual content so a small touch viewport can scroll every row into reach. */
function inventoryPanel(app: GameHudApp, p: Person, panel: Rect, statsLeft: number): number {
  const c = app.context, t = app.theme, enabled = canControl(p), touch = app.touchMode;
  let top = panel.y;
  const aptitudes = attributeLine(combatAttributes(p)) + (p.birthVitality ? ` · Vitality +${p.birthVitality}` : '');
  const stackedStats = touch || c.textWidth(aptitudes, 11) > panel.w - statsLeft;
  if (stackedStats) {
    for (const words of gearStatRows(c, [aptitudes], panel.w, 11)) {
      c.text(new Rect(panel.x, top, panel.w, 17), words, t.text, 11);
      top += 17;
    }
  } else c.text(new Rect(panel.x + statsLeft, panel.y - 33, panel.w - statsLeft, 28), aptitudes, t.text, 11);
  const available = panel.y + panel.h - top;
  const slots = inventorySlots(p), selected = slots.find(s => s.slot === app.inventorySelected), item = selected?.item;
  const fields = item ? gearFields(item, p) : [];
  if (item?.category === 'resource' && selected) fields.push({ label: 'Quantity', value: `${selected.quantity} / ${item.maximumStack}` });
  const compact = available < 235 || panel.w < 385;
  const side = touch ? panel.w >= 595 : panel.w >= 385 || (panel.w >= 310 && available < 235);
  const headingH = touch ? 23 : compact ? 16 : 23, gap = compact ? 8 : 14, actionH = touch ? touchTarget : compact ? 24 : 31;
  const wornSlot = item?.category === 'tool' ? undefined : selected?.equipped[0];
  const slotFor = item?.slots.find(slot => p.equipment[slot] < 0) ?? item?.slots[0];
  const blocked = item && !wornSlot && slotFor ? equipBlock(p, item, slotFor) : '';
  const status = !item ? '' : p.level < item.minimumLevel ? `Needs level ${item.minimumLevel}`
    : blocked || (item.category === 'tool' ? 'Works from the backpack' : wornSlot ? `Equipped: ${wornSlot}` : 'In the backpack');
  const upgrade = item && itemUpgrade(app, p, item);
  const makeSheet = (w: number) => item && itemSheet(c, item, fields, w, compact, status);
  const stackedSheet = side ? undefined : makeSheet(panel.w);
  const roomForBag = side ? available - headingH - 4 : available - headingH - (stackedSheet ? stackedSheet.height + actionH + 11 : 90);
  const font = compact ? 11 : 13;
  const tagWidths = fields.filter(field => field.value === undefined).map(field => c.textWidth(field.label, font));
  const minDetail = Math.max(gearTable(c, fields, panel.w, font).tableW, ...tagWidths) + (compact ? 14 : 26);
  const cell = touch ? 48 : Math.max(16, Math.min(48, Math.floor((panel.w - gap * 2 - (side ? Math.max(compact ? 160 : 210, minDetail) : 0)) / 7),
    Math.floor(roomForBag / 4)));
  const bagColumns = touch ? Math.max(1, Math.min(4, Math.floor((panel.w - gap) / cell) - 3)) : 4;
  const bagW = cell * bagColumns, gearX = panel.x + bagW + gap;
  const storage = app.inventorySelected === storageSelection;
  const above = touch && !side && (storage || !!stackedSheet);
  const detailTop = top;
  if (above) top += storage ? 158 : stackedSheet!.height + actionH + 14;
  const group = (x: number, width: number, words: string) => c.text(new Rect(x, top, width, headingH), words, t.text, compact ? 10 : 12, true);
  group(panel.x, bagW, 'Backpack');
  group(gearX, cell * 3, 'Worn gear');
  const headY = top;
  top += headingH;
  slots.forEach((slot, index) => {
    const r = new Rect(panel.x + (index % bagColumns) * cell, top + Math.floor(index / bagColumns) * cell, cell - 3, cell - 3),
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
    if (slot.item) {
      if (selected) well(c, r.inset(2), t.well);
      itemIllustration(c, selected ? r.inset(2) : r, slot.item);
    }
    if (slot.quantity > 1)
      c.text(
        new Rect(r.x + 2, r.y + r.h - 16, r.w - 4, 15),
        String(slot.quantity),
        selected ? t.accentText : t.text,
        10,
        true,
        Align.End,
      );
    const worn = slot.equipped.length > 0 && slot.item?.category !== 'tool';
    if (worn) c.rect(new Rect(r.x + 3, r.y + 3, 4, 4), t.success, 2);
    if (slot.cargo && slot.item) c.text(new Rect(r.x + 2, r.y + 1, r.w - 4, 11), '↧', t.muted, 9);
    if (state.hovered && !touch)
      c.text(
        new Rect(panel.x, panel.y + panel.h - 22, panel.w, 20),
        slot.item
          ? `${slot.item.name} · ${slot.quantity}${worn ? ' · equipped' : ''}`
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
        if (item) { app.inventorySelected = p.equipment[slot]; return; }
        const chosen = app.inventorySelected > 0 ? itemSpec(p.inventory[app.inventorySelected - 1]?.item ?? '') : null;
        if (chosen && chosen.category !== 'tool' && chosen.slots.includes(slot)) {
          if (!app.town.equipItem(p.id, app.inventorySelected, slot))
            app.status = equipBlock(p, chosen, slot) || 'This item does not fit that slot or requires a higher level';
        }
      },
      item && p.equipment[slot] === app.inventorySelected ? ButtonStyle.Primary : ButtonStyle.Default,
      !!item || enabled && !!selected?.item?.slots.includes(slot) && selected.item.category !== 'tool',
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
    if (item) {
      const inspecting = p.equipment[slot] === app.inventorySelected;
      if (inspecting) well(c, r.inset(2), t.well);
      itemIllustration(c, inspecting ? r.inset(2) : r, item);
    } else itemIcon(c, r, itemSpec(placeholders[slot]), true);
    if (state.hovered && !touch)
      c.text(
        new Rect(panel.x, panel.y + panel.h - 22, panel.w, 20),
        item ? `${slot}: ${item.name}` : `${slot}: empty`,
        t.muted,
        10,
      );
  });
  const gridBottom = top + cell * Math.max(4, Math.ceil(slots.length / bagColumns));
  const detailX = side ? gearX + cell * 3 + gap : panel.x;
  const detailW = panel.x + panel.w - detailX;
  const detailY = above ? detailTop : side ? headY : gridBottom + 5;
  const detailH = touch ? Math.max(220, panel.y + panel.h - detailY) : panel.y + panel.h - detailY;
  const sheet = side ? makeSheet(detailW) : stackedSheet || undefined;
  let end = gridBottom;
  button(c, 'inventory-storage', new Rect(gearX, top + 3 * cell + 1, cell * 3 - 3, touch ? touchTarget : Math.min(cell - 2, 28)), 'Storage', () => {
    app.inventorySelected = storage ? -1 : storageSelection;
  }, ButtonStyle.Quiet, true, undefined, storage, { fontSize: compact ? 10 : 12 });
  if (storage) {
    const stock = app.town.stock(app.town.settlementOf(p)), reason = app.town.inventoryTransferReason(p.id);
    const header = compact ? 22 : 29, pitch = touch ? 48 : Math.min(compact ? 31 : 43, Math.floor((detailH - header - 12) / 2));
    const w = (detailW - 6) / 2;
    c.text(new Rect(detailX, detailY, detailW, header), 'Take from storage', t.text, compact ? 12 : 15, true);
    itemCatalog.filter(i => i.category === 'resource').slice(0, 4).forEach((resource, i) => {
      const id = `inventory-withdraw-${resource.id}`, r = new Rect(detailX + i % 2 * (w + 6), detailY + header + Math.floor(i / 2) * pitch, w, pitch - 3);
      const amount = resourceAmount(stock, resource.product);
      const state = button(c, id, r, '', () => {
        if (!app.town.withdrawInventory(p.id, resource.product, 1)) app.status = app.town.inventoryTransferReason(p.id) || `No ${resource.name.toLowerCase()} or inventory space`;
      }, ButtonStyle.Quiet, enabled && !reason && amount > 0);
      const icon = Math.min(22, r.h - 4);
      itemIcon(c, new Rect(r.x + 2, r.y + (r.h - icon) / 2, icon, icon), resource);
      c.text(new Rect(r.x + icon + 3, r.y, w - icon - 5, r.h), `${resource.name} · ${amount}`, amount ? t.text : t.muted, compact ? 10 : 12);
      tooltip(c, id, state.hovered, [reason || `Take 1 ${resource.name.toLowerCase()} from settlement storage`]);
    });
    if (reason && header + 2 * pitch + 20 <= detailH) c.text(new Rect(detailX, detailY + header + 2 * pitch, detailW, 20),
      c.elideText(reason, detailW, 11), t.danger, 11);
    end = Math.max(end, detailY + header + 2 * pitch + (reason ? 20 : 0));
  } else if (item && selected && sheet) {
    sheet.draw(detailX, detailY);
    const underSheet = touch || detailH >= sheet.height + actionH + 7;
    const x = underSheet ? detailX : panel.x, w = underSheet ? detailW : bagW + gap + cell * 3;
    const y = underSheet ? detailY + sheet.height + 6 : gridBottom + 4;
    end = Math.max(end, y + actionH);
    const equippable = !!item.slots.length && item.category !== 'tool';
    const commands = [];
    if (equippable) commands.push({ id: 'inventory-equip', title: wornSlot ? 'Unequip' : 'Equip',
      ready: enabled && p.level >= item.minimumLevel && !blocked, primary: true,
      run: () => { if (wornSlot) app.town.unequipItem(p.id, wornSlot); else app.town.equipItem(p.id, selected.slot); } });
    if (item.category === 'resource') commands.push({ id: 'inventory-deposit', title: 'Store resources', ready: enabled, primary: true,
      run: () => { if (!app.town.depositInventory(p.id, selected.slot)) app.status = app.town.inventoryTransferReason(p.id) || 'Storage cannot accept these resources'; } });
    if (upgrade) commands.push({ id: 'inventory-upgrade', title: upgrade.open ? 'View upgrade' : upgrade.hint,
      primary: !equippable, ready: !!upgrade.open && enabled, run: () => upgrade.open?.() });
    const bw = (w - Math.max(0, commands.length - 1) * 4) / Math.max(1, commands.length);
    commands.forEach((cmd, i) => {
      const state = button(c, cmd.id, new Rect(x + i * (bw + 4), y, bw, actionH), c.elideText(cmd.title, bw - 8, compact ? 10 : 12),
        cmd.run, cmd.primary ? ButtonStyle.Primary : ButtonStyle.Quiet, cmd.ready, undefined, false, { fontSize: compact ? 10 : 12 });
      tooltip(c, cmd.id, state.hovered, [cmd.id === 'inventory-upgrade' && upgrade ? upgrade.hint : blocked || cmd.title]);
    });
  } else {
    const tHeight = Math.min(detailH, compact ? 66 : 152);
    tag(c, new Rect(detailX, detailY, detailW, tHeight), { lip: 1 });
    const pad = compact ? 7 : 12, inner = detailW - pad * 2;
    const line = (dy: number, words: string, bold = false) => {
      const font = bold ? (compact ? 12 : 15) : (compact ? 10 : 12), h = compact ? 17 : 23;
      if (dy + h <= tHeight) c.text(new Rect(detailX + pad, detailY + dy, inner, h), c.elideText(words, inner, font, bold), bold ? t.ink : t.inkMuted, font, bold);
    };
    line(pad, `Attack ${attackDamage(p)} · Defence ${modifierPoints(armorProtection(p))}`, true);
    const shield = equippedItem(p, 'offhand');
    line(compact ? 24 : 41, `Main hand: ${combatItem(p)?.name ?? 'Bare hands'}` + (shield ? ` · ${shield.name}${raisedShield(p) ? '' : ' (needs a free hand)'}` : ''));
    line(compact ? 41 : 68, `Tools from the pack: ${carriedTools(p).map(tool => tool.name).join(', ') || 'none'}`);
    const weight = carriedWeight(p), used = slots.filter(s => !s.cargo && s.item).length;
    if (!compact) {
      line(95, `Backpack ${used} / 15 · ${weight.toFixed(1)} / ${carryLimit(p)} kg` + (weight > burdenFrom(p) ? ' · slowed' : ''));
      meter(c, new Rect(detailX + pad, detailY + 125, inner, 6), weight / carryLimit(p), weight > burdenFrom(p) ? t.danger : t.accent);
    }
    const links = [[Structure.Workbench, 'Make a tool'], [Structure.Weaponsmith, 'Make a weapon']] as const;
    const stations = links.filter(([kind]) => app.town.buildings().some(b => b.kind === kind && b.built() && b.faction === p.faction &&
      app.town.settlementOf(b) === app.town.settlementOf(p) && app.town.inRealm(b.center) === app.town.inRealm(p.position)));
    end = Math.max(end, detailY + tHeight + (stations.length ? actionH + 5 : 0));
    if (tHeight + actionH + 6 <= detailH) stations.forEach(([kind, label], i) => {
      const w = (detailW - (stations.length - 1) * 4) / stations.length;
      button(c, `inventory-make-${kind}`, new Rect(detailX + i * (w + 4), detailY + tHeight + 5, w, actionH), label, () => {
        app.equipmentTab = 'craft'; app.craftWorkshopFilter = kind; app.craftPage = 0;
      }, ButtonStyle.Quiet, enabled, undefined, false, { fontSize: compact ? 10 : 12 });
    });
  }
  return end;
}
