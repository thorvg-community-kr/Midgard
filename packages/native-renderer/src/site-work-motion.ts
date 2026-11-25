// Work against a wall, loose paving, or soil. Each stroke has a place to take hold and a release.
import { point, project, rotated, type Point } from '../../engine/src/geometry';
import type { ItemMaterial } from '../../engine/src/equipment';
import type { ClearKind } from '../../engine/src/town-clearing';
import { hammerTiming } from '../../engine/src/work-timing';
import { stand, swing, toolRestAngle } from './action-motion';
import { handOf, poseArm, reachArm } from './person-arm';
import { hammerHead, type HeldTool } from './person-equipment';
import type { PersonParts } from './world-sprites';
import { removePiece, workHand, workPiece, type BenchStock } from './work-pieces';

const tau = Math.PI * 2;
const ease = (t: number) => t * t * (3 - 2 * t);
/** The hands meet the work halfway round the cycle and take longer to pull it free. */
function press(phase: number): number {
  return phase < 0.5 ? ease(phase * 2) : 1 - ease((phase - 0.5) * 2);
}
/** Put the middle of the visible stroke on the engine's actual hammer contact. */
export const sitePhase = (elapsed: number): number => {
  const cycles = (elapsed - hammerTiming.impact) / hammerTiming.period + 0.5;
  return cycles - Math.floor(cycles);
};

/** Dust starts at the contact, travels briefly in an arc, then settles. */
export function scatterSoil(parts: PersonParts, phase: number, x: number, y: number): void {
  const dust = parts.soilDust,
    t = (phase - 0.5) / 0.36;
  if (!dust) return;
  dust.opacity(t >= 0 && t < 1 ? 255 : 0);
  if (!dust.alpha) return;
  dust.children.forEach((grain, i) => {
    grain.translate(x + (i - 1.5) * t * 2.1, y - Math.sin(t * Math.PI) * (0.8 + i * 0.35) + t * t);
    grain.opacity(Math.round(185 * (1 - t)));
  });
}

/** A shovel enters nearly upright, rocks back against the soil, then carries the loosened earth up. */
export function animateSpade(parts: PersonParts, phase: number): void {
  const push = press(phase),
    scoop = Math.sin(tau * phase),
    upper = -0.72 - 0.27 * scoop,
    elbow = -1.05 + 0.68 * push,
    wrist = 0.08 + 0.19 * scoop,
    grip = 3.08,
    pose = {
      upper,
      elbow,
      direction: toolRestAngle + grip + upper + elbow + wrist,
      lean: 0.05 + 0.08 * push,
      forward: 0.35 * push,
      crouch: 0.035 + 0.07 * push,
      lift: 0,
      nod: 0.09 + 0.1 * push,
    };
  swing(parts, 'shovel', pose, null, grip);
  stand(parts, pose, 0.45);
  scatterSoil(parts, phase, 13, 0);
}

/** The free hand gathers the stems. The short blade draws inward below that hand. */
export function animateReap(parts: PersonParts, phase: number): void {
  const draw = press(phase),
    gather = 0.5 + 0.5 * Math.sin(tau * phase),
    upper = -0.95 + 0.6 * draw,
    elbow = -0.28 - 0.84 * draw,
    grip = 2.35,
    pose = {
      upper,
      elbow,
      direction: toolRestAngle + grip + upper + elbow - 0.16 * draw,
      lean: 0.1 - 0.04 * draw,
      forward: 0.45 - 0.25 * draw,
      crouch: 0.1,
      lift: 0,
      nod: 0.15,
    };
  swing(parts, 'sickle', pose, point(2.2, parts.neck.y + 4.6 - 0.65 * gather), grip);
  stand(parts, pose, 0.45);
}

/** Take a grip at ground level and straighten with roots or loose stone in both hands. */
export function liftFromGround(parts: PersonParts, phase: number, roots: boolean): void {
  const down = press(phase),
    pull = Math.sin(tau * phase),
    [left, right] = parts.arms;
  poseArm(right, -0.72 + 0.36 * down + 0.22 * pull, -1.4 + 1.15 * down, 0.14 * pull);
  if (left.free) poseArm(left, -1.05 + 0.47 * down, -0.95 + 0.76 * down, -0.1 * pull);
  stand(
    parts,
    {
      lean: 0.045 + 0.12 * down,
      forward: 0.5 * down,
      crouch: 0.04 + 0.14 * down,
      nod: 0.07 + 0.18 * down,
      lift: 0,
    },
    0.45,
  );
  removePiece(parts, roots ? 'roots' : 'paver', phase);
  if (roots) scatterSoil(parts, phase, workHand(parts).x + 1, -1.2);
}

