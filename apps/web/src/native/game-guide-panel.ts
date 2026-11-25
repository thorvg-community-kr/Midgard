// The guide on screen: one card at a time, set beside the thing it introduces as the village stores window is set
// beside a camp, or else at the edge of the play area, and the log of everything that has happened so far.
import { localeRevision, translate } from '../../../../packages/localization/src/index';
import { Align, ButtonStyle, EventType, Rect, board, button, frame, groove, tag } from '../../../../packages/native-ui/src';
import { clamp, f32 } from '../../../../packages/engine/src/numeric';
import { project } from '../../../../packages/engine/src/geometry';
import { drawsArea, toolStructure, type Tool } from '../../../../packages/engine/src/game-tools';
import { describe, structureSpec } from '../../../../packages/engine/src/building-catalog';
import { constructionIcon } from '../../../../packages/native-renderer/src/construction-icon';
import { buildingAppearanceRevision } from '../../../../packages/native-renderer/src/building-assets';
import type { GameHudApp } from './game-hud-contract';
import { wrapText } from './game-progress-hud';
import { tooltip } from './game-combat-hud';
import { hudPaint } from './hud-paint';
import { toolInfo, toolName } from './build-menu-tools';
import {
  dismissGuideCard,
  guideAbout,
  guideFightInView,
  guideRules,
  guideShow,
  guideSpot,
  guideTimeline,
  guideUnread,
  toggleGuideLog,
  unlockOf,
  type GuideCard,
  type GuideEntry,
} from './game-guide';
import { fill, guideMoment, line, type Line } from './guide-moments';
import { guidePreferences, setGuidePreference } from './guide-preferences';
import { noticeMark, noticeTone, type NoticeRecord } from './notice-toast';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Panels drawn last frame, so the card can keep clear of them this frame. */
const blocked = new WeakMap<GameHudApp, Box[]>();

const sentence = (value: Line) => translate(fill(value));
const paragraph = (lines: readonly Line[]) => lines.map(sentence).join(' ');
function titleOf(entry: GuideEntry): Line {
  return guideMoment(entry.key)?.title ?? entry.key;
}
// Texts follow from the rules alone, so their wrapping is kept until the language or the width changes.
const wrapped = new Map<string, string[]>();
function bodyRows(app: GameHudApp, entry: GuideEntry, width: number, lines: number): string[] {
  const key = `${entry.key}|${localeRevision()}|${width}|${lines}`;
  let rows = wrapped.get(key);
  if (!rows) {
    if (wrapped.size > 400) wrapped.clear();
    rows = wrapText(app.context, paragraph(guideMoment(entry.key)?.text(app.town) ?? []), width, 12, lines);
    wrapped.set(key, rows);
  }
  return rows;
}
/** The first spot down the right edge, then the left, clear of every panel; null when none fits. */
function place(boxes: readonly Box[], w: number, h: number, width: number, height: number): Rect | null {
  const columns = w >= width - 25 ? [12] : [f32(width - 12 - w), 12];
  for (const x of columns) {
    let y = 56;
    for (let guard = 0; guard < 40 && y + h <= height - 8; ++guard) {
      const spot = { x, y, w, h },
        hits = boxes.filter((b) => overlaps(b, spot));
      if (!hits.length) return new Rect(x, y, w, h);
      y = f32(Math.max(...hits.map((b) => b.y + b.h)) + 8);
    }
  }
  return null;
}
/** Where on screen the thing a card introduces is drawn now, cut to the view; null for a card about no thing, or when none of it shows. */
function subject(app: GameHudApp, entry: GuideEntry, width: number, height: number): Box | null {
  const ref = guideAbout(app.town, entry)[0];
  if (!ref) return null;
  const drawn = app.renderer.selectionGeometry(ref)?.bounds,
    gate = ref.kind === 'dungeon' ? app.town.map().dungeons()[ref.id] : null,
    // No outline to go by (the view is moving, or the thing cannot be picked out yet): its place serves.
    spot = drawn ? null : gate ? { x: gate.origin.x + 1, y: gate.origin.y + 1 } : guideSpot(app.town, entry);
  let box: Box | null = null;
  if (drawn) box = { x: drawn.x, y: drawn.y, w: drawn.w, h: drawn.h };
  else if (spot && (ref.kind !== 'monster' || app.renderer.visible(spot))) {
    const at = app.camera.toScreen(project(spot.x, spot.y), width, height),
      zoom = app.camera.zoom;
    box =
      ref.kind === 'person' || ref.kind === 'monster'
        ? { x: at.x - 9 * zoom, y: at.y - 24 * zoom, w: 18 * zoom, h: 26 * zoom }
        : gate
          ? // A gate about its foot, as wide as the ring it stands in.
            { x: at.x - 56 * zoom, y: at.y - 64 * zoom, w: 112 * zoom, h: 84 * zoom }
          : // A building, about as it rises from its ground.
            { x: at.x - 46 * zoom, y: at.y - 78 * zoom, w: 92 * zoom, h: 88 * zoom };
  }
  if (!box) return null;
  const left = Math.max(box.x, 0),
    top = Math.max(box.y, 0),
    right = Math.min(box.x + box.w, width),
    bottom = Math.min(box.y + box.h, height);
  if (right - left < 4 || bottom - top < 4) return null;
  // A mountain fills the screen: the card stands by its middle, not outside all of it.
  const w = Math.min(right - left, 220),
    h = Math.min(bottom - top, 180);
  return { x: f32((left + right - w) / 2), y: f32((top + bottom - h) / 2), w, h };
}
/** A card set beside its thing keeps that place while it still serves, so the writing holds still. */
const stood = new WeakMap<GuideCard, Rect>();
/**
 * A place beside the thing, as the village stores window takes beside a camp: to its right, its top a little
 * above the thing's, else to its left; lifted clear of the panels below it. Null when neither side is free.
 */
