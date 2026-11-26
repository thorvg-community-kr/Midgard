import { livestockRecipe, produceCapacity } from './pasture-geometry';
export { livestockRecipe } from './pasture-geometry';
import type { Monster } from './person';
import type { Building } from './town-models';
import type { TownState } from './town-state';

export const stockInPen = (town: TownState, id: number): Monster[] =>
  town.animals.filter(a => a.pen === id && a.health > 0);

interface LivestockTown extends TownState {
  settlementOf(b: Building): number;
}
/** In pen order, set aside a full ration and space for each animal's complete daily batch. */
export function* livestockBatches(town: LivestockTown, village: number, food: number, water: number) {
  if (village < 0) return;
  for (const pen of town.placed) {
    const recipe = livestockRecipe(pen.kind);
    if (!recipe || !pen.built() || pen.faction !== town.controlFaction || town.settlementOf(pen) !== village) continue;
    const count = Math.min(
      stockInPen(town, pen.id).filter(animal => animal.animal === recipe.species).length,
      Math.floor(food / recipe.feed), Math.floor(water / recipe.water),
      Math.floor((produceCapacity(pen) - pen.storedProduce) / recipe.food),
    );
    if (count < 1) continue;
    const feed = count * recipe.feed, drink = count * recipe.water;
    food -= feed;
    water -= drink;
    yield { pen, feed, water: drink, produce: count * recipe.food };
  }
}
