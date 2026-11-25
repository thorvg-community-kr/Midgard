// What a piece of work is worth to the settlement, as one number, so that different kinds can be compared.
//
//   efficiency = gain of one round / (walk to the work + time working + walk to where the gain is delivered)
//
// Walks are timed along the real route at the pace of the ground under each stretch (open ground, forest, road,
// paved road); the walk back is slowed by the load the round adds to the pack. Working time is the resident's own:
// their tool decides the rate, their pack how much one round holds. The gain is counted in the seconds the same
// work takes with bare hands, so a felled tree, a wall raised and a stretch of road stand on one scale; a good is
// weighed by how short the settlement is of it.
//
// The same times answer what a change to the map is worth: `roadWorth` and `dropWorth` take the rounds that
// recur (who walks from where to where, how often a day) and give the seconds a day a new road or a nearer
// drop-off would save, against the work to make it.
import { Product, type Structure, buildWork } from './building-catalog';
import { carriedWeight, carryLimit, paceUnder } from './carried-resources';
import {
  attackDamage,
  bareHandsRate,
  harvestSeconds,
  huntItem,
  productItem,
  roadWorkKinds,
  taskEfficiency,
  workEfficiency,
} from './equipment';
import { closestOnSegment, distance, lerp, type Point } from './geometry';
import type { Person } from './person';
import { walkSpeed } from './walk-paths';
import { canHarvest, harvestAmount } from './harvest-material';
import { collectSeconds, harvestDuration, roadWorkRate } from './work-timing';

/** The part of the walking grid the timing reads. */
export interface WalkGround {
  path(from: Point, to: Point): Point[];
  speedAt(p: Point): number;
  /** The walkable point nearest `p`; rock and walls are worked from beside them. */
  nearestWalkable?(p: Point): Point;
}
/** The part of the town the system reads; routes are kept until the road network changes. */
export interface EfficiencySource {
  readonly grid: WalkGround;
  roadRevision(): bigint;
  clock(): number;
}
/** One round of work: go there, work, and bring the gain to where it counts. */
export interface WorkRound {
  /** Where the work is done. */
  at: Point;
  /** Seconds of work in the round at this resident's rate. */
  seconds: number;
  /** What the round gives, in seconds of the same work with bare hands. */
  gain: number;
  /** Where the gain is delivered; absent when the work itself is the gain. */
  bank?: Point;
  /** Kilograms the round adds to the pack for the walk to the bank. */
  load?: number;
}
/** A walk that recurs: `perDay` times a day from one point to another, at `pace` of an unladen walk. */
export interface Trip {
  from: Point;
  to: Point;
  perDay: number;
  pace?: number;
}
/** What a change to the map is worth: seconds of walking saved a day against the seconds of work to make it. */
export interface Worth {
  saved: number;
  cost: number;
  pays: boolean;
}

/** Seconds of bare-handed work one unit of a gathered good stands for. */
export const goodSeconds = harvestSeconds(bareHandsRate) / harvestAmount(Product.Wood);
const sample = 0.25;

