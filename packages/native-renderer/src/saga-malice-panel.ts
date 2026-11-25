// Opening saga, last beat: the giant lies under the land with his eyes shut while his hatred is told of, and the
// saga ends on the way it comes up by: a barrow in the snow at night, with nothing coming out of it.
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { pen, type Contour, type Form } from './outline-form';
import { dusk, glint, paintForm } from './form-paint';
import { giantHead } from './saga-giant';
import { about, alphaOf, backdrop, clamp01, cutTo, ease, flat, hazeStreak, ramp, scatter, shotAt, stepped, type SagaPanel } from './saga-panel';

const length = 11.2;
/** Seconds into the beat at which the barrow is cut to. */
const gateAt = 4.1;
const ember: Rgb = [236, 120, 60];

/** The fallen giant in the dark under the land, as he lay in the sea: his eyes stay shut. */
function buried(): { scene: SceneNode; pose(seconds: number, at: number): void } {
  const scene = new SceneNode(),
    stage = new SceneNode(),
    head = giantHead(),
    tilt = -0.5,
    k = 2.5,
    // Everything of him is sunk in one dark tone.
    gloom = new ShapeNode().appendRect(-200, -200, 2000, 1300).fill(74, 64, 124).blend('multiply');
  head.scene.transform([k * Math.cos(tilt), -k * Math.sin(tilt), 860, k * Math.sin(tilt), k * Math.cos(tilt), 700, 0, 0, 1]);
  stage.add(backdrop([20, 16, 44], [44, 28, 62])).add(head.scene);
  scene.add(stage).add(gloom);
  return {
    scene,
    pose(seconds, at) {
      about(stage, 900, 470, 1 + 0.1 * clamp01(at / gateAt));
      head.sway(seconds, 0.3);
    },
  };
}
/**
 * A rune stone: a broad slab set on end, one shoulder higher than the other, its foot at (x, y). `tilt` leans it
 * and `turnTo` (-1 or 1) says which shoulder is the high one. Returns its outline and the line of its top.
 */
function runeStone(x: number, y: number, w: number, h: number, tilt: number, turnTo: number): { slab: Contour; top: [number, number][] } {
  const at = (u: number, v: number): [number, number] => [x + (u * turnTo + tilt * v) * w, y - v * h],
    top: [number, number][] = [at(-0.5, 0.8), at(-0.3, 0.98), at(0, 1), at(0.32, 0.84), at(0.5, 0.58)];
  return {
    slab: pen(...at(-0.46, 0))
      .curve(at(-0.56, 0.36), ...top, at(0.58, 0.34), at(0.48, 0))
      .curve(at(0, -0.05), at(-0.46, 0))
      .close(),
    top,
  };
}
/** A thin lie of snow along the top of something, thickest in the middle and running out at both ends. */
function snowOn(top: readonly [number, number][], depth: number): Contour {
  const over = top.map(([x, y], i): [number, number] => [x, y - depth * Math.sin((Math.PI * (i + 0.6)) / (top.length + 0.2))]),
    first = top[0],
    last = top[top.length - 1];
  return pen(first[0], first[1] + 2)
    .curve(...over, [last[0], last[1] + 2])
    .curve(...top.slice(1, -1).reverse().map(([x, y]): [number, number] => [x, y + 3]), [first[0], first[1] + 2])
    .close();
}
/** A boulder half sunk in the snow: low and uneven, never a ball. */
function boulder(x: number, y: number, w: number, h: number, lean: number): { rock: Contour; top: [number, number][] } {
  const top: [number, number][] = [
    [x - w * 0.5, y - h * 0.3],
    [x - w * 0.3 + lean * w, y - h * 0.86],
    [x + w * 0.06 + lean * w, y - h],
    [x + w * 0.36 + lean * w, y - h * 0.74],
    [x + w * 0.52, y - h * 0.24],
  ];
  return { rock: pen(x - w * 0.54, y).curve(...top, [x + w * 0.56, y]).curve([x, y + h * 0.1], [x - w * 0.54, y]).close(), top };
}
/** Snow lying on something round, as one soft outline: over the top, round each end, and back along a sagging edge. */
function snowCap(x: number, y: number, w: number, rise: number, sag: number, lobes: number): Contour {
  const round: [number, number][] = [
    [x + w * 0.28, y - rise * 0.8],
    [x + w * 0.47, y - rise * 0.16],
    [x + w * 0.49, y + sag * 0.3],
  ];
  for (let k = 1; k < lobes * 2; k++) {
    const share = k / (lobes * 2);
    round.push([x + w * 0.46 - w * 0.92 * share, y + (k % 2 ? sag : sag * 0.3)]);
  }
  round.push([x - w * 0.49, y + sag * 0.3], [x - w * 0.47, y - rise * 0.16], [x - w * 0.28, y - rise * 0.8], [x, y - rise]);
  return pen(x, y - rise).curve(...round).close();
}
/**
 * A barrow under snow at night: a round mound, a doorway of three great stones into the dark, standing stones
 * beside it and far ridges behind. Every outline is a curve; nothing here is sharp, and nothing comes out.
 */
