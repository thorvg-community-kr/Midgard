import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Person, Calling, Role, Race, Activity } from '../../packages/engine/src/person';
import { Camera, Footprint, point, project } from '../../packages/engine/src/geometry';
import { Climate } from '../../packages/engine/src/climate';
import { Traffic } from '../../packages/engine/src/traffic';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { PictureNode, SceneNode, ShapeNode, StaticShapeLayer } from '../../packages/native-renderer/src/paint';
import { MistField, mistTones } from '../../packages/native-renderer/src/mist-bands';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { fitToView } from '../../packages/native-renderer/src/world-ground';
import { updateVision } from '../../packages/native-renderer/src/world-vision';
import { drift } from '../../packages/native-renderer/src/world-weather';
import { cullTrees } from '../../packages/native-renderer/src/world-trees';
import { moveAgents } from '../../packages/native-renderer/src/world-people';
import { registerDepth, sortWorldObjects, viewRect } from '../../packages/native-renderer/src/world-depth';
import { WebCanvasAdapter } from '../../packages/native-renderer/src/webcanvas-adapter';
import { Rect } from '../../packages/native-ui/src/types';

let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', class {});
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
const actor = (at = point(6, 6)) =>
  new Person(0, 'Resident', Role.Resident, Calling.Warrior, Race.Human, 499096, at);
/** A renderer state with a camera on tile (6, 6) and a town holding the given people. */
function world(people: Person[], sight: (p: { x: number; y: number }) => number = () => 255) {
  const s = new WorldRendererState(tvg);
  s.rows = Array.from({ length: 64 }, () => new SceneNode());
  s.currentVisibility.sample = sight;
  const centre = project(6, 6);
  s.view = new Camera(centre.x, centre.y, 1);
  s.viewWidth = 800;
  s.viewHeight = 600;
  const town = {
    people: () => people,
    person: () => null,
    buildings: () => [],
    building: () => null,
    monsters: () => [],
    wildlife: () => [],
    hits: () => [],
    treeEvents: () => [],
    devotionEvents: () => [],
    creatureTarget: () => null,
    animalAsleep: () => false,
    clock: () => 0.2,
    map: () => ({ giant: () => null, volcano: () => null }),
  } as unknown as Town;
  return { s, town, draw: () => (moveAgents(s, town, new Traffic(5), 0.2, []), sortWorldObjects(s)) };
}

