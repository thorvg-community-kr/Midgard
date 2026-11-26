import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import {
  Person,
  Role,
  Calling,
  Race,
  Activity,
  TreeWorkKind,
  type TreeWorkEvent,
} from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Terrain } from '../../packages/engine/src/world-types';
import { point } from '../../packages/engine/src/geometry';
import { hammerTiming, harvestDuration, workElapsed } from '../../packages/engine/src/work-timing';
import { deposit } from '../../packages/engine/src/mining';
import { decodeTown, encodeTown, encodeTownPayload } from '../../packages/engine/src/save-game';
import { copyNative } from '../../packages/engine/src/native-copy';

function fixture() {
  const town = new Town(5, 32, false);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++)
      Object.assign(town.map().at(x, y), { terrain: Terrain.Grass, trees: 0, wild: 0, revealed: true });
  const home = new Building(0, Structure.Camp, point(12, 12), 0, 0);
  home.village = 0;
  town.placed.push(home);
  town.nextId = 1;
  town.foundSettlement(0);
  const p = new Person(0, 'Worker', Role.Resident, Calling.Settler, Race.Human, 0, point(18, 18));
  p.home = p.village = 0;
  p.food = p.rest = p.health = 1;
  town.folk.push(p);
  town.nextPerson = 1;
  town.titleAutoplay = true;
  town.changes++;
  town.tick(0);
  return { town, p };
}
function harvest(step: number, equipped = true) {
  const { town, p } = fixture();
  if (equipped) { p.inventory[0] = { item: 'axe', quantity: 1 }; p.equipment.tool1 = 1; }
  town.map().at(20, 20).trees = 1;
  expect(town.orderChop([p.id], 20 * 32 + 20)).toBe(true);
  for (let i = 0; i < 1000 && (p.moving() || p.until > town.clock() + 100); i++) town.advance(step);
  expect(p.activity).toBe(Activity.Felling);
  const started = p.until - harvestDuration(p),
    events: TreeWorkEvent[] = [];
  let heard = 0n;
  for (let i = 0; i < 1000 && !events.some((e) => e.kind === TreeWorkKind.Fall); i++) {
    town.advance(step);
    for (const event of town.treeEvents())
      if (event.serial >= heard) {
        heard = event.serial + 1n;
        events.push(event);
      }
  }
  return { events: events.map((e) => ({ ...e, at: e.at - started })), p };
}

