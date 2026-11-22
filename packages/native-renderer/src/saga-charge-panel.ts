// Opening saga, last beat: the two on the shore under Odin's statue, then the three things asked
// of the player as close shots cut on one round shape, and the whole of Midgard with its gates.
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { capsule, oval, pen, type Form } from './outline-form';
import { dusk, glint, paintForm } from './form-paint';
import { frostGate } from './saga-gates-panel';
import { dawnShore, founderBack, sand } from './saga-shore';
import { foundingShore, mapSea, sagaWorlds } from './saga-worlds';
import { paintYmir } from './ymir-statue';
import {
  about,
  alphaOf,
  backdrop,
  cutTo,
  ease,
  boardPicture,
  easeOut,
  flat,
  frame,
  glide,
  lock,
  ramp,
  raven,
  scatter,
  settle,
  shotAt,
  span,
  stepped,
  type SagaArt,
  type SagaPanel,
  type Stop,
} from './saga-panel';

/** Seconds of the beat each shot starts: the shore, the hearth, the shield, the gate, the map. */
const starts = [0, 4.45, 6.4, 8.7, 11];
/** When the slab comes down, on "seal". */
const sealedAt = 9.72;
/** The round shape every close shot is cut on: the hearth's ring, the shield, the mouth of the gate. */
const round: readonly [number, number] = [800, 470];
const shoreStops: readonly Stop[] = [
  { at: 0, x: 960, y: 610, zoom: 1.6 },
  { at: 4.45, x: 800, y: 452, zoom: 1.02 },
];
/** The last look: from the founding shore out to the whole land. */
const mapStops: readonly Stop[] = [
  { at: starts[4], x: foundingShore[0] - 60, y: foundingShore[1] + 30, zoom: 2.3 },
  { at: starts[4] + 2.5, x: 800, y: 450, zoom: 1.04 },
  { at: 14.2, x: 800, y: 450, zoom: 1 },
];
const duskTint: Rgb = [150, 150, 206];
const iron: Rgb = [164, 170, 182];

