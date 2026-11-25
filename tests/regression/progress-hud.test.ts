import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Rect } from '../../packages/native-ui/src';
import { Structure, Resources, Product, structureSpec } from '../../packages/engine/src/building-catalog';
import { Building, Field } from '../../packages/engine/src/town-models';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { Town } from '../../packages/engine/src/town';
import { Calling, Role, type Person } from '../../packages/engine/src/person';
import { point } from '../../packages/engine/src/geometry';
import { Tool, toolStructure } from '../../packages/engine/src/game-tools';
import { selectTool } from '../../apps/web/src/native/game-input';
import { GoalBranch, settlementGoals, toolAvailable } from '../../packages/engine/src/settlement-progression';
import { Boon, boonName, boonOfWorld } from '../../packages/engine/src/gate-boons';
import { sealFloors, sealable } from '../../packages/engine/src/gate-seals';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { economyRules } from '../../packages/engine/src/economy-rules';
import { GameAppState, DockView } from '../../apps/web/src/native/game-app-state';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';
import { commandCard, inspector, buildMenuBounds, buildGroups, openGroups } from '../../apps/web/src/native/game-hud';
import { objectives } from '../../apps/web/src/native/game-objectives';
import { calendarDetails } from '../../apps/web/src/native/game-sky-hud';
import { winterOutlookLine } from '../../apps/web/src/native/camp-resource-hud';
import { trackUnlocks, trackGearUse, freshGroup } from '../../apps/web/src/native/game-progress-hud';
import { setGuidePreference } from '../../apps/web/src/native/guide-preferences';
import { unlockOf } from '../../apps/web/src/native/game-guide';
import { questRules } from '../../apps/web/src/native/game-objectives';
import { Activity } from '../../packages/engine/src/person';
import { addInventory } from '../../packages/engine/src/equipment';

// The quest panel shows the goal `currentGoal` names; tests pick it directly.
const goalPick = vi.hoisted(() => ({ branch: null as null | ((branch: number) => number) }));
vi.mock('../../packages/engine/src/settlement-progression', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/engine/src/settlement-progression')>();
  return {
    ...actual,
    currentGoal: (town: Town, branch: GoalBranch) =>
      goalPick.branch ? goalPick.branch(branch) : actual.currentGoal(town, branch),
  };
});
class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return { putImageData() {}, clearRect() {} };
  }
}
let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({
    renderer: 'sw',
    locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
  });
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});
afterEach(() => {
  goalPick.branch = null;
});
const goalIndex = (title: string, branch?: GoalBranch): number =>
  settlementGoals().findIndex((goal) => goal.title === title && (branch === undefined || goal.branch === branch));
