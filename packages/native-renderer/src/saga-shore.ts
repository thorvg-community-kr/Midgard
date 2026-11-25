// The founding shore at dawn and the two who wake on it, shared by the saga's last two beats.
import { callingOutfit, founderCast } from '../../engine/src/character-cast';
import type { Likeness } from '../../engine/src/likeness';
import { Calling } from '../../engine/src/person';
import { Mood } from '../../engine/src/person-look';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { capsule, pen } from './outline-form';
import { dusk } from './form-paint';
import { drawBust } from './calling-bust';
import { drawHead, expressionOf, portraitFinish, poseFace, type Expression, type FaceRig } from './likeness-head';
import { alphaOf, backdrop, flat, hazeStreak, lock, sagaWidth, scatter, stroke } from './saga-panel';

export const sand: Rgb = [226, 190, 140];
/** Where sky meets sea on the dawn shore. */
export const horizon = 470;
const tone = (c: { r: number; g: number; b: number }): Rgb => [c.r, c.g, c.b];

export interface DawnShore {
  scene: SceneNode;
  /** What stands out in the bay: over the sea, behind the strand. */
  water: SceneNode;
  /** Laid over the strand and under whoever stands on it: footprints, shadows. */
  ground: SceneNode;
  pose(seconds: number, risen: number): void;
}
/** Sky, a low sun, the bay and a broad strand: the stage for everything that happens on the shore. */
export function dawnShore(sunX = 430): DawnShore {
  const scene = new SceneNode(),
    sun = new SceneNode(),
    glitter = new SceneNode(),
    water = new SceneNode(),
    ground = new SceneNode();
  sun.add(new ShapeNode().appendCircle(sunX, 0, 84).fill(253, 222, 150));
  scene.add(backdrop([70, 80, 156], [252, 186, 136], 0, horizon));
  // The light of it lies along the horizon in long streaks of haze, one of them across its face: no rings round it.
  for (const [x, y, w, t, alpha] of [
    [sunX + 180, horizon - 196, 1040, 46, 34],
    [sunX - 60, horizon - 118, 1360, 58, 44],
    [sunX + 260, horizon - 44, 1700, 54, 56],
  ])
    scene.add(flat([hazeStreak(x, y, w, t)], [255, 198, 152], alpha));
  scene.add(sun).add(flat([hazeStreak(sunX + 60, horizon - 22, 560, 15)], [255, 206, 164], 150));
  // Far heights across the bay, the sea, a few bars of light on it.
  scene.add(
    flat(
      [
        pen(-200, horizon)
          .curve([-40, horizon - 30], [90, horizon - 24], [200, horizon - 58], [320, horizon - 18], [470, horizon - 30], [640, horizon])
          .close(),
      ],
      [186, 128, 150],
    ),
  );
  scene.add(new ShapeNode().appendRect(-200, horizon - 6, sagaWidth + 400, 400).fill(78, 116, 156));
  scene.add(new ShapeNode().appendRect(-200, horizon - 6, sagaWidth + 400, 44).fill(66, 100, 146, 150));
  for (const [dx, y, w] of [
    [-44, horizon + 30, 104],
    [-68, horizon + 60, 150],
    [-34, horizon + 86, 90],
    [-86, horizon + 118, 190],
  ])
    glitter.add(flat([capsule(sunX + dx, y, sunX + dx + w, y, 3.2)], [252, 226, 160]));
  scene.add(glitter).add(water);
  // The strand: wet and dark where the water has just left it, pale along its crest.
  scene.add(
    flat(
      [
        pen(-200, 668)
          .curve([200, 640], [600, 632], [1000, 618], [1400, 600], [1800, 590])
          .line(1800, 1100)
          .line(-200, 1100)
          .close(),
      ],
      dusk(sand, 0.28),
    ),
  );
  scene.add(
    flat(
      [
        pen(-200, 694)
          .curve([200, 664], [600, 656], [1000, 640], [1400, 620], [1800, 608])
          .line(1800, 1100)
          .line(-200, 1100)
          .close(),
      ],
      sand,
    ),
  );
  scene.add(
    stroke(
      [
        [-200, 692],
        [400, 658],
        [1100, 634],
        [1800, 606],
      ],
      7,
      [250, 224, 176],
    ),
  );
  // A darker fold of sand toward us, and a few shells and stones.
  scene.add(
    flat(
      [pen(-200, 840).curve([300, 812], [800, 826], [1300, 806], [1800, 836]).line(1800, 1100).line(-200, 1100).close()],
      dusk(sand, 0.12),
      170,
    ),
  );
  for (let i = 0; i < 9; i++) {
    const x = 60 + 1500 * scatter(i, 301),
      y = 720 + 150 * scatter(i, 302);
    // Nothing lies at the foot of what stands on the bank, where it would peep out from behind.
    if (x > 980 && x < 1300 && y > 770) continue;
    const w = 5 + 5 * scatter(i, 303);
    // A pebble or a shell: flat underneath, uneven on top.
    scene.add(
      flat(
        [pen(x - w, y).curve([x - w * 0.4, y - 3.6], [x + w * 0.5, y - 2.8], [x + w, y]).curve([x + w * 0.2, y + 2.2], [x - w, y]).close()],
        i % 3 ? dusk(sand, 0.3) : [248, 236, 210],
      ),
    );
  }
  scene.add(ground);
  return {
    scene,
    water,
    ground,
    pose(seconds, risen) {
      sun.translate(0, horizon - 20 - 50 * risen);
      glitter.opacity(alphaOf(0.7 + 0.3 * Math.sin(seconds * 1.3)));
    },
  };
}

