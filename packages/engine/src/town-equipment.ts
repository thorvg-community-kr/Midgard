import type { Town } from './town';
import { Activity, Role, type Person } from './person';
import { Product, Resources, Structure, isSeat, structureSpec, productKeys, resourceProducts } from './building-catalog';
import { heldAmount, stowCargo, takeHeld } from './carried-resources';
import { canControl } from './faction';
import { add, distance, normalized, point, rotated, scale, sub, type Point } from './geometry';
import type { Building } from './town-models';
import { resourceAmount, resourceBundle } from './construction-materials';
import { harvestDuration } from './work-timing';
import { TownState } from './town-state';
import { Boon, boon, boonRules } from './gate-boons';
import { levelVariant, stationLevel, stationStep } from './craft-stations';
import { craftOrder, orderCost, orderItem, orderSeconds, stationOrder, upgradeOrder, type CraftOrder } from './craft-orders';
import { completedFacility, deedCount, type UnlockRequirement } from './settlement-progression';
import { weaponSchool } from './progression-rules';
import {
  addInventory,
  aMake,
  backpackSize,
  carriedMake,
  craftsAt,
  equipmentSlots,
  equippedItem,
  isCraftStation,
  isShield,
  inventoryRoom,
  itemSpec,
  lineOf,
  madeFrom,
  nextMake,
  productItem,
  stationKinds,
  upgradeCost,
  upperTier,
  workEfficiency,
  type EquipmentSlot,
  type ItemSpec,
} from './equipment';
import { gearEffect } from './gear-stats';

function activeHarvestDuration(person: Person): number {
  return !person.moving() &&
    !person.crossingDoorway() &&
    (person.activity === Activity.Felling || person.activity === Activity.Mining)
    ? harvestDuration(person, person.activity === Activity.Mining)
    : 0;
}
function retimeHarvest(person: Person, time: number, before: number): void {
  if (!before) return;
  // Gear changes the rate of the unfinished work, not how much was completed.
  person.until = time + (Math.max(0, person.until - time) * activeHarvestDuration(person)) / before;
}

