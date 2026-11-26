import { Resources, structureSpec } from './building-catalog';
import { canControl } from './faction';
import { distance, lerp, type Point } from './geometry';
import { Activity, AnimalKind, type Monster, type Person } from './person';
import type { Town } from './town';
import type { Building } from './town-models';
import type { TownState } from './town-state';
import { livestockRecipe, stockInPen } from './ranch-cycle';
import { pastureCapacity } from './pasture-geometry';
import { admitToPasture, grazeInPasture, pastureGate } from './pasture-roaming';
import { animalSpec } from './wildlife';

export const livestockKind = (kind: AnimalKind | null): boolean =>
  kind === AnimalKind.Cow || kind === AnimalKind.Chicken;
export function localRanches(town: Town, p: Person, kind?: AnimalKind | null): Building[] {
  return town.buildings().filter(b => {
    const recipe = livestockRecipe(b.kind);
    return recipe && (kind === undefined || kind === recipe.species) && b.built() && b.faction === p.faction &&
    town.settlementOf(b) === town.settlementOf(p) && !town.inRealm(p.position) && !town.inRealm(b.center);
  });
}
const claimed = (p: Person) => p.task === Activity.Herding && p.job === p.taskSite && p.health > 0 && p.downedAt < 0;
export function herdLeader(town: TownState, animal: Monster): Person | undefined {
  return town.folk.find(p => claimed(p) && p.herdAnimal === animal.id);
}
function occupiedStalls(town: Town, pen: Building): number {
  const reserved = town.folk.filter(p => claimed(p) && p.taskSite === pen.id && (town.creature(p.herdAnimal)?.pen ?? 0) < 0);
  return stockInPen(town, pen.id).length + reserved.length;
}
export function penHasRoom(town: Town, pen: Building): boolean {
  return occupiedStalls(town, pen) < pastureCapacity(pen);
}
/** Only an assigned keeper between duties can set out for a new animal. */
export function availableRanchHand(town: Town, p: Person, pen: Building): boolean {
  if (p.job !== pen.id || !livestockRecipe(pen.kind) || !pen.built() || pen.faction !== p.faction ||
      !canControl(p, town.controlFaction) || p.recoveringRest || p.recoveringHealth || p.hunting ||
      town.settlementOf(p) !== town.settlementOf(pen) || town.inRealm(p.position)) return false;
  const onDuty = p.task === Activity.Working && p.taskSite === pen.id;
  return (onDuty || (!p.ordered && p.task === Activity.Idle)) &&
    (p.activity === Activity.Idle || p.activity === Activity.Holding || p.activity === Activity.Working);
}
function availableAnimal(town: Town, animal: Monster, species: AnimalKind): boolean {
  return animal.animal === species && animal.health > 0 && animal.pen < 0 &&
    town.world.revealed(animal.position) && !herdLeader(town, animal);
}
export function canLeadAnimal(town: Town, p: Person, animal: Monster): boolean {
  const pen = p.job < 0 ? null : town.building(p.job), recipe = pen && livestockRecipe(pen.kind);
  return !!pen && !!recipe && availableRanchHand(town, p, pen) && availableAnimal(town, animal, recipe.species) && penHasRoom(town, pen);
}
export function leadLivestock(town: Town, p: Person, chosen?: Monster, destination?: Building): boolean {
  const pen = p.job < 0 ? null : town.building(p.job), recipe = pen && livestockRecipe(pen.kind);
  if (!pen || !recipe || (destination && destination !== pen) || !availableRanchHand(town, p, pen) || !penHasRoom(town, pen)) return false;
  if (!chosen && !destination) {
    const stock = town.stock(town.settlementOf(pen));
    if (stock.food < recipe.feed || stock.water < recipe.water) return false;
  }
  const gate = pastureGate(pen);
  const routes = (chosen ? [chosen] : town.animals).filter(a => availableAnimal(town, a, recipe.species))
    .map(animal => ({ animal, travel: distance(p.position, animal.position) + distance(animal.position, gate) }))
    .sort((a, b) => a.travel - b.travel || a.animal.id - b.animal.id);
  for (const { animal } of routes) {
    if (distance(gate, animal.position) > .5 && !town.grid.path(animal.position, gate).length) continue;
    if (!town.walkTo(p, animal.position)) continue;
    town.setOrder(p, Activity.Herding, pen.id);
    p.herdAnimal = animal.id;
    p.approachingOrder = true;
    p.activity = Activity.Herding;
    animal.angry = false;
    animal.provokedBy = -1;
    animal.path = [];
    return true;
  }
  return false;
}
export function finishRanchOrder(town: TownState, p: Person): void {
  if (p.task === Activity.Herding) {
    const animal = town.animals.find(a => a.id === p.herdAnimal);
    if (animal && animal.pen < 0) {
      const leader = herdLeader(town, animal);
      if (!leader || leader === p) animal.path = [];
    }
  }
  const assigned = p.job >= 0 && p.job === p.taskSite && town.building(p.job)?.built();
  p.herdAnimal = p.target = -1;
  p.approachingOrder = p.aggressive = false;
  p.ordered = !!assigned;
  p.task = assigned ? Activity.Working : Activity.Idle;
  p.taskSite = assigned ? p.job : -1;
  p.activity = Activity.Idle;
  p.path = [];
  p.until = p.scheduleAt = town.time;
}
function moveAnimal(animal: Monster, path: Point[], step: number): void {
  while (step > 0 && path.length) {
    const gap = distance(animal.position, path[0]);
    if (gap > step) { animal.position = lerp(animal.position, path[0], step / gap); return; }
    animal.position = { ...path.shift()! };
    step -= gap;
  }
}
export function advanceHerding(town: Town, p: Person, dt: number): void {
  const animal = town.creature(p.herdAnimal), pen = town.building(p.taskSite);
  const recipe = pen && livestockRecipe(pen.kind);
  if (!animal || animal.pen >= 0 || animal.health <= 0 || !pen?.built() || !recipe || recipe.species !== animal.animal ||
      p.job !== pen.id || pen.faction !== p.faction || stockInPen(town, pen.id).length >= pastureCapacity(pen)) return finishRanchOrder(town, p);
  p.activity = Activity.Herding;
  const door = pastureGate(pen);
  if (p.approachingOrder) {
    if (distance(p.position, animal.position) > 0.52 || p.inside) {
      if (!p.moving() && !town.walkTo(p, animal.position)) return finishRanchOrder(town, p);
      town.walk(p, dt);
      return;
    }
    if (!town.walkTo(p, door)) return finishRanchOrder(town, p);
    animal.path = [{ ...p.position }, ...p.path.map(at => ({ ...at }))];
    p.approachingOrder = false;
  }
  if (distance(p.position, animal.position) < 1.0) town.walk(p, dt);
  if (animal.path.length && (distance(p.position, animal.position) > 0.33 || !p.moving()))
    moveAnimal(animal, animal.path, animalSpec(animal.animal!).speed * dt);
  if (p.moving() || animal.path.length) return;
  if (distance(p.position, door) > 0.55 || distance(animal.position, door) > 0.8) {
    p.approachingOrder = true;
    return;
  }
  if (!admitToPasture(town, pen, animal)) return finishRanchOrder(town, p);
  town.notify(`${p.name} brought a ${animalSpec(animal.animal!).name.toLowerCase()} to the ${structureSpec(pen.kind).name.toLowerCase()}`);
  ++town.changes;
  finishRanchOrder(town, p);
}
/** Once inside the gate, the animal stays in its enclosure. Demolition puts it back on open ground. */
export function tendLivestock(town: TownState, animal: Monster, dt: number): boolean {
  if (animal.pen < 0) return livestockKind(animal.animal) && !!herdLeader(town, animal);
  const pen = town.building(animal.pen);
  if (pen?.built() && livestockRecipe(pen.kind)?.species === animal.animal) {
    grazeInPasture(town, pen, animal, dt);
    return true;
  }
  animal.pen = -1;
  animal.home = animal.position = town.grid.nearestWalkable(animal.position);
  animal.path = [];
  return false;
}

