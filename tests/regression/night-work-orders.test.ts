import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, DungeonKind } from '../../packages/engine/src/world-types';
import { Structure, Resources } from '../../packages/engine/src/building-catalog';
import { Activity, Calling, Person, Race, Role, Monster } from '../../packages/engine/src/person';
import { Building, Field } from '../../packages/engine/src/town-models';
import { point, add } from '../../packages/engine/src/geometry';
import { copyNative } from '../../packages/engine/src/native-copy';
import { enter } from '../../packages/engine/src/town-residents';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';
import { issueOrder, type GameCommandApp } from '../../apps/web/src/native/game-commands';
import { Order } from '../../packages/engine/src/game-tools';
import { presentedHit } from './fixtures/presented-hit';

let base: Town;
beforeAll(() => {
  const map = WorldMap.generate(5, 64, 64);
  map.ymir = map.fire = null;
  map.stream = { path: [], width: [] };
  map.sites = [{ name: 'Test cave', kind: DungeonKind.Cave, origin: point(58, 58), discovered: false }];
  for (const layer of map.layers) layer.fill(0.4);
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  for (let y = 0; y < 64; ++y)
    for (let x = 0; x < 64; ++x)
      Object.assign(map.at(x, y), { terrain: Terrain.Grass, trees: 0, dungeon: -1 });
  map.reveal(32, 32, 100);
  base = new Town(map, 64, false);
  const home = new Building(0, Structure.Camp, point(30, 30), 0, 0);
  base.placed = [home];
  base.nextId = 1;
  base.migrateSettlements();
  Object.assign(base.stock(), new Resources(100, 100, 100, 100, 100, 100));
  const p = new Person(0, 'Night worker', Role.Resident, Calling.Settler, Race.Human, 5, home.door());
  p.home = p.village = 0;
  p.food = p.rest = p.hydration = p.health = 1;
  p.stress = 0;
  base.folk = [p];
  base.nextPerson = 1;
  base.wildlifeDay = base.days;
  base.editHour(20);
  base.tick(0);
});
function fixture(kind = Structure.Well, asleep = false) {
  const town = copyNative(base),
    p = town.people()[0],
    job = new Building(town.nextId++, kind, point(35, 34), 0, 0);
  job.village = 0;
  town.placed.push(job);
  if (kind === Structure.Farm)
    town.farmland.push(
      new Field(town.nextId++, [point(37, 34), point(40, 34), point(40, 37), point(37, 37)], 0),
    );
  ++town.changes;
  if (asleep) {
    const home = town.camp()!;
    p.activity = Activity.Sleeping;
    p.target = home.id;
    p.position = home.door();
    enter(p, home.threshold());
    p.doorway = 1;
    p.position = home.threshold();
  } else {
    p.inside = false;
    p.doorway = 0;
    p.path = [];
    p.activity = Activity.Idle;
  }
  p.rest = 0.9;
  p.recoveringRest = p.recoveringHealth = false;
  expect(town.climate().night).toBeGreaterThan(0.5);
  return { town, p, job };
}
type Fixture = ReturnType<typeof fixture>;
function snapshot({ town, p, job }: Fixture) {
  return {
    time: town.clock(),
    night: town.climate().night,
    activity: Activity[p.activity],
    task: Activity[p.task],
    ordered: p.ordered,
    taskSite: p.taskSite,
    target: p.target,
    job: p.job,
    inside: p.inside,
    doorway: p.doorway,
    position: { ...p.position },
    path: p.path.map((at) => ({ ...at })),
    rest: p.rest,
    health: p.health,
    stress: p.stress,
    recoveringRest: p.recoveringRest,
    recoveringHealth: p.recoveringHealth,
    work: job.workedSeconds,
  };
}
function advance(v: Fixture, seconds: number) {
  const trace: ReturnType<typeof snapshot>[] = [];
  let previous = '';
  for (let i = 0; i < seconds * 10; ++i) {
    v.town.wildlifeDay = v.town.days;
    v.town.advance(0.1);
    const state = snapshot(v),
      key = `${state.activity}:${state.ordered}:${state.taskSite}:${state.inside}`;
    if (key !== previous) {
      trace.push(state);
      previous = key;
    }
  }
  return trace;
}
function rightClickJob(v: Fixture) {
  const app = {
    town: v.town,
    chosen: [v.p.id],
    mouse: point(),
    cursor: v.job.door(),
    hoveredWorldTarget: { screen: point(), hit: presentedHit('building', v.job.id) },
    context: { controlAt: () => false },
    cue() {},
  } as unknown as GameCommandApp;
  issueOrder.call(app, Order.Work);
  expect(v.p.job).toBe(v.job.id);
  expect(v.p.ordered).toBe(true);
}
function working(v: Fixture) {
  rightClickJob(v);
  for (let i = 0; i < 200 && v.job.workedSeconds < 0.2; ++i) advance(v, 0.1);
  expect(v.job.workedSeconds, JSON.stringify(snapshot(v))).toBeGreaterThan(0.1);
}

