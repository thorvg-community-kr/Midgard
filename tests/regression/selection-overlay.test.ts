import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { WorldRenderer } from '../../packages/native-renderer/src/world-renderer';
import { SceneNode, ShapeNode } from '../../packages/native-renderer/src/paint';
import { moveAgents } from '../../packages/native-renderer/src/world-people';
import { registerDepth, sortWorldObjects } from '../../packages/native-renderer/src/world-depth';
import type { GroundSelectionMarker } from '../../packages/native-renderer/src/world-picking-types';
import { Person, Role, Calling, Race } from '../../packages/engine/src/person';
import { Camera, point, project } from '../../packages/engine/src/geometry';
import { Traffic } from '../../packages/engine/src/traffic';
import type { Town } from '../../packages/engine/src/town';
import { AnimalKind, Monster } from '../../packages/engine/src/person';
import { Order, Tool } from '../../packages/engine/src/game-tools';
import { objectSelectionOverlay } from '../../apps/web/src/native/selection-overlay';
import { issueOrder, targetingCursor, type GameCommandApp } from '../../apps/web/src/native/game-commands';
import { presentedHit } from './fixtures/presented-hit';
import type { WorldObjectKind } from '../../packages/native-renderer/src/world-picking-types';

class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  pixels: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    return {
      putImageData: (image: Pixels) => (this.pixels = image.data.slice()),
      clearRect: () => this.pixels.fill(0),
    };
  }
}
let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({
    renderer: 'sw',
    locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
  });
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});

