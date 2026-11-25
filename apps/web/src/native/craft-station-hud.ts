import { Rect, Align, ButtonStyle, button, meter, well, type Color } from '../../../../packages/native-ui/src';
import { Structure, describe, structureSpec, resourceProducts, type Resources } from '../../../../packages/engine/src/building-catalog';
import type { Building } from '../../../../packages/engine/src/town-models';
import type { Town } from '../../../../packages/engine/src/town';
import { Role, type Person } from '../../../../packages/engine/src/person';
import { distance, project } from '../../../../packages/engine/src/geometry';
import { f32 } from '../../../../packages/engine/src/numeric';
import { canControl, isPlayerBuilding } from '../../../../packages/engine/src/faction';
import {
  craftsAt,
  isCraftStation,
  isShield,
  itemCatalog,
  lacksKind,
  lineOf,
  madeFrom,
  productItem,
  upgradeCost,
  upperTier,
  type ItemSpec,
} from '../../../../packages/engine/src/equipment';
import { gearFields } from '../../../../packages/engine/src/gear-stats';
import { stationLevel, stationStep, topLevel } from '../../../../packages/engine/src/craft-stations';
import { weaponSchool } from '../../../../packages/engine/src/progression-rules';
import { craftOrder, orderItem } from '../../../../packages/engine/src/craft-orders';
import { heldAmount } from '../../../../packages/engine/src/carried-resources';
import { resourceAmount } from '../../../../packages/engine/src/construction-materials';
import type { CraftOffer } from '../../../../packages/engine/src/town-equipment';
import {
  GoalBranch,
  GoalKind,
  currentGoal,
  settlementGoals,
} from '../../../../packages/engine/src/settlement-progression';
import type { GameHudApp } from './game-hud-contract';
import type { InspectorRows } from './game-progress-hud';
import { actionButton } from './hud-actions';
import { itemIcon, itemIllustration } from './item-icon';
import { tooltip, wrapText } from './game-combat-hud';
import { comparesWith, itemSheet } from './gear-item-sheet';

// The recipe group and its page shown at each station; transient, per app.
const pages = new WeakMap<object, Map<number, number>>(),
  inspectedKinds = new WeakMap<object, Map<number, string>>(),
  groups = new WeakMap<object, Map<number, RecipeGroup>>(),
  // Fits under the level rows in a laptop-height panel.
  recipesPerPage = 7;
export type RecipeGroup = 'Tools' | 'Weapons' | 'Shields' | 'Armor' | 'Gear' | 'Materials';
const groupOrder: readonly RecipeGroup[] = ['Tools', 'Weapons', 'Shields', 'Armor', 'Gear', 'Materials'];
/** Tools speed a kind of work; weapons are held to fight; shields and armor guard; gear is the rest (a knife, a basket). */
export const recipeGroup = (item: ItemSpec): RecipeGroup =>
  item.category === 'resource' ? 'Materials' : item.work.length
    ? 'Tools'
    : item.category === 'weapon'
      ? 'Weapons'
      : isShield(item)
        ? 'Shields'
        : item.category === 'armor' && (item.slots.includes('body') || item.slots.includes('head'))
          ? 'Armor'
          : 'Gear';
/**
 * What a station lists for the settlement, by group: one row for each kind, showing the make the next order would
 * give (the first for whoever has none, else the make above the nearest upgradable one). A make that waits on the
 * station's level or a resident's is not listed; a kind nobody can get more of shows the make carried.
 */
