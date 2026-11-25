import { point, type Point } from '../../engine/src/geometry';
import { identity, SceneNode, type Matrix } from './paint';
import { poly, oval, stroke } from './sprite-primitives';
import { handOf, poseArm, reachArm } from './person-arm';
import { animateGather, animateWork, poseFromClip, stand, swing, toolRestAngle, type ActionPose } from './action-motion';
import { Structure } from '../../engine/src/building-catalog';
import { hammerTiming } from '../../engine/src/work-timing';
import { humanoidClips } from './humanoid-rig';
import type { HeldTool } from './person-equipment';
import type { PersonParts } from './world-sprites';
import { animateReap, animateSpade, liftFromGround, scatterSoil } from './site-work-motion';
import { workHand, workPiece } from './work-pieces';

export function createWorkProps(root: SceneNode, parts: PersonParts): void {
  const drops = new SceneNode(),
    dust = new SceneNode(),
    log = new SceneNode(),
    stone = new SceneNode();
  for (let i = 0; i < 7; i++) drops.add(oval([0, 0], 0.35, 0.65, [157, 204, 211, 220]));
  for (let i = 0; i < 4; i++) dust.add(oval([0, 0], 0.65, 0.4, [157, 128, 81, 145]));
  log.add(stroke([7, -3], [7, 0], 1.2, [74, 53, 34])).add(stroke([18, -3], [18, 0], 1.2, [74, 53, 34]));
  const billet = new SceneNode();
  billet.add(stroke([5, -4], [19, -4], 3.5, [112, 76, 43])).add(oval([19, -4], 1.4, 1.7, [179, 135, 78]));
  billet.add(stroke([6, -5], [17, -5], 0.5, [168, 117, 65]));
  log.add(billet);
  parts.billet = billet;
  stone.add(
    poly(
      [
        [7, -2],
        [10, -5],
        [16, -4],
        [18, -1],
        [13, 1],
      ],
      [112, 113, 120],
    ),
  );
  stone.add(
    poly(
      [
        [7, -2],
        [10, -5],
        [13, -3],
        [13, 1],
      ],
      [157, 154, 150],
    ),
  );
  stone.add(stroke([10, -5], [16, -4], 0.5, [191, 185, 170]));
  parts.waterDrops = drops;
  parts.soilDust = dust;
  parts.sawLog = log;
  parts.workStone = stone;
  // These sit just behind the fingers. Their grip follows the wrist without inheriting arm foreshortening.
  const bread = new SceneNode();
  bread.add(
    poly(
      [
        [-2.5, -0.8],
        [-1.8, -2],
        [0, -2.1],
        [1, -1],
        [0.4, 0.8],
        [-1.7, 0.6],
      ],
      [182, 119, 61],
    ),
  );
  bread.add(
    poly(
      [
        [-2.5, -0.8],
        [-1.8, -2],
        [-0.3, -2.1],
        [-0.7, -0.6],
        [-1.8, -0.2],
      ],
      [234, 191, 122],
    ),
  );
  const cup = new SceneNode();
  cup.add(
    poly(
      [
        [-1.6, -2.2],
        [1.8, -2.2],
        [1.3, 1.1],
        [-1.1, 1.1],
      ],
      [156, 105, 67],
    ),
  );
  cup.add(
    poly(
      [
        [0.6, -2.2],
        [1.8, -2.2],
        [1.3, 1.1],
        [0.3, 1.1],
      ],
      [101, 68, 51],
    ),
  );
  cup.add(oval([0.1, -2.2], 1.7, 0.5, [219, 180, 125]));
  cup.add(oval([0.1, -2.25], 1.2, 0.27, [99, 148, 156]));
  parts.bread = bread;
  parts.cup = cup;
  parts.body!.add(bread.opacity(0)).add(cup.opacity(0));
  for (const paint of [drops, dust, log, stone]) {
    paint.opacity(0);
    root.add(paint);
  }
}
export function clearWorkProps(parts: PersonParts): void {
  if (parts.activePiece) {
    parts.activePiece.opacity(0);
    parts.activePiece = null;
  }
  if (parts.workGrip) {
    parts.workGrip.transform(identity);
    parts.workGrip = null;
  }
  for (const paint of [
    parts.waterDrops,
    parts.soilDust,
    parts.sawLog,
    parts.workStone,
    parts.chisel,
    parts.bread,
    parts.cup,
  ])
    if (paint?.alpha) paint.opacity(0);
}
const transform = (m: Matrix, p: Point): Point =>
  point(m[0] * p.x + m[1] * p.y + m[2], m[3] * p.x + m[4] * p.y + m[5]);
const handPoint = (parts: PersonParts, p: Point): Point =>
  transform(
    parts.body!.matrix,
    transform(
      parts.arms[1].forearm!.matrix,
      transform(parts.arms[1].hand!.matrix, parts.workGrip ? transform(parts.workGrip.matrix, p) : p),
    ),
  );