function beside(shown: GuideCard, boxes: readonly Box[], target: Box, w: number, h: number, width: number, height: number): Rect | null {
  const middle = target.x + target.w / 2,
    sides = [Math.max(middle + 30, target.x + target.w + 12), Math.min(middle - 30, target.x - 12) - w],
    settle = (x: number): Box | null => {
      if (x < 8 || x + w > width - 8) return null;
      const spot = { x: f32(x), y: f32(clamp(target.y - 28, 56, height - h - 8)), w, h };
      for (let guard = 0; guard < 4; ++guard) {
        const hits = boxes.filter((b) => overlaps(b, spot));
        if (!hits.length) return spot;
        spot.y = f32(Math.min(...hits.map((b) => b.y)) - 8 - h);
        if (spot.y < 56) return null;
      }
      return null;
    },
    kept = stood.get(shown),
    // The side it already stands on comes first, so it does not hop across the thing.
    order = kept && kept.x < middle ? [sides[1], sides[0]] : sides;
  let spot: Box | null = null;
  for (const x of order) if ((spot = settle(x))) break;
  if (!spot) return null;
  if (kept && kept.w === w && kept.h === h && Math.abs(kept.x - spot.x) < 40 && Math.abs(kept.y - spot.y) < 40 && !boxes.some((b) => overlaps(b, kept)))
    return kept;
  const r = new Rect(spot.x, spot.y, w, h);
  stood.set(shown, r);
  return r;
}
function logButton(app: GameHudApp): void {
  const c = app.context,
    t = app.theme,
    s = app.guide,
    size = app.touchMode ? 44 : 36,
    r = new Rect(12, 12, size, size);
  const state = button(c, 'guide-log-button', r, '', () => toggleGuideLog(app), ButtonStyle.Default, true, undefined, s.logOpen);
  const ink = state.hovered || s.logOpen ? t.text : t.accent,
    cx = f32(r.x + r.w / 2),
    cy = f32(r.y + r.h / 2 + (state.lift ?? 0));
  // An open book: two solid pages either side of the spine.
  c.paint(JSON.stringify(['guide-book', cx, cy, ink]), () => {
    const book = new c.tvg.Shape();
    for (const side of [-1, 1])
      book
        .moveTo(f32(cx + side), f32(cy - 6))
        .cubicTo(f32(cx + side * 4), f32(cy - 8.5), f32(cx + side * 8), f32(cy - 8.5), f32(cx + side * 11), f32(cy - 6.5))
        .lineTo(f32(cx + side * 11), f32(cy + 7))
        .cubicTo(f32(cx + side * 8), f32(cy + 5), f32(cx + side * 4), f32(cy + 5), f32(cx + side), f32(cy + 7.5))
        .close();
    return book.fill(ink.r, ink.g, ink.b, ink.a);
  });
  const unread = guideUnread(s);
  if (unread > 0 && !s.logOpen) {
    const badge = new Rect(f32(r.x + r.w - 12), f32(r.y - 4), 16, 16);
    c.rect(badge, t.danger, 8);
    c.text(badge, unread > 9 ? '9+' : String(unread), t.accentText, 9, true, Align.Center);
  }
  if (!app.touchMode) tooltip(c, 'guide-log-button', state.hovered, ['Log (F1)', 'Everything that has happened, to read again.']);
}
/**
 * A building that has just come into the build menu: its picture, what it is for, what it costs, and a button
 * that goes straight to placing it.
 */