export type RanchHarvest = Activity.GatheringEggs | Activity.Milking;
export const isRanchHarvest = (task: Activity): task is RanchHarvest =>
  task === Activity.GatheringEggs || task === Activity.Milking;
export const ranchWorkSeconds = (task: RanchHarvest): number => task === Activity.GatheringEggs ? 1.25 : 3;
export const ranchWorker = (town: Town, pen: Building): Person | undefined =>
  town.folk.find(p => isRanchHarvest(p.task) && p.taskSite === pen.id && p.health > 0 && p.downedAt < 0);

function foodRoom(town: Town, pen: Building): number {
  const village = town.settlementOf(pen);
  return town.capacity(village).food - town.stock(village).food;
}

function harvestAt(town: Town, pen: Building, which?: RanchHarvest) {
  const recipe = livestockRecipe(pen.kind);
  if (!recipe) return null;
  const task = recipe.species === AnimalKind.Chicken ? Activity.GatheringEggs : Activity.Milking;
  const food = Math.min(foodRoom(town, pen), pen.storedProduce);
  return food > 0 && (!which || task === which) ? { task, food } : null;
}

export function orderRanchHarvest(town: Town, p: Person, destination?: Building, which?: RanchHarvest): boolean {
  if (!canControl(p, town.controlFaction)) return false;
  const pens = localRanches(town, p).filter(pen => !destination || pen === destination)
    .sort((a, b) => distance(p.position, a.door()) - distance(p.position, b.door()) || a.id - b.id);
  for (const pen of pens) {
    const worker = ranchWorker(town, pen);
    if (worker && worker !== p) continue;
    if (worker === p && (!which || which === p.task)) return true;
    const harvest = harvestAt(town, pen, which);
    if (!harvest || !town.walkTo(p, pen.door())) continue;
    town.setOrder(p, harvest.task, pen.id);
    p.herdAnimal = -1;
    p.approachingOrder = true;
    p.activity = harvest.task;
    return true;
  }
  return false;
}