describe('the native tree holds only what shows', () => {
  it('leaves a fully transparent child out until it shows, then attaches it', () => {
    const adapter = new WebCanvasAdapter(tvg),
      root = new SceneNode(),
      shown = new ShapeNode().appendRect(0, 0, 4, 4).fill(1, 2, 3),
      tool = new SceneNode().add(new ShapeNode().appendRect(0, 0, 2, 2).fill(4, 5, 6));
    root.add(shown).add(tool);
    tool.opacity(0);
    try {
      adapter.sync(root);
      // The scene and its one visible shape: the hidden tool and its blade were never built.
      expect(adapter.retainedPaintCount).toBe(2);
      tool.opacity(255);
      adapter.sync(root);
      expect(adapter.retainedPaintCount).toBe(4);
      tool.opacity(0);
      adapter.sync(root);
      adapter.collect([root]);
      // Still part of the scene tree, so it is kept ready for the next time it shows.
      expect(adapter.retainedPaintCount).toBe(4);
    } finally {
      adapter.dispose();
    }
  });
  it('reuses static shapes across frames and applies their new parent shade when moved', () => {
    const adapter = new WebCanvasAdapter(tvg),
      fixed = new ShapeNode().appendRect(0, 0, 4, 4).fill(200, 100, 50),
      layer = new StaticShapeLayer([fixed]),
      moving = new ShapeNode().appendRect(5, 0, 2, 2).fill(1, 2, 3),
      root = new SceneNode().add(layer).add(new SceneNode().add(moving)),
      shadow = new SceneNode().shaded({ tone: [0, 0, 0], strength: 127.5 }),
      sync = vi.spyOn(adapter, 'sync'),
      fill = vi.spyOn(tvg.Shape.prototype, 'fill');
    try {
      const nativeLayer = adapter.sync(layer);
      adapter.sync(root);
      sync.mockClear();
      fill.mockClear();
      moving.fill(50, 60, 70);
      adapter.sync(root);
      expect(sync.mock.calls.some(([node]) => node === fixed)).toBe(false);
      expect(fill.mock.calls).toEqual([[50, 60, 70, 255]]);

      root.remove(layer);
      shadow.add(layer);
      adapter.sync(shadow);
      expect(fill).toHaveBeenLastCalledWith(100, 50, 25, 255);
      shadow.remove(layer);
      root.add(layer);
      adapter.sync(root);
      expect(fill).toHaveBeenLastCalledWith(200, 100, 50, 255);
      expect(adapter.sync(layer)).toBe(nativeLayer);
    } finally {
      sync.mockRestore();
      fill.mockRestore();
      adapter.dispose();
    }
  });
  it('sends a shape its style once, not again each time it only moves or fades', () => {
    const adapter = new WebCanvasAdapter(tvg),
      shape = new ShapeNode().appendRect(0, 0, 4, 4).fill(1, 2, 3).strokeFill(9, 9, 9).strokeWidth(1),
      fill = vi.spyOn(tvg.Shape.prototype, 'fill'),
      stroke = vi.spyOn(tvg.Shape.prototype, 'stroke');
    try {
      adapter.sync(shape);
      const fills = fill.mock.calls.length,
        strokes = stroke.mock.calls.length;
      expect(fills).toBeGreaterThan(0);
      shape.translate(5, 5).opacity(120);
      adapter.sync(shape);
      expect(fill.mock.calls.length).toBe(fills);
      expect(stroke.mock.calls.length).toBe(strokes);
      shape.fill(7, 8, 9);
      adapter.sync(shape);
      expect(fill.mock.calls.length).toBe(fills + 1);
    } finally {
      fill.mockRestore();
      stroke.mockRestore();
      adapter.dispose();
    }
  });
});

describe('a shaded scene', () => {
  it('sends its shapes dimmed toward the tone, and plain again once the shade is lifted', () => {
    const adapter = new WebCanvasAdapter(tvg),
      shape = new ShapeNode().appendRect(0, 0, 4, 4).fill(200, 100, 50),
      root = new SceneNode().add(new SceneNode().add(shape)),
      fill = vi.spyOn(tvg.Shape.prototype, 'fill');
    try {
      adapter.sync(root);
      expect(fill.mock.calls.at(-1)).toEqual([200, 100, 50, 255]);
      // Half way to black.
      root.shaded({ tone: [0, 0, 0], strength: 127.5 });
      adapter.sync(root);
      expect(fill.mock.calls.at(-1)).toEqual([100, 50, 25, 255]);
      const sent = fill.mock.calls.length;
      adapter.sync(root);
      expect(fill.mock.calls.length).toBe(sent);
      root.shaded();
      adapter.sync(root);
      expect(fill.mock.calls.at(-1)).toEqual([200, 100, 50, 255]);
    } finally {
      fill.mockRestore();
      adapter.dispose();
    }
  });
  it('lays mist on the ground: one gradient down a shape, dark from the foot down and lighter above the rise', () => {
    const adapter = new WebCanvasAdapter(tvg),
      // A trunk from y 0 down to its foot at y 100.
      shape = new ShapeNode().appendRect(0, 0, 4, 100).fill(200, 100, 50),
      root = new SceneNode().add(shape),
      stops = vi.spyOn(tvg.LinearGradient.prototype, 'addStop');
    try {
      root.shaded({ tone: [0, 0, 0], strength: 255, rise: { foot: 100, height: 60, top: 127.5 } });
      adapter.sync(root);
      const sent = stops.mock.calls.map(([offset, color]) => [offset, ...color]);
      // From the top of the rise, y 40, half way to black, down to the foot, black.
      expect(sent[0]).toEqual([0, 100, 50, 25, 255]);
      expect(sent.at(-1)).toEqual([1, 0, 0, 0, 255]);
      expect(sent.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < sent.length; i++) expect(sent[i][1]).toBeLessThan(sent[i - 1][1]);
    } finally {
      stops.mockRestore();
      adapter.dispose();
    }
  });
});

