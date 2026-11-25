// What the title player has made at the stations: the quest's items first, then arms for the fighters, then tools
// for the workers. Recipes, their reasons and who would get each item are read from the stations' own offers; the
// station picks the receiver, so the player only judges whether that resident is helped by it.
import type { Town } from '../../../../packages/engine/src/town';
import { Activity, Calling, type Person } from '../../../../packages/engine/src/person';
import type { Building } from '../../../../packages/engine/src/town-models';
import { Structure } from '../../../../packages/engine/src/building-catalog';
import {
  carriedTools,
  attackDamage,
  equippedItem,
  isCraftStation,
  type ItemSpec,
  type WorkKind,
} from '../../../../packages/engine/src/equipment';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';

/** Weapon shapes each calling fights best with, best first. */
const weaponShapes: Partial<Record<Calling, readonly string[]>> = {
  [Calling.Warrior]: ['sword', 'mace', 'spear'],
  [Calling.Ranger]: ['bow'],
  [Calling.Mage]: ['staff'],
  [Calling.Cleric]: ['mace', 'sword'],
  [Calling.Bard]: ['sword', 'spear', 'mace'],
};
const plainShapes = ['sword', 'mace', 'spear'];
export const isFighter = (p: Person): boolean => p.calling >= Calling.Warrior;
/** The station's answer when only the materials are missing. */
const shortOfMaterials = 'Not enough settlement materials';

export function ownStations(town: Town): Building[] {
  return town.buildings().filter((b) => isPlayerBuilding(b) && b.built() && isCraftStation(b.kind));
}
/** A station already has someone ordered to it (working, walking there or waiting). */
export function stationBusy(town: Town, station: Building): boolean {
  return town.people().some((p) => p.health > 0 && p.task === Activity.Crafting && p.craftWorkshop === station.id);
}
const owns = (p: Person, id: string): boolean => p.inventory.some((s) => s?.item === id);
const toolRate = (p: Person, work: WorkKind): number =>
  Math.max(0, ...carriedTools(p).filter((t) => t.work.includes(work)).map((t) => t.rate));
/** The work a resident's job or task needs a tool for. */
export function workOf(town: Town, p: Person): WorkKind | null {
  const job = town.building(p.job);
  if (job) {
    if (job.kind === Structure.Farm) return 'farming';
    if (job.kind === Structure.Lumberyard) return 'woodcutting';
    if (job.kind === Structure.Quarry) return 'mining';
    if (job.kind === Structure.Sawmill) return 'sawing';
  }
  if (p.task === Activity.Felling) return 'woodcutting';
  if (p.task === Activity.Mining) return 'mining';
  if (p.task === Activity.Building) return 'construction';
  if (p.task === Activity.Roadwork) return 'digging';
  return null;
}
/** How much `item` would add for `p`; 0 when it adds nothing. */
export function gearWorth(town: Town, p: Person, item: ItemSpec): number {
  if (owns(p, item.id) || item.minimumLevel > p.level) return 0;
  if (item.category === 'weapon') {
    const shapes = weaponShapes[p.calling] ?? plainShapes,
      rank = shapes.indexOf(item.visual ?? '');
    if (rank < 0) return 0;
    // A fighter needs their first weapon to join a party and upgrade it, even when carrying a good work tool.
    const gain = attackDamage(p, item) - attackDamage(p, equippedItem(p, 'weapon'));
    return gain > 0 ? (isFighter(p) ? 40 : 12) + gain * 3 - rank : 0;
  }
  if (item.category === 'armor' && item.slots.length) {
    if (!isFighter(p) && item.visual !== 'basket') return 0;
    if (item.visual === 'basket') return equippedItem(p, 'accessory') || isFighter(p) ? 0 : 3;
    const slot = item.slots[0],
      held = equippedItem(p, slot);
    if (item.block > 0) {
      const weapon = equippedItem(p, 'weapon');
      if (weapon && weapon.hands === 2) return 0;
      return item.block > (held?.block ?? 0) ? 30 + item.block * 20 : 0;
    }
    return item.defense > (held?.defense ?? 0) ? 25 + item.defense * 40 : 0;
  }
  if (item.category === 'tool') {
    const work = workOf(town, p);
    if (!work || !item.work.includes(work)) return 0;
    return item.rate > toolRate(p, work) + 0.01 ? 15 + item.rate * 10 : 0;
  }
  return 0;
}
export interface GearChoice {
  person: Person;
  station: Building;
  item: ItemSpec;
  worth: number;
}
/** In the middle of a job the player gave: building, laying a road or walking where they were sent. An item is not
 * ordered for them now, as the walk to the station would take them off it. */
const midJob = (p: Person): boolean =>
  p.task === Activity.Building || p.task === Activity.Roadwork || (p.task === Activity.Moving && p.ordered);
/** The most useful item a free station would now give one of `free`, or null. With `wish`, the most useful one
 * that only lacks materials, so the gatherers know what to fetch. With `onlyFree`, an item of `wanted` too goes
 * only to one of `free`. */
export function bestGear(
  town: Town,
  free: readonly Person[],
  wanted?: readonly string[],
  wish = false,
  onlyFree = false,
): GearChoice | null {
  let best: GearChoice | null = null;
  for (const station of ownStations(town)) {
    if (!wish && stationBusy(town, station)) continue;
    for (const { item, who: p, open, reason } of town.craftOffers(station.id)) {
      // A quest's item is taken by whoever the station names; other gear only by those with nothing else to do.
      if (!open || !p || ((!wanted || onlyFree) && !free.includes(p)) || (wish ? reason !== shortOfMaterials : reason)) continue;
      if (!wish && midJob(p)) continue;
      let worth = wanted ? (wanted.includes(item.id) && !owns(p, item.id) ? 100 - item.cost.wood : 0) : gearWorth(town, p, item);
      // The station hands a kind out nearest first: one who gains nothing from a tool or armor still has to get
      // theirs before the one who would, so it is made last of all rather than never. A second weapon helps nobody.
      if (!worth && !wanted && item.category !== 'weapon') worth = Math.min(1, Math.max(0, ...free.map((q) => gearWorth(town, q, item))));
      if (worth > 0 && (!best || worth > best.worth)) best = { person: p, station, item, worth };
    }
  }
  return best;
}
/** Items of `wanted` (cheapest first) that the town could make at some station, ignoring materials. */
export function makeable(town: Town, _someone: Person, wanted: readonly string[]): ItemSpec[] {
  const out: ItemSpec[] = [];
  for (const station of ownStations(town))
    for (const { item, open, reason } of town.craftOffers(station.id))
      if (open && wanted.includes(item.id) && (!reason || reason === shortOfMaterials)) out.push(item);
  return out.sort((a, b) => a.cost.wood + a.cost.stone - (b.cost.wood + b.cost.stone));
}
