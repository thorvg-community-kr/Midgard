// Opening saga, fifth beat: a gate of the game fills the frame, then two more slide in beside it,
// and each lets out the creatures of its world.
import { MonsterRank } from '../../engine/src/combat-events';
import { DungeonKind, World } from '../../engine/src/world-types';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { capsule, oval, pen, type Form } from './outline-form';
import { paintForm } from './form-paint';
import { gateCenter, gateSprite } from './gate-sprites';
import { monsterBody, poseMonster } from './monster-figures';
import {
  about,
  alphaOf,
  backdrop,
  clamp01,
  easeIn,
  easeOut,
  fir,
  flat,
  lock,
  ramp,
  sagaHeight,
  sagaWidth,
  scatter,
  stepped,
  type SagaPanel,
} from './saga-panel';

const divider: Rgb = [12, 10, 24];
/** Seconds of the beat at which the second and third worlds slide in: on "fire" and "the grave". */
const fireAt = 6.2,
  graveAt = 7.45,
  slide = 0.45,
  /** When the last of them comes up close enough to shut out the picture. */
  loomAt = 8.7;
const length = 9.9;

interface Walker {
  body: SceneNode;
  holder: SceneNode;
  /** Seconds after its panel opens that it steps out. */
  from: number;
  /** Where on the board it leaves the frame. */
  to: readonly [number, number];
  /** Seconds it takes from the gate to the edge. */
  walk: number;
  size: number;
}
interface Realm {
  scene: SceneNode;
  /** `since` is seconds since it came on; `width` is how much of the board it has, so it can fill it. */
  pose(seconds: number, since: number, width: number): void;
}
/** Snow, embers or mist: specks that drift one way and come round again. */
function drift(count: number, tone: Rgb, salt: number): { scene: SceneNode; pose(seconds: number, rise: number): void } {
  const scene = new SceneNode(),
    specks: ShapeNode[] = [];
  for (let i = 0; i < count; i++) {
    const speck = new ShapeNode().appendCircle(0, 0, 2 + 3 * scatter(i, salt)).fill(...tone, 200);
    specks.push(speck);
    scene.add(speck);
  }
  return {
    scene,
    pose(seconds, rise) {
      specks.forEach((speck, i) => {
        const life = (seconds * (0.06 + 0.07 * scatter(i, salt + 1)) + scatter(i, salt + 2)) % 1,
          x = 540 + 520 * scatter(i, salt + 3) + 24 * Math.sin(seconds * 0.8 + i),
          y = rise > 0 ? 880 - 760 * life : 40 + 820 * life;
        speck.translate(x, y).opacity(alphaOf(Math.sin(life * Math.PI)));
      });
    },
  };
}
/**
 * One gate of the game and the creatures of its lair coming out of it, drawn on the whole board
 * about its middle so it reads alone and as a third of a split frame.
 */