describe('people outside the picture', () => {
  it('keeps the place of someone off screen without posing or attaching them', () => {
    const far = actor(point(90, 90)),
      { s, draw } = world([far]);
    far.activity = Activity.Fighting;
    far.ready = 1;
    draw();
    const figure = s.figures.get(far.id)!,
      at = project(far.position.x, far.position.y);
    expect(figure.paint.alpha).toBe(0);
    expect([figure.paint.matrix[2], figure.paint.matrix[5]]).toEqual([Math.fround(at.x), Math.fround(at.y)]);
    expect(s.objects.children).not.toContain(figure.paint);
    // No pose was computed: the body still rests where the sprite was built.
    expect(figure.parts.body!.matrix[4]).toBe(1);
    // They walk into view: drawn and posed again, at the new place.
    far.position = point(6, 6);
    draw();
    expect(figure.paint.alpha).toBe(255);
    expect(s.objects.children).toContain(figure.paint);
    expect(figure.parts.body!.matrix[4]).toBeLessThan(1);
  });
  it('treats someone hidden by fog the same way, and brings them back when seen', () => {
    let seen = false;
    const p = actor(),
      { s, draw } = world([p], () => (seen ? 255 : 0));
    draw();
    const figure = s.figures.get(p.id)!;
    expect(figure.paint.alpha).toBe(0);
    expect(s.objects.children).not.toContain(figure.paint);
    p.position = point(6.5, 6);
    draw();
    expect(figure.paint.matrix[2]).toBe(Math.fround(project(6.5, 6).x));
    seen = true;
    draw();
    expect(figure.paint.alpha).toBe(255);
    expect(s.objects.children).toContain(figure.paint);
  });
  it('culls nobody while no camera has been set', () => {
    const far = actor(point(90, 90)),
      { s, draw } = world([far]);
    s.viewWidth = s.viewHeight = 0;
    draw();
    expect(s.figures.get(far.id)!.paint.alpha).toBe(255);
    expect(s.objects.children).toContain(s.figures.get(far.id)!.paint);
  });
});

it('keeps the ground mist and its daylight mask over the same tiles through zoom and travel', () => {
  const state = new WorldRendererState(tvg), town = new Town(WorldMap.generate(5, 64, 64));
  state.viewWidth = 1280;
  state.viewHeight = 720;
  try {
    const views = [[51, 45, 1.4, 1], [51, 45, 0.68, 2], [56, 61, 0.31, 4], [56, 61, 1.4, 1]];
    for (const [second, [x, y, zoom, cell]] of views.entries()) {
      const at = project(x, y);
      state.view = new Camera(at.x, at.y, zoom);
      fitToView(state);
      updateVision(state, town, second);
      const frame = state.mistField!.frame();
      expect(frame.cell).toBe(cell);
      for (const picture of [state.mistPicture!, state.warmPicture]) {
        const [stepX, , left, , stepY, top] = picture.matrix;
        expect([stepX, stepY]).toEqual([cell, cell]);
        // The center of the first pixel is the first tile sample returned by the field.
        expect([left + stepX / 2, top + stepY / 2]).toEqual([frame.x, frame.y]);
      }
    }
  } finally {
    state.dispose();
  }
});

