// Opening saga, sixth beat: the picture opens like an eye on the dawn shore, Odin gives breath to
// an ash and an elm, and the two who wake are shown as the game's own portraits.
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { oval, pen, type Form } from './outline-form';
import { dusk, paintForm } from './form-paint';
import { allfatherStanding } from './saga-fighters';
import { dawnShore, eyelids, founderPortrait, horizon, sand } from './saga-shore';
import {
  about,
  alphaOf,
  backdrop,
  cutTo,
  ease,
  easeOut,
  frame,
  glide,
  leafMass,
  lock,
  ramp,
  sagaWidth,
  scatter,
  shotAt,
  stepped,
  flat,
  type SagaPanel,
  type Stop,
} from './saga-panel';

/** Seconds of the beat: the cut to the two faces, the breath reaching them, and each pair of eyes opening. */
const facesAt = 5.9,
  wakeFrom = 6.2,
  wakeTo = 6.85,
  askrOpens = 7.2,
  emblaOpens = 8.35;
/** The wide shore, the two trees with Odin before them, then the trees alone as the breath arrives. */
const shoreStops: readonly Stop[] = [
  { at: 0, x: 800, y: 450, zoom: 1 },
  { at: 2.7, x: 836, y: 458, zoom: 1.07 },
  { at: 2.7001, x: 930, y: 596, zoom: 1.72 },
  { at: 4.7, x: 962, y: 588, zoom: 1.82 },
  { at: 4.7001, x: 1124, y: 556, zoom: 2.28 },
  { at: facesAt, x: 1134, y: 548, zoom: 2.42 },
];
const breathPale: Rgb = [250, 244, 226];

interface ShoreTree {
  scene: SceneNode;
  crown: SceneNode;
  stir: SceneNode;
  at: readonly [number, number];
}
/**
 * A bare shore tree with its foot at (x, y): a trunk that leans, two boughs held like arms, and a
 * crown in a few masses. `spread` makes the round elm of it, or the slender ash.
 */
function shoreTree(x: number, y: number, h: number, lean: number, spread: number, bark: Rgb, leaf: Rgb): ShoreTree {
  const scene = new SceneNode(),
    crown = new SceneNode(),
    stir = new SceneNode(),
    top: readonly [number, number] = [x + lean * h, y - h * 0.66],
    w = h * 0.075,
    trunk: Form = [
      pen(x - w * 1.5, y)
        .curve([x - w, y - h * 0.3], [top[0] - w * 0.6, top[1]])
        .curve([top[0], top[1] - w], [top[0] + w * 0.6, top[1]])
        .curve([x + w, y - h * 0.3], [x + w * 1.5, y])
        .curve([x, y + w * 0.5], [x - w * 1.5, y])
        .close(),
      lock(x + lean * h * 0.5 - w * 0.2, y - h * 0.4, x - h * 0.2 * spread, y - h * 0.74, w * 1.2, -0.2),
      lock(x + lean * h * 0.6 + w * 0.2, y - h * 0.46, x + h * 0.24 * spread + lean * h, y - h * 0.78, w * 1.2, 0.2),
    ];
  paintForm(scene, trunk, bark, { ink: 0, rim: 5 }, dusk(bark, 0.4));
  for (const [dx, dy, cw, ch] of [
    [-0.36 * spread, -1, 0.5 * spread, 0.24],
    [-0.04 * spread, -1.1, 0.5 * spread, 0.26],
    [-0.22 * spread, -0.86, 0.44 * spread, 0.2],
  ]) {
    const form = leafMass(x + lean * h + dx * h, y + dy * h, cw * h, ch * h);
    paintForm(crown, form, leaf, { ink: 0, rim: 6 }, dusk(leaf, 0.36));
    // The same leaves paler, shown for a moment as the breath passes through them.
    stir.add(flat(form, breathPale));
  }
  scene.add(crown).add(stir);
  return { scene, crown, stir, at: [x + lean * h, y - h * 0.86] };
}
/** A point on the breath's way from Odin to the trees. */
function along(u: number): readonly [number, number] {
  const v = 1 - u,
    p = [
      [668, 590],
      [820, 480],
      [990, 610],
      [1136, 528],
    ];
  return [
    v * v * v * p[0][0] + 3 * v * v * u * p[1][0] + 3 * v * u * u * p[2][0] + u * u * u * p[3][0],
    v * v * v * p[0][1] + 3 * v * v * u * p[1][1] + 3 * v * u * u * p[2][1] + u * u * u * p[3][1],
  ];
}

