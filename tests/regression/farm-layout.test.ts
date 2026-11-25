import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Activity, Person, Role, Calling, Race } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { area, centroid, contains, distance, overlaps, point } from '../../packages/engine/src/geometry';
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