it('prepares cloud puffs within reach of the camera and restores their pose when the camera returns', () => {
  const state = new WorldRendererState(tvg), climate = new Climate();
  state.viewWidth = 390;
  state.viewHeight = 844;
  state.shownShade = 1;
  function visiblePuffs(x: number, y: number, zoom: number, time: number) {
    state.view = new Camera(x, y, zoom);
    drift(state, climate, time);
    const view = viewRect(state), bounds: Rect[] = [];
    for (const cloud of state.cloudShapes.filter(node => node.alpha)) {
      for (const puff of (cloud.children[0] as SceneNode).children as ShapeNode[]) {
        if (!puff.alpha) continue;
        const radius = puff.gradient!.coordinates[2],
          cx = cloud.matrix[2] + puff.matrix[2], cy = cloud.matrix[5] + cloud.matrix[4] * puff.matrix[5],
          rx = radius * puff.matrix[0], ry = radius * cloud.matrix[4] * puff.matrix[4],
          box = new Rect(cx - rx, cy - ry, 2 * rx, 2 * ry), overlap = box.intersect(view);
        expect(overlap.w).toBeGreaterThan(0);
        expect(overlap.h).toBeGreaterThan(0);
        bounds.push(box);
      }
    }
    return bounds;
  }
  try {
    const wide = visiblePuffs(0, 0, 0.65, 17), first = visiblePuffs(0, 0, 1.4, 17);
    const view = viewRect(state);
    expect(first).toEqual(wide.filter(box => {
      const overlap = box.intersect(view);
      return overlap.w > 0 && overlap.h > 0;
    }));
    expect(first.length).toBeGreaterThan(0);
    visiblePuffs(-1050, -240, 1.8, 19);
    visiblePuffs(1700, 3000, 0.45, 37);
    expect(visiblePuffs(0, 0, 1.4, 17)).toEqual(first);
  } finally {
    state.dispose();
  }
});

it('masks cloud shadows with the drawn mist through zoom and fog changes', () => {
  const state = new WorldRendererState(tvg),
    town = new Town(WorldMap.generate(5, 64, 64)),
    at = project(51, 45);
  state.viewWidth = 1280;
  state.viewHeight = 720;
  try {
    state.view = new Camera(at.x, at.y, 1.2);
    fitToView(state);
    updateVision(state, town, 1);
    const mask = state.clouds.masking;
    expect(mask?.method).toBe('inverseAlpha');
    expect(mask?.paint).toBeInstanceOf(SceneNode);
    const layer = mask!.paint as SceneNode, picture = layer.children[0] as PictureNode;
    expect(layer.alpha).toBe(255);
    expect(layer.matrix).toEqual(state.mist.matrix);
    const version = picture.dataVersion;

    state.view = new Camera(at.x + 50, at.y, 0.45);
    fitToView(state);
    updateVision(state, town, 2);
    expect(state.clouds.masking?.paint).toBe(layer);
    expect(picture.source).toBe(state.mistPicture);
    expect(picture.dataVersion).toBeGreaterThan(version);
    expect(picture.matrix).toEqual(state.mistPicture!.matrix);

    state.mistLifted = true;
    updateVision(state, town, 3);
    expect(layer.alpha).toBe(0);
    state.mistLifted = false;
    updateVision(state, town, 4);
    expect(layer.alpha).toBe(255);
  } finally {
    state.dispose();
  }
});

it.each([1.4, 0.45])('keeps scenery ready just outside the screen at zoom %s', (zoom) => {
  const { s } = world([]);
  s.view = new Camera(0, 0, zoom);
  s.rowTrees = [new SceneNode(), new SceneNode()];
  const right = s.viewWidth / 2;
  s.treeBounds = [
    new Rect((right + 32) / zoom, 0, 20, 30),
    new Rect((right + 96) / zoom, 0, 20, 30),
  ];
  cullTrees(s);
  expect(s.rowTrees.map((row) => row.alpha)).toEqual([255, 0]);
});