function barrow(): { scene: SceneNode; pose(seconds: number, since: number): void } {
  const scene = new SceneNode(),
    stage = new SceneNode(),
    snow = new SceneNode(),
    flakes: ShapeNode[] = [],
    stone: Rgb = [78, 82, 112],
    earth: Rgb = [46, 48, 76],
    drift: Rgb = [122, 138, 184],
    driftShade: Rgb = [88, 104, 152],
    dark: Rgb = [9, 9, 22];
  stage.add(backdrop([9, 12, 34], [42, 56, 102], 0, 640));
  // Snow cloud lies across the sky in long streaks; behind them two far ranges.
  stage.add(flat([hazeStreak(420, 250, 1100, 70), hazeStreak(1180, 168, 900, 52), hazeStreak(760, 372, 1500, 60)], [52, 66, 112], 150));
  stage.add(
    flat(
      [pen(-200, 520).curve([120, 440], [360, 468], [600, 404], [840, 452], [1080, 388], [1340, 448], [1800, 416]).line(1800, 760).line(-200, 760).close()],
      [44, 58, 104],
    ),
  );
  stage.add(
    flat(
      [pen(-200, 596).curve([220, 548], [520, 566], [800, 528], [1100, 566], [1420, 538], [1800, 576]).line(1800, 800).line(-200, 800).close()],
      [58, 76, 124],
    ),
  );
  // The field of snow, and the mound on it.
  paintForm(
    stage,
    [pen(-200, 644).curve([300, 624], [800, 636], [1300, 620], [1800, 644]).line(1800, 1100).line(-200, 1100).close()],
    drift,
    { ink: 0, rim: 14 },
    driftShade,
  );
  paintForm(
    stage,
    [
      pen(372, 668)
        .curve([430, 528], [596, 384], [800, 344], [1004, 384], [1170, 528], [1228, 668])
        .curve([800, 700], [372, 668])
        .close(),
    ],
    earth,
    { ink: 0, rim: 16 },
    dusk(earth, 0.4),
  );
  paintForm(stage, [snowCap(800, 474, 660, 132, 34, 5)], drift, { ink: 0, rim: 10 }, driftShade);
  // The doorway: the passage, a deeper arch within it, and what burns at its far end.
  stage.add(flat([pen(742, 650).curve([744, 540], [754, 444]).curve([800, 436], [846, 444]).curve([856, 540], [858, 650]).close()], dark));
  stage.add(flat([pen(768, 650).curve([768, 548], [800, 506], [832, 548], [832, 650]).close()], [16, 14, 32]));
  const glow = flat([pen(788, 650).curve([788, 600], [800, 580], [812, 600], [812, 650]).close()], dusk(ember, 0.18));
  stage.add(glow);
  // Two uprights that lean together and the lintel laid across them, each a weathered boulder.
  const portal: Form = [
    pen(690, 656).curve([694, 560], [706, 470], [730, 446], [756, 458]).curve([756, 560], [750, 656]).curve([720, 664], [690, 656]).close(),
    pen(850, 656).curve([846, 560], [848, 462], [874, 444], [896, 468]).curve([908, 560], [912, 656]).curve([880, 664], [850, 656]).close(),
    pen(666, 440)
      .curve([690, 412], [740, 396], [804, 392], [876, 398], [924, 414], [940, 440], [930, 462], [880, 470], [800, 474], [720, 470], [674, 462], [666, 440])
      .close(),
  ];
  paintForm(stage, portal, stone, { ink: 0, rim: 9 }, dusk(stone, 0.42));
  // A braid cut along the lintel, the old way: two bands that cross and cross again.
  for (const first of [-1, 1]) {
    const band = new ShapeNode().moveTo(704, 432 + 9 * first);
    for (let k = 0; k < 6; k++) {
      const x = 704 + k * 32,
        here = 432 + 9 * first * (k % 2 ? -1 : 1),
        next = 432 - 9 * first * (k % 2 ? -1 : 1);
      band.cubicTo(x + 14, here, x + 18, next, x + 32, next);
    }
    stage.add(band.strokeWidth(4.5).strokeCap('round').strokeJoin('round').strokeFill(...glint(stone, 0.26), 220));
  }
  paintForm(stage, [snowCap(801, 404, 250, 16, 12, 3)], drift, { ink: 0, rim: 5 }, driftShade);
  // Two rune stones keep the door: broad slabs, each cut with a serpent band that loops inside its edge.
  for (const [x, y, w, h, tilt, turnTo] of [
    [540, 664, 104, 170, 0.07, 1],
    [1066, 666, 118, 132, -0.05, -1],
  ]) {
    const { slab, top } = runeStone(x, y, w, h, tilt, turnTo),
      at = (u: number, v: number): [number, number] => [x + (u * turnTo + tilt * v) * w, y - v * h],
      band = new ShapeNode()
        .moveTo(...at(-0.2, 0.16))
        .cubicTo(...at(-0.42, 0.34), ...at(-0.4, 0.74), ...at(-0.04, 0.82))
        .cubicTo(...at(0.36, 0.86), ...at(0.4, 0.42), ...at(0.2, 0.2))
        // The tail turns in on itself.
        .cubicTo(...at(0.06, 0.06), ...at(-0.1, 0.3), ...at(0.04, 0.42))
        .cubicTo(...at(0.14, 0.5), ...at(0.2, 0.36), ...at(0.1, 0.32));
    paintForm(stage, [slab], stone, { ink: 0, rim: 9 }, dusk(stone, 0.42));
    stage.add(band.strokeWidth(w * 0.055).strokeCap('round').strokeJoin('round').strokeFill(...glint(stone, 0.24), 215));
    paintForm(stage, [snowOn(top, 9)], drift, { ink: 0, rim: 3 }, driftShade);
  }
  // Boulders lie half sunk about its foot.
  for (const [x, y, w, h, lean] of [
    [426, 676, 84, 44, 0.06],
    [1204, 678, 96, 50, -0.08],
    [640, 672, 50, 28, 0.04],
  ]) {
    const { rock, top } = boulder(x, y, w, h, lean);
    paintForm(stage, [rock], stone, { ink: 0, rim: 7 }, dusk(stone, 0.42));
    paintForm(stage, [snowOn(top, 7)], drift, { ink: 0, rim: 3 }, driftShade);
  }
  // Drifts blown against the foot of it all, one with the field they lie on.
  stage.add(
    flat(
      [
        pen(300, 706).curve([400, 666], [520, 672], [610, 656], [700, 672], [760, 656], [840, 656], [900, 670], [1000, 654], [1100, 672], [1200, 662], [1320, 706]).close(),
      ],
      drift,
    ),
  );
  for (let i = 0; i < 36; i++) {
    const flake = new ShapeNode().appendCircle(0, 0, 2 + 3.4 * scatter(i, 201)).fill(226, 236, 250, 200);
    flakes.push(flake);
    snow.add(flake);
  }
  scene.add(stage.add(snow));
  return {
    scene,
    pose(seconds, since) {
      // The view closes slowly on the door.
      about(stage, 800, 548, 1.16 + 0.12 * ease(clamp01(since / (length - gateAt))));
      // What woke below reaches the door: a dull fire far down the passage, kindling as the voice says it rises.
      const kindled = ease(ramp(since, 0.6, 3)),
        drawn = stepped(seconds, 8);
      glow.opacity(alphaOf(kindled * (0.62 + 0.14 * Math.sin(drawn * 5))));
      flakes.forEach((flake, i) => {
        const life = (seconds * (0.05 + 0.06 * scatter(i, 202)) + scatter(i, 203)) % 1;
        flake
          .translate(40 + 1520 * scatter(i, 204) + 26 * Math.sin(seconds * 0.7 + i), -20 + 940 * life)
          .opacity(alphaOf(Math.sin(life * Math.PI) * 1.4));
      });
    },
  };
}

/** What did not die with the giant, and the door it climbs to. */
export function malicePanel(): SagaPanel {
  const scene = new SceneNode(),
    under = buried(),
    door = barrow();
  scene.add(under.scene).add(door.scene);
  const shots = [under.scene, door.scene];
  return {
    scene,
    pose(_beat, seconds, at) {
      const shot = shotAt([0, gateAt], at);
      cutTo(shots, shot);
      if (shot === 0) under.pose(seconds, at);
      else door.pose(seconds, at - gateAt);
    },
  };
}
