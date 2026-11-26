import { Rect, Align, button, ButtonStyle, frame, meter, tag } from '../../../../packages/native-ui/src';
import {
  Role,
  callingName,
  raceName,
  activityName,
  type Person,
} from '../../../../packages/engine/src/person';
import { canControl, controlReason } from '../../../../packages/engine/src/faction';
import { structureSpec, describe } from '../../../../packages/engine/src/building-catalog';
import { resourceBundle } from '../../../../packages/engine/src/construction-materials';
import { personPortrait, moodOf } from '../../../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import { injuryOf } from '../../../../packages/engine/src/person-look';
import { hudPaint } from './hud-paint';
import { actionButton } from './hud-actions';
import type { GameHudApp } from './game-hud-contract';
import { Order } from '../../../../packages/engine/src/game-tools';
import { skillCard, skillCardHeight } from './skill-card';
import { orderLegend, railBeside, railGutter, titleTile, titleTileControl, titleTileWidth } from './unit-orders-card';
import { groupsOf } from './control-groups';
import { openWorkbench, workPace, workbenchTip } from './game-equipment-panel';
import { tooltip, woundStatus } from './game-combat-hud';

/** With a mouse an aimed order folds the panel to its title row: the view is free and the lit order still shows. */
export const aimFolded = (app: GameHudApp): boolean =>
  !app.touchMode && app.pending !== Order.None && app.residentSelection();
export function residentSelection(this: GameHudApp): boolean {
  return this.chosen.some((id) => canControl(this.town.person(id)));
}
export function personPanelBounds(this: GameHudApp, width: number, height: number, commands: boolean): Rect {
  // In a low touch view the order rail stands beside the panel, which leaves it room on either side.
  const w = Math.min(720, width - 24 - (commands && railBeside(this.touchMode, height) ? railGutter * 2 : 0)),
    columns = Math.max(1, Math.floor((w - 24) / 56));
  const content =
    this.chosen.length === 1
      ? w < 520
        ? 116
        : 132
      : groupTop(this) + 1 + Math.min(3, Math.ceil(Math.min(20, this.chosen.length) / columns)) * 56;
  const h = aimFolded(this)
    ? titleTile + 12
    : Math.min(Math.max(90, height - 96), content + skillCardHeight(this) + 12);
  return new Rect((width - w) / 2, height - 12 - h, w, h);
}
/** Where the portraits of a group begin: under the title row, which is as tall as its controls. */
const groupTop = (app: GameHudApp) => (app.touchMode ? 55 : 33);
/**
 * The right side of the title row, one line right-aligned to the panel's margin: the orders (with a mouse), a
 * divider, then the openers of the unit window and, for one resident, the workbench. Returns its left edge.
 */
