import { Rect, Align, ButtonStyle, button, meter, tag, well } from '../../../../packages/native-ui/src';
import { Structure, describe, structureSpec } from '../../../../packages/engine/src/building-catalog';
import { craftsAt, isCraftStation, madeFrom, productItem, upgradeCost, upperTier, type ItemSpec } from '../../../../packages/engine/src/equipment';
import { stationLevel, stationStep } from '../../../../packages/engine/src/craft-stations';
import { gearFields, gearFieldText } from '../../../../packages/engine/src/gear-stats';
import { craftOrder, orderCost } from '../../../../packages/engine/src/craft-orders';
import { Activity, callingName, type Person } from '../../../../packages/engine/src/person';
import { distance } from '../../../../packages/engine/src/geometry';
import { canControl } from '../../../../packages/engine/src/faction';
import type { Building } from '../../../../packages/engine/src/town-models';
import type { GameHudApp } from './game-hud-contract';
import { tooltip, wrapText } from './game-combat-hud';
import { comparesWith, itemSheet } from './gear-item-sheet';
import { itemIllustration } from './item-icon';

interface Choice {
  key: string;
  name: string;
  detail: string;
  item?: ItemSpec;
  reason: string;
  notice?: string;
  action: string;
  submit(): boolean;
}
function localRecipes(app: GameHudApp, p: Person, station: Building) {
  return app.town.craftOptions(p.id, station.id).filter(({ item }) => item.stationLevel <= stationLevel(station));
}
function recipes(app: GameHudApp, p: Person, station: Building): Choice[] {
  const town = app.town;
  const choices = localRecipes(app, p, station).map(({ item, reason }): Choice => {
    const upgrading = !!madeFrom(item), cost = upgrading ? upgradeCost(item) : item.cost;
    const missing = town.missingUpgradeMaterials(p, station, cost);
    const notice = !missing.empty() && (upgrading && !reason || reason === 'Not enough settlement materials')
      ? `${upgrading ? 'Gathers' : 'Missing'} ${describe(missing)}` : reason;
    return { key: item.id, name: item.name, notice, detail: `Materials · ${describe(cost)}`, reason, item,
      action: upgrading ? 'Upgrade' : item.category === 'resource' ? 'Refine' : 'Craft',
      submit: () => town.orderCraft(p.id, station.id, item.id) };
  });
  const step = stationStep(station.kind, stationLevel(station) + 1);
  if (step) choices.push({ key: 'level', name: `Upgrade ${structureSpec(station.kind).name}`, detail: `${describe(step.cost)} · ${step.opens}`,
    reason: town.stationUpgradeReason(p.id, station.id), action: 'Upgrade', submit: () => town.orderStationUpgrade(p.id, station.id) });
  return choices;
}
function residentStations(app: GameHudApp, p: Person, guild = false): Building[] {
  const town = app.town;
  const places = town.buildings().filter(b => b.built() && b.faction === p.faction && town.settlementOf(b) === town.settlementOf(p) &&
    town.inRealm(b.center) === town.inRealm(p.position) && (guild ? b.kind === Structure.Guild || b.kind === Structure.GuildHall : isCraftStation(b.kind)));
  // Prefer the best local forge of a kind, then the closest one at that level.
  places.sort((a, b) => stationLevel(b) - stationLevel(a) || distance(p.position, a.door()) - distance(p.position, b.door()) || a.id - b.id);
  return places;
}

/** Opens the next recipe for this kind of item at the resident's matching workshop. */
export function itemUpgrade(app: GameHudApp, p: Person, item: ItemSpec): { hint: string; open?: () => void } | null {
  const next = upperTier(item);
  if (!next) return null;
  if (p.craftItem) return { hint: 'Finish or cancel the current crafting order' };
  const station = residentStations(app, p).find(b => craftsAt(next, b.kind));
  if (!station) return { hint: `Requires ${structureSpec(next.workshop!).name}` };
  if (stationLevel(station) < next.stationLevel)
    return { hint: `Needs a level ${next.stationLevel} ${structureSpec(station.kind).name.toLowerCase()}` };
  const index = localRecipes(app, p, station).findIndex(choice => choice.item.id === next.id);
  if (index < 0) return null;
  return { hint: next.name, open: () => {
    app.equipmentTab = 'craft';
    app.craftWorkshopFilter = station.kind;
    app.craftPage = index;
  }};
}

