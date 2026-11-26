// The notice feed above the dock: the newest few things that happened, each on its own strip of paper.
import { Align, EventType, Rect, tag, tone, type Color, type Context, type Theme } from '../../../../packages/native-ui/src';
import { f32 } from '../../../../packages/engine/src/numeric';

/** How long a notice shows, how many show at once, and how soon the oldest gives way to one waiting. */
export const noticeRules = { seconds: 8, shown: 3, yieldAfter: 2.5 };
/** What a notice is about: it picks the mark and the ink, so trouble is told from good news at a glance. */
export type NoticeKind = 'info' | 'good' | 'danger';
export interface Notice {
  id: number;
  text: string;
  from: number;
  until: number;
  kind: NoticeKind;
}
/** A notice the log keeps after its strip has gone. */
export interface NoticeRecord {
  text: string;
  kind: NoticeKind;
  /** Day of the game it happened, from 1. */
  day: number;
  /** How many explanations the log held when it came: its place among them. */
  after: number;
}
/** How many notices the log keeps; one more and the oldest leaves. */
export const noticesKept = 100;
export interface NoticeFeed {
  noticeFeed: Notice[];
  /** The log the feed writes to, and the game whose day it reads; a bare feed keeps nothing. */
  guide?: { notices: NoticeRecord[]; log: readonly unknown[] };
  town?: { days: number; isTitleAutoplay(): boolean };
}
const trouble =
  /(is down and bleeding out|was killed| has died|starved to death|died of the cold|destroyed|wrecked|tore up|No one returned|casts the fallen party|is overwhelmed|no harvest|leaves, unhappy|turned the offering away|will come |will raid Camp #|^Defenders pour out of |needs food for winter|^A guardian has emerged|stores are full|in sight for the|^Raid)/,
  welcome =
    /( is finished$| is repaired$| crafted |joins the settlement|reached level |beaten off|is slain|has fallen$| sealed \(\d+\/\d+\)$|^Unlocked|^Quest complete|grew into|merged into|back on their feet|has taken the oath|raised the |upgraded the |is laid$|paved with stone$|is mended$|ready for sowing|feels ready)/;
export const noticeKind = (text: string): NoticeKind =>
  trouble.test(text) ? 'danger' : welcome.test(text) ? 'good' : 'info';
const live = (feed: NoticeFeed, now: number): Notice[] => feed.noticeFeed.filter((n) => now < n.until);
/** The feed can take the next notice: a place is free, or it is full and the oldest has had its share. */
export function noticeDue(feed: NoticeFeed, now: number, waiting: boolean): boolean {
  const shown = live(feed, now);
  if (shown.length < noticeRules.shown) return true;
  return waiting && now >= shown[0].from + noticeRules.yieldAfter;
}
let serial = 0;
/** Adds a notice as the newest; with the feed full the oldest leaves. */
export function showNotice(feed: NoticeFeed, text: string, now: number): void {
  const shown = live(feed, now);
  while (shown.length >= noticeRules.shown) shown.shift();
  const kind = noticeKind(text);
  shown.push({ id: ++serial, text, from: now, until: now + noticeRules.seconds, kind });
  feed.noticeFeed = shown;
  // Whatever the feed shows is in the log: no caller writes it there by itself.
  if (!feed.guide || !feed.town || feed.town.isTitleAutoplay()) return;
  const kept = feed.guide.notices;
  kept.push({ text, kind, day: feed.town.days + 1, after: feed.guide.log.length });
  if (kept.length > noticesKept) kept.splice(0, kept.length - noticesKept);
}
/** The newest notice on screen, or '' with none: what older callers and checks read. */
export const newestNotice = (feed: NoticeFeed): string => feed.noticeFeed.at(-1)?.text ?? '';

const stripHeight = 30,
  gap = 6;
/** The paper and the ink of a notice of a kind, in the feed and in the log. */
export const noticeTone = (t: Theme, kind: NoticeKind): { paper: Color; ink: Color } =>
  kind === 'danger' ? { paper: tone(t.paper, t.danger, 0.22), ink: t.inkDanger } : { paper: t.paper, ink: t.ink };
export function noticeMark(c: Context, t: Theme, kind: NoticeKind, x: number, y: number): void {
  const ink: Color = kind === 'danger' ? t.inkDanger : kind === 'good' ? tone(t.success, t.ink, 0.45) : t.inkAccent;
  c.paint(JSON.stringify(['notice-mark', kind, x, y, ink]), () => {
    const shape = new c.tvg.Shape();
    // Trouble is a warning triangle, good news a tick, the rest a plain stud.
    if (kind === 'danger') shape.moveTo(x, f32(y - 7)).lineTo(f32(x + 7), f32(y + 6)).lineTo(f32(x - 7), f32(y + 6)).close();
    else if (kind === 'good')
      shape
        .moveTo(f32(x - 7), y)
        .lineTo(f32(x - 4), f32(y - 3))
        .lineTo(f32(x - 1), f32(y + 1))
        .lineTo(f32(x + 5), f32(y - 6))
        .lineTo(f32(x + 8), f32(y - 3))
        .lineTo(f32(x - 1), f32(y + 7))
        .close();
    else shape.moveTo(x, f32(y - 5)).lineTo(f32(x + 5), y).lineTo(x, f32(y + 5)).lineTo(f32(x - 5), y).close();
    return shape.fill(ink.r, ink.g, ink.b, ink.a);
  });
}
/**
 * Draws the feed, the newest nearest the dock and older ones above it. `lift` raises it over a line of guidance
 * that stands right above the dock; `right` is where its room ends. A click puts a notice away.
 */
export function noticeToast(
  app: NoticeFeed & { context: Context; theme: Theme; dockBounds: Rect },
  width: number,
  height: number,
  lift = 0,
  right = width - 12,
): void {
  const c = app.context,
    t = app.theme,
    now = c.time();
  app.noticeFeed = live(app, now);
  if (!app.noticeFeed.length || height < 540) return;
  const base = f32(app.dockBounds.y - 10 - lift),
    shown = app.noticeFeed;
  shown.forEach((notice, index) => {
    const fromNewest = shown.length - 1 - index,
      w = Math.min(560, f32(right - 12), Math.max(280, f32(c.textWidth(notice.text, 13, true) + 62))),
      rest = f32(base - (fromNewest + 1) * stripHeight - fromNewest * gap),
      // A new strip rises into place; the ones above make room.
      y = c.animate(`notice/y/${notice.id}`, rest, 0.18),
      age = now - notice.from,
      left = notice.until - now,
      seen = t.reducedMotion ? 1 : Math.min(1, age / 0.2, Math.max(0, left / 0.3)),
      rise = t.reducedMotion ? 0 : f32((1 - Math.min(1, age / 0.2)) * 10),
      strip = new Rect(f32(12 + f32(right - 12 - w) / 2), f32(y + rise), w, stripHeight);
    c.control(
      `notice/${notice.id}`,
      strip,
      (event) => {
        if (event.type === EventType.Activate) notice.until = 0;
      },
      true,
      false,
    );
    c.layer(
      new Rect(f32(strip.x - 2), f32(strip.y - 2), f32(strip.w + 4), f32(strip.h + 10)),
      () => {
        tag(c, strip, { cut: 5, lip: 3, fill: noticeTone(t, notice.kind).paper });
        noticeMark(c, t, notice.kind, f32(strip.x + 18), f32(strip.y + strip.h / 2));
        c.text(
          new Rect(f32(strip.x + 34), strip.y, f32(strip.w - 46), strip.h),
          c.elideText(notice.text, f32(w - 46), 13, true),
          noticeTone(t, notice.kind).ink,
          13,
          true,
          Align.Start,
        );
      },
      Math.round(255 * seen),
    );
    if (seen < 1) c.requestAnimationFrame();
  });
  // Wake for the fade of whichever leaves first.
  c.requestFrameAt(Math.max(now, Math.min(...shown.map((n) => n.until - 0.3))));
}
