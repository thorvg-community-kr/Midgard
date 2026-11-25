import { expect, it } from 'vitest';
import { Resources } from '../../packages/engine/src/building-catalog';
import { maxOfferingGoods, offeringKeys } from '../../packages/engine/src/prayer-offering';
import { materialPile } from '../../packages/native-renderer/src/offering-materials';
import { OfferingScene } from '../../packages/native-renderer/src/offering-scene';
import { SceneNode, ShapeNode, type PaintNode } from '../../packages/native-renderer/src/paint';

function paints(root: PaintNode): PaintNode[] {
  return root instanceof SceneNode ? [root, ...root.children.flatMap(paints)] : [root];
}

it.each(offeringKeys)('shows %s appearing, growing and being taken back off the altar', (key) => {
  const scene = new OfferingScene();
  const gift = new Resources();
  scene.update(400, 170, gift);
  const empty = paints(scene.root);
  gift[key] = 1;
  scene.update(400, 170, gift);
  const first = paints(scene.root);
  expect(first.length).toBeGreaterThan(empty.length);
  gift[key] = 8;
  scene.update(400, 170, gift);
  let previous = materialPile(key, 1);
  for (let amount = 2; amount <= maxOfferingGoods; amount++) {
    const next = materialPile(key, amount);
    expect(next).not.toEqual(previous);
    previous = next;
  }
  const busy = paints(scene.root);
  expect(busy.length).toBeGreaterThanOrEqual(first.length);
  scene.update(400, 170, gift);
  expect(paints(scene.root).every((node, i) => node === busy[i])).toBe(true);
  gift[key] = 0;
  scene.update(400, 170, gift);
  expect(paints(scene.root).every((node, i) => node === empty[i])).toBe(true);
  expect(paints(scene.root)).toHaveLength(empty.length);
});

it('keeps an entire storehouse of gifts bounded and draws it in flat paint', () => {
  const scene = new OfferingScene();
  const gift = new Resources();
  for (const key of offeringKeys) gift[key] = 9999;
  scene.update(320, 130, gift);
  const full = paints(scene.root);
  expect(full.length).toBeLessThan(500);
  expect(
    full.every(
      (node) =>
        node.blending === 'normal' &&
        (node instanceof SceneNode || (node instanceof ShapeNode && !node.gradient)),
    ),
  ).toBe(true);
  scene.update(720, 300, gift);
  expect(paints(scene.root).every((node, i) => node === full[i])).toBe(true);
});