/** Orders stay bound to the resident whose profile is open, including when several stations are available. */
export function residentServices(app: GameHudApp, p: Person, panel: Rect): number {
  const town = app.town, c = app.context, t = app.theme, guild = app.equipmentTab === 'guild';
  const places = residentStations(app, p, guild);
  const kinds = [...new Set(places.map(b => b.kind))];
  const station = places.find(b => b.kind === app.craftWorkshopFilter) ?? places.find(b => b.kind === Structure.Weaponsmith) ?? places[0];
  const line = (y: number, words: string, accent = false) => c.text(new Rect(panel.x, y, panel.w, 18), c.elideText(words, panel.w, 11), accent ? t.accent : t.text, 11);
  if (!station) { line(panel.y, guild ? 'Build a guild to change calling.' : 'Build a workbench or smithy to craft equipment.'); return panel.y + 18; }
  let y = panel.y;
  if (!guild) {
    if (kinds.length > 1) {
      const w = (panel.w - (kinds.length - 1) * 5) / kinds.length;
      const stationH = app.touchMode ? 44 : 25;
      kinds.forEach((kind, i) => button(c, `resident-station-${kind}`, new Rect(panel.x + i * (w + 5), y, w, stationH),
        structureSpec(kind).name, () => { app.craftWorkshopFilter = kind; app.craftPage = 0; },
        ButtonStyle.Quiet, true, undefined, kind === station.kind, { fontSize: 12 }));
      y += stationH + 6;
    } else {
      line(y, `${structureSpec(station.kind).name} · Level ${stationLevel(station)}`, true);
      y += 23;
    }
  }
  if (!guild && p.craftItem) {
    const order = craftOrder(p.craftItem), parent = town.building(p.craftWorkshop);
    const cost = order && parent && orderCost(order, parent.kind);
    line(y, `${town.orderName(p)} · ${activityStatus(p)} · ${Math.round(town.craftShare(p) * 100)}%`, true);
    if (cost && parent && p.activity === Activity.WaitingMaterials) {
      const needed = town.missingUpgradeMaterials(p, parent, cost);
      if (!needed.empty()) { y += 18; line(y, `Waiting for ${describe(needed)}`); }
    }
    meter(c, new Rect(panel.x, y + 23, panel.w, 7), town.craftShare(p), t.accent);
    const h = app.touchMode ? 44 : 28;
    button(c, 'resident-cancel-craft', new Rect(panel.x, y + 38, Math.min(110, panel.w), h), 'Cancel', () => { town.cancelCraft(p.id); }, ButtonStyle.Default, canControl(p));
    c.requestFrameAt(c.time() + 0.4);
    return y + 38 + h;
  }
  if (guild && p.task === Activity.Training) {
    line(y, `Training ordered: ${callingName(p.trainingCalling)}`, true);
    const h = app.touchMode ? 44 : 26;
    button(c, 'resident-cancel-training', new Rect(panel.x, y + 21, Math.min(110, panel.w), h), 'Cancel',
      () => { town.orderAutomatic([p.id]); }, ButtonStyle.Default, canControl(p));
    return y + 21 + h;
  }
  const choices: Choice[] = guild ? town.guildTrainingOptions(p.id, station.id).map(o => ({ key: String(o.calling), name: o.name,
    detail: o.description, reason: o.reason, action: `Train as ${o.name}`, submit: () => town.orderTrainAtGuild(p.id, station.id, o.calling) })) : recipes(app, p, station);
  if (!choices.length) { line(y, 'No further upgrades'); return y + 18; }
  const index = Math.max(0, Math.min(app.craftPage, choices.length - 1)), selected = choices[index];
  const available = panel.y + panel.h - y, short = available < 210;
  const beside = panel.w >= 410 || (short && panel.w >= 275);
  const gap = short ? 7 : 12;
  const listW = beside ? Math.min(240, Math.floor((panel.w - gap) * (short ? 0.40 : 0.41))) : panel.w;
  const detailX = beside ? panel.x + listW + gap : panel.x;
  const detailW = panel.x + panel.w - detailX;
  const compact = short || (!beside && available < 390);
  const selectedNote = selected.notice ?? selected.reason;
  const measure = (choice: Choice) => {
    const notes = [{ text: choice.item?.category === 'resource' ? choice.item.description : '' },
      { text: choice.detail }, { text: choice.notice ?? choice.reason, warning: !!choice.reason }];
    const sheet = choice.item && itemSheet(c, choice.item, gearFields(choice.item, p), detailW, compact,
      comparesWith(choice.item, p), notes);
    const plain = sheet ? [] : notes.flatMap(n => wrapText(c, n.text, detailW - 20, 12, Infinity).map(text => ({ ...n, text })));
    return { sheet, plain, height: sheet?.height ?? 38 + plain.length * 17 };
  };
  const { sheet, plain, height: detailH } = measure(selected);
  const buttonH = app.touchMode ? 44 : short ? 26 : 34;
  const pitch = app.touchMode ? 49 : short ? 29 : compact ? 33 : 49;
  const pagerH = app.touchMode ? 44 : short ? 24 : 29;
  const actionUnderList = beside && available < detailH + buttonH + 7;
  // Use the tallest sheet on stacked pages so the index stays put when a different item is inspected.
  const reserve = beside ? (short ? buttonH + 5 : 0) : Math.max(...choices.map(choice => measure(choice).height)) + buttonH + 12;
  const possible = Math.max(1, Math.floor((available - reserve) / pitch));
  const rows = choices.length <= possible ? possible : Math.max(1, Math.floor((available - reserve - pagerH - 3) / pitch));
  const single = !beside && choices.length > 1 && available < reserve + pitch + pagerH + 3;
  const start = single ? index : Math.floor(index / rows) * rows, list = single ? [] : choices.slice(start, start + rows);
  list.forEach((choice, i) => {
    const id = `resident-choice-${choice.key}`, r = new Rect(panel.x, y + i * pitch, listW, pitch - 3), active = choice === selected;
    const state = button(c, id, r, '', () => { app.craftPage = start + i; }, ButtonStyle.Quiet, true, undefined, active);
    if (active) c.rect(new Rect(r.x + 1, r.y + 3, 3, r.h - 7), t.accent, 1);
    const face = Math.min(r.h - 6, 33), ix = r.x + 7;
    if (choice.item) {
      well(c, new Rect(ix, r.y + (r.h - face) / 2, face, face), t.well);
      itemIllustration(c, new Rect(ix, r.y + (r.h - face) / 2, face, face), choice.item);
    }
    const x = choice.item ? ix + face + 6 : r.x + 10, w = r.x + r.w - x - 5;
    const twoLines = pitch > 40, nameSize = short ? 11 : 12;
    c.text(new Rect(x, r.y + (twoLines ? 3 : 0), w, twoLines ? 20 : r.h), c.elideText(choice.name, w, nameSize, true),
      active ? t.accent : t.text, nameSize, true);
    const main = choice.item && gearFields(choice.item)[0];
    if (twoLines) {
      const summary = main ? gearFieldText(main) : choice.detail;
      c.text(new Rect(x, r.y + 23, w, 17), c.elideText(summary, w, 11), t.muted, 11);
    }
    tooltip(c, id, state.hovered && !active, [choice.name, choice.notice || choice.detail]);
  });
  let listEnd = y + list.length * pitch;
  if (choices.length > rows) {
    const pagerW = app.touchMode ? 44 : 30;
    const turn = (id: string, direction: number, at: number) => button(c, id, new Rect(at, listEnd, pagerW, pagerH), direction < 0 ? '<' : '>',
      () => { app.craftPage = Math.max(0, start + direction * rows); }, ButtonStyle.Quiet,
      direction < 0 ? start > 0 : start + rows < choices.length);
    turn('resident-choices-prev', -1, panel.x);
    turn('resident-choices-next', 1, panel.x + listW - pagerW);
    c.text(new Rect(panel.x + pagerW, listEnd, listW - 2 * pagerW, pagerH), `${Math.floor(index / rows) + 1} / ${Math.ceil(choices.length / rows)}`, t.muted, 11, false, Align.Center);
    listEnd += pagerH + 3;
  }
  const detailY = beside ? y : listEnd + 4;
  if (sheet) sheet.draw(detailX, detailY);
  else {
    tag(c, new Rect(detailX, detailY, detailW, detailH), { lip: 1 });
    c.text(new Rect(detailX + 10, detailY + 5, detailW - 20, 24), selected.name, t.ink, 14, true);
    plain.forEach((n, i) => c.text(new Rect(detailX + 10, detailY + 31 + i * 17, detailW - 20, 17), n.text, n.warning ? t.inkDanger : t.ink, 12));
  }
  const action = selected.item ? `${selected.action} ${selected.item.name}` : selected.action;
  const actionX = actionUnderList ? panel.x : detailX, actionW = actionUnderList ? listW : detailW;
  const actionY = actionUnderList ? panel.y + panel.h - buttonH : detailY + detailH + 5;
  const state = button(c, 'resident-service-order', new Rect(actionX, actionY, actionW, buttonH),
    c.elideText(action, actionW - 12, 12, true),
    () => {
      if (selected.submit()) app.status = guild ? 'Training ordered' : `${p.name} goes to work at the ${structureSpec(station.kind).name.toLowerCase()}`;
      else app.status = selected.reason || 'Could not start this order';
    },
    ButtonStyle.Primary, canControl(p) && !selected.reason, undefined, false, { fontSize: 12, bold: true });
  tooltip(c, 'resident-service-order', state.hovered, [selectedNote || selected.detail]);
  return Math.max(listEnd, detailY + detailH, actionY + buttonH);
}
function activityStatus(p: Person): string {
  if (p.activity === Activity.Crafting) return p.refining ? productItem(p.refining)!.name : 'Crafting equipment';
  if ([Activity.Felling, Activity.Mining, Activity.Working, Activity.Collecting, Activity.Hauling, Activity.WaitingMaterials].includes(p.activity)) return 'Gathering materials';
  return 'On the way';
}
