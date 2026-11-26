// Native settlement_progression.cpp. Guidance/UI rules are intentionally separate from Town::place.
import type { Town } from './town';
import { Product, Structure, structureSpec, resourceProducts } from './building-catalog';
import { heldAmount } from './carried-resources';
import { resourceAmount } from './construction-materials';
import { Tool, toolStructure } from './game-tools';
import rows from '../data/settlement-goals.json';
import { belongsToFaction } from './faction';
import { f32 } from './numeric';
import { sealProgress } from './gate-seals';
import { Activity, Calling, Role, type Person } from './person';
import { carriedTools, equippedItem, itemSpec, madeFrom, productItem, upgradeCost } from './equipment';
import { stationLevel } from './craft-stations';
import { craftOrder, orderItem, orderSeconds } from './craft-orders';
import type { Building } from './town-models';
import { point, type Point } from './geometry';
export interface Unlock {
  available: boolean;
  reason: string;
}
/** One condition for placing a building, in words and as what it asks for. */
export interface UnlockRequirement {
  text: string;
  done: boolean;
  /** A building that must stand first. */
  facility?: Structure;
  /** A finished road. */
  road?: boolean;
  /** Residents the settlement must have. */
  residents?: number;
}
export enum GoalKind {
  Building,
  Road,
  Field,
  Population,
  /** `count` floors cleared beyond any gates. */
  Floor,
  /** `count` gates sealed; 0 means every gate. */
  Seal,
  /** `count` of the deed named by `deed` (see `deedCount`). */
  Deed,
  /** `count` different items of `items` owned by residents. */
  Craft,
  /** `count` residents carrying a tool or with a weapon in hand. */
  Equip,
  /** A craft station of kind `building` raised to level `count`. */
  Station,
}
/** Core is one ordered chain; the others advance side by side in any order. */
export enum GoalBranch {
  Core,
  Trade,
  Arms,
  Faith,
  Saga,
}
export const goalBranchName = (branch: GoalBranch): string =>
  ['Founding', 'Trade', 'Arms', 'Faith', 'Saga'][branch] ?? '';
const deedKeys = [
  'raidsRepelled',
  'guardiansSlain',
  'partiesLed',
  'largestParty',
  'rescues',
  'weaponsForged',
  'monstersSlain',
  'sworn',
  'floors',
  'seals',
] as const;
/** Deeds a goal or an unlock can ask for. `sworn` counts living residents with a calling from the guild. */
export type DeedKey = (typeof deedKeys)[number];
const deedKey = (value: string): DeedKey => {
  const key = deedKeys.find((k) => k === value);
  if (!key) throw new Error('Unknown deed ' + value);
  return key;
};
export interface SettlementGoal {
  title: string;
  description: string;
  kind: GoalKind;
  building: Structure;
  /** The number the goal asks for (residents, floors, gates or deeds); same as `count`. */
  residents: number;
  count: number;
  /** The deed a `GoalKind.Deed` goal counts; '' for other kinds. */
  deed: DeedKey | '';
  /** Item ids a `GoalKind.Craft` goal accepts; empty for other kinds. */
  items: readonly string[];
  branch: GoalBranch;
}
const itemIds = (ids: readonly string[] | undefined): string[] =>
  (ids ?? []).map((id) => {
    if (!itemSpec(id)) throw new Error('Unknown item ' + id);
    return id;
  });
const goals: SettlementGoal[] = rows.map((row) => ({
  title: row.title,
  description: row.description,
  kind: GoalKind[row.kind as keyof typeof GoalKind],
  building: Structure[row.building as keyof typeof Structure],
  residents: row.residents,
  count: row.residents,
  deed: row.deed ? deedKey(row.deed) : '',
  items: itemIds('items' in row ? row.items : undefined),
  branch: GoalBranch[row.branch as keyof typeof GoalBranch],
}));
const ownResidents = (town: Town): Person[] =>
  town.folk.filter((p) => p.role === Role.Resident && p.faction === town.controlFaction && p.health > 0);
