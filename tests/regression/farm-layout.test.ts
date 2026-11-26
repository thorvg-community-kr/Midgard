import { describe, expect, it, vi } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Region, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Activity, AnimalKind, Monster, Person, Role, Calling, Race } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { area, centroid, contains, distance, overlaps, point } from '../../packages/engine/src/geometry';
import { pastureCapacity, produceCapacity } from '../../packages/engine/src/pasture-geometry';
import { pastureGate } from '../../packages/engine/src/pasture-roaming';
import { encodeTown, encodeTownPayload, decodeTown } from '../../packages/engine/src/save-game';
import { sharpAnchor } from '../../packages/engine/src/road-network';

/** Open grass around a finished camp at (12, 12), with one resident and no farm. */
function fixture() {
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
  Object.assign(town.stock(), new Resources(1000, 100, 100, 100, 0, 100));
  const p = new Person(0, 'Farmer', Role.Resident, Calling.Settler, Race.Human, 0, point(15, 13));
  p.home = p.village = 0;
  p.food = p.rest = p.hydration = p.health = 1;
  p.stress = 0;
  town.folk = [p];
  town.nextPerson = 1;
  town.animals = [];
  town.beasts = [];
  town.editHour(9);
  town.wildlifeDay = town.days;
  town.tick(0);
  return { town, p };
}
const rectangle = (x0: number, y0: number, x1: number, y1: number) => [
  point(x0, y0),
  point(x1, y0),
  point(x1, y1),
  point(x0, y1),
];
const farms = (town: Town) => town.buildings().filter((b) => b.kind === Structure.Farm);

describe('laying out a farm from one drawn area', () => {
  it('stakes out a farmhouse in the corner nearest the camp and the rest as a field its farmhands till', () => {
    const { town, p } = fixture(),
      drawn = rectangle(16, 10, 20, 13);
    expect(town.layFarm(drawn), town.farmLayout(drawn).check.reason).toBe(true);
    expect(farms(town)).toHaveLength(1);
    expect(town.fields()).toHaveLength(1);
    const house = farms(town)[0],
      field = town.fields()[0];
    // A site like any other: nothing stands until builders have raised it.
    expect(house.built()).toBe(false);
    expect(house.materials.required.wood).toBe(15);
    expect(field.tilled).toBe(0);
    expect(distance(house.center, point(16.5, 12.5))).toBeLessThan(0.01);
    // The door opens out of the area, toward the camp.
    expect(house.door().x).toBeLessThan(16);
    expect(contains(drawn, house.door())).toBe(false);
    expect(overlaps(house.footprint().corners(), field.outline)).toBe(false);
    for (const corner of field.outline) {
      expect(corner.x).toBeGreaterThan(15.99);
      expect(corner.x).toBeLessThan(20.01);
      expect(corner.y).toBeGreaterThan(9.99);
      expect(corner.y).toBeLessThan(13.01);
    }
    // Twelve acres drawn, less the farmhouse's corner.
    expect(area(field.outline)).toBeGreaterThan(10.4);
    expect(area(field.outline)).toBeLessThan(11);
    expect(distance(centroid(field.outline), house.center)).toBeLessThan(6);
    town.completeConstruction();
    p.job = house.id;
    house.workers = 1;
    for (let i = 0; i < 4000 && field.tilled < 1; ++i) {
      town.wildlifeDay = town.days;
      town.advance(0.1);
    }
    expect(p.activity).toBe(Activity.Working);
    expect(field.tilled).toBe(1);
  });
  it('puts the farmhouse in the corner by a road, its door on the road side', () => {
    const { town } = fixture();
    expect(town.buildRoad([sharpAnchor(point(13, 12)), sharpAnchor(point(22, 12))])).toBe(true);
    const drawn = rectangle(16, 12.6, 20, 16);
    expect(town.layFarm(drawn), town.farmLayout(drawn).check.reason).toBe(true);
    const house = farms(town)[0];
    expect(distance(house.center, point(16.5, 13.1))).toBeLessThan(0.01);
    expect(house.door().y).toBeLessThan(12.6);
  });
  it('adds only a field when the area is drawn beside a farm already there, built or not', () => {
    const { town } = fixture();
    expect(town.layFarm(rectangle(16, 10, 20, 13))).toBe(true);
    const more = rectangle(16, 13.5, 19, 15.5);
    expect(town.farmLayout(more).house).toBeNull();
    expect(town.layFarm(more), town.farmLayout(more).check.reason).toBe(true);
    expect(farms(town)).toHaveLength(1);
    expect(town.fields()).toHaveLength(2);
    expect(town.fields()[1].acres()).toBe(6);
    // Out of that farm's reach the same gesture founds a second farm.
    const far = rectangle(30, 10, 34, 13);
    expect(town.layFarm(far), town.farmLayout(far).check.reason).toBe(true);
    expect(farms(town)).toHaveLength(2);
    expect(town.fields()).toHaveLength(3);
  });
  it('refuses an area too small for both, or one with something in the way, and says why', () => {
    const { town } = fixture(),
      small = rectangle(16, 10, 17.2, 11.2);
    expect(town.farmLayout(small).check).toMatchObject({ ok: false, reason: 'Too small for a farmhouse and a field' });
    expect(town.farmLayout(rectangle(16, 10, 16.6, 14)).check.reason).toBe('Too small for a farmhouse and a field');
    expect(town.layFarm(small)).toBe(false);
    // A tent in the middle: whichever corner takes the farmhouse, the field would run over it.
    town.placed.push(new Building(town.nextId++, Structure.Tent, point(30, 21.5), 0, 0));
    const taken = rectangle(28, 20, 32, 23);
    expect(town.farmLayout(taken).check).toMatchObject({ ok: false, reason: 'Occupied' });
    expect(town.layFarm(taken)).toBe(false);
    expect(farms(town)).toHaveLength(0);
    expect(town.fields()).toHaveLength(0);
  });
});

