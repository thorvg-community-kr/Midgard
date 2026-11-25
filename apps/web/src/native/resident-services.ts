import { Rect, ButtonStyle, button } from '../../../../packages/native-ui/src';
import { Structure, describe, structureSpec } from '../../../../packages/engine/src/building-catalog';
import { isCraftStation, madeFrom, productItem, upgradeCost } from '../../../../packages/engine/src/equipment';
import { stationLevel, stationStep } from '../../../../packages/engine/src/craft-stations';
import { attackPreview, gearStats } from '../../../../packages/engine/src/gear-stats';
import { craftOrder, orderCost } from '../../../../packages/engine/src/craft-orders';
import { Activity, callingName, type Person } from '../../../../packages/engine/src/person';
import { distance } from '../../../../packages/engine/src/geometry';
import { canControl } from '../../../../packages/engine/src/faction';
import type { Building } from '../../../../packages/engine/src/town-models';
import type { GameHudApp } from './game-hud-contract';
import { tooltip, wrapText } from './game-combat-hud';
import { gearStatRows } from './gear-stat-layout';

interface Choice {
  key: string;
  name: string;
  detail: string;
  stats?: string[];
  preview?: string;
  reason: string;
  action: string;
  submit(): boolean;
}
function recipes(app: GameHudApp, p: Person, station: Building): Choice[] {
  const town = app.town;
  const choices = town.craftOptions(p.id, station.id).filter(({ item }) => item.stationLevel <= stationLevel(station)).map(({ item, reason }): Choice => {
    const upgrading = !!madeFrom(item), cost = upgrading ? upgradeCost(item) : item.cost;
    return { key: item.id, name: item.name, detail: `Materials · ${describe(cost)}`, reason,
      stats: item.category === 'resource' ? [item.description] : gearStats(item),
      preview: item.scaling ? attackPreview(p, item) : undefined,
      action: upgrading ? 'Upgrade' : item.category === 'resource' ? 'Refine' : 'Craft',
      submit: () => town.orderCraft(p.id, station.id, item.id) };
  });
  const step = stationStep(station.kind, stationLevel(station) + 1);
  if (step) choices.push({ key: 'level', name: `Upgrade ${structureSpec(station.kind).name}`, detail: `${describe(step.cost)} · ${step.opens}`,
    reason: town.stationUpgradeReason(p.id, station.id), action: 'Upgrade', submit: () => town.orderStationUpgrade(p.id, station.id) });
  return choices;
}
/** Orders stay bound to the resident whose profile is open, including when several stations are available. */
export function residentServices(app: GameHudApp, p: Person, panel: Rect): void {
  const town = app.town, c = app.context, t = app.theme, guild = app.equipmentTab === 'guild';
  const places = town.buildings().filter(b => b.built() && b.faction === p.faction && town.settlementOf(b) === town.settlementOf(p) &&
    town.inRealm(b.center) === town.inRealm(p.position) && (guild ? b.kind === Structure.Guild || b.kind === Structure.GuildHall : isCraftStation(b.kind)));
  // Prefer the best local forge of a kind, then the closest one at that level.
  places.sort((a, b) => stationLevel(b) - stationLevel(a) || distance(p.position, a.door()) - distance(p.position, b.door()) || a.id - b.id);
  const kinds = [...new Set(places.map(b => b.kind))];
  const station = places.find(b => b.kind === app.craftWorkshopFilter) ?? places.find(b => b.kind === Structure.Weaponsmith) ?? places[0];
  const line = (y: number, words: string, accent = false) => c.text(new Rect(panel.x, y, panel.w, 18), c.elideText(words, panel.w, 11), accent ? t.accent : t.text, 11);
  if (!station) { line(panel.y, guild ? 'Build a guild to change calling.' : 'Build a workbench or smithy to craft equipment.'); return; }
  let y = panel.y;
  if (!guild) {
    const w = (panel.w - (kinds.length - 1) * 4) / kinds.length;
    kinds.forEach((kind, i) => button(c, `resident-station-${kind}`, new Rect(panel.x + i * (w + 4), y, w, 24),
      structureSpec(kind).name, () => { app.craftWorkshopFilter = kind; app.craftPage = 0; }, kind === station.kind ? ButtonStyle.Primary : ButtonStyle.Default,
      true, undefined, false, { fontSize: 11 }));
    y += 28;
  }
  if (!guild && p.craftItem) {
    const order = craftOrder(p.craftItem), parent = town.building(p.craftWorkshop);
    const cost = order && parent && orderCost(order, parent.kind);
    line(y, `${town.orderName(p)} · ${activityStatus(p)} · ${Math.round(town.craftShare(p) * 100)}%`, true);
    if (cost && parent && p.activity === Activity.WaitingMaterials) {
      const needed = town.missingUpgradeMaterials(p, parent, cost);
      if (!needed.empty()) { y += 18; line(y, `Waiting for ${describe(needed)}`); }
    }
    button(c, 'resident-cancel-craft', new Rect(panel.x, y + 21, Math.min(110, panel.w), 26), 'Cancel', () => { town.cancelCraft(p.id); }, ButtonStyle.Default, canControl(p));
    c.requestFrameAt(c.time() + 0.4);
    return;
  }
  if (guild && p.task === Activity.Training) {
    line(y, `Training ordered: ${callingName(p.trainingCalling)}`, true);
    button(c, 'resident-cancel-training', new Rect(panel.x, y + 21, Math.min(110, panel.w), 26), 'Cancel',
      () => { town.orderAutomatic([p.id]); }, ButtonStyle.Default, canControl(p));
    return;
  }
  const choices: Choice[] = guild ? town.guildTrainingOptions(p.id, station.id).map(o => ({ key: String(o.calling), name: o.name,
    detail: o.description, reason: o.reason, action: `Train as ${o.name}`, submit: () => town.orderTrainAtGuild(p.id, station.id, o.calling) })) : recipes(app, p, station);
  if (!choices.length) { line(y, 'No further upgrades'); return; }
  const index = Math.max(0, Math.min(app.craftPage, choices.length - 1)), selected = choices[index];
  const columns = Math.max(1, Math.min(3, Math.floor(panel.w / 100))), available = panel.y + panel.h - y;
  const compact = available < 180, font = compact ? 11 : 12, leading = compact ? 14 : 18, pitch = compact ? 26 : 30;
  const descriptions = choices.map(choice => [
    ...wrapText(c, choice.detail, panel.w, font).map(words => ({ words, color: t.accent })),
    ...gearStatRows(c, choice.stats ?? [], panel.w, font).map(words => ({ words, color: t.text })),
    ...(choice.preview ? [{ words: choice.preview, color: t.text }] : []),
    ...wrapText(c, choice.reason, panel.w, font).map(words => ({ words, color: t.danger })),
  ]);
  const reserve = Math.max(...descriptions.map(lines => lines.length)) * leading + 32;
  const rows = Math.max(1, Math.min(5, Math.floor((available - reserve) / pitch))), perPage = columns * rows;
  const start = Math.floor(index / perPage) * perPage, w = (panel.w - (columns - 1) * 4) / columns;
  choices.slice(start, start + perPage).forEach((choice, i) => {
    const id = `resident-choice-${choice.key}`;
    const state = button(c, id, new Rect(panel.x + (i % columns) * (w + 4), y + Math.floor(i / columns) * pitch, w, pitch - 4),
      choice.name, () => { app.craftPage = start + i; }, start + i === index ? ButtonStyle.Primary : ButtonStyle.Default, true, undefined, false, { fontSize: 11 });
    tooltip(c, id, state.hovered, [choice.detail, ...(choice.stats ?? []), choice.preview, choice.reason].filter((line): line is string => !!line));
  });
  y += Math.ceil(Math.min(perPage, choices.length - start) / columns) * pitch + 2;
  for (const { words, color } of descriptions[index]) {
    c.text(new Rect(panel.x, y, panel.w, leading), words, color, font);
    y += leading;
  }
  y += 3;
  const paged = choices.length > perPage, nav = paged ? 62 : 0;
  if (paged) {
    button(c, 'resident-choices-prev', new Rect(panel.x, y, 27, 25), '<', () => { app.craftPage = Math.max(0, start - perPage); }, ButtonStyle.Quiet, start > 0);
    button(c, 'resident-choices-next', new Rect(panel.x + 29, y, 27, 25), '>', () => { app.craftPage = start + perPage; }, ButtonStyle.Quiet, start + perPage < choices.length);
  }
  const state = button(c, 'resident-service-order', new Rect(panel.x + nav, y, Math.min(200, panel.w - nav), 26), selected.action,
    () => { if (selected.submit()) app.status = guild ? 'Training ordered' : `${p.name} goes to work at the ${structureSpec(station.kind).name.toLowerCase()}`; },
    ButtonStyle.Primary, canControl(p) && !selected.reason);
  tooltip(c, 'resident-service-order', state.hovered, [selected.reason || selected.detail]);
}
function activityStatus(p: Person): string {
  if (p.activity === Activity.Crafting) return p.refining ? productItem(p.refining)!.name : 'Crafting equipment';
  if ([Activity.Felling, Activity.Mining, Activity.Working, Activity.Collecting, Activity.Hauling, Activity.WaitingMaterials].includes(p.activity)) return 'Gathering materials';
  return 'On the way';
}
