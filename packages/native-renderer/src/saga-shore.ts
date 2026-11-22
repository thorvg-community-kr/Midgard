// The founding shore at dawn and the two who wake on it, shared by the saga's last two beats.
import { callingOutfit, founderCast } from '../../engine/src/character-cast';
import type { Likeness } from '../../engine/src/likeness';
import { Calling } from '../../engine/src/person';
import { Mood } from '../../engine/src/person-look';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { capsule, oval, pen, type Form } from './outline-form';
import { dusk, paintForm } from './form-paint';
import { drawBust } from './calling-bust';
import { drawHead, expressionOf, portraitFinish, poseFace, type Expression, type FaceRig } from './likeness-head';
import { alphaOf, backdrop, flat, lock, sagaWidth, scatter, stroke } from './saga-panel';

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
  for (const [r, alpha] of [
    [620, 30],
    [440, 38],
    [290, 46],
    [170, 54],
  ])
    sun.add(new ShapeNode().appendCircle(sunX, 0, r, r * 0.66).fill(255, 196, 150, alpha));
  sun.add(new ShapeNode().appendCircle(sunX, 0, 84).fill(253, 222, 150));
  scene.add(backdrop([70, 80, 156], [252, 186, 136], 0, horizon)).add(sun);
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
  for (let i = 0; i < 9; i++)
    scene.add(
      flat(
        [oval(60 + 1500 * scatter(i, 301), 720 + 150 * scatter(i, 302), 5 + 5 * scatter(i, 303), 3.5)],
        i % 3 ? dusk(sand, 0.3) : [248, 236, 210],
      ),
    );
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

/**
 * One of the two founders from behind, in the game's own small round build: feet at the origin,
 * about 112 tall. Askr wears his hair as a mane, Embla hers in a side braid.
 */
export function founderBack(index: 0 | 1): SceneNode {
  const look = founderCast[index],
    hair = tone(look.hair),
    skin = tone(look.skin),
    wool = look.wool ? tone(look.wool) : ([96, 116, 110] as Rgb),
    braid = index === 1,
    scene = new SceneNode(),
    finish = { ink: 0, rim: 4 },
    linen: Rgb = [228, 216, 192];
  paintForm(scene, [capsule(-10, -24, -11, -5, 8, 7), capsule(10, -24, 11, -5, 8, 7)], [96, 84, 86], finish);
  paintForm(scene, [oval(-12, -2, 10, 6), oval(12, -2, 10, 6)], [78, 62, 58], { ink: 0, rim: 2 });
  paintForm(
    scene,
    [capsule(-23, -52, -27, -30, 7, 6), capsule(23, -52, 27, -30, 7, 6)],
    dusk(wool, 0.1),
    finish,
  );
  scene.add(flat([oval(-28, -26, 6, 6), oval(28, -26, 6, 6)], skin));
  paintForm(
    scene,
    [
      pen(-20, -60)
        .curve([-26, -42], [-28, -20])
        .curve([-14, -15], [0, -17], [14, -15], [28, -20])
        .curve([26, -42], [20, -60])
        .curve([0, -66], [-20, -60])
        .close(),
    ],
    wool,
    finish,
  );
  scene.add(
    flat(
      [
        pen(-28, -24)
          .curve([-14, -19], [0, -21], [14, -19], [28, -24])
          .curve([28, -19], [0, -15], [-28, -19])
          .close(),
      ],
      linen,
    ),
  );
  scene.add(flat([oval(-33, -82, 6, 8), oval(33, -82, 6, 8)], skin));
  const head: Form = braid
    ? [
        pen(-33, -84)
          .curve([-34, -112], [0, -120], [34, -112], [33, -84])
          .curve([32, -62], [14, -54], [0, -53], [-14, -54], [-32, -62])
          .close(),
        oval(22, -56, 8, 9),
        oval(25, -43, 7, 8),
        oval(27, -31, 6, 7),
        lock(28, -24, 30, -8, 9, 0.1),
      ]
    : [
        pen(-34, -84)
          .curve([-35, -113], [0, -121], [35, -113], [34, -84])
          .curve([36, -66], [30, -54])
          .curve([20, -58], [10, -50], [0, -56], [-10, -50], [-20, -58], [-30, -54])
          .curve([-36, -66], [-34, -84])
          .close(),
        ...[0, 1, 2, 3, 4].map((i) => lock(-24 + i * 12, -58, -27 + i * 13.5, -42 - (i % 2) * 5, 12, 0)),
      ];
  paintForm(scene, head, hair, finish);
  return scene;
}

export interface FounderPortrait {
  scene: SceneNode;
  /** `woken` 0 is carved wood with shut eyes, 1 is alive; `lids` opens the eyes; `glance` slides them aside. */
  pose(woken: number, lids: number, glance: number): void;
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
        head = drawHead(who, portraitFinish, expression),
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
    scene = new SceneNode().add(alive.figure).add(wood.figure);
  return {
    scene,
    pose(woken, lids, glance) {
      wood.figure.opacity(alphaOf(1 - woken));
      poseFace(wood.rig, wood.expression, 0, 0);
      poseFace(alive.rig, alive.expression, lids, glance);
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