function pourWater(parts: PersonParts, from: Point, seconds: number, amount: number): void {
  if (amount <= 0) return;
  parts.waterDrops?.opacity(Math.round(255 * amount));
  parts.waterDrops?.children.forEach((drop, i) => {
    const t = (seconds * 1.6 + i / 7) % 1;
    drop.translate(from.x + t * 3 * amount, from.y + (1 - from.y) * t * t);
    drop.opacity(Math.round(220 * Math.sin(t * Math.PI)));
  });
}

// Breaking soil: the hoe lifted beside the head, driven into the row, then drawn back through it.
const till: readonly TillKey[] = [
  [0, -1.0, -0.7, -0.6, 0, 0, 0.01, 0],
  [0.36, -1.45, -1.5, -1.9, -0.04, -0.25, 0.015, -0.05],
  [0.5, -0.62, -0.12, 0.42, 0.085, 0.42, 0.07, 0.16],
  [0.8, -0.72, -0.6, 0.5, 0.05, 0.05, 0.05, 0.12],
  [1, -1.0, -0.7, -0.6, 0, 0, 0.01, 0],
];
type TillKey = readonly [number, number, number, number, number, number, number, number];
const ease = (t: number) => t * t * (3 - 2 * t);
function tillPose(phase: number): ActionPose {
  let next = 1;
  while (next < till.length - 1 && phase > till[next][0]) ++next;
  const from = till[next - 1],
    to = till[next],
    t = (phase - from[0]) / (to[0] - from[0]),
    // The blade drops fast into the earth and is hauled back slowly.
    eased = next === 2 ? t * t * t : ease(t),
    mix = (i: number) => from[i] + (to[i] - from[i]) * eased;
  return {
    upper: mix(1),
    elbow: mix(2),
    direction: mix(3),
    lean: mix(4),
    forward: mix(5),
    crouch: mix(6),
    nod: mix(7),
    lift: 0,
  };
}
export function animateFieldWork(
  parts: PersonParts,
  watering: boolean,
  seconds: number,
  tool: HeldTool | null = 'hoe',
): void {
  const phase = (seconds % 1.25) / 1.25;
  if (watering) {
    if (!tool) {
      // Cup water in the hands and let a little run between the fingers over the row.
      const pour = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
      poseArm(parts.arms[1], -0.68 - 0.3 * pour, -1.18 + 0.82 * pour, 0.24 * pour);
      if (parts.arms[0].free) poseArm(parts.arms[0], -1.03, -0.83 + 0.45 * pour);
      stand(
        parts,
        { lean: 0.075 * pour, crouch: 0.04 + 0.06 * pour, forward: 0.42 * pour, lift: 0, nod: 0.13 * pour },
        0.35,
      );
      pourWater(
        parts,
        transform(parts.body!.matrix, handOf(parts.arms[1])),
        seconds,
        Math.max(0, (pour - 0.5) * 1.5),
      );
      return;
    }
    // The can is carried along the row at a steady tilt, the gardener watching it fall.
    const sway = Math.sin(seconds * 1.5),
      upper = -0.95 + 0.06 * sway,
      elbow = -0.25,
      tilt = 0.45 + Math.sin(seconds * 1.7) * 0.07;
    const pose = {
      upper,
      elbow,
      direction: toolRestAngle + tilt,
      lean: 0.06,
      forward: 0.35 + 0.3 * sway,
      crouch: 0.03,
      nod: 0.13,
      lift: 0,
    };
    swing(parts, 'wateringCan', pose, null, 1.55);
    stand(parts, pose, 0.55);
    const wrist = parts.arms[1].wrist,
      spout = handPoint(parts, point(wrist.x + 9, wrist.y - 1.5));
    pourWater(parts, spout, seconds, 1);
    return;
  }
  if (!tool) return liftFromGround(parts, phase, true);
  if (tool === 'shovel') return animateSpade(parts, phase);
  if (tool === 'sickle') return animateReap(parts, phase);
  const pose = tillPose(phase);
  swing(parts, tool, pose, null, 2);
  stand(parts, pose, 0.55);
  scatterSoil(parts, phase, 12, 0.2);
}