function titleCluster(app: GameHudApp, panel: Rect, first: Person | null, commands: boolean, manage: () => void): number {
  const c = app.context,
    right = panel.x + panel.w - 12,
    craft = app.chosen.length === 1 && !!first && canControl(first),
    // An opener puts an aimed order down first.
    opening = (run: () => void) => () => {
      app.pending = Order.None;
      run();
    };
  if (app.touchMode) {
    actionButton(c, 'unit-management', new Rect(right - 44, panel.y + 6, 44, 44), 'unit', 'Unit equipment and inventory', manage);
    if (craft)
      actionButton(c, 'unit-workbench', new Rect(right - 94, panel.y + 6, 44, 44), 'craft', workbenchTip(), () => openWorkbench(app, first));
    return right - (craft ? 94 : 44);
  }
  const y = panel.y + 6,
    worded = panel.w >= 640,
    opener = (id: string, x: number, glyph: 'unit' | 'craft', word: string, tip: string, run: () => void) => {
      const w = titleTileWidth(c, worded ? word : ''),
        s = titleTileControl(c, id, new Rect(x - w, y, w, titleTile), { glyph }, worded ? word : '', opening(run));
      tooltip(c, id, s.hovered, [tip]);
      return x - w;
    };
  let x = opener('unit-management', right, 'unit', 'Gear', 'Unit equipment and inventory', manage);
  if (craft) x = opener('unit-workbench', x - 4, 'craft', 'Craft', workbenchTip(), () => openWorkbench(app, first));
  if (!commands) return x;
  c.rect(new Rect(x - 7, y + 5, 1, titleTile - 12), app.theme.border);
  return orderLegend(app, x - 13, y, panel.w >= 520);
}
export function personPanel(this: GameHudApp, panel: Rect): void {
  const c = this.context,
    t = this.theme,
    commands = this.residentSelection();
  const portrait = (p: Person, r: Rect) => {
    const mood = moodOf(p),
      backdrop = portraitBackdrop(this.town.map(), p.position, this.town.climate());
    const key = JSON.stringify([
      'selection-profile',
      p.look,
      p.race,
      String(p.lookRevision),
      p.calling,
      r.w,
      r.h,
      mood,
      injuryOf(p),
      backdrop,
    ]);
    let entry = this.dockPortraits.get(p.id);
    if (!entry || entry.key !== key) {
      if (entry) {
        const old = entry.paint;
        c.deferRelease(() => old.dispose());
      }
      entry = { key, paint: hudPaint(c, personPortrait(p, mood, r.w - 2, r.h - 2, backdrop)) };
      this.dockPortraits.set(p.id, entry);
    }
    frame(c, r);
    c.place(entry.paint, r.x + 1, r.y + 1);
  };
  const first = this.town.person(this.chosen[0]);
  const manage = () => {
    this.rosterOpen = true;
    this.rosterTab = first?.role === Role.Guest ? 'guests' : 'units';
    this.rosterSelected = first ? this.rosterTab + ':' + first.id : '';
    this.equipmentTab = 'equipment';
    this.inventorySelected = -1;
  };
  const cluster = titleCluster(this, panel, first, commands, manage),
    folded = aimFolded(this);
  if (folded) {
    const room = cluster - panel.x - 24,
      title = this.chosen.length === 1 && first ? first.name + ' · Lv ' + first.level : this.chosen.length + ' units selected';
    c.text(new Rect(panel.x + 12, panel.y + 6, room, titleTile), c.elideText(title, room, 15, true), t.text, 15, true);
    return;
  }
  if (this.chosen.length === 1 && first) {
    const p = first,
      narrow = panel.w < 520,
      size = narrow ? 48 : 72,
      left = panel.x + size + 24;
    portrait(p, new Rect(panel.x + 12, panel.y + 10, size, size));
    portraitMarks(this, p, new Rect(panel.x + 12, panel.y + 10, size, size));
    const room = cluster - left - 10,
      // On touch the openers are tall enough to stand beside the second line too.
      second = this.touchMode ? room : panel.w - size - 40;
    c.text(new Rect(left, panel.y + 7, room, 24), c.elideText(p.name + ' · Lv ' + p.level, room, 15, true), t.text, 15, true);
    c.text(
      new Rect(left, panel.y + 32, second, 18),
      c.elideText(
        raceName(p.race) +
          ' · ' +
          callingName(p.calling) +
          (p.role === Role.Guest ? ' · guest' : p.faction > 0 ? ' · neutral' : ''),
        second,
        11,
      ),
      t.accent,
      11,
    );
    const action =
      p.downedAt >= 0 && p.health > -0.5
        ? `Bleeding out · ${Math.ceil(this.town.bleedOutLeft(p))} s`
        : controlReason(p) ||
          (p.holding
            ? 'Holding position'
            : (p.moving() ? 'On the way: ' : '') + activityName(p.activity) + workPace(p));
    if (p.downedAt >= 0) c.requestFrameAt(c.time() + 0.5);
    c.text(
      new Rect(left, panel.y + 51, panel.w - size - 40, 18),
      c.elideText(action, panel.w - size - 40, 11),
      canControl(p) ? t.muted : t.danger,
      11,
    );
    const home = this.town.building(p.role === Role.Guest ? p.bed : p.home);
    const detail =
      p.woundDays > 0
        ? woundStatus(p.woundDays)
        : p.carrying
          ? 'Carrying ' + describe(resourceBundle(p.carriedProduct, p.carrying))
          : home
            ? 'Home: ' + structureSpec(home.kind).name
            : 'No home assigned';
    const y = panel.y + (narrow ? 72 : 91),
      gap = 8,
      w = (panel.w - 24 - gap * 3) / 4;
    for (const [index, [label, value, positive]] of (
      [
        ['Health', p.health, true],
        ['Food', p.food, true],
        ['Water', p.hydration, true],
        ['Fatigue', p.stress, false],
      ] as const
    ).entries()) {
      const x = panel.x + 12 + index * (w + gap),
        color = (positive ? value : 1 - value) < 0.3 ? t.danger : t.success;
      c.text(new Rect(x, y, w, 16), label + ' ' + Math.round(value * 100) + '%', t.muted, 9);
      meter(c, new Rect(x, y + 17, w, 6), value, color);
    }
    if (!narrow)
      c.text(
        new Rect(left, panel.y + 70, panel.w - size - 40, 18),
        c.elideText(detail, panel.w - size - 40, 11),
        t.muted,
        11,
      );
  } else {
    const room = cluster - panel.x - 22,
      top = groupTop(this);
    c.text(
      new Rect(panel.x + 12, panel.y + 6, room, top - 5),
      c.elideText(this.chosen.length + ' units selected', room, 14, true),
      t.text,
      14,
      true,
    );
    const columns = Math.max(1, Math.floor((panel.w - 24) / 56)),
      rows = Math.min(3, Math.ceil(Math.min(20, this.chosen.length) / columns));
    for (const [i, id] of this.chosen.slice(0, Math.min(20, columns * rows)).entries()) {
      const p = this.town.person(id);
      if (!p) continue;
      const r = new Rect(
        panel.x + 12 + (i % columns) * 56,
        panel.y + top + Math.floor(i / columns) * 56,
        48,
        48,
      );
      portrait(p, r);
      button(
        c,
        'pick-person-' + id,
        r,
        '',
        () => this.selectPeople([id]),
        ButtonStyle.Quiet,
        true,
        undefined,
        false,
        { fill: { r: 0, g: 0, b: 0, a: 0 } },
      );
      meter(c, new Rect(r.x + 2, r.y + r.h - 6, r.w - 4, 4), p.health, p.health < 0.3 ? t.danger : t.success);
      if (p.downedAt >= 0) c.rect(r, { r: 0, g: 0, b: 0, a: 0 }, t.radius, t.danger, 2);
      portraitMarks(this, p, r);
    }
  }
  const abilities = skillCardHeight(this);
  if (abilities)
    skillCard(
      this,
      new Rect(
        panel.x + 12,
        panel.y + panel.h - 12 - abilities,
        panel.w - 24,
        abilities - 6,
      ),
    );
  for (const [id, entry] of this.dockPortraits)
    if (!this.chosen.includes(id)) {
      c.deferRelease(() => entry.paint.dispose());
      this.dockPortraits.delete(id);
    }
}
/** A planted shield while holding position, and the control groups a resident belongs to. */
function portraitMarks(app: GameHudApp, p: Person, r: Rect): void {
  const c = app.context,
    t = app.theme;
  if (p.holding) {
    const x = r.x + 9,
      y = r.y + 9;
    c.rect(new Rect(r.x + 2, r.y + 2, 14, 15), { ...t.surface, a: 235 }, 3);
    c.line(x - 4, y - 4, x + 4, y - 4, t.accent, 1.4);
    c.line(x - 4, y - 4, x - 4, y + 1, t.accent, 1.4);
    c.line(x + 4, y - 4, x + 4, y + 1, t.accent, 1.4);
    c.line(x - 4, y + 1, x, y + 5, t.accent, 1.4);
    c.line(x + 4, y + 1, x, y + 5, t.accent, 1.4);
  }
  const groups = groupsOf(app, p.id);
  if (groups.length) {
    const label = groups.join(''),
      w = c.textWidth(label, 9, true) + 8,
      box = new Rect(r.x + r.w - w - 2, r.y + 2, w, 13);
    tag(c, box, { cut: 2, lip: 1 });
    c.text(box, label, t.ink, 9, true, Align.Center);
  }
}