function fixture(dpr = 1) {
  const width = 320,
    height = 240,
    target = new MemoryCanvas(width * dpr, height * dpr),
    canvas = new tvg.Canvas(target as any, {
      width: width * dpr,
      height: height * dpr,
      enableDevicePixelRatio: false,
    }),
    state = new WorldRenderer(tvg),
    p = new Person(7, 'Selected settler', Role.Resident, Calling.Settler, Race.Human, 499096, point(10, 10)),
    people = [p],
    traffic = new Traffic(5);
  let visible = true;
  const at = project(p.position.x, p.position.y),
    occluder = new ShapeNode().appendRect(at.x - 100, at.y - 100, 200, 200).fill(49, 64, 52);
  registerDepth(occluder, point(11, 11), 'foreground-building');
  const restoreRows = () => {
    state.rows = Array.from({ length: 40 }, () => new SceneNode());
    state.rowBuildings = [new SceneNode().add(occluder)];
    state.currentVisibility.sample = () => (visible ? 255 : 0);
  };
  restoreRows();
  state.background.appendRect(0, 0, width, height).fill(102, 119, 95);
  state.viewWidth = width;
  state.viewHeight = height;
  state.root.transform([dpr, 0, 0, 0, dpr, 0, 0, 0, 1]);
  state.view = new Camera(at.x, at.y - 8, 4);
  const town = {
    people: () => people,
    buildings: () => [],
    building: () => null,
    monsters: () => [],
    wildlife: () => [],
    hits: () => [],
    clock: () => 1,
    map: () => ({ giant: () => null, volcano: () => null }),
  } as unknown as Town;
  canvas.add(state.scene());
  return {
    state,
    p,
    people,
    target,
    occluder,
    dpr,
    reset: () => {
      state.invalidateMap();
      restoreRows();
    },
    setVisible: (value: boolean) => {
      visible = value;
    },
    draw: (selected: readonly number[], hiddenBodies: readonly number[] = []) => {
      const c = state.view;
      state.world.transform([
        c.zoom,
        0,
        width / 2 - c.x * c.zoom,
        0,
        c.zoom,
        height / 2 - c.y * c.zoom,
        0,
        0,
        1,
      ]);
      moveAgents(state, town, traffic, 1, selected);
      sortWorldObjects(state);
      state.scene();
      // Match WorldRenderer.update: retain the live root and independently cached figures.
      state.adapter.collect([state.root, ...[...state.figures.values()].map((figure) => figure.paint)]);
      const markers: GroundSelectionMarker[] = selected.map((id) => ({
        key: `person:${id}`,
        kind: 'person',
        hover: false,
      }));
      state.setGroundSelection(markers);
      // Hide only the painted bodies after marker preparation to obtain a ground-ring raster oracle.
      for (const id of hiddenBodies) state.figures.get(id)?.paint.opacity(0);
      if (hiddenBodies.length) state.scene();
      canvas.update().render();
      return target.pixels.slice();
    },
    capture: (name: string) => {
      if (!process.env.CAPTURE_VISUALS) return;
      mkdirSync('artifacts/selection-overlay', { recursive: true });
      writeFileSync(`artifacts/selection-overlay/${name}-${width}x${height}.rgba`, target.pixels);
    },
    dispose: () => {
      canvas.remove();
      state.dispose();
      canvas.destroy();
    },
  };
}
it('paints rings beneath their own unit, another unit and foreground world objects', () => {
  const view = fixture();
  try {
    view.occluder.opacity(0);
    view.state.background.opacity(0);
    const other = new Person(
      8,
      'Nearby settler',
      Role.Resident,
      Calling.Settler,
      Race.Human,
      899504,
      point(10.13, 10.13),
    );
    view.people.push(other);
    const ownBody = view.draw([], [other.id]),
      otherBody = view.draw([], [view.p.id]),
      plain = view.draw([]),
      selected = view.draw([view.p.id]),
      ringOnly = view.draw([view.p.id], [view.p.id, other.id]);
    expect(selected).not.toEqual(plain);
    for (const [name, body] of [
      ['selected', ownBody],
      ['nearby', otherBody],
    ] as const) {
      let overlaps = 0;
      for (let offset = 0; offset < body.length; offset += 4) {
        if (body[offset + 3] !== 255 || ringOnly[offset + 3] < 32) continue;
        overlaps++;
        expect([...selected.slice(offset, offset + 4)], `${name} body must cover the ring`).toEqual([
          ...plain.slice(offset, offset + 4),
        ]);
      }
      expect(overlaps, `${name} fixture must actually cross the painted ring`).toBeGreaterThan(0);
    }
    view.occluder.opacity(255);
    const covered = view.draw([]);
    expect(view.draw([view.p.id])).toEqual(covered);
    expect(view.state.world.children.indexOf(view.state.selection)).toBeLessThan(
      view.state.world.children.indexOf(view.state.objects),
    );
  } finally {
    view.dispose();
  }
});

it.each([1, 1.75])('follows current feet and camera without a presented-frame lag at DPR %s', (dpr) => {
  const view = fixture(dpr);
  try {
    view.occluder.opacity(0);
    view.draw([view.p.id]);
    const group = view.state.selection.children[0];
    for (const [zoom, x, y] of [
      [4, 10.2, 9.9],
      [2.3, 10.4, 9.8],
      [1.1, 10.6, 9.7],
    ]) {
      view.p.position = point(x, y);
      view.state.view.zoom = zoom;
      view.state.view.x += 3;
      view.state.view.y += 2;
      view.state.invalidatePresentation();
      view.draw([view.p.id]);
      expect(view.state.selection.children[0]).toBe(group);
      expect(group).toBeInstanceOf(SceneNode);
      if (!(group instanceof SceneNode)) throw new Error('Missing retained marker');
      const edge = group.children[1];
      if (!(edge instanceof ShapeNode)) throw new Error('Missing marker stroke');
      const expected = view.state.view.toScreen(project(view.p.position.x, view.p.position.y), 320, 240),
        ellipse = edge.commands.find((command) => command[0] === 'E');
      expect(ellipse?.[1]).toBeCloseTo(expected.x, 4);
      expect(ellipse?.[2]).toBeCloseTo(expected.y, 4);
      expect(edge.width).toBe(1.5);
      const bounds = view.state.adapter.renderedBounds(edge)!;
      expect((bounds.x + bounds.w / 2) / dpr).toBeCloseTo(expected.x, 1);
      expect((bounds.y + bounds.h / 2) / dpr).toBeCloseTo(expected.y, 1);
    }
  } finally {
    view.dispose();
  }
});

