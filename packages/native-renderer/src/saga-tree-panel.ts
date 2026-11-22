// Opening saga, fourth beat: the camera draws back from Midgard until it is one of nine worlds
// hung on one great tree.
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { pen, type Form } from './outline-form';
import { dusk, paintForm } from './form-paint';
import { mapSea, sagaWorlds, worldDisc } from './saga-worlds';
import {
  about,
  alphaOf,
  backdrop,
  ease,
  boardPicture,
  easeIn,
  flat,
  frame,
  leafMass,
  lock,
  ramp,
  scatter,
  settle,
  stars,
  stepped,
  type SagaArt,
  type SagaPanel,
} from './saga-panel';

const bark: Rgb = [112, 98, 122];
const barkShade: Rgb = [58, 50, 86];
const barkLit: Rgb = [156, 142, 160];
const leafDeep: Rgb = [20, 50, 74];
const leafMid: Rgb = [32, 86, 96];
const leafLit: Rgb = [76, 140, 116];
/** Midgard's place on the tree: the middle of the board, so the camera only ever draws straight back. */
const heart: readonly [number, number] = [800, 450];
const midgardRadius = 62;
/** How close the camera starts: near enough that Midgard's map fills the frame. */
const closeUp = 6.2;
const settleBack = 1.05;

/** The trunk and its limbs: one to each world above, three roots to the worlds below. */
function tree(): SceneNode {
  const scene = new SceneNode(),
    finish = { ink: 0, rim: 9 },
    trunk: Form = [
      pen(690, 1010)
        .curve([720, 880], [742, 720], [752, 560], [760, 400], [770, 250], [786, 150])
        .curve([800, 138], [814, 150])
        .curve([830, 250], [840, 400], [848, 560], [858, 720], [880, 880], [910, 1010])
        .close(),
    ],
    limbs: Form = [];
  for (const [ax, ay, tx, ty, width, bend] of [
    // Boughs to the bright worlds above and the wild ones at either hand.
    [778, 330, 512, 214, 50, 0.18],
    [822, 330, 1088, 214, 50, -0.18],
    [764, 476, 372, 462, 44, -0.1],
    [836, 476, 1228, 462, 44, 0.1],
    // Roots to the worlds below: ice, fire and the dead.
    [758, 640, 492, 704, 48, 0.14],
    [842, 640, 1108, 704, 48, -0.14],
    [800, 650, 800, 770, 40, 0],
    // Lesser boughs that carry only leaves.
    [772, 250, 620, 96, 30, 0.12],
    [828, 250, 980, 96, 30, -0.12],
    [770, 400, 420, 318, 26, 0.16],
    [830, 400, 1180, 318, 26, -0.16],
  ])
    limbs.push(lock(ax, ay, tx, ty, width, bend));
  paintForm(scene, limbs, bark, finish, barkShade);
  paintForm(scene, trunk, bark, finish, barkShade);
  // Furrows in the bark, lit on the side the starlight falls.
  for (let i = 0; i < 7; i++) {
    const x = 770 + i * 10 + 6 * scatter(i, 131),
      y = 260 + 600 * scatter(i, 132),
      length = 70 + 110 * scatter(i, 133);
    scene.add(flat([lock(x, y, x + 6, y + length, 7, 0.06)], i % 2 ? barkLit : barkShade, 170));
  }
  return scene;
}
/** A mass of leaves lit from the upper left. */
function leaves(scene: SceneNode, x: number, y: number, w: number, h: number, tone: Rgb): void {
  paintForm(scene, leafMass(x, y, w, h), tone, { ink: 0, rim: Math.max(6, h * 0.07) }, dusk(tone, 0.42));
}
/** Leaves in three depths, each a few lobed masses. */
function canopy(tone: Rgb, masses: readonly (readonly [number, number, number, number])[]): SceneNode {
  const scene = new SceneNode();
  for (const [x, y, w, h] of masses) leaves(scene, x, y, w, h, tone);
  return scene;
}

