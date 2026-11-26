import { MonsterRank } from './combat-events';
import { add, distance, point, type Point } from './geometry';
import { preyScore } from './monster-ranks';
import { f32 as f } from './numeric';
import type { Monster, Person } from './person';
import type { TownState } from './town-state';

export const contactReach = f(0.7);
// At bite distance there is room for five ordinary bodies around one resident.
const offsets = Array.from({ length: 5 }, (_, i) => {
  const angle = 2 * Math.PI * i / 5;
  return point(0.61 * Math.cos(angle), 0.61 * Math.sin(angle));
});
interface Engagement {
  person: Person;
  slot: number;
  planted: boolean;
}
const claims = new WeakMap<Monster, Engagement>();
const terrain = new WeakMap<Person, { at: Point; revision: bigint; feet: (Point | null)[] }>();
const blocked = new WeakMap<Monster, Map<Person, { until: number; revision: bigint; at: Point }>>();

function attackFeet(town: TownState, person: Person): (Point | null)[] {
  const at = person.position, cached = terrain.get(person);
  if (cached && cached.at.x === at.x && cached.at.y === at.y && cached.revision === town.walkRevision) return cached.feet;
  const feet = offsets.map(offset => {
    const foot = add(at, offset);
    return town.grid.walkable(foot) && town.grid.clear(foot, at, Infinity, true) ? foot : null;
  });
  terrain.set(person, { at: { ...at }, revision: town.walkRevision, feet });
  return feet;
}

export function meleeContact(beast: Monster): Person | undefined {
  const claim = claims.get(beast);
  return claim?.planted ? claim.person : undefined;
}

/** Only living creatures on this tick's roster keep their place. A load reconstructs claims from the field. */
export class MeleeFront {
  private fronts = new Map<Person, (Monster | undefined)[]>();
  constructor(private town: TownState) {
    for (const beast of town.beasts) {
      const claim = claims.get(beast);
      if (claim && beast.health > 0) this.reserve(beast, claim);
    }
  }

  private reserve(beast: Monster, claim: Engagement): void {
    let front = this.fronts.get(claim.person);
    if (!front) {
      front = new Array<Monster | undefined>(offsets.length);
      this.fronts.set(claim.person, front);
    }
    front[claim.slot] = beast;
    claims.set(beast, claim);
  }

  release(beast: Monster): void {
    const claim = claims.get(beast);
    if (!claim) return;
    this.fronts.get(claim.person)![claim.slot] = undefined;
    claims.delete(beast);
  }

  unreachable(beast: Monster, person: Person): void {
    this.release(beast);
    const failures = blocked.get(beast) ?? new Map();
    failures.set(person, { until: this.town.time + 1 + (beast.id % 7) * 0.05,
      revision: this.town.walkRevision, at: { ...person.position } });
    blocked.set(beast, failures);
  }

  pick(beast: Monster, candidates: readonly Person[]): Engagement | undefined {
    const prior = claims.get(beast);
    if (prior && candidates.includes(prior.person) && this.town.grid.sharesLand(beast.position, prior.person.position) &&
      attackFeet(this.town, prior.person)[prior.slot]) {
      // A small change of distance between neighbours must not turn a fighter around.
      // Switch during a chase only if another resident can be fought here and has room.
      const inReach = (p: Person) => distance(beast.position, p.position) <= contactReach;
      const clear = (p: Person) => this.town.grid.clear(beast.position, p.position, Infinity, true);
      if (inReach(prior.person) && clear(prior.person)) return prior;
      if (!candidates.some(p => p !== prior.person && inReach(p) && this.openSlot(beast, p) >= 0 && clear(p))) return prior;
    }
    this.release(beast);
    let chosen: Engagement | undefined, best = Infinity;
    for (const p of candidates) {
      const slot = this.openSlot(beast, p);
      if (slot < 0) continue;
      const foot = attackFeet(this.town, p)[slot]!;
      // Compare actual approaches. A slightly farther open flank beats the far side of a packed target.
      const gap = distance(beast.position, p.position);
      let cost = preyScore(beast, p, candidates, gap) + distance(beast.position, foot) - gap;
      if (candidates.length > 1) {
        if (gap <= contactReach && this.town.grid.clear(beast.position, p.position, Infinity, true)) cost -= 2;
        else if (!this.town.grid.clear(beast.position, foot, Infinity, true)) cost += 4;
      }
      if (cost < best) {
        best = cost;
        chosen = { person: p, slot, planted: false };
      }
    }
    if (chosen) {
      this.reserve(beast, chosen);
    } else if (beast.rank === MonsterRank.Guardian) {
      // Its brood gives way when the guardian reaches a completely occupied front.
      for (const p of candidates) {
        const slot = this.openSlot(beast, p, true);
        if (slot < 0) continue;
        const gap = distance(beast.position, attackFeet(this.town, p)[slot]!);
        if (gap < best) { best = gap; chosen = { person: p, slot, planted: false }; }
      }
      if (chosen) {
        const displaced = this.fronts.get(chosen.person)?.[chosen.slot];
        if (displaced) this.release(displaced);
        this.reserve(beast, chosen);
      }
    }
    return chosen;
  }

  private openSlot(beast: Monster, person: Person, guardianPriority = false): number {
    const front = this.fronts.get(person);
    if ((front && !guardianPriority && !front.includes(undefined)) ||
      !this.town.grid.sharesLand(beast.position, person.position)) return -1;
    const failures = blocked.get(beast), failed = failures?.get(person);
    if (failed) {
      if (this.town.time < failed.until && failed.revision === this.town.walkRevision &&
        distance(person.position, failed.at) < 0.8) return -1;
      failures!.delete(person);
    }
    let slot = -1, gap = Infinity;
    const feet = attackFeet(this.town, person);
    for (let i = 0; i < feet.length; ++i) {
      const foot = feet[i];
      const occupant = front?.[i];
      if (!foot || (occupant && (!guardianPriority || occupant.rank === MonsterRank.Guardian))) continue;
      const d = distance(beast.position, foot);
      if (d < gap) { slot = i; gap = d; }
    }
    return slot;
  }

  goal(claim: Engagement): Point { return attackFeet(this.town, claim.person)[claim.slot]!; }

  inPlace(beast: Monster, claim: Engagement, goal: Point): boolean {
    const gap = distance(beast.position, claim.person.position);
    claim.planted = gap <= contactReach &&
      (claim.planted || (gap >= 0.38 && distance(beast.position, goal) <= 0.36)) &&
      this.town.grid.clear(beast.position, claim.person.position, Infinity, true);
    return claim.planted;
  }
}
