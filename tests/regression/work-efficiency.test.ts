import { describe, expect, it } from 'vitest';
import { Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { Product } from '../../packages/engine/src/building-catalog';
import { addInventory } from '../../packages/engine/src/equipment';
import { point, type Point } from '../../packages/engine/src/geometry';
import { WorkEfficiency, type Trip } from '../../packages/engine/src/work-efficiency';

// A strip of ground one tile a second everywhere, with a road (2.1 tiles a second, as laid roads are) where `road` says; every
// route is the straight line, so each number below can be worked out by hand.
function ground(road: (p: Point) => boolean = () => false, reachable = true) {
  return new WorkEfficiency({
    grid: { path: (from, to) => (reachable ? [from, to] : []), speedAt: (p) => (road(p) ? 2.1 : 1) },
    roadRevision: () => 1n,
    clock: () => 0,
  });
}
const resident = (at = point(0, 0.5)) =>
  new Person(1, 'Hild', Role.Resident, Calling.Settler, Race.Human, 0, at);
const camp = point(0, 0.5);

describe('the work-efficiency system', () => {
  it('rates a round of felling by what it banks over the walk, the work and the carry home', () => {
    const system = ground(),
      p = resident(),
      round = system.gathering(p, point(10, 0.5), camp, false);
    // Bare hands fell a tree in 15 s and pick it up in 0.8 s; eleven trees fill a 30 kg pack past its limit.
    expect(round.seconds).toBeCloseTo(173.8, 3);
    expect(round.load).toBe(33);
    // 33 units at 5 s of bare-handed work each; 10 s out, 173.8 s of work, 10 s / 0.6 home under the full pack.
    expect(round.gain).toBeCloseTo(165, 6);
    expect(system.roundSeconds(p, round)).toBeCloseTo(200.467, 2);
    expect(system.efficiency(p, round)).toBeCloseTo(0.8231, 3);
  });
  it('rates the same work lower the longer the walk', () => {
    const system = ground(),
      p = resident();
    expect(system.efficiency(p, system.gathering(p, point(20, 0.5), camp, false))).toBeCloseTo(0.7265, 3);
  });
  it('rates it higher with a road on the route', () => {
    const system = ground((at) => at.x < 10),
      p = resident();
    // 10 / 2.1 s out and that / 0.6 home.
    expect(system.efficiency(p, system.gathering(p, point(10, 0.5), camp, false))).toBeCloseTo(0.8847, 3);
  });
  it('rates it higher with a better tool', () => {
    const system = ground(),
      p = resident();
    addInventory(p, 'wooden-axe');
    const round = system.gathering(p, point(10, 0.5), camp, false);
    // Ten trees with a wooden axe take twelve seconds each, plus collection.
    expect(round.seconds).toBeCloseTo(128, 2);
    expect(system.efficiency(p, round)).toBeCloseTo(150 / (128 + 10 + 10 / 0.6), 3);
  });
  it('weighs a good by how much it is wanted', () => {
    const system = ground(),
      p = resident();
    expect(system.efficiency(p, system.gathering(p, point(10, 0.5), camp, true, 0.25))).toBeCloseTo(
      system.efficiency(p, system.gathering(p, point(10, 0.5), camp, true)) / 4,
      6,
    );
    expect(system.efficiency(p, system.gathering(p, point(10, 0.5), camp, false, 0))).toBe(0);
  });
  it('counts each material by its own yield, and nothing for one the resident has no tool for', () => {
    const system = ground(),
      p = resident();
    // Cinder ore comes two to a load: sixteen loads fill the pack, 32 units.
    expect(system.gathering(p, point(10, 0.5), camp, true, 1, Product.CinderOre).load).toBe(32);
    expect(system.gathering(p, point(10, 0.5), camp, true, 1, Product.CinderOre).gain).toBe(0);
    expect(system.gathering(p, point(10, 0.5), camp, true, 1, Product.Stone).gain).toBeCloseTo(165, 6);
  });
  it('slows the walk home under a full pack, and less with a pack basket', () => {
    const system = ground(),
      p = resident();
    expect(system.loadedPace(p, 0)).toBe(1);
    expect(system.loadedPace(p, 22.5)).toBeCloseTo(0.8, 6);
    expect(system.loadedPace(p, 30)).toBeCloseTo(0.6, 6);
    addInventory(p, 'pack-basket');
    p.equipment.accessory = 1;
    expect(system.loadedPace(p, 30)).toBeCloseTo(0.987, 3);
  });
  it('puts road work on the same scale, and work that cannot be reached at nothing', () => {
    const p = resident();
    // Ten tiles of road are 78.125 s of bare-handed work: worth exactly 1 on the spot, less after a 10 s walk.
    expect(ground().efficiency(p, ground().roadwork(p, camp, 10))).toBeCloseTo(1, 6);
    expect(ground().efficiency(p, ground().roadwork(p, point(10, 0.5), 10))).toBeCloseTo(0.8865, 3);
    expect(ground(() => false, false).efficiency(p, ground().roadwork(p, point(10, 0.5), 10))).toBe(0);
  });
  it('finds a road worth laying on a busy route and not on one walked once in a while', () => {
    const system = ground(),
      wood = point(10, 0.5),
      line = [camp, wood],
      busy: Trip[] = [
        { from: camp, to: wood, perDay: 6 },
        { from: wood, to: camp, perDay: 6, pace: 0.6 },
      ],
      worth = system.roadWorth(busy, line);
    // A walk of 10 s becomes 10 / 2.1 s: 5.238 s saved, 6 times out and 6 times home at 0.6 of the pace.
    expect(worth.saved).toBeCloseTo(83.81, 1);
    // Ten tiles at 0.32 a second of work, with bare hands at 0.4.
    expect(worth.cost).toBeCloseTo(78.125, 3);
    expect(worth.pays).toBe(true);
    // Once in four days: 1.31 s a day never wins back 78 s of work in thirty days.
    const once = system.roadWorth([{ from: camp, to: wood, perDay: 0.25 }], line);
    expect(once.saved).toBeCloseTo(1.31, 2);
    expect(once.pays).toBe(false);
    // A road already there saves nothing more.
    expect(ground((at) => at.x < 10).roadWorth(busy, line).saved).toBeCloseTo(0, 6);
  });
  it('counts what a nearer drop-off saves the rounds that carry to it', () => {
    const system = ground(),
      carry: Trip[] = [{ from: point(10, 0.5), to: camp, perDay: 4 }];
    expect(system.dropWorth(carry, point(6, 0.5)).saved).toBeCloseTo(24, 6);
    expect(system.dropWorth(carry, point(-3, 0.5)).saved).toBe(0);
  });
});
