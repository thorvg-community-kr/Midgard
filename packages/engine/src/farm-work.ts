import type { Town } from './town';
import { Activity, type Person } from './person';
import { Season, type Building, type Field } from './town-models';
import { bareHandsRate, taskEfficiency, type WorkKind } from './equipment';
import { Resources, Structure } from './building-catalog';
import { boon, Boon, boonRules } from './gate-boons';
import { TownState } from './town-state';
import { treePosition } from './world-map';
import { samples } from './town-construction';
import { add, area, centroid, closestOnSegment, contains, distance, normalized, point, scale, sub, type Point } from './geometry';
export enum CropStage { Tilling, Sowing, Watering, Tending, Harvesting }
type CropState = { cropProgress?: number; tilled?: number };
export const cropStage = (field: CropState): CropStage =>
  Math.floor(field.cropProgress ?? field.tilled ?? 1);
// A settled worker spends part of each day walking, eating and resting.
const workingShare = 0.76;
const cropEffort = 7 * TownState.secondsPerDay * bareHandsRate * workingShare;
const stageShares = [0.15, 0.18, 0.17, 0.29, 0.21];
const baseYield = (field: Field): number => Math.max(2, Math.min(12, Math.ceil(field.acres() * 2 / 3)));
export const cropWater = (field: Field): number => Math.ceil(baseYield(field) / 2);
export const cropYield = (town: TownState, field: Field): number =>
  Math.round(baseYield(field) * (boon(town, Boon.Plenty) ? boonRules.plentyFood : 1));

const toolsByStage: readonly (readonly WorkKind[])[] = [
  ['digging', 'farming'], ['farming'], ['watering'], ['farming'], ['reaping', 'farming'],
];

/** Estimate the inputs and completed crops for crews already at work, within the available growing days. */
export function expectedCrops(town: TownState, village: number, daysLeft: number, stockWater: number) {
  let water = 0, food = 0;
  if (daysLeft <= 0) return { water, food };
  for (const field of town.farmland) {
    if (field.village !== village) continue;
    const crew = town.folk.filter(p => p.workField === field.id && p.health > 0 && p.downedAt < 0 &&
      p.activity === Activity.Working && town.building(p.job)?.kind === Structure.Farm);
    if (!crew.length) continue;
    let seconds = daysLeft * TownState.secondsPerDay * workingShare;
    for (let stage = cropStage(field); stage <= CropStage.Harvesting; ++stage) {
      if (stage === CropStage.Watering && field.cropProgress <= stage) {
        const cost = cropWater(field);
        if (water + cost > stockWater) break;
        water += cost;
      }
      const rate = crew.reduce((sum, p) => sum + taskEfficiency(p, toolsByStage[stage]), 0);
      const remaining = stage + 1 - Math.max(stage, field.cropProgress);
      seconds -= remaining * cropEffort * stageShares[stage] / rate;
      if (seconds < 0) break;
      if (stage === CropStage.Harvesting) food += cropYield(town, field);
    }
  }
  return { water, food };
}

/** Only the watering stage uses the watering animation. */
export const farmWorkPhase = (
  person: Person,
  _time: number,
  fields: readonly (CropState & { id?: number })[] = [],
): 0 | 1 => cropStage(fields.find(field => field.id === person.workField) ?? {}) === CropStage.Watering ? 1 : 0;

export function fieldWork(town: Town, person: Person): readonly WorkKind[] {
  const field = town.farmland.find(item => item.id === person.workField);
  return toolsByStage[field ? cropStage(field) : CropStage.Sowing];
}
export const fieldEfficiency = (town: Town, person: Person): number =>
  taskEfficiency(person, fieldWork(town, person));
/** Rows run along the longest edge; tilling advances across them from one side. */
export function fieldRows(outline: readonly Point[]): { along: Point; across: Point; center: Point; reach: number } {
  let along = point(1, 0),
    longest = 0;
  for (let i = 0; i < outline.length; i++) {
    const edge = sub(outline[(i + 1) % outline.length], outline[i]),
      size = Math.hypot(edge.x, edge.y);
    if (size > longest) {
      longest = size;
      along = normalized(edge);
    }
  }
  const center = centroid(outline as Point[]);
  let reach = 0;
  for (const p of outline) reach = Math.max(reach, distance(p, center));
  return { along, across: point(-along.y, along.x), center, reach };
}
export function servesField(farm: Building, field: Field): boolean {
  return field.village === farm.village && field.faction === farm.faction &&
    distance(centroid(field.outline), farm.center) <= TownState.farmReach + Math.sqrt(area(field.outline)) / 2;
}

function treesInPlot(town: TownState, field: Field, cell: number): boolean {
  const map = town.world, x = cell % map.width(), y = Math.floor(cell / map.width());
  if (!map.inside(x, y)) return false;
  for (let tree = 0; tree < map.at(x, y).trees; ++tree)
    if (contains(field.outline, treePosition(map, x, y, tree))) return true;
  return false;
}
export function clearingField(town: TownState, p: Person, cell: number): boolean {
  if (p.workField < 0 || town.building(p.job)?.kind !== Structure.Farm) return false;
  const field = town.farmland.find(item => item.id === p.workField);
  return !!field && field.cropProgress === 0 && treesInPlot(town, field, cell);
}

