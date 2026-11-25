// Opening saga, fourth beat: the picture opens like an eye on the dawn shore, Odin gives breath to
// an ash and an elm, and the two who wake are shown as the game's own portraits.
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { pen, trace, type Contour, type Form } from './outline-form';
import { dusk, glint, paintForm } from './form-paint';
import { allfatherStanding } from './saga-fighters';
import { dawnShore, eyelids, founderPortrait, sand } from './saga-shore';
import {
  about,
  alphaOf,
  backdrop,
  clamp01,
  cutTo,
  ease,
  easeOut,
  flat,
  frame,
  glide,
  hazeStreak,
  lock,
  ramp,
  sagaWidth,
  scatter,
  shotAt,
  stepped,
  turn,
  type SagaPanel,
  type Stop,
} from './saga-panel';

type Vec = readonly [number, number];

const length = 13.3;
/**
 * Seconds of the beat, each on the voice: he and the two trees are cut to ("He found two trees"), the breath
 * leaves him ("and gave them life"), the trees alone are cut to, the faces are cut to, they take on the colours of
 * the living, and each pair of eyes opens as its own name is said, with the rest the voice leaves between the two;
 * then they turn a little toward each other.
 */
const nearAt = 4.4,
  breathFrom = 6.45,
  treesAt = 7.15,
  facesAt = 8.75,
  wakeFrom = 9.05,
  wakeTo = 9.65,
  askrOpens = 10.15,
  emblaOpens = 11.45,
  turnAt = 12.3;
/** The wide shore, the two trees with Odin before them, then the trees alone as the breath winds round them. */
const shoreStops: readonly Stop[] = [
  { at: 0, x: 800, y: 450, zoom: 1 },
  { at: nearAt, x: 836, y: 458, zoom: 1.07 },
  { at: nearAt + 0.0001, x: 930, y: 612, zoom: 1.6 },
  { at: treesAt, x: 956, y: 606, zoom: 1.68 },
  { at: treesAt + 0.0001, x: 1150, y: 636, zoom: 1.9 },
  { at: facesAt, x: 1156, y: 626, zoom: 2 },
];
const breathPale: Rgb = [250, 244, 226];

