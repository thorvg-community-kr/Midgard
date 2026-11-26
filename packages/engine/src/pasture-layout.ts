import { Structure } from './building-catalog';
import { area, selfIntersects, type Outline } from './geometry';
import { pastureRules, livestockRecipe, roomOnPasture } from './pasture-geometry';
import { footBlockedBy } from './person-collision';
import { pastureGateFor } from './pasture-roaming';
import { shelteredLayout } from './sheltered-layout';
import type { Town } from './town';
import { doorReached, placementVariant, samples } from './town-construction';
import { Building, Check, type Placement } from './town-models';

export interface PastureLayout {
  check: Check;
  house: Placement | null;
  pasture: Outline;
  capacity: number;
}
const tooSmall = 'Too small for a shelter and pasture';
export function pastureLayout(this: Town, kind: Structure, drawn: Outline): PastureLayout {
  const refuse = (reason: string): PastureLayout => ({ check: new Check(false, reason), house: null, pasture: [], capacity: 0 });
  if (!livestockRecipe(kind)) return refuse('Choose a building');
  if (drawn.length < 3) return refuse('Drag an area for the pasture');
  if (drawn.length > pastureRules.maxCorners) return refuse('Too many corners in the pasture');
  if (drawn.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !this.world.inside(p))) return refuse('Unexplored land');
  if (selfIntersects(drawn)) return refuse('The outline crosses itself');
  const plan = shelteredLayout(this, drawn, kind, tooSmall, 'No corner has room for the shelter', (yard, house) => {
    const grass = area(yard);
    if (grass < pastureRules.minimum) return tooSmall;
    if (grass > pastureRules.maximum) return 'At most 96 acres per pasture';
    const obstruction = this.plotObstruction(yard) || this.groundProblem(samples(yard));
    if (obstruction) return obstruction;
    const shelter = new Building(-1, kind, house.center, house.angle, placementVariant(this.world, kind, house.center));
    const gate = pastureGateFor(yard, shelter.door());
    const camp = this.camp(this.settlementAt(house.center));
    return gate && !footBlockedBy(gate, shelter.footprint()) && camp && doorReached(this.grid, camp.door(), gate)
      ? '' : 'The pasture gate is unreachable';
  });
  return { check: plan.check, house: plan.house, pasture: plan.yard, capacity: plan.check.ok ? roomOnPasture(kind, plan.yard) : 0 };
}

export function layPasture(this: Town, kind: Structure, drawn: Outline): boolean {
  const { check, house, pasture } = this.pastureLayout(kind, drawn);
  if (!check.ok || !house || !this.place(kind, house.center, house.angle)) return false;
  this.placed[this.placed.length - 1].pasture = pasture;
  return true;
}
