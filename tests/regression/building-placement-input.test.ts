import { describe, expect, it, vi } from 'vitest';
import { GameAppState } from '../../apps/web/src/native/game-app-state';
import type { GameApp } from '../../apps/web/src/native/game-app';
import { cancelStroke, plan, pointerDown, pointerMove, press, sampleRoad, toScreen } from '../../apps/web/src/native/game-input';
import { confirmTouchPlacement } from '../../apps/web/src/native/game-touch';
import { PointerButton, PreviewKind, Tool } from '../../packages/engine/src/game-tools';
import { Camera, point, project } from '../../packages/engine/src/geometry';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';

function fixture() {
  const map = new WorldMap();
  map.columns = map.rows = 32;
  map.origin = point(16, 16);
  map.tiles = Array.from({ length: 32 * 32 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(65 * 65).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [{ name: 'Cave', kind: DungeonKind.Cave, origin: point(18, 18), discovered: true }];
  map.reveal(16, 16, 100);
  const town = new Town(map, 32, false),
    context = { controlAt: (x: number) => x < 150, pointerMove: vi.fn(), pointerDown: vi.fn() },
    center = project(16, 16),
    app = Object.assign(new GameAppState(town, { pick: () => null } as never, context as never), {
      tool: Tool.Camp,
      freeAngle: Math.PI / 6,
      camera: new Camera(center.x, center.y, 1),
      viewWidth: 640,
      viewHeight: 480,
      pointerMove, press, sampleRoad, cancelStroke, toScreen,
      dismissBuildDrawer: vi.fn(), selectTool: vi.fn(), cueAt: vi.fn(), queueWork: vi.fn(),
    }) as unknown as GameApp;
  return { app, town, context };
}

describe('building placement input', () => {
  it('hides the mouse footprint where the HUD receives the click', () => {
    const { app, town, context } = fixture();
    app.pointerMove(140, 240);
    const hovered = plan.call(app);
    pointerDown.call(app, 140, 240, PointerButton.Primary);
    expect(context.pointerDown).toHaveBeenCalledWith(140, 240);
    expect(town.buildings()).toHaveLength(0);
    expect(hovered.preview.kind).toBe(PreviewKind.None);
  });

  it('shows the current plot reason after a refused click', () => {
    const { app, town } = fixture(),
      blocked = point(9.5, 9.5),
      screen = app.toScreen(blocked);
    pointerDown.call(app, screen.x, screen.y, PointerButton.Primary);
    expect(town.buildings()).toHaveLength(0);
    expect(plan.call(app).problem).not.toBe('');
    app.pointerMove(320, 240);
    const next = plan.call(app);
    expect(next.preview.valid, next.problem).toBe(true);
    expect(app.status || next.problem).toBe('');
  });

  it.each([false, true])('commits the displayed corners after rotation and road alignment (touch: %s)', (touch) => {
    for (const nearRoad of [false, true]) {
      const { app, town } = fixture();
      if (nearRoad) town.network.add([sharpAnchor(point(10, 14)), sharpAnchor(point(23, 16))], 1);
      app.pointerMove(320, 240);
      app.touchMode = touch;
      if (touch) {
        app.touchPlacement = { ...app.cursor };
        app.pointerMove(140, 240);
      }
      const { preview, problem } = plan.call(app);
      expect(preview.valid, problem).toBe(true);
      if (touch) confirmTouchPlacement.call(app);
      else pointerDown.call(app, 320, 240, PointerButton.Primary);
      const placed = town.buildings()[0];
      expect(placed.footprint().corners()).toEqual(preview.outline);
      if (nearRoad) expect(placed.angle).not.toBeCloseTo(app.freeAngle);
      else expect(placed.angle).toBeCloseTo(app.freeAngle);
    }
  });
});
