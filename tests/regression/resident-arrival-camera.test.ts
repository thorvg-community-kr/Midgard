import { describe, expect, it, vi } from 'vitest';
import { Camera, point, project } from '../../packages/engine/src/geometry';
import { Calling, Person, Race, Role } from '../../packages/engine/src/person';
import type { Town } from '../../packages/engine/src/town';
import { Rect, type Context } from '../../packages/native-ui/src';
import { GameAppState, type WorldRenderer } from '../../apps/web/src/native/game-app-state';
import { beginResidentArrival, measureArrivalHud, releaseArrivalCamera, stepResidentArrival } from '../../apps/web/src/native/resident-arrival';

const start = 14;
function setup(width: number, height: number) {
  const resident = new Person(3, 'Elin', Role.Resident, Calling.Settler, Race.Human, 8, point(7, 9));
  const town = { person: (id: number) => id === resident.id ? resident : null } as Town;
  const renderer = { invalidatePresentation: vi.fn() } as unknown as WorldRenderer;
  const app = new GameAppState(town, renderer, { time: () => start } as Context);
  const at = project(7, 9, 9);
  app.camera = new Camera(at.x + 45, at.y - 10, 1.4);
  app.chosen = [resident.id];
  app.viewWidth = width;
  app.viewHeight = height;
  app.paused = true;
  return { app, resident, at };
}

describe('the camera on a resident created at an altar', () => {
  it.each([[1024, 700, 480], [390, 760, 560], [710, 355, 165]])(
    'frames the real resident above the unit card in a %d by %d view, then restores the zoom',
    (width, height, dockTop) => {
      const { app, resident, at } = setup(width, height);
      const initial = { ...app.camera };
      beginResidentArrival(app, resident);
      const step = (age: number) => stepResidentArrival(app, start + age, dockTop, false);
      step(0);
      expect(app.camera.x).toBeCloseTo(initial.x);
      expect(app.camera.zoom).toBeCloseTo(initial.zoom);
      step(0.24);
      expect(app.camera.zoom).toBeGreaterThan(initial.zoom);
      step(0.52);
      const held = { ...app.camera }, feet = app.camera.toScreen(project(7, 9), width, height);
      expect(held.zoom).toBeCloseTo(2.8);
      expect(feet.x).toBeCloseTo(width / 2);
      expect(feet.y).toBeLessThan(dockTop - 8);
      expect(app.camera.toScreen(project(7, 9, 25), width, height).y).toBeGreaterThan(24);
      step(1.10);
      expect({ ...app.camera }).toEqual(held);
      step(1.4);
      expect(app.camera.zoom).toBeLessThan(held.zoom);
      step(1.7);
      expect(app.camera.zoom).toBeCloseTo(initial.zoom);
      expect(app.camera.toScreen(at, width, height).x).toBeCloseTo(width / 2);
      expect(app.residentArrival).toBeNull();
      expect(app.paused).toBe(true);
      expect(app.chosen).toEqual([resident.id]);
    },
  );

  it('uses one cut and keeps the original zoom with reduced motion', () => {
    const { app, resident } = setup(720, 360);
    app.camera.x += 5000;
    beginResidentArrival(app, resident);
    stepResidentArrival(app, start, 155, true);
    measureArrivalHud(app.residentArrival!, []);
    stepResidentArrival(app, start + 0.02, 155, true);
    expect(app.camera.toScreen(project(7, 9), 720, 360).x).toBeCloseTo(360);
    expect(app.camera.zoom).toBeCloseTo(1.4);
    const camera = { ...app.camera };
    stepResidentArrival(app, start + 0.65, 155, true);
    stepResidentArrival(app, start + 2, 155, true);
    expect({ ...app.camera }).toEqual(camera);
    expect(app.residentArrival).toBeNull();
  });

  it('fits the resident between an expanded quest, a guide card and the Korean portrait notice feed', () => {
    const { app, resident } = setup(390, 844);
    app.camera.zoom = 2.8;
    beginResidentArrival(app, resident);
    const panels = [
      { id: 'objectives-panel', bounds: new Rect(86, 104, 292, 210), focusable: false },
      { id: 'guide-card', bounds: new Rect(12, 322, 366, 174), focusable: false },
      { id: 'notice/2', bounds: new Rect(55, 598, 280, 30), focusable: false },
    ];
    stepResidentArrival(app, start, 674, false);
    measureArrivalHud(app.residentArrival!, panels);
    for (const age of [0.72, 1.72]) {
      stepResidentArrival(app, start + age, 674, false);
      const feet = app.camera.toScreen(project(7, 9), 390, 844);
      const head = app.camera.toScreen(project(7, 9, 24), 390, 844);
      expect(head.y).toBeGreaterThan(496);
      expect(feet.y).toBeLessThan(598);
      expect(head.x).toBeCloseTo(195);
    }
  });

  it.each(['command', 'zoom', 'pan', 'selection'])('gives up the rest of the move on %s', (action) => {
    const { app, resident } = setup(900, 640);
    beginResidentArrival(app, resident);
    stepResidentArrival(app, start + 0.2, 410, false);
    if (action === 'command') releaseArrivalCamera(app);
    if (action === 'zoom') app.camera.zoom += 0.3;
    if (action === 'pan') app.pan.x = 1;
    if (action === 'selection') app.chosen = [97];
    const pose = { ...app.camera };
    stepResidentArrival(app, start + 0.3, 410, false);
    app.pan.x = 0;
    stepResidentArrival(app, start + 1, 410, false);
    stepResidentArrival(app, start + 2, 410, false);
    expect({ ...app.camera }).toEqual(pose);
    expect(app.residentArrival).toBeNull();
  });

  it('never resumes a camera move on a replacement town with the same resident id', () => {
    const { app, resident } = setup(900, 640);
    beginResidentArrival(app, resident);
    app.town = { person: () => resident } as unknown as Town;
    const pose = { ...app.camera };
    stepResidentArrival(app, start + 0.6, 410, false);
    expect({ ...app.camera }).toEqual(pose);
    expect(app.residentArrival).toBeNull();
  });

  it('holds the shot on the emerging figure while the simulation sends them to work, then follows them out', () => {
    const { app, resident } = setup(1024, 768);
    beginResidentArrival(app, resident);
    stepResidentArrival(app, start, 590, false);
    resident.position = point(8, 9);
    stepResidentArrival(app, start + 0.68, 590, false);
    expect(app.camera.toScreen(project(7, 9), 1024, 768).x).toBeCloseTo(512);
    resident.position = point(10, 9);
    stepResidentArrival(app, start + 1.72, 590, false);
    expect(app.camera.toScreen(project(10, 9), 1024, 768).x).toBeCloseTo(512);
  });
});
