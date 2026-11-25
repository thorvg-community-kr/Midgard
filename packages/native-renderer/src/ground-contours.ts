import { Layer } from '../../engine/src/world-types';
import type { Point } from '../../engine/src/geometry';
import { region, type Sample } from './contours';
import { ShapeNode } from './paint';
import type { TerrainMap, TileRegion } from './render-types';

// The title and the game have separate maps and paints. Reuse the pure contour geometry of the
// last whole map only while every scalar layer still matches, including edits and raised realms.
let previous:
  | { width: number; height: number; layers: Float32Array[]; paths: Map<string, Float32Array> }
  | undefined;

function sameLayer(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; ++i) if (a[i] !== b[i]) return false;
  return true;
}

/** Every region consists of closed straight-sided rings. A NaN pair separates successive rings. */
function pack(shape: ShapeNode): Float32Array {
  const points = new Float32Array(shape.commands.length * 2);
  let i = 0;
  for (const cmd of shape.commands) {
    points[i++] = cmd[0] === 'Z' ? NaN : cmd[1];
    points[i++] = cmd[0] === 'Z' ? NaN : cmd[2];
  }
  return points;
}

function unpack(points: Float32Array): ShapeNode {
  const shape = new ShapeNode();
  let start = true;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i],
      y = points[i + 1];
    if (Number.isNaN(x)) {
      shape.close();
      start = true;
    } else if (start) {
      shape.moveTo(x, y);
      start = false;
    } else shape.lineTo(x, y);
  }
  return shape;
}

export function groundContours(map: TerrainMap, area?: TileRegion) {
  let paths: Map<string, Float32Array> | undefined;
  if (!area && map.layer) {
    const layers: Float32Array[] = [],
      snapshot = previous;
    for (let i = 0; i < Layer.Count; ++i) layers.push(map.layer(i));
    if (
      snapshot &&
      snapshot.width === map.width() &&
      snapshot.height === map.height() &&
      layers.every((data, i) => sameLayer(data, snapshot.layers[i]))
    )
      paths = snapshot.paths;
    else {
      paths = new Map();
      previous = { width: map.width(), height: map.height(), layers: layers.map((a) => a.slice()), paths };
    }
  }
  const contour = (name: string, sample: Sample, margin = 0, shift?: Point, zone = area): ShapeNode => {
    const key = zone ? `${name}@${zone.left},${zone.top},${zone.right},${zone.bottom}` : name;
    const saved = paths?.get(key);
    if (saved) return unpack(saved);
    const shape = region(map, margin, sample, shift, zone);
    paths?.set(key, pack(shape));
    return shape;
  };
  // The same key denotes the same complete scalar fields across independent maps.
  return Object.assign(contour, { cacheKey: paths as object | undefined });
}
