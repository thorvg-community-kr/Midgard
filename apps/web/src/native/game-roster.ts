import { Rect, Align, ButtonStyle, board, band, button, frame as pictureFrame, tone, type Color } from '../../../../packages/native-ui/src';
import {
  Role,
  Activity,
  callingName,
  raceName,
  activityName,
  type Person,
} from '../../../../packages/engine/src/person';
import { structureSpec } from '../../../../packages/engine/src/building-catalog';
import { personPortrait, moodOf } from '../../../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import { injuryOf } from '../../../../packages/engine/src/person-look';
import {
  isPlayerResident,
  canControl,
  controlReason,
  belongsToFaction,
} from '../../../../packages/engine/src/faction';
import { hudPaint } from './hud-paint';
import { actionButton } from './hud-actions';
import type { GameHudApp } from './game-hud-contract';
import { equipmentPanel } from './game-equipment-panel';
import { windowBackdrop } from './hud-window';
import { touchTarget } from './mobile-layout';

export function rosterBounds(this: GameHudApp, width: number, height: number): Rect {
  const w = Math.min(920, width - 24),
    h = Math.max(170, Math.min(640, height - (height < 500 || width < 620 ? 24 : 84)));
  return new Rect((width - w) / 2, Math.max(12, (height - h) / 2), w, h);
}
export function rosterPanel(this: GameHudApp, panel: Rect): void {
  const c = this.context,
    t = this.theme, touch = this.touchMode;
  this.rosterScroll.limit = 0;
  const close = () => { this.rosterOpen = false; this.rosterScroll.key = ''; };
  windowBackdrop(c, c.clip(), panel, 'roster-panel', 'roster-tab-' + this.rosterTab, close);
  board(c, panel);
  const short = panel.h < 400;
  const micro = panel.h < 270;
  // Keep the resident list beside the stats when a landscape screen has little height.
  const narrow = panel.w < (short ? 455 : 620);
  const resetProfile = () => {
    this.inventorySelected = -1;
    this.craftPage = 0;
    this.craftWorkshopFilter = null;
    this.equipmentTab = 'equipment';
  };
  const ochre = tone(t.accent, t.muted, 0.35),
    ink = t.text;
  // The hall's name stands on a carved band with a dog-tooth frieze.
  const headerH = touch ? 52 : short ? 32 : 46;
  const inlineTabs = touch && short && panel.w >= 460;
  band(c, panel, headerH, !short);
  c.text(
    new Rect(panel.x + 16, panel.y + 2, inlineTabs ? 160 : panel.w - 86, headerH - 7),
    'Settlement Hall',
    t.accent,
    17,
    true,
  );
  const closeSize = touch ? touchTarget : short ? 28 : 34;
  actionButton(c, 'roster-close', new Rect(panel.x + panel.w - closeSize - 7, panel.y + (headerH - closeSize) / 2, closeSize, closeSize),
    'close', 'Close', close, false, true, !touch);
  const tabY = inlineTabs ? panel.y + 4 : panel.y + headerH + 5,
    tabX = inlineTabs ? panel.x + 180 : panel.x + 14,
    tabH = touch ? touchTarget : 27,
    tabW = Math.min(132, (panel.x + panel.w - (inlineTabs ? 68 : 14) - tabX - 6) / 2);
  for (const tab of ['units', 'guests'] as const) {
    const x = tabX + (tab === 'guests' ? tabW + 6 : 0);
    button(
      c,
      `roster-tab-${tab}`,
      new Rect(x, tabY, tabW, tabH),
      tab === 'units' ? 'Units' : 'Guests',
      () => {
        this.rosterTab = tab;
        this.rosterPage = 0;
        this.rosterSelected = '';
        resetProfile();
      },
      this.rosterTab === tab ? ButtonStyle.Primary : ButtonStyle.Quiet,
    );
  }
  const entries = this.town
    .people()
    .filter((p) =>
      this.rosterTab === 'guests'
        ? p.role === Role.Guest && belongsToFaction(p) && p.health > 0 && p.activity !== Activity.Leaving
        : isPlayerResident(p),
    )
    .map((person) => ({ key: `${this.rosterTab}:${person.id}`, person }));
  const listX = panel.x + 14,
    top = tabY + tabH + (touch ? 8 : 3),
    leftW = narrow ? panel.w - 28 : short ? Math.min(142, Math.floor(panel.w * 0.20)) : Math.min(216, Math.floor(panel.w * 0.24));
  const rows = narrow
    ? Math.max(1, Math.min(4, Math.floor(leftW / 68)))
    : Math.max(1, Math.min(6, Math.floor((panel.y + panel.h - top - (touch ? 56 : 38)) / 66)));
  const pages = Math.max(1, Math.ceil(entries.length / rows));
  this.rosterPage = Math.max(0, Math.min(pages - 1, this.rosterPage));
  if (!entries.some((entry) => entry.key === this.rosterSelected))
    this.rosterSelected = entries[this.rosterPage * rows]?.key ?? '';
  const portrait = (p: Person, frame: Rect) => {
    const mood = moodOf(p),
      backdrop = portraitBackdrop(this.town.map(), p.position, this.town.climate());
    const key = JSON.stringify([
      'roster',
      p.look,
      p.race,
      String(p.lookRevision),
      p.calling,
      frame,
      mood,
      injuryOf(p),
      backdrop,
    ]);
    pictureFrame(c, frame);
    c.paint(key, () => {
      const paint = hudPaint(c, personPortrait(p, mood, frame.w, frame.h, backdrop));
      paint.translate(frame.x, frame.y);
      return paint;
    });
  };
  const visible = entries.slice(this.rosterPage * rows, (this.rosterPage + 1) * rows);
  for (let i = 0; i < visible.length; ++i) {
    const entry = visible[i],
      width = narrow ? (leftW - (rows - 1) * 6) / rows : leftW,
      row = new Rect(listX + (narrow ? i * (width + 6) : 0), top + (narrow ? 0 : i * 66), width, 60);
    const active = entry.key === this.rosterSelected;
    button(
      c,
      `roster-person-${entry.key}`,
      row,
      '',
      () => {
        if (this.rosterSelected !== entry.key) resetProfile();
        this.rosterSelected = entry.key;
      },
      active ? ButtonStyle.Primary : ButtonStyle.Default,
    );
    const thumb = narrow
      ? new Rect(row.x + (row.w - 30) / 2, row.y + 3, 30, 36)
      : new Rect(row.x + 5, row.y + 7, 36, 46);
    // List portraits use separate retained instances from the large profile.
    c.paint(
      JSON.stringify([
        'roster-thumb',
        entry.person.look,
        entry.person.race,
        String(entry.person.lookRevision),
        entry.person.calling,
        thumb,
      ]),
      () => {
        const paint = hudPaint(
          c,
          personPortrait(
            entry.person,
            moodOf(entry.person),
            thumb.w,
            thumb.h,
            portraitBackdrop(this.town.map(), entry.person.position, this.town.climate()),
          ),
        );
        paint.translate(thumb.x, thumb.y);
        return paint;
      },
    );
    if (narrow) {
      c.text(
        new Rect(row.x + 3, row.y + 41, row.w - 6, 16),
        c.elideText(entry.person.name, row.w - 6, 10, true),
        active ? t.accentText : ink,
        10,
        true,
        Align.Center,
      );
      continue;
    }
    const textX = row.x + 46,
      w = Math.max(10, row.w - 51);
    c.text(
      new Rect(textX, row.y + 8, w, 24),
      c.elideText(entry.person.name, w, 12, true),
      active ? t.accentText : ink,
      12,
      true,
    );
    c.text(
      new Rect(textX, row.y + 32, w, 20),
      c.elideText(callingName(entry.person.calling), w, 11),
      active ? t.accentText : ochre,
      11,
    );
  }
  const pagerH = touch ? touchTarget : 22, pagerW = touch ? touchTarget : 28;
  const pagerY = narrow ? top + 64 : panel.y + panel.h - pagerH - 12;
  if (pages > 1) {
    button(
      c,
      'roster-prev',
      new Rect(listX, pagerY, pagerW, pagerH),
      '<',
      () => {
        --this.rosterPage;
        this.rosterSelected = '';
        resetProfile();
      },
      ButtonStyle.Quiet,
      this.rosterPage > 0,
    );
    c.text(
      new Rect(listX + pagerW, pagerY, leftW - 2 * pagerW, pagerH),
      `${this.rosterPage + 1} / ${pages}`,
      ochre,
      11,
      false,
      Align.Center,
    );
    button(
      c,
      'roster-next',
      new Rect(listX + leftW - pagerW, pagerY, pagerW, pagerH),
      '>',
      () => {
        ++this.rosterPage;
        this.rosterSelected = '';
        resetProfile();
      },
      ButtonStyle.Quiet,
      this.rosterPage < pages - 1,
    );
  }
  const belowList = pages > 1 ? pagerY + pagerH + 8 : top + 66;
  const detail = narrow
    ? new Rect(listX, belowList, panel.w - 28, panel.y + panel.h - belowList - 12)
    : new Rect(listX + leftW + 14, top, panel.w - leftW - 42, panel.y + panel.h - top - 12);
  if (!narrow)
    c.rect(new Rect(detail.x - 8, top, 1.5, panel.y + panel.h - 15 - top), tone(t.surface, t.dusk, 0.4));
  const selected = entries.find((entry) => entry.key === this.rosterSelected);
  if (!selected) {
    c.text(
      detail,
      this.rosterTab === 'guests'
        ? 'No guests are visiting the settlement.'
        : 'No player residents are available.',
      ochre,
      12,
    );
    return;
  }
  if (selected.person.role === Role.Resident) {
    const p = selected.person,
      compactProfile = narrow && panel.h < 600,
      header = short ? 18 : compactProfile ? 40 : 66;
    const text = (r: Rect, value: string, color: Color = ink, size = 12, bold = false) =>
      c.text(r, c.elideText(value, r.w, size, bold), color, size, bold);
    if (short || compactProfile) {
      text(
        new Rect(detail.x, detail.y, detail.w, 18),
        `${p.name} · Lv ${p.level} · Health ${Math.round(p.health * 100)}%`,
        ink,
        12,
        true,
      );
      if (!short) text(new Rect(detail.x, detail.y + 18, detail.w, 17), `${raceName(p.race)} · ${callingName(p.calling)}`, ochre, 11);
    } else {
      portrait(p, new Rect(detail.x, detail.y, 40, 46));
      text(
        new Rect(detail.x + 50, detail.y, detail.w - 50, 23),
        `${p.name} · Level ${p.level}`,
        ink,
        16,
        true,
      );
      text(
        new Rect(detail.x + 50, detail.y + 24, detail.w - 50, 20),
        `${raceName(p.race)} · ${callingName(p.calling)}`,
        ochre,
        11,
      );
      text(
        new Rect(detail.x, detail.y + 47, detail.w, 18),
        controlReason(p) ||
          `${activityName(p.activity)} · Food ${Math.round(p.food * 100)}% · Water ${Math.round(p.hydration * 100)}% · Fatigue ${Math.round(p.stress * 100)}%`,
        canControl(p) ? t.muted : t.danger,
        10,
      );
    }
    if (this.equipmentTab === 'profile') this.equipmentTab = 'equipment';
    equipmentPanel(this, p, new Rect(detail.x, detail.y + header, detail.w, detail.h - header));
    return;
  }
  const p = selected.person,
    compact = detail.w < 300 || short;
  const split = short && detail.w > 400;
  const meta = split ? new Rect(detail.x + 200, detail.y + 43, detail.w - 200, detail.h) : detail;
  const text = (y: number, label: string, color: Color = ink, size = 12, bold = false) =>
    c.text(
      new Rect(meta.x, y, meta.w, short ? 16 : 22),
      c.elideText(label, meta.w, size, bold),
      color,
      size,
      bold,
    );
  c.text(
    new Rect(detail.x, detail.y, detail.w, 23),
    c.elideText(p.name, detail.w, compact ? 14 : 19, true),
    ink,
    compact ? 14 : 19,
    true,
  );
  c.text(
    new Rect(detail.x, detail.y + (short ? 21 : 24), detail.w, 21),
    `${raceName(p.race)} · ${callingName(p.calling)} · Level ${p.level}`,
    ochre,
    compact ? 10 : 12,
  );
  const frame = new Rect(
    detail.x,
    detail.y + (short ? 43 : 53),
    micro ? 32 : short ? 40 : compact ? 64 : 100,
    micro ? 36 : short ? 46 : compact ? 80 : 116,
  );
  portrait(p, frame);
  const sx = frame.x + frame.w + 12,
    sw = split ? 140 : detail.w - frame.w - 12;
  const stat = (row: number, value: string) =>
    c.text(
      new Rect(sx, frame.y + row * (micro ? 13 : short ? 15 : 23), sw, short ? 13 : 22),
      c.elideText(value, sw, compact ? 11 : 13),
      ink,
      compact ? 11 : 13,
    );
  stat(0, `Power ${this.town.power(p).toFixed(1)}`);
  stat(1, `Vitality ${p.vitalityMultiplier().toFixed(1)}x`);
  stat(2, `Health ${Math.round(p.health * 100)}%`);
  if (!compact) {
    stat(3, `Gear ${p.gear}`);
    c.text(new Rect(sx, detail.y + 150, sw, 24), c.elideText(p.past, sw, 11), ochre, 11);
  }
  const y = split ? detail.y + 43 : detail.y + (micro ? 84 : short ? 92 : compact ? 144 : 182);
  const footerH = touch ? touchTarget : 29;
  const footer = new Rect(meta.x, panel.y + panel.h - footerH - 14, meta.w, footerH);
  if (p.role === Role.Guest) {
    const lodging = this.town.building(p.bed);
    text(y, lodging ? `Lodging: ${structureSpec(lodging.kind).name}` : 'Looking for lodging', ochre, 12);
    text(y + (short ? 17 : 23), `${activityName(p.activity)} · Purse ${p.purse} gold`, ink, 11);
    text(y + (short ? 34 : 46), 'Visitors pay for lodging and services.', t.muted, 10);
    button(
      c,
      'roster-focus',
      footer,
      'Inspect guest',
      () => {
        this.rosterSelected = selected.key;
      },
      ButtonStyle.Primary,
    );
  }
}