export function animateProcessingWork(
  parts: PersonParts,
  sawing: boolean,
  seconds: number,
  tooled = true,
): void {
  const beat = Math.sin(seconds * 6),
    shoulder = parts.arms[1].shoulder.y;
  if (!tooled) {
    // Roll the timber along the trestle or turn a block on its bed, keeping the other hand against it.
    const rock = Math.sin(seconds * (sawing ? 2.8 : 4));
    poseArm(parts.arms[1], -0.93 + (sawing ? 0.4 : 0.16) * rock, -0.42 - 0.25 * rock);
    if (parts.arms[0].free) poseArm(parts.arms[0], -1.18 - 0.22 * rock, -0.32 + 0.15 * rock);
    stand(
      parts,
      {
        lean: 0.1 + 0.035 * rock,
        forward: 0.38 + 0.32 * rock,
        crouch: sawing ? 0.1 : 0.2,
        lift: 0,
        nod: 0.16 + 0.025 * rock,
      },
      0.5,
    );
    if (sawing) {
      parts.billet?.translate(-1.1 + rock * 0.85, 0);
      parts.sawLog?.opacity(255);
    } else {
      const angle = 0.1 * rock,
        c = Math.cos(angle),
        s = Math.sin(angle);
      parts.workStone?.transform([c, -s, 8 * (1 - c) - 1, s, c, -8 * s, 0, 0, 1]).opacity(255);
    }
    return;
  }
  if (sawing) {
    // Long strokes from the shoulder, the body rocking with them, the other hand on the log.
    const upper = -1.1 + beat * 0.26,
      elbow = -0.35 - beat * 0.28;
    const pose = {
      upper,
      elbow,
      direction: toolRestAngle + 0.02,
      lean: 0.07 + beat * 0.025,
      forward: 0.45 + beat * 0.4,
      crouch: 0.04,
      nod: 0.12,
      lift: 0,
    };
    swing(parts, 'saw', pose, point(6.2, shoulder + 4.2), 1.4);
    stand(parts, pose, 0.55);
    parts.billet?.translate(0, 0);
    parts.sawLog?.opacity(255);
    return;
  }
  // The mallet rises slowly and comes down sharply on a chisel held dead still.
  const raise = ease(0.5 - 0.5 * beat) ** 0.7,
    upper = -1.1 - 0.5 * raise,
    elbow = -0.2 - 0.3 * raise,
    direction = 0.42 - 0.95 * raise;
  const pose = {
    upper,
    elbow,
    direction,
    lean: 0.07,
    forward: 0.4 + (1 - raise) * 0.2,
    crouch: 0.045 + (1 - raise) * 0.015,
    nod: 0.1 + (1 - raise) * 0.05,
    lift: 0,
  };
  swing(parts, 'hammer', pose, null, 2.45);
  if (parts.arms[0].free) {
    poseArm(parts.arms[0], -1.3, 0, 0.2);
    parts.chisel?.opacity(255);
  }
  stand(parts, pose, 0.5);
  parts.workStone?.transform(identity).opacity(255);
}

/**
 * The smith fits the piece, beats it into shape with a carried hammer, and raises the finished weapon
 * to the light as its order ends.
 */
export function animateCraft(
  parts: PersonParts,
  tool: HeldTool | null,
  pounding: boolean,
  seconds: number,
  lift: number,
): void {
  if (lift > 0) poseFromClip(parts, humanoidClips.admire, lift * humanoidClips.admire.frames, tool);
  else if (pounding) animateWork(parts, tool, seconds, hammerTiming.period, hammerTiming.impact);
  else poseFromClip(parts, humanoidClips.whittle, seconds * 30, tool);
}

/** Pump the furnace bellows, or hold a length of frostwood steady and cinch its binding. */
export function animateFoundry(parts: PersonParts, binding: boolean, seconds: number): void {
  const pull = 0.5 - 0.5 * Math.cos(seconds * (binding ? 4.2 : 2.8));
  const [left, right] = parts.arms;
  if (binding) {
    poseArm(right, -1.12 + 0.63 * pull, -0.43 - 0.92 * pull, -0.12 * pull);
    if (left.free) poseArm(left, -1.14, -0.52);
  } else {
    poseArm(right, -1.25 + 0.75 * pull, -0.9 + 0.58 * pull, 0.12 * pull);
    if (left.free) poseArm(left, -1.35 + 0.65 * pull, -0.68 + 0.41 * pull);
  }
  stand(
    parts,
    {
      lean: 0.04 + 0.06 * pull,
      crouch: 0.03 + (binding ? 0.02 : 0.08) * pull,
      forward: 0.28 * pull,
      lift: 0,
      nod: 0.11 + 0.04 * pull,
    },
    0.45,
  );
  const hand = workHand(parts);
  if (binding)
    workPiece(parts, 'frostwood')
      .translate(hand.x - 1.2, hand.y + 0.65)
      .opacity(255);
  else {
    const nozzle = point(12.5, -2.8);
    workPiece(parts, 'bellows')
      .transform([(nozzle.x - hand.x) / 7.4, 0, nozzle.x, 0, (nozzle.y - hand.y) / 4, nozzle.y, 0, 0, 1])
      .opacity(255);
  }
}

