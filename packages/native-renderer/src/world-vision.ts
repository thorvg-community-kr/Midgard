import { project, point } from '../../engine/src/geometry';
import { type Dungeon } from '../../engine/src/world-types';
import { f32 } from '../../engine/src/numeric';
import { currentSights } from '../../engine/src/town-vision';
import { Town } from '../../engine/src/town';
import { WorldMap } from '../../engine/src/world-map';
import { VisibilityRegion } from '../../engine/src/visibility-map';
import { WorldRendererState } from './world-renderer-state';
import { PictureNode, SceneNode, ShapeNode, type Matrix } from './paint';
import { softDisc } from './vector-paint';
import { brightest } from './light-flicker';
import { fitToView } from './world-ground';
import { lightLava } from './lava-motion';
import { MistField, mistRules } from './mist-bands';
export function buildDarkness(s: WorldRendererState, map: WorldMap): void {
  s.darkness.remove();
  const top = project(0, 0),
    right = project(map.width(), 0),
    left = project(0, map.height()),
    bottom = project(map.width(), map.height()),
    dark = new ShapeNode()
      .appendRect(left.x, top.y, f32(right.x - left.x), f32(bottom.y - top.y))
      .fill(4, 6, 22, 170);
  s.darkVeil = dark;
  const lit = new SceneNode();
  s.warmth.remove();
  for (const pool of s.pools) {
    pool.hole = softDisc(pool.rx, [255, 255, 255], Math.trunc(f32(190 * brightest)));
    lit.add(pool.hole);
    if (pool.warmth[0] + pool.warmth[1] + pool.warmth[2] === 0) continue;
    pool.tint = softDisc(f32(pool.rx * f32(0.8)), pool.warmth, 255);
    s.warmth.add(pool.tint);
  }
  lightLava(s, lit);
  dark.mask(lit, 'inverseAlpha');
  s.darkness.add(dark);
  fitToView(s, true);
  s.lastFlicker = -1;
}
/**
 * Redraws the mist when it is due: at its own slow rate while it flows, and at once when the camera has left
 * what was drawn, so no unknown land ever shows at the edge of the screen.
 */
function flowMist(s: WorldRendererState, gates: readonly Dungeon[], seconds: number): void {
  const picture = s.mistPicture;
  if (!picture || s.viewWidth <= 0) return;
  const halfW = f32(f32(s.viewWidth / 2) / s.view.zoom),
    halfH = f32(f32(s.viewHeight / 2) / s.view.zoom),
    [x, y, w, h] = s.mistView,
    covered = s.view.x - halfW >= x && s.view.y - halfH >= y && s.view.x + halfW <= x + w && s.view.y + halfH <= y + h,
    rate = s.view.zoom < 0.5 ? mistRules.rate / 2 : mistRules.rate,
    key = `${s.currentVisibility.revision()}:${s.exploredVisibility.revision()}:${s.mistKnown.size}:${s.fitted.join(',')}`;
  // Reduced motion stills the flow: the mist is then redrawn only when sight or the view has changed.
  if (covered && (s.reducedMotion ? key === s.mistKey : seconds >= s.mistAt && seconds - s.mistAt < 1 / rate)) return;
  s.mistAt = seconds;
  s.mistTick++;
  s.mistKey = key;
  s.mistView = [...s.fitted];
  const known = s.exploredVisibility,
    cover = known.coverage(),
    cols = known.columns(),
    lines = known.rows(),
    area = known.bounds(),
    kx = cols / area.w,
    ky = lines / area.h,
    field = (s.mistField ??= new MistField());
  field.build({
      sights: s.vision,
      // A gate is found when its nearest corner is seen; it must not then stand on the black.
      known: [
        ...gates
          .filter((gate) => gate.discovered)
          .map((gate) => ({ center: point(gate.origin.x + 1, gate.origin.y + 1), radius: 2.2 })),
        ...s.mistKnown.values(),
      ],
      explored: (tx, ty) =>
        cover[Math.min(lines - 1, Math.floor((ty - area.y) * ky)) * cols + Math.min(cols - 1, Math.floor((tx - area.x) * kx))],
      area,
      view: [s.fitted[0], s.fitted[1], s.fitted[2], s.fitted[3]],
      zoom: s.view.zoom,
      seconds: s.reducedMotion ? 0 : seconds,
    });
  // The frame origin is already in tiles. Center the first pixel on that sample.
  const { x: left, y: top, columns, rows, cell } = field.frame(),
    place: Matrix = [cell, 0, left - cell / 2, 0, cell, top - cell / 2, 0, 0, 1];
  picture.load(field.pixels, columns, rows).transform(place);
  s.warmPicture.load(field.warmth, columns, rows).transform(place);
  s.cloudMistPicture.load(field.pixels, columns, rows).transform(place);
}
/**
 * The day's light is two passes over the whole picture: a soft one that leaves black black, and a warm one
 * that lifts everything, black too. Under the warm one the mist would show as grey, so while the mist is shown
 * the warm pass is a picture that thins out as the mist thickens; with no mist to show, it lies everywhere.
 */
