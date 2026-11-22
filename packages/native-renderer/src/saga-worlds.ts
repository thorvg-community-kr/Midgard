// The opening saga's eight worlds beyond Midgard: one light for each and where it hangs on the tree.
import { World } from '../../engine/src/world-types';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { oval, pen, type Form } from './outline-form';
import { dusk, glint } from './form-paint';
import { flat, lock } from './saga-panel';

export interface SagaWorld {
  world: World;
  /** Its light, bright enough to read against the night sky. */
  light: Rgb;
  /** Where it hangs on the great tree, on the board. */
  tree: readonly [number, number];
}
/** The designed world has one sealable gate to each of these. */
export const sagaWorlds: readonly SagaWorld[] = [
  { world: World.Jotunheim, light: [128, 184, 232], tree: [1262, 452] },
  { world: World.Niflheim, light: [200, 218, 244], tree: [470, 716] },
  { world: World.Helheim, light: [156, 128, 198], tree: [800, 796] },
  { world: World.Alfheim, light: [214, 228, 176], tree: [1112, 196] },
  { world: World.Vanaheim, light: [126, 190, 96], tree: [488, 196] },
  { world: World.Asgard, light: [240, 188, 86], tree: [800, 112] },
  { world: World.Muspelheim, light: [248, 116, 50], tree: [1130, 716] },
  { world: World.Svartalfheim, light: [66, 190, 176], tree: [338, 452] },
];
/** The sea round the map picture, so anything laid beside it joins without a seam. */
export const mapSea: Rgb = [33, 65, 90];

/** A world as a small disc about the origin, radius 1: lit from the upper left, its nature drawn in one mark. */
export function worldDisc(entry: SagaWorld): SceneNode {
  const scene = new SceneNode(),
    base = entry.light,
    shade = dusk(base, 0.5),
    pale = glint(base, 0.5),
    mark = (form: Form, tone: Rgb, alpha = 255) => scene.add(flat(form, tone, alpha));
  scene.add(new ShapeNode().appendCircle(0, 0, 1).fill(...shade));
  // The lit face is the same disc set toward the light and cut to the first.
  scene.add(
    new ShapeNode().appendCircle(-0.12, -0.14, 1).fill(...base).clip(new ShapeNode().appendCircle(0, 0, 1)),
  );
  switch (entry.world) {
    case World.Asgard:
      // A hall of three gables.
      mark([pen(-0.56, 0.34).line(-0.56, -0.02).line(-0.36, -0.3).line(-0.16, -0.02).line(-0.16, 0.34).close()], pale);
      mark([pen(-0.2, 0.34).line(-0.2, -0.16).line(0.04, -0.5).line(0.28, -0.16).line(0.28, 0.34).close()], pale);
      mark([pen(0.24, 0.34).line(0.24, -0.02).line(0.42, -0.26).line(0.6, -0.02).line(0.6, 0.34).close()], pale);
      break;
    case World.Vanaheim:
      // Two round hills.
      mark([pen(-0.86, 0.3).curve([-0.5, -0.28], [-0.08, 0.3]).close()], pale);
      mark([pen(-0.2, 0.36).curve([0.26, -0.16], [0.78, 0.36]).close()], glint(base, 0.3));
      break;
    case World.Alfheim:
      // One bright leaf.
      mark([lock(-0.4, 0.42, 0.34, -0.5, 0.52, 0.18)], pale);
      break;
    case World.Jotunheim:
      // Three hard peaks.
      mark(
        [
          pen(-0.82, 0.4).line(-0.46, -0.3).line(-0.22, 0.1).line(0.06, -0.56).line(0.36, 0.02).line(0.52, -0.22).line(0.8, 0.4).close(),
        ],
        pale,
      );
      break;
    case World.Svartalfheim:
      // Crystals in the dark.
      mark([pen(-0.44, 0.44).line(-0.3, -0.2).line(-0.12, 0.44).close()], pale);
      mark([pen(-0.1, 0.46).line(0.1, -0.46).line(0.3, 0.46).close()], pale);
      mark([pen(0.3, 0.44).line(0.46, -0.06).line(0.6, 0.44).close()], glint(base, 0.3));
      break;
    case World.Niflheim:
      // Hanging ice.
      for (const [x, drop] of [
        [-0.5, 0.2],
        [-0.2, 0.52],
        [0.12, 0.3],
        [0.42, 0.44],
      ])
        mark([pen(x - 0.13, -0.42).line(x + 0.13, -0.42).line(x, drop).close()], pale);
      break;
    case World.Muspelheim:
      // Three tongues of fire.
      mark([lock(-0.36, 0.46, -0.44, -0.3, 0.34, -0.2)], pale);
      mark([lock(0.02, 0.5, 0.06, -0.58, 0.42, 0.16)], pale);
      mark([lock(0.4, 0.46, 0.5, -0.24, 0.32, 0.2)], pale);
      break;
    case World.Helheim:
      // A barrow and its door.
      mark([pen(-0.72, 0.36).curve([-0.4, -0.34], [0, -0.44], [0.4, -0.34], [0.72, 0.36]).close()], pale);
      mark([oval(0, 0.16, 0.16, 0.22)], shade);
      break;
    default:
      break;
  }
  return scene;
}