export function workWithLivestock(town: Town, p: Person, animal: Monster): boolean {
  if (animal.pen < 0) return leadLivestock(town, p, animal);
  const pen = town.building(animal.pen);
  if (!pen) return false;
  return orderRanchHarvest(town, p, pen);
}

export function advanceRanchHarvest(town: Town, p: Person, dt: number): void {
  const pen = town.building(p.taskSite);
  if (!isRanchHarvest(p.task) || !pen?.built() || !livestockRecipe(pen.kind) || pen.faction !== p.faction ||
      town.settlementOf(p) !== town.settlementOf(pen)) return finishRanchOrder(town, p);
  if (p.activity !== p.task) p.approachingOrder = true;
  p.activity = p.task;
  const door = pen.door();
  if (p.inside || distance(p.position, door) > .35) {
    p.approachingOrder = true;
    if (!p.moving() && !town.walkTo(p, door)) return finishRanchOrder(town, p);
    town.walk(p, dt);
    return;
  }
  if (p.approachingOrder) {
    p.path = [];
    p.approachingOrder = false;
    p.until = town.time + ranchWorkSeconds(p.task);
  }
  if (town.time < p.until) return;
  const harvest = harvestAt(town, pen, p.task);
  if (harvest) {
    pen.storedProduce -= harvest.food;
    town.store(Resources.from({ food: harvest.food }), town.settlementOf(pen));
    town.notify(harvest.task === Activity.GatheringEggs ? `Eggs collected +${harvest.food} food` : `Milk collected +${harvest.food} food`);
  }
  finishRanchOrder(town, p);
}
