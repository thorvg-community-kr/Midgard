import {
  Rect,
  Align,
  ButtonStyle,
  Icon,
  board,
  button,
  rgba,
  setTransform,
  tag,
} from '../../../../packages/native-ui/src';
import { seasonName } from '../../../../packages/engine/src/town-models';
import { weatherName } from '../../../../packages/engine/src/climate';
import { dayCycle, type DayCycle } from '../../../../packages/engine/src/day-cycle';
import type { Paint, Scene, Shape, ThorVGNamespace } from '@thorvg/webcanvas';
import { f32 as f, clamp, lround } from '../../../../packages/engine/src/numeric';
import type { GameHudApp } from './game-hud-contract';
import { skyMural as mural } from './hud-assets';
import { tooltip } from './game-combat-hud';
import { hudGlyph } from './hud-glyphs';
import { winterOutlookLine, winterLineHeight } from './camp-resource-hud';
import { speedColumns, touchClockBounds, touchHudTop, touchTarget } from './mobile-layout';
const revealDuration = f(0.18),
  controlStep = 34,
  panelWidth = 6 * controlStep + 8;
const unfold = (value: number) => f(1 - f(f(f(1 - value) * f(1 - value)) * f(1 - value)));
enum MuralPart {
  Remaining = 1,
  Bodies,
  Sun,
  Moon,
}
interface CelestialParts {
  remaining: Shape;
  sun: Scene;
  moon: Scene;
  sunX: number;
  sunY: number;
}
// WebCanvas exposes IDs but not Scene::paints()/Paint::transform() getters.
// Keep the same owned child objects and prior sun translation alongside the mural.
const celestialParts = new WeakMap<Paint, CelestialParts>();
function orbitPoint(halfTurn: number) {
  const angle = f(f(Math.PI) * f(1 - halfTurn));
  return { x: f(240 + f(74 * f(Math.cos(angle)))), y: f(27 - f(13 * f(Math.sin(angle)))) };
}
function orbitArc(shape: Shape, from: number): void {
  const first = orbitPoint(from);
  shape.reset().moveTo(first.x, first.y);
  for (let i = 1; i <= 32; ++i) {
    const at = orbitPoint(i === 32 ? 1 : Math.min(1, f(from + f(f(i / 32) * f(1 - from)))));
    shape.lineTo(at.x, at.y);
  }
}
function celestialBody(tvg: ThorVGNamespace, moon: boolean): Scene {
  const body = new tvg.Scene();
  body.id = moon ? MuralPart.Moon : MuralPart.Sun;
  const backing = new tvg.Shape().appendCircle(0, 0, 8.5, 8.5).fill(44, 42, 64);
  body.add(backing);
  backing.dispose();
  const emblem = new tvg.Shape();
  if (moon) {
    emblem
      .moveTo(4, -7)
      .cubicTo(-7, -8, -9, 6, 4, 8)
      .cubicTo(-2, 3, -2, -3, 4, -7)
      .close()
      .fill(214, 222, 226);
  } else {
    // A flat sun: a disc inside a ring of eight teeth.
    const rays = new tvg.Shape().fill(226, 180, 98);
    for (let i = 0; i < 8; ++i) {
      const angle = f(f(i * f(Math.PI)) / 4),
        x = f(Math.cos(angle)),
        y = f(Math.sin(angle));
      rays
        .moveTo(f(x * 10.5), f(y * 10.5))
        .lineTo(f(x * 6 - y * 2.2), f(y * 6 + x * 2.2))
        .lineTo(f(x * 6 + y * 2.2), f(y * 6 - x * 2.2))
        .close();
    }
    body.add(rays);
    rays.dispose();
    emblem.appendCircle(0, 0, 5.2, 5.2).fill(246, 214, 138);
  }
  body.add(emblem);
  emblem.dispose();
  return body;
}
function celestialMural(tvg: ThorVGNamespace): Scene {
  const picture = new tvg.Picture().load(mural, { type: 'svg' }),
    scene = new tvg.Scene();
  scene.add(picture);
  picture.dispose();
  const track = new tvg.Shape();
  orbitArc(track, 0);
  track
    .fill(0, 0, 0, 0)
    .stroke(f(1))
    .stroke({ color: [120, 108, 132, 170] });
  for (let i = 0; i <= 4; ++i) {
    const at = orbitPoint(f(i / 4));
    track.moveTo(at.x, f(at.y - 2)).lineTo(at.x, f(at.y + 2));
  }
  scene.add(track);
  track.dispose();
  const remaining = new tvg.Shape();
  remaining.id = MuralPart.Remaining;
  remaining.fill(0, 0, 0, 0).stroke(f(2)).stroke({ cap: tvg.StrokeCap.Round });
  scene.add(remaining);
  const bodies = new tvg.Scene();
  bodies.id = MuralPart.Bodies;
  const horizon = new tvg.Shape().appendRect(153, 2, 174, 25).fill(255, 255, 255);
  const sun = celestialBody(tvg, false),
    moon = celestialBody(tvg, true);
  bodies.clip(horizon).add(sun).add(moon);
  horizon.dispose();
  scene.add(bodies);
  bodies.dispose();
  celestialParts.set(scene, { remaining, sun, moon, sunX: 0, sunY: 0 });
  const release = scene.dispose.bind(scene);
  scene.dispose = () => {
    if (scene.isDisposed) return;
    celestialParts.delete(scene);
    remaining.dispose();
    sun.dispose();
    moon.dispose();
    release();
  };
  return scene;
}
function timeOfDay(day: number): string {
  const minutes = Math.trunc(f(f(day * 24) * 60));
  return String(Math.trunc(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}
function timeRemaining(cycle: DayCycle): string {
  const minutes = Math.max(1, Math.ceil(f(f(cycle.remaining * 24) * 60)));
  return Math.trunc(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
}
export function skyMural(this: GameHudApp, width: number): void {
  const c = this.context,
    t = this.theme,
    now = c.time(),
    dt = this.timeUiAt < 0 ? 0 : f(clamp(now - this.timeUiAt, 0, 0.25));
  this.timeUiAt = now;
  const target = this.timeExpanded ? 1 : 0;
  if (this.reducedMotion()) this.timeReveal = target;
  else if (this.timeExpanded) this.timeReveal = Math.min(target, f(this.timeReveal + f(dt / revealDuration)));
  else this.timeReveal = Math.max(target, f(this.timeReveal - f(dt / revealDuration)));
  const opened = unfold(this.timeReveal);
  const touch = this.touchMode;
  this.timeToggleBounds = touch ? touchClockBounds(width) : new Rect(width - 96, 12, 36, 36);
  const below = touch || width < 900, columns = touch ? speedColumns(width) : 6,
    controlsWidth = touch ? columns * 46 + 8 : panelWidth,
    right = touch ? (width + controlsWidth) / 2 : below ? width - 16 : this.timeToggleBounds.x - 8;
  this.timePanelBounds = new Rect(
    f(right - f(controlsWidth * opened)),
    below ? (this.touchMode ? 62 : 56) : 12,
    f(controlsWidth * opened),
    touch ? (6 / columns) * 46 + 6 : 36,
  );
  if (touch) {
    this.skyBounds = this.timeToggleBounds;
    this.skyHovered = false;
    wakeButton(this, width);
    if (this.timeReveal !== target) c.requestAnimationFrame();
    return;
  }
  const leftEdge = 16,
    rightEdge = below ? this.timeToggleBounds.x - 12 : this.timePanelBounds.x - 12,
    room = f(2 * Math.min(f(f(width / 2) - leftEdge), f(rightEdge - f(width / 2)))),
    muralWidth = clamp(room, 112, 360);
  this.skyBounds = new Rect(f(f(width - muralWidth) / 2), 12, muralWidth, 36);
  const state = c.control('sky-calendar', this.skyBounds, undefined, true, false);
  this.skyHovered = state.hovered;
  this.skyArtwork ??= celestialMural(c.tvg);
  const cycle = dayCycle(this.town.yearFraction(), this.town.dayFraction()),
    parts = celestialParts.get(this.skyArtwork);
  if (!parts) throw new Error('Incomplete celestial mural');
  const orbit = f(cycle.progress + (cycle.daylight ? 0 : 1)),
    sunAt = orbitPoint(orbit),
    moonAt = orbitPoint(f(orbit + 1));
  if (parts.sunX !== sunAt.x || parts.sunY !== sunAt.y) {
    orbitArc(parts.remaining, cycle.progress);
    parts.remaining.stroke({ color: cycle.daylight ? [226, 180, 98, 255] : [190, 204, 214, 255] });
  }
  setTransform(parts.sun, {
    e11: 1,
    e12: 0,
    e13: sunAt.x,
    e21: 0,
    e22: 1,
    e23: sunAt.y,
    e31: 0,
    e32: 0,
    e33: 1,
  });
  setTransform(parts.moon, {
    e11: 1,
    e12: 0,
    e13: moonAt.x,
    e21: 0,
    e22: 1,
    e23: moonAt.y,
    e31: 0,
    e32: 0,
    e33: 1,
  });
  parts.sunX = sunAt.x;
  parts.sunY = sunAt.y;
  c.add(this.skyArtwork);
  const scale = f(this.skyBounds.w / 480),
    artY = f(this.skyBounds.y + f(f(this.skyBounds.h - f(48 * scale)) / 2));
  setTransform(this.skyArtwork, {
    e11: scale,
    e12: 0,
    e13: this.skyBounds.x,
    e21: 0,
    e22: scale,
    e23: artY,
    e31: 0,
    e32: 0,
    e33: 1,
  });
  const caption =
    (this.skyBounds.w >= 300 ? (cycle.daylight ? 'Sunset in ' : 'Sunrise in ') : '') + timeRemaining(cycle);
  c.text(
    new Rect(f(this.skyBounds.x + f(168 * scale)), f(artY + f(30 * scale)), f(144 * scale), f(14 * scale)),
    caption,
    cycle.daylight ? t.text : rgba(193, 207, 215),
    clamp(f(13 * scale), 8, 10),
    false,
    Align.Center,
  );
  if (this.skyHovered) {
    const ink = { ...t.accent, a: 140 };
    c.line(
      this.skyBounds.x + 12,
      f(f(artY + f(48 * scale)) - 2),
      f(f(this.skyBounds.x + this.skyBounds.w) - 12),
      f(f(artY + f(48 * scale)) - 2),
      ink,
      0.8,
    );
  }
  wakeButton(this, width);
  if (Math.abs(f(this.timeReveal - target)) > f(0.001)) c.requestAnimationFrame();
}
/** Beside the sky, and only while somebody is abed: one press brings them all out. */
function wakeButton(app: GameHudApp, width: number): void {
  if (app.town.isTitleAutoplay() || !app.town.abed().length) return;
  const c = app.context,
    t = app.theme,
    size = app.touchMode ? touchTarget : 36,
    nextToLog = app.skyBounds.x >= 12 + size * 2 + 12,
    // In portrait the spare place is across from Quests, below Settings.
    r = app.touchMode && !nextToLog
      ? new Rect(width - size - 12, touchHudTop(width, app.timeExpanded), size, size)
      : new Rect(Math.max(12 + size + 8, f(app.skyBounds.x - size - 6)), 12, size, size),
    state = button(c, 'wake-everyone', r, '', () => app.wakeEveryone());
  hudGlyph(c, 'wake', f(r.x + r.w / 2), f(r.y + r.h / 2 + (state.lift ?? 0)), state.hovered ? t.text : t.accent);
  tooltip(c, 'wake-everyone', state.hovered && !app.touchMode, [
    'Wake everyone',
    'Resting residents come outside and resume their orders.',
  ]);
}
export function calendarDetails(this: GameHudApp, width: number): void {
  if (!this.skyHovered || this.touchMode) return;
  const c = this.context,
    t = this.theme,
    date = this.town.calendar(),
    sky = this.town.climate(),
    rule = { ...t.inkMuted, a: 90 },
    w = Math.min(288, width - 24),
    winter = winterOutlookLine(this.town),
    panel = new Rect(
      f(f(width - w) / 2),
      f(f(this.skyBounds.y + this.skyBounds.h) + 10),
      w,
      winter ? 154 + winterLineHeight + 4 : 154,
    );
  // An almanac leaf: paper, like every note that only informs.
  tag(c, panel, { cut: 5, lip: 3 });
  const labels = ['Day', 'Month', 'Year'],
    values = [date.day, date.month, date.year];
  for (let i = 0; i < 3; i++) {
    const x = f(f(panel.x + 16) + f(f(i * f(w - 32)) / 3));
    c.text(new Rect(x, panel.y + 8, f(f(w - 32) / 3), 14), labels[i], t.inkMuted, 10);
    c.text(new Rect(x, panel.y + 23, f(f(w - 32) / 3), 20), String(values[i]), t.ink, 15, true);
  }
  c.line(panel.x + 16, panel.y + 49, f(f(panel.x + w) - 16), panel.y + 49, rule);
  const clock = timeOfDay(this.town.dayFraction());
  c.text(new Rect(panel.x + 16, panel.y + 56, f(f(w / 2) - 24), 14), 'Season', t.inkMuted, 10);
  c.text(
    new Rect(panel.x + 16, panel.y + 72, f(f(w / 2) - 24), 18),
    seasonName(date.season),
    t.ink,
    12,
    true,
  );
  c.text(new Rect(f(f(panel.x + f(w / 2)) + 8), panel.y + 56, f(f(w / 2) - 24), 14), 'Time', t.inkMuted, 10);
  c.text(new Rect(f(f(panel.x + f(w / 2)) + 8), panel.y + 72, f(f(w / 2) - 24), 18), clock, t.ink, 12, true);
  const weather = weatherName(sky.weather) + '  ·  ' + lround(sky.temperature) + '°C';
  c.text(new Rect(panel.x + 16, panel.y + 101, w - 32, 16), weather, t.inkMuted, 11, false, Align.Center);
  c.line(panel.x + 16, panel.y + 124, f(f(panel.x + w) - 16), panel.y + 124, rule);
  const cycle = dayCycle(this.town.yearFraction(), this.town.dayFraction());
  c.text(new Rect(panel.x + 16, panel.y + 132, 48, 14), 'Sunrise', t.inkMuted, 10);
  c.text(new Rect(panel.x + 66, panel.y + 132, 48, 14), timeOfDay(cycle.sunrise), t.ink, 11, true);
  c.text(new Rect(f(f(panel.x + f(w / 2)) + 8), panel.y + 132, 48, 14), 'Sunset', t.inkMuted, 10);
  c.text(
    new Rect(f(f(panel.x + f(w / 2)) + 58), panel.y + 132, 48, 14),
    timeOfDay(cycle.sunset),
    t.ink,
    11,
    true,
  );
  if (winter) {
    c.line(panel.x + 16, panel.y + 154, f(f(panel.x + w) - 16), panel.y + 154, rule);
    c.text(
      new Rect(panel.x + 12, panel.y + 158, w - 24, winterLineHeight - 2),
      c.elideText(winter.text, w - 24, 11, winter.short),
      winter.short ? t.danger : t.ink,
      11,
      winter.short,
      Align.Center,
    );
  }
}
const heldReason = 'Normal speed beyond a gate';
/** One tappable clock in the middle of the top row. Its lettering stays in logical pixels. */
function touchClock(app: GameHudApp): void {
  const c = app.context, t = app.theme, r = app.skyBounds;
  const state = button(c, 'speed-toggle', r, '', () => {
    app.timeExpanded = !app.timeExpanded;
    if (app.viewHeight < 500 && app.timeExpanded) app.mobileQuestsExpanded = false;
  },
    ButtonStyle.Default, true, undefined, app.timeExpanded);
  const cycle = dayCycle(app.town.yearFraction(), app.town.dayFraction());
  const cy = r.y + 14 + (state.lift ?? 0), middle = r.x + r.w / 2;
  const speed = app.gameSpeed(), ink = t.text;
  c.paint(JSON.stringify(['clock-emblem', cycle.daylight, middle, cy]), () => {
    const body = celestialBody(c.tvg, !cycle.daylight);
    body.translate(middle - 48, cy);
    return body;
  });
  c.text(new Rect(middle - 34, cy - 12, 66, 24), timeOfDay(app.town.dayFraction()), ink, 18, true, Align.Center);
  if (speed) c.text(new Rect(middle + 36, cy - 9, 28, 18), speed + 'x', t.accent, 13, true, Align.Center);
  else {
    c.rect(new Rect(middle + 45, cy - 5, 3, 10), t.accent);
    c.rect(new Rect(middle + 51, cy - 5, 3, 10), t.accent);
  }
  const caption = (cycle.daylight ? 'Sunset in ' : 'Sunrise in ') + timeRemaining(cycle);
  c.text(new Rect(r.x + 5, cy + 10, r.w - 10, 18), caption, t.text, 13, false, Align.Center);
}
export function timeControls(this: GameHudApp, width: number): void {
  const c = this.context,
    t = this.theme,
    step = this.touchMode ? 46 : controlStep,
    columns = this.touchMode ? speedColumns(width) : 6,
    fullWidth = this.touchMode ? columns * step + 8 : panelWidth;
  if (this.timeReveal > 0) {
    const full = new Rect(this.timePanelBounds.x + this.timePanelBounds.w - fullWidth,
      this.timePanelBounds.y, fullWidth, this.timePanelBounds.h);
    // The clip is taller than the panel so the board keeps its thickness and shadow while it slides out.
    const reveal = this.timePanelBounds;
    c.clip(new Rect(reveal.x, reveal.y, reveal.w, f(reveal.h + 10)), () => {
      c.control('time-controls-panel', this.timePanelBounds, undefined, true, false);
      board(c, full);
      const labels = ['||', '1x', '2x', '3x', '4x', '5x'],
        held = this.speedHeld();
      for (let i = 0; i <= 5; i++) {
        const state = button(
          c,
          'speed-' + labels[i],
          new Rect(full.x + 4 + i % columns * step, full.y + 4 + Math.floor(i / columns) * step,
            this.touchMode ? 44 : controlStep - 4, this.touchMode ? 44 : 28),
          labels[i],
          () => {
            if (i) this.setSpeed(i);
            else this.togglePause();
          },
          this.gameSpeed() === i ? ButtonStyle.Primary : held && i > 1 ? ButtonStyle.Quiet : ButtonStyle.Default,
          this.timeExpanded,
          Icon.None,
          false,
          { fontSize: this.touchMode ? 14 : 11 },
        );
        if (held && i > 1) tooltip(c, 'speed-' + labels[i], state.hovered, [heldReason]);
      }
    });
  }
  if (this.touchMode) {
    touchClock(this);
    return;
  }
  const toggle = button(
      c,
      'speed-toggle',
      this.timeToggleBounds,
      '',
      () => {
        this.timeExpanded = !this.timeExpanded;
      },
      this.timeExpanded ? ButtonStyle.Primary : ButtonStyle.Default,
    ),
    ink = this.timeExpanded ? t.accentText : t.text,
    bounds = this.timeToggleBounds;
  const lift = toggle.lift ?? 0;
  // A solid hourglass: two caps and the two bulbs of sand between them.
  c.paint(JSON.stringify(['time-hourglass', bounds, ink, lift]), () => {
    const shape = new c.tvg.Shape(),
      x = bounds.x + bounds.w / 2 - 6,
      y = bounds.y + bounds.h / 2 - 10 + lift;
    shape
      .appendRect(x - 1, y, 14, 3)
      .appendRect(x - 1, y + 17, 14, 3)
      .moveTo(x + 1, y + 4)
      .lineTo(x + 11, y + 4)
      .lineTo(x + 7, y + 10)
      .lineTo(x + 11, y + 16)
      .lineTo(x + 1, y + 16)
      .lineTo(x + 5, y + 10)
      .close()
      .fill(ink.r, ink.g, ink.b, ink.a);
    return shape;
  });
  if (toggle.hovered && !this.timeExpanded && !this.touchMode) {
    const hint = new Rect(this.timeToggleBounds.x - 58, 56, 94, 26);
    tag(c, hint);
    c.text(hint, 'Time controls', t.ink, 10, true, Align.Center);
  }
}