/** What a worker's hands do while standing at a workplace that has no tool of its own. */
export type Trade = 'haul' | 'stack' | 'counter' | 'channel' | 'watch' | 'bless';
export function tradeOf(kind: Structure): Trade | null {
  switch (kind) {
    case Structure.Well:
      return 'haul';
    case Structure.Camp:
    case Structure.Storehouse:
    case Structure.Granary:
    case Structure.WoodStore:
    case Structure.StoneStore:
    case Structure.Lumberyard:
    case Structure.Quarry:
      return 'stack';
    case Structure.Apothecary:
    case Structure.Farm:
    case Structure.Tavern:
    case Structure.Hostel:
    case Structure.Inn:
    case Structure.GrandInn:
    case Structure.MarketStalls:
    case Structure.MarketHall:
    case Structure.Bazaar:
      return 'counter';
    case Structure.MageTower:
    case Structure.Portal:
      return 'channel';
    case Structure.Watchtower:
      return 'watch';
    case Structure.Chapel:
      return 'bless';
    default:
      return null;
  }
}
const still: ActionPose = {
  upper: 0,
  elbow: 0,
  direction: 0,
  crouch: 0,
  lift: 0,
  lean: 0,
  forward: 0,
  nod: 0,
};
export function animateTrade(parts: PersonParts, trade: Trade, seconds: number): void {
  const [left, right] = parts.arms,
    shoulder = right.shoulder.y;
  if (trade === 'haul') {
    // Hand over hand on the well rope, the body sinking a little into each pull.
    const turn = seconds * 4.4,
      pull = Math.sin(turn);
    reachArm(right, point(4.1, shoulder + 3 + 2.4 * pull), 1, 0, 0);
    if (left.free) reachArm(left, point(3.7, shoulder + 3 - 2.4 * pull), 1, 0, 0);
    stand(
      parts,
      { ...still, crouch: 0.025 + 0.02 * Math.abs(pull), lean: -0.03, forward: -0.2, nod: 0.06 },
      0.5,
    );
  } else if (trade === 'stack') {
    // Stoop for a load, straighten, set it on the pile, and again.
    const cycle = (seconds % 2.6) / 2.6;
    if (cycle < 0.5) animateGather(parts, Math.sin(Math.PI * (cycle / 0.5)));
    else {
      const set = Math.sin(Math.PI * ((cycle - 0.5) / 0.5));
      reachArm(right, point(5.4, shoulder + 2.4), set, 0, 0);
      if (left.free) reachArm(left, point(4.2, shoulder + 2.8), set, 0, 0);
      stand(
        parts,
        { ...still, crouch: 0.01 * set, lean: 0.05 * set, forward: 0.35 * set, nod: 0.05 * set },
        0.3,
      );
    }
  } else if (trade === 'counter') {
    // One hand steadies a bowl or a cup at the chest while the other works in it.
    const turn = seconds * 5;
    reachArm(right, point(2.5 + 0.45 * Math.cos(turn), shoulder + 2.7 + 0.3 * Math.sin(turn)), 1, 0, 0);
    if (left.free) reachArm(left, point(1.5, shoulder + 3.5), 1, 0, 0);
    stand(parts, { ...still, crouch: 0.01, lean: 0.02, nod: 0.13 + 0.015 * Math.sin(turn * 0.5) }, 0.2);
  } else if (trade === 'bless') {
    // Gather the hands over the breast, then open one palm in a blessing.
    const open = 0.5 - 0.5 * Math.cos(seconds * 1.8);
    poseArm(right, -0.2 - 1.05 * open, -1.65 + 0.95 * open, -0.1 * open);
    if (left.free) reachArm(left, point(-0.65, shoulder + 2.7), 0.86, 0, 0);
    stand(parts, { ...still, lean: 0.035 * (1 - open), nod: 0.03 + 0.17 * (1 - open) }, 0.25);
  } else if (trade === 'watch') {
    // A lookout shades the eyes and sweeps the horizon, slowly.
    const sweep = Math.sin(seconds * 0.7);
    // The hand goes to the temple, clear of the face, as if against the light.
    reachArm(right, point(5, parts.neck.y - 4.6 - 0.25 * sweep), 1, 0, 0);
    if (left.free) poseArm(left);
    stand(
      parts,
      { ...still, lean: -0.02 + 0.02 * sweep, forward: 0.25 * sweep, nod: -0.05 + 0.04 * sweep },
      0.3,
    );
  } else {
    // Hands lifted toward the working, rising and falling as it answers.
    const swell = Math.sin(seconds * 1.7);
    reachArm(right, point(4.6, shoulder - 1 - 0.8 * swell), 1, 0, 0);
    if (left.free) reachArm(left, point(2.6, shoulder - 0.2 + 0.8 * swell), 1, 0, 0);
    stand(parts, { ...still, lean: -0.025, forward: -0.15, nod: -0.07 - 0.02 * swell }, 0.35);
  }
}