function realm(
  kind: DungeonKind,
  world: World,
  sky: readonly [Rgb, Rgb],
  dress: (back: SceneNode, front: SceneNode) => (seconds: number) => void,
  ranks: readonly MonsterRank[],
): Realm {
  const scene = new SceneNode(),
    back = new SceneNode(),
    front = new SceneNode(),
    gate = new SceneNode(),
    lights = new SceneNode(),
    crowd = new SceneNode(),
    site = { name: '', kind, origin: { x: 0, y: 0 }, discovered: true },
    c = gateCenter(site),
    k = 3.3,
    mouth: readonly [number, number] = [800, 520],
    pulse = gateSprite(gate, lights, { site, world, sealed: false }),
    walkers: Walker[] = [];
  scene.add(backdrop(sky[0], sky[1], 0, 620)).add(back);
  const weather = dress(back, front),
    holder = new SceneNode().add(lights).add(gate);
  holder.transform([k, 0, mouth[0] - c.x * k, 0, k, 470 - c.y * k, 0, 0, 1]);
  scene.add(holder).add(crowd).add(front);
  ranks.forEach((rank, i) => {
    const body = new SceneNode(),
      figure = new SceneNode(),
      shadow = monsterBody(body, kind, 11 + i * 7, rank);
    figure.add(shadow).add(body);
    walkers.push({
      body,
      holder: figure,
      from: 0.1 + i * 0.44,
      // They fan out toward the viewer, alternating sides, inside the middle third of the board.
      to: [800 + (i % 2 ? 1 : -1) * (50 + 150 * scatter(i, 91 + kind)), 1040],
      walk: 2.5 + 0.7 * scatter(i, 93 + kind),
      size: rank === MonsterRank.Brute ? 3.4 : rank === MonsterRank.Grunt ? 3 : 2.6,
    });
  });
  // Those that left first are nearest, so they are drawn last.
  for (const walker of [...walkers].reverse()) crowd.add(walker.holder);
  let last = -1;
  return {
    scene,
    pose(seconds, since, width) {
      const dt = last < 0 ? 0 : clamp01((seconds - last) / 0.1) * 0.1,
        // Alone it is framed close on the gate; it draws back as it gives up room to the others.
        close = 1 + 0.8 * clamp01((width - sagaWidth / 3) / (sagaWidth - sagaWidth / 3));
      last = seconds;
      weather(seconds);
      pulse?.opacity(alphaOf(0.72 + 0.28 * Math.sin(seconds * 2.4)));
      about(scene, 800, 500, close * (1 + 0.05 * clamp01(since / 6)));
      for (const walker of walkers) {
        // Each comes on again once it has gone, so the gate never runs dry.
        const span = walker.walk + 0.9,
          age = since - walker.from,
          go = age < 0 ? -1 : (age % span) / walker.walk;
        if (go < 0 || go >= 1) {
          walker.holder.opacity(0);
          continue;
        }
        const size = walker.size * (0.6 + 1.3 * go),
          x = mouth[0] + (walker.to[0] - mouth[0]) * go,
          y = mouth[1] + (walker.to[1] - mouth[1]) * go * go,
          facing = walker.to[0] < mouth[0] ? -1 : 1;
        walker.holder.transform([size * facing, 0, x, 0, size, y, 0, 0, 1]).opacity(alphaOf(go / 0.12));
        // Drawn on twos: a pack runs with a held pose, as the game thins a crowd.
        poseMonster(walker.body, { walking: true, moved: 2.4 * dt, blow: -1, clock: seconds, hold: 2 });
      }
    },
  };
}
const snowFir = (x: number, y: number, h: number): Form => fir(x, y, h);
/** What one gate lets out while the saga watches: mostly the small quick ones, as in the game. */
const pack: readonly MonsterRank[] = [
  MonsterRank.Swarmer,
  MonsterRank.Swarmer,
  MonsterRank.Grunt,
  MonsterRank.Swarmer,
  MonsterRank.Swarmer,
  MonsterRank.Brute,
  MonsterRank.Swarmer,
  MonsterRank.Swarmer,
];
const frostSky: readonly [Rgb, Rgb] = [
  [18, 28, 70],
  [86, 118, 168],
];
/** Snow hills, a white field and a few firs, with snow falling in front. */
function frostDress(back: SceneNode, front: SceneNode): (seconds: number) => void {
  const snow = drift(34, [236, 244, 252], 201);
  back.add(
    flat(
      [pen(-200, 560).curve([200, 430], [420, 470], [640, 380], [820, 450], [1040, 360], [1320, 470], [1800, 420]).line(1800, 700).line(-200, 700).close()],
      [104, 132, 178],
    ),
  );
  paintForm(
    back,
    [pen(-200, 600).curve([300, 560], [800, 580], [1300, 556], [1800, 600]).line(1800, 1100).line(-200, 1100).close()],
    [206, 222, 240],
    { ink: 0, rim: 14 },
    [150, 174, 212],
  );
  const wood: Form = [];
  for (const [x, y, h] of [
    [560, 640, 150],
    [612, 610, 110],
    [1010, 632, 160],
    [1064, 606, 104],
  ])
    wood.push(...snowFir(x, y, h));
  back.add(flat(wood, [44, 72, 104]));
  front.add(snow.scene);
  return (seconds) => snow.pose(seconds, 0);
}
/** Frost: a cave in the snow under a cold sky. */
function frostRealm(): Realm {
  return realm(DungeonKind.Cave, World.Jotunheim, frostSky, frostDress, pack);
}
/**
 * The same cave alone, for the saga's last order: open with its world's light in it, or shut
 * behind the slab and rune the game sets on a sealed gate. Its mouth is at the middle of the board.
 */