// Regrowth excludes staked ground. Only tiles that still have a tree inside the outline need another look.
const woodedCells = new WeakMap<Field, number[]>();
function clearPlot(town: Town, person: Person, field: Field): boolean {
  const map = town.map(), width = map.width();
  let cells = woodedCells.get(field);
  if (!cells) {
    cells = [...new Set(samples(field.outline).filter(p => map.inside(Math.floor(p.x), Math.floor(p.y)))
      .map(p => Math.floor(p.y) * width + Math.floor(p.x)))];
    woodedCells.set(field, cells);
  }
  for (let i = cells.length - 1; i >= 0; --i) {
    const cell = cells[i];
    if (!treesInPlot(town, field, cell)) cells.splice(i, 1);
    else if (town.fellTree(person, cell)) return true;
  }
  return cells.length > 0;
}

/** Only hands on the plot advance it. Starting the watering stage spends its water once for the whole crew. */
export function workCrop(town: Town, person: Person, farm: Building, effort: number): boolean {
  const field = town.farmland.find(item => item.id === person.workField);
  if (!field || effort <= 0 || town.calendar().season === Season.Winter) return false;
  const stage = cropStage(field), before = field.cropProgress;
  if (before === 0 && clearPlot(town, person, field)) return false;
  const stock = town.stock(field.village);
  if (before === CropStage.Watering) {
    const water = cropWater(field);
    if (stock.water < water) return false;
    stock.water -= water;
    ++town.changes;
  }
  field.cropProgress = Math.min(stage + 1, before + effort / (cropEffort * stageShares[stage]));
  if (field.cropProgress === CropStage.Sowing && stage === CropStage.Tilling)
    town.notify('A field is tilled and ready for sowing');
  if (field.cropProgress === CropStage.Harvesting + 1) {
    const food = stock.food;
    town.store(new Resources(0, 0, 0, cropYield(town, field)), field.village);
    if (stock.food > food) town.notify(`Harvest: +${stock.food - food} food`);
    field.cropProgress = 0;
    // A single farmhand rotates through all the plots served by this farmhouse.
    const fields = town.farmland.filter(item => servesField(farm, item));
    person.workField = fields[(fields.indexOf(field) + 1) % fields.length]?.id ?? -1;
  }
  if (Math.floor(before) !== Math.floor(field.cropProgress) ||
      (stage === CropStage.Tilling && Math.floor(before * 16) !== Math.floor(field.cropProgress * 16)))
    ++town.changes;
  return true;
}
export function prepareFarmWork(town: Town, person: Person, farm: Building): boolean {
  if (town.calendar().season === Season.Winter) { person.workField = -1; return false; }
  const available = (field: Field) => servesField(farm, field) &&
    (field.cropProgress !== CropStage.Watering || town.stock(field.village).water >= cropWater(field));
  let field = town.farmland.find(item => item.id === person.workField && available(item));
  // A worker breaking in a plot follows the furrow being cut rather than standing still.
  if (field && field.tilled < 1) {
    const rows = fieldRows(field.outline),
      front = add(rows.center, scale(rows.across, rows.reach * (2 * field.tilled - 1)));
    if (distance(person.goal, closestOnSegment(person.goal, sub(front, scale(rows.along, rows.reach)), add(front, scale(rows.along, rows.reach)))) > 0.35) {
      for (let lane = 0; lane < 9; ++lane) {
        const at = add(front, scale(rows.along, ((((person.id + lane) % 5) - 2) * rows.reach) / 4));
        if (!contains(field.outline, at) || !town.grid.walkable(at)) continue;
        person.goal = { ...at };
        break;
      }
    }
  }
  if (field && contains(field.outline, person.goal) && town.grid.walkable(person.goal)) {
    if (distance(person.position, person.goal) <= .04 || person.moving()) return true;
    return town.walkTo(person, person.goal);
  }
  const assigned = field?.id;
  person.workField = -1;
  const fields = town.farmland.filter(available);
  // Finish crops already under way before opening more ground.
  fields.sort((a, b) => Number(b.id === assigned) - Number(a.id === assigned) || b.cropProgress - a.cropProgress ||
    distance(centroid(a.outline), farm.center) - distance(centroid(b.outline), farm.center) || a.id - b.id);
  for (field of fields) {
    const center=centroid(field.outline), points=[center];
    // Distinct stable rows keep workers outdoors without selecting a new target
    // every scheduler tick. Concave fields still require an interior walkable point.
    for(let row=0;row<12;++row) points.unshift(point(center.x+((person.id+row)%4-.5)*.45,center.y+(Math.floor((person.id+row)/4)%3-1)*.45));
    for(const at of points) {
      if(!contains(field.outline,at)||!town.grid.walkable(at)||!town.walkTo(person,at)) continue;
      person.workField=field.id;person.goal={...at};return true;
    }
  }
  return false;
}
