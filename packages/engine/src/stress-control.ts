import type { Town } from './town';
import { Activity, Role, type Person } from './person';
import { f32 } from './numeric';
import { distance } from './geometry';
import { defect } from './neutral-settlements';
import { TownState } from './town-state';
import { hasUnfinishedRoadwork } from './automatic-work';
import { dangerNear } from './town-tick';

export const stressPolicy = {
  breakdown: 0.85,
  recovered: 0.35,
  repeatWindowDays: 7,
  recoveryPerDay: 0.65,
  homeRetrySeconds: 5,
} as const;

/** A raid is on, or this resident fights or has a foe within notice: no time to walk off and rest. */
export function fightOn(this: Town, p: Person): boolean {
  return this.raiding() || (p.activity === Activity.Fighting && !p.hunting) || dangerNear(this, p);
}
/** True consumes work/combat scheduling; the caller still advances doorway/walking. */
export function updateStress(this: Town, p: Person, dt: number): boolean {
  if (p.faction !== 0 || p.role !== Role.Resident || p.health <= 0 || p.activity === Activity.Expedition || this.inRealm(p.position))
    return false;
  // Finish accepted road work before starting a breakdown. Stress still grows
  // normally and is reconsidered on completion; combat can still interrupt now.
  if (!p.stressRecovery && (hasUnfinishedRoadwork(this, p) || this.stayingUp(p) || p.recoveringRest || p.activity === Activity.Sleeping)) return false;
  if (!p.stressRecovery && p.stress >= f32(stressPolicy.breakdown)) {
    // The breakdown waits for the end of the fight: nobody walks indoors with a foe about.
    if (this.fightOn(p)) return false;
    const elapsed = this.time - p.lastBreakdownAt;
    if (
      (p.unpaid || p.food < 0.15) && p.lastBreakdownAt >= 0 &&
      elapsed >= 0 &&
      elapsed <= stressPolicy.repeatWindowDays * TownState.secondsPerDay
    ) {
      defect.call(this, p);
      return true;
    }
    p.lastBreakdownAt = this.time;
    p.stressRecovery = true;
    p.supplyTarget = p.foe = p.tree = p.attackPerson = -1;
    p.hunting = p.supplyRoad = false;
    p.path = [];
    p.activity = Activity.Idle;
    p.scheduleAt = this.time;
    this.notify(`${p.name} is overwhelmed and needs time to rest.`);
  }
  if (!p.stressRecovery) return false;
  if (!p.inside && !p.crossingDoorway() && this.fightOn(p)) {
    // Caught outdoors by a fight, the overwhelmed stand and defend themselves; rest resumes when it is over.
    if (p.activity === Activity.Sleeping) {
      p.activity = Activity.Idle;
      p.target = -1;
      p.path = [];
    }
    return false;
  }
  p.stress = Math.max(0, f32(p.stress - ((p.activity === Activity.Sleeping ? 0 : stressPolicy.recoveryPerDay) * dt) / TownState.secondsPerDay));
  if (p.rest >= f32(1 - stressPolicy.recovered)) {
    p.stressRecovery = false;
    p.autoMode = true;
    p.activity = Activity.Idle;
    p.until = this.time;
    p.scheduleAt = this.time;
    this.notify(`${p.name} feels ready to work again.`);
    if (p.task !== Activity.Idle) this.resumeOrder(p);
    return false;
  }
  const home = this.building(p.home);
  if (home?.built() && home.faction === p.faction) {
    if (p.inside && this.shelterOf(p) === home.id) {
      p.activity = Activity.Sleeping;
      p.target = home.id;
      // A stocked own home can serve a meal during quiet recovery without
      // assigning an errand or returning control before the stress has passed.
      const village = this.settlementOf(p),
        stock = this.stock(village);
      if (!p.crossingDoorway() && p.food < f32(0.25) && stock.food > 0) {
        --stock.food;
        ++this.economy(village).today.eaten;
        p.food = 1;
      }
    } else if (
      p.activity !== Activity.Sleeping ||
      p.target !== home.id ||
      (!p.moving() && distance(p.position, home.door()) > 0.02)
    ) {
      // A blocked home can stay unreachable for many ticks. Keep resting between route attempts.
      if (this.time < p.scheduleAt) return true;
      if (this.walkTo(p, home.door())) {
        p.activity = Activity.Sleeping;
        p.target = home.id;
        if (!p.moving() && !p.crossingDoorway()) this.arrive(p);
      } else {
        p.activity = Activity.Idle;
        p.path = [];
        p.scheduleAt = this.time + stressPolicy.homeRetrySeconds;
      }
    }
  } else {
    p.activity = Activity.Sleeping;
    p.target = -1;
    p.path = [];
    p.inside = false;
    p.sleptOutside = true;
  }
  return true;
}