export interface FounderPortrait {
  scene: SceneNode;
  /**
   * `woken` 0 is carved wood with shut eyes, 1 is alive; `lids` opens the eyes; `glance` slides
   * them aside; `shed` lets the last leaves fall from the hair.
   */
  pose(woken: number, lids: number, glance: number, shed: number): void;
}
/**
 * Askr or Embla as the game's own portrait, head at the origin in head units, drawn twice: once
 * carved of the wood they were made from, once alive. Breath is the second showing through the first.
 */
export function founderPortrait(index: 0 | 1): FounderPortrait {
  const look = founderCast[index],
    // An ash is pale and an elm ruddy; the carving keeps the same forms in three tones of one wood.
    grain: Rgb = index === 0 ? [176, 150, 116] : [158, 118, 90],
    carved: Likeness = {
      ...look,
      skin: { r: grain[0], g: grain[1], b: grain[2] },
      hair: { r: Math.round(grain[0] * 0.72), g: Math.round(grain[1] * 0.7), b: Math.round(grain[2] * 0.7) },
      wool: { r: Math.round(grain[0] * 0.86), g: Math.round(grain[1] * 0.86), b: Math.round(grain[2] * 0.86) },
      freckles: false,
    },
    build = (who: Likeness): { figure: SceneNode; rig: FaceRig; expression: Expression } => {
      const expression = expressionOf(who, Mood.Content),
        // No flush on the cheeks here: the two have only just drawn breath.
        head = drawHead(who, { ...portraitFinish, pale: true }, expression),
        outfit = callingOutfit(Calling.Settler, 0, who.wool ?? null),
        bust = drawBust(
          who,
          { calling: Calling.Settler, cloth: tone(outfit.cloth), trim: tone(outfit.trim) },
          portraitFinish,
        );
      return {
        figure: new SceneNode().add(bust.back).add(head.back).add(bust.front).add(head.front),
        rig: head.rig,
        expression,
      };
    },
    wood = build(carved),
    alive = build(look),
    leaves: SceneNode[] = [],
    scene = new SceneNode().add(alive.figure).add(wood.figure);
  // A few leaves still caught in the hair: narrow for the ash, broad for the elm.
  for (const [x, y, lean] of [
    [-0.62, -0.78, -0.5],
    [0.1, -0.98, 0.2],
    [0.66, -0.7, 0.7],
  ]) {
    const leaf = new SceneNode().add(
      flat([lock(-0.17, 0, 0.17, 0, index === 0 ? 0.13 : 0.2, 0.18)], index === 0 ? [160, 188, 104] : [106, 160, 104]),
    );
    leaf.transform([Math.cos(lean), -Math.sin(lean), x, Math.sin(lean), Math.cos(lean), y, 0, 0, 1]);
    leaves.push(leaf);
    scene.add(leaf);
  }
  const rest: [number, number, number][] = [
    [-0.62, -0.78, -0.5],
    [0.1, -0.98, 0.2],
    [0.66, -0.7, 0.7],
  ];
  return {
    scene,
    pose(woken, lids, glance, shed) {
      wood.figure.opacity(alphaOf(1 - woken));
      poseFace(wood.rig, wood.expression, 0, 0);
      poseFace(alive.rig, alive.expression, lids, glance);
      // Each leaf lets go in turn and rocks down past the shoulders.
      leaves.forEach((leaf, i) => {
        const fall = Math.max(0, Math.min(1, shed * 1.5 - i * 0.22)),
          [x, y, lean] = rest[i],
          rock = lean + fall * (i % 2 ? 2.4 : -2.2) + 0.5 * Math.sin(fall * 9 + i),
          at: [number, number] = [x + 0.5 * Math.sin(fall * 7 + i * 2) * fall, y + 3.6 * fall * fall];
        leaf
          .transform([Math.cos(rock), -Math.sin(rock), at[0], Math.sin(rock), Math.cos(rock), at[1], 0, 0, 1])
          .opacity(alphaOf((1 - fall) * 4));
      });
    },
  };
}

/** Two dark lids that part like an eye opening on the picture: 0 shut, 1 gone. */
export function eyelids(): { scene: SceneNode; open(v: number): void } {
  const dark: Rgb = [8, 8, 14],
    upper = flat(
      [pen(-200, -700).line(1800, -700).line(1800, 470).curve([1300, 420], [800, 404], [300, 420], [-200, 470]).close()],
      dark,
    ),
    lower = flat(
      [pen(-200, 1600).line(1800, 1600).line(1800, 430).curve([1300, 480], [800, 496], [300, 480], [-200, 430]).close()],
      dark,
    ),
    scene = new SceneNode().add(upper).add(lower);
  return {
    scene,
    open(v) {
      // Shut, the lids overlap; they part from the middle, as an eye does.
      upper.translate(0, 100 - 700 * v);
      lower.translate(0, -100 + 700 * v);
      scene.opacity(v >= 1 ? 0 : 255);
    },
  };
}
