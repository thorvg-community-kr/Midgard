import { point, type Point } from '../../engine/src/geometry';
import type { ItemMaterial } from '../../engine/src/equipment';
import { handOf } from './person-arm';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { poly, stroke } from './sprite-primitives';
import type { PersonParts } from './world-sprites';

export type BenchStock = ItemMaterial | 'wicker';
export type WorkPiece = 'board' | 'paver' | 'roots' | 'bellows' | 'parcel' | BenchStock;

const stockColors: Record<Exclude<ItemMaterial, 'frostwood'>, readonly [Rgb, Rgb]> = {
  wood: [
    [147, 97, 57],
    [206, 161, 100],
  ],
  stone: [
    [101, 103, 107],
    [165, 164, 151],
  ],
  iron: [
    [94, 104, 113],
    [166, 172, 170],
  ],
  embersteel: [
    [122, 81, 72],
    [201, 144, 118],
  ],
};

/** Where the fingers meet a loose object, in the same ground space as the worker's boots. */
export function workHand(parts: PersonParts, side = 1): Point {
  const wrist = handOf(parts.arms[side]),
    m = parts.body!.matrix;
  return point(m[0] * wrist.x + m[1] * wrist.y + m[2], m[3] * wrist.x + m[4] * wrist.y + m[5]);
}

function shape(kind: WorkPiece): SceneNode {
  const piece = new SceneNode();
  switch (kind) {
    case 'wicker':
      // A few loose willow strips already crossed at the base of the basket.
      return piece
        .add(stroke([-3, -0.85], [2.8, 0.65], 0.6, [146, 112, 72]))
        .add(stroke([-2.8, 0.65], [3, -0.8], 0.6, [186, 150, 98]))
        .add(stroke([-1.3, -1.1], [-0.9, 0.95], 0.52, [205, 171, 116]))
        .add(stroke([0.55, -1.1], [0.95, 0.9], 0.52, [205, 171, 116]));
    case 'wood':
    case 'stone':
    case 'iron':
    case 'embersteel': {
      const [base, top] = stockColors[kind];
      // A blunt piece of stock with a broad top face for the fingers or the hammer.
      return piece
        .add(new ShapeNode().appendRect(-3.1, -1, 6.2, 2.05, 0.55, 0.55).fill(...base))
        .add(new ShapeNode().appendRect(-3.05, -1, 6.05, 0.75, 0.36, 0.36).fill(...top));
    }
    case 'board':
      return piece
        .add(
          poly(
            [
              [-2.6, -0.8],
              [4.4, -0.8],
              [3.9, 0.1],
              [4.4, 0.7],
              [-2.6, 0.7],
            ],
            [149, 98, 53],
          ),
        )
        .add(stroke([-2.3, -0.55], [3.8, -0.55], 0.35, [213, 166, 101]));
    case 'paver':
      return piece
        .add(
          poly(
            [
              [-2.5, 0],
              [-1.8, -1.2],
              [1.4, -1.3],
              [2.8, -0.2],
              [2.1, 1],
              [-1.8, 1.1],
            ],
            [99, 102, 109],
          ),
        )
        .add(
          poly(
            [
              [-2.5, 0],
              [-1.8, -1.2],
              [1.4, -1.3],
              [2.8, -0.2],
              [-1.6, 0.35],
            ],
            [166, 164, 154],
          ),
        );
    case 'roots':
      return piece
        .add(
          poly(
            [
              [-1.6, -0.2],
              [0.4, -0.75],
              [1.7, 0],
              [0.75, 1.3],
              [-0.6, 1],
            ],
            [115, 80, 49],
          ),
        )
        .add(
          poly(
            [
              [-0.7, 0],
              [-2.8, -2.4],
              [-1.3, -1.9],
              [-0.25, -0.9],
              [-0.9, -4],
              [0.3, -3.2],
              [0.7, -0.9],
              [2.3, -3],
              [1.5, -0.3],
            ],
            [88, 124, 63],
          ),
        );
    case 'bellows':
      // The nozzle is the hinge. The leather opens under the wooden paddle in the worker's hand.
      return piece
        .add(
          poly(
            [
              [0, 0],
              [-5.4, 0.3],
              [-7, -0.6],
              [-6.8, -3.7],
              [-5.1, -3.5],
            ],
            [120, 73, 55],
          ),
        )
        .add(
          poly(
            [
              [0, 0],
              [-5.4, 0.3],
              [-7, -0.6],
              [-6.8, -1.75],
              [-4.8, -1.45],
            ],
            [166, 100, 65],
          ),
        )
        .add(stroke([-7.4, -4], [-0.1, -0.3], 0.7, [167, 124, 77]))
        .add(stroke([-0.6, -0.3], [2.2, 0], 0.85, [86, 86, 88]));
    case 'frostwood':
      return piece
        .add(
          poly(
            [
              [-3.8, -0.8],
              [3.7, -1.4],
              [4.2, 0.25],
              [-3.2, 1.1],
            ],
            [114, 144, 151],
          ),
        )
        .add(stroke([-3.4, -0.7], [3.4, -1.15], 0.5, [185, 202, 194]))
        .add(stroke([-1.1, -1], [-0.65, 0.78], 0.7, [196, 174, 124]));
    case 'parcel':
      return piece
        .add(
          poly(
            [
              [-2.3, -1.3],
              [1.6, -1.6],
              [2.5, 0.8],
              [-1.6, 1.4],
            ],
            [165, 127, 77],
          ),
        )
        .add(stroke([-0.45, -1.45], [0.2, 1.1], 0.65, [220, 189, 131]));
  }
}

/** Each figure retains only the pieces it has handled. They sit behind the wrists, ahead of the ground. */
export function workPiece(parts: PersonParts, kind: WorkPiece): SceneNode {
  let piece = parts.workPieces[kind];
  if (!piece) {
    piece = parts.workPieces[kind] = shape(kind);
    parts.workSurface.add(piece);
  }
  parts.activePiece = piece;
  return piece;
}

/** Meet the piece where it rests, lift it with the fingers, then let go as it falls by the boots. */
export function removePiece(parts: PersonParts, kind: 'board' | 'paver' | 'roots', phase: number): void {
  const hand = workHand(parts),
    wall = kind === 'board',
    join = Math.min(1, Math.max(0, (phase - 0.34) / 0.16)),
    grip = join * join * (3 - 2 * join),
    drop = Math.max(0, (phase - 0.83) / 0.17),
    x = (wall ? 7.5 : 6.5) * (1 - grip) + (hand.x + 0.7) * grip + 1.6 * drop,
    rest = wall ? parts.neck.y + 3 : -1.05,
    y = (rest * (1 - grip) + (hand.y + (wall ? 0 : 1.5)) * grip) * (1 - drop * drop) - drop * drop,
    turn = (wall ? -1.1 : 0) + (wall ? 1.9 : 1.1) * Math.max(0, phase - 0.5) + 0.25 * drop,
    c = Math.cos(turn),
    s = Math.sin(turn),
    show = Math.max(0, Math.min(1, phase / 0.12, (1 - phase) / 0.1));
  workPiece(parts, kind)
    .transform([c, -s, x, s, c, y, 0, 0, 1])
    .opacity(Math.round(255 * show));
}