export function stationRecipes(
  town: Town,
  station: Building,
  offers: readonly CraftOffer[] = town.craftOffers(station.id),
): Map<RecipeGroup, ItemSpec[]> {
  const out = new Map<RecipeGroup, ItemSpec[]>();
  for (const group of groupOrder) {
    const list = offers.map((offer) => offer.item).filter((item) => recipeGroup(item) === group);
    if (list.length) out.set(group, list);
  }
  return out;
}
// Makes a station has only just become able to give, marked New until the player has looked at them; per game, not saved.
interface FreshMakes {
  levels: Map<number, number>;
  folk: Map<number, number>;
  schools?: Set<Structure>;
  items: Set<string>;
  viewed: Set<string>;
}
const freshMakes = new WeakMap<Town, FreshMakes>();
function freshOf(town: Town): FreshMakes {
  let fresh = freshMakes.get(town);
  if (!fresh) freshMakes.set(town, (fresh = { levels: new Map(), folk: new Map(), items: new Set(), viewed: new Set() }));
  return fresh;
}
/** Notes makes opened by a school, a higher station level or a resident's new level. */
function noteOpened(town: Town): void {
  const fresh = freshOf(town);
  const schools = new Set(town.buildings().filter(b => isPlayerBuilding(b) && b.built()).map(b => b.kind));
  const previous = fresh.schools;
  if (previous && [...schools].some(school => !previous.has(school))) {
    for (const item of itemCatalog) {
      const school = weaponSchool(item);
      if (school !== undefined && schools.has(school) && !previous.has(school)) fresh.items.add(item.id);
    }
  }
  fresh.schools = schools;
  for (const b of town.buildings()) {
    if (!isCraftStation(b.kind) || !b.built() || !isPlayerBuilding(b)) continue;
    const level = stationLevel(b),
      known = fresh.levels.get(b.id);
    if (known !== undefined && level > known)
      for (const item of itemCatalog)
        if (craftsAt(item, b.kind) && item.stationLevel > known && item.stationLevel <= level) fresh.items.add(item.id);
    fresh.levels.set(b.id, level);
  }
  for (const p of town.people()) {
    if (p.role !== Role.Resident || !canControl(p)) continue;
    const known = fresh.folk.get(p.id);
    if (known !== undefined && p.level > known)
      for (const item of itemCatalog)
        if (item.workshop !== null && item.minimumLevel > known && item.minimumLevel <= p.level) fresh.items.add(item.id);
    fresh.folk.set(p.id, p.level);
  }
}
/** The list shows `shown` now: a New make the player has looked at and left loses its mark. */
function noteViewed(town: Town, shown: readonly ItemSpec[]): void {
  const fresh = freshOf(town);
  for (const id of [...fresh.viewed])
    if (!shown.some((item) => item.id === id)) {
      fresh.viewed.delete(id);
      fresh.items.delete(id);
    }
  for (const item of shown) if (fresh.items.has(item.id)) fresh.viewed.add(item.id);
}
/** True while `item` has only just become makeable and the player has not yet turned away from it. */
export const freshMake = (town: Town, item: ItemSpec): boolean => freshMakes.get(town)?.items.has(item.id) ?? false;
/** The group shown: the player's pick, else the one holding the current quest's item, else the first. */
function shownGroup(
  app: object,
  station: Building,
  recipes: Map<RecipeGroup, ItemSpec[]>,
  wanted: readonly string[],
) {
  const picked = groups.get(app)?.get(station.id);
  if (picked && recipes.has(picked)) return picked;
  for (const [group, list] of recipes) if (list.some((item) => wanted.includes(item.id))) return group;
  return [...recipes.keys()][0] ?? 'Tools';
}
interface StationApp {
  town: Town;
  selectBuilding(id: number): void;
}
/** Selects a station, which shows what the settlement can order there; nothing starts by itself. */
export function openStation(app: StationApp, station: Building): void {
  app.selectBuilding(station.id);
}
/** The nearest finished station of `kind` in the player's settlement, or null. */
export function nearestStation(
  town: Town,
  from: { x: number; y: number },
  kind = Structure.Workbench,
): Building | null {
  return (
    town
      .buildings()
      .filter((b) => b.kind === kind && b.built() && isPlayerBuilding(b))
      .sort((a, b) => distance(a.center, from) - distance(b.center, from) || a.id - b.id)[0] ?? null
  );
}
function questItems(town: Town): readonly string[] {
  const out: string[] = [];
  for (const branch of [GoalBranch.Core, GoalBranch.Arms]) {
    const index = currentGoal(town, branch),
      goal = index >= 0 ? settlementGoals()[index] : null;
    if (goal?.kind === GoalKind.Craft) out.push(...goal.items);
  }
  return out;
}
/** What the row offers the settlement. */
export interface RecipeOffer {
  /** 'craft' makes it new; 'upgrade' turns the receiver's weaker make into it; 'none' only shows what is carried or on order. */
  action: 'craft' | 'upgrade' | 'none';
  /** Who the station gives it to, or who carries or is making what is shown. */
  who: Person | null;
  cost: Resources;
  /** Why it cannot be done now (danger), or ''. */
  reason: string;
  /** 'Everyone has one' when no resident is without the kind. */
  mark: string;
  /** Who gets it, or what a better make waits for. */
  hint: string;
}
/** What the make above `item` waits for: the station's level, or its owner's; '' when there is none or it is open. */
function waitsFor(station: Building, owner: Person, item: ItemSpec): string {
  const better = upperTier(item);
  if (!better) return '';
  if (stationLevel(station) < better.stationLevel)
    return `Upgrade at a level ${better.stationLevel} ${structureSpec(station.kind).name.toLowerCase()}`;
  return owner.level < better.minimumLevel ? `Upgrade at level ${better.minimumLevel}` : '';
}
const making = (p: Person | null, item: ItemSpec): p is Person => orderItem(p?.craftItem ?? null)?.id === item.id;
/**
 * What a recipe row offers: the first make of a kind made new for the nearest resident without one, a better make
 * as an upgrade of the nearest lesser one, or only the make carried when nobody can get more.
 */
