import { Product } from '../../engine/src/building-catalog';
// Exact shared stone geometry from src/game/mining.h (2026-11-09).
import { point, type Point } from '../../engine/src/geometry';
import { f32 } from '../../engine/src/numeric';
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

/** Exposed iron is rusty ochre; a charcoal cinder vein breaks along a copper-red seam. */
export function depositPaint(product: Product, base: Point, size: number, basalt = false): ShapeNode[] {
  const lit = new ShapeNode(), shade = new ShapeNode(), colors = depositColors(product, basalt);
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