describe('work contacts use one simulation timeline', () => {
  for (const step of [0.1, 0.037])
    it(`fells the tree on the final iron axe contact at tier-three efficiency, step ${step}`, () => {
      const { events, p } = harvest(step),
        chops = events.filter((e) => e.kind === TreeWorkKind.Chop),
        fall = events.find((e) => e.kind === TreeWorkKind.Fall)!;
      const duration = 15 / 1.75;
      expect(chops).toHaveLength(10);
      chops.forEach((chop, index) => expect(chop.at).toBeCloseTo(0.6 + index * (duration - 0.6) / 9, 8));
      expect(fall.at).toBeCloseTo(duration, 8);
      expect(chops.at(-1)!.at).toBeCloseTo(fall.at, 8);
      expect(p.carrying).toBe(3);
    });
  it('keeps barehand contacts on the same timeline until the slower fifteen-second harvest completes', () => {
    const { events, p } = harvest(.1, false),
      contacts = events.filter(e => e.kind === TreeWorkKind.Chop),
      fall = events.find(e => e.kind === TreeWorkKind.Fall)!;
    expect(contacts.map(e => Number(e.at.toFixed(6)))).toEqual(Array.from({length: 17}, (_,i) => Number((.6 + i * .9).toFixed(6))));
    expect(fall.at).toBeCloseTo(15,8);expect(contacts.at(-1)!.at).toBeCloseTo(fall.at,8);expect(p.carrying).toBe(3);
  });
  it('breaks a boulder at three pick contacts and keeps the broken face for the next miner', () => {
    const { town, p } = fixture(), map = town.map();
    let cell = -1;
    for (let y = 16; y < 22 && cell < 0; ++y) for (let x = 18; x < 25 && cell < 0; ++x) {
      map.at(x, y).terrain = Terrain.Rock;
      if (deposit(map, x, y)) cell = y * map.width() + x;
    }
    expect(cell).toBeGreaterThanOrEqual(0);
    const tile = map.tiles[cell];
    ++town.changes;
    expect(town.orderMine([p.id], cell)).toBe(true);
    const fractures = new Map<bigint, TreeWorkEvent>();
    for (let i = 0; i < 1000 && (tile.miningStage ?? 0) < 2; ++i) {
      town.advance(.05);
      for (const hit of town.treeEvents()) if (hit.stoneStage) fractures.set(hit.serial, hit);
    }
    expect([...fractures.values()].map(hit => [hit.kind, hit.index, hit.stoneStage])).toEqual([
      [TreeWorkKind.Mine, 0, 1], [TreeWorkKind.Mine, 0, 2],
    ]);
    const legacy = copyNative(town);
    legacy.map().setMiningStage(cell, 0);
    const restore = (t: Town) => decodeTown(encodeTown(t), world => new Town(world, 32, false, true));
    expect(encodeTownPayload(legacy)[0]).toBeLessThan(31);
    expect(restore(legacy).map().tiles[cell].miningStage).toBe(2);
    expect(p.carrying).toBe(0);
    town.orderStop([p.id]);
    town.advance(1);
    expect(tile.miningStage).toBe(2);
    expect(encodeTownPayload(town)[0]).toBe(31);
    const loaded = restore(town);
    const restored = loaded.map().tiles[cell];
    expect(restored.miningStage).toBe(2);
    const relief = loaded.makePerson(Role.Resident, Calling.Settler, { ...p.position });
    relief.home = relief.village = p.village;
    relief.inventory[0] = { item: 'pickaxe', quantity: 1 };
    relief.equipment.tool1 = 1;
    loaded.folk.push(relief);
    expect(loaded.orderMine([relief.id], cell)).toBe(true);
    for (let i = 0; i < 500 && relief.moving(); ++i) loaded.advance(.05);
    const remaining = relief.until - loaded.time;
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(harvestDuration(relief, true) / 2);
    const contacts: TreeWorkEvent[] = [];
    const seen = new Set<bigint>();
    for (let i = 0; i < 500 && !restored.quarried; ++i) {
      loaded.advance(.05);
      for (const hit of loaded.treeEvents()) if (hit.person === relief.id && !seen.has(hit.serial)) {
        contacts.push(hit);
        seen.add(hit.serial);
      }
    }
    expect(contacts.filter(hit => hit.stoneStage).map(hit => hit.stoneStage)).toEqual([3]);
    expect(contacts.filter(hit => hit.kind === TreeWorkKind.Shatter)).toHaveLength(1);
    expect(restored.miningStage).toBeUndefined();
    expect(relief.carrying).toBe(3);
    expect(encodeTownPayload(loaded)[0]).toBeLessThan(31);
  });
  it('emits hammer contacts only while a worker actually advances construction', () => {
    const { town, p } = fixture(),
      site = new Building(town.nextId++, Structure.Storehouse, point(20, 18), 0, 0);
    site.progress = 0;
    site.village = 0;
    town.placed.push(site);
    town.changes++;
    expect(town.orderBuild([p.id], site.id)).toBe(true);
    const events: TreeWorkEvent[] = [];
    let heard = 0n;
    for (let i = 0; i < 900 && site.progress < 0.92; i++) {
      town.advance(0.1);
      for (const event of town.treeEvents())
        if (event.serial >= heard) {
          heard = event.serial + 1n;
          events.push(event);
        }
    }
    const strikes = events.filter((e) => e.kind === TreeWorkKind.Hammer);
    expect(strikes.length).toBeGreaterThan(2);
    expect(new Set(strikes.map(hit => JSON.stringify(hit.worker))).size).toBeGreaterThanOrEqual(3);
    for (const strike of strikes) {
      expect(strike.wall).toEqual(site.center);
      expect(town.grid.walkable(strike.worker)).toBe(true);
      const phase = (workElapsed(strike.at, p.id) - hammerTiming.impact) / hammerTiming.period;
      expect(phase).toBeCloseTo(Math.round(phase), 8);
    }
    expect(site.progress).toBeGreaterThanOrEqual(0.92);
    expect(p).toMatchObject({ level: 1, experience: 0 });
    town.orderMove([p.id], point(25, 18));
    const serial = town.nextTreeEvent;
    town.advance(0.5);
    expect(town.treeEvents().filter((e) => e.serial >= serial && e.kind === TreeWorkKind.Hammer)).toEqual([]);
  });
});
