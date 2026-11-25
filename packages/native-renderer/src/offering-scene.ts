import type { Resources } from '../../engine/src/building-catalog';
import type { OfferingKey } from '../../engine/src/prayer-offering';
import { SceneNode } from './paint';
import { poly } from './sprite-primitives';
import { materialPile } from './offering-materials';

export { offeringIcon } from './offering-materials';

function offeringTable(): SceneNode {
  const table = new SceneNode();
  // A single low stone footing follows the tray's edge and sits on the cloth.
  table.add(poly([[-153, 26], [149, 26], [155, 31], [143, 36], [-144, 36], [-157, 31]], [79, 58, 53, 95]));
  table.add(poly([[-150, 21], [148, 21], [144, 33], [-144, 33]], [158, 149, 133]));
  table.add(poly([[-150, 21], [-136, 23], [-132, 33], [-144, 33]], [122, 116, 109]));
  // A dark wooden offering tray with a raised brass rim.
  table.add(poly([[-136, -49], [130, -49], [151, 20], [147, 28], [-145, 28], [-154, 20]], [81, 53, 45]));
  table.add(poly([[-136, -49], [130, -49], [151, 20], [-154, 20]], [189, 142, 79]));
  table.add(poly([[-128, -43], [122, -43], [139, 15], [-142, 15]], [105, 69, 52]));
  table.add(poly([[-125, -40], [119, -40], [134, 12], [-137, 12]], [126, 85, 63]));
  return table;
}

// Back to front. Each bundle has room to grow as more goods are offered.
const places: readonly (readonly [OfferingKey, number, number, number])[] = [
  ['stone', 68, -26, 0.83],
  ['water', -80, -26, 0.83],
  ['food', 0, -12, 1.02],
  ['bones', -104, -3, 0.89],
  ['gold', 105, -3, 0.94],
];

function stoneAndCloth(): SceneNode {
  return new SceneNode()
    .add(poly([[0, 0], [1, 0], [1, 1], [0, 1]], [151, 147, 139]))
    .add(poly([[0, 0.24], [0.33, 0.18], [0.6, 0.23], [1, 0.12], [1, 0.15], [0.6, 0.26], [0.33, 0.21], [0, 0.27]], [129, 125, 121]))
    .add(poly([[0, 0.77], [0.28, 0.72], [0.67, 0.8], [1, 0.71], [1, 0.74], [0.67, 0.83], [0.28, 0.75], [0, 0.8]], [129, 125, 121]))
    .add(poly([[0.28, 0], [0.72, 0], [0.87, 1], [0.13, 1]], [128, 60, 51]))
    .add(poly([[0.3, 0], [0.32, 0], [0.19, 1], [0.16, 1]], [182, 121, 74]))
    .add(poly([[0.68, 0], [0.7, 0], [0.84, 1], [0.81, 1]], [182, 121, 74]))
    .add(poly([[0.53, 0], [0.6, 0], [0.66, 1], [0.55, 1]], [140, 68, 55]));
}

/** The retained still life follows the draft in both directions, without a clock or simulation input. */
export class OfferingScene {
  readonly root = new SceneNode();
  private readonly ground = stoneAndCloth();
  private readonly scene = new SceneNode();
  private readonly piles = places.map(([key, x, y, scale]) => ({
    key,
    node: new SceneNode().transform([scale, 0, x, 0, scale, y, 0, 0, 1]),
    amount: 0,
  }));
  private width = 0;
  private height = 0;

  constructor() {
    this.root.add(this.ground).add(this.scene);
    this.scene.add(offeringTable());
    for (const pile of this.piles) this.scene.add(pile.node);
  }

  update(width: number, height: number, offering: Resources) {
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.ground.transform([width, 0, 0, 0, height, 0, 0, 0, 1]);
      const scale = Math.min(width / 386, height / 140);
      this.scene.transform([scale, 0, width * 0.5, 0, scale, height * 0.5 - 5 * scale, 0, 0, 1]);
    }
    for (const pile of this.piles) {
      const amount = offering[pile.key];
      if (pile.amount === amount) continue;
      pile.amount = amount;
      pile.node.remove();
      if (amount > 0) pile.node.add(materialPile(pile.key, amount));
    }
  }
}
