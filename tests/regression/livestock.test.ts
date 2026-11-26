import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Structure } from '../../packages/engine/src/building-catalog';
import { decodeTown, encodeTown, encodeTownPayload } from '../../packages/engine/src/save-game';
import { distance, point } from '../../packages/engine/src/geometry';
import { canLeadAnimal, herdLeader, leadLivestock, orderRanchHarvest, penHasRoom } from '../../packages/engine/src/livestock';
import { livestockRecipe, stockInPen } from '../../packages/engine/src/ranch-cycle';
import { Activity, AnimalKind, Calling, Monster, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, makeTile } from '../../packages/engine/src/world-types';

function village(kind = Structure.ChickenCoop) {
  const map = new WorldMap();
  map.columns = map.rows = 32; map.mapSeed = 3; map.origin = point(12, 12);
  map.tiles = Array.from({ length: 32 * 32 }, () => ({ ...makeTile(), revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(65 * 65).fill(.42));
  map.layer(Layer.Land).fill(1); map.layer(Layer.Ridge).fill(-1); map.reveal(16, 16, 32);
  const town = new Town(map, 32, false), camp = new Building(0, Structure.Camp, point(12, 12), 0, 0);
  const pen = new Building(1, kind, point(17, 16), 0, 0);
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
function reload(town: Town): Town {
  return decodeTown(encodeTown(town), map => new Town(map, 32, false));
}
function midnight(town: Town): void {
  town.editHour(23.999);
  expect(town.advance(.1)).toBe(true);
}
it('leads a cow to the cowshed even when the coop is closer, and resumes the route from a save', () => {
  const { town, p, other, animal, pen } = village();
  const shed = new Building(town.nextId++, Structure.Cowshed, point(22, 18), 0, 0);
  shed.village = 0; town.placed.push(shed); town.changes++;
  const cow = animal(AnimalKind.Cow, 10), before = { ...cow.position };
  expect(canLeadAnimal(town, p, cow)).toBe(false);
  expect(leadLivestock(town, p, cow, shed)).toBe(false);
  expect(town.assignJob([p.id], shed.id)).toBe(true);
  expect(canLeadAnimal(town, p, cow)).toBe(true);
  expect(leadLivestock(town, p, cow, pen)).toBe(false);
  expect(town.orderAttack([p.id, other.id], cow.id)).toBe(true);
  expect(p.task).toBe(Activity.Herding); expect(town.orderAttack([other.id], cow.id)).toBe(false);
  for (let i = 0; i < 200 && (p.approachingOrder || distance(cow.position, before) < .35); i++) town.advance(.1);
  expect(distance(cow.position, before)).toBeGreaterThan(.3); expect(cow.pen).toBe(-1);
  const copy = reload(town), kept = copy.creature(cow.id)!;
  for (let i = 0; i < 450 && kept.pen < 0; i++) copy.advance(.1);
  expect(kept.pen).toBe(shed.id);
  expect(copy.orderAttack([p.id], kept.id)).toBe(false);
  copy.raze(shed.id); copy.advance(.2);
  expect(kept.pen).toBe(-1); expect(copy.grid.walkable(kept.position)).toBe(true);
});
it('reserves compatible stalls for animals already on the way and releases the place on cancellation', () => {
  const { town, pen, p, other, house, animal } = village(Structure.Cowshed);
  house(AnimalKind.Cow);
  expect(town.assignJob([p.id, other.id], pen.id)).toBe(true);
  const first = animal(AnimalKind.Cow, 10), second = animal(AnimalKind.Cow, 11);
  expect(leadLivestock(town, p, first)).toBe(true);
  expect(penHasRoom(town, pen)).toBe(false);
  expect(leadLivestock(town, other, second)).toBe(false);
  town.orderStop([p.id]); expect(leadLivestock(town, other, second)).toBe(true);
  expect(leadLivestock(town, p, animal(AnimalKind.Pig, 11))).toBe(false);
});
it.each([
  [Structure.ChickenCoop, AnimalKind.Chicken, 1, 1, 2, Activity.GatheringEggs],
  [Structure.Cowshed, AnimalKind.Cow, 2, 2, 5, Activity.Milking],
])('trades one daily local ration for a batch and collects it on foot in building %i', (kind, species, feed, water, yieldFood, work) => {
  const { town, pen, house, p, other } = village(kind);
  const original = house(species);
  const stock = town.stock(0); stock.food = 10; stock.water = 10;
  const distant = new Building(town.nextId++, Structure.Camp, point(25, 24), 0, 0);
  distant.village = distant.id;
  town.placed.push(distant); town.foundSettlement(distant.id);
  town.stock(distant.id).food = town.stock(distant.id).water = 5;
  town.advance(30);
  expect(pen.storedProduce).toBe(0);
  midnight(town);
  expect([stock.food, stock.water, pen.storedProduce]).toEqual([10 - feed, 10 - water, yieldFood]);
  expect(town.dailyOutput(pen).food).toBe(0);
  expect(orderRanchHarvest(town, p, pen)).toBe(true);
  expect([p.task, p.approachingOrder]).toEqual([work, true]);
  expect(orderRanchHarvest(town, other, pen)).toBe(false);
  const copy = reload(town), saved = copy.building(pen.id)!, worker = copy.person(p.id)!;
  expect(saved.storedProduce).toBe(yieldFood);
  copy.advance(40);
  expect(distance(worker.position, saved.door())).toBeLessThan(.4);
  expect([saved.storedProduce, copy.stock(0).food, copy.stock(0).water]).toEqual([0, 10 - feed + yieldFood, 10 - water]);
  expect([copy.stock(distant.id).food, copy.stock(distant.id).water]).toEqual([5, 5]);
  midnight(copy);
  expect(saved.storedProduce).toBe(yieldFood);
  expect(stockInPen(copy, pen.id).map(a => a.id)).toEqual([original.id]);
});
it('charges only full rations for animals that can produce a full batch and never breeds', () => {
  const { town, pen, house } = village(Structure.Cowshed);
  const ids = [house(AnimalKind.Cow).id, house(AnimalKind.Cow).id];
  const stock = town.stock(0); stock.food = 6; stock.water = 0;
  midnight(town); expect([stock.food, stock.water, pen.storedProduce]).toEqual([6, 0, 0]);
  stock.water = 3;
  midnight(town); expect([stock.food, stock.water, pen.storedProduce]).toEqual([4, 1, 5]);
  stock.food = 0; stock.water = 9;
  midnight(town); expect([stock.food, stock.water, pen.storedProduce]).toEqual([0, 9, 5]);
  pen.storedProduce = livestockRecipe(pen.kind)!.capacity - 1; stock.food = 6;
  midnight(town); expect([stock.food, stock.water, pen.storedProduce]).toEqual([6, 9, 19]);
  expect(stockInPen(town, pen.id).map(a => a.id)).toEqual(ids);
});
it('keeps uncollected produce when a settler is stopped and collects only what fits', () => {
  const { town, pen, p } = village();
  pen.storedProduce = 5;
  const stock = town.stock(0); stock.food = town.capacity(0).food;
  expect(orderRanchHarvest(town, p, pen)).toBe(false);
  stock.food -= 2;
  expect(orderRanchHarvest(town, p, pen)).toBe(true);
  town.orderStop([p.id]); town.advance(4); expect(pen.storedProduce).toBe(5);
  expect(orderRanchHarvest(town, p, pen)).toBe(true);
  town.advance(25);
  expect([stock.food, pen.storedProduce]).toEqual([town.capacity(0).food, 3]);
});
it('hunts wild pigs for food when hungry even with an empty coop and cannot lead them into it', () => {
  const { town, pen, p, animal } = village();
  const pig = animal(AnimalKind.Pig, 11);
  town.stock(0).food = town.stock(0).water = 0;
  expect(leadLivestock(town, p, pig, pen)).toBe(false);
  expect(town.huntFood(p)).toBe(true); expect(p.hunting).toBe(true);
  expect(p.foe).toBe(pig.id);
  expect(town.orderAttack([p.id], pig.id)).toBe(true);
  expect(p.task).toBe(Activity.Fighting);
});
it('has the assigned keeper collect eggs and keeps an explicitly stopped settler in place', () => {
  const { town, pen, p, other } = village(); pen.storedProduce = 2;
  town.stock(0).food = 0;
  expect(town.assignJob([p.id], pen.id)).toBe(true);
  town.advance(24);
  expect([pen.storedProduce, town.stock(0).food]).toEqual([0, 2]);
  expect([p.task, p.job]).toEqual([Activity.Working, pen.id]);
  expect(other.task).toBe(Activity.Idle);
});
it.each([
  [Structure.ChickenCoop, AnimalKind.Chicken],
  [Structure.Cowshed, AnimalKind.Cow],
])('waits for a keeper at building %i, then leads the animal in and returns to duty', (kind, species) => {
  const { town, pen, p, animal } = village(kind);
  const wild = animal(species, 14);
  const stock = town.stock(0); stock.food = stock.water = 8;
  p.autoMode = true;
  town.staff();
  town.advance(3);
  expect(pen.workers).toBe(0);
  expect(herdLeader(town, wild)).toBeUndefined();
  expect(wild.pen).toBe(-1);
  expect(town.setWorkers(pen.id, 1)).toBe(true);
  expect(p.job).toBe(pen.id);
  for (let i = 0; i < 500 && wild.pen < 0; ++i) town.advance(.1);
  expect(wild.pen).toBe(pen.id);
  expect([p.task, p.job]).toEqual([Activity.Working, pen.id]);
});
it('releases an incoming animal when its keeper is unstaffed mid-route', () => {
  const { town, pen, p, other, animal } = village(Structure.Cowshed);
  const cow = animal(AnimalKind.Cow, 10);
  expect(town.assignJob([p.id], pen.id)).toBe(true);
  expect(leadLivestock(town, p, cow)).toBe(true);
  for (let i = 0; i < 100 && p.approachingOrder; ++i) town.advance(.1);
  expect(p.approachingOrder).toBe(false);
  expect(town.setWorkers(pen.id, 0)).toBe(true);
  expect(p).toMatchObject({ job: -1, herdAnimal: -1, task: Activity.Idle });
  expect(cow.path).toHaveLength(0);
  expect(herdLeader(town, cow)).toBeUndefined();
  town.advance(2);
  expect(cow.pen).toBe(-1);
  expect(p.task).not.toBe(Activity.Herding);
  expect(town.assignJob([other.id], pen.id)).toBe(true);
  expect(leadLivestock(town, other, cow)).toBe(true);
  for (let i = 0; i < 500 && cow.pen < 0; ++i) town.advance(.1);
  expect(cow.pen).toBe(pen.id);
});
it.each([Structure.Farm, Structure.ChickenCoop, Structure.Cowshed])('can assign a stopped settler to farm %i without cancelling another order', kind => {
  const { town, pen, p, other } = village(kind);
  town.orderStop([p.id, other.id]);
  town.orderMove([other.id], point(14, 16));
  town.staff();
  expect(p.job).toBe(-1);
  expect(town.setWorkers(pen.id, 2)).toBe(true);
  expect(p).toMatchObject({ job: pen.id, task: Activity.Working, autoMode: true });
  expect(other).toMatchObject({ job: -1, task: Activity.Moving, ordered: true });
  expect(pen.workers).toBe(1);
});
it('uses the drawn space for admission and stores a full daily batch for the larger herd', () => {
  const { town, pen, house, animal, p, other } = village(Structure.Cowshed);
  pen.pasture = [point(15, 17.5), point(19, 17.5), point(19, 23.5), point(15, 23.5)];
  for (let i = 0; i < 5; ++i) {
    const cow = house(AnimalKind.Cow);
    cow.home = cow.position = point(16.5, 18.5 + i);
  }
  town.assignJob([p.id, other.id], pen.id);
  const sixth = animal(AnimalKind.Cow, 10), seventh = animal(AnimalKind.Cow, 11);
  expect(canLeadAnimal(town, p, sixth)).toBe(true);
  expect(leadLivestock(town, p, sixth)).toBe(true);
  expect(canLeadAnimal(town, other, seventh)).toBe(false);
  for (let i = 0; i < 500 && sixth.pen < 0; ++i) town.advance(.1);
  expect(stockInPen(town, pen.id)).toHaveLength(6);
  const stock = town.stock(0); stock.food = stock.water = 20;
  midnight(town);
  expect([stock.food, stock.water, pen.storedProduce]).toEqual([8, 8, 30]);
});
it('specializes old mixed ranches and cow-only pens, keeps earned eggs, and releases displaced stock alive', () => {
  const data = gunzipSync(readFileSync(new URL('./fixtures/mixed-ranches-v24.goldfantasy.gz', import.meta.url))).toString();
  const town = decodeTown(data, map => new Town(map, 32, false));
  const [, coop, shed] = town.placed;
  expect([coop.kind, coop.storedProduce, shed.kind]).toEqual([Structure.ChickenCoop, 3, Structure.Cowshed]);
  expect(stockInPen(town, coop.id).map(a => a.animal)).toEqual([AnimalKind.Chicken]);
  expect(stockInPen(town, shed.id).map(a => a.animal)).toEqual([AnimalKind.Cow, AnimalKind.Cow]);
  const wild = town.animals.filter(a => a.pen < 0);
  expect(wild.map(a => a.animal)).toEqual([AnimalKind.Pig, AnimalKind.Cow]);
  expect(wild.every(a => a.health > 0 && town.grid.walkable(a.position))).toBe(true);
  expect(town.folk[0].task).toBe(Activity.Idle);
  expect(new DataView(encodeTownPayload(town).buffer).getUint32(0, true)).toBe(29);
  const copy = reload(town);
  expect(copy.building(coop.id)!.storedProduce).toBe(3);
  expect(copy.animals.map(a => [a.id, a.pen])).toEqual(town.animals.map(a => [a.id, a.pen]));
});

it('forecasts only newly affordable batches in the settlement and leaves the actual stores alone', () => {
  const { town, pen, house } = village();
  const shed = new Building(town.nextId++, Structure.Cowshed, point(22, 18), 0, 0);
  shed.village = 0; town.placed.push(shed);
  town.folk = [];
  house(AnimalKind.Chicken); house(AnimalKind.Cow, shed);
  const stock = town.stock(0); stock.food = 10; stock.water = 2;
  pen.storedProduce = 3;
  const first = town.forecast(0);
  expect([first.used.food, first.used.water, first.made.food]).toEqual([1, 1, 2]);
  expect([stock.food, stock.water, pen.storedProduce]).toEqual([10, 2, 3]);
  stock.water = 3;
  const both = town.forecast(0);
  expect([both.used.food, both.used.water, both.made.food]).toEqual([3, 3, 7]);
  pen.storedProduce = livestockRecipe(pen.kind)!.capacity;
  expect(town.forecast(0).made.food).toBe(5);
});