describe('work and recovery after dark', () => {
  it.each([0.1, 0.3, 0.49])('honors a single command independently of scheduler phase (%s)', (offset) => {
    const v = fixture(Structure.Well, true);
    v.p.scheduleAt = v.town.clock() + offset;
    rightClickJob(v);
    const trace = advance(v, 20),
      diagnostic = JSON.stringify({ trace, final: snapshot(v) });
    expect(
      trace.some((s) => s.activity === 'Sleeping'),
      diagnostic,
    ).toBe(false);
    expect(v.job.workedSeconds, diagnostic).toBeGreaterThan(3);
    expect(v.p.ordered).toBe(true);
  });
  for (const kind of [Structure.Well, Structure.Sawmill, Structure.Farm])
    for (const asleep of [false, true])
      it(`${Structure[kind]} starts and continues from ${asleep ? 'inside automatic sleep' : 'outdoor Auto'} after one right click`, () => {
        const v = fixture(kind, asleep);
        rightClickJob(v);
        const trace = advance(v, 20),
          diagnostic = JSON.stringify({ trace, final: snapshot(v) });
        expect(
          trace.some((s) => s.activity === 'Sleeping'),
          diagnostic,
        ).toBe(false);
        expect(v.job.workedSeconds, diagnostic).toBeGreaterThan(3);
        expect(v.p.task, diagnostic).toBe(Activity.Working);
        expect(v.p.taskSite).toBe(v.job.id);
        expect(v.p.ordered, diagnostic).toBe(true);
        expect(v.town.climate().night).toBeGreaterThan(0.5);
      });
  it('works an ordinary automatic assignment after dark while fit', () => {
    const v = fixture();
    v.p.job = v.job.id;
    v.p.task = Activity.Working;
    v.p.taskSite = v.job.id;
    v.p.ordered = false;
    const trace = advance(v, 24);
    expect(v.p.activity, JSON.stringify(trace)).toBe(Activity.Working);
    expect(v.job.workedSeconds).toBeGreaterThan(3);
  });
  it('keeps title-autoplay staffing automatic when moving a worker to an essential workplace', () => {
    const v = fixture(),
      donor = copyNative(v.p),
      lumberyard = new Building(v.town.nextId++, Structure.Lumberyard, point(40, 34), 0, 0);
    lumberyard.village = 0;
    v.town.placed.push(lumberyard);
    donor.id = v.town.nextPerson++;
    donor.job = lumberyard.id;
    donor.task = Activity.Working;
    donor.taskSite = donor.target = lumberyard.id;
    donor.activity = Activity.Working;
    donor.position = lumberyard.door();
    donor.ordered = false;
    v.town.folk.push(donor);
    v.town.titleAutoplay = true;
    v.town.titleBuilder = v.p.id;
    v.town.stock().water = 0;
    v.town.recount();
    v.town.planTitleWork();
    expect(donor.job).toBe(v.job.id);
    expect(donor.ordered).toBe(false);
    expect(donor.autoMode).toBe(true);
  });
  it('treats a new work order from Stop as active work, without requiring Auto to be toggled', () => {
    const v = fixture();
    v.town.orderStop([v.p.id]);
    working(v);
    advance(v, 3);
    expect(v.p.ordered, JSON.stringify(snapshot(v))).toBe(true);
    expect(v.p.autoMode).toBe(true);
  });
  it('saves the explicit workplace priority and resumes it after loading at night', () => {
    const v = fixture();
    working(v);
    const town = decodeTown(encodeTown(v.town), (map) => new Town(map, 64, false, true))!;
    const loaded = { town, p: town.people()[0], job: town.building(v.job.id)! },
      before = loaded.job.workedSeconds;
    advance(loaded, 3);
    expect(loaded.p.ordered, JSON.stringify(snapshot(loaded))).toBe(true);
    expect(loaded.job.workedSeconds).toBeGreaterThan(before + 1);
  });
  for (const need of ['rest', 'health'] as const)
    it(`pauses explicit work for critical ${need}, then resumes the same target even at night`, () => {
      const v = fixture();
      working(v);
      v.p[need] = need === 'rest' ? 0.19 : 0.39;
      advance(v, 1);
      expect(v.p.activity, JSON.stringify(snapshot(v))).toBe(Activity.Sleeping);
      expect(v.p.task).toBe(Activity.Working);
      expect(v.p.taskSite).toBe(v.job.id);
      // A recovered care checkpoint must not turn the rest of the night into
      // an unrelated sleep command or forget the user's workplace target.
      v.p.rest = 0.96;
      v.p.health = 1;
      const before = v.job.workedSeconds;
      advance(v, 15);
      expect(v.p.taskSite, JSON.stringify(snapshot(v))).toBe(v.job.id);
      expect(v.p.ordered).toBe(true);
      expect(v.job.workedSeconds).toBeGreaterThan(before + 1);
    });
  it('lets combat interrupt a workplace order and restores that target afterwards', () => {
    const v = fixture();
    working(v);
    const foe = new Monster(900, 0, add(v.p.position, point(0.8, 0)));
    foe.raider = true;
    foe.health = 100;
    foe.ready = v.p.ready = Infinity;
    v.town.beasts.push(foe);
    advance(v, 0.3);
    expect(v.p.activity).toBe(Activity.Fighting);
    expect(v.p.taskSite).toBe(v.job.id);
    foe.health = 0;
    const before = v.job.workedSeconds;
    advance(v, 3);
    expect(v.p.ordered, JSON.stringify(snapshot(v))).toBe(true);
    expect(v.job.workedSeconds).toBeGreaterThan(before);
  });
  it('accepts a new Move and an explicit return to Auto instead of resurrecting a work order', () => {
    const v = fixture();
    working(v);
    v.town.orderMove([v.p.id], point(45, 45));
    advance(v, 0.5);
    expect(v.p.task).toBe(Activity.Moving);
    v.town.orderAutomatic([v.p.id]);
    advance(v, 1);
    expect(v.p.ordered).toBe(false);
    expect(v.p.activity).not.toBe(Activity.Sleeping);
  });
  for (const need of ['food', 'hydration'] as const)
    it(`temporarily satisfies critical ${need} without forgetting the direct workplace`, () => {
      const v = fixture();
      working(v);
      v.p[need] = 0.04;
      advance(v, 1);
      expect(v.p.activity).toBe(need === 'food' ? Activity.Eating : Activity.Drinking);
      expect(v.p.taskSite).toBe(v.job.id);
      expect(v.p.ordered).toBe(true);
      const before = v.job.workedSeconds;
      advance(v, 20);
      expect(v.p[need], JSON.stringify(snapshot(v))).toBeGreaterThan(0.9);
      expect(v.p.ordered).toBe(true);
      expect(v.job.workedSeconds).toBeGreaterThan(before + 1);
    });
  it('pauses an exhausted worker and preserves the ordered workplace', () => {
    const v = fixture();
    working(v);
    v.p.stress = 0.86;
    advance(v, 0.2);
    expect(v.p.stressRecovery).toBe(true);
    expect(v.p.ordered).toBe(true);
    expect(v.p.task).toBe(Activity.Working);
    expect(v.p.taskSite).toBe(v.job.id);
  });
  it('releases a destroyed workplace and lets a fit resident choose other work after dark', () => {
    const v = fixture();
    working(v);
    v.town.placed = v.town.placed.filter((b) => b.id !== v.job.id);
    ++v.town.changes;
    advance(v, 2);
    expect(v.p.taskSite).toBe(-1);
    expect(v.p.ordered).toBe(false);
    expect(v.p.activity).not.toBe(Activity.Sleeping);
  });
  it('honors Stop after direct work without reassigning the old workplace', () => {
    const v = fixture();
    working(v);
    v.town.orderStop([v.p.id]);
    const before = v.job.workedSeconds;
    advance(v, 3);
    expect(v.p.activity).toBe(Activity.Holding);
    expect(v.p.task).toBe(Activity.Idle);
    expect(v.p.job).toBe(-1);
    expect(v.p.ordered).toBe(false);
    expect(v.job.workedSeconds).toBe(before);
  });
});

