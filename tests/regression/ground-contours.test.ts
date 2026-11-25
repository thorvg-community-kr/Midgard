import { expect, it } from 'vitest';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer } from '../../packages/engine/src/world-types';
import { contourCell, region } from '../../packages/native-renderer/src/contours';
import { groundContours } from '../../packages/native-renderer/src/ground-contours';
import { lavaPatches, paintLava } from '../../packages/native-renderer/src/lava-motion';
import { SceneNode } from '../../packages/native-renderer/src/paint';

it('joins the same oriented crossings as the individual cell for all sixteen corner patterns', () => {
  const map = { width: () => 10, height: () => 10 };
  for (let mask = 0; mask < 16; ++mask) {
    const sample = (i: number, j: number) => {
      const corner = j === 6 ? i - 5 : 3 - (i - 5);
      return ((1 << corner) & mask ? 1 : -1) * [0.31, 0.12, 0.63, 1.73][corner];
    };
    const { commands } = region(map, 0, sample, undefined, { left: 2.5, top: 3, right: 3, bottom: 3.5 });
    const segments = commands.flatMap((command, i) => {
      const prior = commands[i - 1];
      if (command[0] !== 'L' || !prior || (prior[0] !== 'M' && prior[0] !== 'L')) return [];
      const [, x, y] = prior, [, u, v] = command;
      if ((x === u && (x === 2.5 || x === 3)) || (y === v && (y === 3 || y === 3.5))) return [];
      return [{ a: { x, y }, b: { x: u, y: v } }];
    });
    const edges = contourCell(5, 6, sample).edges.map(({ a, b }) => ({ a, b }));
    expect(segments).toHaveLength(edges.length);
    for (const edge of edges) expect(segments).toContainEqual(edge);
    if (mask === 0) expect(commands).toHaveLength(0);
    if (mask === 15) expect(commands).toHaveLength(6);
  }
});

it('reuses a whole map’s lava geometry while each scene owns its motion and an edited field repaints', () => {
  const first = WorldMap.generate(39, 32, 32), next = WorldMap.generate(39, 32, 32);
  let reads = 0;
  const draw = (map: WorldMap) => {
    const ground = new SceneNode();
    paintLava(ground, map, [], (inset) => (i, j) => {
      ++reads;
      return map.sample(Layer.Heat, i, j) - inset;
    }, () => [255, 80, 0, 255], groundContours(map));
    return lavaPatches(ground);
  };
  first.layer(Layer.Heat).fill(1);
  next.layer(Layer.Heat).fill(1);
  const [original] = draw(first);
  expect(reads).toBeGreaterThan(0);
  reads = 0;
  const [copy] = draw(next);
  expect(reads).toBe(0);
  expect(copy.outline.commands).toEqual(original.outline.commands);
  expect(copy.spots.map((s) => s.at)).toEqual(original.spots.map((s) => s.at));
  copy.outline.reset();
  copy.spots[0].at.x = -1;
  expect(original.outline.commands.length).toBeGreaterThan(0);
  expect(original.spots[0].at.x).toBeGreaterThanOrEqual(0);
  expect(draw(first)[0].spots[0].at.x).toBe(original.spots[0].at.x);
  next.layer(Layer.Heat).fill(-1);
  expect(draw(next)).toHaveLength(0);
  expect(reads).toBeGreaterThan(0);
});