/** A founded settlement with a finished camp, its first road laid (the second quest) and no founders. */
function settlement(): Town {
  const town = new Town(5, 32, false),
    at = town.map().camp(),
    camp = new Building(0, Structure.Camp, at, 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(0);
  town.roads().road(town.roads().add([sharpAnchor(at), sharpAnchor(point(at.x + 3, at.y))], 1))!.village = 0;
  town.notices = [];
  return town;
}
function facility(town: Town, kind: Structure, workers = 0): Building {
  const b = new Building(town.nextId++, kind, point(4 + town.nextId * 3, 4), 0, 0);
  b.village = 0;
  b.workers = workers;
  town.placed.push(b);
  return b;
}
function resident(town: Town, calling = Calling.Settler, level = 1): Person {
  const p = town.makePerson(Role.Resident, calling, town.map().camp());
  p.home = p.village = 0;
  p.level = level;
  town.folk.push(p);
  return p;
}
/** Stands what the founding quests ask for before the altar: bench, smithy, tent, farmhouse and a planted field. */
function settled(town: Town): void {
  for (const kind of [Structure.Workbench, Structure.Weaponsmith, Structure.Tent, Structure.Farm]) facility(town, kind);
  town.farmland.push(new Field(77, [point(1, 1), point(5, 1), point(5, 5), point(1, 5)], 0));
}
/** A found, sealable gate (synthetic when the small map has none) and its index. */
function gate(town: Town): number {
  const sites = town.map().dungeons();
  let index = sites.findIndex(sealable);
  if (index < 0) index = sites.push({ name: 'Test gate', kind: DungeonKind.Cave, origin: { x: 20, y: 20 }, discovered: true }) - 1;
  sites[index].discovered = true;
  return index;
}
function fixture(town: Town, width = 1024, height = 768) {
  const canvas = new tvg.Canvas(new MemoryCanvas(width, height) as never, {
    width,
    height,
    enableDevicePixelRatio: false,
  });
  for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  const metrics = Object.fromEntries(
    ['DejaVuSans', 'DejaVuSans-Bold'].map((font) => [
      font,
      parseFontMetrics(new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`))),
    ]),
  );
  const context = new Context(tvg, metrics);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the HUD functions under test use only GameAppState fields and the stubs below.
  const app = new GameAppState(town, { buildingRoof: () => null } as never, context) as GameHudApp;
  app.selectTool = vi.fn();
  app.selectBuilding = vi.fn();
  app.selectPeople = vi.fn();
  app.reducedMotion = () => true;
  app.dismissBuildDrawer = vi.fn();
  const controls = vi.spyOn(context, 'control'),
    labels = vi.spyOn(context, 'text');
  canvas.add(context.scene());
  const words = () => labels.mock.calls.map(([, text]) => text);
  const control = (id: string) => controls.mock.calls.find(([key]) => key === id);
  return {
    app,
    context,
    controls,
    words,
    control,
    draw(fn: () => void) {
      controls.mockClear();
      labels.mockClear();
      context.begin(app.theme, new Rect(0, 0, width, height), 1);
      fn();
      context.end();
      canvas.update().render();
    },
    click(id: string) {
      const found = control(id);
      expect(found, id).toBeDefined();
      const r = found![1];
      context.pointerDown(r.x + r.w / 2, r.y + r.h / 2);
      context.pointerUp(r.x + r.w / 2, r.y + r.h / 2);
    },
    dispose() {
      canvas.remove();
      context.dispose();
      app.campResources.dispose();
      canvas.destroy();
    },
  };
}
const questPanel = (ui: ReturnType<typeof fixture>) => {
  ui.app.dockBounds = new Rect(200, 640, 600, 100);
  ui.draw(() => objectives.call(ui.app, 1024, 768, 64));
};

describe('quest panel', () => {
  it('drives a building goal from goalProgress and offers the right tool or site', () => {
    const town = new Town(5, 32, false),
      ui = fixture(town);
    try {
      questPanel(ui);
      expect(ui.words()).toEqual(expect.arrayContaining(['Found a camp', 'Not built yet', 'Place Camp']));
      ui.click('quest-action/0');
      expect(ui.app.selectTool).toHaveBeenCalledWith(Tool.Camp);
      const site = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
      site.progress = 0.4;
      site.village = 0;
      town.placed.push(site);
      questPanel(ui);
      expect(ui.words()).toContain('Find construction site');
      ui.click('quest-action/0');
      expect(ui.app.selectBuilding).toHaveBeenCalledWith(site.id);
    } finally {
      ui.dispose();
    }
  });
  it('counts residents for a population goal and leads to the altar, then to housing', () => {
    const town = settlement(),
      ui = fixture(town),
      goal = goalIndex('Reach 4 residents');
    try {
      resident(town);
      resident(town);
      settled(town);
      goalPick.branch = (branch) => (branch === GoalBranch.Core ? goal : -1);
      questPanel(ui);
      // Beds are free, so the altar is the way to grow: with none standing the quest leads to placing one.
      expect(ui.words()).toEqual(expect.arrayContaining(['Reach 4 residents', '2 / 4 residents', 'Place Altar of Odin']));
      ui.click(`quest-action/${goal}`);
      expect(ui.app.selectTool).toHaveBeenCalledWith(Tool.Shrine);
      const altar = facility(town, Structure.Shrine);
      questPanel(ui);
      expect(ui.words()).toContain("Open Odin's altar");
      ui.click(`quest-action/${goal}`);
      expect(ui.app.selectBuilding).toHaveBeenCalledWith(altar.id);
      // With every bed taken the answer is housing.
      while (town.population() < town.housing()) resident(town);
      questPanel(ui);
      expect(ui.words()).toContain('Build housing');
      expect(toolAvailable(town, Tool.Tent)).toBe(true);
      ui.click(`quest-action/${goal}`);
      expect(ui.app.selectTool).toHaveBeenCalledWith(Tool.Tent);
    } finally {
      ui.dispose();
    }
  });
  it('leads the farm quest to the Farm tool, then to the farmhouse site it staked out', () => {
    const town = settlement(),
      ui = fixture(town),
      goal = goalIndex('Lay out a farm');
    try {
      for (const kind of [Structure.Workbench, Structure.Weaponsmith, Structure.Tent]) facility(town, kind);
      goalPick.branch = (branch) => (branch === GoalBranch.Core ? goal : -1);
      questPanel(ui);
      expect(ui.words()).toEqual(expect.arrayContaining(['Lay out a farm', 'No farm yet']));
      ui.click(`quest-action/${goal}`);
      expect(ui.app.selectTool).toHaveBeenCalledWith(Tool.Farm);
      const site = facility(town, Structure.Farm);
      site.progress = 0.4;
      questPanel(ui);
      expect(ui.words()).toEqual(expect.arrayContaining(['Under construction', 'Find construction site']));
      ui.click(`quest-action/${goal}`);
      expect(ui.app.selectBuilding).toHaveBeenCalledWith(site.id);
    } finally {
      ui.dispose();
    }
  });
  it('leads a crafting goal to a workbench, then to its list, which names who gets the item', () => {
    const town = settlement(),
      ui = fixture(town),
      goal = goalIndex('Craft a wooden tool');
    try {
      const near = resident(town),
        carrier = resident(town);
      carrier.position = point(near.position.x + 6, near.position.y);
      goalPick.branch = (branch) => (branch === GoalBranch.Core ? goal : -1);
      questPanel(ui);
      // No bench yet: the quest offers to place one.
      expect(ui.words()).toEqual(expect.arrayContaining(['Craft a wooden tool', 'Wood 0 / 3 for Wooden axe', 'Place Workbench']));
      ui.click(`quest-action/${goal}`);
      expect(ui.app.selectTool).toHaveBeenCalledWith(Tool.Workbench);
      const bench = facility(town, Structure.Workbench);
      // Wood in any pack counts; the item goes to whoever stands nearest the bench.
      expect(addInventory(carrier, 'wood', 3)).toBe(true);
      questPanel(ui);
      expect(ui.words()).toEqual(expect.arrayContaining(['Ready to craft Wooden axe', 'Open the workbench']));
      ui.click(`quest-action/${goal}`);
      expect(ui.app.selectBuilding).toHaveBeenCalledWith(bench.id);
      // The bench's own list names who gets the item, tags the quest's recipe and starts the work.
      ui.app.chosen = [carrier.id];
      ui.app.selected = bench.id;
      const inspect = () => ui.draw(() => inspector.call(ui.app, new Rect(100, 60, 620, 700), true));
      inspect();
      expect(ui.words()).toEqual(
        expect.arrayContaining(['Quest', 'Wooden axe', '3 wood', `Goes to ${near.name}`, 'Nobody is working here']),
      );
      expect(ui.control('station-craft-wooden-axe')?.[3]).toBe(true);
      expect(ui.control('station-craft-wooden-pick')?.[3]).toBe(false);
      expect(ui.control(`station-crafter-next-${bench.id}`)).toBeUndefined();
      const order = vi.spyOn(town, 'orderCraft');
      ui.click('station-craft-wooden-axe');
      expect(order).toHaveBeenCalledWith(near.id, bench.id, 'wooden-axe');
      town.cancelCraft(near.id);
      // One works the bench, another waits beside it.
      Object.assign(carrier, { task: Activity.Crafting, activity: Activity.Crafting, craftItem: 'wooden-axe', craftWorkshop: bench.id, craftProgress: 3 });
      Object.assign(near, { task: Activity.Crafting, activity: Activity.Holding, craftItem: 'wooden-hoe', craftWorkshop: bench.id });
      inspect();
      expect(ui.words()).toEqual(
        expect.arrayContaining([
          `${carrier.name} is making Wooden axe · 50%`,
          `${near.name} waits to make Wooden hoe`,
          'Nothing is spent until the item is done.',
        ]),
      );
      // Each order can be called off: the worker's, each waiting one's, and on the recipe row it started from.
      expect(ui.control(`station-cancel-${bench.id}`)?.[3]).toBe(true);
      expect(ui.control(`station-cancel-${bench.id}-${near.id}`)?.[3]).toBe(true);
      expect(ui.control('station-cancel-wooden-axe')?.[3]).toBe(true);
      expect(ui.control('station-craft-wooden-axe')).toBeUndefined();
      const cancel = vi.spyOn(town, 'cancelCraft');
      ui.click('station-cancel-wooden-axe');
      expect(cancel).toHaveBeenLastCalledWith(carrier.id);
      Object.assign(carrier, { task: Activity.Crafting, activity: Activity.Crafting, craftItem: 'wooden-axe', craftWorkshop: bench.id, craftProgress: 3 });
      inspect();
      ui.click(`station-cancel-${bench.id}-${near.id}`);
      expect(cancel).toHaveBeenLastCalledWith(near.id);
      Object.assign(carrier, { task: Activity.Crafting, activity: Activity.Crafting, craftItem: 'wooden-axe', craftWorkshop: bench.id, craftProgress: 3 });
      inspect();
      ui.click(`station-cancel-${bench.id}`);
      expect(cancel).toHaveBeenLastCalledWith(carrier.id);
      Object.assign(carrier, { task: Activity.Crafting, activity: Activity.Crafting, craftItem: 'wooden-axe', craftWorkshop: bench.id, craftProgress: 3 });
      questPanel(ui);
      expect(ui.words()).toContain('Crafting Wooden axe · 50%');
    } finally {
      ui.dispose();
    }
  });
  it('names a building material nobody can see, offers a scout, and tells why the altar waits', () => {
    const town = settlement(),
      ui = fixture(town),
      goal = goalIndex('Build an altar'),
      p = resident(town);
    try {
      resident(town);
      const altar = facility(town, Structure.Shrine);
      altar.progress = 0;
      altar.materials.required = structureSpec(Structure.Shrine).cost.clone();
      altar.materials.delivered.wood = altar.materials.required.wood;
      goalPick.branch = (branch) => (branch === GoalBranch.Core ? goal : -1);
      // Rock somewhere in sight: the usual materials line.
      town.resourceNearby = () => true;
      questPanel(ui);
      expect(ui.words().some((w) => w.startsWith('Materials: ')), JSON.stringify(ui.words())).toBe(true);
      expect(ui.words()).toContain('Find construction site');
      // None in sight: builders would give up quietly, so the quest says what is missing and how to get it.
      town.resourceNearby = () => false;
      questPanel(ui);
      expect(ui.words()).toEqual(
        expect.arrayContaining(['No rock in sight: send a resident out to explore', 'Scout for stone']),
      );
      const move = vi.spyOn(town, 'orderMove');
      ui.click(`quest-action/${goal}`);
      expect(move).toHaveBeenCalledTimes(1);
      expect(move.mock.calls[0][0]).toHaveLength(1);
      expect(town.map().revealed(move.mock.calls[0][1])).toBe(false);
      expect(ui.app.selectPeople).toHaveBeenCalledWith(move.mock.calls[0][0]);
      ui.app.selected = altar.id;
      ui.draw(() => inspector.call(ui.app, new Rect(100, 100, 620, 560), true));
      expect(ui.words()).toContain('No rock in sight');
      // Once it stands, the population quest gives the altar's own reason for waiting.
      altar.progress = 1;
      goalPick.branch = (branch) => (branch === GoalBranch.Core ? goalIndex('Reach 4 residents') : -1);
      questPanel(ui);
      expect(ui.words(), JSON.stringify(ui.words())).toContain(`2 / 4 residents · ${town.altarStatus(altar.id).reason}`);
      expect(town.altarStatus(altar.id).reason).toMatch(/food/);
      void p;
    } finally {
      ui.dispose();
    }
  });
  it('announces the first use of each tool with what it changed, once, and stays silent on load', () => {
    const town = settlement(),
      ui = fixture(town),
      p = resident(town);
    try {
      trackGearUse(ui.app);
      expect(addInventory(p, 'wooden-axe')).toBe(true);
      expect(town.equipItem(p.id, 1, 'tool1')).toBe(true);
      trackGearUse(ui.app);
      expect(town.notices).toEqual([]);
      p.activity = Activity.Felling;
      trackGearUse(ui.app);
      trackGearUse(ui.app);
      expect(town.notices).toEqual(['First use of the Wooden axe · Felling efficiency +1 · Attack as a weapon +1']);
      // A loaded town reads the gear already in use silently.
      const loaded = settlement(),
        q = resident(loaded);
      addInventory(q, 'wooden-pick');
      loaded.equipItem(q.id, 1, 'tool1');
      q.activity = Activity.Mining;
      ui.app.town = loaded;
      trackGearUse(ui.app);
      expect(loaded.notices).toEqual([]);
    } finally {
      ui.dispose();
    }
  });
  it('shows deed goals with their own counts and a useful action, or none', () => {
    const town = settlement(),
      ui = fixture(town);
    try {
      let goal = goalIndex('Swear a fighter');
      goalPick.branch = (branch) => (branch === GoalBranch.Arms ? goal : -1);
      questPanel(ui);
      expect(ui.words()).toEqual(
        expect.arrayContaining(['Arms', 'Swear a fighter', '0 / 1 residents sworn to a calling']),
      );
      // The guild is still locked, so it is not in the build menu: no button rather than one that leads nowhere.
      expect(ui.control(`quest-action/${goal}`)).toBeUndefined();
      const guild = facility(town, Structure.Guild);
      guild.progress = 1;
      questPanel(ui);
      expect(ui.words()).toContain('Open the guild');
      ui.click(`quest-action/${goal}`);
      expect(ui.app.selectBuilding).toHaveBeenCalledWith(guild.id);
      resident(town, Calling.Warrior);
      questPanel(ui);
      expect(ui.words()).toContain('1 / 1 residents sworn to a calling');
      // Nothing to click for beating off a raid: no button rather than a wrong one.
      goal = goalIndex('Beat off a raid');
      questPanel(ui);
      expect(ui.words()).toContain('0 / 1 raids beaten off');
      expect(ui.control(`quest-action/${goal}`)).toBeUndefined();
      // Gate deeds open the expedition window of the nearest found gate.
      const index = gate(town);
      goal = goalIndex('Slay a floor guardian');
      goalPick.branch = (branch) => (branch === GoalBranch.Saga ? goal : -1);
      ui.app.questBranch = GoalBranch.Saga;
      questPanel(ui);
      expect(ui.words()).toEqual(expect.arrayContaining(['0 / 1 guardians slain', 'Plan an expedition']));
      ui.click(`quest-action/${goal}`);
      expect(ui.app.expedition?.gate).toBe(index);
      expect(ui.app.paused).toBe(true);
    } finally {
      ui.dispose();
    }
  });
});

describe('build menu unlocks', () => {
  const page = (ui: ReturnType<typeof fixture>, name: string) => {
    ui.app.globalCard = buildGroups(ui.app.town).findIndex((g) => g.name === name) + 1;
    ui.app.dockView = DockView.Build;
    ui.draw(() => commandCard.call(ui.app, buildMenuBounds.call(ui.app, 1024, 768, true), 1, true, true));
  };
  it('lists only what can be built: locked buildings and empty groups stay out of the menu', () => {
    const town = settlement(),
      ui = fixture(town);
    try {
      // A founded camp: roads, the camp itself and the workbench its quest asks for.
      expect(openGroups(town).map(({ group }) => group.name)).toEqual(['Roads', 'Housing', 'Food & materials']);
      page(ui, 'Housing');
      for (const label of ['Camp', 'Workbench']) expect(ui.control('global/card-pick-' + label)?.[3], label).toBe(true);
      for (const label of ['Tent', 'Smithy']) expect(ui.control('global/card-pick-' + label), label).toBeUndefined();
      ui.click('global/card-pick-Workbench');
      expect(ui.app.selectTool).toHaveBeenCalledWith(Tool.Workbench, false);
      // A group with nothing to build is not offered.
      page(ui, '');
      expect(ui.control('global/card-group-Housing')).toBeDefined();
      expect(ui.control('global/card-group-Food & materials')).toBeDefined();
      page(ui, 'Food & materials');
      expect(ui.control('global/card-pick-Ranch')?.[3]).toBe(true);
      expect(ui.words()).not.toContain('Locked');
      // A group keeps its page number while others open around it.
      const before = buildGroups(town).findIndex((g) => g.name === 'Faith & arcane');
      settled(town);
      expect(openGroups(town).map(({ group }) => group.name)).toEqual(['Roads', 'Housing', 'Food & materials', 'Faith & arcane']);
      expect(openGroups(town).find(({ group }) => group.name === 'Faith & arcane')!.page).toBe(before + 1);
      // The list of groups shows only those with something to build, each by name while there is room.
      page(ui, '');
      expect(ui.control('global/card-group-Faith & arcane')).toBeDefined();
      expect(ui.control('global/card-group-Arms & defence')).toBeUndefined();
      expect(ui.words()).toContain('Housing');
      page(ui, 'Faith & arcane');
      expect(ui.control('global/card-pick-Altar')?.[3]).toBe(true);
      expect(ui.control('global/card-pick-Chapel')).toBeUndefined();
    } finally {
      ui.dispose();
    }
  });
  it('opens on the buildings at once while a single group has something to build', () => {
    // Nothing is founded yet: the camp is all there is to place.
    const town = new Town(5, 32, false),
      ui = fixture(town);
    try {
      expect(openGroups(town).map(({ group }) => group.name)).toEqual(['Housing']);
      page(ui, '');
      expect(ui.control('global/card-pick-Camp')).toBeDefined();
      expect(ui.control('global/card-group-Housing')).toBeUndefined();
    } finally {
      ui.dispose();
    }
  });
  it('gives each new building a card of its own, marks it new until seen, and stays silent on load', () => {
    const town = settlement(),
      camp = town.placed[0],
      ui = fixture(town),
      waiting = () => [ui.app.guide.card?.entry, ...ui.app.guide.queue].flatMap((entry) => (entry ? [unlockOf(entry)] : []));
    try {
      camp.progress = 0.5;
      trackUnlocks(ui.app);
      expect(waiting()).toEqual([]);
      camp.progress = 1;
      trackUnlocks(ui.app);
      // Finishing camp opens the early food option alongside the workbench.
      expect(waiting()).toEqual([Tool.Workbench, Tool.Ranch]);
      expect(town.notices).toEqual([]);
      trackUnlocks(ui.app);
      expect(waiting()).toEqual([Tool.Workbench, Tool.Ranch]);
      const housing = buildGroups(town).find((g) => g.name === 'Housing')!;
      expect(freshGroup(ui.app, housing.tools)).toBe(true);
      page(ui, 'Housing');
      expect(ui.words()).toContain('New');
      // Seen once and left: the mark is gone.
      ui.app.dockView = DockView.Handle;
      trackUnlocks(ui.app);
      expect(freshGroup(ui.app, housing.tools)).toBe(false);
      page(ui, 'Housing');
      expect(ui.words()).not.toContain('New');
      // With cards switched off, a notice names what opened instead.
      setGuidePreference('cards', false);
      facility(town, Structure.Workbench);
      addInventory(resident(town), 'wooden-axe');
      trackUnlocks(ui.app);
      expect(town.notices).toEqual(['Unlocked: Smithy']);
      // A loaded game is read silently.
      const loaded = settlement();
      ui.app.town = loaded;
      trackUnlocks(ui.app);
      expect(loaded.notices).toEqual([]);
      expect(ui.app.unlockFresh.size).toBe(0);
    } finally {
      setGuidePreference('cards', true);
      ui.dispose();
    }
  });
});

describe('new mark clearing', () => {
  const unlocked = () => {
    const town = settlement(),
      ui = fixture(town);
    town.placed[0].progress = 0.5;
    trackUnlocks(ui.app);
    town.placed[0].progress = 1;
    trackUnlocks(ui.app);
    return { town, ui };
  };
  it('keeps a truly new kind marked', () => {
    const { ui } = unlocked();
    try {
      expect(ui.app.unlockFresh.has(Tool.Workbench)).toBe(true);
    } finally {
      ui.dispose();
    }
  });
  it('clears the mark when a quest button picks the tool, leaving other new kinds marked', () => {
    const { ui } = unlocked(),
      goal = goalIndex('Craft a wooden tool');
    try {
      ui.app.cue = vi.fn();
      ui.app.selectTool = selectTool;
      ui.app.unlockFresh.add(Tool.Tent);
      goalPick.branch = (branch) => (branch === GoalBranch.Core ? goal : -1);
      questPanel(ui);
      ui.click(`quest-action/${goal}`);
      expect(ui.app.tool).toBe(Tool.Workbench);
      expect(ui.app.unlockFresh.has(Tool.Workbench)).toBe(false);
      expect(ui.app.unlockFresh.has(Tool.Tent)).toBe(true);
    } finally {
      goalPick.branch = () => -1;
      ui.dispose();
    }
  });
  it('clears the mark once a building of that kind exists, however it got there', () => {
    const { town, ui } = unlocked();
    try {
      facility(town, Structure.Workbench);
      trackUnlocks(ui.app);
      expect(ui.app.unlockFresh.has(Tool.Workbench)).toBe(false);
    } finally {
      ui.dispose();
    }
  });
});

describe('quest changes are hard to miss', () => {
  it('says what a locked building waits for, and leads to it once the way is open', () => {
    const town = settlement(),
      ui = fixture(town),
      goal = goalIndex('Build a training yard');
    try {
      goalPick.branch = (branch) => (branch === GoalBranch.Arms ? goal : -1);
      ui.app.questBranch = GoalBranch.Arms;
      questPanel(ui);
      expect(ui.words()).toContain('Locked: Complete Guild');
      // The guild cannot be placed either, so there is nothing to click yet.
      expect(ui.control(`quest-action/${goal}`)).toBeUndefined();
      const site = facility(town, Structure.Guild);
      site.progress = 0.3;
      questPanel(ui);
      expect(ui.words()).toContain('Find construction site');
      ui.click(`quest-action/${goal}`);
      expect(ui.app.selectBuilding).toHaveBeenCalledWith(site.id);
      site.progress = 1;
      questPanel(ui);
      expect(ui.words()).toContain('Place Training yard');
    } finally {
      ui.dispose();
    }
  });
  it('lays a ribbon over the panel when a quest is fulfilled, then marks the next one as new', () => {
    const town = settlement(),
      ui = fixture(town),
      at = (seconds: number) => {
        ui.app.dockBounds = new Rect(200, 640, 600, 100);
        ui.context.begin(ui.app.theme, new Rect(0, 0, 1024, 768), seconds);
        ui.controls.mockClear();
        objectives.call(ui.app, 1024, 768, 64);
        ui.context.end();
      };
    try {
      at(1);
      expect(ui.app.questDone).toBe('');
      facility(town, Structure.Workbench);
      at(2);
      expect(ui.app.questDone).toBe('Build a workbench');
      expect(ui.app.noticeFeed.map((notice) => notice.text)).toEqual(['Quest complete: Build a workbench']);
      expect(ui.app.cues).toHaveLength(1);
      // The ribbon shows for a moment; the quest that follows is then marked as new for a while.
      expect(ui.app.questsAnimating).toBe(true);
      at(2 + questRules.ribbon + 0.1);
      expect(ui.app.questNewAt).toBe(2);
      expect(ui.app.questShown).toBe(goalIndex('Craft a wooden tool'));
      at(2 + questRules.fresh + 0.1);
      expect(ui.app.questsAnimating).toBe(false);
    } finally {
      ui.dispose();
    }
  });
  it('still names the quest and its progress when folded away', () => {
    const town = settlement(),
      ui = fixture(town);
    try {
      ui.app.objectivesCollapsed = true;
      questPanel(ui);
      expect(ui.words()).toContain('Build a workbench');
      expect(ui.words()).not.toContain('Quests');
    } finally {
      ui.dispose();
    }
  });
});

describe('inspectors', () => {
  const inspect = (ui: ReturnType<typeof fixture>, building: Building | null, dungeon = -1) => {
    ui.app.selected = building?.id ?? -1;
    ui.app.selectedDungeon = dungeon;
    ui.draw(() => inspector.call(ui.app, new Rect(100, 100, 620, 560), true));
  };
  it('trades a sensible step at the market and shows why a trade is refused', () => {
    const town = settlement(),
      ui = fixture(town),
      stalls = facility(town, Structure.MarketStalls, 1);
    try {
      stalls.progress = 1;
      town.stock(0).add(new Resources(100, 30));
      const trade = vi.spyOn(town, 'trade');
      inspect(ui, stalls);
      expect(ui.words().some((w) => w.startsWith('Trade today: 20 of 20 goods left'))).toBe(true);
      ui.click('market-buy-' + Product.Wood);
      expect(trade).toHaveBeenLastCalledWith(0, Product.Wood, 5);
      inspect(ui, stalls);
      ui.click('market-sell-' + Product.Wood);
      expect(trade).toHaveBeenLastCalledWith(0, Product.Wood, -5);
      town.stock(0).gold = 0;
      inspect(ui, stalls);
      const buy = ui.control('market-buy-' + Product.Stone)!;
      expect(buy[3]).toBe(false);
      ui.app.mouse = point(buy[1].x + 5, buy[1].y + 5);
      inspect(ui, stalls);
      expect(ui.words().some((w) => /^Needs \d+ gold$/.test(w))).toBe(true);
      ui.app.mouse = point(-1, -1);
      stalls.workers = 0;
      inspect(ui, stalls);
      expect(ui.words()).toContain('The market needs a worker');
      expect(ui.control('market-buy-' + Product.Wood)).toBeUndefined();
    } finally {
      ui.dispose();
    }
  });
  it('lists the mage tower rites with their cost and reason', () => {
    const town = settlement(),
      ui = fixture(town),
      tower = facility(town, Structure.MageTower, 1);
    try {
      tower.progress = 1;
      resident(town);
      town.stock(0).mana = 100;
      const perform = vi.spyOn(town, 'performRite');
      inspect(ui, tower);
      expect(ui.words()).toEqual(
        expect.arrayContaining(['Ward', 'Mending', 'Farsight', `${economyRules.wardMana} mana`, 'No one needs mending']),
      );
      expect(ui.control('rite-ward')![3]).toBe(true);
      expect(ui.control('rite-mending')![3]).toBe(false);
      ui.click('rite-ward');
      expect(perform).toHaveBeenCalledWith('ward', 0);
      town.stock(0).mana = 0;
      inspect(ui, tower);
      expect(ui.words()).toEqual(
        expect.arrayContaining(['Already performed today', `Needs ${economyRules.mendingMana} mana (0 stored)`]),
      );
    } finally {
      ui.dispose();
    }
  });
  it('names the fallen on a runestone, and says so quietly when it is empty', () => {
    const town = settlement(),
      ui = fixture(town),
      stone = facility(town, Structure.Runestone);
    try {
      stone.progress = 1;
      inspect(ui, stone);
      expect(ui.words()).toContain('No names are carved here yet.');
      town.fallen.push({
        id: 9,
        name: 'Ulf',
        past: '',
        look: 0,
        calling: Calling.Warrior,
        race: 0,
        level: 3,
        days: 4,
        kills: 2,
        cause: 'Killed by the guardian',
        place: 'Muspelheim',
        day: 12,
        at: 1200,
        position: point(),
      });
      inspect(ui, stone);
      expect(ui.words()).toEqual(
        expect.arrayContaining([
          'Remembered here: 1',
          'Ulf · Warrior · level 3',
          'Day 13 · Killed by the guardian · Muspelheim',
        ]),
      );
    } finally {
      ui.dispose();
    }
  });
  it('shows the military school unlocks on each building without a staffing control', () => {
    const town = settlement(), ui = fixture(town);
    try {
      for (const [kind, calling, weapon] of [[Structure.Watchtower, 'Ranger', 'bows'], [Structure.TrainingYard, 'Warrior', 'spears']] as const) {
        const school = facility(town, kind, 1);
        school.progress = 1;
        inspect(ui, school);
        const text = ui.words().join(' ');
        expect(text).toContain(calling);
        expect(text).toContain(weapon);
        expect(text).not.toMatch(/assign a worker|Workers [0-9]/i);
      }
    } finally {
      ui.dispose();
    }
  });
  it('shows the boon a gate grants and whether it is held', () => {
    const town = settlement(),
      ui = fixture(town),
      index = gate(town),
      gift = boonOfWorld(town.map().destination(town.map().dungeons()[index]));
    try {
      inspect(ui, null, index);
      expect(ui.words()).toContain(`Sealing grants the boon of ${boonName(gift)}`);
      town.depth = town.map().dungeons().map((_, i) => (i === index ? sealFloors : 0));
      inspect(ui, null, index);
      expect(ui.words()).toContain(`Boon held: ${boonName(gift)}`);
      expect(gift).toBeGreaterThanOrEqual(Boon.Valor);
    } finally {
      ui.dispose();
    }
  });
});

describe('winter outlook', () => {
  it('shows food against the winter in autumn, in the danger colour when short', () => {
    const town = settlement(),
      ui = fixture(town);
    try {
      for (let i = 0; i < 6; ++i) resident(town);
      town.days = 5;
      expect(winterOutlookLine(town, 0)).toBeNull();
      town.days = 35;
      town.stock().food = 5;
      const need = Math.ceil((6 * 15) / economyRules.daysPerMeal);
      expect(winterOutlookLine(town, 0)).toEqual({ text: `Winter in 10 days · food 5 of ${need} needed`, short: true });
      ui.app.skyHovered = true;
      ui.app.skyBounds = new Rect(332, 12, 360, 36);
      const labels = vi.spyOn(ui.context, 'text');
      ui.draw(() => calendarDetails.call(ui.app, 1024));
      const line = labels.mock.calls.find(([, text]) => text.startsWith('Winter in 10 days'));
      expect(line?.[2]).toEqual(ui.app.theme.danger);
      ui.draw(() => ui.app.campResources.drawStores(ui.context, ui.app.theme, town, 0, new Rect(10, 10, 336, 242)));
      expect(ui.words()).toContain(`Winter in 10 days · food 5 of ${need} needed`);
      town.days = 50;
      expect(winterOutlookLine(town, 0)?.text).toMatch(/^Winter · food 5 of \d+ needed until spring$/);
    } finally {
      ui.dispose();
    }
  });
});
