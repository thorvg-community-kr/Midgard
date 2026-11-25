import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, DungeonKind, makeTile } from '../../packages/engine/src/world-types';
import { Structure, Resources } from '../../packages/engine/src/building-catalog';
import { point } from '../../packages/engine/src/geometry';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { deposit, position as rockPosition } from '../../packages/engine/src/mining';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';

function settlement(): Town {
  const map = new WorldMap();
  map.columns = map.rows = 40;
  map.mapSeed = 5;
  map.origin = point(20, 20);
  map.tiles = Array.from({ length: 1600 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(81 * 81).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [{ name: 'Test cave', kind: DungeonKind.Cave, origin: point(16, 16), discovered: true }];
  map.reveal(20, 20, 100);
  const town = new Town(map, 40, false);
  expect(town.place(Structure.Camp, point(20, 20), 0), town.canPlace(Structure.Camp, point(20, 20), 0).reason).toBe(true);
  town.completeConstruction();
  town.stock().add(new Resources(100, 100, 100, 100, 100, 100));
  town.tick(0);
  return town;
}
/** Water all round a 5 x 5 plot, as a lake shore or a river bend can leave it. */
function moat(town: Town, x: number, y: number): void {
  for (let dx = -3; dx <= 3; ++dx)
    for (let dy = -3; dy <= 3; ++dy)
      if (Math.max(Math.abs(dx), Math.abs(dy)) === 3) town.map().at(x + dx, y + dy).terrain = Terrain.Water;
  town.grid.rebuild(
    town.map(),
    town.network,
    town.buildings().map((b) => b.footprint()),
  );
}

describe('placing a building', () => {
  it('stakes a rotated foundation on rock, covers only the piles under it and keeps them covered after loading', () => {
    const town = settlement(), map = town.map(), piles = [];
    map.layer(Layer.Elevation).fill(0.8);
    for (let y = 25; y < 32; ++y)
      for (let x = 25; x < 32; ++x) {
        map.at(x, y).terrain = Terrain.Rock;
        if (deposit(map, x, y)) piles.push({ x, y });
      }
    const first = piles[0], at = rockPosition(first.x, first.y), angle = Math.PI / 4;
    expect(map.terrainAt(at)).toBe(Terrain.Rock);
    const preview = town.buildingSite(Structure.Tent, at, angle);
    expect(preview.check.ok).toBe(true);
    expect(deposit(map, first.x, first.y)).toBe(true);
    expect(town.place(Structure.Tent, preview.spot.center, preview.spot.angle)).toBe(true);
    const plot = town.placed.at(-1)!.footprint();
    for (const { x, y } of piles)
      expect(deposit(map, x, y)).toBe(!plot.contains(rockPosition(x, y)));
    const loaded = decodeTown(encodeTown(town), m => new Town(m, 40, false, true));
    loaded.completeConstruction();
    for (let day = 0; day < 60; ++day) { loaded.days = day; loaded.regrow(); }
    expect(deposit(loaded.map(), first.x, first.y)).toBe(false);
    expect(loaded.placed.at(-1)!.built()).toBe(true);
    expect(loaded.canPlantField([point(8, 8), point(10, 8), point(10, 10), point(8, 10)]).reason).toBe('Not arable');
    loaded.map().layer(Layer.Ridge).fill(0.2);
    expect(loaded.canPlace(Structure.Tent, point(30, 28), 0).reason).toBe('Mountains');
  });
  it('refuses a plot whose doorway the builders cannot walk to', () => {
    const town = settlement();
    expect(town.canPlace(Structure.Tent, point(30, 30), 0).reason).toBe('');
    moat(town, 30, 30);
    const cut = town.canPlace(Structure.Tent, point(30, 30), 0);
    expect(cut.ok).toBe(false);
    expect(cut.reason).toBe('Builders cannot reach its door');
    expect(town.place(Structure.Tent, point(30, 30), 0)).toBe(false);
    // The same plot elsewhere is still fine, and so is one whose door opens onto open ground.
    expect(town.canPlace(Structure.Tent, point(24, 12), 0).reason).toBe('');
  });
  it('accepts the plot again once a way to it exists', () => {
    const town = settlement();
    moat(town, 30, 30);
    expect(town.canPlace(Structure.Tent, point(30, 30), 0).ok).toBe(false);
    town.map().at(27, 30).terrain = Terrain.Grass;
    town.grid.rebuild(
      town.map(),
      town.network,
      town.buildings().map((b) => b.footprint()),
    );
    expect(town.canPlace(Structure.Tent, point(30, 30), 0).reason).toBe('');
  });

  it('snaps near the road and leaves a clear second row of tents under the cursor', () => {
    const town = settlement();
    expect(town.buildRoad([sharpAnchor(point(21.2, 20)), sharpAnchor(point(32, 20))])).toBe(true);
    const near = town.fit(Structure.Tent, point(27, 20.7), 0.3);
    expect(near.snapped).toBe(true);
    expect(town.place(Structure.Tent, near.center, near.angle)).toBe(true);
    const cursor = point(27, 22.05), behind = town.fit(Structure.Tent, cursor, 0);
    expect(behind.snapped).toBe(false);
    expect(behind.center).toEqual(cursor);
    expect(town.place(Structure.Tent, behind.center, behind.angle)).toBe(true);
  });

  it('keeps a legal free plot when road alignment would hit the neighboring tent', () => {
    const town = settlement();
    expect(town.buildRoad([sharpAnchor(point(21.2, 20)), sharpAnchor(point(32, 20))])).toBe(true);
    expect(town.place(Structure.Tent, point(27, 21.86), 0)).toBe(true);
    const cursor = point(27, 20.82), aligned = town.fit(Structure.Tent, cursor, 0);
    expect(aligned.snapped).toBe(true);
    expect(town.canPlace(Structure.Tent, aligned.center, aligned.angle).reason).toBe('Occupied');
    const { spot, check } = town.buildingSite(Structure.Tent, cursor, 0);
    expect(check.ok).toBe(true);
    expect(spot.snapped).toBe(false);
    expect(spot.center).toEqual(cursor);
    expect(town.place(Structure.Tent, spot.center, spot.angle)).toBe(true);
    expect(town.buildingSite(Structure.Tent, cursor, 0).check.ok).toBe(false);
  });

  it('only snaps a torch to a completed road within reach of the cursor', () => {
    const town = settlement();
    expect(town.buildRoad([sharpAnchor(point(21.2, 20)), sharpAnchor(point(32, 20))])).toBe(true);
    town.completeConstruction();
    expect(town.fit(Structure.Torch, point(27, 20.6), 0).center).toEqual(point(27, 20));
    const far = town.fit(Structure.Torch, point(27, 28), 0);
    expect(far.snapped).toBe(false);
    expect(town.canPlace(Structure.Torch, far.center, far.angle).reason).toBe('Torches need a completed road');
  });

  it.each([0, Math.PI / 4])('allows the plot edge to overhang a bank while keeping the foundation dry at %f', (angle) => {
    const town = settlement(), map = town.map();
    const scale = Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle));
    const bank = 26.5 + 0.45 * scale, stride = map.columns * 2 + 1;
    const land = map.layer(Layer.Land);
    for (let i = 0; i < land.length; i++) land[i] = bank - (i % stride) / 2;
    expect(town.canPlace(Structure.Tent, point(26.5, 24), angle).ok).toBe(true);
    expect(town.canPlace(Structure.Tent, point(26.6, 24), angle).reason).toBe('Water');
  });

  it('reserves the whole plot beside a dungeon entrance', () => {
    const town = settlement();
    town.map().at(27, 24).dungeon = 0;
    expect(town.canPlace(Structure.Tent, point(26.56, 24.5), 0).reason).toBe('A dungeon entrance');
  });

  it('lets two plots share a wall while keeping the first resident’s door usable', () => {
    const town = settlement();
    expect(town.place(Structure.Tent, point(26, 24), 0)).toBe(true);
    town.completeConstruction();
    town.tick(0);
    expect(town.canPlace(Structure.Tent, point(26, 25), 0).reason).toBe('Blocks a door');
    expect(town.place(Structure.Tent, point(27, 24), 0)).toBe(true);
  });
});
