// Opening saga, fifth beat: the tree's roots reach Midgard and a gate lights at each one; then
// three of them side by side, and what comes out of each.
import { MonsterRank } from '../../engine/src/combat-events';
import { DungeonKind, World } from '../../engine/src/world-types';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { capsule, oval, pen, type Form } from './outline-form';
import { dusk, paintForm } from './form-paint';
import { gateCenter, gateSprite } from './gate-sprites';
import { monsterBody, poseMonster } from './monster-figures';
import { mapSea, sagaWorlds } from './saga-worlds';
import {
  about,
  alphaOf,
  backdrop,
  clamp01,
  cutTo,
  ease,
  easeIn,
  easeOut,
  boardPicture,
  fir,
  flat,
  frame,
  glide,
  lock,
  ramp,
  sagaHeight,
  sagaWidth,
  scatter,
  settle,
  shotAt,
  stepped,
  type SagaArt,
  type SagaPanel,
  type Stop,
} from './saga-panel';

const rootDark: Rgb = [44, 38, 70];
const rootLit: Rgb = [104, 92, 132];
/** What night does to the map: every colour is multiplied by this. */
const nightTint: Rgb = [112, 126, 196];
const divider: Rgb = [12, 10, 24];
/** Where each root comes in from, beyond the frame, in the order of `sagaWorlds`. */
const rootFrom: readonly (readonly [number, number, number])[] = [
  [1720, 372, 0.1],
  [1270, -90, -0.12],
  [850, -100, 0.08],
  [350, -90, 0.12],
  [-120, 404, -0.1],
  [420, 1000, 0.12],
  [1310, 1000, -0.1],
  [1720, 730, 0.1],
];
/** The camera over the night map: it holds the whole land, then closes on the gate nearest the founding shore. */
const mapStops: readonly Stop[] = [
  { at: 0, x: 800, y: 450, zoom: 1.06 },
  { at: 4.7, x: 806, y: 448, zoom: 1.16 },
  { at: 6.85, x: sagaWorlds[0].gate[0], y: sagaWorlds[0].gate[1], zoom: 3.6 },
];
/** Seconds of the beat at which the three worlds are cut to and slid in: on "frost", "fire" and "the grave". */
const frostAt = 6.85,
  fireAt = 8.2,
  graveAt = 9.7,
  slide = 0.45,
  /** When the last of them comes up close enough to shut out the picture. */
  loomAt = 11.55;

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