/** A fire in a ring of stones seen from above, with the makings of a camp at the edges of the frame. */
function hearth(): { scene: SceneNode; pose(seconds: number, since: number): void } {
  const scene = new SceneNode(),
    warmth = new ShapeNode().appendCircle(round[0], round[1], 330).fill(250, 176, 96, 46),
    flames = new SceneNode(),
    tongues: SceneNode[] = [],
    sparks: ShapeNode[] = [],
    stones: Form = [];
  scene.add(backdrop(dusk(sand, 0.06), dusk(sand, 0.2))).add(warmth);
  // A hide tent's corner, a bedroll and a bowl: enough to call it home.
  paintForm(scene, [pen(-40, -40).line(430, -40).line(250, 250).line(-40, 330).close()], [176, 146, 112], { ink: 0, rim: 10 });
  scene.add(flat([pen(250, 250).line(430, -40).line(452, -40).line(268, 262).close()], [112, 88, 70]));
  paintForm(scene, [capsule(1180, 760, 1470, 700, 46)], [150, 96, 84], { ink: 0, rim: 8 });
  scene.add(flat([capsule(1206, 754, 1228, 750, 46), capsule(1400, 714, 1422, 710, 46)], [210, 190, 156]));
  paintForm(scene, [oval(1330, 240, 62)], [150, 112, 78], { ink: 0, rim: 7 });
  scene.add(flat([oval(1330, 240, 44)], [96, 70, 52]));
  // The ring: eleven stones, each its own size.
  for (let i = 0; i < 11; i++) {
    const turn = (i / 11) * Math.PI * 2 + 0.2,
      r = 34 + 14 * scatter(i, 401);
    stones.push(oval(round[0] + Math.cos(turn) * 178, round[1] + Math.sin(turn) * 178, r, r * 0.84));
  }
  scene.add(flat([oval(round[0] + 10, round[1] + 12, 214)], dusk(sand, 0.34), 150));
  paintForm(scene, stones, [156, 156, 168], { ink: 0, rim: 7 }, [92, 92, 116]);
  scene.add(flat([oval(round[0], round[1], 138)], [66, 56, 60]));
  paintForm(
    scene,
    [capsule(700, 520, 900, 420, 22), capsule(706, 414, 896, 524, 22), capsule(800, 362, 800, 580, 20)],
    [132, 92, 60],
    { ink: 0, rim: 5 },
  );
  for (const [dx, dy, size] of [
    [-34, 12, 0.8],
    [0, -6, 1.1],
    [36, 14, 0.74],
  ]) {
    const tongue = new SceneNode()
      .add(flat([lock(-34, 30, 0, -110, 76, 0.1)], [240, 132, 56]))
      .add(flat([lock(-16, 26, 0, -62, 38, 0.08)], [252, 214, 120]));
    tongue.transform([size, 0, round[0] + dx, 0, size, round[1] + dy, 0, 0, 1]);
    tongues.push(tongue);
    flames.add(tongue);
  }
  for (let i = 0; i < 9; i++) {
    const spark = new ShapeNode().appendCircle(0, 0, 3 + 3 * scatter(i, 402)).fill(252, 206, 120);
    sparks.push(spark);
    flames.add(spark);
  }
  scene.add(flames);
  return {
    scene,
    pose(seconds, since) {
      // The fire catches in the first half second and is drawn on threes, like something alive.
      const caught = settle(ramp(since, 0.12, 0.62)),
        drawn = stepped(seconds, 8);
      tongues.forEach((tongue, i) => {
        const size = caught * ([0.8, 1.1, 0.74][i] + 0.14 * Math.sin(drawn * 9 + i * 2.1)),
          lean = 0.16 * Math.sin(drawn * 7 + i * 1.7);
        tongue.opacity(size > 0.02 ? 255 : 0);
        if (size <= 0.02) return;
        tongue.transform([
          size,
          lean * size,
          round[0] + [-34, 0, 36][i],
          0,
          size,
          round[1] + [12, -6, 14][i],
          0,
          0,
          1,
        ]);
      });
      sparks.forEach((spark, i) => {
        const life = (seconds * (0.5 + 0.4 * scatter(i, 403)) + scatter(i, 404)) % 1,
          turn = i * 2.4;
        spark
          .translate(round[0] + Math.cos(turn) * 150 * life, round[1] - 40 + Math.sin(turn) * 110 * life - 60 * life)
          .opacity(alphaOf(caught * Math.sin(life * Math.PI)));
      });
      warmth.opacity(alphaOf(caught * (0.8 + 0.2 * Math.sin(drawn * 5))));
      about(scene, round[0], round[1], 1.06 - 0.06 * ease(since / 2));
    },
  };
}
/** A round shield laid on the ground with a spear and an axe: the makings of a fighter. */
function arms(): { scene: SceneNode; pose(seconds: number, since: number): void } {
  const scene = new SceneNode(),
    shield = new SceneNode(),
    gleam = new ShapeNode(),
    wood: Rgb = [150, 112, 78],
    blue: Rgb = [88, 114, 128],
    green: Rgb = [106, 124, 90];
  scene.add(backdrop(dusk(sand, 0.1), dusk(sand, 0.26)));
  // The spear lies across the frame behind the shield; the axe below it.
  paintForm(scene, [capsule(120, 800, 1480, 130, 11)], [140, 100, 66], { ink: 0, rim: 4 });
  paintForm(scene, [lock(1440, 150, 1596, 72, 54, 0.02)], iron, { ink: 0, rim: 6 }, dusk(iron, 0.4));
  paintForm(scene, [capsule(1010, 800, 1420, 620, 13)], [128, 90, 60], { ink: 0, rim: 4 });
  paintForm(
    scene,
    [pen(1370, 560).curve([1450, 560], [1500, 620], [1490, 720]).curve([1440, 690], [1396, 680]).close()],
    iron,
    { ink: 0, rim: 7 },
    dusk(iron, 0.4),
  );
  // The shield: quartered in the two founders' wool, an iron rim and boss.
  shield.add(flat([oval(round[0] + 14, round[1] + 16, 212)], dusk(sand, 0.4), 150));
  paintForm(shield, [oval(round[0], round[1], 204)], iron, { ink: 0, rim: 9 }, dusk(iron, 0.42));
  shield.add(flat([oval(round[0], round[1], 184)], blue));
  const quarter = (from: number): Form => {
    const outline = pen(round[0], round[1]);
    for (let i = 0; i <= 6; i++) {
      const turn = from + (i / 6) * (Math.PI / 2);
      outline.line(round[0] + Math.cos(turn) * 184, round[1] + Math.sin(turn) * 184);
    }
    return [outline.close()];
  };
  shield.add(flat([...quarter(0), ...quarter(Math.PI)], green));
  // Planks: thin seams of the darker wood showing through the paint.
  for (const dx of [-110, -55, 0, 55, 110]) {
    const half = Math.sqrt(184 * 184 - dx * dx);
    shield.add(flat([capsule(round[0] + dx, round[1] - half + 6, round[0] + dx, round[1] + half - 6, 1.6)], dusk(wood, 0.5), 150));
  }
  paintForm(shield, [oval(round[0], round[1], 54)], iron, { ink: 0, rim: 7 }, dusk(iron, 0.42));
  shield.add(flat([oval(round[0] - 12, round[1] - 14, 18, 14)], glint(iron, 0.6)));
  for (let i = 0; i < 8; i++) {
    const turn = (i / 8) * Math.PI * 2 + 0.39;
    shield.add(flat([oval(round[0] + Math.cos(turn) * 194, round[1] + Math.sin(turn) * 194, 5)], dusk(iron, 0.5)));
  }
  gleam.clip(new ShapeNode().appendCircle(round[0], round[1], 204));
  scene.add(shield).add(gleam);
  return {
    scene,
    pose(_seconds, since) {
      // It is set down: a quick drop, a small bounce, then the light runs once across it.
      const down = settle(ramp(since, 0, 0.42));
      about(shield, round[0], round[1], 1.22 - 0.22 * down);
      const run = ramp(since, 0.55, 1.15),
        x = round[0] - 260 + 520 * run;
      gleam
        .reset()
        .moveTo(x - 40, round[1] - 230)
        .lineTo(x + 30, round[1] - 230)
        .lineTo(x - 30, round[1] + 230)
        .lineTo(x - 100, round[1] + 230)
        .close()
        .fill(255, 250, 232, run > 0 && run < 1 ? 90 : 0);
      about(scene, round[0], round[1], 1 + 0.04 * ease(since / 2.3));
    },
  };
}