/** How a tree spreads: each bough's tip from the foot in tree heights, its thickness and its bend. */
interface Habit {
  boughs: readonly (readonly [number, number, number, number])[];
  /** Narrow leaflets in pairs along a stalk (the ash) or broad single leaves (the elm). */
  paired: boolean;
}
const ashHabit: Habit = {
  boughs: [
    [-0.2, 0.82, 0.05, -0.14],
    [-0.06, 0.99, 0.056, -0.05],
    [0.11, 0.93, 0.05, 0.08],
    [0.25, 0.77, 0.044, 0.16],
  ],
  paired: true,
};
const elmHabit: Habit = {
  boughs: [
    [-0.37, 0.7, 0.05, -0.2],
    [-0.17, 0.9, 0.056, -0.1],
    [0.07, 0.95, 0.056, 0.06],
    [0.29, 0.83, 0.05, 0.16],
    [0.42, 0.64, 0.04, 0.22],
  ],
  paired: false,
};
/** A bough or a twig: thick where it leaves its parent and drawn out to a point, along one even curve. */
interface Limb {
  outline: Contour;
  at(share: number): Vec;
  heading(share: number): number;
}
function limb(from: Vec, to: Vec, width: number, bend: number): Limb {
  const dx = to[0] - from[0],
    dy = to[1] - from[1],
    // The curve leans to one side by `bend` of its length.
    cx = (from[0] + to[0]) / 2 - dy * bend,
    cy = (from[1] + to[1]) / 2 + dx * bend,
    at = (s: number): Vec => [
      (1 - s) * (1 - s) * from[0] + 2 * s * (1 - s) * cx + s * s * to[0],
      (1 - s) * (1 - s) * from[1] + 2 * s * (1 - s) * cy + s * s * to[1],
    ],
    heading = (s: number): number =>
      Math.atan2((1 - s) * (cy - from[1]) + s * (to[1] - cy), (1 - s) * (cx - from[0]) + s * (to[0] - cx)),
    steps = 5,
    left: [number, number][] = [],
    right: [number, number][] = [];
  for (let k = 0; k < steps; k++) {
    const s = k / steps,
      p = at(s),
      a = heading(s),
      half = (width / 2) * (1 - s) ** 0.8;
    left.push([p[0] + Math.sin(a) * half, p[1] - Math.cos(a) * half]);
    right.push([p[0] - Math.sin(a) * half, p[1] + Math.cos(a) * half]);
  }
  const start = heading(0),
    outline = pen(left[0][0], left[0][1])
      .curve(...left.slice(1), [to[0], to[1]])
      .curve(...right.reverse())
      // A round shoulder where it joins, sunk into the parent.
      .curve([from[0] - Math.cos(start) * width * 0.3, from[1] - Math.sin(start) * width * 0.3], left[0])
      .close();
  return { outline, at, heading };
}
/** One leaf from its stalk end, widest a third of the way along and drawn to a point. */
function leafFrom(p: Vec, heading: number, long: number, wide: number): Contour {
  const ux = Math.cos(heading) * long,
    uy = Math.sin(heading) * long,
    nx = -Math.sin(heading) * wide,
    ny = Math.cos(heading) * wide;
  return pen(p[0], p[1])
    .cubic(p[0] + ux * 0.22 + nx * 0.72, p[1] + uy * 0.22 + ny * 0.72, p[0] + ux * 0.7 + nx * 0.5, p[1] + uy * 0.7 + ny * 0.5, p[0] + ux, p[1] + uy)
    .cubic(p[0] + ux * 0.7 - nx * 0.5, p[1] + uy * 0.7 - ny * 0.5, p[0] + ux * 0.22 - nx * 0.72, p[1] + uy * 0.22 - ny * 0.72, p[0], p[1])
    .close();
}
interface ShoreTree {
  /** Bole, roots, boughs and twigs, painted as one piece so no line shows where they join. */
  wood: SceneNode;
  /** The leaves behind the boughs and those before them; they stir a little about their middle. */
  leaves: readonly [SceneNode, SceneNode];
  /** The tree in one pale tone over each part, shown as the breath takes it. */
  taken: readonly ShapeNode[];
  /** The middle of its leaves. */
  heart: Vec;
  /** The shape of one of its leaves about its own middle, for those that let go. */
  leaf(): Contour;
}
/**
 * A young shore tree with its foot at (x, y): a smooth bole that forks into boughs, twigs on the boughs and
 * leaves set along them in order, each one drawn. The side toward the low sun is the lighter.
 */
