import { expect, it } from 'vitest';
import { Climate, Weather } from '../../packages/engine/src/climate';
import { Camera, project } from '../../packages/engine/src/geometry';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { SceneNode } from '../../packages/native-renderer/src/paint';
import { treeAt } from '../../packages/native-renderer/src/tree-painter';
import { WindLeaves } from '../../packages/native-renderer/src/wind-leaves';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { buildTreeRow } from '../../packages/native-renderer/src/world-trees';

function grove(terrain = Terrain.Grass) {
  const map = new WorldMap(), size = 12, row = 12;
  map.columns = map.rows = size;
  map.mapSeed = 9;
  map.tiles = Array.from({ length: size * size }, () => ({ ...makeTile(), revealed: true, quarried: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array((2 * size + 1) ** 2).fill(0.45));
  map.layer(Layer.Ridge).fill(-1);
  Object.assign(map.at(6, 6), { terrain, trees: 1 });
  const climate = new Climate(), s = new WorldRendererState({} as never), wind = new WindLeaves();
  climate.wind = 0.9;
  const sceneRows = () => Array.from({ length: 2 * size - 1 }, () => new SceneNode());
  s.rows = sceneRows();
  s.rowTrees = sceneRows();
  s.rowCanopies = s.rows.map(() => []);
  const foot = treeAt(map, 6, 6, 0).foot, base = project(foot.x, foot.y);
  s.view = new Camera(base.x, base.y - 28, 2);
  s.viewWidth = 640;
  s.viewHeight = 400;
  buildTreeRow(s, map, climate, row);
  const frame = (t: number) => wind.update(s, map.seed(), climate, t);
  const leaves = () => s.rows.flatMap(r => r.children).filter(p => p.alpha > 0);
  return { s, climate, base, frame, leaves };
}

it('sheds leaves from the crown, rolls them downwind and lets a dying gust finish', () => {
  const { s, climate, base, frame, leaves } = grove();
  let t = 0;
  while (!leaves().length && t < 4) frame(t += 0.05);
  const leaf = leaves()[0];
  expect(leaf).toBeDefined();
  const start = leaf.matrix;
  expect(Math.abs(start[2] - base.x)).toBeLessThan(16);
  expect(start[5]).toBeLessThan(base.y - 10);
  s.view.x += 40;
  frame(t);
  expect(leaf.matrix).toEqual(start);
  climate.wind = 0;
  frame(t + 2);
  expect(leaf.alpha).toBeGreaterThan(0);
  expect(leaf.matrix[2]).toBeGreaterThan(start[2] + 25);
  expect(leaf.matrix[5]).toBeGreaterThan(start[5]);
  expect(leaf.matrix[0]).not.toBe(start[0]);
  s.fogged = true;
  frame(t + 2.1);
  expect(leaf.alpha).toBe(0);
  frame(t + 5);
  expect(s.rows.flatMap(r => r.children)).toHaveLength(0);
});

it('a light breeze visits leafy trees in sight and respects snow, distance and reduced motion', () => {
  const countInBreeze = (g: ReturnType<typeof grove>) => {
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      g.frame(i / 5);
      peak = Math.max(peak, g.leaves().length);
    }
    return peak;
  };
  const light = grove();
  light.climate.wind = 0.15;
  expect(countInBreeze(light)).toBeGreaterThan(0);
  light.climate.wind = 0.12;
  expect(countInBreeze(light)).toBe(0);
  expect(countInBreeze(grove(Terrain.Ash))).toBe(0);
  expect(countInBreeze(grove(Terrain.Frost))).toBe(0);
  const unseen = grove(), winter = grove(), far = grove(), still = grove();
  unseen.s.fogged = true;
  winter.climate.weather = Weather.Snow;
  far.s.view.zoom = 0.4;
  still.s.reducedMotion = true;
  for (const g of [unseen, winter, far, still]) expect(countInBreeze(g)).toBe(0);
});
