import { orderRanchHarvest, ranchWorker, type RanchHarvest } from '../../../../packages/engine/src/livestock';
import { nestCapacity, penCapacity, readyForMeat, stockInPen } from '../../../../packages/engine/src/ranch-cycle';
import { Activity, AnimalKind } from '../../../../packages/engine/src/person';
import { animalSpec } from '../../../../packages/engine/src/wildlife';
import {
  Rect,
  Align,
  ButtonStyle,
  Icon,
  button,
  frame as pictureFrame,
  meter,
  tag,
  type Color,
  type Context,
} from '../../../../packages/native-ui/src';
import { Tool, Order, drawsArea, toolStructure } from '../../../../packages/engine/src/game-tools';
import { noticeToast } from './notice-toast';
import { toolInfo, buildMenuGroups, type BuildGroup } from './build-menu-tools';
import { toolAvailable } from '../../../../packages/engine/src/settlement-progression';
import {
  Structure,
  Product,
  Faith,
  structureSpec,
  isSeat,
  isLodging,
  isOutfitter,
  rentOf,
  priceOf,
  faithName,
  describe,
} from '../../../../packages/engine/src/building-catalog';
import { DungeonKind } from '../../../../packages/engine/src/world-types';
import { isCraftStation } from '../../../../packages/engine/src/equipment';
import { point, project, distance } from '../../../../packages/engine/src/geometry';
import { f32, clamp } from '../../../../packages/engine/src/numeric';
import type { Town } from '../../../../packages/engine/src/town';
import { structureIcon } from '../../../../packages/native-renderer/src/building-icon';
import { constructionIcon } from '../../../../packages/native-renderer/src/construction-icon';
import { buildingAppearanceRevision } from '../../../../packages/native-renderer/src/building-assets';
import type { GameHudApp } from './game-hud-contract';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';
import { civicInspector } from './game-civic-panel';
import { stationPagerWidth, stationProfile } from './craft-station-hud';
import { drawProfiles, hasProfiles, profileRows, profilesHeight } from './home-profiles-hud';
import { hudPaint } from './hud-paint';
import { materialRowsHeight, winterOutlookLine, winterLineHeight, type CampMarker } from './camp-resource-hud';
import { actionButton } from './hud-actions';
import {
  wrapText,
  trackUnlocks,
  noteBuildPage,
  freshGroup,
  freshMark,
  progressInspector,
  type InspectorRows,
} from './game-progress-hud';
import { clearRows } from './clear-order-hud';
import { inspectorHeightLimit, touchPlacementHeight } from './mobile-layout';
import { combatOverlays } from './game-combat-hud';
import { guideHud } from './game-guide-panel';
import { orderRail, unitOrderRail } from './unit-orders-card';
import { groupTabs } from './control-groups';
import { aimPrompt, currentAim } from './skill-commands';
import { attackDungeon, gateKindName, partyRecommendation, siegeLesson } from './dungeon-attack';
import { dungeonChallenge, dungeonStatus } from '../../../../packages/engine/src/dungeon-siege';
import { gateActive } from '../../../../packages/engine/src/gate-progression';
const tools = toolInfo;
/** Every group, in page order: a group's page number never changes while the settlement grows. */
export function buildGroups(_town: Town): BuildGroup[] {
  return [...buildMenuGroups];
}
/** The tools of a group the settlement can use now. What is still locked stays out of the menu. */
export const openTools = (town: Town, group: BuildGroup): Tool[] =>
  group.tools.filter((tool) => toolAvailable(town, tool));
/** A few groups are wide enough to carry their names; many stand as pictograms. */
const groupCell = (count: number): number => (count <= 4 ? 152 : 78);
/**
 * The page the menu shows for the page asked for. A group with nothing to build falls back to the list of
 * groups, and with a single group open its buildings are shown at once: there is nothing to choose between.
 */