function shoreTree(x: number, y: number, h: number, lean: number, habit: Habit, bark: Rgb, leaf: Rgb): ShoreTree {
  const wood = new SceneNode(),
    b = h * 0.062,
    fork: Vec = [x + lean * h, y - h * 0.46],
    // The bole swells where it divides and ends in a round head: every bough starts well inside it, so each
    // grows out of the wood with no notch or gap beside it.
    mid = x + lean * h * 0.62,
    bole: Form = [
      pen(x - b * 1.25, y)
        .curve(
          [x - b * 0.86, y - h * 0.14],
          [mid - b * 0.68, y - h * 0.3],
          [fork[0] - b * 0.88, fork[1] + b * 0.2],
          [fork[0] - b * 0.66, fork[1] - b * 0.56],
          [fork[0], fork[1] - b * 0.9],
          [fork[0] + b * 0.66, fork[1] - b * 0.56],
          [fork[0] + b * 0.88, fork[1] + b * 0.2],
          [mid + b * 0.68, y - h * 0.3],
          [x + b * 0.86, y - h * 0.14],
          [x + b * 1.25, y],
        )
        .curve([x, y + b * 0.4], [x - b * 1.25, y])
        .close(),
      // Roots that hold the bank.
      lock(x - b * 0.5, y - h * 0.035, x - b * 3.1, y + h * 0.014, b * 1.15, -0.18),
      lock(x + b * 0.5, y - h * 0.035, x + b * 3.3, y + h * 0.018, b * 1.15, 0.18),
    ],
    limbs: Form = [],
    stalks: [Form, Form] = [[], []],
    // Leaves behind the boughs and before them, each with its own middle so it can be toned by where it hangs.
    hung: { shape: Contour; at: Vec; front: boolean }[] = [],
    long = h * (habit.paired ? 0.066 : 0.112),
    wide = h * (habit.paired ? 0.024 : 0.066),
    put = (p: Vec, heading: number, front: boolean) =>
      hung.push({ shape: leafFrom(p, heading, long, wide), at: [p[0] + Math.cos(heading) * long * 0.5, p[1] + Math.sin(heading) * long * 0.5], front }),
    // What grows at one joint: a broad leaf, or a stalk of leaflets in pairs with one at its end.
    sprout = (p: Vec, heading: number, front: boolean, curl: number) => {
      if (!habit.paired) {
        put(p, heading, front);
        return;
      }
      const reach = h * 0.15,
        stalk = limb(p, [p[0] + Math.cos(heading) * reach, p[1] + Math.sin(heading) * reach], h * 0.009, curl * 0.1);
      stalks[front ? 1 : 0].push(stalk.outline);
      for (const share of [0.3, 0.56, 0.82])
        for (const flank of [-1, 1]) put(stalk.at(share), stalk.heading(share) + flank * 0.82, front);
      put(stalk.at(0.97), stalk.heading(1), front);
    },
    // Joints along the outer part of a branch, to one side and the other by turns, and one at its tip.
    dress = (branch: Limb, from: number, joints: number, first: number) => {
      for (let k = 0; k < joints; k++) {
        const share = from + ((0.94 - from) * k) / Math.max(1, joints - 1),
          side = (k + first) % 2 ? 1 : -1;
        sprout(branch.at(share), branch.heading(share) + side * 0.84, side * Math.cos(branch.heading(share)) > 0, side);
      }
      sprout(branch.at(0.99), branch.heading(1), true, 0);
    };
  for (const [i, [dx, dy, thick, bend]] of habit.boughs.entries()) {
    const bough = limb([fork[0] + dx * b * 0.9, fork[1] + b * 0.7], [x + lean * h + dx * h, y - dy * h], thick * h, bend),
      side = dx < 0 ? -1 : 1;
    limbs.push(bough.outline);
    dress(bough, habit.paired ? 0.6 : 0.52, habit.paired ? 3 : 4, i);
    // Twigs turned outward and inward by turns, so the crown fills between the boughs; the elm bears one more.
    for (const [share, turnTo, reach] of (
      [
        [0.46, side, 0.2],
        [0.7, -side, 0.16],
        [0.3, -side, 0.15],
      ] as const
    ).slice(0, habit.paired ? 2 : 3)) {
      const from = bough.at(share),
        heading = bough.heading(share) + turnTo * 0.78,
        twig = limb(from, [from[0] + Math.cos(heading) * reach * h, from[1] + Math.sin(heading) * reach * h], thick * h * 0.46, turnTo * -0.14);
      limbs.push(twig.outline);
      dress(twig, 0.34, habit.paired ? 2 : 4, i + 1);
    }
  }
  // One outline for the whole of the wood: where a bough leaves the bole there is no edge to draw.
  const timber: Form = [...bole, ...limbs];
  paintForm(wood, timber, bark, { ink: 0, rim: 5 }, dusk(bark, 0.42));
  // The sun is low on the left: leaves on that side of the crown are the lighter, those away from it the darker.
  const heart: Vec = [
      hung.reduce((sum, one) => sum + one.at[0], 0) / hung.length,
      hung.reduce((sum, one) => sum + one.at[1], 0) / hung.length,
    ],
    spread = Math.max(...hung.map((one) => Math.hypot(one.at[0] - heart[0], one.at[1] - heart[1]))),
    lit = (at: Vec): number => (heart[0] - at[0] + (heart[1] - at[1]) * 0.6) / spread,
    tones: Rgb[][] = [
      [dusk(leaf, 0.44), dusk(leaf, 0.26), dusk(leaf, 0.08)],
      [dusk(leaf, 0.2), leaf, glint(leaf, 0.24)],
    ],
    taken: ShapeNode[] = [flat(timber, breathPale)],
    layer = (front: boolean) => {
      const group = new SceneNode(),
        mine = hung.filter((one) => one.front === front);
      group.add(flat(stalks[front ? 1 : 0], dusk(leaf, 0.5)));
      for (const [tone, from, to] of [
        [0, -Infinity, -0.2],
        [1, -0.2, 0.22],
        [2, 0.22, Infinity],
      ] as const) {
        const shapes = mine.filter((one) => lit(one.at) >= from && lit(one.at) < to).map((one) => one.shape);
        if (shapes.length) group.add(flat(shapes, tones[front ? 1 : 0][tone]));
      }
      const pale = flat([...stalks[front ? 1 : 0], ...mine.map((one) => one.shape)], breathPale);
      taken.push(pale);
      return group.add(pale);
    },
    leaves = [layer(false), layer(true)] as const;
  wood.add(taken[0]);
  return { wood, leaves, taken, heart, leaf: () => leafFrom([-long / 2, 0], 0, long, wide) };
}

