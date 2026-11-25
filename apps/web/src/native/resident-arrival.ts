import { Camera, project, type Point } from '../../../../packages/engine/src/geometry';
import { clamp, f32 } from '../../../../packages/engine/src/numeric';
import type { Person } from '../../../../packages/engine/src/person';
import type { Town } from '../../../../packages/engine/src/town';
import { arrivalFoot } from '../../../../packages/native-renderer/src/arrival-pose';
import type { OverlayControl, Rect } from '../../../../packages/native-ui/src';
import { cameraEase } from './camera-glide';
import { GameAppState } from './game-app-state';

const arrive = 0.48, release = 1.14, finish = 1.65;

export interface ResidentArrival {
  town: Town;
  person: number;
  origin: Point;
  start: number | null;
  from: Camera;
  /** The real HUD rectangles are available after the first settlement frame. */
  panels: readonly Rect[] | null;
  /** The last pose set by the arrival. Null when the player has taken control. */
  placed: Camera | null;
}

/** Begin only on a successful player offering. No session, simulation or resident data is changed. */
export function beginResidentArrival(app: GameAppState, resident: Person): void {
  const { x, y, zoom } = app.camera;
  app.residentArrival = {
    town: app.town, person: resident.id, origin: { ...resident.position }, start: null,
    from: new Camera(x, y, zoom), placed: new Camera(x, y, zoom), panels: null,
  };
  app.guide.glide = null;
  app.guide.orderedAt = app.context.time();
}

export function releaseArrivalCamera(app: Pick<GameAppState, 'residentArrival'>): void {
  if (app.residentArrival) app.residentArrival.placed = null;
}

export function measureArrivalHud(stage: ResidentArrival, controls: readonly OverlayControl[]): void {
  stage.panels = controls
    .filter(({ id }) => id === 'guide-card' || id === 'objectives-panel' || id === 'sky-calendar' ||
      id === 'time-controls-panel' || id.startsWith('notice/'))
    .map(({ bounds }) => bounds)
    .sort((a, b) => a.y - b.y);
}

/** Try the middle of the view first. A short landscape HUD can leave more space at either side. */
function arrivalFocus(stage: ResidentArrival, width: number, height: number, dockTop: number, peak: number): Point {
  const top = Math.min(68, height * 0.18);
  const bottom = Math.max(top, dockTop - 8);
  const halfWidth = 9 * peak + 4;
  const side = Math.min(width / 2, halfWidth + 12);
  const wanted = 26 * peak + 6;
  let best = -Infinity;
  let target = { x: width / 2, y: (top + bottom) / 2 };
  for (const x of [width / 2, side, width - side]) {
    let freeFrom = top;
    const consider = (to: number) => {
      const room = to - freeFrom;
      if (room <= 0) return;
      // Keep the resident central when the available strip fits their silhouette.
      const score = Math.min(room / wanted, 1) - 0.44 * Math.abs(x - width / 2) / width;
      if (score <= best) return;
      best = score;
      target = { x, y: (freeFrom + to) / 2 + Math.min(3 * peak, room * 0.08) };
    };
    for (const panel of stage.panels ?? []) {
      if (panel.x > x + halfWidth || panel.x + panel.w < x - halfWidth ||
          panel.y + panel.h <= freeFrom || panel.y >= bottom) continue;
      consider(panel.y - 3);
      freeFrom = Math.max(freeFrom, panel.y + panel.h + 5);
    }
    consider(bottom);
  }
  return target;
}

/** Keep the face in open play space above the selected unit's dock, including on a short phone. */
export function stepResidentArrival(app: GameAppState, now: number, dockTop: number, reduced: boolean): void {
  const stage = app.residentArrival;
  if (!stage) return;
  // The ground mark and body first exist on this frame, even if rendering was suspended at confirmation.
  stage.start ??= now;
  const age = Math.max(0, now - stage.start);
  const person = app.town === stage.town && app.town.person(stage.person);
  if (!person || app.prayer || app.expedition || app.expeditionResult) {
    app.residentArrival = null;
    return;
  }
  if (reduced && !stage.panels && stage.placed) return;
  const camera = app.camera, placed = stage.placed;
  if (placed && camera.x === placed.x && camera.y === placed.y && camera.zoom === placed.zoom &&
      !app.pan.x && !app.pan.y && app.chosen.length === 1 && app.chosen[0] === person.id) {
    const w = app.viewWidth, h = app.viewHeight;
    const into = reduced ? 1 : cameraEase(clamp(age / arrive, 0, 1));
    const out = reduced ? 1 : cameraEase(clamp((age - release) / (finish - release), 0, 1));
    const peak = Math.min(GameAppState.maxZoom, Math.max(2.8, stage.from.zoom + 0.5));
    const zoom = f32(stage.from.zoom + (peak - stage.from.zoom) * into * (1 - out));
    const frame = arrivalFocus(stage, w, h, dockTop, reduced ? zoom : peak);
    const origin = stage.from.toScreen(project(stage.origin.x, stage.origin.y, 9), w, h);
    // A distant altar cuts straight to the clearing. Nearby, the resident slides smoothly into frame.
    const inView = origin.x >= 0 && origin.x <= w && origin.y >= 0 && origin.y <= h;
    const dx = inView ? (origin.x - frame.x) * (1 - into) : 0;
    const dy = inView ? (origin.y - frame.y) * (1 - into) : 0;
    const foot = arrivalFoot(stage.origin, person, age, reduced);
    const focus = project(foot.x, foot.y, 9);
    camera.x = f32(focus.x - (frame.x + dx - w / 2) / zoom);
    camera.y = f32(focus.y - (frame.y + dy - h / 2) / zoom);
    camera.zoom = zoom;
    if (camera.x !== placed.x || camera.y !== placed.y || camera.zoom !== placed.zoom) {
      app.hoveredWorldTarget = null;
      app.renderer.invalidatePresentation();
      placed.x = camera.x;
      placed.y = camera.y;
      placed.zoom = camera.zoom;
    }
    if (reduced) releaseArrivalCamera(app);
  } else if (placed) releaseArrivalCamera(app);
  if (age >= finish) app.residentArrival = null;
}
