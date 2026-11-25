import type { OfferingKey } from '../../engine/src/prayer-offering';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { oval, poly, stroke } from './sprite-primitives';

function waterBowl(fill: number) {
  const bowl = new SceneNode();
  bowl.add(oval([1, 12], 21, 5, [74, 73, 69]));
  bowl.add(
    new ShapeNode()
      .moveTo(-25, -5)
      .lineTo(25, -5)
      .cubicTo(24, 3, 17, 13, 10, 15)
      .cubicTo(3, 18, -11, 16, -15, 13)
      .cubicTo(-20, 9, -24, 2, -25, -5)
      .close()
      .fill(127, 81, 55),
  );
  bowl.add(
    poly(
      [
        [-24, -3],
        [-15, 1],
        [-11, 12],
        [-16, 11],
        [-20, 6],
      ],
      [176, 118, 71],
    ),
  );
  bowl.add(
    new ShapeNode()
      .moveTo(-19, 8)
      .cubicTo(-8, 15, 11, 15, 20, 7)
      .lineTo(18, 10)
      .cubicTo(7, 18, -9, 16, -17, 12)
      .close()
      .fill(91, 70, 57),
  );
  bowl.add(oval([0, -5], 25, 10, [203, 151, 94]));
  bowl.add(oval([0, -5], 22.5, 8, [89, 65, 56]));
  const surface = 0.8 - 5.8 * fill;
  const radius = 10 + 12 * fill;
  bowl.add(oval([0, surface], radius, 2 + 5.5 * fill, [63, 143, 160]));
  bowl.add(
    new ShapeNode()
      .moveTo(-radius * 0.81, surface)
      .cubicTo(-radius * 0.69, surface - 2, -radius * 0.34, surface - 3, -radius * 0.12, surface - 1.5)
      .cubicTo(-radius * 0.37, surface - 1.8, -radius * 0.6, surface, -radius * 0.81, surface)
      .close()
      .fill(178, 221, 213),
  );
  return bowl;
}

function coinColumn(count: number, x: number, y: number) {
  const coins = new SceneNode().translate(x, y);
  for (let i = 0; i < count; i++) {
    const offset = (i % 3) - 1,
      top = -2.8 * i;
    coins.add(oval([offset, top], 10, 4, [153, 103, 50]));
    coins.add(oval([offset, top - 1.9], 10, 3.8, [228, 180, 81]));
  }
  // The stamped lozenge on the top coin stays legible on a tall stack.
  const xTop = ((count - 1) % 3) - 1,
    yTop = -2.8 * (count - 1) - 1.9;
  coins.add(
    poly(
      [
        [xTop - 4, yTop],
        [xTop, yTop - 2],
        [xTop + 4, yTop],
        [xTop, yTop + 2],
      ],
      [185, 129, 52],
    ),
  );
  coins.add(stroke([xTop - 6, yTop - 1.3], [xTop - 2.7, yTop - 2.3], 0.9, [255, 221, 138]));
  return coins;
}

const stoneTones: readonly (readonly [Rgb, Rgb, Rgb])[] = [
  [
    [105, 120, 128],
    [168, 179, 178],
    [76, 91, 104],
  ],
  [
    [117, 132, 141],
    [186, 190, 184],
    [84, 97, 107],
  ],
  [
    [103, 113, 120],
    [157, 163, 158],
    [72, 85, 95],
  ],
];

function rock(index: number) {
  const [body, top, side] = stoneTones[index % stoneTones.length]!;
  const stone = new SceneNode();
  stone.add(
    poly(
      [
        [-13, 0],
        [-8, -9],
        [4, -13],
        [11, -8],
        [15, 1],
        [7, 7],
        [-5, 7],
      ],
      body,
    ),
  );
  stone.add(
    poly(
      [
        [-13, 0],
        [-8, -9],
        [4, -13],
        [9, -8],
        [2, -4],
      ],
      top,
    ),
  );
  stone.add(
    poly(
      [
        [2, -4],
        [9, -8],
        [11, -8],
        [15, 1],
        [7, 7],
        [3, 5],
      ],
      side,
    ),
  );
  return stone;
}

function loaf(index: number) {
  const bread = new SceneNode();
  const crust: Rgb = index % 2 ? [214, 153, 80] : [234, 179, 103];
  bread.add(
    new ShapeNode()
      .moveTo(-12, 1)
      .cubicTo(-12, -6, -4, -10, 4, -10)
      .cubicTo(11, -10, 15, -5, 12, 1)
      .cubicTo(9, 6, -9, 8, -12, 1)
      .close()
      .fill(145, 86, 48),
  );
  bread.add(
    new ShapeNode()
      .moveTo(-12, 0)
      .cubicTo(-11, -7, -4, -10, 4, -10)
      .cubicTo(9, -10, 12, -7, 13, -4)
      .cubicTo(9, 1, -5, 5, -12, 0)
      .close()
      .fill(...crust),
  );
  for (let i = 0; i < 3; i++) {
    const x = -8 + i * 5,
      y = -2 - i;
    bread.add(
      poly(
        [
          [x, y],
          [x + 1, y - 4],
          [x + 2.7, y - 5],
          [x + 2.3, y - 1],
        ],
        [152, 94, 52],
      ),
    );
  }
  return bread;
}