/** Hammer low into a loose stone or higher against the frame, then recoil over planted feet. */
function loosen(parts: PersonParts, phase: number, wall: boolean): void {
  const swingDown = phase < 0.5 ? (phase * 2) ** 3 : 1 - ease((phase - 0.5) * 2),
    upper = (wall ? -1.4 : -1.1) + (wall ? 0.44 : 0.69) * swingDown,
    elbow = -1.45 + 1.18 * swingDown,
    grip = 2.62,
    pose = {
      upper,
      elbow,
      direction: toolRestAngle + grip + upper + elbow + 0.05 + 0.44 * swingDown,
      lean: (wall ? -0.045 : 0.08) + (wall ? 0.15 : 0.07) * swingDown,
      forward: wall ? -0.28 + 0.78 * swingDown : -0.16 + 0.36 * swingDown,
      crouch: wall ? 0.015 + 0.05 * swingDown : 0.02 + 0.005 * swingDown,
      lift: 0,
      nod: 0.02 + 0.13 * swingDown,
    };
  swing(parts, 'hammer', pose, point(1.6, parts.neck.y + (wall ? 3.3 : 5.8)), grip);
  stand(parts, pose, 0.55);
}

/** Tap with a short grip. The striking face lands on the top of the stock at the bottom of the arc. */
function tapStock(parts: PersonParts, target: Point, rise: number, material: ItemMaterial): void {
  const arm = parts.arms[1],
    angle = -0.7 * rise,
    c = Math.cos(angle),
    s = Math.sin(angle),
    grip = 3.8,
    scale = 0.76,
    { base, top, half } = hammerHead(material),
    head = ((base + top) / 2 - grip) * scale,
    face = half * scale;
  reachArm(
    arm,
    point(target.x + 1.5 * rise - head * c + face * s, target.y - 3.7 * rise - head * s - face * c),
    1,
    0,
    0,
  );

  // Keep the mallet rigid even when the sleeve shortens toward the viewer. The hand stays around the haft.
  const m = arm.forearm!.matrix,
    det = m[0] * m[4] - m[1] * m[3],
    turn = angle - toolRestAngle,
    co = scale * Math.cos(turn),
    si = scale * Math.sin(turn),
    a = (m[4] * co - m[1] * si) / det,
    b = (-m[4] * si - m[1] * co) / det,
    d = (m[0] * si - m[3] * co) / det,
    e = (m[0] * co + m[3] * si) / det,
    x = arm.wrist.x + 0.6 * grip,
    y = arm.wrist.y - 0.8 * grip;
  parts.workGrip = parts.hammer!.transform([
    a,
    b,
    arm.wrist.x - a * x - b * y,
    d,
    e,
    arm.wrist.y - d * x - e * y,
    0,
    0,
    1,
  ]);
}

/** Steady the stock with one hand and roll and press it into place, or seat it with a carried hammer. */
export function animateBenchCraft(
  parts: PersonParts,
  material: BenchStock,
  hammer: ItemMaterial | null,
  elapsed: number,
  benchAngle: number,
  anvil = false,
): void {
  const [left, right] = parts.arms,
    phase = hammer ? sitePhase(elapsed) : (elapsed / 1.55) % 1,
    load = hammer
      ? phase < 0.5
        ? ease(phase * 2) ** 2
        : 1 - ease((phase - 0.5) * 2)
      : 0.5 - 0.5 * Math.cos(tau * phase),
    roll = hammer ? 0 : Math.sin(tau * phase),
    reach = Math.hypot(left.wrist.x - left.shoulder.x, left.wrist.y - left.shoulder.y),
    holdX = left.shoulder.x + 0.74 * reach,
    span = (right.shoulder.x + 5.4 - holdX) / 4.9,
    // The anvil sits lower and farther inside the apron than the carpenter's bench.
    inward = rotated(point(0, anvil ? -0.37 : -0.1), benchAngle),
    holdY = project(inward.x, inward.y, (anvil ? 3.3 : 6.2) + 1.05).y,
    tilt = 0.1 * roll,
    c = Math.cos(tilt),
    s = Math.sin(tilt);
  stand(
    parts,
    {
      lean: 0.045 + 0.045 * load,
      forward: 0.35 * load,
      crouch: 0.018 + 0.022 * load,
      lift: 0,
      nod: 0.12 + 0.045 * load,
    },
    0.4,
  );
  workPiece(parts, material)
    .transform([c * span, -s, holdX + 2.65 * span * c, s * span, c, holdY + 2.65 * span * s, 0, 0, 1])
    .opacity(255);

  // The stock rests on the bench. Reach back from that fixed surface as the worker leans over it.
  const body = parts.body!.matrix;
  const atStock = (along: number, above: number): Point => {
    const y = (holdY + s * along * span - c * above - body[5]) / body[4];
    return point(holdX + c * along * span + s * above - body[2] - body[1] * y, y);
  };
  if (left.free) reachArm(left, atStock(0.25, 0.35), 1, 0, 0);
  if (hammer) tapStock(parts, atStock(4.9, 1), 1 - load, hammer);
  else reachArm(right, atStock(3.65 + 0.55 * roll, 1.2 + 2 * (1 - load)), 1, 0.12 * roll, 0);
}