function unlockCard(app: GameHudApp, shown: GuideCard, tool: Tool, boxes: readonly Box[], width: number, height: number): void {
  const c = app.context,
    t = app.theme,
    s = app.guide,
    now = c.time(),
    touch = app.touchMode,
    kind = toolStructure(tool),
    w = Math.min(width < 600 ? f32(width - 24) : 340, f32(width - 24)),
    art = 68,
    textW = f32(w - 28 - art - 12),
    rows = wrapText(c, kind !== undefined && !drawsArea(tool) ? structureSpec(kind).description : toolInfo[tool].hint, textW, 11, 4),
    cost = kind !== undefined ? describe(structureSpec(kind).cost) : '',
    bh = touch ? 44 : 28,
    body = Math.max(art, 42 + rows.length * 15 + (cost ? 18 : 0)),
    h = f32(14 + body + 12 + bh + 14),
    r = place(boxes, w, h, width, height);
  if (!r) return;
  s.drawnAt = now;
  const state = c.control('guide-card', r, undefined, true, false);
  if (state.hovered) shown.until = Math.max(shown.until, now + 1.5);
  tag(c, r, { cut: 5, lip: 3 });
  const picture = new Rect(f32(r.x + 16), f32(r.y + 16), f32(art - 4), f32(art - 6)),
    left = f32(r.x + 14 + art + 12);
  frame(c, picture);
  c.paint(
    `unlock-art-${kind === undefined ? 0n : buildingAppearanceRevision(kind)}${JSON.stringify([tool, picture.x, picture.y])}`,
    () => {
      const holder = new c.tvg.Scene(),
        icon = hudPaint(c, constructionIcon(tool, picture.w - 8, picture.h - 8));
      holder.add(icon);
      icon.dispose();
      holder.translate(picture.x + 4, picture.y + 4);
      return holder;
    },
  );
  let y = f32(r.y + 12);
  c.text(new Rect(left, y, textW, 16), 'New in the build menu', t.inkAccent, 10, true);
  y = f32(y + 16);
  c.text(new Rect(left, y, textW, 24), c.elideText(toolName(tool), textW, 15, true), t.ink, 15, true);
  y = f32(y + 26);
  for (const row of rows) {
    c.text(new Rect(left, y, textW, 15), row, t.ink, 11);
    y = f32(y + 15);
  }
  if (cost) c.text(new Rect(left, f32(y + 2), textW, 16), c.elideText(cost, textW, 11, true), t.inkAccent, 11, true);
  const buttons = f32(r.y + r.h - 14 - bh),
    wide = touch ? 104 : 88;
  button(
    c,
    'guide-card/build',
    new Rect(f32(r.x + r.w - 14 - wide), buttons, wide, bh),
    'Build',
    () => {
      dismissGuideCard(app);
      app.selectTool(tool);
    },
    ButtonStyle.Primary,
    true,
    undefined,
    false,
    { fontSize: 12 },
  );
  button(c, 'guide-card/later', new Rect(f32(r.x + r.w - 22 - wide * 2), buttons, wide, bh), 'Later', () => dismissGuideCard(app), ButtonStyle.Default, true, undefined, false, { fontSize: 12 });
  if (s.queue.length)
    c.text(new Rect(f32(r.x + 14), buttons, 110, bh), fill(line('{0} more waiting', s.queue.length)), t.inkMuted, 10);
  const left01 = clamp((shown.until - now) / guideRules.cardSeconds, 0, 1);
  c.rect(new Rect(f32(r.x + 6), f32(r.y + r.h - 5), f32((r.w - 12) * left01), 2), { ...t.inkAccent, a: 170 }, 0);
  c.requestFrameAt(Math.min(shown.until, now + 0.5));
}
function card(app: GameHudApp, width: number, height: number): void {
  const s = app.guide,
    shown = s.card,
    boxes = blocked.get(app);
  if (!shown || s.logOpen || !boxes) return;
  const unlocked = unlockOf(shown.entry);
  if (unlocked !== null) {
    unlockCard(app, shown, unlocked, boxes, width, height);
    return;
  }
  const c = app.context,
    t = app.theme,
    entry = shown.entry,
    now = c.time(),
    touch = app.touchMode,
    w = Math.min(width < 600 ? f32(width - 24) : 340, f32(width - 24)),
    inner = f32(w - 28),
    rows = bodyRows(app, entry, inner, 9),
    detail = entry.detail.slice(0, 2),
    bh = touch ? 44 : 28,
    h = f32(14 + 16 + 24 + rows.length * 17 + detail.length * 16 + 10 + bh + 14);
  // A fight is not covered: the card goes to the edge, and stays there.
  if (!shown.edged && guideFightInView(app)) shown.edged = true;
  // The camera is on its way to the thing: the card waits to be set beside it.
  if (s.glide && !shown.edged && entry.about.length) return;
  const target = shown.edged ? null : subject(app, entry, width, height),
    side = target ? beside(shown, boxes, target, w, h, width, height) : null;
  // One that stood by its thing and lost its place does not go looking for another.
  if (!side && stood.has(shown)) shown.edged = true;
  const r = side ?? place(boxes, w, h, width, height);
  if (!r) return;
  s.drawnAt = now;
  if (side) c.requestAnimationFrame();
  const state = c.control(
    'guide-card',
    r,
    (event) => {
      if (event.type === EventType.Activate) dismissGuideCard(app);
    },
    true,
    false,
  );
  if (state.hovered) shown.until = Math.max(shown.until, now + 1.5);
  // An explanation is a note on paper, apart from the boards that take orders.
  tag(c, r, { cut: 5, lip: 3 });
  const left = f32(r.x + 14);
  let y = f32(r.y + 12);
  c.text(new Rect(left, y, f32(inner - 80), 16), 'Guide', t.inkAccent, 10, true);
  if (entry.day !== null)
    c.text(new Rect(f32(left + inner - 80), y, 80, 16), fill(line('Day {0}', entry.day)), t.inkMuted, 10, false, Align.End);
  y = f32(y + 16);
  c.text(new Rect(left, y, inner, 24), c.elideText(fill(titleOf(entry)), inner, 15, true), t.ink, 15, true);
  y = f32(y + 26);
  for (const row of rows) {
    c.text(new Rect(left, y, inner, 17), row, t.ink, 12);
    y = f32(y + 17);
  }
  for (const text of detail) {
    c.text(new Rect(left, y, inner, 16), c.elideText(text, inner, 11), t.inkMuted, 11);
    y = f32(y + 16);
  }
  const buttons = f32(r.y + r.h - 14 - bh),
    got = touch ? 104 : 88;
  button(c, 'guide-card/ok', new Rect(f32(r.x + r.w - 14 - got), buttons, got, bh), 'Got it', () => dismissGuideCard(app), ButtonStyle.Primary, true, undefined, false, { fontSize: 12 });
  if (entry.at && !shown.looked && !side)
    button(c, 'guide-card/look', new Rect(f32(r.x + r.w - 22 - got * 2), buttons, got, bh), 'Look', () => {
      shown.looked = true;
      guideShow(app, entry);
    }, ButtonStyle.Default, true, undefined, false, { fontSize: 12 });
  if (s.queue.length)
    c.text(new Rect(left, buttons, 110, bh), fill(line('{0} more waiting', s.queue.length)), t.inkMuted, 10);
  // What is left of the card's time, as a thin line along its foot.
  const left01 = clamp((shown.until - now) / guideRules.cardSeconds, 0, 1);
  c.rect(new Rect(f32(r.x + 6), f32(r.y + r.h - 5), f32((r.w - 12) * left01), 2), { ...t.inkAccent, a: 170 }, 0);
  c.requestFrameAt(Math.min(shown.until, now + 0.5));
}
interface EntryLayout {
  entry: GuideEntry | NoticeRecord;
  rows: string[];
  /** It has a body to unfold, and whether that body shows. */
  folds: boolean;
  open: boolean;
  height: number;
}
const isNotice = (entry: GuideEntry | NoticeRecord): entry is NoticeRecord => !('key' in entry);
/** A notice in the log is its strip from the feed; one too long for a line unfolds to all of its words. */
function noticeRows(app: GameHudApp, notice: NoticeRecord, width: number): string[] {
  const key = `notice|${notice.text}|${localeRevision()}|${width}`;
  let rows = wrapped.get(key);
  if (!rows) {
    if (wrapped.size > 400) wrapped.clear();
    rows = wrapText(app.context, notice.text, width, 12, 6);
    wrapped.set(key, rows);
  }
  return rows;
}
/** The title row of an entry, and the room at its right for the day and the fold mark. */
const titleRow = (app: GameHudApp) => (app.touchMode ? 44 : 26),
  trailing = 76;
