import { Structure } from './building-catalog';
import { add, point, rotated } from './geometry';
import { AnimalKind, Monster } from './person';
import type { Building } from './town-models';
import { TownState } from './town-state';
import { animalSpec } from './wildlife';

export const breedingStalls = [
  point(-.50, .54), point(.48, .52), point(.02, .12), point(.58, -.12), point(-.67, -.10),
];
export const penCapacity = breedingStalls.length;
export const nestCapacity = 12;
const day = TownState.secondsPerDay;
const layingInterval = day / 4;
const breeds = [
  { kind: AnimalKind.Pig, timer: 'pigBreeding', interval: day * .4, growth: day * .3, spot: point(.61, .12) },
  { kind: AnimalKind.Cow, timer: 'cowBreeding', interval: day * .6, growth: day * .4, spot: point(.37, -.62) },
] as const;

export const stockInPen = (town: TownState, id: number): Monster[] =>
  town.animals.filter(a => a.pen === id && a.health > 0);

export function ranchGrowth(animal: Monster, now: number): number {
  if (animal.ranchBornAt < 0) return 1;
  const breed = breeds.find(b => b.kind === animal.animal);
  return breed ? Math.min(1, Math.max(0, (now - animal.ranchBornAt) / breed.growth)) : 1;
}

/** The breeding adults stay in the pen. Only their fully grown young can provide meat. */
export function readyForMeat(stock: Monster[], now: number): Monster[] {
  return stock.filter(a => a.ranchBornAt >= 0 && ranchGrowth(a, now) >= 1 &&
    stock.filter(parent => parent.ranchBornAt < 0 && parent.animal === a.animal).length >= 2);
}

function advanceBreeding(town: TownState, pen: Building, stock: Monster[], dt: number): void {
  for (const breed of breeds) {
    const family = stock.filter(a => a.animal === breed.kind);
    if (family.length < 2 || family.some(a => a.ranchBornAt >= 0)) {
      pen[breed.timer] = 0;
      continue;
    }
    pen[breed.timer] = Math.min(breed.interval, pen[breed.timer] + dt);
    if (pen[breed.timer] < breed.interval || town.animals.length >= 128) continue;
    const home = add(pen.center, rotated(breed.spot, pen.angle));
    const young = new Monster(town.nextMonster++, -1, home);
    young.animal = breed.kind;
    young.health = young.vigor = animalSpec(breed.kind).health;
    young.pen = pen.id;
    young.home = { ...home };
    young.ranchBornAt = town.clock();
    town.animals.push(young);
    pen[breed.timer] = 0;
  }
}

export function advanceRanches(town: TownState, dt: number): void {
  for (const pen of town.placed) {
    if (pen.kind !== Structure.Ranch || !pen.built() || pen.faction !== town.controlFaction) continue;
    const stock = stockInPen(town, pen.id);
    const hens = stock.filter(a => a.animal === AnimalKind.Chicken).length;
    if (hens && pen.eggs < nestCapacity) {
      pen.productionProgress += dt * hens / layingInterval;
      const laid = Math.floor(pen.productionProgress + 1e-9);
      pen.eggs = Math.min(nestCapacity, pen.eggs + laid);
      pen.productionProgress = pen.eggs === nestCapacity ? 0 : Math.max(0, pen.productionProgress - laid);
    } else pen.productionProgress = 0;
    advanceBreeding(town, pen, stock, dt);
  }
}