/**
 * The way the breath goes, through these points: out from his lips, low along the strand, once
 * round the ash and once round the elm, then up and away in a curl.
 */
const way: readonly Vec[] = [
  [652, 574],
  [716, 548],
  [796, 566],
  [876, 616],
  [954, 652],
  [1022, 696],
  [1092, 712],
  [1126, 668],
  [1096, 618],
  [1040, 600],
  [1000, 566],
  [1034, 522],
  [1104, 530],
  [1164, 590],
  [1206, 668],
  [1262, 716],
  [1312, 690],
  [1306, 630],
  [1252, 600],
  [1198, 578],
  [1186, 526],
  [1232, 478],
  [1290, 462],
  [1306, 414],
  [1262, 384],
  [1226, 410],
  [1244, 440],
];
/** Stretches of the way that pass behind a trunk, in points along it. */
const behind: readonly Vec[] = [
  [7.4, 9.6],
  [16.4, 18.6],
];
const last = way.length - 1;
/** Where the way is `u` points along, and which way is across it there. */
function wayAt(u: number): { at: Vec; across: Vec } {
  const c = Math.max(0, Math.min(last - 1e-6, u)),
    i = Math.floor(c),
    t = c - i,
    p0 = way[Math.max(0, i - 1)],
    p1 = way[i],
    p2 = way[i + 1],
    p3 = way[Math.min(last, i + 2)],
    spline = (a: number, b: number, d: number, e: number): [number, number] => [
      0.5 * (2 * b + (-a + d) * t + (2 * a - 5 * b + 4 * d - e) * t * t + (-a + 3 * b - 3 * d + e) * t * t * t),
      0.5 * (-a + d + 2 * (2 * a - 5 * b + 4 * d - e) * t + 3 * (-a + 3 * b - 3 * d + e) * t * t),
    ],
    [px, dx] = spline(p0[0], p1[0], p2[0], p3[0]),
    [py, dy] = spline(p0[1], p1[1], p2[1], p3[1]),
    size = Math.hypot(dx, dy) || 1;
  return { at: [px, py], across: [-dy / size, dx / size] };
}
interface Strand {
  back: ShapeNode;
  front: ShapeNode;
  /** Its widest, how far it runs behind the head of the breath, and how it wanders from the way. */
  width: number;
  lag: number;
  stray: number;
  phase: number;
}
/** One stretch of a strand as a closed outline: smooth cubics down one side and back up the other. */
function stretch(strand: Strand, tail: number, head: number, from: number, to: number, seconds: number): Contour | null {
  const a = Math.max(from, tail),
    b = Math.min(to, head);
  if (b - a < 0.05) return null;
  const steps = Math.max(3, Math.ceil((b - a) * 4)),
    left: [number, number][] = [],
    right: [number, number][] = [];
  for (let k = 0; k <= steps; k++) {
    const u = a + ((b - a) * k) / steps,
      s = clamp01((u - tail) / (head - tail)),
      { at, across } = wayAt(u),
      // Pointed at both ends and fullest a little behind the head.
      half = (strand.width / 2) * Math.sin(Math.PI * s) ** 0.6 * (0.4 + 0.6 * s),
      // It wanders across its way in a wave that travels with it.
      off = strand.stray * Math.sin(u * 1.9 + strand.phase - seconds * 5) * Math.sin(Math.PI * s),
      x = at[0] + across[0] * off,
      y = at[1] + across[1] * off;
    left.push([x + across[0] * half, y + across[1] * half]);
    right.push([x - across[0] * half, y - across[1] * half]);
  }
  const outline = pen(left[0][0], left[0][1]).curve(...left.slice(1));
  outline.line(right[steps][0], right[steps][1]);
  return outline.curve(...right.slice(0, steps).reverse()).close();
}