/** How many of `ids` some living resident owns. */
export function itemsOwned(town: Town, ids: readonly string[]): number {
  const owned = new Set<string>();
  for (const p of ownResidents(town)) for (const stack of p.inventory) if (stack) owned.add(stack.item);
  return ids.filter((id) => owned.has(id)).length;
}
/** Residents carrying a tool, which works from the pack, or holding a weapon. */
export function residentsEquipped(town: Town): number {
  return ownResidents(town).filter((p) => carriedTools(p).length > 0 || !!equippedItem(p, 'weapon')).length;
}
/** The highest level the player's finished stations of `kind` have reached; 0 with none. */
export function stationLevelReached(town: Town, kind: Structure): number {
  let best = 0;
  for (const b of town.buildings())
    if (b.kind === kind && b.built() && belongsToFaction(b, town.controlFaction)) best = Math.max(best, stationLevel(b));
  return best;
}
/** A raw material a site still lacks that nobody can get: none stored, carried, or in sight on the map. */
export function unsourcedMaterial(town: Town, site: Building): Product.Wood | Product.Stone | null {
  const reach = Math.hypot(town.map().width(), town.map().height());
  for (const product of [Product.Stone, Product.Wood] as const) {
    if (site.materials.missing(product) <= 0) continue;
    if (resourceAmount(town.stock(town.settlementOf(site)), product) > 0) continue;
    if (ownResidents(town).some((p) => heldAmount(p, product) > 0)) continue;
    if (!town.resourceNearby(site.center, reach, product)) return product;
  }
  return null;
}
/** The nearest unexplored, reachable ground around `from`, in widening rings. */
export function scoutPoint(town: Town, from: Point): Point | null {
  for (let radius = 8; radius <= 40; radius += 4)
    for (let i = 0; i < 24; ++i) {
      const angle = (i * Math.PI) / 12,
        at = point(from.x + radius * Math.cos(angle), from.y + radius * Math.sin(angle));
      if (!town.map().inside(at) || town.map().revealed(at)) continue;
      const step = town.grid.nearestWalkable(at);
      if (town.grid.path(from, step).length) return step;
    }
  return null;
}
export function completedFacility(town: Pick<Town, 'buildings' | 'controlFaction'>, kind: Structure): boolean {
  for (const b of town.buildings())
    if (b.built() && belongsToFaction(b, town.controlFaction))
      for (let stage = kind; stage !== Structure.Count; stage = structureSpec(stage).next)
        if (b.kind === stage) return true;
  return false;
}
/** How many times the settlement has done a deed. Never decreases except `sworn`, which counts the living. */
export function deedCount(town: Town, deed: DeedKey): number {
  switch (deed) {
    case 'sworn':
      return town.folk.filter(
        (p) =>
          p.role === Role.Resident &&
          p.faction === town.controlFaction &&
          p.health > 0 &&
          (p.trained || p.calling >= Calling.Warrior),
      ).length;
    case 'floors':
      return town.depth.reduce((sum, floors) => sum + floors, 0);
    case 'seals':
      return sealProgress(town).sealed;
    default:
      return town.chronicle[deed];
  }
}
const roadDone = (town: Town): boolean =>
  town
    .roads()
    .roads()
    .some(
      (r) =>
        r.built >= 1 && !!town.camp(r.village) && belongsToFaction(town.camp(r.village)!, town.controlFaction),
    );
interface UnlockRule {
  after: Structure[];
  deeds: [DeedKey, number, string][];
  population: number;
  road: boolean;
  /** Opens with the first slain guardian or the first resident lost. */
  remembrance: boolean;
}
const raidBeaten: [DeedKey, number, string] = ['raidsRepelled', 1, 'Beat off a raid'],
  floorCleared: [DeedKey, number, string] = ['floors', 1, 'Seal a dungeon'],
  gateSealed: [DeedKey, number, string] = ['seals', 1, 'Seal a gate'];
