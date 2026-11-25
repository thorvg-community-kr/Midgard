import { project, type Point } from '../../engine/src/geometry';
import type { Person } from '../../engine/src/person';
import type { Town } from '../../engine/src/town';
import { SceneNode, ShapeNode } from './paint';
import { DepthSlot, boxAt, inFront } from './combat-depth';
import { reachArm } from './person-arm';
import type { PersonParts } from './world-sprites';
import type { Figure, WorldRendererState } from './world-renderer-state';
import { arrivalFoot, arrivalSeconds, emergedAt, interruptsArrival, riseAt, riseTime } from './arrival-pose';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};

/** A quiet bow and joined hands, with the feet held on the altar's approach. */
export function animatePrayer(parts: PersonParts, elapsed: number, duration: number): void {
  const bow = smooth(elapsed / 0.65) * smooth((duration - elapsed) / 0.55),
    breath = Math.sin(elapsed * 2.1) * 0.008 * bow;
  const chest = (parts.arms[0].shoulder.y + parts.arms[1].shoulder.y) / 2 + 1.4;
  reachArm(parts.arms[0], { x: -0.35, y: chest }, bow, 0, 0);
  reachArm(parts.arms[1], { x: 0.35, y: chest }, bow, 0, 0);
  // The worshipper bows from the waist and lowers the head; nothing is squashed.
  parts.body?.transform([1, -0.06 * bow, 0.3 * bow, 0, 1 - 0.07 * bow + breath, 0, 0, 0, 1]);
  parts.nod = 0.3 * bow;
  parts.feet[0]?.translate(0, 0);
  parts.feet[1]?.translate(0, 0);
  parts.shadow?.transform([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

// In the ground plane the carved stave is foreshortened toward the top of the screen.
function stave(): ShapeNode {
  return new ShapeNode()
    .moveTo(-7, 3.5)
    .lineTo(6.4, -3.2)
    .moveTo(4.6, -2.3)
    .lineTo(10, -1.7)
    .lineTo(11, -0.1)
    .moveTo(0.5, -0.25)
    .lineTo(5.6, 0.4)
    .lineTo(6.6, 1.9)
    .strokeWidth(1.25)
    .strokeJoin('round')
    .strokeCap('round')
    .strokeFill(235, 188, 104);
}

function groundSign(): SceneNode {
  const ground = new SceneNode();
  // A curved break in the sod, with its near face catching the light.
  ground.add(
    new ShapeNode()
      .moveTo(-18, 2)
      .cubicTo(-14, -0.5, -8, -0.8, -5, -2.7)
      .cubicTo(0, -4.3, 4, -2, 8, -3.3)
      .cubicTo(12, -4, 16, -4, 18, -2.5)
      .cubicTo(11, -2, 8, 0.7, 4, 2)
      .cubicTo(0, 3.2, -3, 1.7, -8, 3)
      .cubicTo(-11, 4, -15, 3, -18, 2)
      .close()
      .fill(67, 48, 51),
  );
  ground.add(
    new ShapeNode()
      .moveTo(-17, 2.2)
      .cubicTo(-10, 3, -6.5, 0.2, -1.5, 1.2)
      .cubicTo(3, 2.2, 7, -0.8, 11, -1)
      .cubicTo(6.5, 0.6, 4, 3.7, -1, 2.8)
      .cubicTo(-7, 2.1, -10.5, 5.4, -17, 2.2)
      .close()
      .fill(177, 124, 75),
  );
  ground.add(stave().translate(-12, -2)).add(stave().translate(11, 2));
  return ground;
}

function looseEarth(): SceneNode {
  const piece = new SceneNode();
  piece.add(
    new ShapeNode()
      .moveTo(-2.7, -0.4)
      .cubicTo(-2.8, -1.6, -0.6, -2.2, 1.1, -1.7)
      .cubicTo(2.1, -1.3, 3.1, 0, 2.5, 0.8)
      .lineTo(0.4, 2)
      .cubicTo(-0.9, 2.5, -2.1, 1.3, -2.7, -0.4)
      .close()
      .fill(101, 66, 53),
  );
  piece.add(
    new ShapeNode()
      .moveTo(-2.6, -0.5)
      .cubicTo(-2.6, -1.5, -0.5, -2.2, 1.1, -1.7)
      .lineTo(2.2, -0.8)
      .cubicTo(1.4, 0.1, -0.8, 0.6, -2.6, -0.5)
      .close()
      .fill(198, 150, 93),
  );
  return piece;
}

class Arrival {
  private readonly ground = groundSign();
  private readonly earth: DepthSlot;
  private readonly pieces = Array.from({ length: 5 }, looseEarth);
  private readonly opening = new SceneNode().clip(
    new ShapeNode().appendRect(-48, -68, 96, 69).fill(255, 255, 255),
  );
  private root?: SceneNode;
  private released = false;
  private readonly at: Point;

  constructor(
    readonly person: number,
    readonly started: number,
    private readonly position: Point,
  ) {
    this.at = project(position.x, position.y);
    this.earth = new DepthSlot('altar-earth:' + person);
    for (const piece of this.pieces) this.earth.node.add(piece);
    this.earth.node.translate(this.at.x, this.at.y);
  }

  private unclip(): void {
    // Put the original rig back in its own slot so gear, picking and the next pose stay attached.
    if (this.root) {
      const index = this.root.children.indexOf(this.opening);
      if (index >= 0) this.root.children[index] = this.opening.children[0];
      ++this.root.version;
      this.opening.remove();
      this.root = undefined;
    }
  }

  private reveal(figure: Figure, rise: number): void {
    const body = figure.parts.body;
    if (!body) return;
    if (this.root !== figure.paint) {
      this.unclip();
      const index = figure.paint.children.indexOf(body);
      if (index < 0) return;
      this.opening.add(body);
      figure.paint.children[index] = this.opening;
      ++figure.paint.version;
      this.root = figure.paint;
    }
    // The horizontal clip stays at the fixed ground line while the actual posed body rises through it.
    const m = body.matrix;
    const depth = 11.5 - figure.parts.neck.y;
    body.translate(m[2], m[5] + depth * (1 - rise));
    figure.parts.shadow?.transform([rise, 0, 0, 0, rise, 0, 0, 0, 1]);
    if (rise === 0) figure.paint.opacity(0);
  }

  pose(person: Person, s: WorldRendererState, now: number): Figure['arrival'] {
    const age = now - this.started;
    if (s.reducedMotion || interruptsArrival(person) || s.currentVisibility.sample(this.position) < 119)
      this.released = true;
    if (this.released) return;
    return { foot: arrivalFoot(this.position, person, age, false), rising: age < emergedAt };
  }

  update(s: WorldRendererState, now: number): void {
    const age = now - this.started;
    const visible = s.currentVisibility.sample(this.position) >= 119;
    if (!s.combatGround.children.includes(this.ground)) s.combatGround.add(this.ground);
    const still = s.reducedMotion;
    const rise = 1 - (1 - clamp((age - riseAt) / riseTime)) ** 2;
    const figure = s.figures.get(this.person);
    if (figure?.seen && figure.arrival?.rising) this.reveal(figure, rise);
    else this.unclip();
    const open = still ? 1 : 0.32 + 0.68 * smooth(age / 0.27);
    const strength = still ? 1 : 1 - smooth((age - emergedAt) / (arrivalSeconds - emergedAt));
    this.ground.transform([open, 0, this.at.x, 0, open, this.at.y, 0, 0, 1]);
    this.ground.opacity(visible ? Math.round(255 * strength) : 0);
    if (still || !visible) {
      this.earth.detach();
      return;
    }
    this.earth.place(
      s,
      inFront(this.position),
      boxAt(this.at.x, this.at.y, { x0: -23, y0: -25, x1: 23, y1: 7 }),
    );
    this.pieces.forEach((piece, i) => {
      const t = clamp((age - 0.24 - i * 0.055) / (0.52 + (i % 3) * 0.09));
      const side = i % 2 ? -1 : 1,
        k = i < 2 ? 1 : 0.58;
      const angle = side * (t * 1.2 + i * 0.51);
      const x = side * (4 + i * 0.7 + (9 + (i % 3) * 1.6) * (1 - (1 - t) ** 2));
      const y = 1 + (i % 3) - (10 + (i % 3) * 3.2) * 4 * t * (1 - t);
      piece.transform([
        k * Math.cos(angle),
        -k * Math.sin(angle),
        x,
        k * Math.sin(angle),
        k * Math.cos(angle),
        y,
        0,
        0,
        1,
      ]);
      piece.opacity(Math.round(255 * smooth(t / 0.12) * (1 - smooth((t - 0.68) / 0.32))));
    });
  }

  remove(s: WorldRendererState): void {
    this.unclip();
    s.combatGround.remove(this.ground);
    this.earth.detach();
  }
}

interface Effects {
  town: Town;
  next: bigint;
  arrivals: Map<number, Arrival>;
}
const states = new WeakMap<WorldRendererState, Effects>();

/** Real altar events are transient. Their on-screen reveal runs on presentation time, even in a paused town. */
export function altarArrivals(s: WorldRendererState, town: Town, seconds: number): ReadonlyMap<number, Arrival> {
  let state = states.get(s);
  if (!state || state.town !== town) {
    if (state) for (const item of state.arrivals.values()) item.remove(s);
    states.set(s, (state = { town, next: 0n, arrivals: new Map() }));
  }
  for (const event of town.devotionEvents?.() ?? []) {
    if (event.serial < state.next) continue;
    state.next = event.serial + 1n;
    if (town.clock() - event.at < arrivalSeconds && s.currentVisibility.sample(event.position) >= 119)
      state.arrivals.set(event.person, new Arrival(event.person, seconds, { ...event.position }));
  }
  for (const [id, item] of state.arrivals) {
    const age = seconds - item.started;
    if (age < 0 || age >= arrivalSeconds) {
      item.remove(s);
      state.arrivals.delete(id);
    }
  }
  return state.arrivals;
}