/** Few and precious; a home, strength, and the gates. */
export function chargePanel(art?: SagaArt): SagaPanel {
  const scene = new SceneNode(),
    shoreShot = new SceneNode(),
    stage = new SceneNode(),
    shore = dawnShore(300),
    statue = new SceneNode(),
    askr = founderBack(0),
    embla = founderBack(1),
    bird = raven([26, 24, 40]),
    fire = hearth(),
    gear = arms(),
    gateShot = new SceneNode(),
    gate = frostGate(),
    dust = new SceneNode(),
    puffs: ShapeNode[] = [],
    rune = new ShapeNode().appendCircle(round[0], round[1] + 4, 52).fill(214, 232, 250, 0),
    mapShot = new SceneNode(),
    land = new SceneNode().add(new ShapeNode().appendRect(-200, -200, 2000, 1300).fill(...mapSea)),
    map = boardPicture(art?.world, land),
    tint = new ShapeNode().appendRect(-200, -200, 2000, 1300).fill(...duskTint).blend('multiply'),
    lamps = sagaWorlds.map((entry, i) => {
      const lamp = new SceneNode(),
        halo = new ShapeNode().appendCircle(0, 0, 26).fill(...entry.light, 70);
      lamp
        .add(halo)
        .add(new ShapeNode().appendCircle(0, 0, 11).fill(...dusk(entry.light, 0.4)))
        .add(new ShapeNode().appendCircle(-1.5, -1.5, 9).fill(...entry.light))
        .translate(entry.gate[0], entry.gate[1]);
      return { lamp, halo, sealed: i === 0 };
    }),
    // The first gate, shut: a pale slab where its light was.
    slab = new SceneNode()
      .add(new ShapeNode().appendCircle(0, 0, 12).fill(92, 96, 112))
      .add(new ShapeNode().appendCircle(-1.5, -1.5, 9.5).fill(176, 182, 196))
      .add(flat([capsule(0, -5.5, 0, 5.5, 1.3), capsule(-4, -1.5, 0, -5.5, 1.2), capsule(4, -1.5, 0, -5.5, 1.2)], [56, 58, 84]))
      .translate(sagaWorlds[0].gate[0], sagaWorlds[0].gate[1]),
    home = new SceneNode(),
    glow = new ShapeNode().appendCircle(0, 0, 42).fill(252, 196, 120, 90);
  // The statue stands out in the bay, its back to the sun.
  paintYmir(statue, { x: 0, y: 0 }, { summer: 1, autumn: 0, snow: 0, frost: 0 }, true);
  statue.transform([0.94, 0, 560, 0, 0.94, 612, 0, 0, 1]);
  shore.water.add(statue);
  shore.ground.add(
    flat(
      [pen(880, 842).curve([1040, 800], [1240, 792], [1460, 804], [1800, 790]).line(1800, 1100).line(760, 1100).close()],
      [128, 156, 102],
    ),
  );
  for (const [x, y] of [
    [1052, 806],
    [1150, 812],
  ])
    shore.ground.add(flat([lock(x, y, x + 210, y + 46, 34, 0.02)], [92, 100, 96], 110));
  stage.add(shore.scene).add(askr).add(embla).add(bird);
  shoreShot.add(stage);
  for (let i = 0; i < 7; i++) {
    const puff = new ShapeNode().appendCircle(0, 0, 30 + 26 * scatter(i, 411)).fill(226, 236, 248);
    puffs.push(puff);
    dust.add(puff);
  }
  gateShot.add(gate.scene).add(rune).add(dust);
  // As over the night map: the tint is not moved by the camera.
  const over = new SceneNode();
  mapShot.add(land).add(tint).add(over);
  for (const { lamp } of lamps) over.add(lamp);
  home
    .add(glow)
    .add(new ShapeNode().appendCircle(0, 0, 9).fill(214, 120, 60))
    .add(new ShapeNode().appendCircle(-1, -1, 6.5).fill(252, 214, 130))
    .translate(foundingShore[0], foundingShore[1]);
  over.add(slab).add(home);
  scene.add(shoreShot).add(fire.scene).add(gear.scene).add(gateShot).add(mapShot);
  const shots = [shoreShot, fire.scene, gear.scene, gateShot, mapShot];
  return {
    scene,
    // The raven as it lifts, the fire catching, the shield set down, and the slab coming to rest on "seal".
    cues: [
      { at: 1.9 / 14.2, sound: 'wildlife/raven_01', volume: 0.6 },
      { at: starts[1] / 14.2, sound: 'sfx/torch_01', volume: 0.7 },
      { at: (starts[2] + 0.22) / 14.2, sound: 'sfx/block_01', volume: 0.6 },
      { at: (sealedAt - 0.9) / 14.2, sound: 'sfx/saga/seal', volume: 0.9 },
    ],
    pose(_beat, seconds, at) {
      const shot = shotAt(starts, at),
        since = at - starts[shot];
      cutTo(shots, shot);
      if (shot === 0) {
        // The camera starts on the two of them and draws back until the statue stands over everything.
        const view = glide(shoreStops, at);
        frame(stage, view.x, view.y, view.zoom);
        shore.pose(seconds, 1);
        // They sway a little on new legs, drawn on twos.
        const drawn = stepped(seconds, 12);
        askr.transform([1.5, 0.02 * Math.sin(drawn * 1.1), 1052, 0, 1.5, 806, 0, 0, 1]);
        embla.transform([1.42, 0.02 * Math.sin(drawn * 1.1 + 1.7), 1150, 0, 1.42, 812, 0, 0, 1]);
        // A raven waits on the statue's shoulder, then lifts away over the bay.
        const flight = span(at, 1.9, 4.3),
          flap = flight > 0 ? 0.4 + 0.6 * Math.abs(Math.sin(drawn * 7)) : 1,
          k = 1.1 - 0.4 * flight;
        bird.transform([k, 0, 640 + 700 * flight, 0, k * flap, 196 - 60 * Math.sin(flight * Math.PI) + 40 * flight, 0, 0, 1]);
      } else if (shot === 1) fire.pose(seconds, since);
      else if (shot === 2) gear.pose(seconds, since);
      else if (shot === 3) {
        const shut = at >= sealedAt,
          after = at - sealedAt,
          // Two drawings of jolt as the slab lands.
          jolt = shut && after < 0.17 ? (stepped(after, 12) < 0.08 ? 9 : -5) : 0;
        gate.pose(seconds, shut);
        about(gateShot, round[0], round[1], 1.12 - 0.1 * ease(since / 2.3), 0, jolt);
        puffs.forEach((puff, i) => {
          const life = ramp(after, 0, 0.9),
            side = i % 2 ? 1 : -1,
            reach = (120 + 150 * scatter(i, 412)) * easeOut(life);
          puff
            .translate(round[0] + side * (70 + reach), round[1] + 150 - 60 * easeOut(life) + 30 * scatter(i, 413))
            .opacity(shut ? alphaOf(0.8 * (1 - life)) : 0);
        });
        // The rune takes the light for a moment, then lies cold in the stone.
        rune.fill(214, 232, 250, shut ? alphaOf(0.32 * (1 - ramp(after, 0.05, 0.6))) : 0);
      } else {
        const view = glide(mapStops, at);
        frame(land, view.x, view.y, view.zoom);
        frame(over, view.x, view.y, view.zoom);
        map();
        lamps.forEach(({ lamp, halo, sealed }, i) => {
          lamp.opacity(sealed ? 0 : 255);
          halo.opacity(alphaOf(0.6 + 0.4 * Math.sin(seconds * 2 + i * 1.9)));
        });
        glow.opacity(alphaOf(0.7 + 0.3 * Math.sin(stepped(seconds, 8) * 5)));
      }
    },
  };
}