export function recipeOffer(
  town: Town,
  station: Building,
  item: ItemSpec,
  offers: readonly CraftOffer[] = town.craftOffers(station.id),
): RecipeOffer {
  const offer = offers.find((o) => o.item.id === item.id),
    who = offer?.who ?? null;
  if (!offer) return { action: 'none', who: null, cost: item.cost, reason: '', mark: '', hint: '' };
  if (offer.open) {
    const upgrade = !!madeFrom(item);
    return {
      action: upgrade ? 'upgrade' : 'craft',
      who,
      cost: upgrade ? upgradeCost(item) : item.cost,
      reason: offer.reason,
      mark: '',
      hint: who ? `Goes to ${who.name}` : '',
    };
  }
  if (making(who, item)) return { action: 'none', who, cost: item.cost, reason: '', mark: '', hint: `${who.name} is making it` };
  const all = !town.stationFolk(station).some((p) => lacksKind(p, item));
  return { action: 'none', who, cost: item.cost, reason: '', mark: all ? 'Everyone has one' : '', hint: who ? waitsFor(station, who, item) : '' };
}
/**
 * The building's name and level head the window, with the work under way beside them: nobody is chosen as crafter,
 * so there is no face or selector. All the rows below it can use the width of the board.
 */
export function stationProfile(app: GameHudApp, station: Building, out: InspectorRows, icon: Rect): void {
  const c = app.context, t = app.theme, town = app.town, { left, inner } = out,
    name = structureSpec(station.kind).name, built = station.built(),
    level = built && topLevel(station.kind) > 1 ? `Level ${stationLevel(station)}` : '',
    size = inner < 300 ? 13 : inner < 400 ? 14 : 17,
    face = icon.w, gap = 8,
    titleWidth = Math.ceil(c.textWidth(name, size, true)) + 2,
    nameX = icon.x + face + gap,
    workX = nameX + titleWidth + gap * 2,
    workW = left + inner - workX,
    beside = workW >= 82,
    working = built ? town.craftingAt(station.id) : null,
    waiting = built ? town.craftQueue(station.id).length : 0,
    now = working ? `${working.name} is making ${town.orderName(working)}` : 'Nobody is working here',
    statusWidth = beside ? workW : inner,
    lines = built ? wrapText(c, now, statusWidth, 11, 2) : [],
    statusHeight = (lines.length + (waiting ? 1 : 0)) * 15;
  out.rows.push(() => {
    c.text(new Rect(nameX, icon.y + (level ? 2 : 9), titleWidth, 24), name, t.text, size, true);
    if (level) c.text(new Rect(nameX, icon.y + 25, titleWidth, 16), level, t.accent, 11, true);
    if (!built) return;
    const x = beside ? workX : left,
      y = beside ? icon.y + (face - statusHeight) / 2 : icon.y + face + 3,
      align = beside ? Align.End : Align.Start;
    lines.forEach((words, i) =>
      c.text(new Rect(x, y + i * 15, statusWidth, 16), c.elideText(words, statusWidth, 11), working ? t.accent : t.muted, 11, false, align));
    if (waiting) c.text(new Rect(x, y + lines.length * 15, statusWidth, 15), `${waiting} waiting their turn`, t.muted, 10, false, align);
  });
  out.y += face + gap + (!built || beside ? 0 : 3 + statusHeight);
}
/** Two page buttons and the page count share the footer with the building's clear control. */
export const stationPagerWidth = (touch: boolean): number => (touch ? 44 : 28) * 2 + 36;
function stationLine(app: GameHudApp, out: InspectorRows, words: string, color: Color, size: number): void {
  const c = app.context, at = out.y;
  out.rows.push(() => c.text(new Rect(out.left, f32(out.top + at), out.inner, size + 8),
    c.elideText(words, out.inner, size), color, size));
  out.y = f32(at + size + 9);
}
/** Inspector rows of a workbench or smithy: what its next level asks, who works, who waits, and every recipe. */
export function stationRows(app: GameHudApp, station: Building, out: InspectorRows, recipes = out): void {
  if (!isCraftStation(station.kind)) return;
  const c = app.context,
    t = app.theme,
    town = app.town,
    owned = isPlayerBuilding(station),
    { left, inner, top } = out,
    working = town.craftingAt(station.id),
    waiting = town.craftQueue(station.id),
    line = (words: string, color: Color, size: number) => stationLine(app, out, words, color, size);
  out.y = f32(out.y + 4);
  const cancelW = 66,
    cancel = (p: Person, id: string, y: number) =>
      button(
        c,
        id,
        new Rect(f32(left + inner - cancelW), y, cancelW, 26),
        'Cancel',
        () => {
          const name = town.orderName(p);
          if (town.cancelCraft(p.id) && name) app.status = `${p.name} stopped making the ${name}`;
        },
        ButtonStyle.Default,
        owned,
        undefined,
        false,
        { fontSize: 11 },
      );
  // The station's level, what the next one opens and what it asks.
  if (station.kind !== Structure.Foundry) {
    const level = stationLevel(station),
      next = stationStep(station.kind, level + 1),
      name = structureSpec(station.kind).name;
    if (!next) line(level >= topLevel(station.kind) ? 'Highest level: everything here can be made' : '', t.muted, 10);
    else {
      for (const text of wrapText(c, `Next level makes ${next.opens}`, inner, 10, 2)) line(text, t.text, 10);
      // The nearest free resident does the work; the player does not pick one.
      const crafter = town.stationUpgrader(station.id),
        reason = crafter ? town.stationUpgradeReason(crafter.id, station.id) : 'No resident can work here',
        upgrading = !!crafter && craftOrder(crafter.craftItem)?.kind === 'station',
        at = out.y,
        buttonW = 78;
      out.rows.push(() => {
        const y = f32(top + at),
          w = f32(inner - buttonW - 6);
        c.text(new Rect(left, y, w, 14), c.elideText(`Upgrade: ${describe(next.cost)}`, w, 10), t.accent, 10);
        c.text(new Rect(left, f32(y + 14), w, 14), c.elideText(reason || (crafter && !town.missingUpgradeMaterials(crafter, station, next.cost).empty() ? 'Gathers missing materials' : 'Ready to upgrade'), w, 9), reason ? t.danger : t.muted, 9);
        if (upgrading) cancel(crafter!, `station-level-cancel-${station.id}`, y);
        else
          button(
            c,
            `station-upgrade-${station.id}`,
            new Rect(f32(left + inner - buttonW), y, buttonW, 26),
            'Upgrade',
            () => {
              if (crafter && town.orderStationUpgrade(crafter.id, station.id))
                app.status = `${crafter.name} goes to upgrade the ${name.toLowerCase()}`;
            },
            ButtonStyle.Primary,
            owned && !reason,
            undefined,
            false,
            { fontSize: 11 },
          );
      });
      out.y = f32(out.y + 32);
    }
  }
  if (station.kind === Structure.Foundry)
    for (const words of wrapText(c, 'Find iron and frostwood on snowy ground, cinder ore on volcanic ground and bones on fallen monsters.', inner, 11, 4))
      line(words, t.muted, 11);
  if (working) {
    const at = out.y,
      share = town.craftShare(working),
      text = `${working.name} is making ${town.orderName(working)} · ${Math.trunc(share * 100)}%`;
    out.rows.push(() => {
      const y = f32(top + at),
        w = f32(inner - cancelW - 6);
      c.text(new Rect(left, y, w, 26), c.elideText(text, w, 12, true), t.accent, 12, true);
      cancel(working, `station-cancel-${station.id}`, y);
    });
    out.y = f32(out.y + 30);
    const barAt = out.y;
    out.rows.push(() => {
      meter(c, new Rect(left, f32(top + barAt - 1), inner, 8), share, t.accent);
    });
    out.y = f32(out.y + 12);
    // A crafter at the bench without the materials stands still: say why.
    const order = craftOrder(working.craftItem),
      stuck = !order
        ? ''
        : order.kind === 'station'
          ? town.stationUpgradeReason(working.id, station.id)
          : town.craftReason(working.id, station.id, order.item.id);
    if (stuck) line(stuck, t.danger, 11);
  }
  // Each resident in line can be called off on their own; nothing is spent until an item is done.
  for (const p of waiting) {
    const at = out.y,
      text = `${p.name} waits to make ${town.orderName(p)}`;
    out.rows.push(() => {
      const y = f32(top + at),
        w = f32(inner - cancelW - 6);
      c.text(new Rect(left, y, w, 26), c.elideText(text, w, 11), t.muted, 11);
      cancel(p, `station-cancel-${station.id}-${p.id}`, y);
    });
    out.y = f32(out.y + 30);
  }
  if (working || waiting.length) line('Nothing is spent until the item is done.', t.muted, 10);
  out.y = f32(out.y + 4);
  drawStationRecipes(app, station, recipes, out.y);
  out.y = Math.max(out.y, recipes.y);
}
function drawStationRecipes(app: GameHudApp, station: Building, out: InspectorRows, workBottom: number): void {
  const c = app.context, t = app.theme, town = app.town, owned = isPlayerBuilding(station);
  const { left, inner, top } = out, narrow = inner < 430;
  const offers = town.craftOffers(station.id), wanted = questItems(town);
  // Recipes come in groups the player switches between; a long group still pages.
  const grouped = stationRecipes(town, station, offers),
    group = shownGroup(app, station, grouped, wanted),
    recipes = grouped.get(group) ?? [];
  if (grouped.size > 1) {
    const at = out.y,
      tabs = [...grouped.keys()],
      gap = 6,
      w = f32((inner - gap * (tabs.length - 1)) / tabs.length);
    out.rows.push(() =>
      tabs.forEach((tab, i) => {
        const quest = grouped.get(tab)!.some((item) => wanted.includes(item.id)),
          fresh = grouped.get(tab)!.some((item) => freshMake(town, item));
        button(
          c,
          `station-group-${tab.toLowerCase()}-${station.id}`,
          new Rect(f32(left + i * (w + gap)), f32(top + at), w, 26),
          tab === group ? tab : quest ? `${tab} · Quest` : fresh ? `${tab} · New` : tab,
          () => {
            let map = groups.get(app);
            if (!map) groups.set(app, (map = new Map()));
            map.set(station.id, tab);
            pages.get(app)?.set(station.id, 0);
          },
          ButtonStyle.Default,
          true,
          undefined,
          tab === group,
          { fontSize: 11 },
        );
      }),
    );
    out.y = f32(out.y + 32);
  }
  const pagerSize = app.touchMode ? 44 : 28, pagerHeight = pagerSize + 4;
  const room = (out.bottom ?? Infinity) - out.y;
  const beside = inner >= 465, compact = inner < 435 || room < 270;
  const rowH = compact ? 36 : app.touchMode ? 48 : 46;
  const listW = beside ? Math.floor(inner * 0.47) : inner, sheetW = beside ? inner - listW - 10 : inner;
  const entries = recipes.map(item => {
    const offer = recipeOffer(town, station, item, offers);
    const inputs = item.category === 'resource' ? resourceProducts.filter(product => resourceAmount(offer.cost, product) > 0) : [];
    const note = item.category !== 'resource' ? '' : offer.reason === 'Not enough settlement materials' ? '' : offer.reason || offer.hint;
    const notes = offer.action === 'none' ? [] : [{ text: `Materials · ${describe(offer.cost)}` }];
    const missing = offer.who && town.missingUpgradeMaterials(offer.who, station, offer.cost);
    const reason = offer.reason === 'Not enough settlement materials' && missing && !missing.empty() ? `Missing ${describe(missing)}`
      : !offer.reason && offer.action === 'upgrade' && missing && !missing.empty() ? `Gathers ${describe(missing)}` : offer.reason;
    const fields = gearFields(item, offer.who);
    const mark = freshMake(town, item) ? 'New' : wanted.includes(item.id) ? 'Quest' : '';
    const detail = (single: boolean) => itemSheet(c, item, fields, sheetW, compact,
      single ? [mark, offer.mark || offer.hint].filter(Boolean).join(' · ') : offer.who ? comparesWith(item, offer.who) : '',
      [...notes, { text: reason || (offer.action === 'none' && !single ? offer.hint : ''), warning: !!offer.reason }], single ? 66 : 0);
    const height = 34 + inputs.length * 16;
    return { item, offer, inputs, note, height, mark, advance: height + 4 + (note ? 19 : 0), detail,
      sheet: item.category !== 'resource' ? detail(false) : null };
  });
  type Entry = typeof entries[number];
  const materialList = group === 'Materials';
  const maxDetailH = Math.max(0, ...entries.map(entry => entry.sheet?.height ?? 0));
  const limit = Math.max(1, Math.min(recipesPerPage,
    Math.floor((room - (!owned ? pagerHeight : 0) - (beside ? 0 : maxDetailH + 6)) / rowH)));
  const recipePages: Entry[][] = [];
  if (materialList) {
    let height = 0;
    for (const entry of entries) {
      if (!recipePages.length || height + entry.advance > room - (!owned ? pagerHeight : 0)) {
        recipePages.push([]);
        height = 0;
      }
      recipePages[recipePages.length - 1].push(entry);
      height += entry.advance;
    }
  } else for (let i = 0; i < entries.length; i += limit) recipePages.push(entries.slice(i, i + limit));
  const pageCount = recipePages.length;
  const page = Math.max(0, Math.min(pages.get(app)?.get(station.id) ?? 0, pageCount - 1));
  const listed = recipePages[page] ?? [];
  const selected = listed.find(entry => lineOf(entry.item) === inspectedKinds.get(app)?.get(station.id)) ?? listed[0];
  noteViewed(town, listed.map(entry => entry.item));
  const orderButton = (entry: Entry, r: Rect, showPrice = false) => {
    const { item, offer } = entry;
    if (offer.action === 'none') {
      if (making(offer.who, item)) {
        const maker = offer.who;
        button(c, `station-cancel-${item.id}`, r, 'Cancel', () => {
          if (town.cancelCraft(maker.id)) app.status = `${maker.name} stopped making the ${item.name}`;
        }, ButtonStyle.Quiet, owned);
      }
      return;
    }
    const label = offer.action === 'upgrade' ? 'Upgrade' : item.category === 'resource' ? 'Refine' : 'Craft';
    const id = `station-${offer.action}-${item.id}`, primary = entry === selected || materialList;
    const ready = owned && !offer.reason && !!offer.who;
    const state = button(c, id, r, showPrice ? '' : label, () => {
      if (offer.who && town.orderSettlementCraft(station.id, item.id))
        app.status = offer.action === 'upgrade' ? `${offer.who.name} goes to upgrade to the ${item.name}` : `${offer.who.name} goes to make ${item.name}`;
      else app.status = offer.reason || 'Could not start this order';
    }, primary ? ButtonStyle.Primary : ButtonStyle.Quiet, ready, undefined, false, { fontSize: 11 });
    if (showPrice) {
      const cost = describe(offer.cost), half = Math.floor(r.h / 2);
      const ink = !ready ? t.muted : primary ? t.accentText : t.text;
      c.text(new Rect(r.x + 2, r.y + 1, r.w - 4, half), label, ink, 11, true, Align.Center);
      c.text(new Rect(r.x + 2, r.y + half, r.w - 4, r.h - half - 2), c.elideText(cost, r.w - 4, 10), ink, 10, false, Align.Center);
      tooltip(c, id, state.hovered, [item.name, cost, offer.reason || offer.hint].filter(Boolean));
    }
  };
  if (materialList) {
    const stock = town.stock(town.settlementOf(station)), local = town.stationFolk(station);
    for (const entry of listed) {
      const { item, offer, inputs, height, note } = entry, at = out.y;
      out.rows.push(() => {
        const y = f32(top + at);
        well(c, new Rect(left, y, inner, height), t.surface);
        itemIcon(c, new Rect(left + 3, y + 2, 28, 28), item);
        const stored = `${resourceAmount(stock, item.product)} in store`, title = narrow ? item.name : `${item.name} · ${stored}`;
        c.text(new Rect(left + 36, y + 3, inner - 110, 24), c.elideText(title, inner - 110, 12, true), t.text, 12, true);
        inputs.forEach((product, i) => {
          const available = resourceAmount(stock, product) + local.reduce((sum, p) => sum + heldAmount(p, product), 0);
          c.text(new Rect(left + 12, y + 30 + i * 16, narrow ? inner - 86 : inner - 24, 16),
            `${productItem(product)!.name} ${available} / ${resourceAmount(offer.cost, product)}`, t.muted, 11);
        });
        if (narrow) c.text(new Rect(left + inner - 74, y + 30, 70, 16), stored, t.muted, 10, false, Align.End);
        orderButton(entry, new Rect(left + inner - 66, y + 4, 62, 25));
      });
      out.y += height + 4;
      if (note) stationLine(app, out, note, offer.reason ? t.danger : t.accent, 10);
    }
  } else if (selected) {
    const at = out.y, single = !beside && listed.length === 1;
    const sheet = single ? selected.detail(true) : selected.sheet!;
    const listH = single ? 0 : listed.length * rowH;
    const selectedX = beside ? left + listW + 10 : left;
    const selectedY = top + at + (beside || single ? 0 : listH + 4);
    out.rows.push(() => {
      if (!single) listed.forEach((entry, i) => {
        const { item, offer } = entry, y = top + at + i * rowH, active = entry === selected;
        const mark = entry.mark;
        const showOrder = offer.action !== 'none' || making(offer.who, item);
        const orderW = showOrder ? 59 : 0, row = new Rect(left, y, listW - orderW, rowH - 3);
        button(c, `station-inspect-${item.id}`, row, '', () => {
          let map = inspectedKinds.get(app);
          if (!map) inspectedKinds.set(app, (map = new Map()));
          map.set(station.id, lineOf(item));
        }, ButtonStyle.Quiet, true, undefined, active);
        if (active) c.rect(new Rect(left + 1, y + 3, 3, row.h - 7), t.accent, 1);
        const face = Math.min(row.h - 6, 32), x = left + face + 12, w = row.x + row.w - x - 5;
        well(c, new Rect(left + 6, y + 3, face, face), t.well);
        itemIllustration(c, new Rect(left + 6, y + 3, face, face), item);
        const markW = mark ? c.textWidth(mark, 9, true) + 6 : 0;
        c.text(new Rect(x, y + 1, w - markW, 18), c.elideText(item.name, w - markW, 12, true),
          active ? t.accent : t.text, 12, true);
        if (mark) c.text(new Rect(x + w - markW, y + 1, markW, 16), mark, t.accent, 9, true, Align.End);
        const status = offer.mark || offer.reason || offer.hint;
        c.text(new Rect(x, y + 18, w, row.h - 18), c.elideText(status, w, 10), offer.reason ? t.danger : t.muted, 10);
        if (showOrder) orderButton(entry, new Rect(left + listW - 56, y, 56, row.h), true);
      });
      sheet.draw(selectedX, selectedY);
      if (single) orderButton(selected, new Rect(selectedX + sheetW - 67, selectedY + 6, 60, 27));
    });
    // The inspector is anchored to the bottom of the screen. Keep the list still while comparing its items.
    const height = single ? sheet.height : Math.max(...listed.map(entry => entry.sheet!.height));
    out.y += (beside ? Math.max(listH, height) : listH + (single ? 0 : 4) + height) + 4;
  }
  if (pageCount > 1) {
    const at = owned ? Math.max(out.y, workBottom) + 12 : out.y,
      turn = (to: number) => () => {
        let map = pages.get(app);
        if (!map) pages.set(app, (map = new Map()));
        map.set(station.id, to);
      };
    out.rows.push(() => {
      const y = f32(top + at);
      actionButton(
        c,
        `station-page-prev-${station.id}`,
        new Rect(f32(left + inner - stationPagerWidth(app.touchMode)), y, pagerSize, pagerSize),
        'back',
        'Previous recipes',
        turn(page - 1),
        false,
        page > 0,
      );
      c.text(
        new Rect(f32(left + inner - pagerSize - 34), y, 32, pagerSize),
        `${page + 1}/${pageCount}`,
        t.muted,
        10,
        false,
        Align.Center,
      );
      actionButton(
        c,
        `station-page-next-${station.id}`,
        new Rect(f32(left + inner - pagerSize), y, pagerSize, pagerSize),
        'next',
        'Next recipes',
        turn(page + 1),
        false,
        page < pageCount - 1,
      );
    });
    if (!owned) out.y = f32(out.y + pagerHeight);
  }
}
/** A progress bar over each station while someone works it, in the HUD's own style. */
export function craftBars(app: GameHudApp, width: number, height: number): void {
  const c = app.context,
    t = app.theme;
  noteOpened(app.town);
  // The station's list is closed: what was looked at there is no longer new.
  const open = app.town.building(app.selected);
  if (!open || !isCraftStation(open.kind)) noteViewed(app.town, []);
  for (const b of app.town.buildings()) {
    if (!isCraftStation(b.kind) || !b.built() || !isPlayerBuilding(b)) continue;
    const p = app.town.craftingAt(b.id);
    if (!p || !app.town.map().revealed(b.center)) continue;
    const share = app.town.craftShare(p);
    const roof = app.camera.toScreen(
        app.renderer.buildingRoof(b) ?? project(b.center.x, b.center.y, 24),
        width,
        height,
      ),
      w = 52,
      r = new Rect(f32(roof.x - w / 2), f32(roof.y - 16), w, 8);
    if (r.x < -w || r.x > width || r.y < 0 || r.y > height) continue;
    c.rect(new Rect(f32(r.x - 2), f32(r.y - 2), f32(w + 4), 13), { ...t.surface, a: 255 }, 3);
    meter(c, r, share, t.accent);
    c.requestFrameAt(c.time() + 0.25);
  }
}