export function equipItem(
  this: Town,
  personId: number,
  inventorySlot: number,
  requested?: EquipmentSlot,
): boolean {
  const person = this.person(personId),
    stack = person?.inventory[inventorySlot - 1],
    item = stack && itemSpec(stack.item);
  if (
    !person ||
    !canControl(person, this.controlFaction) ||
    !item ||
    stack.quantity !== 1 ||
    item.minimumLevel > person.level
  )
    return false;
  const slot = requested ?? item.slots.find((slot) => person.equipment[slot] < 0) ?? item.slots[0];
  if (!slot || !item.slots.includes(slot) || equipBlock(person, item, slot)) return false;
  const harvestBefore = activeHarvestDuration(person);
  for (const other of equipmentSlots)
    if (person.equipment[other] === inventorySlot) person.equipment[other] = -1;
  person.equipment[slot] = inventorySlot;
  // A two-handed weapon puts the shield away; it stays in the pack.
  if (slot === 'weapon' && item.hands === 2 && isShield(equippedItem(person, 'offhand'))) person.equipment.offhand = -1;
  retimeHarvest(person, this.time, harvestBefore);
  ++person.lookRevision;
  ++this.changes;
  return true;
}
export function unequipItem(this: Town, personId: number, slot: EquipmentSlot): boolean {
  const person = this.person(personId);
  if (
    !person ||
    !canControl(person, this.controlFaction) ||
    !equipmentSlots.includes(slot) ||
    person.equipment[slot] < 0
  )
    return false;
  const harvestBefore = activeHarvestDuration(person);
  person.equipment[slot] = -1;
  retimeHarvest(person, this.time, harvestBefore);
  ++person.lookRevision;
  ++this.changes;
  return true;
}
export function transferInventory(this: Town, personId: number, from: number, to: number): boolean {
  const p = this.person(personId);
  if (
    !p ||
    !canControl(p, this.controlFaction) ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from > backpackSize ||
    to > backpackSize ||
    from === to
  )
    return false;
  if (from === 0) {
    const item = productItem(p.carriedProduct),
      target = p.inventory[to - 1];
    if (
      !item ||
      p.carrying <= 0 ||
      (target && target.item !== item.id) ||
      (target?.quantity ?? 0) + p.carrying > item.maximumStack
    )
      return false;
    p.inventory[to - 1] = { item: item.id, quantity: (target?.quantity ?? 0) + p.carrying };
    p.carrying = 0;
  } else if (to === 0) {
    const stack = p.inventory[from - 1],
      item = stack && itemSpec(stack.item);
    if (!stack || !item || item.category !== 'resource' || (p.carrying && p.carriedProduct !== item.product))
      return false;
    if (p.carrying + stack.quantity > item.maximumStack) return false;
    p.carriedProduct = item.product;
    p.carrying += stack.quantity;
    p.inventory[from - 1] = null;
  } else {
    const a = p.inventory[from - 1],
      b = p.inventory[to - 1];
    if (!a) return false;
    const item = itemSpec(a.item)!;
    if (b?.item === a.item && item.maximumStack > 1) {
      if (a.quantity + b.quantity > item.maximumStack) return false;
      b.quantity += a.quantity;
      p.inventory[from - 1] = null;
    } else {
      p.inventory[from - 1] = b;
      p.inventory[to - 1] = a;
      for (const slot of equipmentSlots) {
        if (p.equipment[slot] === from) p.equipment[slot] = to;
        else if (p.equipment[slot] === to) p.equipment[slot] = from;
      }
    }
  }
  ++this.changes;
  return true;
}
export function inventoryTransferReason(this: Town, personId: number): string {
  const p = this.person(personId);
  if (!p || !canControl(p, this.controlFaction)) return 'Select a controllable resident';
  const village = this.settlementOf(p),
    camp = this.camp(village);
  if (!camp || camp.faction !== p.faction || !camp.built()) return 'A completed home camp is required';
  const storage = this.placed.some(
    (b) =>
      b.built() &&
      b.faction === p.faction &&
      this.settlementOf(b) === village &&
      (isSeat(b.kind) ||
        b.kind === Structure.Storehouse ||
        b.kind === Structure.WoodStore ||
        b.kind === Structure.StoneStore ||
        b.kind === Structure.Granary) &&
      (distance(p.position, b.door()) <= 2.5 || (p.inside && distance(p.entrance, b.door()) < 0.05)),
  );
  return storage ? '' : 'Move closer to your settlement storage';
}
export function withdrawInventory(this: Town, personId: number, product: Product, quantity: number): boolean {
  if (this.inventoryTransferReason(personId) || !Number.isSafeInteger(quantity) || quantity <= 0)
    return false;
  const p = this.person(personId)!,
    item = productItem(product),
    stock = this.stock(this.settlementOf(p));
  if (!item || resourceAmount(stock, product) < quantity || inventoryRoom(p, item.id) < quantity)
    return false;
  if (!addInventory(p, item.id, quantity)) return false;
  stock.subtract(resourceBundle(product, quantity));
  ++this.changes;
  return true;
}
export function depositInventory(this: Town, personId: number, slot: number, quantity?: number): boolean {
  if (this.inventoryTransferReason(personId) || !Number.isInteger(slot) || slot < 0 || slot > backpackSize)
    return false;
  const p = this.person(personId)!,
    stack = slot ? p.inventory[slot - 1] : null,
    item = slot ? stack && itemSpec(stack.item) : productItem(p.carriedProduct),
    available = slot ? (stack?.quantity ?? 0) : p.carrying,
    count = quantity ?? available,
    village = this.settlementOf(p);
  if (
    !item ||
    item.category !== 'resource' ||
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    count > available
  )
    return false;
  const stock = this.stock(village),
    capacity = this.capacity(village);
  if (
    resourceAmount(stock, item.product) + count > resourceAmount(capacity, item.product) &&
    ![Product.Goods, Product.Mana].includes(item.product)
  )
    return false;
  this.store(resourceBundle(item.product, count), village);
  if (!slot) p.carrying -= count;
  else {
    stack!.quantity -= count;
    if (!stack!.quantity) p.inventory[slot - 1] = null;
  }
  ++this.changes;
  return true;
}
/** Recipes draw on the settlement store first, then on what the crafter carries, then on local helpers' packs. */
export function craftCovered(stock: Resources, p: Person, cost: Resources, helpers: readonly Person[] = []): boolean {
  return resourceProducts.every((product) => {
    const need = resourceAmount(cost, product) - resourceAmount(stock, product);
    return need <= 0 || heldAmount(p, product) + helpers.reduce((sum, q) => sum + heldAmount(q, product), 0) >= need;
  });
}
function payCraft(stock: Resources, p: Person, cost: Resources, helpers: readonly Person[] = []): void {
  for (const product of resourceProducts) {
    let need = resourceAmount(cost, product);
    if (!need) continue;
    const key = productKeys[product]!, stored = Math.min(need, stock[key]);
    stock[key] -= stored;
    need -= stored;
    if (need > 0) need -= takeHeld(p, product, need);
    for (const q of helpers) {
      if (need <= 0) break;
      need -= takeHeld(q, product, need);
    }
  }
}
/** The foundry delivers one unit straight to its village; gear goes to the resident. */
function outputFits(town: Town, p: Person, workshop: Building, item: ItemSpec): boolean {
  if (item.category !== 'resource') return inventoryRoom(p, item.id) >= 1;
  const village = town.settlementOf(workshop);
  return resourceAmount(town.stock(village), item.product) < resourceAmount(town.capacity(village), item.product);
}
/** Residents of the station's settlement whose packs count as settlement materials, nearest first. */
export function craftHelpers(this: Town, p: Person, workshop: Building): Person[] {
  const village = this.settlementOf(workshop),
    door = workshop.door(), beyondGate = this.inRealm(door);
  return this.folk
    .filter(
      (q) =>
        q !== p &&
        q.role === Role.Resident &&
        q.health > 0 &&
        q.faction === workshop.faction &&
        this.settlementOf(q) === village && this.inRealm(q.position) === beyondGate,
    )
    .sort((a, b) => distance(a.position, door) - distance(b.position, door) || a.id - b.id);
}
const stationName = (kind: Structure): string => structureSpec(kind).name.toLowerCase();
const levelReason = (kind: Structure, level: number): string => `Needs a level ${level} ${stationName(kind)}`;
/** The highest level a finished station of `kind` has reached in `village`; 0 with none. */
export function stationLevelIn(this: Town, kind: Structure, village: number): number {
  let best = 0;
  for (const b of this.placed)
    if (b.kind === kind && b.built() && b.faction === this.controlFaction && this.settlementOf(b) === village)
      best = Math.max(best, stationLevel(b));
  return best;
}
/** What raising this station to its next level asks of the settlement, cost aside; empty at the top. */
export function stationNeeds(this: Town, stationId: number): UnlockRequirement[] {
  const station = this.building(stationId),
    next = station ? stationStep(station.kind, stationLevel(station) + 1) : null;
  if (!station || !next) return [];
  const out: UnlockRequirement[] = [],
    village = this.settlementOf(station);
  for (const kind of next.after)
    out.push({ text: 'Complete ' + structureSpec(kind).name, done: completedFacility(this, kind) });
  if (next.cost.planks) out.push({ text: 'Complete Sawmill', done: completedFacility(this, Structure.Sawmill) });
  if (next.cost.cutStone) out.push({ text: 'Complete Stoneworks', done: completedFacility(this, Structure.Stoneworks) });
  if (next.station)
    out.push({
      text: levelReason(next.station.kind, next.station.level),
      done: this.stationLevelIn(next.station.kind, village) >= next.station.level,
    });
  if (next.floors) out.push({ text: 'Seal a dungeon', done: deedCount(this, 'floors') >= next.floors });
  if (next.residents)
    out.push({ text: 'Needs ' + next.residents + ' residents', done: this.population() >= next.residents });
  return out;
}
/** Why `personId` cannot take an order at the station now, before materials; '' when they can. */
function orderBlock(town: Town, p: Person | null, workshop: Building | null, text: string): string {
  if (!p || !canControl(p, town.controlFaction)) return 'Select a controllable resident';
  if (!workshop || !workshop.built() || !isCraftStation(workshop.kind)) return 'A completed matching workshop is required';
  if (workshop.faction !== p.faction || town.settlementOf(workshop) !== town.settlementOf(p) ||
      town.inRealm(workshop.center) !== town.inRealm(p.position))
    return 'Use a workshop in this resident’s settlement';
  if (p.craftItem && (p.craftItem !== text || p.craftWorkshop !== workshop.id))
    return 'Finish or cancel the current crafting order';
  return '';
}
/**
 * Why `personId` cannot have `itemId` made at the station now; '' when they can. The first make of a kind is made
 * new; every better make is the one below it, upgraded.
 */
