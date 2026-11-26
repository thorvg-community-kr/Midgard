import { Structure } from './building-catalog';
import { area, type Outline } from './geometry';
import { AnimalKind } from './person';
import type { Building } from './town-models';

const hen = { species: AnimalKind.Chicken, stalls: 5, feed: 1, water: 1, food: 2, capacity: 12 } as const;
const cow = { species: AnimalKind.Cow, stalls: 2, feed: 2, water: 2, food: 5, capacity: 20 } as const;

export const livestockRecipe = (kind: Structure) =>
  kind === Structure.ChickenCoop ? hen : kind === Structure.Cowshed ? cow : null;

export const pastureRules = { minimum: 8, maximum: 96, maxCorners: 256 } as const;

/** Only the grazable ground counts toward capacity. A cow needs twice a hen's space. */
export function roomOnPasture(kind: Structure, grass: Outline): number {
  const recipe = livestockRecipe(kind);
  if (!recipe) return 0;
  return grass.length ? Math.floor(area(grass) / (kind === Structure.Cowshed ? 4 : 2)) : recipe.stalls;
}

export function pastureCapacity(pen: Building): number {
  return roomOnPasture(pen.kind, pen.pasture);
}

export function pastureOutline(pen: Building): Outline {
  return pen.pasture.length ? pen.pasture : pen.footprint().corners();
}

/** A full herd can produce a batch before the keeper needs to empty the nest or pails. */
export function produceCapacity(pen: Building): number {
  const recipe = livestockRecipe(pen.kind);
  return recipe ? Math.max(recipe.capacity, pastureCapacity(pen) * recipe.food) : 0;
}
