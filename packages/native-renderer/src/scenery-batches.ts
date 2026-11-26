import type { Rect } from '../../native-ui/src/types';
import { mistTones } from './mist-bands';
import { identity, SceneNode, ShapeNode, StaticShapeLayer, type Gradient, type PaintNode } from './paint';

/** Below this zoom, fully remembered scenery occupies little of the picture per object. */
export const distantSceneryZoom = 0.65;
export const fullyRemembered = (paint: SceneNode): boolean =>
  paint.shade?.tone === mistTones.veil && paint.shade.strength === mistTones.memory;

interface Member {
  paint: SceneNode;
  bounds: Rect;
  band: number;
}
const scenery = new WeakMap<PaintNode, Member>();
const retained = new WeakMap<Member, SceneryBatch>();
const materials = new WeakMap<ShapeNode, { key: string; gradient?: Gradient }>();

/** The row owns these filled, immutable outlines. Work reactions and wind move their parent. */
export function registerScenery(paint: SceneNode, bounds: Rect, footY = bounds.y + bounds.h): void {
  // A batch shares one rise of the mist: its members' feet lie within a band, so it sits at all their knees.
  scenery.set(paint, { paint, bounds, band: Math.floor(footY / 16) });
}

function material(shape: ShapeNode) {
  let value = materials.get(shape);
  if (value) return value;
  let gradient = shape.gradient;
  if (gradient) {
    // Each tree's ramp starts at its own foot. Moving either end by at most four world
    // pixels lets nearby trees share a ramp in the dark of the distant forest.
    gradient = { ...gradient, coordinates: gradient.coordinates.map((n) => Math.round(n / 8) * 8) };
  }
  value = { key: JSON.stringify(gradient ?? shape.color), gradient };
  materials.set(shape, value);
  return value;
}

/** Members have disjoint horizontal extents. Their outlines can share paint by material
 * while each member keeps its own layers, selection bounds and position in the painter order. */
export class SceneryBatch extends StaticShapeLayer {
  constructor(readonly members: readonly Member[]) {
    const layers: Map<string, ShapeNode>[] = [];
    for (const { paint } of members) {
      paint.children.forEach((child, i) => {
        const shape = child as ShapeNode;
        const { key, gradient } = material(shape);
        const layer = (layers[i] ??= new Map());
        let merged = layer.get(key);
        if (!merged) {
          merged = new ShapeNode();
          if (gradient) merged.fillGradient(gradient);
          else merged.fill(...shape.color!);
          layer.set(key, merged);
        }
        for (const command of shape.commands) merged.commands.push(command);
      });
    }
    const shapes: ShapeNode[] = [];
    for (const layer of layers) for (const shape of layer.values()) shapes.push(shape);
    super(shapes);
    // Every member stands as deep in the mist; its rise is measured from the middle of their feet.
    const shade = members[0].paint.shade,
      rise = shade?.rise;
    this.shaded(
      rise
        ? {
            ...shade,
            rise: {
              ...rise,
              foot: members.reduce((sum, { paint }) => sum + (paint.shade?.rise?.foot ?? rise.foot), 0) / members.length,
            },
          }
        : shade,
    );
  }
}

/** Keep moving, nearby, overlapping and newly visible objects in their ordinary painter slots. */
export function batchScenery(order: PaintNode[], zoom: number): PaintNode[] {
  if (zoom > distantSceneryZoom || !order.length) return order;
  const result: PaintNode[] = [];
  let group: Member[] = [];
  const flush = () => {
    const first = group[0];
    if (!first) return;
    if (group.length === 1) result.push(first.paint);
    else {
      const previous = retained.get(first);
      if (previous && previous.members.length === group.length && group.every((p, i) => p === previous.members[i])) {
        result.push(previous);
      } else {
        const batch = new SceneryBatch(group);
        retained.set(first, batch);
        result.push(batch);
      }
    }
    group = [];
  };
  // Rounding a hit region out to physical pixels must not reach a neighbouring
  // outline, even when browser zoom scales the canvas down to a quarter of its CSS size.
  const gap = 4 / zoom;
  for (const paint of order) {
    const member = scenery.get(paint);
    if (
      !member || paint.alpha !== 255 || !fullyRemembered(member.paint) ||
      (paint.matrix !== identity && !paint.matrix.every((v, i) => v === identity[i]))
    ) {
      flush();
      result.push(paint);
      continue;
    }
    const bounds = member.bounds;
    if (
      group.length &&
      (member.band !== group[0].band || group.length >= 24 ||
        group.some(({ bounds: other }) => bounds.x <= other.x + other.w + gap && other.x <= bounds.x + bounds.w + gap))
    ) flush();
    group.push(member);
  }
  flush();
  return result;
}