function unlockRule(kind: Structure): UnlockRule {
  const rule: UnlockRule = { after: [Structure.Camp], deeds: [], population: 0, road: false, remembrance: false };
  const set = (after: Structure[], population = 0, deeds: [DeedKey, number, string][] = []): UnlockRule => {
    rule.after = after;
    rule.population = population;
    rule.deeds = deeds;
    return rule;
  };
  switch (kind) {
    case Structure.Camp:
      return set([]);
    // Timber and stone yards haul along a road; shelter, food and water need only the camp.
    case Structure.Lumberyard:
    case Structure.Quarry:
      rule.road = true;
      return rule;
    // Each step opens one thing. A founding building that finishes brings the next quest's building, so what
    // is not in the chain waits for a step that brings nothing: the altar, the end of the chain, a headcount.
    case Structure.Torch:
      return set([Structure.Shrine]);
    case Structure.Sawmill:
      return set([Structure.Lumberyard]);
    case Structure.Stoneworks:
      return set([Structure.Quarry]);
    // The depots follow the last workshop, timber first.
    case Structure.WoodStore:
      return set([Structure.Stoneworks]);
    case Structure.StoneStore:
      return set([Structure.WoodStore]);
    case Structure.Granary:
      return set([Structure.Farm], 5);
    case Structure.Hostel:
      return set([Structure.Tent], 4);
    case Structure.Storehouse:
      return set([Structure.Quarry], 4);
    case Structure.Tavern:
      return set([Structure.Hostel], 4);
    case Structure.MarketStalls:
      return set([Structure.Tavern], 6);
    // Arms: each step asks for something the settlement has done.
    case Structure.Guild:
      return set([Structure.Quarry], 6);
    case Structure.TrainingYard:
      return set([Structure.Guild]);
    // The smithy follows the workbench: tools gather what it is built from.
    case Structure.Weaponsmith:
      return set([Structure.Workbench]);
    case Structure.Watchtower:
      return set([Structure.TrainingYard], 0, [raidBeaten]);
    case Structure.Foundry:
      return set([Structure.Weaponsmith, Structure.Stoneworks], 6);
    case Structure.Armorer:
      return set([Structure.Weaponsmith], 12, [floorCleared]);
    // The altar asks for a home and a food supply for the newcomer it shapes.
    case Structure.Shrine:
      return set([Structure.Tent, Structure.Farm]);
    // A stone for the fallen: it is offered once there is someone, or some deed, to remember.
    case Structure.Runestone:
      rule.remembrance = true;
      return rule;
    case Structure.Chapel:
      return set([Structure.Shrine], 10);
    case Structure.Apothecary:
      return set([Structure.Shrine], 8);
    case Structure.MageTower:
      return set([Structure.Apothecary]);
    case Structure.Portal:
      return set([Structure.MageTower, Structure.Guild], 0, [gateSealed]);
    default:
      return rule;
  }
}
/**
 * The founding quests bring their buildings and tools into the build menu one at a time: each stays out until
 * its quest is the current one. What the settlement already has, built or staked out, is known all the same.
 */
const introductions = new Map<Structure, number>();
goals.forEach((goal, index) => {
  // A farm is laid out as a field with its farmhouse: that quest brings the farmhouse.
  const brings =
    goal.kind === GoalKind.Building || (goal.kind === GoalKind.Field && goal.building !== Structure.Count);
  if (goal.branch === GoalBranch.Core && brings && !introductions.has(goal.building))
    introductions.set(goal.building, index);
});
function questReached(town: Town, index: number): boolean {
  if (index < 0) return true;
  const current = currentGoal(town, GoalBranch.Core);
  return current < 0 || current >= index;
}
const staked = (town: Town, kind: Structure): boolean =>
  town.buildings().some((b) => b.kind === kind && belongsToFaction(b, town.controlFaction));
