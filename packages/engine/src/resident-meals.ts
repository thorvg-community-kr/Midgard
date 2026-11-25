import { Activity, type Person } from './person';

export const mealSeconds = 3;
export const drinkSeconds = 2;

/** The portion has been paid for. Pause here to eat it, keeping the underlying order. */
export function beginMeal(p: Person, now: number, target = -1): void {
  p.food = 1;
  p.activity = Activity.Eating;
  p.target = target;
  p.tree = -1;
  p.path = [];
  p.until = now + mealSeconds;
}