/** An entry as it stands now, folded or not; `room` cuts the body of one too tall for a page of its own. */
function measure(app: GameHudApp, entry: GuideEntry | NoticeRecord, inner: number, room: number): EntryLayout {
  const head = titleRow(app),
    wanted = app.guide.logUnfolded.has(entry);
  if (isNotice(entry)) {
    const all = noticeRows(app, entry, f32(inner - 32 - trailing)),
      folds = all.length > 1,
      open = folds && wanted,
      rows = open ? all.slice(0, Math.max(1, Math.floor((room - head - 8) / 16) + 1)) : all.slice(0, 1);
    return { entry, rows, folds, open, height: head + (rows.length - 1) * 16 + 8 };
  }
  if (!wanted) return { entry, rows: [], folds: true, open: false, height: head + 6 };
  const fixed = head + entry.detail.length * 15 + (entry.at ? head + 6 : 0) + 12,
    rows = bodyRows(app, entry, inner, 12).slice(0, Math.max(1, Math.floor((room - fixed) / 16)));
  return { entry, rows, folds: true, open: true, height: fixed + rows.length * 16 };
}
/** A solid triangle: pointing right on a folded entry, down on an unfolded one. */
function foldMark(app: GameHudApp, x: number, y: number, open: boolean, ink: { r: number; g: number; b: number; a: number }): void {
  const c = app.context;
  c.paint(JSON.stringify(['fold-mark', x, y, open, ink]), () => {
    const shape = new c.tvg.Shape();
    if (open) shape.moveTo(f32(x - 5), f32(y - 3)).lineTo(f32(x + 5), f32(y - 3)).lineTo(x, f32(y + 4)).close();
    else shape.moveTo(f32(x - 3), f32(y - 5)).lineTo(f32(x + 4), y).lineTo(f32(x - 3), f32(y + 5)).close();
    return shape.fill(ink.r, ink.g, ink.b, ink.a);
  });
}
/** The whole title row is the control that folds and unfolds its entry. */
function foldControl(app: GameHudApp, layout: EntryLayout, row: Rect, index: number) {
  const open = app.guide.logUnfolded;
  return app.context.control(`guide-log/fold/${index}`, row, (event) => {
    if (event.type !== EventType.Activate) return;
    if (!open.delete(layout.entry)) open.add(layout.entry);
  });
}
function noticeRow(app: GameHudApp, layout: EntryLayout, notice: NoticeRecord, x: number, y: number, inner: number, index: number): void {
  const c = app.context,
    t = app.theme,
    head = titleRow(app),
    { paper, ink } = noticeTone(t, notice.kind),
    strip = new Rect(x, y, inner, f32(layout.height - 8)),
    width = f32(inner - 32 - trailing),
    top = f32(y + (head - 16) / 2);
  if (layout.folds) foldControl(app, layout, strip, index);
  tag(c, strip, { cut: 4, lip: 2, fill: paper });
  noticeMark(c, t, notice.kind, f32(x + 16), f32(y + head / 2));
  if (layout.open) layout.rows.forEach((text, row) => c.text(new Rect(f32(x + 32), f32(top + row * 16), width, 16), text, ink, 12));
  else c.text(new Rect(f32(x + 32), top, width, 16), layout.folds ? c.elideText(notice.text, width, 12) : layout.rows[0], ink, 12);
  c.text(new Rect(f32(x + inner - 70), top, 48, 16), fill(line('Day {0}', notice.day)), t.inkMuted, 10, false, Align.End);
  if (layout.folds) foldMark(app, f32(x + inner - 12), f32(y + head / 2), layout.open, t.inkMuted);
}
function logPanel(app: GameHudApp, width: number): void {
  const c = app.context,
    t = app.theme,
    s = app.guide,
    prefs = guidePreferences(),
    touch = app.touchMode,
    bh = touch ? 44 : 28,
    top = touch ? 64 : 56,
    w = Math.min(440, f32(width - 24)),
    // Ends above the notice toast's line over the dock.
    bottom = Math.max(f32(top + 260), f32(app.dockBounds.y - 54)),
    r = new Rect(12, top, w, f32(Math.min(bottom, app.viewHeight - 8) - top)),
    inner = f32(w - 32),
    left = f32(r.x + 16);
  c.control('guide-log', r, undefined, true, false);
  board(c, r, { header: 56 });
  c.text(new Rect(left, f32(r.y + 12), f32(inner - 50), 24), 'Log', t.accent, 17, true);
  c.text(new Rect(left, f32(r.y + 36), f32(inner - 50), 16), 'Everything that has happened, newest first.', t.muted, 11);
  const close = new Rect(f32(r.x + r.w - 12 - bh), f32(r.y + 10), bh, bh),
    closing = button(c, 'guide-log/close', close, '', () => toggleGuideLog(app), ButtonStyle.Quiet),
    ink = closing.hovered || closing.focused ? t.text : t.muted,
    m = f32(bh / 2 - 5);
  c.line(f32(close.x + m), f32(close.y + m), f32(close.x + bh - m), f32(close.y + bh - m), ink, f32(1.5));
  c.line(f32(close.x + bh - m), f32(close.y + m), f32(close.x + m), f32(close.y + bh - m), ink, f32(1.5));
  let y = f32(r.y + 60);
  const half = f32((inner - 8) / 2);
  button(c, 'guide-log/focus', new Rect(left, y, half, bh), prefs.focus ? 'Camera focus: On' : 'Camera focus: Off', () => setGuidePreference('focus', !prefs.focus), ButtonStyle.Default, true, undefined, prefs.focus, { fontSize: 11 });
  button(c, 'guide-log/cards', new Rect(f32(left + half + 8), y, half, bh), prefs.cards ? 'Cards: On' : 'Cards: Off', () => setGuidePreference('cards', !prefs.cards), ButtonStyle.Default, true, undefined, prefs.cards, { fontSize: 11 });
  y = f32(y + bh + 12);
  groove(c, left, y, inner);
  y = f32(y + 10);
  const newest = guideTimeline(s),
    footer = f32(r.y + r.h - 12 - bh),
    room = f32(footer - 8 - y);
  if (!newest.length) {
    for (const row of wrapText(c, 'Nothing yet. What happens is written here.', inner, 12, 4)) {
      c.text(new Rect(left, y, inner, 17), row, t.muted, 12);
      y = f32(y + 17);
    }
    return;
  }
  const first = clamp(s.logPages.at(-1) ?? 0, 0, newest.length - 1);
  let used = 0,
    index = first;
  for (; index < newest.length; ++index) {
    const layout = measure(app, newest[index], inner, room);
    if (index > first && used + layout.height > room) break;
    entryRow(app, layout, left, f32(y + used), inner, index);
    used += layout.height;
  }
  button(c, 'guide-log/newer', new Rect(left, footer, 96, bh), 'Newer', () => s.logPages.pop(), ButtonStyle.Default, s.logPages.length > 1, undefined, false, { fontSize: 11 });
  button(c, 'guide-log/older', new Rect(f32(left + inner - 96), footer, 96, bh), 'Older', () => s.logPages.push(index), ButtonStyle.Default, index < newest.length, undefined, false, { fontSize: 11 });
}
function entryRow(app: GameHudApp, layout: EntryLayout, x: number, y: number, inner: number, index: number): void {
  const { entry, rows } = layout;
  if (isNotice(entry)) return noticeRow(app, layout, entry, x, y, inner, index);
  const c = app.context,
    t = app.theme,
    head = titleRow(app),
    look = app.touchMode ? 76 : 56,
    day = entry.day === null ? 'Earlier' : fill(line('Day {0}', entry.day)),
    titleWidth = f32(inner - trailing),
    state = foldControl(app, layout, new Rect(x, y, inner, head), index),
    ink = state.hovered || state.focused ? t.accent : t.text;
  c.text(new Rect(x, y, titleWidth, head), c.elideText(fill(titleOf(entry)), titleWidth, 13, true), ink, 13, true);
  c.text(new Rect(f32(x + inner - 82), y, 60, head), day, t.muted, 10, false, Align.End);
  foldMark(app, f32(x + inner - 12), f32(y + head / 2), layout.open, state.hovered || state.focused ? t.accent : t.muted);
  let row = f32(y + head);
  for (const text of rows) {
    c.text(new Rect(x, row, inner, 16), text, t.text, 12);
    row = f32(row + 16);
  }
  if (layout.open)
    for (const text of entry.detail) {
      c.text(new Rect(x, row, inner, 15), c.elideText(text, inner, 11), t.muted, 11);
      row = f32(row + 15);
    }
  if (layout.open && entry.at)
    button(c, `guide-log/look/${index}`, new Rect(f32(x + inner - look), f32(row + 4), look, app.touchMode ? head : f32(head - 2)), 'Look', () => guideShow(app, entry), ButtonStyle.Default, true, undefined, false, { fontSize: 11 });
  groove(c, x, f32(y + layout.height - (layout.open ? 6 : 3)), inner);
}
/** Once per HUD frame, after every other panel: the log button, then the log or the card. */
export function guideHud(app: GameHudApp, width: number, height: number): void {
  if (app.town.isTitleAutoplay()) return;
  const c = app.context;
  logButton(app);
  if (app.guide.logOpen) logPanel(app, width);
  else card(app, width, height);
  if (app.guide.glide) c.requestAnimationFrame();
  c.deferOverlay(
    (_, controls) =>
      blocked.set(
        app,
        controls
          .filter((k) => !k.id.startsWith('guide') && !k.id.startsWith('resource-'))
          .map((k) => ({ x: k.bounds.x, y: k.bounds.y, w: k.bounds.w, h: k.bounds.h })),
      ),
    'guide-measure',
  );
}
