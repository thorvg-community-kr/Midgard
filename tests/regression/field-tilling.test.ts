import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Activity, Person, Role, Calling, Race } from '../../packages/engine/src/person';
import { Building, Field } from '../../packages/engine/src/town-models';
import { Product, Resources, Structure } from '../../packages/engine/src/building-catalog';
import { contains, point, distance, unproject } from '../../packages/engine/src/geometry';
import { cropStage, CropStage, cropWater, cropYield, farmWorkPhase, fieldRows, workCrop } from '../../packages/engine/src/farm-work';
import { decodeTown, encodeTown, encodeTownPayload } from '../../packages/engine/src/save-game';
import { sealSave } from '../../packages/engine/src/save-archive';
import { heldAmount } from '../../packages/engine/src/carried-resources';
import { ShapeNode } from '../../packages/native-renderer/src/paint';
import { paintOrnaments } from '../../packages/native-renderer/src/world-ground';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';

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
    camp = new Building(0, Structure.Camp, point(12, 12), 0, 0),
    farm = new Building(1, Structure.Farm, point(16, 12), 0, 0);
  town.placed.push(camp, farm);
  town.nextId = 2;
  town.migrateSettlements();
  Object.assign(town.stock(), new Resources(1000, 100, 100, 100, 0, 100));
  const p = new Person(0, 'Farmer', Role.Resident, Calling.Settler, Race.Human, 0, point(15, 13));
  p.home = p.village = 0;
  p.food = p.rest = p.hydration = p.health = 1;
  p.stress = 0;
  p.job = farm.id;
  farm.workers = 1;
  town.folk = [p];
  town.nextPerson = 1;
  town.animals = [];
  town.beasts = [];
  town.editHour(9);
  town.wildlifeDay = town.days;
  town.tick(0);
  return { town, farm, p };
}
const plot = [point(17.5, 13), point(21.5, 13), point(21.5, 16), point(17.5, 16)];

