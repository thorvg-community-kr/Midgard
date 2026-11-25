// Literal translation of construction_materials.h from the 2026-11-09 tellin snapshot.
import { Product, Resources, productKeys } from './building-catalog';
import { clamp, f32 } from './numeric';
export const constructionProducts = [
  Product.Wood,
  Product.Stone,
  Product.Food,
  Product.Water,
  Product.Mana,
  Product.Planks,
  Product.CutStone,
  Product.Bones,
] as const;
export function resourceAmount(resources: Resources, product: Product): number {
  const key = productKeys[product];
  return key ? resources[key] : 0;
}
export function resourceBundle(product: Product, amount: number): Resources {
  const result = new Resources(), key = productKeys[product];
  if (key) result[key] = amount;
  return result;
}
export class ConstructionMaterials {
  constructor(
    public required = new Resources(),
    public delivered = new Resources(),
  ) {}
  missing(product: Product): number {
    return Math.max(0, resourceAmount(this.required, product) - resourceAmount(this.delivered, product));
  }
  surplus(product: Product): number {
    return Math.max(0, resourceAmount(this.delivered, product) - resourceAmount(this.required, product));
  }
  limit(): number {
    let result = 1;
    for (const product of constructionProducts) {
      const need = resourceAmount(this.required, product);
      if (need > 0) result = Math.min(result, f32(f32(resourceAmount(this.delivered, product)) / f32(need)));
    }
    return clamp(result, 0, 1);
  }
}
