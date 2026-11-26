import { Structure, structureSpec } from './building-catalog';
import { type Outline, Footprint, area, centroid, distance, selfIntersects } from './geometry';
import type { Town } from './town';
import { Check, Placement } from './town-models';
import { TownState } from './town-state';
import { shelteredLayout } from './sheltered-layout';

export interface FarmLayout {
  check: Check;
  /** Where the farmhouse is raised; null when the area only adds a field to a farm already there. */
  house: Placement | null;
  /** The field: the drawn area less the farmhouse's corner. */
  field: Outline;
}
const tooSmall = 'Too small for a farmhouse and a field';
/** A farmhouse of the player's, standing or staked out, that would take `outline` as one of its fields. */
function farmInReach(town: Town, outline: Outline): boolean {
  return town.near(
    centroid(outline),
    TownState.farmReach + Math.sqrt(area(outline)) / 2,
    (kind) => kind === Structure.Farm,
  );
}
/** How a drawn area would be laid out, and why not when it cannot be. */
export function farmLayout(this: Town, drawn: Outline): FarmLayout {
  const none = (reason: string): FarmLayout => ({ check: new Check(false, reason), house: null, field: [] });
  if (drawn.length < 3) return none('Drag an area for the farm');
  if (farmInReach(this, drawn)) return { check: this.canPlantField(drawn), house: null, field: drawn };
  if (selfIntersects(drawn)) return none('The outline crosses itself');
  const plan = shelteredLayout(this, drawn, Structure.Farm, tooSmall, 'No corner has room for the farmhouse', (field, house) => {
    const land = this.canPlantField(field, new Footprint(house.center, structureSpec(Structure.Farm).size / 2, house.angle));
    if (!land.ok) return land.reason === 'Too small' ? tooSmall : land.reason;
    return distance(centroid(field), house.center) > TownState.farmReach ? 'Too large for one farmhouse to work' : '';
  });
  return { check: plan.check, house: plan.house, field: plan.yard };
}
/** Stakes out what `farmLayout` shows: a farmhouse site with its field, or one more field. */
export function layFarm(this: Town, drawn: Outline): boolean {
  const { check, house, field } = this.farmLayout(drawn);
  if (!check.ok) return false;
  if (house && !this.place(Structure.Farm, house.center, house.angle)) return false;
  if (this.plantField(field)) return true;
  // The two are laid together or not at all.
  if (house) this.raze(this.buildings().at(-1)!.id);
  return false;
}