it('retires native selection paints through repeated select, clear and map reset', () => {
  const view = fixture();
  try {
    view.occluder.opacity(0);
    view.draw([]);
    let baseline = view.state.adapter.retainedPaintCount;
    for (let i = 0; i < 20; i++) {
      view.draw([view.p.id]);
      expect(view.state.adapter.retainedPaintCount).toBe(baseline + 3);
      view.draw([]);
      expect(view.state.selection.children).toHaveLength(0);
      expect(view.state.adapter.retainedPaintCount).toBe(baseline);
      if (i % 5 === 4) {
        view.reset();
        view.draw([]);
        baseline = view.state.adapter.retainedPaintCount;
      }
    }
  } finally {
    view.dispose();
  }
});
it('keeps figure alpha authoritative through fog and doorway transitions', () => {
  const view = fixture();
  try {
    view.draw([view.p.id]);
    expect(view.state.figures.get(view.p.id)!.paint.alpha).toBe(255);
    expect(view.state.selection.children).toHaveLength(1);
    view.setVisible(false);
    view.draw([view.p.id]);
    expect(view.state.figures.get(view.p.id)!.paint.alpha).toBe(0);
    expect(view.state.selection.children).toHaveLength(0);
    view.setVisible(true);
    view.p.inside = true;
    view.p.doorway = 1;
    view.draw([view.p.id]);
    expect(view.state.figures.get(view.p.id)!.paint.alpha).toBe(0);
    expect(view.state.selection.children).toHaveLength(0);
    view.p.doorway = 0.5;
    view.draw([view.p.id]);
    expect(view.state.figures.get(view.p.id)!.paint.alpha).toBeGreaterThan(0);
    expect(view.state.figures.get(view.p.id)!.paint.alpha).toBeLessThan(255);
    const marker = view.state.selection.children[0];
    if (!(marker instanceof SceneNode) || !(marker.children[1] instanceof ShapeNode))
      throw new Error('Missing faded ring');
    expect(marker.children[1].strokeColor?.[3]).toBe(view.state.figures.get(view.p.id)!.paint.alpha);
  } finally {
    view.dispose();
  }
});

it('keeps stress recovery and neutral affiliation indicators tied to the actual visible figure', () => {
  const view = fixture();
  try {
    view.occluder.opacity(0);
    view.draw([]);
    const figure = view.state.figures.get(view.p.id)!;
    expect(figure.parts.stressRecovery!.alpha).toBe(0);
    expect(figure.parts.affiliation!.alpha).toBe(0);
    view.p.stressRecovery = true;
    view.draw([]);
    expect(figure.parts.stressRecovery!.alpha).toBe(255);
    expect(figure.parts.alert!.alpha).toBe(0);
    view.p.faction = 3;
    view.draw([]);
    expect(figure.parts.affiliation!.alpha).toBe(255);
    view.setVisible(false);
    view.draw([]);
    expect(figure.paint.alpha).toBe(0);
    view.p.stressRecovery = false;
    view.p.faction = 0;
    view.setVisible(true);
    view.draw([]);
    expect(figure.parts.stressRecovery!.alpha).toBe(0);
    expect(figure.parts.affiliation!.alpha).toBe(0);
  } finally {
    view.dispose();
  }
});