/** Brace a new rail against the station, seat it by hand or drive its peg with the mallet. */
export function animateStationWork(parts: PersonParts, tool: HeldTool | null, elapsed: number): void {
  const phase = sitePhase(elapsed),
    seat = press(phase);
  if (tool === 'hammer') loosen(parts, phase, true);
  else {
    poseArm(parts.arms[1], -0.85 - 0.3 * seat, -1.18 + 0.8 * seat, 0.08 * seat);
    stand(
      parts,
      {
        lean: 0.03 + 0.075 * seat,
        forward: 0.46 * seat,
        crouch: 0.04 + 0.035 * seat,
        lift: 0,
        nod: 0.08 + 0.06 * seat,
      },
      0.55,
    );
  }
  const other = parts.arms[0];
  if (other.free) reachArm(other, point(3, parts.neck.y + 4), 1, 0, 0);
  const support = other.free ? workHand(parts, 0) : point(3.5, parts.neck.y + 4);
  workPiece(parts, 'board')
    .transform([0.97, 0.24, support.x + 2, -0.24, 0.97, support.y + 0.4, 0, 0, 1])
    .opacity(255);
}

export function animateClearing(
  parts: PersonParts,
  kind: ClearKind,
  tool: HeldTool | null,
  elapsed: number,
): void {
  const phase = sitePhase(elapsed);
  if (kind === 'field') return liftFromGround(parts, phase, true);
  if (tool === 'hammer') loosen(parts, phase, kind === 'building');
  else if (kind === 'road') liftFromGround(parts, phase, false);
  else {
    // Grip the plank with both hands and shift back to pull it out of its joint.
    const take = press(phase),
      [left, right] = parts.arms;
    poseArm(right, -0.33 - 0.94 * take, -1.63 + 1.31 * take, 0.12 * take);
    if (left.free) poseArm(left, -0.45 - 0.78 * take, -1.44 + 0.98 * take);
    stand(
      parts,
      {
        lean: -0.1 + 0.19 * take,
        forward: -0.65 + 1.1 * take,
        crouch: 0.055,
        nod: -0.03 + 0.14 * take,
        lift: 0,
      },
      0.6,
    );
    removePiece(parts, 'board', phase);
  }
  const grip = handOf(parts.arms[1]);
  scatterSoil(parts, phase, grip.x + (tool ? 4 : 1), kind === 'building' ? grip.y : -0.5);
}

export function animateRoadwork(parts: PersonParts, tool: HeldTool | null, elapsed: number): void {
  const phase = sitePhase(elapsed);
  if (tool === 'shovel') return animateSpade(parts, phase);
  if (tool === 'hammer') loosen(parts, phase, false);
  else {
    // Bed and tamp the paving with the palms, staying low throughout.
    const set = press(phase);
    poseArm(parts.arms[1], -0.95 + 0.58 * set, -0.88 + 0.66 * set);
    if (parts.arms[0].free) poseArm(parts.arms[0], -1.05 + 0.48 * set, -0.85 + 0.62 * set);
    stand(
      parts,
      {
        lean: 0.1 + 0.06 * set,
        forward: 0.45 * set,
        crouch: 0.12 + 0.06 * set,
        nod: 0.14 + 0.09 * set,
        lift: 0,
      },
      0.4,
    );
  }
  scatterSoil(parts, phase, handOf(parts.arms[1]).x + (tool ? 4 : 1), -0.5);
}

/** One hand steadies the strap as the carrier walks. The other arm and both boots keep their stride. */
export function braceLoad(parts: PersonParts, stride: number): void {
  const arm = parts.arms[0].free ? parts.arms[0] : parts.arms[1];
  reachArm(arm, point(arm.shoulder.x * 0.78, arm.shoulder.y + 2.1), 0.78 + 0.04 * Math.cos(stride), 0, 0);
}

export const transferSeconds = 0.64;
/** The hands meet halfway through a handoff. Only the person holding the parcel shows it. */
export function passLoad(parts: PersonParts, taking: boolean, progress: number): void {
  const reach = press(progress),
    weight = Math.sin(progress * Math.PI),
    held = ease(Math.min(1, Math.max(0, (taking ? progress - 0.5 : 0.5 - progress) / 0.08)));
  for (const arm of parts.arms)
    if (arm.free) {
      const from = arm.turn;
      poseArm(
        arm,
        from.upper + (-0.65 - 0.7 * reach - from.upper) * weight,
        from.elbow + (-1.52 + 1.15 * reach - from.elbow) * weight,
        0,
      );
    }
  parts.nod += 0.13 * weight;
  const hand = workHand(parts);
  workPiece(parts, 'parcel')
    .translate(hand.x - 1, hand.y + 0.75)
    .opacity(Math.round(255 * weight * held));
}