/** Where the roots break the earth, and what pours through. */
export function gatesPanel(art?: SagaArt): SagaPanel {
  const scene = new SceneNode(),
    mapShot = new SceneNode(),
    land = new SceneNode().add(new ShapeNode().appendRect(-200, -200, 2000, 1300).fill(...mapSea)),
    map = boardPicture(art?.world, land),
    night = new ShapeNode().appendRect(-200, -200, 2000, 1300).fill(255, 255, 255).blend('multiply'),
    roots = sagaWorlds.map((entry, i) => {
      const [x, y, bend] = rootFrom[i],
        root = new SceneNode()
          .add(flat([lock(x, y, entry.gate[0], entry.gate[1], 96, bend)], rootDark))
          .add(flat([lock(x - 8, y - 8, entry.gate[0], entry.gate[1], 30, bend * 1.1)], rootLit, 200));
      return { root, x, y };
    }),
    lamps = sagaWorlds.map((entry) => {
      const lamp = new SceneNode(),
        halo = new ShapeNode().appendCircle(0, 0, 26).fill(...entry.light, 70),
        ring = new ShapeNode(),
        core = new SceneNode()
          .add(new ShapeNode().appendCircle(0, 0, 11).fill(...dusk(entry.light, 0.4)))
          .add(new ShapeNode().appendCircle(-1.5, -1.5, 9).fill(...entry.light));
      lamp.add(halo).add(ring).add(core).translate(entry.gate[0], entry.gate[1]);
      return { entry, lamp, halo, ring, core };
    }),
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
  // The tint lies between the land and what is laid over it, and is not moved by the camera: a
  // multiply layer stretched far past the frame by a close-up is more than the renderer should be asked for.
  const over = new SceneNode();
  mapShot.add(land).add(night).add(over);
  for (const { root } of roots) over.add(root);
  for (const { lamp } of lamps) over.add(lamp);
  for (const bar of bars) triptych.add(bar);
  scene.add(mapShot).add(triptych).add(last.scene).add(dark);
  const shots = [mapShot, triptych];
  return {
    scene,
    // The roots work their way in; then each world's brood is heard as its gate is shown.
    cues: [
      { at: 0.3 / 12.8, sound: 'sfx/saga/roots', volume: 0.75 },
      { at: (frostAt + 0.1) / 12.8, sound: 'sfx/combat/spawn_01', volume: 0.6 },
      { at: (fireAt + 0.1) / 12.8, sound: 'sfx/combat/spawn_03', volume: 0.6 },
      { at: (graveAt + 0.1) / 12.8, sound: 'sfx/combat/spawn_02', volume: 0.6 },
    ],
    pose(_beat, seconds, at) {
      cutTo(shots, shotAt([0, frostAt], at));
      if (at < frostAt) {
        const view = glide(mapStops, at);
        frame(land, view.x, view.y, view.zoom);
        frame(over, view.x, view.y, view.zoom);
        map();
        // Night comes down over the land as the roots come in. The tint itself darkens: a multiply
        // layer that is merely faint blackens what lies under it.
        const fallen = ease(ramp(at, 0, 1.3));
        night.fill(
          Math.round(255 + (nightTint[0] - 255) * fallen),
          Math.round(255 + (nightTint[1] - 255) * fallen),
          Math.round(255 + (nightTint[2] - 255) * fallen),
        );
        const drawn = stepped(at, 12);
        roots.forEach(({ root, x, y }, i) => {
          const grown = easeOut(ramp(at, 0.35 + i * 0.13, 1.5 + i * 0.13));
          about(root, x, y, 0.12 + 0.88 * grown);
          root.opacity(alphaOf(grown * 4));
        });
        lamps.forEach(({ lamp, halo, ring }, i) => {
          const lit = 2.45 + i * 0.19,
            caught = settle(ramp(drawn, lit, lit + 0.3)),
            spread = ramp(at, lit, lit + 0.7);
          // Shown only once it has some size: nothing visible is ever scaled to nothing.
          lamp.opacity(caught > 0.02 ? 255 : 0);
          about(lamp, 0, 0, caught, lamps[i].entry.gate[0], lamps[i].entry.gate[1]);
          halo.opacity(alphaOf(0.6 + 0.4 * Math.sin(seconds * 2 + i * 1.9)));
          ring
            .reset()
            .appendCircle(0, 0, 12 + 40 * easeOut(spread))
            .strokeWidth(3)
            .strokeFill(...lamps[i].entry.light, alphaOf(0.8 * (1 - spread)));
        });
      } else {
        // One world fills the frame, then gives up half and then a third of it as the others slide in.
        const second = easeOut(ramp(at, fireAt, fireAt + slide)),
          third = easeOut(ramp(at, graveAt, graveAt + slide)),
          first = sagaWidth - (sagaWidth / 2) * second - (sagaWidth / 2 - sagaWidth / 3) * third,
          other = sagaWidth - (sagaWidth / 3) * third,
          edges = [0, first, at < fireAt ? sagaWidth : other, sagaWidth],
          opened = [frostAt, fireAt, graveAt];
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
      }
      // The last one through comes up in front of everything and shuts out the picture.
      const loom = easeIn(ramp(at, loomAt, loomAt + 0.85)),
        size = 2.4 + 5.2 * loom;
      last.scene.transform([size, 0, 800, 0, size, 1500 - 1160 * loom, 0, 0, 1]).opacity(at >= loomAt ? 255 : 0);
      last.eyes.opacity(at < loomAt + 0.62 ? 255 : 0);
      dark.opacity(alphaOf(ramp(at, loomAt + 0.7, loomAt + 0.95)));
    },
  };
}