export function craftReason(this: Town, personId: number, workshopId: number, itemId: string): string {
  const p = this.person(personId),
    workshop = this.building(workshopId),
    item = itemSpec(itemId);
  if (!p || !canControl(p, this.controlFaction)) return 'Select a controllable resident';
  if (!item || item.workshop === null) return 'This item cannot be crafted';
  if (!workshop || !workshop.built() || !craftsAt(item, workshop.kind))
    return item.workshop === Structure.Workbench
      ? 'Build a workbench first'
      : item.workshop === Structure.Weaponsmith
        ? 'Build a smithy first'
        : 'A completed matching workshop is required';
  const upgrade = upgradeSource(p, item) > 0,
    blocked = orderBlock(this, p, workshop, upgrade ? upgradeOrder(itemId) : itemId);
  if (blocked) return blocked;
  const school = missingWeaponSchool(this, item);
  if (school !== undefined) return 'Complete ' + structureSpec(school).name;
  if (stationLevel(workshop) < item.stationLevel) return levelReason(workshop.kind, item.stationLevel);
  const below = madeFrom(item);
  if (!upgrade && below) return `Made by upgrading ${aMake(below)}`;
  // Nobody makes what they cannot yet use: an upgrade would take the weaker make out of their hands.
  if (item.minimumLevel > p.level) return `Needs level ${item.minimumLevel}`;
  if (!upgrade && !outputFits(this, p, workshop, item))
    return item.category === 'resource' ? 'The village stores are full' : 'The inventory is full';
  if (!upgrade && !craftCovered(this.stock(this.settlementOf(workshop)), p, item.cost, this.craftHelpers(p, workshop)))
    return 'Not enough settlement materials';
  return '';
}
function missingWeaponSchool(town: Town, item: ItemSpec): Structure | undefined {
  const school = weaponSchool(item);
  if (school !== undefined && !completedFacility(town, school)) return school;
}
/** The pack slot (1-based) holding the make this resident would turn into `target`, the equipped one first; 0 with none. */
export function upgradeSource(p: Person, target: ItemSpec): number {
  let found = 0;
  p.inventory.forEach((stack, index) => {
    const item = stack ? itemSpec(stack.item) : null;
    if (!item || upperTier(item)?.id !== target.id) return;
    const worn = equipmentSlots.some((slot) => p.equipment[slot] === index + 1);
    if (!found || worn) found = index + 1;
  });
  return found;
}
/** Why `personId` cannot raise the station to its next level; '' when they can. */
export function stationUpgradeReason(this: Town, personId: number, workshopId: number): string {
  const p = this.person(personId),
    workshop = this.building(workshopId),
    next = workshop ? stationStep(workshop.kind, stationLevel(workshop) + 1) : null;
  if (workshop && isCraftStation(workshop.kind) && !next) return 'Already at the highest level';
  const blocked = orderBlock(this, p, workshop, next ? stationOrder(next.level) : '');
  if (blocked || !next || !workshop) return blocked || 'A completed matching workshop is required';
  if (this.folk.some((q) => q !== p && q.task === Activity.Crafting && q.craftWorkshop === workshop.id && craftOrder(q.craftItem)?.kind === 'station'))
    return 'Someone is already upgrading it';
  const missing = this.stationNeeds(workshop.id).find((r) => !r.done);
  if (missing) return missing.text;
  return '';
}
/** The make of each kind this resident would get next at the station, and why not now (''): what they can order. */
export function craftOptions(this: Town, personId: number, workshopId: number) {
  const workshop = this.building(workshopId),
    p = this.person(personId);
  if (!workshop || !p) return [];
  return stationKinds(workshop.kind).flatMap((first) => {
    const item = nextMake(p, first);
    return item ? [{ item, reason: this.craftReason(personId, workshopId, item.id) }] : [];
  });
}
/** What the settlement's next order of one kind at a station would be. */
export interface CraftOffer {
  /** The make the order gives; with `open` false, the make already carried or on order. */
  item: ItemSpec;
  /** Who gets it: the nearest resident with none of the kind, else the nearest whose make can be bettered; null with nobody free. */
  who: Person | null;
  /** False when nothing of the kind can be ordered: everyone carries it and no better make is open to them. */
  open: boolean;
  /** Why the order cannot be given now; '' when it can. */
  reason: string;
}
export const nobodyFree = 'Nobody is free to make it';
/** Residents of the station's settlement the player commands, on its side of the gate, nearest the station first. */
export function stationFolk(this: Town, workshop: Building): Person[] {
  const village = this.settlementOf(workshop),
    door = workshop.door(),
    beyondGate = this.inRealm(door);
  return this.folk
    .filter(
      (p) =>
        p.role === Role.Resident &&
        p.health > 0 &&
        p.activity !== Activity.Downed &&
        p.faction === workshop.faction &&
        canControl(p, this.controlFaction) &&
        this.settlementOf(p) === village &&
        this.inRealm(p.position) === beyondGate,
    )
    .sort((a, b) => distance(a.position, door) - distance(b.position, door) || a.id - b.id);
}
const ordered = (p: Person): boolean => p.task === Activity.Crafting && !!p.craftItem;
/**
 * One row a kind for the settlement: the station picks who gets the item. First the nearest free resident who has
 * none of the kind and may use its first make; with none, the nearest whose make this station can better now. A
 * resident with a craft order is not free, so a second order of a kind goes to the next resident. A refined
 * material is nobody's gear: the nearest free resident does the work, and its row can always be ordered again.
 */
