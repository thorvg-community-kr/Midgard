import { describe, expect, it, vi } from 'vitest';
import { Structure } from '../../packages/engine/src/building-catalog';
import { contains, distance, point, segmentsCross } from '../../packages/engine/src/geometry';
import { admitToPasture, pastureGate } from '../../packages/engine/src/pasture-roaming';
import { AnimalKind, Monster } from '../../packages/engine/src/person';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { Town } from '../../packages/engine/src/town';
import { Building } from '../../packages/engine/src/town-models';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, makeTile, Region } from '../../packages/engine/src/world-types';
import { SceneNode } from '../../packages/native-renderer/src/paint';
import { paintPastureGround, pastureRails } from '../../packages/native-renderer/src/pasture-paint';
import { pickSource } from '../../packages/native-renderer/src/world-pick-registry';

function meadow(species: AnimalKind, drawn = true) {
  const map = new WorldMap();
  map.columns = map.rows = 32;
  map.origin = point(7, 7);
  map.mapSeed = 31;
  map.tiles = Array.from({ length: 32 * 32 }, () => ({ ...makeTile(), revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(65 * 65).fill(.42));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  const town = new Town(map, 32, false);
  const pen = new Building(1, species === AnimalKind.Cow ? Structure.Cowshed : Structure.ChickenCoop, point(12, 12), 0, 0);
  if (drawn) pen.pasture = [point(13.25, 11), point(18, 11), point(18, 18),
    point(11, 18), point(11, 13.25), point(13.25, 13.25)];
  town.placed = [pen];
  ++town.changes;
  town.folk = [];
  town.beasts = [];
  town.editHour(12);
  town.wildlifeDay = town.days;
  town.tick(0);
  const animal = new Monster(7, -1, pastureGate(pen));
  animal.animal = species;
  town.animals = [animal];
  expect(admitToPasture(town, pen, animal)).toBe(true);
  return { town, pen, animal };
}

describe('pasture livestock', () => {
  it.each([AnimalKind.Cow, AnimalKind.Chicken])('grazes around a concave pasture at daylight and settles at night (%i)', species => {
    const { town, pen, animal } = meadow(species);
    const twin = meadow(species);
    const gate = pastureGate(pen);
    let farthest = 0, rested = false;
    const search = vi.spyOn(town.grid, 'path');
    for (let step = 0; step < 700; ++step) {
      const before = animal.position;
      for (const run of [town, twin.town]) { run.time += .2; run.stirWildlife(.2); }
      expect(animal.position).toEqual(twin.animal.position);
      expect(contains(pen.pasture, animal.position)).toBe(true);
      expect(town.grid.walkable(animal.position)).toBe(true);
      expect(pen.footprint().contains(animal.position)).toBe(false);
      expect(pen.pasture.some((a, i) => segmentsCross(before, animal.position, a, pen.pasture[(i + 1) % pen.pasture.length]))).toBe(false);
      expect(distance(before, animal.position)).toBeLessThan(.12);
      farthest = Math.max(farthest, distance(gate, animal.position));
      rested ||= distance(before, animal.position) === 0 && !animal.path.length;
    }
    expect(farthest).toBeGreaterThan(3);
    expect(rested).toBe(true);
    expect(search).not.toHaveBeenCalled();
    town.editHour(0);
    for (let i = 0; animal.path.length && i < 240; i++) { town.time += .1; town.stirWildlife(.1); }
    const nightSpot = { ...animal.position };
    expect(town.animalAsleep(animal)).toBe(true);
    town.time += 10; town.stirWildlife(.25);
    expect(animal.position).toEqual(nightSpot);
  });

  it('lets a settled animal in an old compact yard start wandering from its former stall', () => {
    const { town, pen, animal } = meadow(AnimalKind.Cow, false);
    animal.home = animal.position = point(pen.center.x + .58, pen.center.y - .12);
    animal.path = [];
    animal.ready = town.time;
    const stall = { ...animal.position };
    let farthest = 0;
    for (let i = 0; i < 100; i++) {
      town.time += .2; town.stirWildlife(.2);
      expect(pen.footprint().contains(animal.position)).toBe(true);
      farthest = Math.max(farthest, distance(stall, animal.position));
    }
    expect(farthest).toBeGreaterThan(.5);
  });

  it('continues the same grazing route after saving mid-stride', () => {
    const { town, animal, pen } = meadow(AnimalKind.Cow);
    town.stirWildlife(.1);
    expect(animal.path).toHaveLength(1);
    const copy = decodeTown(encodeTown(town), map => new Town(map, 32, false));
    const saved = copy.creature(animal.id)!;
    expect(saved.pen).toBe(pen.id);
    for (let i = 0; i < 100; ++i) {
      for (const run of [town, copy]) { run.time += .2; run.stirWildlife(.2); }
      expect(saved.position).toEqual(animal.position);
      expect(saved.path).toEqual(animal.path);
    }
  });

  it('lets livestock released beyond the founding region range around their new home', () => {
    const { town, animal } = meadow(AnimalKind.Cow);
    const start = town.world.regionCenter(Region.North);
    expect(town.world.regionAt(start)).toBe(Region.North);
    animal.position = start;
    town.placed = [];
    let farthest = 0;
    for (let i = 0; i < 90; i++) {
      town.time += .2; town.stirWildlife(.2);
      farthest = Math.max(farthest, distance(start, animal.position));
    }
    expect(animal.pen).toBe(-1);
    expect(farthest).toBeGreaterThan(.5);
    expect(town.world.regionAt(animal.position)).toBe(Region.North);
  });

  it('replenishes wild herds even when large pastures already house a full wildlife population', () => {
    const { town, pen } = meadow(AnimalKind.Chicken);
    for (let i = 0; i < 128; i++) {
      const hen = new Monster(20 + i, -1, pen.center);
      hen.animal = AnimalKind.Chicken;
      hen.pen = pen.id;
      town.animals.push(hen);
    }
    town.nextMonster = 200;
    town.wildlifeDay = -1;
    town.populateWildlife();
    expect(town.animals.some(a => a.pen < 0 && a.animal === AnimalKind.Chicken)).toBe(true);
    expect(town.animals.some(a => a.pen < 0 && a.animal === AnimalKind.Cow)).toBe(true);
  });

  it('puts the pickable grass under the same enclosure whose rails leave a real entrance', () => {
    const { pen } = meadow(AnimalKind.Cow);
    const ground = new SceneNode();
    paintPastureGround(ground, pen);
    const shape = ground.children[0];
    expect(pickSource(shape)).toMatchObject({ ref: { kind: 'building', id: pen.id }, groundOutline: pen.pasture });
    const spans = pastureRails(pen.pasture, pen.door());
    expect(spans.filter(span => span.endPost)).toHaveLength(1);
    const perimeter = pen.pasture.reduce((sum, a, i) => sum + distance(a, pen.pasture[(i + 1) % pen.pasture.length]), 0);
    expect(perimeter - spans.reduce((sum, span) => sum + distance(span.start, span.end), 0)).toBeCloseTo(1.06, 3);
  });
});