export function frostGate(): { scene: SceneNode; pose(seconds: number, sealed: boolean): void } {
  const scene = new SceneNode(),
    back = new SceneNode(),
    front = new SceneNode(),
    site = { name: '', kind: DungeonKind.Cave, origin: { x: 0, y: 0 }, discovered: true },
    c = gateCenter(site),
    k = 6.4,
    build = (sealed: boolean) => {
      const gate = new SceneNode(),
        lights = new SceneNode(),
        pulse = gateSprite(gate, lights, { site, world: World.Jotunheim, sealed }),
        holder = new SceneNode().add(lights).add(gate);
      holder.transform([k, 0, 800 - c.x * k, 0, k, 470 - (c.y - 9) * k, 0, 0, 1]);
      return { holder, pulse };
    },
    open = build(false),
    shut = build(true);
  scene.add(backdrop(frostSky[0], frostSky[1], 0, 620)).add(back);
  const weather = frostDress(back, front);
  scene.add(open.holder).add(shut.holder).add(front);
  return {
    scene,
    pose(seconds, sealed) {
      weather(seconds);
      open.holder.opacity(sealed ? 0 : 255);
      shut.holder.opacity(sealed ? 255 : 0);
      open.pulse?.opacity(alphaOf(0.72 + 0.28 * Math.sin(seconds * 2.4)));
    },
  };
}
/** Fire: a broken hall on black rock, the sky burning behind it. */
function fireRealm(): Realm {
  return realm(
    DungeonKind.Ruin,
    World.Muspelheim,
    [
      [34, 12, 34],
      [196, 78, 36],
    ],
    (back, front) => {
      const embers = drift(26, [250, 164, 80], 211),
        seams = new SceneNode();
      back.add(
        flat(
          [pen(-200, 600).curve([300, 520], [560, 540], [700, 470], [800, 400], [900, 470], [1040, 540], [1300, 520], [1800, 600]).line(1800, 700).line(-200, 700).close()],
          [84, 30, 44],
        ),
      );
      paintForm(
        back,
        [pen(-200, 600).curve([300, 572], [800, 590], [1300, 568], [1800, 600]).line(1800, 1100).line(-200, 1100).close()],
        [70, 46, 56],
        { ink: 0, rim: 12 },
        [40, 26, 44],
      );
      for (let i = 0; i < 7; i++) {
        const x = 560 + 480 * scatter(i, 221),
          y = 650 + 220 * scatter(i, 222),
          reach = 60 + 90 * scatter(i, 223);
        seams.add(flat([lock(x, y, x + reach, y + 26 - 52 * scatter(i, 224), 9, 0.2)], [244, 132, 52]));
      }
      back.add(seams);
      front.add(embers.scene);
      return (seconds) => {
        embers.pose(seconds, 1);
        seams.opacity(alphaOf(0.7 + 0.3 * Math.sin(stepped(seconds, 8) * 3.1)));
      };
    },
    pack,
  );
}
/** The grave: a barrow among dead trees, mist lying on the ground. */
function graveRealm(): Realm {
  return realm(
    DungeonKind.Crypt,
    World.Helheim,
    [
      [14, 20, 38],
      [74, 96, 104],
    ],
    (back, front) => {
      // Mist in long flat wisps that slide past one another.
      const mists = [
        [640, 668, 230, 16, 60],
        [930, 700, 260, 18, 52],
        [700, 760, 300, 20, 66],
        [960, 820, 280, 22, 58],
        [660, 868, 340, 24, 70],
      ].map(([x, y, rx, ry, alpha]) => {
        const layer = flat([oval(x, y, rx, ry)], [186, 204, 196], alpha);
        front.add(layer);
        return layer;
      });
      back.add(new ShapeNode().appendCircle(960, 190, 54).fill(214, 224, 210));
      back.add(new ShapeNode().appendCircle(984, 176, 50).fill(30, 40, 56));
      back.add(
        flat(
          [pen(-200, 590).curve([300, 520], [620, 560], [800, 500], [980, 560], [1300, 520], [1800, 590]).line(1800, 700).line(-200, 700).close()],
          [40, 56, 66],
        ),
      );
      paintForm(
        back,
        [pen(-200, 600).curve([300, 574], [800, 590], [1300, 570], [1800, 600]).line(1800, 1100).line(-200, 1100).close()],
        [70, 88, 78],
        { ink: 0, rim: 12 },
        [40, 54, 60],
      );
      // Bare trees either side: a trunk and three hooked boughs each.
      const snags: Form = [];
      for (const [x, lean] of [
        [588, -1],
        [1016, 1],
      ]) {
        snags.push(capsule(x, 660, x + lean * 14, 470, 11, 5));
        snags.push(lock(x + lean * 6, 560, x - lean * 70, 470, 12, lean * 0.2));
        snags.push(lock(x + lean * 10, 520, x + lean * 78, 440, 11, -lean * 0.2));
        snags.push(lock(x + lean * 12, 490, x - lean * 34, 410, 9, lean * 0.18));
      }
      back.add(flat(snags, [22, 28, 40]));
      return (seconds) => mists.forEach((layer, i) => layer.translate(34 * Math.sin(seconds * 0.3 + i * 2), 0));
    },
    pack,
  );
}
/** A hunched horned head, about the origin and 240 across: the last thing through, close enough to fill the frame. */
function loomer(): { scene: SceneNode; eyes: SceneNode } {
  const scene = new SceneNode(),
    eyes = new SceneNode(),
    shade: Rgb = [10, 8, 18];
  scene.add(
    flat(
      [
        pen(-130, 200).curve([-150, 40], [-96, -70], [0, -96], [96, -70], [150, 40], [130, 200]).close(),
        lock(-70, -60, -150, -190, 54, -0.16),
        lock(70, -60, 150, -190, 54, 0.16),
      ],
      shade,
    ),
  );
  for (const side of [-1, 1]) eyes.add(flat([oval(side * 44, -10, 15, 11)], [232, 134, 70]));
  scene.add(eyes);
  return { scene, eyes };
}