describe('breaking in a field', () => {
  it('paints wildflowers in the plot beneath the advancing soil', () => {
    const { town } = fixture();
    town.map().layer(Layer.Moisture).fill(0.48);
    town.map().layer(Layer.Shade).fill(0.8);
    expect(town.plantField(plot)).toBe(true);
    const state = new WorldRendererState({} as never);
    paintOrnaments(state, town.map(), town.climate());
    const hasFlowerInPlot = state.groundCover.children.some((shape) =>
      shape instanceof ShapeNode && shape.commands.some(([op, x, y]) => op === 'E' && contains(plot, unproject(x, y))),
    );
    expect(hasFlowerInPlot).toBe(true);
    const layers = state.world.children, cover = layers.indexOf(state.groundCover);
    expect(cover).toBeGreaterThanOrEqual(0);
    expect(cover).toBeLessThan(layers.indexOf(state.farmland));
  });
  it('stakes a new plot untilled; it yields nothing until a farm worker has hoed it', () => {
    const { town, p } = fixture();
    expect(town.plantField(plot), town.canPlantField(plot).reason).toBe(true);
    const field = town.fields()[0];
    expect(field.tilled).toBe(0);
    expect(field.acres()).toBe(12);
    expect(field.tilledAcres()).toBe(0);
    expect(town.tendedFieldAcres()).toBe(0);
    const goals = new Set<string>();
    let hoeing = 0;
    for (let i = 0; i < 3000 && field.tilled < 1; ++i) {
      town.wildlifeDay = town.days;
      town.advance(0.1);
      if (p.activity === Activity.Working && p.workField === field.id && !p.moving()) {
        ++hoeing;
        goals.add(p.goal.x.toFixed(1) + ',' + p.goal.y.toFixed(1));
        // Breaking in is hoe work throughout; watering only starts on a finished plot.
        if (field.tilled < 1) expect(farmWorkPhase(p, town.clock(), town.fields())).toBe(0);
      }
    }
    expect(field.tilled).toBe(1);
    expect(hoeing).toBeGreaterThan(100);
    expect(p).toMatchObject({ level: 1, experience: 0 });
    // The worker follows the furrow front across the plot instead of standing on one spot.
    expect(goals.size).toBeGreaterThan(4);
    expect(field.tilledAcres()).toBe(12);
    expect(town.notices.some((text) => text.startsWith('A field is tilled'))).toBe(true);
    const rows = fieldRows(field.outline);
    expect(Math.abs(rows.along.x)).toBe(1);
    expect(distance(rows.center, point(19.5, 14.5))).toBeLessThan(0.01);
  });
  it('keeps old fields fully tilled and saves a half-tilled one', () => {
    const { town } = fixture();
    const old = new Field(town.nextId++, plot, 0);
    town.farmland.push(old);
    expect(old.tilled).toBe(1);
    expect(decodeTown(encodeTown(town), (map) => new Town(map, 64, false, true)).fields()[0].tilled).toBe(1);
    old.tilled = 0.5;
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 64, false, true));
    expect(loaded.fields()[0].tilled).toBe(0.5);
    expect(loaded.fields()[0].tilledAcres()).toBe(6);
  });

  it('rejects an old tilled share that exceeds the whole plot', () => {
    const { town } = fixture();
    expect(town.plantField(plot)).toBe(true);
    const marker = Math.fround(0.3817563);
    town.fields()[0].tilled = marker;
    const bytes = encodeTownPayload(town), data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(data.getUint32(0, true)).toBeLessThan(29);
    const offsets = [];
    for (let i = 0; i + 4 <= data.byteLength; ++i)
      if (data.getFloat32(i, true) === marker) offsets.push(i);
    expect(offsets).toHaveLength(1);
    data.setFloat32(offsets[0], 1.5, true);
    expect(() => decodeTown(sealSave(bytes), map => new Town(map, 64, false, true))).toThrow('Invalid crop progress');
  });

  it('leaves standing timber on a staked field for a farmer to fell and carry before tilling', () => {
    const { town, farm, p } = fixture();
    const stand = town.map().at(19, 14), beyond = town.map().at(22, 14);
    stand.trees = beyond.trees = 1;
    town.stock(0).wood = 0;
    expect(town.plantField(plot)).toBe(true);
    const field = town.fields()[0];
    expect(stand.trees).toBe(1);
    expect(town.stock(0).wood).toBe(0);
    expect(town.assignJob([p.id], farm.id)).toBe(true);
    for (let i = 0; i < 300 && stand.trees; ++i) {
      expect(field.tilled).toBe(0);
      town.advance(1);
    }
    expect(stand.trees).toBe(0);
    expect(beyond.trees).toBe(1);
    for (let i = 0; i < 60 && field.tilled === 0; ++i) town.advance(1);
    expect(field.tilled).toBeGreaterThan(0);
    expect(heldAmount(p, Product.Wood)).toBe(3);
    expect(town.stock(0).wood).toBe(0);
  });

  it.each([1, 2])('works the same five stages and stores one crop with %i assigned farmer(s)', workers => {
    const { town, farm, p } = fixture();
    const tent = new Building(town.nextId++, Structure.Tent, point(11, 15), 0, 0);
    const well = new Building(town.nextId++, Structure.Well, point(13, 16), 0, 0);
    tent.village = well.village = 0;
    town.placed.push(tent, well);
    p.home = tent.id;
    town.stock().water = 20;
    expect(town.plantField(plot)).toBe(true);
    if (workers === 2) {
      const mate = new Person(town.nextPerson++, 'Second farmer', Role.Resident, Calling.Settler, Race.Human, 0, farm.door());
      mate.village = 0;
      mate.home = tent.id;
      mate.food = mate.rest = mate.hydration = mate.health = 1;
      town.folk.push(mate);
    }
    expect(town.assignJob(town.people().map(person => person.id), farm.id)).toBe(true);
    const field = town.fields()[0], stages: CropStage[] = [];
    const start = town.clock();
    while (town.clock() - start < Town.secondsPerDay * 9) {
      const stage = cropStage(field);
      if (stage !== stages.at(-1)) stages.push(stage);
      if (stages.length > 5) break;
      town.wildlifeDay = town.days;
      town.advance(1);
    }
    expect(stages).toEqual([CropStage.Tilling, CropStage.Sowing, CropStage.Watering,
      CropStage.Tending, CropStage.Harvesting, CropStage.Tilling]);
    const days = (town.clock() - start) / Town.secondsPerDay;
    console.log('First crop with', workers, 'farmer(s):', days.toFixed(2), 'days');
    expect(days).toBeGreaterThan(6 / workers);
    expect(days).toBeLessThan(8 / workers);
    expect(cropWater(field)).toBe(4);
    expect(cropYield(town, field)).toBe(8);
    expect(town.notices.filter(line => line.startsWith('Harvest:'))).toEqual(['Harvest: +8 food']);
  });

  it('keeps shared work across a save, pays water once, and pauses during winter', () => {
    const { town, farm, p } = fixture();
    expect(town.plantField(plot)).toBe(true);
    let field = town.fields()[0];
    p.workField = field.id;
    field.cropProgress = CropStage.Watering;
    town.stock(0).water = cropWater(field) - 1;
    expect(workCrop(town, p, farm, 1)).toBe(false);
    expect(field.cropProgress).toBe(CropStage.Watering);
    ++town.stock(0).water;
    expect(workCrop(town, p, farm, 1)).toBe(true);
    expect(town.stock(0).water).toBe(0);
    const midWater = field.cropProgress;
    const loaded = decodeTown(encodeTown(town), map => new Town(map, 64, false, true));
    field = loaded.fields()[0];
    expect(field.cropProgress).toBe(midWater);
    const mate = new Person(1, 'Second farmer', Role.Resident, Calling.Settler, Race.Human, 0, p.position);
    mate.workField = field.id;
    const workplace = loaded.building(farm.id)!;
    expect(workCrop(loaded, mate, workplace, 1)).toBe(true);
    expect(field.cropProgress - midWater).toBeCloseTo(midWater - CropStage.Watering, 9);
    loaded.days = 45;
    const before = field.cropProgress;
    expect(workCrop(loaded, mate, workplace, 100)).toBe(false);
    expect(field.cropProgress).toBe(before);
    loaded.days = 60;
    expect(workCrop(loaded, mate, workplace, 1)).toBe(true);
    expect(loaded.stock(0).water).toBe(0);
  });

  it('forecasts affordable irrigation exactly until it has been paid and sends the farmer to the next plot', () => {
    const { town, farm, p } = fixture();
    const farther = plot.map(at => point(at.x + 2.5, at.y - 4));
    expect(town.plantField(plot)).toBe(true);
    expect(town.plantField(farther)).toBe(true);
    const [first, next] = town.fields();
    expect(town.assignJob([p.id], farm.id)).toBe(true);
    const residentDrinks = town.forecast(0).used.water;
    first.cropProgress = CropStage.Watering;
    p.activity = Activity.Working;
    p.workField = first.id;
    town.stock(0).water = cropWater(first) - 1;
    expect(town.forecast(0).used.water).toBe(residentDrinks);
    ++town.stock(0).water;
    expect(town.forecast(0).used.water).toBe(residentDrinks + cropWater(first));
    expect(workCrop(town, p, farm, 1)).toBe(true);
    expect(town.forecast(0).used.water).toBe(residentDrinks);
    first.cropProgress = CropStage.Harvesting + 0.99;
    expect(workCrop(town, p, farm, 10)).toBe(true);
    expect(p.workField).toBe(next.id);
    for (let i = 0; i < 120 && next.cropProgress === 0; ++i) town.advance(1);
    expect(next.cropProgress).toBeGreaterThan(0);
    expect(first.cropProgress).toBe(0);
  });
});