/** The first two: an ash and an elm, and the breath that woke them. */
export function breathPanel(): SagaPanel {
  const scene = new SceneNode(),
    shoreShot = new SceneNode(),
    stage = new SceneNode(),
    shore = dawnShore(),
    odin = allfatherStanding(),
    ash = shoreTree(1052, 806, 340, 0.05, ashHabit, [186, 170, 148], [150, 180, 96]),
    elm = shoreTree(1238, 818, 310, -0.05, elmHabit, [146, 114, 94], [98, 154, 98]),
    trees = [ash, elm],
    behindTrees = new SceneNode(),
    beforeTrees = new SceneNode(),
    strands: Strand[] = (
      [
        [26, 0, 5, 0, breathPale, 255],
        [13, 0.7, 9, 1.9, [232, 242, 240], 220],
        [8, -0.5, 12, 3.7, [255, 252, 240], 190],
      ] as [number, number, number, number, Rgb, number][]
    ).map(([width, lag, stray, phase, tone, alpha]) => {
      const back = new ShapeNode().fill(...tone, alpha),
        front = new ShapeNode().fill(...tone, alpha);
      behindTrees.add(back);
      beforeTrees.add(front);
      return { back, front, width, lag, stray, phase };
    }),
    loose: { leaf: ShapeNode; tree: number }[] = [],
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
    // A footprint: the heel behind, the ball of the foot ahead.
    shore.ground.add(flat([lock(x - 12, y + 1, x + 13, y - 1, 9, i % 2 ? 0.08 : -0.08)], dusk(sand, 0.34), 190));
  }
  // Long shadows fall toward us and to the right, away from the low sun.
  for (const [x, y, reach] of [
    [612, 812, 270],
    [1052, 806, 300],
    [1238, 818, 280],
  ])
    shore.ground.add(flat([lock(x, y, x + reach, y + 62, 40, 0.02)], [92, 100, 96], 110));
  // Grass about the roots.
  const tufts: Form = [];
  for (const [x, y] of [
    [1006, 812],
    [1090, 810],
    [1196, 824],
    [1280, 822],
  ])
    for (let j = 0; j < 4; j++) tufts.push(lock(x + j * 7, y, x + j * 10 - 14, y - 22 - 10 * scatter(x + j, 531), 7, j % 2 ? 0.2 : -0.2));
  // He faces the trees: the traced figure looks left, so it is turned about.
  odin.scene.transform([-0.72, 0, 612, 0, 0.72, 812, 0, 0, 1]);
  for (let i = 0; i < 8; i++) {
    const tree = i % 2,
      tone: Rgb = tree === 0 ? [150, 180, 96] : [98, 154, 98];
    loose.push({ leaf: flat([trees[tree].leaf()], i % 4 < 2 ? tone : glint(tone, 0.24)), tree });
  }
  stage.add(shore.scene).add(behindTrees);
  for (const tree of trees) stage.add(tree.leaves[0]).add(tree.wood).add(tree.leaves[1]);
  stage.add(flat(tufts, [96, 132, 86])).add(odin.scene).add(beforeTrees);
  for (const { leaf } of loose) stage.add(leaf);
  shoreShot.add(stage);
  // The two faces, close: the sun between them, sea and strand behind.
  faces
    .add(backdrop([92, 100, 168], [252, 196, 146], 0, 560))
    .add(flat([hazeStreak(880, 404, 1500, 60), hazeStreak(700, 486, 1700, 64)], [255, 204, 156], 54))
    .add(new ShapeNode().appendCircle(800, 560, 124).fill(253, 226, 160))
    .add(flat([hazeStreak(840, 532, 620, 18)], [255, 212, 170], 150))
    .add(new ShapeNode().appendRect(-200, 556, sagaWidth + 400, 400).fill(84, 122, 160))
    .add(
      flat(
        [pen(-200, 700).curve([400, 676], [1200, 684], [1800, 664]).line(1800, 1100).line(-200, 1100).close()],
        sand,
      ),
    );
  faces.add(new SceneNode().add(askr.scene).add(embla.scene));
  scene.add(shoreShot).add(faces).add(lids.scene);
  const shots = [shoreShot, faces],
    // How long the breath is, in points of its way, and when its head passes each tree.
    reach = 8,
    passes = [10.5, 19.5];
  return {
    scene,
    // One sound only: the breath. The waking itself is left to the voice.
    cues: [{ at: (breathFrom - 0.1) / length, sound: 'sfx/saga/breath', volume: 0.85 }],
    pose(_beat, seconds, at) {
      cutTo(shots, shotAt([0, facesAt], at));
      // The eye opens in two goes: a first look, a blink, then all the way.
      lids.open(
        at < 0.4 ? 0.2 * easeOut(at / 0.4) : at < 0.62 ? 0.2 - 0.1 * ease((at - 0.4) / 0.22) : 0.1 + 0.9 * easeOut(ramp(at, 0.62, 1.5)),
      );
      if (at < facesAt) {
        const view = glide(shoreStops, at),
          drawn = stepped(seconds, 12),
          // Quick from his lips, then steady: the head runs the whole way and the rest follows it in.
          gone = (last + reach) * ramp(at, breathFrom, facesAt - 0.25) ** 0.9;
        frame(stage, view.x, view.y, view.zoom);
        shore.pose(seconds, ramp(at, 0, facesAt));
        odin.flutter(seconds * 0.6);
        for (const strand of strands) {
          const head = Math.min(last, gone - strand.lag),
            tail = gone - strand.lag - reach,
            back: Form = [],
            front: Form = [];
          if (at >= breathFrom && head > 0.05 && tail < last) {
            let from = 0;
            for (const [a, b] of [...behind, [last + 1, last + 1] as Vec]) {
              const before = stretch(strand, tail, head, from, a + 0.06, seconds),
                hidden = stretch(strand, tail, head, a, b + 0.06, seconds);
              if (before) front.push(before);
              if (hidden) back.push(hidden);
              from = b;
            }
          }
          trace(strand.back.reset(), back);
          trace(strand.front.reset(), front);
        }
        trees.forEach((tree, i) => {
          // As its head passes, the leaves stir and the tree begins to take the light; by the cut it is all light.
          const since = gone - passes[i],
            stir = Math.sin(Math.PI * clamp01(since / 5)),
            taking = 0.3 * ease(clamp01(since / 4)) + 0.56 * ramp(at, facesAt - 0.5, facesAt - 0.05),
            angle = 0.006 * Math.sin(drawn * 1.6 + i) + 0.016 * stir * Math.sin(drawn * 21 + i * 2);
          for (const group of tree.leaves) turn(group, tree.heart[0], tree.heart[1], angle);
          for (const pale of tree.taken) pale.opacity(alphaOf(taking));
        });
        // Leaves let go and ride the breath up round their tree, drawn on twos.
        loose.forEach(({ leaf, tree }, i) => {
          const since = (gone - passes[tree]) / 6 - 0.06 * (i >> 1),
            life = clamp01(since),
            around = i * 1.7 + life * (5 + 2 * scatter(i, 541)),
            wide = 70 + 60 * scatter(i, 542) + 50 * life,
            heart = trees[tree].heart,
            x = heart[0] + Math.cos(around) * wide,
            y = heart[1] + 40 + Math.sin(around) * wide * 0.42 - 170 * life,
            spin = drawn * 1.8 + i;
          leaf
            .transform([Math.cos(spin), -Math.sin(spin), x, Math.sin(spin), Math.cos(spin), y, 0, 0, 1])
            .opacity(since > 0 && life < 1 ? alphaOf(Math.min(1, life * 8, (1 - life) * 3)) : 0);
        });
      } else {
        const since = at - facesAt,
          woken = ease(ramp(at, wakeFrom, wakeTo)),
          drawn = stepped(at, 12),
          // Lids come up in three drawings: his as his name is said, hers as hers is.
          lidsOf = (opens: number) => ramp(drawn, opens, opens + 0.17),
          toward = 0.06 * ease(ramp(at, turnAt, turnAt + 0.35)),
          shed = ramp(at, wakeTo - 0.2, wakeTo + 1.3);
        about(faces, 800, 470, 1 + 0.05 * ease(since / (length - facesAt)));
        // The sun stands between them and a likeness is drawn lit from its left: he is turned about, so the
        // shine in his hair and his lit side face the sun as hers do.
        askr.scene.transform([-170, 0, 560, 0, 170, 414 + 2 * Math.sin(seconds * 1.1), 0, 0, 1]);
        embla.scene.transform([162, 0, 1048, 0, 162, 432 + 2 * Math.sin(seconds * 1.1 + 1.6), 0, 0, 1]);
        askr.pose(woken, lidsOf(askrOpens), -toward, shed);
        embla.pose(woken, lidsOf(emblaOpens), -toward, shed);
      }
    },
  };
}
