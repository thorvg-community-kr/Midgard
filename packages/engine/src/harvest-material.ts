import { Product } from './building-catalog';
import { toolFor } from './equipment';
import type { Person } from './person';
import { hash01 } from './numeric';
import * as mining from './mining';
import type { WorldMap } from './world-map';
import { Terrain } from './world-types';

/** A deposit or stand keeps its identity through fog, seasons, regrowth and loading a save. */
export function harvestProduct(map: WorldMap, x: number, y: number, stone: boolean): Product {
  const terrain = map.at(x, y).terrain;
  if (!stone) return terrain === Terrain.Frost ? Product.Frostwood : Product.Wood;
  if (map.basaltCell === y * map.width() + x) return Product.CinderOre;
  if (terrain === Terrain.Ash) return Product.CinderOre;
  if (terrain === Terrain.Frost) return Product.IronOre;
  // Some exposed rock at the foot of a distant peak carries iron too.
  if (terrain !== Terrain.Rock || hash01(map.seed(), x, y, 63) >= 0.22) return Product.Stone;
  const camp = map.start();
  if ((x - camp.x) ** 2 + (y - camp.y) ** 2 < 16 * 16) return Product.Stone;
  for (const [dx, dy] of mountainNeighbors) {
    if (!map.inside(x + dx, y + dy)) continue;
    const adjacent = map.at(x + dx, y + dy).terrain;
    if (adjacent === Terrain.Mountain || adjacent === Terrain.Ice || adjacent === Terrain.Frost) return Product.IronOre;
  }
  return Product.Stone;
}
const mountainNeighbors = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;
export const harvestAmount = (product: Product): number => product === Product.CinderOre ? 2 : 3;
const tools = {
  [Product.IronOre]: { work: 'mining', tier: 2, needs: 'Needs a stone pick or better' },
  [Product.CinderOre]: { work: 'mining', tier: 3, needs: 'Needs an iron pick or better' },
  [Product.Frostwood]: { work: 'woodcutting', tier: 2, needs: 'Needs a stone axe or better' },
} as const;
function harvestTool(product: Product) {
  if (product === Product.IronOre || product === Product.CinderOre || product === Product.Frostwood) return tools[product];
  return null;
}
export const harvestNeeds = (product: Product, basalt = false): string =>
  basalt ? 'Needs an embersteel pick' : harvestTool(product)?.needs ?? '';
export function canHarvest(person: Person, product: Product, basalt = false): boolean {
  if (basalt) return (toolFor(person, ['mining'])?.tier ?? 0) >= 4;
  const tool = harvestTool(product);
  return !tool || (toolFor(person, [tool.work])?.tier ?? 0) >= tool.tier;
}
export const minedProduct = (kind: Product): boolean =>
  kind === Product.Stone || kind === Product.IronOre || kind === Product.CinderOre;
/** Match the requested material before routing to a deposit or stand. */
export function supplies(map: WorldMap, x: number, y: number, product: Product): boolean {
  const stone = minedProduct(product);
  return (stone ? mining.deposit(map, x, y) : map.at(x, y).trees > 0) && harvestProduct(map, x, y, stone) === product;
}
export function harvestName(product: Product, basalt = false): string {
  if (basalt) return 'Cooled basalt';
  switch (product) {
    case Product.Frostwood: return 'Frostwood spruce';
    case Product.IronOre: return 'Iron vein';
    case Product.CinderOre: return 'Cinder vein';
    case Product.Wood: return 'Tree';
    default: return 'Stone';
  }
}
