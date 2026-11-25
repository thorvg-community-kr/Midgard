import { Rect, Align, ButtonStyle, button, meter, slab, tone, well, type Color } from '../../../../packages/native-ui/src';
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
  madeFrom,
  productItem,
  upgradeCost,
  upperTier,
  type ItemSpec,
} from '../../../../packages/engine/src/equipment';
import { attackPreview, gearStats, scalingLine } from '../../../../packages/engine/src/gear-stats';
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
import { itemIcon } from './game-equipment-panel';
import { wrapText } from './game-combat-hud';
import { gearStatRows } from './gear-stat-layout';

// The recipe group and its page shown at each station; transient, per app.
const pages = new WeakMap<object, Map<number, number>>(),
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
/** Inspector rows of a workbench or smithy: what its next level asks, who works, who waits, and every recipe. */
export function stationRows(app: GameHudApp, station: Building, out: InspectorRows): void {
  if (!isCraftStation(station.kind)) return;
  const c = app.context,
    t = app.theme,
    town = app.town,
    owned = isPlayerBuilding(station),
    { left, inner, top } = out,
    offers = town.craftOffers(station.id),
    working = town.craftingAt(station.id),
    waiting = town.craftQueue(station.id),
    wanted = questItems(town),
    narrow = inner < 430,
    line = (text: string, color = t.text, size = 12, bold = false) => {
      const at = out.y;
      out.rows.push(() =>
        c.text(
          new Rect(left, f32(top + at), inner, size + 8),
          c.elideText(text, inner, size, bold),
          color,
          size,
          bold,
        ),
      );
      out.y = f32(out.y + size + 9);
    };
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
  // Recipes come in groups the player switches between; a long group still pages.
  const grouped = stationRecipes(town, station, offers),
    group = shownGroup(app, station, grouped, wanted),
    recipes = grouped.get(group) ?? [],
    rowH = narrow ? 35 : 38;
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
  const entries = recipes.map((item) => {
    const offer = recipeOffer(town, station, item, offers),
      inputs = item.category === 'resource' ? resourceProducts.filter((p) => resourceAmount(offer.cost, p) > 0) : [],
      effects = gearStatRows(c, gearStats(item, false), inner - 16, 11),
      inline = !narrow && effects.length === 1 && c.textWidth(effects[0], 11) <= f32(inner * 0.55) - 40,
      preview = item.scaling ? gearStatRows(c, [
        scalingLine(item), ...(offer.who ? [offer.who.name, attackPreview(offer.who, item)] : []),
      ], inner - 16, 11) : [],
      height = item.category === 'resource' ? 34 + 16 * inputs.length : rowH + ((inline ? 0 : effects.length) + preview.length) * 16,
      // Under a material: why it cannot be refined, else who goes; missing inputs already show in its counts.
      note = item.category !== 'resource' ? '' : offer.reason ? (offer.reason === 'Not enough settlement materials' ? '' : offer.reason) : offer.hint;
    return { item, offer, inputs, effects, inline, preview, height, note, advance: height + 4 + (note ? 19 : 0) };
  });
  const pagerSize = app.touchMode ? 44 : 28, pagerHeight = pagerSize + 4,
    room = (out.bottom ?? Infinity) - out.y,
    // During an unbounded inspection the list uses its usual page size.
    maxRows = out.bottom === undefined ? (narrow ? 6 : recipesPerPage) : Infinity,
    listRoom = !owned && entries.reduce((sum, entry) => sum + entry.advance, 0) > room ? room - pagerHeight : room;
  let currentPage: typeof entries = [];
  const recipePages = [currentPage];
  let pageHeight = 0;
  for (const entry of entries) {
    if (currentPage.length && (currentPage.length >= maxRows || pageHeight + entry.advance > listRoom)) {
      currentPage = [];
      recipePages.push(currentPage);
      pageHeight = 0;
    }
    currentPage.push(entry);
    pageHeight += entry.advance;
  }
  const pageCount = recipePages.length,
    page = Math.max(0, Math.min(pages.get(app)?.get(station.id) ?? 0, pageCount - 1)),
    listed = recipePages[page];
  noteViewed(town, listed.map((entry) => entry.item));
  for (const { item, offer, inputs, effects, inline, preview, height, note } of listed) {
    const at = out.y,
      quest = wanted.includes(item.id),
      fresh = freshMake(town, item),
      faded = !!offer.mark,
      maker = offer.action === 'none' && making(offer.who, item) ? offer.who : null,
      label = offer.action === 'upgrade' ? 'Upgrade' : item.category === 'resource' ? 'Refine' : 'Craft',
      idle = offer.action === 'none',
      status = offer.reason || offer.hint,
      statusColor = offer.reason ? t.danger : offer.hint && !idle ? t.accent : t.muted,
      // What is already carried is paid for: its row names no cost.
      paidText = idle ? '' : offer.action === 'upgrade' ? `Upgrade: ${describe(offer.cost)}` : describe(offer.cost),
      // An owned make is drawn faded with its mark; a recipe that cannot be made keeps full contrast and says why.
      nameColor = faded ? t.muted : offer.reason ? t.muted : t.text,
      run = () => {
        const who = offer.who;
        if (who && town.orderSettlementCraft(station.id, item.id))
          app.status =
            offer.action === 'upgrade' ? `${who.name} goes to upgrade to the ${item.name}` : `${who.name} goes to make ${item.name}`;
      };
    if (item.category === 'resource') {
      // A material is nobody's gear: the row counts the stores and every local pack, and can be ordered again.
      const stock = town.stock(town.settlementOf(station)),
        local = town.stationFolk(station),
        costLines = inputs.map((product) => {
          const available = resourceAmount(stock, product) + local.reduce((sum, p) => sum + heldAmount(p, product), 0);
          return `${productItem(product)!.name} ${available} / ${resourceAmount(offer.cost, product)}`;
        });
      out.rows.push(() => {
        const y = f32(top + at);
        well(c, new Rect(left, y, inner, height), t.surface);
        itemIcon(c, new Rect(left + 3, y + 2, 28, 28), item);
        const stored = `${resourceAmount(stock, item.product)} in store`,
          title = narrow ? item.name : `${item.name} · ${stored}`;
        c.text(new Rect(left + 36, y + 3, inner - 110, 24), c.elideText(title, inner - 110, 12, true), t.text, 12, true);
        costLines.forEach((words, i) => c.text(new Rect(left + 12, y + 30 + i * 16, narrow ? inner - 86 : inner - 24, 16), words, t.muted, 11));
        if (narrow) c.text(new Rect(left + inner - 74, y + 30, 70, 16), stored, t.muted, 10, false, Align.End);
        button(c, `station-craft-${item.id}`, new Rect(left + inner - 66, y + 4, 62, 25), label, run,
          ButtonStyle.Primary, owned && !offer.reason && !!offer.who, undefined, false, { fontSize: 11 });
      });
      out.y += height + 4;
      if (note) line(note, offer.reason ? t.danger : t.accent, 10);
      continue;
    }
    out.rows.push(() => {
      const y = f32(top + at),
        r = new Rect(left, y, inner, height),
        // On a phone the icon and button sit beside the name and cost, leaving the effect line the whole row.
        buttonY = f32(y + (narrow ? 4 : (rowH - 26) / 2));
      // What can be made stands proud of the board; what cannot lies in it.
      if (faded) well(c, r, tone(t.surface, t.dusk, 0.16), { rim: quest ? t.accent : undefined });
      else slab(c, r, tone(t.surface, t.raised, 0.7), { lip: 2, trim: quest ? t.accent : undefined });
      itemIcon(
        c,
        narrow
          ? new Rect(f32(left + 5), f32(y + 3), 28, 28)
          : new Rect(f32(left + 3), f32(y + (rowH - 32) / 2), 32, 32),
        item,
        faded,
      );
      let nameX = f32(left + 40);
      const chip = (text: string, fill: Color, ink: Color, border?: Color) => {
        const w = f32(c.textWidth(text, 8, true) + 10),
          mark = new Rect(nameX, f32(y + 5), w, 13);
        c.rect(mark, fill, 6, border);
        c.text(mark, text, ink, 8, true, Align.Center);
        nameX = f32(nameX + w + 6);
      };
      if (quest) chip('Quest', t.accent, t.accentText);
      if (fresh) chip('New', t.danger, t.accentText);
      if (offer.mark) chip(offer.mark, t.surface, t.muted, t.border);
      let statY = y + rowH - 1;
      for (const words of inline ? [] : effects) {
        c.text(new Rect(left + 8, statY, inner - 16, 16), words, t.muted, 11);
        statY += 16;
      }
      for (const words of preview) {
        c.text(new Rect(left + 8, statY, inner - 16, 16), words, t.text, 11);
        statY += 16;
      }
      if (narrow) {
        const textW = f32(inner - 40 - 66),
          paid = [paidText, status].filter(Boolean).join(' · ');
        c.text(
          new Rect(nameX, f32(y + 2), f32(textW - (nameX - left - 40)), 18),
          c.elideText(item.name, f32(textW - (nameX - left - 40)), 12, true),
          nameColor,
          12,
          true,
        );
        c.text(new Rect(f32(left + 40), f32(y + 18), textW, 16), c.elideText(paid, textW, 10), offer.reason ? t.danger : faded ? t.muted : t.accent, 10);
      } else {
        const split = f32(inner * 0.55),
          textW = f32(split - (nameX - left));
        c.text(new Rect(nameX, f32(y + 2), textW, 18), c.elideText(item.name, textW, 12, true), nameColor, 12, true);
        if (inline) c.text(new Rect(f32(left + 40), f32(y + 19), f32(split - 40), 16), effects[0], t.muted, 11);
        const rightX = f32(left + split),
          rightW = f32(inner - split - 70);
        c.text(new Rect(rightX, f32(y + 2), rightW, 18), c.elideText(paidText, rightW, 10), faded ? t.muted : t.accent, 10, false, Align.End);
        c.text(new Rect(rightX, f32(y + 19), rightW, 16), c.elideText(status, rightW, 9), statusColor, 9, false, Align.End);
      }
      // An order can be stopped from the row it was started on.
      if (maker)
        button(
          c,
          `station-cancel-${item.id}`,
          new Rect(f32(left + inner - 62), buttonY, 58, 26),
          'Cancel',
          () => {
            if (town.cancelCraft(maker.id)) app.status = `${maker.name} stopped making the ${item.name}`;
          },
          ButtonStyle.Default,
          owned,
        );
      else if (!idle)
        button(
          c,
          `station-${offer.action}-${item.id}`,
          new Rect(f32(left + inner - 62), buttonY, 58, 26),
          label,
          run,
          ButtonStyle.Primary,
          owned && !offer.reason && !!offer.who,
          undefined,
          false,
          { fontSize: 11 },
        );
    });
    out.y = f32(out.y + height + 4);
  }
  if (pageCount > 1) {
    const at = out.y + (owned ? 12 : 0),
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
