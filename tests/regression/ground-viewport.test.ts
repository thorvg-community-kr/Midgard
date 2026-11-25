import { describe, expect, it, vi } from 'vitest';
import { unproject } from '../../packages/engine/src/geometry';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer } from '../../packages/engine/src/world-types';
import { groundContours } from '../../packages/native-renderer/src/ground-contours';
import { GroundViewport } from '../../packages/native-renderer/src/ground-viewport';
import { Rings } from '../../packages/native-renderer/src/outline-rings';
import { SceneNode, ShapeNode, type Command } from '../../packages/native-renderer/src/paint';
import { Rect } from '../../packages/native-ui/src/types';

function rings(commands: readonly Command[]): Rings {
  const result = new Rings();
  for (const cmd of commands) {
    if (cmd[0] === 'M' || cmd[0] === 'L') result.corner(cmd[1], cmd[2]);
    else if (cmd[0] === 'Z') result.close();
  }
  return result;
}

describe('the map ground in view', () => {
  it('retains the small island and restores full detail when zooming at the same position', () => {
    const shape = new ShapeNode();
    for (let i = 0; i < 100; i++) {
      const p = unproject(i, 4 * Math.sin(i / 14));
      if (i === 0) shape.moveTo(p.x, p.y);
      else shape.lineTo(p.x, p.y);
    }
    shape.lineTo(0, 3).close();
    const island = unproject(-12, 2);
    shape.moveTo(island.x, island.y).lineTo(island.x + 0.02, island.y).lineTo(island.x, island.y + 0.02).close();
    const original = shape.commands, ground = new GroundViewport(new SceneNode().add(shape));
    const view = new Rect(-200, -200, 400, 400);
    ground.update(view, undefined, 0.45);
    expect(shape.commands.length).toBeLessThan(original.length / 2);
    expect(shape.commands.slice(-4)).toEqual(original.slice(-4));
    const overview = shape.commands;
    ground.update(view, undefined, 1.4);
    expect(shape.commands).toBe(original);
    ground.update(view, undefined, 0.45);
    expect(shape.commands).toBe(overview);
  });

  it('keeps islands, holes and enclosing coastlines intact across camera moves and zooms', () => {
    const shape = new ShapeNode();
    for (const [cx, radius, winding] of [
      [0, 950, 1],
      [20, 185, -1],
      [1360, 130, 1],
    ]) {
      for (let i = 0; i < 96; ++i) {
        const a = (winding * Math.PI * 2 * i) / 96,
          r = radius * (1 + 0.28 * Math.cos(7 * a)),
          p = unproject(cx + r * Math.cos(a), r * Math.sin(a));
        if (i === 0) shape.moveTo(p.x, p.y);
        else shape.lineTo(p.x, p.y);
      }
      shape.close();
    }
    const source = shape.commands,
      full = rings(source),
      ground = new GroundViewport(new SceneNode().add(shape));
    const spawn = new Rect(-110, -70, 240, 160);
    for (const view of [
      spawn,
      new Rect(880, -120, 240, 220),
      new Rect(1250, -110, 235, 180),
      new Rect(-1600, -1100, 3400, 2300),
      spawn,
    ]) {
      ground.update(view);
      const visible = rings(shape.commands);
      for (let y = view.y + 0.3; y < view.y + view.h; y += view.h / 22)
        for (let x = view.x + 0.7; x < view.x + view.w; x += view.w / 32) {
          const p = unproject(x, y);
          expect(visible.covers(p.x, p.y)).toBe(full.covers(p.x, p.y));
        }
    }
    expect(shape.commands.length).toBeLessThan(source.length / 2);
    const version = shape.pathVersion;
    ground.update(new Rect(spawn.x + 2, spawn.y, spawn.w, spawn.h));
    expect(shape.pathVersion).toBe(version);
    ground.update(new Rect(5000, 5000, 240, 160));
    expect(shape.alpha).toBe(0);
    ground.update(spawn);
    expect(shape.alpha).toBe(255);
  });

  it('reuses whole-map contours across independent maps and invalidates them after a same-seed edit', () => {
    const first = WorldMap.generate(39, 32, 32),
      next = WorldMap.generate(39, 32, 32),
      read = (map: WorldMap) => vi.fn((i: number, j: number) => map.sample(Layer.Land, i, j)),
      original = groundContours(first)('land', read(first)),
      copied = read(next);
    const full = groundContours(next)('land', copied);
    expect(copied).not.toHaveBeenCalled();
    expect(full.commands).toEqual(original.commands);
    full.reset();
    expect(original.commands.length).toBeGreaterThan(0);
    next.layer(Layer.Land).fill(-1);
    const edited = groundContours(next)('land', copied);
    expect(copied).toHaveBeenCalled();
    expect(edited.commands).toEqual([]);
    expect(groundContours(first)('land', read(first)).commands).toEqual(original.commands);
  });
});