/** The first two: an ash and an elm, and the breath that woke them. */
export function breathPanel(): SagaPanel {
  const scene = new SceneNode(),
    shoreShot = new SceneNode(),
    stage = new SceneNode(),
    shore = dawnShore(),
    odin = allfatherStanding(),
    ash = shoreTree(1052, 806, 330, 0.05, 0.82, [186, 170, 148], [160, 186, 104]),
    elm = shoreTree(1232, 818, 300, -0.05, 1.12, [146, 114, 94], [104, 158, 100]),
    breath = new SceneNode(),
    motes: ShapeNode[] = [],
    leaves: ShapeNode[] = [],
    faces = new SceneNode(),
    askr = founderPortrait(0),
    embla = founderPortrait(1),
    lids = eyelids();
  // A grassy bank where the trees stand, and the prints of whoever walked here.
  shore.ground.add(
    flat(
      [pen(880, 842).curve([1040, 800], [1240, 792], [1460, 804], [1800, 790]).line(1800, 1100).line(760, 1100).close()],
      [128, 156, 102],
    ),
  );
  for (let i = 0; i < 9; i++) {
    const x = 70 + i * 56,
      y = 876 - i * 7 + (i % 2 ? 9 : -9);
    shore.ground.add(flat([oval(x, y, 11, 5)], dusk(sand, 0.34), 190));
  }
  // Long shadows fall toward us and to the right, away from the low sun.
  for (const [x, y, reach] of [
    [612, 812, 270],
    [1052, 806, 300],
    [1232, 818, 280],
  ])
    shore.ground.add(flat([lock(x, y, x + reach, y + 62, 40, 0.02)], [92, 100, 96], 110));
  // He faces the trees: the traced figure looks left, so it is turned about.
  odin.scene.transform([-0.72, 0, 612, 0, 0.72, 812, 0, 0, 1]);
  for (let i = 0; i < 16; i++) {
    const mote = new ShapeNode().appendCircle(0, 0, 13 - i * 0.62).fill(...breathPale);
    motes.push(mote);
    breath.add(mote);
  }
  for (let i = 0; i < 7; i++) {
    const leaf = flat([lock(-9, 0, 9, 0, 9, 0.2)], i % 2 ? [176, 198, 116] : [120, 170, 108]);
    leaves.push(leaf);
    breath.add(leaf);
  }
  stage.add(shore.scene).add(ash.scene).add(elm.scene).add(odin.scene).add(breath);
  shoreShot.add(stage);
  // The two faces, close: the sun between them, sea and strand behind.
  faces
    .add(backdrop([92, 100, 168], [252, 196, 146], 0, 560))
    .add(new ShapeNode().appendCircle(800, 560, 250, 170).fill(255, 204, 156, 60))
    .add(new ShapeNode().appendCircle(800, 560, 124).fill(253, 226, 160))
    .add(new ShapeNode().appendRect(-200, 556, sagaWidth + 400, 400).fill(84, 122, 160))
    .add(
      flat(
        [pen(-200, 700).curve([400, 676], [1200, 684], [1800, 664]).line(1800, 1100).line(-200, 1100).close()],
        sand,
      ),
    );
  const pair = new SceneNode().add(askr.scene).add(embla.scene);
  faces.add(pair);
  scene.add(shoreShot).add(faces).add(lids.scene);
  const shots = [shoreShot, faces];
  return {
    scene,
    // One sound only: the breath. The waking itself is left to the voice.
    cues: [{ at: 4.6 / 9.6, sound: 'sfx/saga/breath', volume: 0.85 }],
    pose(_beat, seconds, at) {
      cutTo(shots, shotAt([0, facesAt], at));
      // The eye opens in two goes: a first look, a blink, then all the way.
      lids.open(
        at < 0.4 ? 0.2 * easeOut(at / 0.4) : at < 0.62 ? 0.2 - 0.1 * ease((at - 0.4) / 0.22) : 0.1 + 0.9 * easeOut(ramp(at, 0.62, 1.5)),
      );
      if (at < facesAt) {
        const view = glide(shoreStops, at);
        frame(stage, view.x, view.y, view.zoom);
        shore.pose(seconds, ramp(at, 0, facesAt));
        odin.flutter(seconds * 0.6);
        // The breath leaves him as "he gave breath" is spoken and runs to the trees in a second.
        const gone = ramp(at, 4.65, 5.6);
        motes.forEach((mote, i) => {
          const u = gone * 1.25 - i * 0.03,
            [x, y] = along(Math.max(0, Math.min(1, u)));
          mote.translate(x, y + 8 * Math.sin(u * 14 + i)).opacity(u > 0 && u < 1 ? alphaOf(0.9 - i * 0.045) : 0);
        });
        const drawn = stepped(seconds, 12),
          swirl = ramp(at, 5.35, facesAt);
        leaves.forEach((leaf, i) => {
          const turn = drawn * 3 + i * 0.9,
            reach = 150 - 70 * swirl + 24 * scatter(i, 311),
            x = 1140 + Math.cos(turn) * reach,
            y = 520 + Math.sin(turn) * reach * 0.5;
          leaf
            .transform([Math.cos(turn * 2), -Math.sin(turn * 2), x, Math.sin(turn * 2), Math.cos(turn * 2), y, 0, 0, 1])
            .opacity(at > 5.3 ? alphaOf(1.2 - Math.abs(swirl - 0.5) * 2) : 0);
        });
        // Their leaves pale and shiver as it passes through them.
        const through = Math.sin(Math.PI * ramp(at, 5.3, facesAt));
        for (const [i, tree] of [ash, elm].entries()) {
          tree.stir.opacity(alphaOf(0.75 * through));
          about(tree.crown, tree.at[0], tree.at[1], 1 + 0.03 * through * Math.sin(drawn * 22 + i * 2));
        }
      } else {
        const since = at - facesAt,
          woken = ease(ramp(at, wakeFrom, wakeTo)),
          drawn = stepped(at, 12),
          // Lids come up in three drawings, each pair on its own name.
          lidsOf = (opens: number) => ramp(drawn, opens, opens + 0.17),
          toward = 0.06 * ease(ramp(at, 8.8, 9.15));
        about(faces, 800, 470, 1 + 0.05 * ease(since / 3.7));
        askr.scene.transform([170, 0, 560, 0, 170, 414 + 2 * Math.sin(seconds * 1.1), 0, 0, 1]);
        embla.scene.transform([162, 0, 1048, 0, 162, 432 + 2 * Math.sin(seconds * 1.1 + 1.6), 0, 0, 1]);
        askr.pose(woken, lidsOf(askrOpens), toward);
        embla.pose(woken, lidsOf(emblaOpens), -toward);
      }
    },
  };
}