/** Two companions (0 selected), a stranger, a cow and a monster, with the cursor on whatever `hit` names. */
function aiming(kind?: WorldObjectKind, id = 0) {
  const person = (n: number, name: string) =>
      new Person(n, name, Role.Resident, Calling.Settler, Race.Human, 5, point(10, 10)),
    people = [person(0, 'Selected'), person(1, 'Companion'), person(2, 'Stranger')],
    cow = new Monster(10, -1, point(12, 12)),
    monster = new Monster(11, -1, point(13, 12)),
    markers: GroundSelectionMarker[][] = [],
    plates: string[] = [];
  people[2].faction = 1;
  cow.animal = AnimalKind.Cow;
  const town = {
    person: (n: number) => people[n] ?? null,
    creature: (n: number) => (n === 10 ? cow : n === 11 ? monster : null),
    building: () => ({ kind: 0 }),
    buildings: () => [],
    map: () => ({ width: () => 40, inside: () => false }),
    orderAttack: vi.fn(() => true),
    orderAttackPerson: vi.fn(),
    orderAttackMove: vi.fn(),
    approachOrder: vi.fn(),
  };
  const app = {
    chosen: [0],
    mouse: point(50, 50),
    cursor: point(12, 12),
    viewWidth: 320,
    viewHeight: 240,
    tool: Tool.Select,
    pending: Order.Attack,
    touchMode: false,
    boxFrom: null,
    panFrom: null,
    dockBounds: null,
    guide: { card: null, logOpen: false },
    hoveredWorldTarget: { screen: point(50, 50), hit: kind ? presentedHit(kind, id) : null },
    town,
    cue: vi.fn(),
    context: {
      controlAt: () => false,
      textWidth: (text: string) => text.length * 6,
      elideText: (text: string) => text,
      rect: () => {},
      text: (_bounds: unknown, label: string) => plates.push(label),
    },
    renderer: {
      selectionGeometry: () => presentedHit('person', 0).geometry,
      setGroundSelection: (list: GroundSelectionMarker[]) => markers.push(list),
    },
  } as unknown as GameCommandApp;
  app.targetingCursor = targetingCursor.bind(app);
  const marks = () => {
    objectSelectionOverlay(app);
    return markers.at(-1)!.map((m) => [m.key, m.hover]);
  };
  return { app, town, marks, plates };
}
it.each([
  ['monster', 11, 'Monster'],
  ['animal', 10, 'Cow'],
  ['person', 2, 'Stranger'],
] as const)('an aimed attack marks the %s under the cursor as a hovered unit, beside the selection', (kind, id, name) => {
  const view = aiming(kind, id);
  expect(view.marks()).toEqual([
    ['person:0', false],
    [`${kind}:${id}`, true],
  ]);
  expect(view.plates).toEqual(['Selected', name]);
});
it('an aimed attack marks nothing a click would not strike', () => {
  for (const [kind, id] of [
    ['person', 1],
    ['tree', 5],
    ['rock', 5],
    ['building', 3],
    ['field', 2],
  ] as const)
    expect(aiming(kind, id).marks(), kind).toEqual([['person:0', false]]);
  expect(aiming().marks()).toEqual([['person:0', false]]);
});
it('marks the unit under the cursor only while the attack is aimed with a mouse over the world', () => {
  const view = aiming('monster', 11);
  view.app.pending = Order.None;
  expect(view.marks()).toEqual([['person:0', false]]);
  view.app.pending = Order.Move;
  expect(view.marks()).toEqual([['person:0', false]]);
  view.app.pending = Order.Attack;
  view.app.touchMode = true;
  expect(view.marks()).toEqual([['person:0', false]]);
  view.app.touchMode = false;
  (view.app.context as any).controlAt = () => true;
  expect(view.marks()).toEqual([['person:0', false]]);
});
it('the click strikes exactly the unit the aim marked', () => {
  const stranger = aiming('person', 2);
  issueOrder.call(stranger.app, Order.Attack);
  expect(stranger.town.orderAttackPerson).toHaveBeenCalledWith([0], 2);
  const cow = aiming('animal', 10);
  issueOrder.call(cow.app, Order.Attack);
  expect(cow.town.orderAttack).toHaveBeenCalledWith([0], 10);
  const companion = aiming('person', 1);
  issueOrder.call(companion.app, Order.Attack);
  expect(companion.town.orderAttackMove).toHaveBeenCalledWith([0], companion.app.cursor);
  expect(companion.town.orderAttackPerson).not.toHaveBeenCalled();
});
