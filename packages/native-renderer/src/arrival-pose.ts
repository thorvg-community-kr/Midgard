import { lerp, type Point } from '../../engine/src/geometry';
import { Activity, type Person } from '../../engine/src/person';

export const riseAt = 0.3;
export const riseTime = 0.73;
export const emergedAt = riseAt + riseTime;
export const arrivalSeconds = 1.5;

/** A direct order or a fight takes precedence over the resident's entrance. */
export function interruptsArrival(person: Person): boolean {
  return person.ordered || person.holding || !person.autoMode ||
    person.downedAt >= 0 || person.activity === Activity.Fighting;
}

/** The camera, rendered feet and hit area share the same ground point while the simulation keeps working. */
export function arrivalFoot(origin: Point, person: Person, age: number, reduced: boolean): Point {
  if (reduced || age >= arrivalSeconds || interruptsArrival(person)) return person.position;
  if (age <= emergedAt) return origin;
  const t = (age - emergedAt) / (arrivalSeconds - emergedAt);
  return lerp(origin, person.position, t * t * (3 - 2 * t));
}
