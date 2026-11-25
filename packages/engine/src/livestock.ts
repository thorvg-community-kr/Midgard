import { Structure, Resources } from './building-catalog';
import { canControl } from './faction';
import { add, distance, lerp, point, rotated, type Point } from './geometry';
import { Activity, AnimalKind, type Monster, type Person } from './person';
import type { Town } from './town';
import type { Building } from './town-models';
import type { TownState } from './town-state';
import { breedingStalls, penCapacity, readyForMeat, stockInPen } from './ranch-cycle';
import { animalSpec } from './wildlife';
export { penCapacity, stockInPen } from './ranch-cycle';

export const livestockKind = (kind: AnimalKind | null): boolean =>
  kind === AnimalKind.Cow || kind === AnimalKind.Pig || kind === AnimalKind.Chicken;
export function localRanches(town: Town, p: Person): Building[] {
  return town.buildings().filter(b => b.kind === Structure.Ranch && b.built() && b.faction === p.faction &&
    town.settlementOf(b) === town.settlementOf(p) && !town.inRealm(p.position) && !town.inRealm(b.center));
}
const claimed = (p: Person) => p.task === Activity.Herding && p.health > 0 && p.downedAt < 0;
export function herdLeader(town: TownState, animal: Monster): Person | undefined {
  return town.folk.find(p => claimed(p) && p.herdAnimal === animal.id);
}
function adultStock(town: TownState, pen: Building): Monster[] {
  return stockInPen(town, pen.id).filter(a => a.ranchBornAt < 0);
}
function reservedStock(town: Town, pen: Building): Monster[] {
  const stock = adultStock(town, pen);
  for (const p of town.folk) {
    if (!claimed(p) || p.taskSite !== pen.id) continue;
    const animal = town.creature(p.herdAnimal);
    if (animal && animal.health > 0 && animal.pen < 0) stock.push(animal);
  }
  return stock;
}
export function penHasRoom(town: Town, pen: Building): boolean {
  return reservedStock(town, pen).length < penCapacity;
}
export function leadLivestock(town: Town, p: Person, chosen?: Monster, destination?: Building): boolean {
  if (!canControl(p, town.controlFaction)) return false;
  const pens = localRanches(town, p).filter(b => !destination || b === destination)
    .map(pen => ({ pen, stock: reservedStock(town, pen) })).filter(({ stock }) => stock.length < penCapacity);
  if (!pens.length) return false;
  const candidates = (chosen ? [chosen] : town.animals).filter(a => a.health > 0 && a.pen < 0 && livestockKind(a.animal) &&
    town.world.revealed(a.position) && !herdLeader(town, a));
  const routes = candidates.flatMap(animal => pens.flatMap(({ pen, stock }) => {
    const same = stock.filter(a => a.animal === animal.animal).length;
    // Leave room for both breeding pairs and a laying hen when residents gather on their own.
    if (!chosen && same >= (animal.animal === AnimalKind.Chicken ? 1 : 2)) return [];
    const pair = animal.animal !== AnimalKind.Chicken && same === 1;
    const priority = pair ? 0 : animal.animal === AnimalKind.Chicken && !same ? 1 : 2;
    return [{ animal, pen, priority, travel: distance(p.position, animal.position) + distance(animal.position, pen.door()) }];
  }));
  routes.sort((a, b) => a.priority - b.priority || a.travel - b.travel || a.animal.id - b.animal.id || a.pen.id - b.pen.id);
  for (const { animal, pen } of routes) {
    if (distance(pen.door(), animal.position) > .5 && !town.grid.path(animal.position, pen.door()).length) continue;
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
function finishRanchOrder(town: Town, p: Person): void {
  p.herdAnimal = p.taskSite = p.target = -1;
  p.ordered = p.approachingOrder = p.aggressive = false;
  p.task = p.activity = Activity.Idle;
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
  if (!animal || animal.pen >= 0 || animal.health <= 0 || !pen?.built() || pen.kind !== Structure.Ranch ||
      pen.faction !== p.faction || adultStock(town, pen).length >= penCapacity) return finishRanchOrder(town, p);
  p.activity = Activity.Herding;
  const door = pen.door();
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
  const herd = adultStock(town, pen);
  const stall = breedingStalls.map(at => add(pen.center, rotated(at, pen.angle))).find(at => herd.every(a => distance(a.home, at) > 0.1));
  if (!stall) return finishRanchOrder(town, p);
  animal.pen = pen.id;
  animal.home = stall;
  animal.path = [add(pen.center, rotated(point(0, 0.82), pen.angle)), stall];
  town.notify(`${p.name} brought a ${animalSpec(animal.animal!).name.toLowerCase()} to the ranch`);
  ++town.changes;
  finishRanchOrder(town, p);
}
/** Once inside the gate, the animal stays in its enclosure. Demolition puts it back on open ground. */
export function tendLivestock(town: TownState, animal: Monster, dt: number): boolean {
  if (animal.pen < 0) return livestockKind(animal.animal) && !!herdLeader(town, animal);
  const pen = town.building(animal.pen);
  if (pen?.built() && pen.kind === Structure.Ranch) {
    moveAnimal(animal, animal.path, animalSpec(animal.animal!).speed * dt);
    return true;
  }
  animal.pen = animal.ranchBornAt = -1;
  animal.home = animal.position = town.grid.nearestWalkable(animal.position);
  animal.path = [];
  return false;
}

export type RanchHarvest = Activity.GatheringEggs | Activity.PreparingMeat;
export const isRanchHarvest = (task: Activity): task is RanchHarvest =>
  task === Activity.GatheringEggs || task === Activity.PreparingMeat;
export const ranchWorkSeconds = (task: RanchHarvest): number => task === Activity.GatheringEggs ? 1.25 : 3;
export const ranchWorker = (town: Town, pen: Building): Person | undefined =>
  town.folk.find(p => isRanchHarvest(p.task) && p.taskSite === pen.id && p.health > 0 && p.downedAt < 0);

function foodRoom(town: Town, pen: Building): number {
  const village = town.settlementOf(pen);
  return town.capacity(village).food - town.stock(village).food;
}

function harvestAt(town: Town, pen: Building, which?: RanchHarvest, target = -1) {
  const room = foodRoom(town, pen);
  if (room < 1) return null;
  if (which !== Activity.GatheringEggs) {
    const animal = readyForMeat(stockInPen(town, pen.id), town.clock())
      .find(a => (target < 0 || a.id === target) && animalSpec(a.animal!).food <= room);
    if (animal) return { task: Activity.PreparingMeat as const, target: animal.id, food: animalSpec(animal.animal!).food };
  }
  if (which !== Activity.PreparingMeat && pen.eggs > 0)
    return { task: Activity.GatheringEggs as const, target: -1, food: Math.min(room, pen.eggs) };
  return null;
}

export function orderRanchHarvest(town: Town, p: Person, destination?: Building, which?: RanchHarvest, target = -1): boolean {
  if (!canControl(p, town.controlFaction)) return false;
  const pens = localRanches(town, p).filter(pen => !destination || pen === destination)
    .sort((a, b) => distance(p.position, a.door()) - distance(p.position, b.door()) || a.id - b.id);
  for (const pen of pens) {
    const worker = ranchWorker(town, pen);
    if (worker && worker !== p) continue;
    if (worker === p && (!which || which === p.task) && (target < 0 || target === p.herdAnimal)) return true;
    const harvest = harvestAt(town, pen, which, target);
    if (!harvest || !town.walkTo(p, pen.door())) continue;
    town.setOrder(p, harvest.task, pen.id);
    p.herdAnimal = harvest.target;
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
  if (animal.animal === AnimalKind.Chicken) return orderRanchHarvest(town, p, pen, Activity.GatheringEggs);
  return animal.ranchBornAt >= 0 && orderRanchHarvest(town, p, pen, Activity.PreparingMeat, animal.id);
}

export function advanceRanchHarvest(town: Town, p: Person, dt: number): void {
  const pen = town.building(p.taskSite);
  if (!isRanchHarvest(p.task) || !pen?.built() || pen.kind !== Structure.Ranch || pen.faction !== p.faction ||
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
  const harvest = harvestAt(town, pen, p.task, p.herdAnimal);
  if (harvest) {
    if (harvest.task === Activity.GatheringEggs) pen.eggs -= harvest.food;
    else town.animals.splice(town.animals.findIndex(a => a.id === harvest.target), 1);
    town.store(Resources.from({ food: harvest.food }), town.settlementOf(pen));
    town.notify(harvest.task === Activity.GatheringEggs ? `Eggs collected +${harvest.food} food` : `Meat prepared +${harvest.food} food`);
  }
  finishRanchOrder(town, p);
}