describe('what stands in the mist', () => {
  /** A tree-like object with its own bounds, standing on a tile. */
  function standing(s: WorldRendererState, x: number, y: number, key: string): SceneNode {
    const node = new SceneNode().add(new ShapeNode().appendRect(-6, -30, 12, 30).fill(20, 90, 40)),
      foot = project(x, y);
    registerDepth(node, point(x, y), key, new Rect(foot.x - 8, foot.y - 32, 16, 34));
    s.rowTrees[0].add(node);
    return node;
  }
  /** One resident at (6, 6) seeing 8.5 tiles; the land is known round them only, or everywhere once scouted. */
  function mist(s: WorldRendererState, scouted: boolean): void {
    const eye = point(6, 6),
      at = project(eye.x, eye.y);
    s.rowTrees = s.rowTrees.length ? s.rowTrees : [new SceneNode()];
    s.fogged = true;
    s.mistField ??= new MistField();
    s.mistField.build({
      sights: [{ center: eye, radius: 8.5 }],
      explored: (x, y) => (scouted || Math.hypot(x - eye.x, y - eye.y) < 9 ? 255 : 0),
      area: { x: -16, y: -16, w: 96, h: 96 },
      view: [at.x - 400, at.y - 300, 800, 600],
      zoom: 1,
      seconds: 0,
    });
    s.mistTick++;
  }
  it('draws a thing in sight plain, and nothing that stands on unknown land', () => {
    const { s } = world([]);
    mist(s, false);
    const near = standing(s, 4, 6, 'tree:near'),
      // Nearer the camera than the eye, twelve tiles off: its top would reach up over known ground.
      far = standing(s, 15, 15, 'tree:far');
    sortWorldObjects(s);
    expect(s.objects.children).toContain(near);
    expect(near.shade).toBeUndefined();
    expect(s.objects.children).not.toContain(far);
    // A scout walks past: the land is remembered, and the same tree appears, standing in the mist.
    mist(s, true);
    sortWorldObjects(s);
    expect(s.objects.children).toContain(far);
    expect(far.shade).toBeDefined();
    expect(near.shade).toBeUndefined();
  });
  it('stands a thing deep in remembered land in the mist up to its knees, not dimmed whole', () => {
    const { s } = world([]);
    mist(s, true);
    // Fourteen tiles from the eye, well past the soft edge of its sight.
    const deep = standing(s, 20, 10, 'tree:deep');
    sortWorldObjects(s);
    // As dark as the ground at its foot (y 480) and below; above the mist's height it keeps 70% of the tint.
    expect(deep.shade).toEqual({ tone: mistTones.veil, strength: 218, rise: { foot: 480, height: 40, top: 153 } });
  });
  it('shows everything plain in the editors and when the mist is lifted', () => {
    const { s } = world([]);
    mist(s, true);
    const far = standing(s, 15, 15, 'tree:far');
    sortWorldObjects(s);
    expect(far.shade).toBeDefined();
    s.mistLifted = true;
    sortWorldObjects(s);
    expect(s.objects.children).toContain(far);
    expect(far.shade).toBeUndefined();
    // Unknown land, in an editor: there is no mist there at all.
    s.mistLifted = false;
    mist(s, false);
    s.editorView = true;
    sortWorldObjects(s);
    expect(s.objects.children).toContain(far);
  });
  it('takes a landmark for seen only where the mist was drawn, and then keeps the bank off its ground', () => {
    const { s } = world([]);
    // All the land is remembered, so the rim of what was drawn is no bank.
    mist(s, true);
    const landmark = (x: number, y: number, key: string) => {
      const node = new SceneNode().add(new ShapeNode().appendRect(-40, -200, 80, 200).fill(150, 150, 150));
      registerDepth(node, new Footprint(point(x, y), 3, 0), key);
      s.rowTrees[0].add(node);
      return node;
    };
    // Far outside the picture: its ground is not in the fields at all.
    landmark(70, 70, 'landmark:far');
    sortWorldObjects(s);
    expect([...s.mistKnown.keys()]).toEqual([]);
    // Beside the eye, on ground in sight.
    const near = landmark(8, 8, 'landmark:near');
    mist(s, true);
    sortWorldObjects(s);
    expect(s.objects.children).toContain(near);
    expect([...s.mistKnown.keys()]).toEqual(['landmark:near']);
  });
  it('lies on the ground under all that stands; cloud shadows fall over everything and over the day light', () => {
    const { s } = world([]),
      order = (layer: SceneNode) => s.world.children.indexOf(layer);
    expect(order(s.mist)).toBeGreaterThan(-1);
    expect(order(s.mist)).toBeLessThan(order(s.objects));
    expect(order(s.clouds)).toBeGreaterThan(order(s.objects));
    expect(order(s.clouds)).toBeGreaterThan(order(s.sunlight));
    expect(order(s.clouds)).toBeLessThan(order(s.darkness));
  });
});
