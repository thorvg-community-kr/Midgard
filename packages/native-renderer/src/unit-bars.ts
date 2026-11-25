// Settlers show a delayed chip when hurt and a bleed-out ring when downed.
import { project } from '../../engine/src/geometry';
import { combatRules } from '../../engine/src/combat-events';
import { Role, type Person } from '../../engine/src/person';
import type { Town } from '../../engine/src/town';
import { ShapeNode } from './paint';
import { appendArc, combatLayers, tone } from './combat-paint';
import type { WorldRendererState } from './world-renderer-state';

/** How long the chip holds after a blow before it starts to catch up, and its catch-up speed. */
export const chipHold = 0.4;
const chipRate = 0.9;
/** Below this many seconds the ring turns to the danger colour. */
const urgent = 10;

export interface BarTrack {
  shown: number;
  chip: number;
  hurtAt: number;
  seen: number;
}
interface Shapes {
  back: ShapeNode;
  chip: ShapeNode;
  friend: ShapeNode;
  ringBack: ShapeNode;
  ring: ShapeNode;
  ringUrgent: ShapeNode;
}
interface BarState {
  town: Town;
  tracks: Map<string, BarTrack>;
  shapes: Shapes;
}
const states = new WeakMap<WorldRendererState, BarState>();
export function barTracksOf(s: WorldRendererState): ReadonlyMap<string, BarTrack> {
  return states.get(s)?.tracks ?? new Map();
}
export function barShapesOf(s: WorldRendererState): Readonly<Shapes> | undefined {
  return states.get(s)?.shapes;
}
/** Most bars drawn at once; the least important give way first. */
export const maxBars = 40;

function track(state: BarState, key: string, fraction: number, now: number): BarTrack {
  let t = state.tracks.get(key);
  if (!t) {
    t = { shown: fraction, chip: fraction, hurtAt: -1, seen: now };
    state.tracks.set(key, t);
  }
  const dt = Math.max(0, Math.min(0.25, now - t.seen));
  if (fraction < t.shown - 1e-4) t.hurtAt = now;
  t.shown = fraction;
  if (fraction >= t.chip) t.chip = fraction;
  else if (now - t.hurtAt >= chipHold)
    t.chip = Math.max(fraction, t.chip - dt * (chipRate * 0.4 + (t.chip - fraction) * chipRate * 4));
  t.seen = now;
  return t;
}
function bar(
  shapes: Shapes,
  x: number,
  y: number,
  width: number,
  height: number,
  t: BarTrack,
): void {
  shapes.back.appendRect(x - width / 2 - 1, y - 1, width + 2, height + 2, 1, 1);
  if (t.chip > t.shown)
    shapes.chip.appendRect(x - width / 2 + width * t.shown, y, width * (t.chip - t.shown), height);
  if (t.shown > 0) shapes.friend.appendRect(x - width / 2, y, width * t.shown, height);
}
const player = (p: Person) => p.faction === 0 && p.role === Role.Resident;

/** Redraws every bar and ring in a handful of shared shapes. */
export function updateUnitBars(s: WorldRendererState, town: Town, selected: readonly number[] = []): void {
  let state = states.get(s);
  if (!state || state.town !== town) {
    const shapes: Shapes = {
      back: new ShapeNode().fill(...tone.ink, 215),
      chip: new ShapeNode().fill(...tone.peach),
      friend: new ShapeNode().fill(...tone.leaf),
      ringBack: new ShapeNode().fill(...tone.ink, 200),
      ring: new ShapeNode().fill(...tone.peach),
      ringUrgent: new ShapeNode().fill(...tone.rust),
    };
    if (state) for (const shape of Object.values(state.shapes)) combatLayers(s).bars.remove(shape);
    state = { town, tracks: new Map(), shapes };
    states.set(s, state);
  }
  const { shapes } = state,
    layer = combatLayers(s).bars;
  for (const shape of Object.values(shapes)) {
    shape.reset();
    if (!layer.children.includes(shape)) layer.add(shape);
  }
  const now = town.clock(),
    seen = new Set<string>(),
    chosen = new Set(selected);
  const wanted: { priority: number; draw: () => void }[] = [];
  for (const p of town.people()) {
    const arrival = s.figures.get(p.id)?.arrival, at = arrival?.foot ?? p.position;
    if (!player(p) || arrival?.rising || p.inside || p.visibility() < 0.5 || s.currentVisibility.sample(at) < 119)
      continue;
    const foot = project(at.x, at.y);
    if (p.downedAt >= 0) {
      const left = town.bleedOutLeft?.(p) ?? Math.max(0, p.downedAt + combatRules.bleedOut - now),
        total = Math.max(0.001, left + Math.max(0, now - p.downedAt)),
        share = Math.max(0, Math.min(1, left / total)),
        cx = foot.x,
        cy = foot.y - 19;
      appendArc(shapes.ringBack, cx, cy, 6.4, 6.4, 3, 0, 1);
      appendArc(left < urgent ? shapes.ringUrgent : shapes.ring, cx, cy, 5.7, 5.7, 1.6, 1 - share, 1);
      continue;
    }
    const key = `p${p.id}`,
      fraction = Math.max(0, Math.min(1, p.health)),
      t = track(state, key, fraction, now);
    seen.add(key);
    if (fraction >= 0.995 && !chosen.has(p.id) && t.chip <= t.shown) continue;
    wanted.push({
      priority: (chosen.has(p.id) ? 85 : 70) + (1 - fraction) * 10,
      draw: () => bar(shapes, foot.x, foot.y - 31, 14, 2.2, t),
    });
  }
  if (wanted.length > maxBars) wanted.sort((a, b) => b.priority - a.priority);
  for (let i = 0; i < Math.min(maxBars, wanted.length); i++) wanted[i].draw();
  for (const key of state.tracks.keys()) if (!seen.has(key)) state.tracks.delete(key);
}
