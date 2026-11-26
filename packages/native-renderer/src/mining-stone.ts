import { Product } from '../../engine/src/building-catalog';
import { point, type Point } from '../../engine/src/geometry';
import * as mining from '../../engine/src/mining';
import { f32, hash01 } from '../../engine/src/numeric';
import type { WorldMap } from '../../engine/src/world-map';
import { stone } from './flat-forms';
import { ShapeNode, type Rgb } from './paint';
import { appendPolygon } from './vector-paint';
export const stoneLit: Rgb = [92, 90, 96];
export const stoneShade: Rgb = [60, 58, 66];
const basaltColors = { lit: [105, 89, 94], shade: [58, 54, 68] } as const;
const ironColors = { lit: [153, 111, 85], shade: [100, 79, 78], seam: [220, 176, 120] } as const;
const cinderColors = { lit: [91, 73, 84], shade: [60, 52, 65], seam: [207, 109, 77] } as const;
const stoneColors = { lit: stoneLit, shade: stoneShade };
export function depositColors(product: Product, basalt: boolean): { lit: Rgb; shade: Rgb; seam?: Rgb } {
  if (basalt) return basaltColors;
  if (product === Product.IronOre) return ironColors;
  return product === Product.Stone ? stoneColors : cinderColors;
}
export function appendStone(lit: ShapeNode, shade: ShapeNode, b: Point, s: number): void {
  appendPolygon(lit, [
    point(f32(b.x - s), b.y),
    point(f32(b.x - f32(s * f32(0.3))), f32(b.y - f32(s * f32(1.1)))),
    point(f32(b.x + f32(s * f32(0.2))), f32(b.y + f32(s * f32(0.2)))),
  ]);
  appendPolygon(shade, [
    point(f32(b.x + f32(s * f32(0.2))), f32(b.y + f32(s * f32(0.2)))),
    point(f32(b.x - f32(s * f32(0.3))), f32(b.y - f32(s * f32(1.1)))),
    point(f32(b.x + s), f32(b.y - f32(s * f32(0.1)))),
  ]);
}

/** Fieldstones lie in uneven groups around one mining spot. All pieces share the same two paints. */
function fieldstones(lit: ShapeNode, shade: ShapeNode, base: Point, size: number, map: WorldMap, x: number, y: number): void {
  const vary = (salt: number) => hash01(map.seed(), x, y, salt);
  const side = vary(64) < 0.5 ? -1 : 1;
  const main = size * (0.82 + vary(65) * 0.22);
  const shoulder = size * (0.25 + vary(66) * 0.38);
  const offset = -side * size * (0.05 + vary(67) * 0.34);
  const arrangement = vary(69), origin = point();
  stone(lit, shade, origin, offset, 0, main);
  if (arrangement > 0.18)
    stone(lit, shade, origin, offset + side * (main + shoulder * 0.63), size * (vary(68) - 0.4) * 1.05, shoulder);
  if (arrangement > 0.62)
    stone(lit, shade, origin, offset - side * main * 0.9, size * 0.4, size * (0.18 + vary(70) * 0.19));

  // Seat the group at the mining foot. Bake its tilt into the outlines so the distant scenery batch keeps it.
  const rise = 0.65 + vary(71) * 0.4, lean = (vary(72) - 0.5) * 0.95;
  for (const face of [lit, shade]) for (const p of face.commands) {
    if (p[0] !== 'M' && p[0] !== 'L') continue;
    p[1] = f32(base.x + p[1] + lean * p[2]);
    p[2] = f32(base.y + rise * p[2]);
  }
}

export function depositPaint(product: Product, base: Point, map: WorldMap, x: number, y: number): ShapeNode[] {
  const size = mining.size(map, x, y), basalt = map.basaltCell === y * map.width() + x;
  const lit = new ShapeNode(), shade = new ShapeNode(), colors = depositColors(product, basalt);
  if (product === Product.Stone && !basalt) {
    fieldstones(lit, shade, base, size, map, x, y);
    return [lit.fill(...colors.lit), shade.fill(...colors.shade)];
  }
  if (basalt) {
    // Three cooling columns interlock across the pass. Their broken tops show where the pick can bite.
    const at = (x: number, y: number) => point(base.x + x * size, base.y + y * size);
    for (const [x, y, h] of [[-0.64, 0, 0.91], [0.55, -0.09, 0.87], [-0.03, 0.14, 1.24]]) {
      appendPolygon(lit, [at(x - 0.38, y), at(x - 0.38, y - h + 0.12), at(x, y - h), at(x + 0.28, y - h + 0.12), at(x + 0.04, y + 0.08)]);
      appendPolygon(shade, [at(x + 0.04, y + 0.08), at(x + 0.04, y - h + 0.2), at(x + 0.28, y - h + 0.12), at(x + 0.28, y - 0.04)]);
    }
    return [lit.fill(...colors.lit), shade.fill(...colors.shade)];
  }
  appendStone(lit, shade, base, size);
  const faces = [lit.fill(...colors.lit), shade.fill(...colors.shade)];
  if (!colors.seam) return faces;
  const seam = new ShapeNode();
  appendPolygon(seam, [
    point(base.x - size * 0.75, base.y - size * 0.18),
    point(base.x - size * 0.21, base.y - size * 0.78),
    point(base.x + size * 0.35, base.y - size * 0.48),
    point(base.x - size * 0.18, base.y - size * 0.53),
  ]);
  return [...faces, seam.fill(...colors.seam)];
}