function warmThroughMist(s: WorldRendererState): void {
  if (!s.warmthCut) {
    s.warmthCut = true;
    s.sunLayers[1].opacity(0);
  }
  // As strong as the day makes the pass it stands in for; only on a change, so nothing is prepared again for it.
  const strength = s.sunPasses[1].color?.[3] ?? 0;
  if (s.warmLayer.alpha !== strength) s.warmLayer.opacity(strength);
}
export function warmEverywhere(s: WorldRendererState): void {
  if (!s.warmthCut) return;
  s.warmthCut = false;
  s.sunLayers[1].opacity(255);
  s.warmLayer.opacity(0);
}
/**
 * How far the memory of a sight reaches: as far as a day's sight shows the land, so that the bank, whose
 * edge wanders over the outer part of what was seen, never takes land the game counts as found.
 */
const remembered = (radius: number): number => f32(Math.max(radius + 2, radius * 1.27));
export function updateVision(s: WorldRendererState, town: Town, seconds = 0): void {
  const map = town.map(),
    first = !s.fogged;
  let changed = new VisibilityRegion();
  if (first) {
    s.exploredVisibility.reset(map.width(), map.height());
    s.currentVisibility.reset(map.width(), map.height());
    s.sightCount = 0;
    s.fogged = true;
    s.mistPicture = new PictureNode(new Uint8Array(4), 1, 1);
    s.mist.add(s.mistPicture);
    s.cloudMistPicture.source = s.mistPicture;
    s.mistAt = -1;
    s.mistKey = '';
    s.mistView = [0, 0, 0, 0];
    fitToView(s, true);
    changed = new VisibilityRegion(0, 0, s.exploredVisibility.columns(), s.exploredVisibility.rows());
  }
  const history = map.sights();
  if (history.length < s.sightCount) {
    if (s.exploredVisibility.clear())
      changed = new VisibilityRegion(0, 0, s.exploredVisibility.columns(), s.exploredVisibility.rows());
    s.sightCount = 0;
  }
  for (; s.sightCount < history.length; s.sightCount++) {
    const sight = { ...history[s.sightCount] },
      giant = map.giant();
    if (
      giant &&
      giant
        .sights()
        .some(
          (old) =>
            old.center.x === sight.center.x && old.center.y === sight.center.y && old.radius === sight.radius,
        )
    )
      continue;
    sight.radius = remembered(sight.radius);
    s.exploredVisibility.stamp(sight, changed);
  }
  s.vision = currentSights(town);
  const volcano = map.volcano();
  if (volcano && s.vision.some((sight) => volcano.inSight(sight))) s.vision.push(...volcano.sights());
  const currentChanged = s.currentVisibility.assign(s.vision, changed);
  if (first || currentChanged)
    for (const source of s.vision) {
      const sight = { ...source, radius: f32(source.radius + 1) };
      s.exploredVisibility.stamp(sight, changed);
    }
  if (!s.mistLifted) {
    flowMist(s, map.dungeons(), seconds);
    warmThroughMist(s);
  } else warmEverywhere(s);
  // Only on a change: a paint touched every frame is prepared again every frame.
  const shown = s.mistLifted ? 0 : 255;
  if (s.mist.alpha !== shown) s.mist.opacity(shown);
  if (s.cloudMist.alpha !== shown) s.cloudMist.opacity(shown);
}