export class WorkEfficiency {
  /** A change to the map pays when its work is won back within this many days: a road is laid once and stays. */
  static readonly paybackDays = 30;
  /** Routes searched afresh in one step; further ones are timed along the straight line until a later step. */
  static readonly searchesPerStep = 12;
  /** Game seconds a timed route is kept while the roads stay as they are; felled trees open ground slowly. */
  static readonly keepSeconds = 120;
  private routes = new Map<number, { seconds: number; at: number }>();
  private revision = -1n;
  private searches = 0;
  /** Routes searched since the system was made, for the cost reports. */
  searched = 0;
  constructor(private readonly source: EfficiencySource) {}
  /** Opens a decision step: the search budget is fresh, and routes are forgotten when the roads changed. */
  beginStep(): void {
    this.searches = 0;
    const revision = this.source.roadRevision();
    if (revision !== this.revision) {
      this.revision = revision;
      this.routes.clear();
    }
  }
  /** Seconds to walk the line from `a` to `b` at the pace of the ground under it, ignoring what stands in the way. */
  straightSeconds(a: Point, b: Point, least = 0): number {
    const span = distance(a, b),
      steps = Math.max(1, Math.ceil(span / sample)),
      grid = this.source.grid;
    let seconds = 0;
    for (let i = 0; i < steps; ++i)
      seconds += span / steps / Math.max(least, grid.speedAt(lerp(a, b, (i + 0.5) / steps)));
    return seconds;
  }
  private lineSeconds(line: readonly Point[], least = 0): number {
    let seconds = 0;
    for (let i = 1; i < line.length; ++i) seconds += this.straightSeconds(line[i - 1], line[i], least);
    return seconds;
  }
  /** Seconds an unladen resident walks from `from` to `to` along the real route; Infinity when there is none. */
  walkSeconds(from: Point, to: Point): number {
    if (distance(from, to) < 0.75) return this.straightSeconds(from, to);
    // Routes are kept by the half tiles of their ends: a step aside does not ask for a new search.
    const cell = (p: Point) => Math.floor(p.y * 2) * 4096 + Math.floor(p.x * 2),
      a = cell(from),
      b = cell(to),
      key = Math.min(a, b) * 16777216 + Math.max(a, b),
      now = this.source.clock(),
      known = this.routes.get(key);
    if (known && now - known.at < WorkEfficiency.keepSeconds) return known.seconds;
    if (this.searches >= WorkEfficiency.searchesPerStep)
      return known ? known.seconds : this.straightSeconds(from, to);
    ++this.searches;
    ++this.searched;
    const grid = this.source.grid;
    let path = grid.path(from, to);
    // Work on rock or at a wall is done from the ground beside it.
    if (!path.length && grid.nearestWalkable) {
      const beside = grid.nearestWalkable(to);
      if (distance(beside, to) > 0 && distance(beside, to) < 3)
        path = distance(from, beside) < 0.05 ? [from, beside] : grid.path(from, beside);
    }
    const seconds = path.length ? this.lineSeconds(path) : Infinity;
    if (this.routes.size > 4000) this.routes.clear();
    this.routes.set(key, { seconds, at: now });
    return seconds;
  }
  /** The share of their walking speed a resident keeps with `load` more kilograms in the pack. */
  loadedPace(person: Person, load: number): number {
    return paceUnder(person, carriedWeight(person) + load);
  }
  /** Seconds one round takes this resident from where they stand. */
  roundSeconds(person: Person, round: WorkRound): number {
    const back = round.bank
      ? this.walkSeconds(round.at, round.bank) / this.loadedPace(person, round.load ?? 0)
      : 0;
    return this.walkSeconds(person.position, round.at) + round.seconds + back;
  }
  /** What the settlement gains a second while this resident does this round; 0 when the work cannot be reached. */
  efficiency(person: Person, round: WorkRound): number {
    const seconds = this.roundSeconds(person, round);
    return Number.isFinite(seconds) && seconds > 0 ? round.gain / seconds : 0;
  }
  /** Felling or breaking stone until the pack is full, then the walk to the store. `need` weighs the good: 1 as
   * wanted as any, 0 not wanted. `product` is what the source gives: each material has its own yield, and one
   * the resident has no tool for is worth nothing. */
  gathering(
    person: Person,
    source: Point,
    bank: Point,
    stone: boolean,
    need = 1,
    product = stone ? Product.Stone : Product.Wood,
  ): WorkRound {
    const weight = productItem(product)?.weight ?? 1,
      amount = harvestAmount(product),
      room = Math.max(0, carryLimit(person) - carriedWeight(person)),
      // The pack is due at the store once a load no longer fits under the limit.
      loads = Math.floor(room / (amount * weight)) + 1,
      units = loads * amount;
    if (!canHarvest(person, product)) need = 0;
    return {
      at: source,
      bank,
      seconds: loads * (harvestDuration(person, stone) + collectSeconds(stone)),
      gain: units * goodSeconds * need,
      load: units * weight,
    };
  }
  /** Raising what is left of a building; `fetch` is the seconds of carrying its missing materials still take. */
  building(person: Person, kind: Structure, at: Point, left = 1, fetch = 0): WorkRound {
    const work = buildWork(kind) * left;
    return { at, seconds: work / workEfficiency(person, 'construction') + fetch, gain: work / bareHandsRate };
  }
  /** Laying what is left of a road of `length`. */
  roadwork(person: Person, at: Point, length: number, left = 1): WorkRound {
    const work = (Math.max(1, length) * left) / roadWorkRate.laying;
    // On a road a shovel serves as well as a hammer.
    return {
      at,
      seconds: work / taskEfficiency(person, roadWorkKinds),
      gain: work / bareHandsRate,
    };
  }
  /** A kill brought to the pantry: `health` and `food` are the animal's. */
  hunting(person: Person, prey: Point, bank: Point, health: number, food: number, need = 1): WorkRound {
    const dressed = Math.round(food * (1 + (huntItem(person)?.huntBonus ?? 0)));
    // About a blow a second.
    return {
      at: prey,
      bank,
      seconds: Math.ceil(health / attackDamage(person)),
      gain: dressed * goodSeconds * need,
      load: dressed,
    };
  }
  /** Seconds to walk a trip by way of a road along `line`, entering and leaving it at its nearest points. */
  private viaRoad(trip: Trip, line: readonly Point[]): number {
    const nearest = (p: Point) => {
      let best = { at: line[0], along: 0, gap: Infinity },
        walked = 0;
      for (let i = 1; i < line.length; ++i) {
        const q = closestOnSegment(p, line[i - 1], line[i]),
          gap = distance(p, q);
        if (gap < best.gap) best = { at: q, along: walked + distance(line[i - 1], q), gap };
        walked += distance(line[i - 1], line[i]);
      }
      return best;
    };
    const on = nearest(trip.from),
      off = nearest(trip.to),
      first = Math.min(on.along, off.along),
      last = Math.max(on.along, off.along);
    if (last - first < 0.5) return Infinity;
    // The stretch between the two points, at a laid road's pace or the ground's own where that is faster.
    let seconds = this.straightSeconds(trip.from, on.at) + this.straightSeconds(off.at, trip.to),
      walked = 0;
    for (let i = 1; i < line.length; ++i) {
      const leg = distance(line[i - 1], line[i]),
        from = Math.max(first, walked),
        to = Math.min(last, walked + leg);
      if (to > from && leg > 0)
        seconds += this.straightSeconds(
          lerp(line[i - 1], line[i], (from - walked) / leg),
          lerp(line[i - 1], line[i], (to - walked) / leg),
          walkSpeed.road,
        );
      walked += leg;
    }
    return seconds;
  }
  /** What a road along `line` is worth to the trips that recur, laid by hands working at `rate`. `clearing` is
   * the seconds of other work the ground asks first, such as felling the trees that stand on it. */
  roadWorth(trips: readonly Trip[], line: readonly Point[], rate = bareHandsRate, clearing = 0): Worth {
    let length = 0,
      saved = 0;
    for (let i = 1; i < line.length; ++i) length += distance(line[i - 1], line[i]);
    if (line.length >= 2)
      for (const trip of trips) {
        const now = this.walkSeconds(trip.from, trip.to),
          gain = now - this.viaRoad(trip, line);
        if (Number.isFinite(now) && gain > 0) saved += (trip.perDay * gain) / (trip.pace ?? 1);
      }
    const cost = Math.max(1, length) / (roadWorkRate.laying * rate) + clearing;
    return { saved, cost, pays: saved * WorkEfficiency.paybackDays >= cost };
  }
  /** What a drop-off at `at` is worth: each trip ends at the new place when that is the shorter walk. `cost` is
   * the work to make it, in seconds. The walks are timed along the straight line, so many plots can be compared. */
  dropWorth(trips: readonly Trip[], at: Point, cost = 0): Worth {
    let saved = 0;
    for (const trip of trips) {
      const gain = this.straightSeconds(trip.from, trip.to) - this.straightSeconds(trip.from, at);
      if (gain > 0) saved += (trip.perDay * gain) / (trip.pace ?? 1);
    }
    return { saved, cost, pays: saved * WorkEfficiency.paybackDays >= cost };
  }
}