const heapPlaces = [
  [0, 0, 1],
  [-16, 3, 0.83],
  [15, 3, 0.94],
  [-5, 6, 0.88],
  [5, -6, 0.91],
  [-14, -4, 0.77],
  [17, -3, 0.78],
  [-4, -9, 0.88],
  [8, -12, 0.79],
  [-9, -13, 0.77],
  [17, -10, 0.68],
  [1, -16, 0.8],
  [-5, -20, 0.73],
  [9, -18, 0.71],
  [3, -23, 0.7],
  [-4, -25, 0.66],
  [4, -29, 0.65],
] as const;

function bone() {
  const bone = new SceneNode();
  bone.add(
    new ShapeNode()
      .moveTo(-15, 2)
      .cubicTo(-20, 0, -21, -5, -17, -7)
      .cubicTo(-14, -9, -10, -7, -10, -4)
      .cubicTo(-7, -6, -4, -4, -5, -2)
      .cubicTo(-2, 1, 5, 2, 11, 1)
      .cubicTo(12, -3, 16, -4, 18, -1)
      .cubicTo(21, 1, 19, 4, 18, 5)
      .cubicTo(21, 9, 17, 12, 14, 10)
      .lineTo(10, 6)
      .cubicTo(3, 4, -4, 3, -10, 2)
      .cubicTo(-12, 6, -16, 6, -15, 2)
      .close()
      .fill(191, 173, 139),
  );
  bone.add(
    new ShapeNode()
      .moveTo(-17, -6)
      .cubicTo(-14, -9, -11, -6, -10, -3)
      .cubicTo(-5, -4, -6, -1, -4, 0)
      .lineTo(11, 3)
      .cubicTo(14, -2, 17, -3, 18, 0)
      .lineTo(14, 4)
      .lineTo(10, 4)
      .lineTo(-10, 0)
      .lineTo(-14, 2)
      .cubicTo(-13, -2, -19, -2, -17, -6)
      .close()
      .fill(235, 220, 185),
  );
  return bone;
}

/** Each permitted unit of a gift occupies a place in the pile. The display also bounds invalid drafts. */
export function materialPile(key: OfferingKey, amount: number): SceneNode {
  const pile = new SceneNode();
  if (amount <= 0) return pile;
  const count = Math.min(heapPlaces.length, amount);
  if (key === 'water') {
    if (amount > 8) {
      const fill = Math.min(1, (amount - 8) / 8);
      pile.add(waterBowl(fill).transform([0.73, 0, 20, 0, 0.73, -12, 0, 0, 1]));
    }
    pile.add(waterBowl(Math.min(1, amount / 8)));
  } else if (key === 'gold') {
    const left = Math.min(5, Math.floor(count / 3));
    const right = Math.min(5, Math.floor((count + 1) / 3));
    if (left) pile.add(coinColumn(left, -12, -3));
    if (right) pile.add(coinColumn(right, 11, -5));
    pile.add(coinColumn(count - left - right, 0, 3));
  } else {
    if (key === 'food') {
      pile.add(oval([0, 6], 31, 10, [110, 77, 54]));
      pile.add(oval([0, 3], 32, 10, [178, 136, 84]));
      pile.add(oval([0, 2], 27, 7.5, [123, 91, 56]));
    } else {
      pile.add(oval([0, 4], Math.min(30, 11 + 3 * count), 5, [85, 85, 80]));
    }
    for (let i = 0; i < count; i++) {
      const [x, y, s] = heapPlaces[i]!;
      if (key === 'bones') {
        const angle = [-0.42, 0.39, -0.7, 0.08, -0.53][i % 5]!;
        const a = Math.cos(angle) * s,
          b = Math.sin(angle) * s;
        pile.add(bone().transform([a, -b, x * 0.82, b, a, y * 0.74, 0, 0, 1]));
      } else {
        const item = key === 'stone' ? rock(i) : loaf(i);
        pile.add(item.transform([i % 3 === 2 ? -s : s, 0, x, 0, s, y, 0, 0, 1]));
      }
    }
  }
  return pile;
}

export function offeringIcon(key: OfferingKey): SceneNode {
  const node = new SceneNode();
  const s = key === 'food' || key === 'water' ? 0.54 : key === 'gold' ? 0.8 : 0.93;
  const pile = materialPile(key, key === 'gold' ? 3 : key === 'water' ? 7 : 1);
  return node.add(pile.transform([s, 0, 0, 0, s, 0, 0, 0, 1]));
}
