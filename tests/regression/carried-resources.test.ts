import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Activity, AnimalKind, Monster, Person, Role, Calling, Race } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure, Product } from '../../packages/engine/src/building-catalog';
import { point, distance } from '../../packages/engine/src/geometry';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { addInventory } from '../../packages/engine/src/equipment';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import {
  heldAmount,
  packAmount,
  burdenPace,
  burdenStart,
  carriedWeight,
  carryCapacity,
  packTotal,
  stowCargo,
} from '../../packages/engine/src/carried-resources';

function fixture(workers = 1) {
  const size = 64,
    map = new WorldMap();
  map.columns = map.rows = size;
  map.mapSeed = 5;
  map.origin = { x: 12, y: 12 };
  map.tiles = Array.from({ length: size * size }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array((size * 2 + 1) ** 2).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [];
  map.reveal(size / 2, size / 2, size * 2);
  const town = new Town(map, size, false),
    camp = new Building(0, Structure.Camp, point(12, 12), 0, 0);
  town.placed.push(camp);
  town.nextId = 1;
  town.migrateSettlements();
  Object.assign(town.stock(), new Resources(1000, 0, 0, 100, 0, 100));
  town.folk = Array.from({ length: workers }, (_, id) => {
    const p = new Person(id, 'Worker ' + id, Role.Resident, Calling.Settler, Race.Human, id, point(14 + id * 0.6, 12));
    p.home = p.village = 0;
    p.food = p.rest = p.hydration = p.health = 1;
    p.stress = 0;
    return p;
  });
  town.nextPerson = workers;
  town.animals = [];
  town.beasts = [];
  town.editHour(9);
  town.wildlifeDay = town.days;
  town.tick(0);
  for (const p of town.folk) {
    p.path = [];
    p.task = p.activity = Activity.Idle;
    p.until = town.time;
  }
  return { town, camp, people: town.folk };
}
function site(town: Town, x: number, y: number, cost: Resources) {
  const b = new Building(town.nextId++, Structure.Tent, point(x, y), 0, 0);
  b.progress = 0;
  b.village = 0;
  b.materials.required = cost;
  town.placed.push(b);
  ++town.changes;
  return b;
}
function run(town: Town, seconds: number, until: () => boolean = () => false, each: () => void = () => {}) {
  for (let i = 0; i < seconds * 10 && !until(); ++i) {
    town.wildlifeDay = town.days;
    town.advance(0.1);
    each();
  }
}

describe('resources stay with the people who gathered them', () => {
  it('stows loads until the pack is full and only then empties everything into storage', () => {
    const { town, people } = fixture(),
      p = people[0];
    for (let load = 0; load < 9; ++load) {
      p.carriedProduct = Product.Wood;
      p.carrying = 3;
      expect(town.keepCargo(p)).toBe(true);
    }
    addInventory(p, 'stone', 2);
    expect(packTotal(p)).toBe(29);
    expect(carriedWeight(p)).toBe(29);
    expect(burdenPace(p)).toBeLessThan(0.7);
    p.carrying = 3;
    expect(stowCargo(p)).toBe(false);
    expect(town.haulCargo(p)).toBe(true);
    run(town, 60, () => p.activity !== Activity.Hauling);
    expect(p.carrying).toBe(0);
    expect(packTotal(p)).toBe(0);
    expect(town.stock().wood).toBe(30);
    expect(town.stock().stone).toBe(2);
  });
  it('sends food and a workshop worker’s raw input to storage as before', () => {
    const { town, people } = fixture(),
      p = people[0],
      mill = new Building(town.nextId++, Structure.Sawmill, point(18, 12), 0, 0);
    mill.village = 0;
    town.placed.push(mill);
    p.carrying = 3;
    p.carriedProduct = Product.Food;
    expect(town.keepCargo(p)).toBe(false);
    p.carriedProduct = Product.Wood;
    p.job = mill.id;
    expect(town.keepCargo(p)).toBe(false);
    p.job = -1;
    expect(town.keepCargo(p)).toBe(true);
  });
  it('eats carried food on the spot', () => {
    const { town, people } = fixture(),
      p = people[0];
    addInventory(p, 'food', 2);
    p.food = 0.1;
    town.stock().food = 0;
    expect(town.eat(p)).toBe(true);
    expect(p.food).toBe(1);
    expect(packAmount(p, Product.Food)).toBe(1);
    expect(p.activity).toBe(Activity.Eating);
    expect(p.moving()).toBe(false);
    expect(p.target).toBe(-1);
    const until = p.until;
    for (let i = 0; i < 5; i++) {
      town.advance(0.1);
      expect(p.activity).toBe(Activity.Eating);
      expect(p.until).toBe(until);
    }
    expect(packAmount(p, Product.Food)).toBe(1);
    const restored = decodeTown(encodeTown(town), (map) => new Town(map, 64, false, true)),
      diner = restored.person(p.id)!;
    expect(diner.activity).toBe(Activity.Eating);
    expect(diner.until - restored.clock()).toBeCloseTo(until - town.clock(), 4);
    run(restored, 3);
    expect(diner.activity).not.toBe(Activity.Eating);
    expect(packAmount(diner, Product.Food)).toBe(1);
  });
  it('takes a meal from a hunt, keeps the surplus and can leave the meal on orders', () => {
    const { town, people: [hunter] } = fixture();
    const prey = new Monster(town.nextMonster++, -1, { ...hunter.position });
    prey.animal = AnimalKind.Pig;
    prey.health = 0;
    prey.provokedBy = hunter.id;
    town.animals.push(prey);
    hunter.foe = prey.id;
    hunter.hunting = true;
    hunter.food = 0.1;
    const eaten = town.economy(0).today.eaten;
    town.stirWildlife(0.1);
    expect(hunter.activity).toBe(Activity.Eating);
    expect(hunter.food).toBe(1);
    expect(hunter.carrying).toBeGreaterThan(0);
    expect(town.economy(0).today.eaten).toBe(eaten + 1);
    town.orderMove([hunter.id], point(18, 16));
    expect(hunter.activity).toBe(Activity.Moving);
  });
});

describe('carried weight', () => {
  it('weighs resources, tools and weapons at a kilogram and worn gear at a tenth', () => {
    const { people } = fixture(),
      p = people[0];
    expect(carriedWeight(p)).toBe(0);
    addInventory(p, 'sword');
    addInventory(p, 'axe');
    addInventory(p, 'cap');
    addInventory(p, 'wood', 4);
    expect(carriedWeight(p)).toBe(6.1);
    p.carriedProduct = Product.Stone;
    p.carrying = 3;
    expect(carriedWeight(p)).toBe(9.1);
    expect(carryCapacity).toBe(30);
  });
  it('walks at full pace below fifteen kilograms and slows steadily above it', () => {
    const { town, people } = fixture(),
      p = people[0],
      free = town.walkingSpeed(p);
    addInventory(p, 'wood', 14);
    expect(burdenStart).toBe(15);
    expect(town.walkingSpeed(p)).toBe(free);
    addInventory(p, 'stone', 6);
    expect(town.walkingSpeed(p)).toBeLessThan(free);
    const half = town.walkingSpeed(p);
    addInventory(p, 'stone', 10);
    expect(town.walkingSpeed(p)).toBeLessThan(half);
    expect(town.walkingSpeed(p)).toBeCloseTo(free * 0.6);
  });
});

describe('construction supply', () => {
  it('builds straight from the builder’s own pack', () => {
    const { town, people } = fixture(),
      p = people[0],
      target = site(town, 18, 14, new Resources(0, 5));
    addInventory(p, 'wood', 8);
    expect(town.orderBuild([p.id], target.id)).toBe(true);
    const camp = town.camp()!.door();
    let nearCamp = false;
    run(town, 120, () => target.built(), () => (nearCamp ||= p.activity === Activity.FetchingMaterials && distance(p.position, camp) < 0.5));
    expect(target.built()).toBe(true);
    expect(nearCamp).toBe(false);
    expect(packAmount(p, Product.Wood)).toBe(3);
    expect(target.materials.delivered.wood).toBe(5);
  });
  it('takes what a neighbour carries hand to hand instead of walking to storage', () => {
    const { town, people } = fixture(2),
      [builder, carrier] = people,
      target = site(town, 18, 14, new Resources(0, 6));
    town.stock().wood = 100;
    addInventory(carrier, 'wood', 10);
    carrier.position = point(20, 15);
    town.setAuto(carrier.id, false);
    expect(town.orderBuild([builder.id], target.id)).toBe(true);
    let met = false, passed = false;
    run(town, 120, () => target.built(), () => {
      met ||= builder.giver === carrier.id;
      passed ||= !!builder.transfer?.taking && carrier.transfer?.at === builder.transfer.at && !carrier.transfer.taking;
    });
    expect(met).toBe(true);
    expect(passed).toBe(true);
    expect(target.built()).toBe(true);
    expect(packAmount(carrier, Product.Wood)).toBe(4);
    expect(town.stock().wood).toBe(100);
  });
  it('has each builder bring what is in their own pack instead of waiting on the others', () => {
    const { town, people } = fixture(3),
      target = site(town, 18, 14, new Resources(0, 4));
    // Between them the crew holds more than the site lacks; nobody may count on the rest and stand still.
    for (const p of people) addInventory(p, 'wood', 2);
    expect(town.orderBuild(people.map((p) => p.id), target.id)).toBe(true);
    run(town, 120, () => target.built());
    expect(target.materials.delivered.wood).toBe(4);
    expect(target.built()).toBe(true);
    expect(people.reduce((sum, p) => sum + packAmount(p, Product.Wood) + p.carrying, 0)).toBe(2);
  });
  it('does not wait for materials held by a crew mate who has gone to rest', () => {
    const { town, people } = fixture(2),
      [builder, sleeper] = people,
      target = site(town, 18, 14, new Resources(0, 4));
    for (let x = 22; x < 26; ++x) for (let y = 12; y < 16; ++y) town.map().at(x, y).trees = 3;
    ++town.changes;
    addInventory(sleeper, 'wood', 6);
    expect(town.orderBuild([builder.id, sleeper.id], target.id)).toBe(true);
    // The mate keeps the job but lies far off asleep with the wood in their pack.
    sleeper.position = point(40, 40);
    sleeper.activity = Activity.Sleeping;
    sleeper.path = [];
    sleeper.until = town.time + 1e6;
    run(town, 240, () => target.built(), () => {
      sleeper.activity = Activity.Sleeping;
      sleeper.path = [];
    });
    expect(target.built()).toBe(true);
    expect(packAmount(sleeper, Product.Wood)).toBe(6);
  });
  it('says once what a site waits for when nobody can supply it, and builds it once the material can be had', () => {
    const { town, people } = fixture(),
      p = people[0],
      target = site(town, 18, 14, new Resources(0, 0, 4));
    // No rock on this map and no stone in store: there is nothing to build with yet.
    expect(town.orderBuild([p.id], target.id)).toBe(true);
    run(town, 20);
    const told = () => town.notices.filter((text) => text === 'No stone in sight for the Tent');
    expect(told()).toHaveLength(1);
    // The builder is free for other work rather than stuck on an order that cannot advance.
    expect(p.ordered).toBe(false);
    expect(p.autoMode).toBe(true);
    town.stock().stone = 4;
    expect(town.orderBuild([p.id], target.id)).toBe(true);
    run(town, 120, () => target.built());
    expect(target.built()).toBe(true);
    expect(told()).toHaveLength(1);
  });
  it('sends every builder of a site to gather, not one while the others wait', () => {
    const { town, people } = fixture(3),
      target = site(town, 18, 14, new Resources(0, 18));
    for (let x = 22; x < 28; ++x) for (let y = 12; y < 18; ++y) town.map().at(x, y).trees = 3;
    ++town.changes;
    expect(town.orderBuild(people.map((p) => p.id), target.id)).toBe(true);
    const gatherers = new Set<number>();
    let idleWaits = 0;
    run(town, 400, () => target.built(), () => {
      for (const p of people) {
        if (p.activity === Activity.Felling) gatherers.add(p.id);
        if (p.activity === Activity.WaitingMaterials && people.some((o) => o.activity === Activity.Felling)) ++idleWaits;
      }
    });
    expect(target.built()).toBe(true);
    expect(gatherers.size).toBe(3);
    expect(idleWaits).toBeLessThan(40);
  });
  it('lays up to each tree on the way and fells it there, never walking back along the road', () => {
    const { town, people } = fixture(),
      p = people[0];
    for (const x of [20, 24, 28]) town.map().at(x, 12).trees = 1;
    ++town.changes;
    expect(town.buildRoad([sharpAnchor(point(13.2, 12)), sharpAnchor(point(32, 12))])).toBe(true);
    const road = town.roads().roads()[0],
      trees = () => [20, 24, 28].reduce((sum, x) => sum + town.map().at(x, 12).trees, 0);
    expect(town.orderRoadwork([p.id], road.id)).toBe(true);
    let furthest = 13.2,
      retreat = 0,
      laidAtFirstTree = -1;
    run(town, 900, () => road.built >= 1, () => {
      if (laidAtFirstTree < 0 && trees() < 3) laidAtFirstTree = road.built * road.length();
      // Measured once the road is begun: the walk to its start from wherever the worker stood is not a step back.
      if (road.built <= 0) return;
      furthest = Math.max(furthest, p.position.x);
      retreat = Math.max(retreat, furthest - p.position.x);
    });
    expect(road.built).toBe(1);
    expect(trees()).toBe(0);
    // The road had reached the first tree before it fell: nobody walked ahead to clear the way first.
    expect(laidAtFirstTree).toBeGreaterThan(4);
    // No step back at all: the tree is felled from the front's side and the road laid on from there. Each tree
    // used to cost a trip to the camp, later a trip ahead and back, then one walk back from the last tree to
    // the start, and last a step of a tile back to the front.
    expect(retreat).toBeLessThan(0.3);
    expect(heldAmount(p, Product.Wood)).toBe(9);
    expect(town.stock().wood).toBe(0);
  });
  it('walks a short hop over open ground straight instead of by the nearest lane', () => {
    const { town, people } = fixture(),
      p = people[0];
    expect(town.buildRoad([sharpAnchor(point(13.2, 12)), sharpAnchor(point(20, 12))])).toBe(true);
    const road = town.roads().roads()[0];
    road.built = 1;
    town.roadChanged();
    town.advance(0.1);
    // Beside the road, crossing a tile boundary: the planner alone would send the walker onto the lane first.
    p.position = point(15.95, 12.42);
    expect(town.walkTo(p, point(16.3, 12.42))).toBe(true);
    expect(p.path).toEqual([point(16.3, 12.42)]);
    expect(town.walkTo(p, point(19.5, 12.42))).toBe(true);
    expect(p.path.length).toBeGreaterThanOrEqual(1);
  });
});