export function craftOffers(this: Town, workshopId: number): CraftOffer[] {
  const workshop = this.building(workshopId);
  if (!workshop || !workshop.built() || !isCraftStation(workshop.kind)) return [];
  const folk = this.stationFolk(workshop),
    free = folk.filter((p) => !ordered(p)),
    level = stationLevel(workshop),
    out: CraftOffer[] = [];
  for (const first of stationKinds(workshop.kind)) {
    if (missingWeaponSchool(this, first) !== undefined) continue;
    const give = (list: readonly Person[], make: (p: Person) => ItemSpec | null): CraftOffer | null => {
      let fallback: CraftOffer | null = null;
      for (const p of list) {
        const item = make(p);
        if (!item || item.stationLevel > level || item.minimumLevel > p.level) continue;
        const offer = { item, who: p, open: true, reason: this.craftReason(p.id, workshopId, item.id) };
        if (!offer.reason) return offer;
        fallback ??= offer;
      }
      return fallback;
    };
    if (first.category === 'resource') {
      out.push(give(free, () => first) ?? { item: first, who: null, open: true, reason: nobodyFree });
      continue;
    }
    const lacks = (p: Person) => !carriedMake(p, first),
      offer =
        give(free.filter(lacks), () => first) ??
        give(
          free.filter((p) => !lacks(p)),
          (p) => nextMake(p, first),
        );
    if (offer) {
      out.push(offer);
      continue;
    }
    const kind = lineOf(first),
      maker = folk.find((p) => {
        const item = ordered(p) ? orderItem(p.craftItem) : null;
        return !!item && (item.id === first.id || (item.tier > 0 && first.tier > 0 && lineOf(item) === kind));
      }),
      holders = folk.filter((p) => !lacks(p)),
      holder = holders.find((p) => upperTier(carriedMake(p, first)!)) ?? holders[0];
    if (maker) out.push({ item: orderItem(maker.craftItem)!, who: maker, open: false, reason: '' });
    else if (first.stationLevel <= level && folk.some((p) => ordered(p) && lacks(p) && first.minimumLevel <= p.level))
      out.push({ item: first, who: null, open: true, reason: nobodyFree });
    else if (holder) out.push({ item: carriedMake(holder, first)!, who: holder, open: false, reason: '' });
  }
  return out;
}
/** Orders `itemId` for the settlement: whoever `craftOffers` names walks to the station and makes it. */
export function orderSettlementCraft(this: Town, workshopId: number, itemId: string): boolean {
  const offer = this.craftOffers(workshopId).find((o) => o.open && o.item.id === itemId);
  return !!offer?.who && !offer.reason && this.orderCraft(offer.who.id, workshopId, itemId);
}
/** Who raises the station to its next level: whoever is at it already, else the nearest free resident who can now, else the nearest free one. */
export function stationUpgrader(this: Town, workshopId: number): Person | null {
  const workshop = this.building(workshopId);
  if (!workshop || !isCraftStation(workshop.kind)) return null;
  const folk = this.stationFolk(workshop),
    free = folk.filter((p) => !ordered(p));
  return (
    folk.find((p) => ordered(p) && p.craftWorkshop === workshopId && craftOrder(p.craftItem)?.kind === 'station') ??
    free.find((p) => !this.stationUpgradeReason(p.id, workshopId)) ??
    free[0] ??
    null
  );
}
/** At a workbench the resident takes the last half-step from the approach to its working edge. */
export function craftSpot(this: Town, workshop: Building): Point {
  const door = workshop.door();
  if (workshop.kind !== Structure.Workbench && workshop.kind !== Structure.Weaponsmith) return door;
  const along = workshop.kind === Structure.Weaponsmith ? -0.07 : 0;
  const edge = add(workshop.center, rotated(point(along, workshop.footprint().half + 0.1), workshop.angle));
  return this.grid.walkable(edge) && this.grid.clear(door, edge, Infinity, true) ? edge : door;
}
/** Where a resident waits for a busy station: a pace to the side of the work spot. */
export function craftWaitSpot(this: Town, workshop: Building): Point {
  const door = workshop.door(),
    out = normalized(sub(door, workshop.center));
  return this.grid.nearestWalkable(add(door, scale(point(-out.y, out.x), 0.7)));
}
const crafting = (p: Person, id: number): boolean =>
  p.health > 0 && p.task === Activity.Crafting && p.craftWorkshop === id;
