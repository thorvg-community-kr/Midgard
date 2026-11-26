import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Terrain, Layer } from '../../packages/engine/src/world-types';
import { Activity, Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { distance, point, type Point } from '../../packages/engine/src/geometry';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { roadWorkSpot } from '../../packages/engine/src/person-navigation';
import { Traffic } from '../../packages/engine/src/traffic';
import { SceneNode } from '../../packages/native-renderer/src/paint';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { moveAgents } from '../../packages/native-renderer/src/world-people';

/** A flat meadow with a camp at (12, 20) and bare-handed founders at its door; `wood` plants trees on tiles. */
function meadow(founders: number, wood: (x: number, y: number) => number = () => 0): Town {
  const map = WorldMap.generate(5, 48, 40);
  map.ymir = null;
  map.fire = null;
  map.stream = { path: [], width: [] };
  for (const layer of map.layers) layer.fill(0.4);
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  for (let y = 0; y < 40; ++y)
    for (let x = 0; x < 48; ++x)
      Object.assign(map.at(x, y), { terrain: Terrain.Grass, trees: wood(x, y), wild: 0, revealed: true, dungeon: -1 });
  map.sites = [];
  const town = new Town(map, 48, false);
  town.wildlifeDay = 0;
  const camp = new Building(0, Structure.Camp, point(12, 20), 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(0);
  Object.assign(town.stock(), new Resources(1000, 1000, 1000, 1000, 1000, 1000));
  town.folk = Array.from({ length: founders }, (_, id) => {
    const p = new Person(id, id ? 'Embla' : 'Askr', Role.Resident, Calling.Settler, Race.Human, 0, camp.door());
    p.home = p.village = 0;
    p.food = p.rest = p.health = p.hydration = 0.9;
    return p;
  });
  town.nextPerson = founders;
  town.editHour(9);
  town.tick(0);
  return town;
}
/** Everyone lays a road east from the camp: the game seconds it took, the tiles each of them walked, and how many
 * of those led back along the road (a trip home with a full pack left out). */
function lay(town: Town, tiles: number): { seconds: number; walked: number[]; back: number[] } {
  town.buildRoad([sharpAnchor(point(13.2, 20)), sharpAnchor(point(13.2 + tiles, 20))]);
  const road = town.roads().roads()[0],
    folk = town.people();
  town.orderRoadwork(folk.map((p) => p.id), road.id);
  const walked = folk.map(() => 0),
    back = folk.map(() => 0),
    last = folk.map((p) => ({ ...p.position }));
  for (let step = 0; step < 9000; ++step) {
    town.advance(0.1);
    folk.forEach((p, k) => {
      walked[k] += Math.hypot(p.position.x - last[k].x, p.position.y - last[k].y);
      if (p.position.x < last[k].x && p.activity !== Activity.Hauling) back[k] += last[k].x - p.position.x;
      last[k] = { ...p.position };
    });
    if (road.built >= 1) return { seconds: (step + 1) / 10, walked, back };
  }
  return { seconds: Infinity, walked, back };
}

describe('a crew on one road', () => {
  it('lays a clear way about twice as fast with two as with one', () => {
    const solo = meadow(1), crew = meadow(2);
    const one = lay(solo, 10), two = lay(crew, 10);
    expect(one.seconds).toBeGreaterThan(75);
    expect(one.seconds).toBeLessThan(85);
    expect(two.seconds).toBeLessThan(45);
    for (const worker of [...solo.folk, ...crew.folk]) expect(worker).toMatchObject({ level: 1, experience: 0 });
  });
  it('lays up to a wood at the far end of the way instead of walking there and back', () => {
    // Six trees on the last two tiles of a way of fourteen: the front has to come to them.
    const far = (x: number, y: number) => (x >= 25 && x <= 26 && y >= 19 && y <= 21 ? 3 : 0),
      crew = lay(meadow(2, far), 14),
      alone = lay(meadow(1, far), 14);
    expect(crew.seconds).toBeLessThan(180);
    for (const tiles of crew.walked) expect(tiles).toBeLessThan(27);
    expect(alone.walked[0]).toBeLessThan(36);
  });
  it('clears a thick wood on the way without walking up and down the road', () => {
    // Trees on eight tiles of a way of ten, three rows deep. Before, each of the two walked ninety tiles.
    const thick = (x: number, y: number) => (x >= 15 && x <= 22 && y >= 19 && y <= 21 ? 2 : 0),
      crew = lay(meadow(2, thick), 10);
    expect(crew.seconds).toBeLessThan(350);
    for (const tiles of crew.walked) expect(tiles).toBeLessThan(55);
  });
  it('fells a tree in the way from the front and lays on, without a step back along the road', () => {
    // Four single trees two tiles apart: alone, a worker used to walk back seven tiles for them.
    const sparse = (x: number, y: number) => (y === 20 && x >= 16 && x <= 22 && x % 2 === 0 ? 1 : 0),
      thick = (x: number, y: number) => (x >= 15 && x <= 22 && y >= 19 && y <= 21 ? 2 : 0);
    expect(lay(meadow(1, sparse), 10).back[0]).toBeLessThan(0.2);
    // In a thick wood only the shuffle from tree to tree is left: it was thirty-eight tiles alone, fifteen in a crew.
    expect(lay(meadow(1, thick), 10).back[0]).toBeLessThan(9);
    for (const tiles of lay(meadow(2, thick), 10).back) expect(tiles).toBeLessThan(4);
  });
});

describe('a resident laying a road, as drawn', () => {
  let tvg: ThorVGNamespace;
  beforeAll(async () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return { putImageData() {}, clearRect() {} };
        }
      },
    );
    const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
    tvg = await ThorVG.init({
      renderer: 'sw',
      locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
    });
  });
  afterAll(() => {
    tvg.term();
    vi.unstubAllGlobals();
  });
  /** Everyone lays a road from the camp to `to`, drawn thirty times a second: the times a figure at the front was
   * mirrored, and the times someone left the laying and was back at it within three seconds. */
  function watch(town: Town, to: Point): { turns: number; returns: number; laid: boolean } {
    town.buildRoad([sharpAnchor(point(13.2, 20)), sharpAnchor(to)]);
    const road = town.roads().roads()[0],
      folk = town.people();
    town.orderRoadwork(folk.map((p) => p.id), road.id);
    const s = new WorldRendererState(tvg),
      traffic = new Traffic(5),
      seen = folk.map(() => ({ facing: 0, atFront: false, activity: Activity.Roadwork, left: -Infinity })),
      out = { turns: 0, returns: 0, laid: false };
    s.rows = Array.from({ length: 64 }, () => new SceneNode());
    s.currentVisibility.sample = () => 255;
    try {
      for (let frame = 0; frame < 30000 && !out.laid; ++frame) {
        town.advance(1 / 30);
        moveAgents(s, town, traffic, town.clock(), []);
        folk.forEach((p, k) => {
          const was = seen[k],
            facing = s.figures.get(p.id)!.facing,
            // Standing at the front, and from then on through the small steps that keep them there.
            atFront =
              p.activity === Activity.Roadwork &&
              (!p.moving() || (was.atFront && distance(p.position, roadWorkSpot(town, p, road)) < 0.3));
          if (atFront && was.atFront && facing !== was.facing) ++out.turns;
          if (p.activity !== was.activity) {
            if (was.activity === Activity.Roadwork) was.left = frame;
            else if (p.activity === Activity.Roadwork && frame - was.left <= 90) ++out.returns;
            was.activity = p.activity;
          }
          was.facing = facing;
          was.atFront = atFront;
        });
        out.laid = road.built >= 1;
      }
    } finally {
      s.adapter.dispose();
    }
    return out;
  }
  // The way runs north from the camp, so a step aside to make room for a crew mate is a step east or west.
  const north = point(13.2, 10),
    east = point(23.2, 20);
  it('does not turn round on a clear way, alone or in a crew', () => {
    expect(watch(meadow(1), north)).toEqual({ turns: 0, returns: 0, laid: true });
    expect(watch(meadow(2), north)).toEqual({ turns: 0, returns: 0, laid: true });
    expect(watch(meadow(3), east)).toEqual({ turns: 0, returns: 0, laid: true });
  });
  it('does not turn round each time a tree of the way is felled', () => {
    const eastWood = (x: number, y: number) => (x >= 15 && x <= 18 && y >= 19 && y <= 21 ? 2 : 0),
      northWood = (x: number, y: number) => (y >= 13 && y <= 17 && x >= 12 && x <= 14 ? 2 : 0);
    expect(watch(meadow(1, eastWood), east)).toEqual({ turns: 0, returns: 0, laid: true });
    expect(watch(meadow(2, northWood), north)).toEqual({ turns: 0, returns: 0, laid: true });
  });
});