describe('drawing a livestock pasture', () => {
  it.each([Structure.ChickenCoop, Structure.Cowshed])('uses the grazable area to size structure %i and keeps its gate reachable', (kind) => {
    const { town } = fixture();
    const small = rectangle(17, 16, 22, 20), large = rectangle(17, 16, 25, 22);
    const first = town.pastureLayout(kind, small), second = town.pastureLayout(kind, large);
    expect(first.check.reason).toBe('');
    expect(second.check.reason).toBe('');
    expect(first.capacity).toBe(Math.floor(area(first.pasture) / (kind === Structure.Cowshed ? 4 : 2)));
    expect(second.capacity).toBeGreaterThan(first.capacity);
    expect(town.layPasture(kind, large)).toBe(true);
    const shelter = town.buildings().at(-1)!;
    expect(shelter.pasture).toEqual(second.pasture);
    expect(pastureCapacity(shelter)).toBe(second.capacity);
    expect(overlaps(shelter.pasture, shelter.footprint().corners())).toBe(false);
    town.completeConstruction();
    town.tick(0);
    const gate = pastureGate(shelter);
    expect(contains(shelter.pasture, gate)).toBe(true);
    expect(town.grid.path(town.camp()!.door(), gate).length).toBeGreaterThan(0);
    shelter.storedProduce = produceCapacity(shelter);
    expect(shelter.storedProduce).toBeGreaterThan(kind === Structure.Cowshed ? 20 : 12);
    expect(new DataView(encodeTownPayload(town).buffer).getUint32(0, true)).toBe(30);
    const saved = decodeTown(encodeTown(town), map => new Town(map, map.width(), false, true));
    const restored = saved.building(shelter.id)!;
    expect(restored.pasture).toEqual(shelter.pasture);
    expect(restored.storedProduce).toBe(shelter.storedProduce);
    expect(pastureCapacity(restored)).toBe(second.capacity);
    expect(saved.fields()).toHaveLength(0);
  });
  it('reuses the routes to a previewed shelter and gate until the walking grid changes', () => {
    const { town } = fixture(), draw = rectangle(18, 16, 24, 21), kind = Structure.Cowshed;
    const route = vi.spyOn(town.grid, 'path');
    expect(town.pastureLayout(kind, draw).check.ok).toBe(true);
    expect(route).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 3; ++i) expect(town.pastureLayout(kind, draw).check.ok).toBe(true);
    expect(route).toHaveBeenCalledTimes(2);
    town.grid.rebuild(town.world, town.network, town.placed.map(b => b.footprint()));
    expect(town.pastureLayout(kind, draw).check.ok).toBe(true);
    expect(route).toHaveBeenCalledTimes(4);
  });
  it('keeps the original stalls in point-placed pens and writes the earlier format', () => {
    const { town } = fixture();
    for (const [kind, x, capacity] of [[Structure.ChickenCoop, 18, 5], [Structure.Cowshed, 24, 2]] as const) {
      expect(town.place(kind, point(x, 15), 0)).toBe(true);
      expect(pastureCapacity(town.placed.at(-1)!)).toBe(capacity);
    }
    expect(new DataView(encodeTownPayload(town).buffer).getUint32(0, true)).toBe(29);
    const saved = decodeTown(encodeTown(town), map => new Town(map, map.width(), false, true));
    expect(saved.placed.slice(-2).map(pastureCapacity)).toEqual([5, 2]);
  });
  it('moves the grass and its occupants with the shed when editing the village', () => {
    const { town } = fixture(), kind = Structure.Cowshed;
    expect(town.layPasture(kind, rectangle(18, 16, 26, 21))).toBe(true);
    const shed = town.placed.at(-1)!, cow = new Monster(town.nextMonster++, -1, point(23, 18));
    cow.animal = AnimalKind.Cow;
    cow.pen = shed.id;
    cow.home = { ...cow.position };
    town.animals.push(cow);
    const capacity = pastureCapacity(shed);
    expect(town.editBuilding(shed.id, point(30, 26), Math.PI / 2, shed.progress, shed.health)).toBe(true);
    expect(contains(shed.pasture, cow.position)).toBe(true);
    expect(cow.home).toEqual(cow.position);
    expect(pastureCapacity(shed)).toBe(capacity);
  });
  it('restores a cow taken over a regional border, including after its pen has been removed', () => {
    const { town } = fixture();
    const north = town.world.regionCenter(Region.North), cow = new Monster(town.nextMonster++, -1, north);
    expect(town.world.regionAt(north)).toBe(Region.North);
    cow.animal = AnimalKind.Cow;
    cow.home = { ...north };
    town.animals.push(cow);
    const saved = decodeTown(encodeTown(town), map => new Town(map, map.width(), false, true));
    expect(saved.creature(cow.id)?.position).toEqual(north);
  });
  it('reserves a drawn enclosure immediately and releases the ground when the shelter is removed', () => {
    const { town } = fixture(), draw = rectangle(17, 15, 23, 21);
    expect(town.layPasture(Structure.ChickenCoop, draw)).toBe(true);
    const shed = town.placed.at(-1)!;
    const at = point(21, 18), crossing = [sharpAnchor(point(21, 13)), sharpAnchor(at)];
    expect(town.buildingAt(at)).toBe(-1);
    expect(town.buildingAt(at, true)).toBe(shed.id);
    expect(town.canPlace(Structure.Tent, at, 0).reason).toBe('Pasture in the way');
    expect(town.canBuildRoad(crossing).reason).toBe('Pasture in the way');
    expect(town.canPlantField(rectangle(20, 18, 22, 20)).reason).toBe('Pasture in the way');
    expect(town.layPasture(Structure.Cowshed, rectangle(20, 18, 26, 24))).toBe(false);
    expect(town.placed).toHaveLength(2);
    town.raze(shed.id);
    expect(town.canPlace(Structure.Tent, at, 0).ok).toBe(true);
  });
  it('rejects too little ground, oversize and crossing outlines without reserving space', () => {
    const { town } = fixture(), kind = Structure.Cowshed;
    expect(town.pastureLayout(kind, rectangle(17, 15, 20, 18)).check.reason).toBe('Too small for a shelter and pasture');
    expect(town.pastureLayout(kind, rectangle(17, 15, 31, 25)).check.reason).toBe('At most 96 acres per pasture');
    expect(town.layPasture(kind, [point(17,15), point(23,21), point(23,15), point(17,21)])).toBe(false);
    expect(town.placed).toHaveLength(1);
  });
});