/** A gate from each world, and what pours through. */
export function gatesPanel(): SagaPanel {
  const scene = new SceneNode(),
    triptych = new SceneNode(),
    realms = [frostRealm(), fireRealm(), graveRealm()],
    slots = realms.map((made) => {
      const window = new SceneNode().add(made.scene),
        mask = new ShapeNode();
      window.clip(mask);
      triptych.add(window);
      return { made, window, mask };
    }),
    bars = [new ShapeNode(), new ShapeNode()],
    last = loomer(),
    dark = new ShapeNode().appendRect(-200, -200, 2000, 1300).fill(8, 8, 14);
  for (const bar of bars) triptych.add(bar);
  scene.add(triptych).add(last.scene).add(dark);
  return {
    scene,
    // Each world's brood is heard as its gate is shown.
    cues: [
      { at: 0.15 / length, sound: 'sfx/combat/spawn_01', volume: 0.6 },
      { at: (fireAt + 0.1) / length, sound: 'sfx/combat/spawn_03', volume: 0.6 },
      { at: (graveAt + 0.1) / length, sound: 'sfx/combat/spawn_02', volume: 0.6 },
    ],
    pose(_beat, seconds, at) {
      // One world fills the frame, then gives up half and then a third of it as the others slide in.
      const second = easeOut(ramp(at, fireAt, fireAt + slide)),
        third = easeOut(ramp(at, graveAt, graveAt + slide)),
        first = sagaWidth - (sagaWidth / 2) * second - (sagaWidth / 2 - sagaWidth / 3) * third,
        other = sagaWidth - (sagaWidth / 3) * third,
        edges = [0, first, at < fireAt ? sagaWidth : other, sagaWidth],
        opened = [0, fireAt, graveAt];
      slots.forEach(({ made, window, mask }, i) => {
        const from = edges[i],
          to = i === 2 ? sagaWidth : edges[i + 1],
          shown = at >= opened[i] && to - from > 1;
        window.opacity(shown ? 255 : 0);
        if (!shown) return;
        mask.reset().appendRect(from, 0, to - from, sagaHeight);
        window.translate((from + to) / 2 - sagaWidth / 2, 0);
        made.pose(seconds, at - opened[i], to - from);
      });
      bars.forEach((bar, i) => {
        const x = i === 0 ? first : other,
          shown = at >= opened[i + 1];
        bar.opacity(shown ? 255 : 0);
        if (shown) bar.reset().appendRect(x - 4, 0, 8, sagaHeight).fill(...divider);
      });
      // The last one through comes up in front of everything and shuts out the picture.
      const loom = easeIn(ramp(at, loomAt, loomAt + 0.85)),
        size = 2.4 + 5.2 * loom;
      last.scene.transform([size, 0, 800, 0, size, 1500 - 1160 * loom, 0, 0, 1]).opacity(at >= loomAt ? 255 : 0);
      last.eyes.opacity(at < loomAt + 0.62 ? 255 : 0);
      dark.opacity(alphaOf(ramp(at, loomAt + 0.7, loomAt + 0.95)));
    },
  };
}