function introduction(town: Town, kind: Structure): UnlockRequirement | null {
  if (kind === Structure.Well && [Structure.Farm, Structure.ChickenCoop, Structure.Cowshed].some(
    producer => completedFacility(town, producer),
  )) return null;
  const index = introductions.get(kind) ?? -1;
  if (index < 0 || questReached(town, index) || completedFacility(town, kind) || staked(town, kind)) return null;
  return { text: `Reach the quest "${goals[index].title}"`, done: false };
}
/** Every condition for placing `kind`, in the order `buildingUnlock` checks them. */
export function unlockRequirements(town: Town, kind: Structure): UnlockRequirement[] {
  const rule = unlockRule(kind),
    out: UnlockRequirement[] = [];
  if (kind === Structure.Camp) return out;
  const quest = introduction(town, kind);
  if (quest) out.push(quest);
  const facility = (stage: Structure): void => {
    const text = 'Complete ' + structureSpec(stage).name;
    if (!out.some((r) => r.text === text)) out.push({ text, done: completedFacility(town, stage), facility: stage });
  };
  for (const stage of rule.after) facility(stage);
  for (const [deed, count, text] of rule.deeds) out.push({ text, done: deedCount(town, deed) >= count });
  if (rule.road) out.push({ text: 'Complete a road', done: roadDone(town), road: true });
  if (rule.remembrance)
    out.push({ text: 'Slay a dungeon guardian', done: deedCount(town, 'guardiansSlain') >= 1 || town.fallen.length > 0 });
  const cost = structureSpec(kind).cost;
  if (cost.planks) facility(Structure.Sawmill);
  if (cost.cutStone) facility(Structure.Stoneworks);
  const population = Math.max(rule.population, structureSpec(kind).requiredPopulation);
  if (population)
    out.push({ text: 'Needs ' + population + ' residents', done: town.population() >= population, residents: population });
  return out;
}
export function buildingUnlock(town: Town, kind: Structure): Unlock {
  const missing = unlockRequirements(town, kind).find((r) => !r.done);
  return missing ? { available: false, reason: missing.text } : { available: true, reason: '' };
}
/** What a tool that is not a building still asks for; empty for a building's tool and for the free ones. */
export function toolNeeds(town: Town, tool: Tool): UnlockRequirement[] {
  const facility = (kind: Structure): UnlockRequirement => ({
    text: 'Complete ' + structureSpec(kind).name,
    done: completedFacility(town, kind),
    facility: kind,
  });
  // Roads are the settlement's own from the first camp: they are not kept back for their quest.
  if (tool === Tool.Road) return [facility(Structure.Camp)];
  // Paving is laid in stone, so it waits for a quarry.
  if (tool === Tool.Pave) return [facility(Structure.Quarry)];
  if (tool === Tool.Field) return [facility(Structure.Farm)];
  return [];
}
export function toolAvailable(town: Town, tool: Tool): boolean {
  if (tool < Tool.Select || tool >= Tool.Count) return false;
  const kind = toolStructure(tool);
  if (kind !== undefined) return buildingUnlock(town, kind).available;
  return toolNeeds(town, tool).every((need) => need.done);
}
export const settlementGoals = (): readonly SettlementGoal[] => goals;
export function goalComplete(town: Town, goal: SettlementGoal): boolean {
  switch (goal.kind) {
    case GoalKind.Building:
      return completedFacility(town, goal.building);
    case GoalKind.Road:
      return roadDone(town);
    case GoalKind.Field:
      return town.fieldAcres() > 0 && (goal.building === Structure.Count || completedFacility(town, goal.building));
    case GoalKind.Population:
      return town.population() >= goal.count || (goal.branch === GoalBranch.Core && lessonPassed(town, goal));
    case GoalKind.Floor:
      return deedCount(town, 'floors') >= goal.count;
    case GoalKind.Seal: {
      const { sealed, total } = sealProgress(town);
      return goal.count ? sealed >= goal.count : total > 0 && sealed === total;
    }
    case GoalKind.Deed:
      return !!goal.deed && deedCount(town, goal.deed) >= goal.count;
    case GoalKind.Craft:
      return itemsOwned(town, goal.items) >= goal.count || lessonPassed(town, goal);
    case GoalKind.Equip:
      return residentsEquipped(town) >= goal.count || lessonPassed(town, goal);
    case GoalKind.Station:
      return stationLevelReached(town, goal.building) >= goal.count;
    default:
      return false;
  }
}
/** A later building records an earlier lesson even after a resident or their gear is lost. */
function lessonPassed(town: Town, goal: SettlementGoal): boolean {
  return goals
    .slice(goals.indexOf(goal) + 1)
    .some((later) => later.branch === goal.branch && later.kind === GoalKind.Building && completedFacility(town, later.building));
}
/** A goal's progress for display: `have` of `need`, and a ready line such as "1 / 3 raids beaten off". */
export interface GoalProgress {
  have: number;
  need: number;
  label: string;
}
const deedLabel = (deed: DeedKey, have: number, need: number): string => {
  switch (deed) {
    case 'raidsRepelled':
      return `${have} / ${need} raids beaten off`;
    case 'guardiansSlain':
      return `${have} / ${need} guardians slain`;
    case 'partiesLed':
      return `${have} / ${need} parties led`;
    case 'largestParty':
      return `Largest party ${have} / ${need}`;
    case 'rescues':
      return `${have} / ${need} downed residents revived`;
    case 'weaponsForged':
      return `${have} / ${need} weapons forged`;
    case 'monstersSlain':
      return `${have} / ${need} monsters slain`;
    case 'sworn':
      return `${have} / ${need} residents sworn to a calling`;
    case 'floors':
      return `${have} / ${need} floors cleared`;
    case 'seals':
      return `${have} / ${need} gates sealed`;
  }
};
export function goalProgress(town: Town, goal: SettlementGoal): GoalProgress {
  switch (goal.kind) {
    case GoalKind.Building: {
      if (completedFacility(town, goal.building)) return { have: 1, need: 1, label: 'Built' };
      const site = town.buildings().find((b) => b.kind === goal.building && belongsToFaction(b, town.controlFaction));
      return { have: site?.progress ?? 0, need: 1, label: site ? 'Under construction' : '' };
    }
    case GoalKind.Road: {
      let built = -1;
      for (const road of town.roads().roads()) {
        const camp = town.camp(road.village);
        if (camp && belongsToFaction(camp, town.controlFaction)) built = Math.max(built, road.built);
      }
      const label = built >= 1 ? 'Road complete' : built >= 0 ? `Laying road ${Math.trunc(f32(built * 100))}%` : '';
      return { have: Math.max(0, built), need: 1, label };
    }
    case GoalKind.Field: {
      const planted = town.fieldAcres() > 0 ? 1 : 0;
      if (goal.building === Structure.Count)
        return { have: planted, need: 1, label: planted ? 'Field planted' : '' };
      const house = completedFacility(town, goal.building) ? 1 : 0;
      const label = house ? (planted ? 'Farm laid out' : 'Farmhouse built')
        : staked(town, goal.building) ? 'Under construction' : planted ? 'Field planted' : '';
      return { have: house + planted, need: 2, label };
    }
    case GoalKind.Population: {
      const current = town.population();
      const have = goal.branch === GoalBranch.Core && lessonPassed(town, goal) ? Math.max(goal.count, current) : current;
      return { have, need: goal.count, label: `${have} / ${goal.count} residents` };
    }
    case GoalKind.Floor:
      return progressOfDeed(town, 'floors', goal.count);
    case GoalKind.Seal: {
      const { sealed, total } = sealProgress(town),
        need = goal.count || total;
      return { have: sealed, need, label: deedLabel('seals', sealed, need) };
    }
    case GoalKind.Deed:
      if (goal.deed) return progressOfDeed(town, goal.deed, goal.count);
      break;
    case GoalKind.Craft:
      return craftProgress(town, goal);
    case GoalKind.Equip: {
      const have = lessonPassed(town, goal) ? Math.max(goal.count, residentsEquipped(town)) : residentsEquipped(town);
      return { have, need: goal.count, label: `${have} / ${goal.count} residents with a tool or a weapon` };
    }
    case GoalKind.Station: {
      const have = stationLevelReached(town, goal.building),
        working = ownResidents(town).find(
          (p) => p.task === Activity.Crafting && craftOrder(p.craftItem)?.kind === 'station' && town.building(p.craftWorkshop)?.kind === goal.building,
        );
      if (have >= goal.count) return { have: goal.count, need: goal.count, label: `Level ${have}` };
      if (working) {
        const order = craftOrder(working.craftItem)!,
          share = Math.min(1, working.craftProgress / orderSeconds(order, goal.building));
        return { have: have + share, need: goal.count, label: `Upgrading · ${Math.trunc(share * 100)}%` };
      }
      return { have, need: goal.count, label: have ? `Level ${have} / ${goal.count}` : '' };
    }
  }
  return { have: 0, need: 1, label: '' };
}
function craftProgress(town: Town, goal: SettlementGoal): GoalProgress {
  const have = itemsOwned(town, goal.items),
    need = goal.count;
  if (have >= need || lessonPassed(town, goal)) return { have: Math.max(have, need), need, label: 'Crafted' };
  const crafting = ownResidents(town).find(
    (p) => p.task === Activity.Crafting && goal.items.includes(orderItem(p.craftItem)?.id ?? ''),
  );
  if (crafting) {
    const item = orderItem(crafting.craftItem)!,
      share = Math.min(1, crafting.craftProgress / orderSeconds(craftOrder(crafting.craftItem)!, null));
    return { have: have + share, need, label: `Crafting ${item.name} · ${Math.trunc(share * 100)}%` };
  }
  // Show the ingredients that can actually be paid from this settlement.
  const camp = town.camp(),
    village = camp ? town.settlementOf(camp) : -1,
    stock = camp ? town.stock(village) : null,
    recipes = goal.items
      .filter((id) => itemsOwned(town, [id]) === 0)
      .map((id) => itemSpec(id)!)
      .map((item) => ({ item, cost: madeFrom(item) ? upgradeCost(item) : item.cost }));
  const total = (recipe: (typeof recipes)[number]) => resourceProducts.reduce((sum, p) => sum + resourceAmount(recipe.cost, p), 0);
  const missing = recipes.sort((a, b) => total(a) - total(b))[0];
  const prefix = need > 1 ? `${have} / ${need} crafted · ` : '';
  if (!missing || !stock) return { have, need, label: `${have} / ${need} crafted` };
  const residents = ownResidents(town).filter((p) => town.settlementOf(p) === village && !town.inRealm(p.position));
  for (const product of resourceProducts) {
    const required = resourceAmount(missing.cost, product);
    if (!required) continue;
    const ready = residents.reduce((sum, p) => sum + heldAmount(p, product), resourceAmount(stock, product));
    if (ready < required)
      return { have, need, label: `${prefix}${productItem(product)!.name} ${ready} / ${required} for ${missing.item.name}` };
  }
  return { have, need, label: `${prefix}Ready to craft ${missing.item.name}` };
}
function progressOfDeed(town: Town, deed: DeedKey, need: number): GoalProgress {
  const have = deedCount(town, deed);
  return { have, need, label: deedLabel(deed, have, need) };
}
/** Index of the first unfinished goal on a branch, or -1 when the branch is done. */
export function currentGoal(town: Town, branch: GoalBranch): number {
  return goals.findIndex((goal) => goal.branch === branch && !goalComplete(town, goal));
}