describe('waking the settlement', () => {
  function asleepPair() {
    const v = fixture(Structure.Well, true),
      home = v.town.camp()!,
      other = new Person(1, 'Second sleeper', Role.Resident, Calling.Settler, Race.Human, 6, home.door());
    other.home = other.village = 0;
    other.food = other.rest = other.hydration = other.health = 1;
    other.stress = 0;
    other.activity = Activity.Sleeping;
    other.target = home.id;
    enter(other, home.threshold());
    other.doorway = 1;
    other.position = home.threshold();
    v.town.folk.push(other);
    v.town.nextPerson = 2;
    return { ...v, other, home };
  }
  const night = (town: Town) => town.climate().night > 0.5;
  it('lists who is abed and brings every one of them out with one order', () => {
    const v = asleepPair();
    expect(v.town.abed()).toEqual([0, 1]);
    expect(v.town.wakeAll()).toBe(2);
    advance(v, 8);
    expect(v.p.inside).toBe(false);
    expect(v.other.inside).toBe(false);
    expect(v.town.abed()).toEqual([]);
    expect(v.town.wakeAll()).toBe(0);
  });
  it('leaves alone a resident at work indoors and one the player cannot command', () => {
    const v = asleepPair();
    v.p.activity = Activity.Working;
    v.other.stressRecovery = true;
    expect(v.town.abed()).toEqual([]);
    expect(v.town.wakeAll()).toBe(0);
    expect(v.other.inside).toBe(true);
  });
  it('honors waking for a short interval and lets a tired resident rest again the same night', () => {
    const v = asleepPair();
    v.town.wakeAll();
    v.p.rest = 0.18;
    advance(v, 4);
    expect(v.p.inside).toBe(false);
    expect(v.p.activity).not.toBe(Activity.Sleeping);
    advance(v, 23);
    expect(night(v.town)).toBe(true);
    expect(v.p.activity).toBe(Activity.Sleeping);
    expect(v.p.inside).toBe(true);
    expect(v.other.inside).toBe(false);
  });
  it('keeps up a sleeper taken out of bed by an ordinary move order', () => {
    const v = fixture(Structure.Well, true);
    v.town.orderMove([v.p.id], point(32, 33));
    const trace = advance(v, 40);
    expect(v.p.inside, JSON.stringify(trace)).toBe(false);
    expect(v.p.activity, JSON.stringify(trace)).not.toBe(Activity.Sleeping);
    expect(v.p.ordered).toBe(false);
  });
  it('lets the player send a woken resident back to bed', () => {
    const v = fixture(Structure.Well, true),
      home = v.town.camp()!;
    v.town.wakeAll();
    advance(v, 8);
    expect(v.p.inside).toBe(false);
    v.p.rest = 0.35;
    expect(v.town.orderRest([v.p.id], home.id)).toBe(true);
    advance(v, 20);
    expect(v.p.inside, JSON.stringify(snapshot(v))).toBe(true);
    expect(v.p.activity).toBe(Activity.Sleeping);
  });
  it('keeps a fit resident active after loading at night', () => {
    const v = fixture(Structure.Well, true);
    v.town.wakeAll();
    advance(v, 8);
    const loaded = decodeTown(encodeTown(v.town), (map) => new Town(map, 64, false)),
      p = loaded.people()[0];
    for (let i = 0; i < 300; ++i) {
      loaded.wildlifeDay = loaded.days;
      loaded.advance(0.1);
    }
    expect(p.activity).not.toBe(Activity.Sleeping);
    expect(p.inside).toBe(false);
  });
  it('sends nobody to bed while a raid is on, and to bed again when it is over', () => {
    const v = fixture(),
      raider = new Monster(900, 0, point(50, 50));
    raider.raider = true;
    raider.health = 1000;
    v.town.beasts.push(raider);
    v.p.position = point(33, 31);
    v.p.rest = 0.18;
    for (let i = 0; i < 100; ++i) {
      v.town.wildlifeDay = v.town.days;
      v.town.advance(0.1);
      raider.position = point(50, 50);
      raider.path = [];
      expect(v.p.activity).not.toBe(Activity.Sleeping);
    }
    expect(v.p.inside).toBe(false);
    v.town.beasts = [];
    advance(v, 30);
    expect(v.p.inside, JSON.stringify(snapshot(v))).toBe(true);
    expect(v.p.activity).toBe(Activity.Sleeping);
  });
});