/** The resident working the station now, or null. One works a station at a time. */
export function craftingAt(this: Town, workshopId: number): Person | null {
  return this.folk.find(p => p.health > 0 && p.task === Activity.Crafting && p.activity === Activity.Crafting && (p.refining ? p.target : p.craftWorkshop) === workshopId) ?? null;
}
/** Residents with an order at the station who are on their way or waiting their turn. */
export function craftQueue(this: Town, workshopId: number): Person[] {
  return this.folk.filter((p) => crafting(p, workshopId) && (p.activity !== Activity.Crafting || p.refining !== Product.None));
}
function placeOrder(town: Town, p: Person, workshop: Building, text: string): boolean {
  if (p.craftItem === text && p.craftWorkshop === workshop.id && p.task === Activity.Crafting) return false;
  if (!town.walkTo(p, workshop.door())) return false;
  town.setOrder(p, Activity.Crafting, workshop.id);
  p.craftItem = text;
  p.craftWorkshop = workshop.id;
  p.craftProgress = 0;
  town.resumeCraftOrder(p);
  return true;
}
/** Sends the resident to make the item: new for the first make of a kind, else by turning their weaker make into it. */
export function orderCraft(this: Town, personId: number, workshopId: number, itemId: string): boolean {
  if (this.craftReason(personId, workshopId, itemId)) return false;
  const p = this.person(personId)!;
  return placeOrder(this, p, this.building(workshopId)!, upgradeSource(p, itemSpec(itemId)!) ? upgradeOrder(itemId) : itemId);
}
/** Sends the resident to raise the station to its next level. */
export function orderStationUpgrade(this: Town, personId: number, workshopId: number): boolean {
  if (this.stationUpgradeReason(personId, workshopId)) return false;
  const workshop = this.building(workshopId)!;
  return placeOrder(this, this.person(personId)!, workshop, stationOrder(stationLevel(workshop) + 1));
}
export function finishCraftOrder(this: Town, p: Person): void {
  p.craftItem = null;
  p.craftWorkshop = -1;
  p.craftProgress = 0;
  p.refining = Product.None;
  p.refineProgress = 0;
  p.path = [];
  p.task = Activity.Idle;
  p.taskSite = -1;
  p.ordered = p.approachingOrder = false;
  p.autoMode = true;
  p.activity = Activity.Idle;
  p.until = this.time;
}
/** What an order makes, in a notice: "the Iron sword", or "the smithy's next level". */
export function orderName(this: Town, p: Person): string {
  const order = craftOrder(p.craftItem),
    station = this.building(p.craftWorkshop);
  if (!order) return '';
  return order.kind === 'station'
    ? `${station ? structureSpec(station.kind).name : 'station'} level ${order.level}`
    : order.item.name;
}
/** Drops a resident's craft order. Nothing is paid until the item is done, so nothing is lost; the next in line takes the station. */
export function cancelCraft(this: Town, personId: number): boolean {
  const p = this.person(personId);
  if (!p || p.health <= 0 || !canControl(p, this.controlFaction) || p.task !== Activity.Crafting || !p.craftItem)
    return false;
  const name = this.orderName(p);
  this.commanded();
  this.finishCraftOrder(p);
  if (name) this.notify(`${p.name} stopped making the ${name}`);
  ++this.changes;
  return true;
}
/** The order still makes sense at this station: the right workshop, its level, and for an upgrade the old item. */
function orderValid(town: Town, p: Person, workshop: Building | null, order: CraftOrder | null): workshop is Building {
  if (
    !workshop ||
    !workshop.built() ||
    !order ||
    workshop.faction !== p.faction ||
    town.settlementOf(workshop) !== town.settlementOf(p)
  )
    return false;
  if (order.kind === 'station') return stationLevel(workshop) + 1 === order.level && !!stationStep(workshop.kind, order.level);
  return (
    craftsAt(order.item, workshop.kind) &&
    missingWeaponSchool(town, order.item) === undefined &&
    stationLevel(workshop) >= order.item.stationLevel &&
    (order.kind === 'make' || upgradeSource(p, order.item) > 0)
  );
}
/** Missing goods are calculated again after every trip. Another resident can supply them in the meantime. */
export function missingUpgradeMaterials(this: Town, p: Person, workshop: Building, cost: Resources): Resources {
  const stock = this.stock(this.settlementOf(workshop)), helpers = this.craftHelpers(p, workshop), missing = new Resources();
  for (const product of resourceProducts) {
    const key = productKeys[product]!, short = cost[key] - stock[key] - heldAmount(p, product);
    if (short > 0) missing[key] = Math.max(0, short - helpers.reduce((sum, helper) => sum + heldAmount(helper, product), 0));
  }
  return missing;
}
const harvestable = [Product.Wood, Product.Stone, Product.IronOre, Product.CinderOre, Product.Frostwood];
/** Fetch one missing input, or make a single batch at a local processor. Foundry recipes form a finite tree. */
function obtainMaterials(town: Town, p: Person, station: Building, missing: Resources): boolean {
  for (const product of harvestable) {
    if (!resourceAmount(missing, product)) continue;
    if (town.startHarvest(p, station.center, TownState.campReach, product) ||
        town.startHarvest(p, station.center, Math.hypot(town.map().width(), town.map().height()), product)) return true;
  }
  for (const product of [Product.Planks, Product.CutStone]) {
    if (resourceAmount(missing, product) && town.produceConstructionMaterial(p, product)) return true;
  }
  for (const product of [Product.IronIngot, Product.BoundFrostwood, Product.Embersteel]) {
    if (!resourceAmount(missing, product)) continue;
    const recipe = productItem(product)!;
    const forges = town.buildings().filter(b => b.kind === Structure.Foundry && b.built() &&
      b.faction === p.faction && town.settlementOf(b) === town.settlementOf(station) && town.inRealm(b.center) === town.inRealm(p.position));
    forges.sort((a, b) => distance(p.position, a.door()) - distance(p.position, b.door()) || a.id - b.id);
    for (const forge of forges) {
      const inputs = town.missingUpgradeMaterials(p, forge, recipe.cost);
      if (!inputs.empty()) {
        if (obtainMaterials(town, p, forge, inputs)) return true;
        break;
      }
      if (!outputFits(town, p, forge, recipe) || !town.walkTo(p, forge.door())) continue;
      if (p.refining !== product) p.refineProgress = 0;
      p.refining = product;
      return goToCraftSpot.call(town, p, forge);
    }
  }
  return false;
}
function supplyUpgrade(town: Town, p: Person, station: Building, order: CraftOrder): boolean {
  if (order.kind === 'make') return false;
  const missing = town.missingUpgradeMaterials(p, station, orderCost(order, station.kind)!);
  if (missing.empty()) return false;
  if (p.carrying) {
    const input = (missing.planks && p.carriedProduct === Product.Wood) || (missing.cutStone && p.carriedProduct === Product.Stone);
    if ((input || !stowCargo(p)) && town.haulCargo(p)) return true;
  }
  if (obtainMaterials(town, p, station, missing)) return true;
  p.activity = Activity.WaitingMaterials;
  p.target = station.id;
  p.path = [];
  p.until = town.clock() + 3;
  return true;
}
/** After each supply trip, recheck what the upgrade actually lacks before returning to the station. */
export function resumeCraftOrder(this: Town, p: Person): boolean {
  if (p.task !== Activity.Crafting) return false;
  const workshop = this.building(p.craftWorkshop);
  const order = craftOrder(p.craftItem);
  if (!order || !orderValid(this, p, workshop, order)) {
    this.finishCraftOrder(p);
    return false;
  }
  if (supplyUpgrade(this, p, workshop, order)) return true;
  p.refining = Product.None;
  p.refineProgress = 0;
  return goToCraftSpot.call(this, p, workshop);
}
/** Walk to the working edge or wait beside it while another resident is using it. */
function goToCraftSpot(this: Town, p: Person, workshop: Building): boolean {
  const other = this.craftingAt(workshop.id),
    taken = !!other && other.id !== p.id,
    spot = taken ? this.craftWaitSpot(workshop) : this.craftSpot(workshop);
  p.target = workshop.id;
  if (p.inside || distance(p.position, spot) > 0.05) {
    // Follow the station's usual approach, then step up to the work surface. Its edge can share a
    // grid cell with the bench, so only that last, already clear stretch belongs outside the route.
    const door = !taken ? workshop.door() : spot;
    const atApproach = !p.inside && distance(p.position, spot) <= distance(door, spot)
      && this.grid.clear(p.position, spot, Infinity, true);
    const approach = atApproach ? spot : door;
    if (this.walkTo(p, approach)) {
      if (distance(approach, spot) > 0.001) p.path.push(spot);
      p.activity = Activity.Moving;
    } else {
      p.activity = Activity.Holding;
      p.path = [];
      p.until = this.time + 1;
    }
    return true;
  }
  p.path = [];
  if (taken) {
    p.activity = Activity.Holding;
    p.until = this.time + 0.5;
    return true;
  }
  p.activity = Activity.Crafting;
  p.until = this.time;
  return true;
}
/** Share of the current order done, 0 to 1. */
export function craftShare(this: Town, p: Person): number {
  const order = craftOrder(p.craftItem),
    station = this.building(p.craftWorkshop);
  return order ? Math.min(1, p.craftProgress / orderSeconds(order, station?.kind ?? null)) : 0;
}
function refineForUpgrade(town: Town, p: Person, order: CraftOrder, parent: Building, dt: number): void {
  const forge = town.building(p.target), recipe = productItem(p.refining);
  if (!forge?.built() || forge.kind !== Structure.Foundry || !recipe || recipe.workshop !== forge.kind ||
      p.inside || distance(p.position, town.craftSpot(forge)) > 0.05 ||
      town.missingUpgradeMaterials(p, parent, orderCost(order, parent.kind)!).empty()) {
    town.resumeCraftOrder(p);
    return;
  }
  const stock = town.stock(town.settlementOf(forge)), helpers = town.craftHelpers(p, forge);
  if (!craftCovered(stock, p, recipe.cost, helpers) || !outputFits(town, p, forge, recipe)) {
    town.resumeCraftOrder(p);
    return;
  }
  p.refineProgress += dt * workEfficiency(p, 'crafting') / (boon(town, Boon.Forge) ? boonRules.forgeSeconds : 1);
  if (p.refineProgress + 1e-6 < recipe.seconds) return;
  payCraft(stock, p, recipe.cost, helpers);
  town.store(resourceBundle(recipe.product, 1), town.settlementOf(forge));
  p.refining = Product.None;
  p.refineProgress = 0;
  ++town.changes;
  town.resumeCraftOrder(p);
}
export function advanceCrafting(this: Town, p: Person, dt: number): void {
  if (p.task !== Activity.Crafting || !p.craftItem || p.moving() || p.crossingDoorway()) return;
  const workshop = this.building(p.craftWorkshop),
    order = craftOrder(p.craftItem);
  if (!order || !orderValid(this, p, workshop, order)) {
    this.finishCraftOrder(p);
    return;
  }
  if (p.refining !== Product.None) return refineForUpgrade(this, p, order, workshop, dt);
  if (p.inside || distance(p.position, this.craftSpot(workshop)) > 0.05) {
    this.resumeCraftOrder(p);
    return;
  }
  const stock = this.stock(this.settlementOf(workshop)),
    cost = orderCost(order, workshop.kind)!,
    helpers = this.craftHelpers(p, workshop);
  if (!craftCovered(stock, p, cost, helpers) || (order.kind === 'make' && !outputFits(this, p, workshop, order.item))) {
    if (!supplyUpgrade(this, p, workshop, order)) p.until = this.time + 1;
    return;
  }
  // Progress stays in item seconds; the Forge boon makes it run faster.
  p.craftProgress +=
    (Math.max(0, dt) * workEfficiency(p, 'crafting')) / (boon(this, Boon.Forge) ? boonRules.forgeSeconds : 1);
  if (p.craftProgress + 1e-6 < orderSeconds(order, workshop.kind)) return;
  if (order.kind === 'station') {
    payCraft(stock, p, cost, helpers);
    raiseStation(this, workshop, order.level);
    this.notify(`${p.name} raised the ${stationName(workshop.kind)} to level ${order.level}`);
    ++this.changes;
    this.finishCraftOrder(p);
    return;
  }
  const item = order.item;
  if (item.category === 'resource') {
    payCraft(stock, p, cost, helpers);
    this.store(resourceBundle(item.product, 1), this.settlementOf(workshop));
    this.notify(`${p.name} made ${item.name} for the village stores`);
  } else if (order.kind === 'upgrade') {
    const slot = upgradeSource(p, item),
      old = itemSpec(p.inventory[slot - 1]!.item)!;
    payCraft(stock, p, cost, helpers);
    p.inventory[slot - 1] = { item: item.id, quantity: 1 };
    // A make the owner is not yet strong enough for goes back to the pack.
    for (const s of equipmentSlots)
      if (p.equipment[s] === slot && (item.minimumLevel > p.level || !item.slots.includes(s))) p.equipment[s] = -1;
    ++p.lookRevision;
    this.notify(`${p.name} upgraded the ${old.name} to the ${item.name}`);
  } else {
    payCraft(stock, p, cost, helpers);
    if (!addInventory(p, item.id)) return;
    this.notify(`${p.name} crafted ${item.name}`);
  }
  if (item.category === 'weapon' && item.tier >= 3) ++this.chronicle.weaponsForged;
  ++this.changes;
  this.finishCraftOrder(p);
  if (item.category === 'tool') {
    if (order.kind === 'make') this.notify(`${item.name} in the pack · ${gearEffect(item)}`);
  } else if (order.kind === 'make' && item.category !== 'resource' && takeUpCrafted(this, p, item.id)) {
    const label = item.slots.includes('feet') ? `${item.name} worn` : `${item.name} in hand`;
    this.notify(`${label} · ${gearEffect(item)}`);
  }
}
/** The station shows its new level: a new look rising from the old one, as a chapel's faith does. */
function raiseStation(town: Town, station: Building, level: number): void {
  station.replaced = [{ kind: station.kind, variant: station.variant, dx: 0, dy: 0 }];
  station.variant = levelVariant(level);
  station.version = (station.version + 1) >>> 0;
  ++town.changes;
}
/** New worn gear goes straight into a free slot it fits, so its effect is felt at once. */
function takeUpCrafted(town: Town, p: Person, id: string): boolean {
  const item = itemSpec(id),
    index = p.inventory.findIndex(
      (stack, i) => stack?.item === id && !equipmentSlots.some((slot) => p.equipment[slot] === i + 1),
    ),
    slot = item?.slots.find((s) => p.equipment[s] < 0);
  return (
    !!item &&
    index >= 0 &&
    !!slot &&
    item.minimumLevel <= p.level &&
    !equipBlock(p, item, slot) &&
    town.equipItem(p.id, index + 1, slot)
  );
}
/** Why `item` cannot go into `slot` beside what is already held: a shield needs the other hand free. */
export function equipBlock(p: Person, item: ItemSpec, slot: EquipmentSlot): string {
  const weapon = equippedItem(p, 'weapon');
  if (slot === 'offhand' && isShield(item) && weapon && weapon.hands === 2)
    return `The ${weapon.name.toLowerCase()} takes both hands`;
  return '';
}
