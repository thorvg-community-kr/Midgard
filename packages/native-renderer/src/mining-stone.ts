import { Product } from '../../engine/src/building-catalog';
import { point, type Point } from '../../engine/src/geometry';
import * as mining from '../../engine/src/mining';
import { f32, hash01 } from '../../engine/src/numeric';
import type { WorldMap } from '../../engine/src/world-map';
import { ShapeNode, type Rgb } from './paint';
import { appendPolygon } from './vector-paint';
export const stoneLit: Rgb = [114, 115, 121];
export const stoneShade: Rgb = [69, 70, 81];
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

export const stoneStageScale = (stage: number): number => 1 - 0.18 * stage;

/** A weathered boulder with a flat fracture on the shoulder facing the miner. */
function boulder(lit: ShapeNode, shade: ShapeNode, base: Point, size: number, map: WorldMap, x: number, y: number): void {
  const stage = map.at(x, y).miningStage ?? 0;
  const half = size * stoneStageScale(stage), height = half * (0.92 + 0.31 * hash01(map.seed(), x, y, 71));
  const lean = (hash01(map.seed(), x, y, 72) - 0.5) * 0.52;
  const at = (u: number, v: number): [number, number] => [base.x + half * (u - lean * v), base.y + height * v];
  const shoulder = 0.58 - 0.10 * stage, crown = -0.90 + 0.055 * stage;
  const frontEdge = (face: ShapeNode) => face
    .cubicTo(...at(0.73, -0.65), ...at(0.98, -0.38), ...at(1, -0.16))
    .cubicTo(...at(1.02, -0.04), ...at(0.79, 0.05), ...at(0.60, 0.10))
    .cubicTo(...at(0.22, 0.17), ...at(-0.61, 0.16), ...at(-0.89, 0.055))
    .cubicTo(...at(-0.98, 0.02), ...at(-1.01, -0.04), ...at(-0.98, -0.14)).close();

  lit.moveTo(...at(-0.98, -0.14));
  shade.moveTo(...at(-0.98, -0.14));
  if (stage === 0) {
    lit.cubicTo(...at(-0.91, -0.38), ...at(-0.74, -0.67), ...at(-0.55, -0.80))
      .cubicTo(...at(-0.37, -0.92), ...at(-0.27, -1.01), ...at(-0.09, -1));
    shade.cubicTo(...at(-0.73, -0.13), ...at(-0.39, -0.21), ...at(-0.17, -0.33));
  } else {
    const lip = -0.85 + 0.055 * stage, shelf = lip + 0.20 + 0.065 * stage, rim = -0.40 - 0.055 * stage;
    for (const face of [lit, shade]) face
      .cubicTo(...at(-0.97, -0.24), ...at(lip - 0.055, rim + 0.045), ...at(lip, rim))
      .lineTo(...at(shelf, rim - 0.04));
    lit.lineTo(...at(-0.28 + 0.055 * stage, -0.92 + 0.035 * stage))
      .cubicTo(...at(-0.19 + 0.055 * stage, -0.96 + 0.035 * stage), ...at(-0.06, -0.97), ...at(0.02, -0.97));
    shade.lineTo(...at(-0.18 + 0.055 * stage, -0.33));
  }
  frontEdge(lit.cubicTo(...at(0.12, -0.97), ...at(shoulder - 0.10, crown - 0.07), ...at(shoulder, crown)));
  frontEdge(shade.lineTo(...at(0.16, -0.48))
    .cubicTo(...at(shoulder - 0.08, -0.57), ...at(shoulder + 0.02, crown + 0.12), ...at(shoulder, crown)));
}

export function depositPaint(product: Product, base: Point, map: WorldMap, x: number, y: number): ShapeNode[] {
  const size = mining.size(map, x, y), basalt = map.basaltCell === y * map.width() + x;
  const lit = new ShapeNode(), shade = new ShapeNode(), colors = depositColors(product, basalt);
  if (product === Product.Stone && !basalt) {
    boulder(lit, shade, base, size, map, x, y);
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
