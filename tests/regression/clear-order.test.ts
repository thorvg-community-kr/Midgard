import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Rect } from '../../packages/native-ui/src';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { Activity, Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { Camera, point, project, type Outline } from '../../packages/engine/src/geometry';
import { Field } from '../../packages/engine/src/town-models';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { Tool } from '../../packages/engine/src/game-tools';
import { canClear, clearMarkOf, keepClear, markClear } from '../../packages/engine/src/town-clearing';
import { GameAppState } from '../../apps/web/src/native/game-app-state';
import { inspector } from '../../apps/web/src/native/game-hud';
import { worldObjectPanel } from '../../apps/web/src/native/game-selection-panel';
import { rememberCrew } from '../../apps/web/src/native/clear-order-hud';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';
import { press } from '../../apps/web/src/native/game-input';
import { Traffic } from '../../packages/engine/src/traffic';
import { addInventory } from '../../packages/engine/src/equipment';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { SceneNode } from '../../packages/native-renderer/src/paint';
import { moveAgents } from '../../packages/native-renderer/src/world-people';
import { syncVisuals } from '../../packages/native-renderer/src/world-objects';
import { animate } from '../../packages/native-renderer/src/world-animation';

function world(): Town {
  const map = new WorldMap();
  map.columns = map.rows = 40;
  map.mapSeed = 5;
  map.origin = point(20, 20);
  map.tiles = Array.from({ length: 1600 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(81 * 81).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.stream.path = [point(26, 0), point(26, 40)];
  map.stream.width = [2, 2];
  for (let y = 0; y < 40; y++) for (let x = 25; x <= 26; x++) map.at(x, y).terrain = Terrain.Water;
  map.sites = [{ name: 'Test cave', kind: DungeonKind.Cave, origin: point(16, 16), discovered: true }];
  map.reveal(20, 20, 100);
  const town = new Town(map, 40, false);
  expect(town.place(Structure.Camp, point(20, 20), 0), town.canPlace(Structure.Camp, point(20, 20), 0).reason).toBe(true);
  town.completeConstruction();
  town.stock().add(new Resources(500, 500, 500, 100));
  town.folk = [];
  town.animals = [];
  town.beasts = [];
  return town;
}
function resident(town: Town, id: number, at = point(22, 23), auto = false): Person {
  const p = new Person(id, 'Res' + id, Role.Resident, Calling.Settler, Race.Human, 5 + id, at);
  p.home = p.village = town.camp()!.id;
  p.food = p.hydration = p.rest = p.health = 1;
  p.autoMode = auto;
  town.folk.push(p);
  town.nextPerson = Math.max(town.nextPerson, id + 1);
  return p;
}
function tent(town: Town, at = point(22.5, 16.5), built = true) {
  expect(town.place(Structure.Tent, at, 0), town.canPlace(Structure.Tent, at, 0).reason).toBe(true);
  const b = town.buildings().at(-1)!;
  if (built) b.progress = 1;
  return b;
}
function plot(town: Town, outline: Outline): Field {
  const field = new Field(town.nextId++, outline, town.camp()!.id);
  town.farmland.push(field);
  return field;
}
function run(town: Town, seconds: number, until: () => boolean = () => false): void {
  for (let s = 0; s < seconds * 10 && !until(); ++s) town.tick(0.1);
}

describe('clearing through residents', () => {
  it('selected residents walk over and tear a finished building down', () => {
    const town = world(),
      a = resident(town, 0),
      b = tent(town);
    const result = markClear(town, 'building', b.id, [a.id]);
    expect(result.check.ok).toBe(true);
    expect(result.mark!.crew).toEqual([a.id]);
    expect(town.building(b.id)).not.toBeNull();
    run(town, 120, () => !town.building(b.id));
    expect(town.building(b.id)).toBeNull();
    expect(a.clearing).toBe(-1);
    expect(clearMarkOf(town, 'building', b.id)).toBeNull();
  });
  it('without a selection the nearest free residents on Auto take the job', () => {
    const town = world(),
      near = resident(town, 0, point(23, 22), true),
      far = resident(town, 1, point(10, 30), true),
      busy = resident(town, 2, point(23, 21), false),
      b = tent(town);
    const mark = markClear(town, 'building', b.id).mark!;
    expect(mark.crew).toContain(near.id);
    expect(mark.crew).not.toContain(busy.id);
    expect(mark.crew.length).toBeLessThanOrEqual(3);
    void far;
    run(town, 120, () => !town.building(b.id));
    expect(town.building(b.id)).toBeNull();
    expect(near.autoMode).toBe(true);
  });
  it('fields and roads are torn down the same way', () => {
    const town = world(),
      a = resident(town, 0);
    const outline = [point(14, 24), point(17, 24), point(17, 27), point(14, 27)];
    const field = plot(town, outline);
    markClear(town, 'field', field.id, [a.id]);
    run(town, 120, () => !town.field(field.id));
    expect(town.field(field.id)).toBeNull();
    const path = [sharpAnchor(point(21.2, 20)), sharpAnchor(point(24.4, 20))];
    expect(town.buildRoad(path), town.canBuildRoad(path).reason).toBe(true);
    const road = town.network.list.at(-1)!;
    road.built = 1;
    markClear(town, 'road', road.id, [a.id]);
    run(town, 120, () => !town.network.road(road.id));
    expect(town.network.road(road.id)).toBeNull();
  });
  it('an empty blueprint goes at once', () => {
    const town = world(),
      b = tent(town, point(22.5, 16.5), false);
    b.progress = 0;
    const result = markClear(town, 'building', b.id);
    expect(result.removed).toBe(true);
    expect(town.building(b.id)).toBeNull();
  });
  it('Keep it lifts the mark and lets the crew go', () => {
    const town = world(),
      a = resident(town, 0, point(22, 23), true),
      b = tent(town);
    markClear(town, 'building', b.id, [a.id]);
    expect(a.autoMode).toBe(false);
    run(town, 1);
    expect(keepClear(town, 'building', b.id)).toBe(true);
    expect(clearMarkOf(town, 'building', b.id)).toBeNull();
    expect(a.clearing).toBe(-1);
    expect(a.autoMode).toBe(true);
    run(town, 60);
    expect(town.building(b.id)).not.toBeNull();
  });
  it('another order takes the resident off the job', () => {
    const town = world(),
      a = resident(town, 0),
      b = tent(town);
    markClear(town, 'building', b.id, [a.id]);
    town.orderMove([a.id], point(15, 15));
    run(town, 1);
    expect(clearMarkOf(town, 'building', b.id)!.crew).toEqual([]);
  });
  it('refuses the seat, a neutral building and a station in use, with reasons', () => {
    const town = world();
    expect(canClear(town, 'building', town.camp()!.id).reason).toBe('The seat of the settlement stays');
    const other = tent(town);
    other.faction = 2;
    expect(canClear(town, 'building', other.id).reason).toBe('This building belongs to a neutral settlement');
    const bench = tent(town, point(17, 17));
    bench.kind = Structure.Workbench;
    const smith = resident(town, 0);
    smith.craftWorkshop = bench.id;
    smith.craftItem = 'axe';
    expect(canClear(town, 'building', bench.id).reason).toBe('Someone is working at this station');
    expect(markClear(town, 'building', bench.id).mark).toBeNull();
  });
});

let tvg: ThorVGNamespace;
class Pixels {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
}
class MemoryCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    return { putImageData() {}, clearRect() {} };
  }
}
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({ renderer: 'sw', locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}` });
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});

const observedStates: WorldRendererState[] = [];
afterEach(() => {
  for (const state of observedStates.splice(0)) state.adapter.dispose();
});
function observeResident(town: Town, p: Person) {
  const state = new WorldRendererState(tvg),
    traffic = new Traffic(town.map().seed());
  observedStates.push(state);
  state.rows = Array.from({ length: 80 }, () => new SceneNode());
  state.currentVisibility.sample = () => 255;
  return () => {
    moveAgents(state, town, traffic, town.clock(), []);
    return state.figures.get(p.id)!;
  };
}
describe('activities as seen in the world', () => {
  it.each([0.6, 1])('dismantles what stands at progress %s and restores it smoothly after Keep', (progress) => {
    const town = world(),
      site = tent(town),
      worker = resident(town, 0),
      state = new WorldRendererState(tvg);
    observedStates.push(state);
    site.progress = progress;
    syncVisuals(state, town, 0);
    animate(state, town, 0);
    animate(state, town, 8);
    const visual = state.visuals.get(site.id)!,
      start = visual.frame,
      full = visual.picture.currentFrame,
      mark = markClear(town, 'building', site.id, [worker.id]).mark!;
    run(town, 120, () => mark.done >= 0.55);
    expect(mark.done).toBeGreaterThanOrEqual(0.55);
    animate(state, town, 8 + town.clock());
    expect(visual.picture.currentFrame).toBeCloseTo(start * (1 - mark.done), 4);
    expect(visual.picture.currentFrame).toBeLessThan(full);
    keepClear(town, 'building', site.id);
    const stripped = visual.frame;
    animate(state, town, 8 + town.clock() + 0.01);
    expect(visual.frame).toBeGreaterThan(stripped);
    expect(visual.frame).toBeLessThan(start);
    animate(state, town, 16 + town.clock());
    expect(visual.picture.currentFrame).toBe(full);
  });
  it('takes up a real mallet on reaching demolition work and puts it away when the job is cancelled', () => {
    const town = world(),
      p = resident(town, 0),
      site = tent(town),
      see = observeResident(town, p);
    addInventory(p, 'wooden-mallet');
    const mark = markClear(town, 'building', site.id, [p.id]).mark!;
    expect(p.moving()).toBe(true);
    expect(see().parts.hammer!.alpha).toBe(0);
    for (let i = 0; i < 400 && mark.done === 0; i++) town.advance(0.05);
    expect(mark.done).toBeGreaterThan(0);
    const worker = see();
    expect(worker.parts.hammer!.alpha).toBe(255);
    expect(worker.parts.toolHeads.hammer!.wood.alpha).toBe(255);
    const before = worker.parts.arms[1].turn.elbow;
    town.advance(0.25);
    expect(see().parts.arms[1].turn.elbow).not.toBeCloseTo(before, 3);
    keepClear(town, 'building', site.id);
    expect(see().parts.hammer!.alpha).toBe(0);
    expect(worker.parts.soilDust!.alpha).toBe(0);
  });
  it('serves food at the door and water at the well, with empty hands on approach and indoors', () => {
    const town = world(),
      p = resident(town, 0, point(21, 23), true),
      see = observeResident(town, p);
    p.calling = Calling.Bard;
    p.inventory[0] = { item: 'wooden-sword', quantity: 1 };
    p.equipment.weapon = 1;
    const well = tent(town);
    well.kind = Structure.Well;
    p.food = 0.1;
    const eaten = town.economy(p.village).today.eaten;
    expect(town.eat(p)).toBe(true);
    expect(see().parts.bread!.alpha).toBe(0);
    for (let i = 0; i < 400 && p.food < 0.9; ++i) town.advance(0.05);
    const diner = see().parts;
    expect(diner.bread!.alpha).toBe(255);
    expect(diner.sword!.alpha).toBe(0);
    expect(town.economy(p.village).today.eaten).toBe(eaten + 1);
    p.hydration = 0.1;
    expect(town.drink(p)).toBe(true);
    expect(see().parts.bread!.alpha).toBe(0);
    expect(diner.cup!.alpha).toBe(0);
    for (let i = 0; i < 400 && p.hydration < 0.9; ++i) town.advance(0.05);
    expect(see().parts.cup!.alpha).toBe(255);
    expect(diner.sword!.alpha).toBe(0);
    expect(diner.luteHeld!.alpha).toBe(0);
    p.inside = true;
    for (const doorway of [0.4, 1]) {
      p.doorway = doorway;
      expect(see().parts.cup!.alpha).toBe(0);
      expect(diner.bread!.alpha).toBe(0);
    }
    p.inside = false;
    p.doorway = 0;
    town.orderMove([p.id], point(20, 24));
    expect(see().parts.cup!.alpha).toBe(0);
  });
});
type TestApp = GameHudApp & GameAppState;
function hud(width = 1024, height = 768) {
  const memory = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(memory as never, { width, height, enableDevicePixelRatio: false });
  for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  const metrics = Object.fromEntries(
      ['DejaVuSans', 'DejaVuSans-Bold'].map((font) => [
        font,
        parseFontMetrics(new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`))),
      ]),
    ),
    context = new Context(tvg, metrics),
    town = world();
  const renderer = { visible: () => true, invalidatePresentation: vi.fn(), pick: () => null },
    app = new GameAppState(town, renderer as never, context) as TestApp;
  app.viewWidth = width;
  app.viewHeight = height;
  const focus = project(20, 20);
  app.camera = new Camera(focus.x, focus.y, 1.6);
  app.reducedMotion = () => true;
  const controls = vi.spyOn(context, 'control'),
    labels = vi.spyOn(context, 'text');
  canvas.add(context.scene());
  const panel = new Rect(16, 60, Math.min(420, width - 32), height - 120);
  return {
    app,
    town,
    controls,
    text: () => labels.mock.calls.map((call) => String(call[1])),
    control: (id: string) => controls.mock.calls.find((call) => call[0] === id),
    draw(fn: () => void) {
      controls.mockClear();
      labels.mockClear();
      context.begin(app.theme, new Rect(0, 0, width, height), 1);
      fn();
      context.end();
      canvas.update().render();
    },
    building: () => inspector.call(app, panel),
    objects: () => worldObjectPanel.call(app, panel),
    click(id: string) {
      const found = controls.mock.calls.find((call) => call[0] === id);
      if (!found) throw new Error(`Missing control ${id}`);
      const r = found[1];
      context.pointerMove(r.x + r.w / 2, r.y + r.h / 2);
      context.pointerDown(r.x + r.w / 2, r.y + r.h / 2);
      context.pointerUp(r.x + r.w / 2, r.y + r.h / 2);
    },
    dispose() {
      canvas.remove();
      context.dispose();
      app.campResources.dispose();
      canvas.destroy();
    },
  };
}