export function shownPage(town: Town, page: number): number {
  const shown = openGroups(town),
    at = page > 0 && !shown.some((entry) => entry.page === page) ? 0 : page;
  return at === 0 && shown.length === 1 ? shown[0].page : at;
}
/** The groups that have something to build, each with its page number. */
export function openGroups(town: Town): { group: BuildGroup; page: number }[] {
  return buildMenuGroups
    .map((group, index) => ({ group, page: index + 1 }))
    .filter(({ group }) => openTools(town, group).length > 0);
}
const dungeonKind = gateKindName;
const wrap = wrapText;
/** A line of guidance on a strip of paper, so it reads over any ground. */
function strip(c: Context, text: string, area: Rect, ink: Color, size: number, centred = true): void {
  if (!text) return;
  const w = Math.min(area.w, f32(c.textWidth(text, size, true) + 28)),
    r = new Rect(centred ? f32(area.x + f32((area.w - w) / 2)) : area.x, area.y, w, area.h);
  tag(c, r, { cut: 4 });
  c.text(new Rect(f32(r.x + 10), r.y, f32(r.w - 20), r.h), c.elideText(text, f32(r.w - 20), size, true), ink, size, true, Align.Center);
}
export function hud(this: GameHudApp, width: number, height: number): void {
  this.updateContextDock(width, height);
  trackUnlocks(this);
  const c = this.context,
    t = this.theme;
  this.skyMural(width);
  if (this.town.raiding())
    strip(
      c,
      'Raid! Defend the settlement',
      new Rect(
        (width - Math.min(320, width - 24)) / 2,
        f32(f32(this.skyBounds.y + this.skyBounds.h) + 9),
        Math.min(320, width - 24),
        20,
      ),
      t.inkDanger,
      12,
    );
  // One line of guidance stands right above the dock; the notice feed stacks above it.
  const warning =
      (this.status || this.current.problem) && !(this.touchMode && this.toolStructure() !== undefined)
        ? this.status || this.current.problem
        : '',
    guided = !!warning || this.pending !== Order.None || !!currentAim(this),
    // What stands right above the dock keeps left of the order rail of a touch player.
    rail = orderRail(this, width, height),
    right = rail && !rail.beside && this.dockBounds.y - 130 < rail.bounds.y + rail.bounds.h ? f32(rail.bounds.x - 8) : width - 12,
    line = new Rect(12, f32(this.dockBounds.y - 32), f32(right - 12), 22);
  if (warning) strip(c, warning, line, t.inkDanger, 13);
  else if (this.pending !== Order.None)
    strip(
      c,
      this.touchMode
        ? this.pending === Order.Move
          ? 'Tap a destination'
          : this.pending === Order.Work
            ? 'Tap a resource, building or road'
            : 'Tap a target or destination'
        : this.pending === Order.Move
          ? 'Move: choose a destination'
          : this.pending === Order.Work
            ? 'Work: choose a resource, building or road'
            : 'Attack: choose an enemy, resource or destination',
      line,
      t.ink,
      13,
    );
  else if (currentAim(this)) strip(c, aimPrompt(this), line, t.ink, 13);
  if (!this.touchMode && width > 640 && !this.town.camp()) {
    const hintX = 16,
      hintWidth = Math.max(1, f32(f32(width - hintX) - 316)),
      hint = 'Found a camp (C) on explored ground.';
    let y = f32(f32(this.skyBounds.y + this.skyBounds.h) + 10);
    for (const row of wrap(c, hint, f32(hintWidth - 28), 11, 2)) {
      strip(c, row, new Rect(hintX, y, hintWidth, 20), t.ink, 11, false);
      y = f32(y + 24);
    }
  }
  noticeToast(this, width, height, guided ? 28 : 0, right);
  this.objectives(width, height, this.touchMode ? (this.timeExpanded ? 116 : 64) : width < 900 ? 104 : 64);
  this.timeControls(width);
  this.campSupplies(width, height);
  this.calendarDetails(width);
  this.taskbar(width, height);
  unitOrderRail(this, width, height);
  if (!this.town.isTitleAutoplay()) groupTabs(this, height);
  combatOverlays(this, width, height);
  this.sagaBanner(width, height);
  guideHud(this, width, height);
}
export function campSupplies(this: GameHudApp, width: number, height: number): void {
  const markers: CampMarker[] = [];
  for (const b of this.town.buildings())
    if (isPlayerBuilding(b) && isSeat(b.kind) && this.town.map().revealed(b.center)) {
      const roof = this.camera.toScreen(
        this.renderer.buildingRoof(b) ?? project(b.center.x, b.center.y, 32),
        width,
        height,
      );
      if (roof.x < -48 || roof.x > f32(width + 48) || roof.y < 0 || roof.y > f32(height + 48)) continue;
      markers.push({ camp: b.id, roof });
    }
  let hovered = -1;
  if (
    !this.touchMode &&
    this.tool === Tool.Select &&
    this.pending === Order.None &&
    !this.panFrom &&
    !this.boxFrom &&
    !this.context.controlAt(this.mouse.x, this.mouse.y) &&
    this.personAt(this.mouse) < 0
  ) {
    const b = this.town.building(this.buildingAtScreen(this.mouse));
    if (isPlayerBuilding(b) && isSeat(b.kind)) hovered = b.id;
  }
  const top = width < 900 && this.timeExpanded ? 100 : 60;
  this.campResources.draw(
    this.context,
    this.theme,
    this.town,
    markers,
    hovered,
    new Rect(
      12,
      top,
      f32(width - 24),
      Math.max(0, f32(Math.min(f32(height - 12), f32(this.dockBounds.y - 12)) - top)),
    ),
    this.reducedMotion(),
  );
}
export function inspector(this: GameHudApp, panel: Rect, draw = true): number {
  const c = this.context,
    t = this.theme,
    building = this.selected >= 0 ? this.town.building(this.selected) : null;
  if (!building && this.selectedDungeon < 0) return 0;
  if (this.touchMode && building?.built() && isSeat(building.kind)) {
    const stores = 180 + materialRowsHeight(this.town.stock(building.id)) + (winterOutlookLine(this.town, building.id) ? winterLineHeight : 0),
      width = f32(panel.w - 16),
      profiles = profilesHeight(this, building, width);
    if (draw) drawProfiles(this, building, f32(panel.x + 8), f32(panel.y + stores + 12), width);
    if (draw)
      this.campResources.drawStores(
        c,
        t,
        this.town,
        building.id,
        new Rect(panel.x + 8, panel.y + 8, panel.w - 16, stores),
      );
    return stores + profiles + 20;
  }
  if (building?.built() && [Structure.Shrine, Structure.Guild, Structure.GuildHall].includes(building.kind))
    return civicInspector.call(this, building, panel, draw);
  let y = 12;
  const station = building && isCraftStation(building.kind),
    lowDungeon = !building && this.viewHeight > 1 && this.viewHeight < 460,
    left = f32(panel.x + (station || !building ? 14 : 112)),
    inner = f32(panel.w - (station || !building ? 28 : 128)),
    top = panel.y,
    frame = station
      ? new Rect(left, f32(top + y), 44, 44)
      : new Rect(f32(panel.x + 12), f32(top + y), 84, 94),
    rows: (() => void)[] = [],
    textRow = (text: string, color: Color, size = 13, bold = false, lineHeight = size + (lowDungeon ? 4 : 9)) => {
      const at = y;
      rows.push(() => c.text(new Rect(left, f32(top + at), inner, f32(lineHeight - 1)), text, color, size, bold));
      y = f32(y + lineHeight);
    };
  if (building) {
    const spec = structureSpec(building.kind);
    if (station) {
      const profile: InspectorRows = { rows, left, inner, top, y };
      stationProfile(this, building, profile, frame);
      y = profile.y;
    } else {
      const severalCamps = isSeat(building.kind) && isPlayerBuilding(building) &&
        this.town.buildings().filter(b => isPlayerBuilding(b) && isSeat(b.kind) && b.built()).length > 1;
      textRow(severalCamps ? `${spec.name} #${building.id + 1}` : spec.name, t.text, 17, true);
    }
    if (building.faction > 0)
      textRow(`Neutral settlement #${building.faction} · inspection only`, t.accent, 12, true);
    if (building.built() && building.health < 1)
      textRow(
        `Damaged: ${Math.trunc(f32(building.health * 100))}%  -  builders will mend it`,
        t.danger,
        12,
        true,
      );
    for (const line of wrap(c, spec.description, inner, 12)) textRow(line, t.muted, 12, false, station ? 17 : 21);
    y = f32(y + 4);
    if (!building.built()) {
      textRow(`Under construction: ${Math.trunc(f32(building.progress * 100))}%`, t.accent, 13, true);
      textRow('On site: ' + describe(building.materials.delivered), t.text, 12);
      textRow('Required: ' + describe(building.materials.required), t.muted, 12);
      const source = this.town.constructionSupplyCamp(building.id);
      textRow(
        source >= 0 ? 'Road supply: Camp #' + (source + 1) : 'Gather locally and carry materials here',
        t.muted,
        11,
      );
    }
    if (spec.residents) textRow(`Homes ${spec.residents} people`, t.text);
    if (rentOf(building.kind)) {
      const owner = this.town.person(building.owner);
      textRow(
        owner
          ? `Owned by ${owner.name}`
          : `Let for ${rentOf(building.kind)} gold a day per resident; sells for ${priceOf(building.kind)}`,
        owner ? t.accent : t.muted,
        12,
      );
    }
    if (spec.beds) textRow(`Beds for ${spec.beds} guests`, t.text);
    if (hasProfiles(building)) {
      y = f32(y + 4);
      const profiles: InspectorRows = { rows, left, inner, top, y };
      profileRows(this, building, profiles);
      y = profiles.y;
    }
    if (building.kind === Structure.WoodStore) textRow('Keeps 240 more logs and planks', t.text);
    if (building.kind === Structure.Granary) textRow('Keeps 240 more food; meals served here', t.text);
    if (building.kind === Structure.StoneStore) textRow('Keeps 240 more rough and cut stone', t.text);
    if (spec.storage) textRow(`Keeps ${spec.storage} more of wood, stone, food and water`, t.text);
    if (isLodging(building.kind) || building.kind === Structure.Tavern || (isOutfitter(building.kind) && spec.jobs > 0))
      textRow(`Earned ${building.earned} gold from guests`, t.muted, 12);
    if (building.kind === Structure.Guild || building.kind === Structure.GuildHall)
      textRow(`${building.trainingCount} residents trained`, t.muted, 12);
    if (building.kind === Structure.Chapel && building.built()) {
      const peoples = ['humans', 'elves', 'dwarves', 'beastfolk'];
      textRow(`${faithName(building.faith)}: draws ${peoples[building.faith]}`, t.accent, 12, true);
      const at = y,
        id = building.id,
        current = building.faith;
      rows.push(() => {
        const tabs = ['Dawn', 'Grove', 'Forge', 'Moon'],
          w = Math.min(90, f32(f32(inner - 9) / 4));
        for (let i = 0; i < 4; i++)
          button(
            c,
            'faith-' + tabs[i],
            new Rect(f32(left + f32(i * f32(w + 3))), f32(top + at), w, 26),
            tabs[i],
            () => {
              if (isPlayerBuilding(this.town.building(id))) this.town.setFaith(id, i);
            },
            current === i ? ButtonStyle.Primary : ButtonStyle.Default,
            isPlayerBuilding(building),
          );
      });
      y = f32(y + 32);
    }
    if (building.kind === Structure.Ranch && building.built()) {
      const stock = stockInPen(this.town, building.id), adults = stock.filter(a => a.ranchBornAt < 0);
      const ready = readyForMeat(stock, this.town.clock());
      textRow(`Breeding stalls ${adults.length} / ${penCapacity}`, t.text, 13, true);
      const hens = adults.filter(a => a.animal === AnimalKind.Chicken).length;
      textRow(`Chickens ${hens} · Eggs in nest ${building.eggs} / ${nestCapacity}`, building.eggs ? t.success : t.muted, 12);
      for (const kind of [AnimalKind.Pig, AnimalKind.Cow]) {
        const family = stock.filter(a => a.animal === kind), count = family.length;
        const young = family.find(a => a.ranchBornAt >= 0);
        const state = young ? (ready.includes(young) ? 'Ready for meat' : kind === AnimalKind.Pig ? 'Piglet growing' : 'Calf growing')
          : count >= 2 ? 'Breeding' : count ? 'Needs a mate' : '';
        const label = kind === AnimalKind.Pig ? `Pigs ${count}` : `Cows ${count}`;
        textRow(state ? `${label} · ${state}` : label, young || count >= 2 ? t.success : t.muted, 12);
      }
      const worker = ranchWorker(this.town, building);
      if (worker) textRow(worker.task === Activity.GatheringEggs ? `${worker.name} is collecting eggs` : `${worker.name} is preparing meat`, t.accent, 12);
      else if (building.eggs || ready.length) {
        const hands = this.town.stationFolk(building).filter(p => !p.ordered && p.job < 0 && !p.craftItem &&
          (p.task === Activity.Idle || p.task === Activity.Felling || p.task === Activity.Mining));
        const village = this.town.settlementOf(building);
        const room = this.town.capacity(village).food - this.town.stock(village).food;
        const action = (task: RanchHarvest, label: string, key: string, fits: boolean) => {
          const at = y, height = this.touchMode ? 44 : 28;
          rows.push(() => button(c, key, new Rect(left, top + at, inner, height), label,
            () => { hands.some(p => orderRanchHarvest(this.town, p, building, task)); },
            ButtonStyle.Default, fits && hands.length > 0 && isPlayerBuilding(building)));
          y += height + 4;
        };
        if (building.eggs) action(Activity.GatheringEggs, 'Collect eggs', 'ranch-collect-eggs', room >= 1);
        const meatFits = ready.some(a => animalSpec(a.animal!).food <= room);
        if (ready.length) action(Activity.PreparingMeat, 'Prepare meat', 'ranch-prepare-meat', meatFits);
        if (room < 1 || (ready.length && !meatFits)) textRow('Make room in food storage.', t.muted, 12);
        else if (!hands.length) textRow('Waiting for a free resident.', t.muted, 12);
      }
    }
    if (spec.jobs) {
      const at = y,
        id = building.id,
        workers = building.workers,
        hands = this.town.idle() > 0 || this.town.employed() > workers;
      rows.push(() => {
        const labelWidth = this.touchMode ? inner - 100 : 200,
          size = this.touchMode ? 44 : 30,
          rowHeight = this.touchMode ? 44 : 26;
        c.text(
          new Rect(left, f32(top + at), labelWidth, rowHeight),
          `Workers ${workers} / ${spec.jobs}`,
          t.text,
          13,
        );
        button(
          c,
          'workers-less',
          new Rect(f32(left + (this.touchMode ? inner - 94 : 200)), f32(top + at), size, rowHeight),
          '-',
          () => {
            if (isPlayerBuilding(this.town.building(id))) this.town.setWorkers(id, f32(workers - 1));
          },
          ButtonStyle.Default,
          isPlayerBuilding(building) && workers > 0,
        );
        button(
          c,
          'workers-more',
          new Rect(f32(left + (this.touchMode ? inner - 44 : 234)), f32(top + at), size, rowHeight),
          '+',
          () => {
            if (isPlayerBuilding(this.town.building(id))) this.town.setWorkers(id, f32(workers + 1));
          },
          ButtonStyle.Default,
          isPlayerBuilding(building) && workers < spec.jobs && hands,
        );
      });
      y = f32(y + (this.touchMode ? 50 : 32));
      const output = this.town.dailyOutput(building);
      if (building.kind === Structure.Farm)
        textRow(
          `Fields tended ${this.town.tendedFieldAcres()} of ${this.town.fieldAcres()} acres`,
          t.muted,
          12,
        );
      else if (spec.product === Product.Wood) {
        let standing = 0;
        const map = this.town.map();
        for (let y = f32(Math.trunc(building.center.y) - 5); y <= f32(Math.trunc(building.center.y) + 5); y++)
          for (
            let x = f32(Math.trunc(building.center.x) - 5);
            x <= f32(Math.trunc(building.center.x) + 5);
            x++
          )
            if (
              map.inside(x, y) &&
              distance(point(f32(x + f32(0.5)), f32(y + f32(0.5))), building.center) < f32(4.6)
            )
              standing = f32(standing + map.at(x, y).trees);
        textRow(
          standing
            ? `Fells nearby trees: ${standing} left in reach`
            : 'No trees left in reach; they grow back slowly',
          standing ? t.success : t.danger,
          12,
        );
      } else if (spec.product === Product.Planks || spec.product === Product.CutStone)
        textRow(
          spec.product === Product.Planks
            ? '2 logs → 1 plank / 24 worker seconds'
            : '2 stone → 1 cut stone / 30 worker seconds',
          t.success,
          12,
        );
      else if (spec.product === Product.Stone)
        textRow('Miners gather stone from nearby deposits.', t.muted, 12);
      else if (!output.empty()) textRow(`Makes ${describe(output)} a day`, t.success, 12);
      else if (spec.product !== Product.None && !building.workers) textRow('Assign a worker to start production.', t.muted, 12);
    }
    const footerWidth = station && building.built() ? Math.max(1, inner - stationPagerWidth(this.touchMode) - 8) : inner;
    const footer: InspectorRows = { rows: [], left, inner: footerWidth, top, y: 0 };
    if (isPlayerBuilding(building)) clearRows(this, { kind: 'building', id: building.id }, footer);
    const progress: InspectorRows = { rows, left, inner, top, y };
    if (station && this.viewHeight > 1) progress.bottom = inspectorHeightLimit(this.viewHeight, true) - footer.y - 10;
    progressInspector(this, building, -1, progress);
    y = progress.y;
    const growth = this.town.growthStatus(building);
    if (growth.grows) {
      y = f32(y + 4);
      textRow('Grows into ' + growth.next, t.accent, 13, true);
      const at = y,
        fraction = growth.needed ? f32(growth.days / growth.needed) : 0;
      rows.push(() => {
        meter(c, new Rect(left, f32(f32(top + at) + 4), inner, 8), fraction, t.accent);
      });
      y = f32(y + 18);
      textRow(`${growth.days} / ${growth.needed} days`, t.muted, 12);
      if (growth.reason)
        for (const line of wrap(c, growth.reason, inner, 12, 2))
          textRow(line, growth.ready ? t.muted : t.danger, 12);
    }
    footer.top = f32(top + y);
    rows.push(...footer.rows);
    y = f32(y + footer.y);
  } else {
    const site = this.town.map().dungeons()[this.selectedDungeon];
    textRow(site.name, t.text, 16, true);
    const challenge = site.kind === DungeonKind.Return || site.kind === DungeonKind.GiantHall
      ? null : dungeonChallenge(this.town, this.selectedDungeon);
    const kind = dungeonKind(site.kind);
    textRow(challenge ? `${kind} · Dungeon tier ${challenge.tier}` : kind, t.accent, 13);
    if (site.kind === DungeonKind.Return) {
      for (const line of wrap(
        c,
        'The way back to Midgard. Gather the whole party here, then choose Go home. After the guardian falls the way opens from anywhere.',
        inner,
        12,
      ))
        textRow(line, t.muted, 12);
    } else if (site.kind === DungeonKind.GiantHall) {
      for (const line of wrap(
        c,
        'Neutral stone giants live on the eastern coast. They leave their hall by day and return at dusk. They retaliate only when attacked.',
        inner,
        12,
      ))
        textRow(line, t.muted, 12);
    } else {
      const gate = this.selectedDungeon;
      const { phase, health, maxHealth, remaining, creatures } = dungeonStatus(this.town, gate);
      if (phase === 'standing') {
        if (challenge) {
          for (const recommendation of partyRecommendation(challenge))
            for (const line of wrap(c, recommendation, inner, 12)) textRow(line, t.accent, 12, true);
        }
        textRow(`Dungeon health: ${Math.ceil(health)} / ${maxHealth}`, t.text, 13, true);
        const barY = y;
        rows.push(() => meter(c, new Rect(left, top + barY + 2, inner, 8), health / maxHealth, t.danger));
        y += 16;
        if (!gateActive(this.town, gate)) textRow('Dormant gate', t.muted, 12);
        for (const line of wrap(c, siegeLesson, inner, 12)) textRow(line, t.muted, 12);
        const at = y;
        rows.push(() => button(c, 'gate-attack', new Rect(left, top + at + 2, Math.min(inner, 220), this.touchMode ? 44 : 28),
          'Attack', () => attackDungeon(this, gate), ButtonStyle.Primary));
        y += this.touchMode ? 52 : 36;
      } else if (phase === 'sealed') {
        textRow('Sealed: no raid leaves this gate', t.success, 12, true);
      } else if (phase === 'summoning') {
        textRow('The guardian is rising', t.danger, 13, true);
      } else {
        textRow(`Defenders left: ${creatures}`, t.text, 13, true);
        textRow(`Dungeon rises in ${Math.ceil(remaining)}s`, t.danger, 12);
      }
    }
    const progress: InspectorRows = { rows, left, inner, top, y };
    progressInspector(this, null, this.selectedDungeon, progress);
    y = progress.y;
  }
  const h = Math.max(126, f32(y + 10));
  if (!draw) return h;
  if (building) {
    pictureFrame(c, frame);
    const art = frame.inset(station ? 4 : 10),
      kind = building.kind;
    c.paint(
      `inspect-${buildingAppearanceRevision(kind)}-${kind}-${art.w}-${Math.trunc(art.x)}-${Math.trunc(art.y)}`,
      () => {
        const holder = new c.tvg.Scene(),
          icon = hudPaint(c, structureIcon(kind, art.w, art.h));
        holder.add(icon);
        icon.dispose();
        holder.translate(art.x, art.y);
        return holder;
      },
    );
  }
  for (const row of rows) row();
  return h;
}
export function buildMenuBounds(this: GameHudApp, width: number, height: number, global: boolean): Rect {
  const groups = buildGroups(this.town),
    page = shownPage(this.town, clamp(global ? this.globalCard : this.card, 0, groups.length)),
    count = Math.max(1, page === 0 ? openGroups(this.town).length : openTools(this.town, groups[f32(page - 1)]).length),
    cell = page === 0 ? groupCell(count) : 86,
    available = Math.max(160, f32(width - 24)),
    columns = Math.max(1, Math.min(count, Math.trunc(f32(f32(available - 18) / f32(cell + 6))))),
    w = Math.min(available, Math.max(244, f32(f32(f32(columns * cell) + f32(f32(columns - 1) * 6)) + 24))),
    rows = Math.trunc(f32(f32(f32(count + columns) - 1) / columns)),
    h = f32(
      f32(
        f32((this.touchMode ? 60 : 48) + f32(rows * (page === 0 ? (this.touchMode ? 44 : 32) : 64))) +
          f32(f32(rows - 1) * 6),
      ) + (page === 0 ? 6 : 30),
    );
  return new Rect(f32(f32(width - w) / 2), f32(f32(height - 56) - h), w, h);
}
export function commandCard(
  this: GameHudApp,
  area: Rect,
  scale = 1,
  global = false,
  buildMenu = false,
): void {
  const c = this.context,
    t = this.theme,
    appearance = { fontSize: f32(12 * scale), radius: f32(t.radius * scale) },
    drawButton = (
      id: string,
      bounds: Rect,
      label: string,
      activate: () => void,
      style = ButtonStyle.Default,
      enabled = true,
      look: { fill?: Color; border?: Color; borderWidth?: number } = {},
    ) => {
      button(
        c,
        `${global ? 'global/' : 'unit/'}${id}`,
        bounds,
        label,
        activate,
        style,
        enabled,
        Icon.None,
        false,
        { ...appearance, ...look },
      );
    };
  if (!buildMenu) return;
  const groups = buildGroups(this.town),
    chosen = clamp(global ? this.globalCard : this.card, 0, groups.length),
    page = shownPage(this.town, chosen),
    setPage = (next: number) => {
      const d = this.dockBounds;
      this.drawerBridge = new Rect(d.x, d.y, d.w, d.h);
      if (global) this.globalCard = next;
      else this.card = next;
    },
    shown = openGroups(this.town),
    open = page === 0 ? [] : openTools(this.town, groups[f32(page - 1)]);
  noteBuildPage(this, open);
  actionButton(
    c,
    `${global ? 'global/' : 'unit/'}card-back`,
    new Rect(f32(area.x + 10), f32(area.y + 5), this.touchMode ? 44 : 34, this.touchMode ? 44 : 32),
    'back',
    'Back',
    () => {
      // Back leads to the groups, or out of the menu when this page stands in for them.
      if (page > 0 && chosen > 0 && shown.length > 1) setPage(0);
      else this.dismissBuildDrawer();
    },
    false,
    true,
    false,
  );
  let title = page === 0 ? 'Build' : groups[f32(page - 1)].name;
  if (!global && this.chosen.length === 1) {
    const p = this.town.person(this.chosen[0]);
    if (p) title = `${title} · ${p.name}`;
  }
  c.text(
    new Rect(f32(area.x + 64), f32(area.y + 10), f32(area.w - 76), 22),
    c.elideText(title, f32(area.w - 76), 13, true),
    t.text,
    13,
    true,
  );
  const count = page === 0 ? shown.length : open.length,
    preferred = page === 0 ? groupCell(count) : 86,
    columns = Math.max(1, Math.min(count, Math.trunc(f32(f32(area.w - 18) / f32(preferred + 6))))),
    w = f32(f32(f32(area.w - 24) - f32(f32(columns - 1) * 6)) / columns),
    h = page === 0 ? (this.touchMode ? 44 : 32) : 64,
    cell = (i: number) =>
      new Rect(
        f32(f32(area.x + 12) + f32((i % columns) * f32(w + 6))),
        f32(f32(area.y + (this.touchMode ? 54 : 40)) + f32(Math.trunc(f32(i / columns)) * f32(h + 6))),
        w,
        h,
      );
  if (page === 0) {
    for (let i = 0; i < count; i++) {
      const { name, glyph, tools: members } = shown[i].group,
        to = shown[i].page;
      actionButton(c, `${global ? 'global/' : 'unit/'}card-group-${name}`, cell(i), glyph, name, () => setPage(to), false, true, true, w >= 150);
      if (freshGroup(this, members)) freshMark(this, cell(i), false);
    }
    return;
  }
  let detail = 'Choose a building';
  // A building just opened is ringed in ochre until the player has looked at it.
  const beat = t.reducedMotion ? 1 : f32(0.6 + 0.4 * Math.sin(c.time() * 5));
  for (let i = 0; i < count; i++) {
    const id = open[i],
      bounds = cell(i),
      kind = toolStructure(id),
      hasIcon = kind !== undefined || id === Tool.Road || id === Tool.Pave || id === Tool.Field,
      fresh = this.unlockFresh.has(id);
    drawButton(
      'card-pick-' + tools[id].label,
      bounds,
      hasIcon ? '' : tools[id].label,
      () => this.selectTool(id, !global),
      this.tool === id ? ButtonStyle.Primary : ButtonStyle.Default,
      true,
      fresh ? { border: { ...t.accent, a: Math.round(255 * beat) }, borderWidth: 2 } : {},
    );
    if (hasIcon) {
      const art = new Rect(f32(bounds.x + 6), f32(bounds.y + 3), f32(bounds.w - 12), f32(bounds.h - 23));
      c.paint(
        `card-icon-${kind === undefined ? 0n : buildingAppearanceRevision(kind)}${JSON.stringify([id, art])}`,
        () => {
          const holder = new c.tvg.Scene(),
            icon = hudPaint(c, constructionIcon(id, art.w, art.h));
          holder.add(icon);
          icon.dispose();
          holder.translate(art.x, art.y);
          return holder;
        },
      );
      c.text(
        new Rect(f32(bounds.x + 3), f32(f32(bounds.y + bounds.h) - 21), f32(bounds.w - 6), 18),
        tools[id].label,
        t.text,
        11,
        false,
        Align.Center,
      );
    }
    if (fresh) {
      freshMark(this, bounds, true);
      if (!t.reducedMotion) c.requestAnimationFrame();
    }
    if (bounds.contains(this.mouse.x, this.mouse.y))
      detail =
        kind !== undefined
          ? `${describe(structureSpec(kind).cost)} · ${tools[id].key}${drawsArea(id) ? ' · Drag an area' : ''}`
          : tools[id].hint;
  }
  c.text(
    new Rect(f32(area.x + 12), f32(f32(area.y + area.h) - 26), f32(area.w - 24), 18),
    c.elideText(detail, f32(area.w - 24), 11),
    t.muted,
    11,
  );
}
export function placementPanelBounds(this: GameHudApp, width: number, height: number): Rect {
  const w = Math.min(this.touchMode ? 520 : 460, f32(width - 24)),
    h = this.touchMode ? touchPlacementHeight : 70;
  return new Rect(f32(f32(width - w) / 2), f32(height - 12 - h), w, h);
}
export function placementPanel(this: GameHudApp, panel: Rect): void {
  const c = this.context,
    t = this.theme;
  if (this.touchMode) {
    const kind = this.toolStructure(),
      detail =
        kind !== undefined
          ? this.current.problem || `${describe(structureSpec(kind).cost)} · Tap or drag to position`
          : this.tool === Tool.Road || drawsArea(this.tool)
            ? 'Draw with one finger · Move or zoom with two'
            : 'Tap a target · Drag to move the map',
      y = panel.y + 56;
    c.text(new Rect(panel.x + 12, panel.y + 8, panel.w - 24, 22), tools[this.tool].label, t.text, 14, true);
    c.text(
      new Rect(panel.x + 12, panel.y + 32, panel.w - 24, 18),
      c.elideText(detail, panel.w - 24, 11),
      this.current.problem ? t.danger : t.muted,
      11,
    );
    actionButton(c, 'placement-build', new Rect(panel.x + 10, y, 44, 44), 'build', 'Buildings', () => {
      this.globalCard = 0;
      this.card = -1;
      this.drawerPinned = true;
      this.drawerSuppressed = false;
    });
    if (kind !== undefined) {
      actionButton(c, 'placement-rotate', new Rect(panel.x + 62, y, 44, 44), 'rotate', 'Rotate', () =>
        this.rotate(Math.PI / 12),
      );
      button(
        c,
        'placement-confirm',
        new Rect(panel.x + 116, y, panel.w - 180, 44),
        'Place',
        () => this.confirmTouchPlacement(),
        ButtonStyle.Primary,
        !!this.touchPlacement && this.current.preview.valid,
      );
    } else if (drawsArea(this.tool) && this.outline.length) {
      actionButton(c, 'placement-undo', new Rect(panel.x + 62, y, 44, 44), 'back', 'Undo point', () =>
        this.undoPoint(),
      );
      button(
        c,
        'placement-confirm',
        new Rect(panel.x + 116, y, panel.w - 180, 44),
        'Plant',
        () => this.finish(),
        ButtonStyle.Primary,
        this.outline.length >= 3 && this.current.preview.valid,
      );
    } else
      c.text(
        new Rect(panel.x + 60, y, panel.w - 124, 44),
        'Two fingers to move / zoom',
        t.muted,
        11,
        false,
        Align.Center,
      );
    actionButton(
      c,
      'placement-cancel',
      new Rect(panel.x + panel.w - 54, y, 44, 44),
      'close',
      'Cancel placement',
      () => this.selectTool(Tool.Select),
      false,
      true,
      false,
    );
    return;
  }
  c.text(
    new Rect(f32(panel.x + 12), f32(panel.y + 9), f32(panel.w - 172), 22),
    tools[this.tool].label,
    t.text,
    14,
    true,
  );
  const kind = this.toolStructure(),
    detail =
      kind !== undefined
        ? `${describe(structureSpec(kind).cost)} · R rotates`
        : this.tool === Tool.Farm
          ? `${describe(structureSpec(Structure.Farm).cost)} · Drag an area for the farmhouse and its field`
          : tools[this.tool].hint;
  c.text(
    new Rect(f32(panel.x + 12), f32(panel.y + 36), f32(panel.w - 24), 18),
    c.elideText(detail, f32(panel.w - 24), 11),
    t.muted,
    11,
  );
  button(
    c,
    'placement-build',
    new Rect(f32(f32(panel.x + panel.w) - 156), f32(panel.y + 9), 68, 24),
    'Build',
    () => {
      this.globalCard = 0;
      this.card = -1;
      this.drawerPinned = true;
      this.drawerSuppressed = false;
    },
    ButtonStyle.Quiet,
  );
  button(
    c,
    'placement-cancel',
    new Rect(f32(f32(panel.x + panel.w) - 82), f32(panel.y + 9), 70, 24),
    'Cancel',
    () => this.selectTool(Tool.Select),
    ButtonStyle.Quiet,
  );
}
