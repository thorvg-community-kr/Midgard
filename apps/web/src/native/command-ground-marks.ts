// Command marks lie on the ground with the combat marks, under the selection rings and every figure: the true
// radius of an aimed skill under the cursor, and the destinations of the selected residents.
import { SceneNode, ShapeNode } from '../../../../packages/native-renderer/src/paint';
import { appendTaperArc, groundRadii, tone } from '../../../../packages/native-renderer/src/combat-paint';
import { project, type Point } from '../../../../packages/engine/src/geometry';
import { Activity } from '../../../../packages/engine/src/person';
import { canControl } from '../../../../packages/engine/src/faction';
import { aimPreview } from './skill-commands';
import type { GameAppState } from './game-app-state';

const maxRings = 2;
const maxDestinations = 12;
interface Ring {
  disc: ShapeNode;
  arcs: ShapeNode;
  /** Radius and reach the paths and colours were last built for. */
  built: string;
}
interface DestinationMark {
  disc: ShapeNode;
  rim: ShapeNode;
  attack?: boolean;
}
interface Marks {
  root: SceneNode;
  rings: Ring[];
  destinations: DestinationMark[];
}
const retained = new WeakMap<SceneNode, Marks>();
/** The renderer's ground layer for combat marks, when the renderer is the real one. */
function groundLayer(app: GameAppState): SceneNode | null {
  const renderer = app.renderer;
  return 'combatGround' in renderer && renderer.combatGround instanceof SceneNode ? renderer.combatGround : null;
}
function marksOn(layer: SceneNode): Marks {
  let marks = retained.get(layer);
  if (!marks) {
    const root = new SceneNode(),
      rings = Array.from({ length: maxRings }, () => ({ disc: new ShapeNode(), arcs: new ShapeNode(), built: '' }));
    for (const ring of rings) root.add(ring.disc).add(ring.arcs);
    marks = { root, rings, destinations: [] };
    retained.set(layer, marks);
  }
  // The layer is emptied when the map is repainted. Reattach the retained marks.
  if (!layer.children.includes(marks.root)) layer.add(marks.root);
  return marks;
}
function buildRing(ring: Ring, radius: number, inReach: boolean): void {
  const key = `${radius}/${inReach}`;
  if (ring.built === key) return;
  ring.built = key;
  const { rx, ry } = groundRadii(radius),
    ink = tone.ink,
    light = inReach ? tone.sand : tone.rust;
  ring.disc.reset().appendCircle(0, 0, rx, ry).fill(ink[0], ink[1], ink[2], inReach ? 44 : 30);
  ring.arcs.reset();
  // Four brush strokes round the rim, tapered at both ends, with small gaps between them.
  for (let i = 0; i < 4; i++) {
    const a0 = (i * Math.PI) / 2 + 0.12,
      a1 = ((i + 1) * Math.PI) / 2 - 0.12;
    appendTaperArc(ring.arcs, rx, ry, a0, a1, Math.max(2.2, rx * 0.06), 0.35, 0.35, 0.5);
  }
  ring.arcs.fill(light[0], light[1], light[2], inReach ? 210 : 190);
}
function buildDestination(mark: DestinationMark, attack: boolean): void {
  if (mark.attack === attack) return;
  mark.attack = attack;
  const color = attack ? tone.rust : tone.sand,
    ink = tone.ink,
    { disc, rim } = mark;
  disc.reset().appendCircle(0, 0, 9, 4.6).fill(ink[0], ink[1], ink[2], 70);
  rim.reset();
  appendTaperArc(rim, 9, 4.6, -Math.PI * 0.92, Math.PI * 0.82, 2.8, 0.25, 0.3, 0.5);
  rim.fill(color[0], color[1], color[2], 235);
}
/** One mark per distinct destination. Residents can still have separate orders when selected together. */
function destinationsOf(app: GameAppState): { at: Point; attack: boolean }[] {
  const destinations: { at: Point; attack: boolean }[] = [];
  for (const id of app.chosen) {
    const p = app.town.person(id);
    if (!canControl(p) || !p.ordered || p.task !== Activity.Moving) continue;
    if (!(p.activity === Activity.Moving && p.moving()) && p.activity !== Activity.Fighting) continue;
    const shared = destinations.find(({ at }) => at.x === p.goal.x && at.y === p.goal.y);
    if (shared) shared.attack ||= p.aggressive;
    else if (destinations.length < maxDestinations) destinations.push({ at: p.goal, attack: p.aggressive });
  }
  return destinations;
}
/** Lays this frame's command marks on the ground, before the renderer syncs the world. */
export function commandGroundMarks(app: GameAppState): void {
  const layer = groundLayer(app);
  if (!layer) return;
  const preview = aimPreview(app),
    destinations = destinationsOf(app);
  if (!preview && !destinations.length) {
    // Nothing to show: hiding the root keeps the layer's own list of children as it is.
    const marks = retained.get(layer);
    if (marks && marks.root.alpha) marks.root.opacity(0);
    return;
  }
  const marks = marksOn(layer);
  marks.root.opacity(255);
  marks.rings.forEach((ring, i) => {
    const shown = preview?.rings[i];
    if (!shown || !preview) {
      ring.disc.opacity(0);
      ring.arcs.opacity(0);
      return;
    }
    buildRing(ring, shown.radius, shown.inReach);
    const at = project(preview.at.x, preview.at.y);
    for (const node of [ring.disc, ring.arcs]) node.translate(at.x, at.y).opacity(255);
  });
  while (marks.destinations.length < destinations.length) {
    const mark = { disc: new ShapeNode(), rim: new ShapeNode() };
    marks.destinations.push(mark);
    marks.root.add(mark.disc).add(mark.rim);
  }
  marks.destinations.forEach((mark, i) => {
    const arrival = destinations[i];
    if (!arrival) {
      mark.disc.opacity(0);
      mark.rim.opacity(0);
      return;
    }
    buildDestination(mark, arrival.attack);
    const p = project(arrival.at.x, arrival.at.y);
    for (const node of [mark.disc, mark.rim]) node.translate(p.x, p.y).opacity(255);
  });
}
