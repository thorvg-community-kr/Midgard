import { expect, it } from 'vitest';
import { Structure } from '../../packages/engine/src/building-catalog';
import { decodeTown, encodeTown, encodeTownPayload } from '../../packages/engine/src/save-game';
import { distance, point } from '../../packages/engine/src/geometry';
import { leadLivestock, orderRanchHarvest, penHasRoom } from '../../packages/engine/src/livestock';
import { nestCapacity, penCapacity, ranchGrowth, readyForMeat, stockInPen } from '../../packages/engine/src/ranch-cycle';
import { animalSpec } from '../../packages/engine/src/wildlife';
import { Activity, AnimalKind, Calling, Monster, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, makeTile } from '../../packages/engine/src/world-types';

function village() {
  const map = new WorldMap();
  map.columns = map.rows = 32; map.mapSeed = 3; map.origin = point(12, 12);
  map.tiles = Array.from({ length: 32 * 32 }, () => ({ ...makeTile(), revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(65 * 65).fill(.42));
  map.layer(Layer.Land).fill(1); map.layer(Layer.Ridge).fill(-1); map.reveal(16, 16, 32);
  const town = new Town(map, 32, false), camp = new Building(0, Structure.Camp, point(12, 12), 0, 0);
  const pen = new Building(1, Structure.Ranch, point(17, 16), 0, 0);
  camp.village = pen.village = 0; town.placed = [camp, pen]; town.nextId = 2; town.migrateSettlements();
  town.folk = [town.makePerson(Role.Resident, Calling.Settler, point(12, 14)), town.makePerson(Role.Resident, Calling.Settler, point(12.7, 14))];
  for (const p of town.folk) { p.home = p.village = 0; p.autoMode = false; p.food = p.health = p.rest = p.hydration = 1; }
  town.animals = []; town.beasts = []; town.wildlifeDay = town.days; town.changes++; town.tick(0);
  function animal(kind: AnimalKind, x: number) {
    const a = new Monster(town.nextMonster++, -1, point(x, 15)); a.animal = kind; a.home = { ...a.position };
    a.ready = town.clock() + 100; town.animals.push(a); return a;
  }
  function house(kind: AnimalKind, where = pen) {
    const a = animal(kind, where.center.x);
    a.pen = where.id; a.home = a.position = { ...where.center };
    return a;
  }
  return { town, pen, p: town.folk[0], other: town.folk[1], animal, house };

}
it('leads the chosen animal on foot, resumes the route from a save and keeps a lone cow as breeding stock', () => {
  const { town, p, other, animal, pen } = village(), cow = animal(AnimalKind.Cow, 10), before = { ...cow.position };
  expect(town.orderAttack([p.id, other.id], cow.id)).toBe(true);
  expect(p.task).toBe(Activity.Herding); expect(town.orderAttack([other.id], cow.id)).toBe(false);
  for (let i = 0; i < 200 && (p.approachingOrder || distance(cow.position, before) < .35); i++) town.advance(.1);
  expect(distance(cow.position, before)).toBeGreaterThan(.3); expect(cow.pen).toBe(-1);
  const loaded = decodeTown(encodeTown(town), map => new Town(map, 32, false)), kept = loaded.creature(cow.id)!;
  for (let i = 0; i < 400 && kept.pen < 0; i++) loaded.advance(.1);
  expect(kept.pen).toBe(pen.id); expect(kept.health).toBe(cow.health);
  loaded.orderStop(loaded.folk.map(p => p.id));
  loaded.stock(0).food = 0; loaded.advance(78);
  expect(loaded.stock(0).food).toBe(0); expect(loaded.dailyOutput(loaded.building(pen.id)!).food).toBe(0);
  expect(loaded.building(pen.id)!.footprint().contains(kept.position)).toBe(true);
  expect(loaded.orderAttack([p.id], kept.id)).toBe(false);
  loaded.raze(pen.id); loaded.advance(.2);
  expect(kept.pen).toBe(-1); expect(loaded.grid.walkable(kept.position)).toBe(true);
});
it('reserves the final stall, releases it on cancellation, and still hunts before the ranch opens', () => {
  const { town, p, other, animal, pen } = village();
  pen.progress = .8;
  const pig = animal(AnimalKind.Pig, 10), chicken = animal(AnimalKind.Chicken, 11);
  expect(town.orderAttack([p.id], pig.id)).toBe(true); expect(p.task).toBe(Activity.Fighting);
  town.orderStop([p.id]); pen.progress = 1;
  for (let i = 0; i < penCapacity - 1; i++) animal(AnimalKind.Chicken, 15).pen = pen.id;
  expect(leadLivestock(town, p, pig)).toBe(true);
  expect(leadLivestock(town, other, chicken)).toBe(false);
  town.orderStop([p.id]); expect(leadLivestock(town, other, chicken)).toBe(true);
  expect(stockInPen(town, pen.id)).toHaveLength(penCapacity - 1);
  expect(leadLivestock(town, p, animal(AnimalKind.Wolf, 12))).toBe(false);
});

function reload(town: Town): Town {
  return decodeTown(encodeTown(town), map => new Town(map, 32, false));
}

it('keeps eggs in the nest until a resident reaches it and finishes collecting, including after loading', () => {
  const { town, pen, p, other, house } = village();
  house(AnimalKind.Chicken);
  const distantCamp = new Building(town.nextId++, Structure.Camp, point(26, 25), 0, 0);
  distantCamp.village = distantCamp.id;
  town.placed.push(distantCamp); town.foundSettlement(distantCamp.id);
  town.stock(distantCamp.id).food = 5;
  town.stock(0).food = 0;
  town.advance(100);
  expect(pen.eggs).toBe(1);
  expect(town.stock(0).food).toBe(0);
  expect(pen.productionProgress).toBeCloseTo(1 / 3);
  expect(orderRanchHarvest(town, p, pen, Activity.GatheringEggs)).toBe(true);
  expect(orderRanchHarvest(town, other, pen)).toBe(false);
  expect(p.approachingOrder).toBe(true);
  const route = p.path;
  expect(orderRanchHarvest(town, p, pen, Activity.GatheringEggs)).toBe(true);
  expect(p.path).toBe(route);
  town.advance(.3);
  expect(town.stock(0).food).toBe(0);
  const copy = reload(town), worker = copy.person(p.id)!, saved = copy.building(pen.id)!;
  expect(saved.eggs).toBe(1);
  expect(saved.productionProgress).toBeCloseTo(pen.productionProgress);
  for (let i = 0; i < 400 && worker.task === Activity.GatheringEggs; i++) copy.advance(.1);
  expect(distance(worker.position, saved.door())).toBeLessThan(.4);
  expect([saved.eggs, copy.stock(0).food, copy.stock(distantCamp.id).food]).toEqual([0, 1, 5]);
  expect(stockInPen(copy, pen.id)).toHaveLength(1);
});

it('caps the nest, takes only what fits, and leaves the eggs when work is interrupted', () => {
  const { town, pen, p, house } = village();
  house(AnimalKind.Chicken); house(AnimalKind.Chicken);
  pen.eggs = nestCapacity - 1;
  const local = town.stock(0);
  local.food = town.capacity(0).food;
  town.advance(76);
  expect(pen.eggs).toBe(nestCapacity);
  expect(pen.productionProgress).toBe(0);
  expect(orderRanchHarvest(town, p, pen)).toBe(false);
  local.food -= 2;
  expect(orderRanchHarvest(town, p, pen)).toBe(true);
  town.orderStop([p.id]); town.advance(10);
  expect(pen.eggs).toBe(nestCapacity);
  expect(orderRanchHarvest(town, p, pen)).toBe(true);
  town.advance(25);
  expect(local.food).toBe(town.capacity(0).food);
  expect(pen.eggs).toBe(nestCapacity - 2);
});

it('requires two adults of the same species in the same ranch', () => {
  const { town, pen, p, house } = village();
  const second = new Building(town.nextId++, Structure.Ranch, point(21, 16), 0, 0);
  second.village = 0; town.placed.push(second);
  for (const where of [pen, second]) {
    house(AnimalKind.Pig, where); house(AnimalKind.Cow, where);
  }
  town.stock(0).food = 0; town.advance(190);
  for (const where of [pen, second]) {
    expect(stockInPen(town, where.id)).toHaveLength(2);
    expect([where.eggs, where.pigBreeding, where.cowBreeding]).toEqual([0, 0, 0]);
    expect(orderRanchHarvest(town, p, where, Activity.PreparingMeat)).toBe(false);
  }
  expect(town.stock(0).food).toBe(0);
});

it('raises a piglet and a calf beside their parents in a full ranch and repeats the cycle', () => {
  const { town, pen, p, house } = village();
  const adults = [AnimalKind.Cow, AnimalKind.Pig, AnimalKind.Cow, AnimalKind.Pig, AnimalKind.Chicken].map(k => house(k));
  expect(penHasRoom(town, pen)).toBe(false);
  town.stock(0).food = 0;
  town.advance(65);
  const copy = reload(town), ranch = copy.building(pen.id)!;
  expect([ranch.pigBreeding, ranch.cowBreeding]).toEqual([pen.pigBreeding, pen.cowBreeding]);
  const stock = () => stockInPen(copy, pen.id);
  copy.advance(116);
  const young = stock().filter(a => a.ranchBornAt >= 0);
  expect(young.map(a => a.animal)).toEqual([AnimalKind.Pig, AnimalKind.Cow]);
  expect(stock()).toHaveLength(penCapacity + 2);
  expect(young.every(a => ranch.footprint().contains(a.position) && ranchGrowth(a, copy.clock()) < 1)).toBe(true);
  expect(readyForMeat(stock(), copy.clock())).toHaveLength(0);
  expect(copy.stock(0).food).toBe(0);
  copy.advance(121);
  expect(readyForMeat(stock(), copy.clock())).toHaveLength(2);
  const worker = copy.person(p.id)!;
  const pig = young[0], cow = young[1], pigFood = animalSpec(AnimalKind.Pig).food;
  copy.stock(0).food = copy.capacity(0).food - pigFood;
  expect(orderRanchHarvest(copy, worker, ranch, Activity.PreparingMeat, cow.id)).toBe(false);
  expect(orderRanchHarvest(copy, worker, ranch, Activity.PreparingMeat)).toBe(true);
  expect(worker.herdAnimal).toBe(pig.id);
  copy.advance(.5);
  const saved = reload(copy), savedPen = saved.building(pen.id)!;
  expect(saved.creature(pig.id)!.ranchBornAt).toBe(pig.ranchBornAt);
  expect(saved.person(worker.id)!.herdAnimal).toBe(pig.id);
  saved.advance(20);
  expect(saved.creature(pig.id)).toBeNull();
  expect(saved.stock(0).food).toBe(saved.capacity(0).food);
  saved.stock(0).food = 0;
  expect(orderRanchHarvest(saved, saved.person(p.id)!, savedPen, Activity.PreparingMeat)).toBe(true);
  saved.advance(15);
  expect(saved.creature(cow.id)).toBeNull();
  expect(saved.stock(0).food).toBe(animalSpec(AnimalKind.Cow).food);
  expect(saved.stock(0).bones).toBe(0);
  expect(stockInPen(saved, pen.id).map(a => a.id)).toEqual(adults.map(a => a.id));
  saved.advance(182);
  expect(stockInPen(saved, pen.id).filter(a => a.ranchBornAt >= 0).map(a => a.animal)).toEqual([AnimalKind.Pig, AnimalKind.Cow]);
});

it('sends an available resident to the nest automatically and keeps a stopped resident in place', () => {
  const { town, pen, p, other, house } = village();
  house(AnimalKind.Chicken); pen.eggs = 2;
  town.stock(0).food = 0; p.autoMode = true;
  town.advance(24);
  expect([pen.eggs, town.stock(0).food]).toEqual([0, 2]);
  expect(other.task).toBe(Activity.Idle);
});

it('prefers the missing mate and counts animals already on their way to the pen', () => {
  const { town, pen, p, other, house, animal } = village();
  house(AnimalKind.Cow); house(AnimalKind.Chicken);
  const pig = animal(AnimalKind.Pig, 13);
  const cow = animal(AnimalKind.Cow, 9);
  expect(leadLivestock(town, p)).toBe(true);
  expect(p.herdAnimal).toBe(cow.id);
  expect(leadLivestock(town, other)).toBe(true);
  expect(other.herdAnimal).toBe(pig.id);
  expect(p.taskSite).toBe(pen.id);
});

it('keeps a ranch with captured adults in the previous save format until its new cycle starts', () => {
  const { town, pen, house } = village();
  const hen = house(AnimalKind.Chicken), cow = house(AnimalKind.Cow);
  const version = (t: Town) => new DataView(encodeTownPayload(t).buffer).getUint32(0, true);
  expect(version(town)).toBe(23);
  const copy = reload(town), saved = copy.building(pen.id)!;
  expect(stockInPen(copy, pen.id).map(a => [a.id, a.ranchBornAt])).toEqual([[hen.id, -1], [cow.id, -1]]);
  expect([saved.eggs, saved.pigBreeding, saved.cowBreeding]).toEqual([0, 0, 0]);
  copy.advance(1);
  expect(version(copy)).toBe(24);
});

it('cancels meat preparation when storage fills or the ranch is removed', () => {
  const { town, pen, p, house } = village();
  const parents = [house(AnimalKind.Pig), house(AnimalKind.Pig)];
  town.stock(0).food = 0; town.advance(212);
  const [young] = readyForMeat(stockInPen(town, pen.id), town.clock());
  expect(orderRanchHarvest(town, p, pen, Activity.PreparingMeat, young.id)).toBe(true);
  town.stock(0).food = town.capacity(0).food;
  town.advance(20);
  expect(town.creature(young.id)).toBe(young);
  town.stock(0).food = 0;
  expect(orderRanchHarvest(town, p, pen, Activity.PreparingMeat, young.id)).toBe(true);
  town.raze(pen.id); town.advance(.3);
  expect(p.task).toBe(Activity.Idle);
  expect(town.stock(0).food).toBe(0);
  for (const a of [...parents, young]) expect([a.pen, a.ranchBornAt]).toEqual([-1, -1]);
});