describe('the Clear button in the inspector', () => {
  it('a finished building asks twice, then marks it and shows the crew and Keep it', () => {
    const ui = hud();
    try {
      const { app, town } = ui,
        a = resident(town, 0),
        b = tent(town);
      rememberCrew(app, [a.id]);
      app.selected = b.id;
      ui.draw(ui.building);
      expect(ui.text()).toContain('Clear it');
      ui.click('clear-target');
      expect(clearMarkOf(town, 'building', b.id)).toBeNull();
      ui.draw(ui.building);
      expect(ui.text()).toContain('Press again to clear');
      ui.click('clear-target');
      const mark = clearMarkOf(town, 'building', b.id)!;
      expect(mark.crew).toEqual([a.id]);
      ui.draw(ui.building);
      expect(ui.text()).toContain('Tearing it down: Res0');
      expect(ui.text().some((t) => t.startsWith('Marked for clearing'))).toBe(true);
      ui.click('clear-keep');
      expect(clearMarkOf(town, 'building', b.id)).toBeNull();
    } finally {
      ui.dispose();
    }
  });
  it('an empty blueprint is removed on the first press', () => {
    const ui = hud();
    try {
      const { app, town } = ui,
        b = tent(town, point(22.5, 16.5), false);
      b.progress = 0;
      app.selected = b.id;
      ui.draw(ui.building);
      ui.click('clear-target');
      expect(town.building(b.id)).toBeNull();
    } finally {
      ui.dispose();
    }
  });
  it('the seat shows the button disabled with the reason', () => {
    const ui = hud();
    try {
      ui.app.selected = ui.town.camp()!.id;
      ui.draw(ui.building);
      const found = ui.control('clear-target');
      expect(found).toBeDefined();
      expect(ui.text()).toContain('The seat of the settlement stays');
      ui.click('clear-target');
      expect(ui.town.camp()).not.toBeNull();
    } finally {
      ui.dispose();
    }
  });
  it('fields and roads show it in the object panel', () => {
    const ui = hud();
    try {
      const { app, town } = ui,
        a = resident(town, 0);
      const outline = [point(14, 24), point(17, 24), point(17, 27), point(14, 27)];
      const field = plot(town, outline);
      app.selectedObjects = [{ kind: 'field', id: field.id }];
      app.renderer.selectionGeometry = () => ({ bounds: { x: 0, y: 0, w: 10, h: 10 } }) as never;
      rememberCrew(app, [a.id]);
      ui.draw(ui.objects);
      ui.click('clear-target');
      ui.draw(ui.objects);
      ui.click('clear-target');
      expect(clearMarkOf(town, 'field', field.id)!.crew).toEqual([a.id]);
      const path = [sharpAnchor(point(21.2, 20)), sharpAnchor(point(24.4, 20))];
      expect(town.buildRoad(path)).toBe(true);
      const road = town.network.list.at(-1)!;
      app.selectedObjects = [{ kind: 'road', id: road.id }];
      ui.draw(ui.objects);
      expect(ui.control('clear-target')).toBeDefined();
    } finally {
      ui.dispose();
    }
  });
  it('touch: a full-size target at 390 wide', () => {
    const ui = hud(390, 844);
    try {
      const { app, town } = ui,
        b = tent(town);
      app.touchMode = true;
      app.selected = b.id;
      ui.draw(ui.building);
      const r = ui.control('clear-target')![1];
      expect(r.h).toBeGreaterThanOrEqual(44);
      expect(r.x + r.w).toBeLessThanOrEqual(390);
    } finally {
      ui.dispose();
    }
  });
  it('the Clear tool marks through the same path instead of removing at once', () => {
    const ui = hud();
    try {
      const { app, town } = ui,
        a = resident(town, 0),
        b = tent(town);
      app.tool = Tool.Demolish;
      app.crew = [a.id];
      app.cursor = { ...b.center };
      const game = app as unknown as Parameters<typeof press>[0] & { cueAt: () => void };
      game.cueAt = vi.fn();
      press.call(game);
      expect(town.building(b.id)).not.toBeNull();
      expect(clearMarkOf(town, 'building', b.id)?.crew).toEqual([a.id]);
    } finally {
      ui.dispose();
    }
  });
});