/** One tree, nine worlds: Midgard at its heart and eight lights around it. */
export function treePanel(art?: SagaArt): SagaPanel {
  const scene = new SceneNode(),
    sky = new SceneNode().add(backdrop([10, 14, 42], [34, 46, 92])).add(stars(110, 900)),
    cosmos = new SceneNode(),
    far = canopy(leafDeep, [
      [120, 120, 660, 300],
      [520, 20, 560, 280],
      [820, 120, 660, 300],
      [20, 340, 420, 230],
      [1160, 340, 420, 230],
    ]),
    mid = canopy(leafMid, [
      [250, 150, 430, 190],
      [920, 150, 430, 190],
      [600, 40, 400, 170],
      [150, 350, 300, 150],
      [1150, 350, 300, 150],
    ]),
    near = canopy(leafLit, [
      [300, 96, 190, 84],
      [1110, 96, 190, 84],
      [610, 10, 150, 70],
      [840, 10, 150, 70],
      [190, 352, 150, 70],
      [1260, 352, 150, 70],
    ]),
    midgard = new SceneNode(),
    land = new SceneNode(),
    lens = new ShapeNode(),
    ring = new ShapeNode(),
    others = sagaWorlds.map((entry) => {
      const holder = new SceneNode(),
        halo = new ShapeNode().appendCircle(0, 0, 1.5).fill(...entry.light, 60);
      holder.add(halo).add(worldDisc(entry));
      return { entry, holder, halo };
    });
  // Midgard: the map itself inside a round lens that closes about it as the camera draws back.
  const picture = new SceneNode(),
    map = boardPicture(art?.world, picture);
  land.add(new ShapeNode().appendRect(-200, -200, 2000, 1300).fill(...mapSea)).add(picture);
  land.clip(lens);
  midgard
    .add(new ShapeNode().appendCircle(heart[0], heart[1], midgardRadius + 9).fill(196, 214, 232, 70))
    .add(land)
    .add(ring);
  cosmos.add(far).add(tree()).add(mid);
  for (const { holder } of others) cosmos.add(holder);
  cosmos.add(near).add(midgard);
  scene.add(sky).add(cosmos);
  // The eight catch light one after another, clockwise from the gods' world at the crown.
  const order = [5, 3, 0, 6, 2, 1, 7, 4];
  return {
    scene,
    pose(_beat, seconds, at) {
      const back = ease(ramp(at, 0.3, 3.2)),
        // The camera settles a little further after the pull-out, then leans in for the cut.
        zoom =
          closeUp ** (1 - back) *
          settleBack ** (1 - ramp(at, 0.3, 3.9)) *
          (1 + 0.22 * easeIn(ramp(at, 3.7, 4.4))),
        closing = ease(ramp(at, 0.3, 1.9)),
        start = 1 / (closeUp * settleBack),
        // The map shrinks inside its lens until the whole continent shows in it.
        pictureScale = start * (0.118 / start) ** closing,
        radius = 940 * start * ((midgardRadius / (940 * start)) ** closing);
      frame(cosmos, heart[0], heart[1], zoom);
      // Far things move less: the stars and the deepest leaves lag behind the tree.
      about(sky, heart[0], heart[1], zoom ** 0.12);
      about(far, heart[0], heart[1], zoom ** -0.08);
      about(near, heart[0], heart[1], zoom ** 0.06, 0, 2 * Math.sin(seconds * 0.6));
      about(mid, heart[0], heart[1], 1, 0, 1.4 * Math.sin(seconds * 0.5 + 1));
      lens.reset().appendCircle(heart[0], heart[1], radius);
      ring
        .reset()
        .appendCircle(heart[0], heart[1], radius)
        .strokeWidth(Math.max(1.2, 3 / zoom))
        .strokeFill(214, 230, 244, alphaOf(0.75 * ramp(at, 0.8, 1.8)));
      map();
      about(picture, heart[0], heart[1], pictureScale);
      const drawn = stepped(at, 12);
      others.forEach(({ entry, holder, halo }, i) => {
        const lit = 1.25 + order.indexOf(i) * 0.14,
          grown = settle(ramp(drawn, lit, lit + 0.34)),
          k = 44 * grown;
        // Shown only once it has some size: nothing visible is ever scaled to nothing.
        holder.transform([k, 0, entry.tree[0], 0, k, entry.tree[1], 0, 0, 1]).opacity(grown > 0.02 ? 255 : 0);
        halo.opacity(alphaOf(0.5 + 0.3 * Math.sin(seconds * 1.7 + i * 1.3)));
      });
    },
  };
}
