import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Align, Context, Rect, Key, Cursor } from '../../packages/native-ui/src';
import { handleTouchEvent } from '../../apps/web/src/native/game-touch';
import { emptyEvent } from '../../apps/web/src/native/application-contracts';
import { civicInspector } from '../../apps/web/src/native/game-civic-panel';
import { closePrayer, handlePrayerEvent, openPrayer, renderPrayer } from '../../apps/web/src/native/game-prayer';
import { Cue } from '../../packages/native-audio/src/sound-types';
import { Structure, Resources } from '../../packages/engine/src/building-catalog';
import { Building } from '../../packages/engine/src/town-models';
import { Town } from '../../packages/engine/src/town';
import { Activity, Calling, Role, Person, Race } from '../../packages/engine/src/person';
import { point } from '../../packages/engine/src/geometry';
import { GameAppState, DockView } from '../../apps/web/src/native/game-app-state';
import { makeTile } from '../../packages/engine/src/world-types';
import { levelVariant } from '../../packages/engine/src/craft-stations';
import { craftOrder } from '../../packages/engine/src/craft-orders';
import { attackPreview, gearStats } from '../../packages/engine/src/gear-stats';
import { addInventory, itemSpec } from '../../packages/engine/src/equipment';
import { koreanFont, locale, setLocale, translate } from '../../packages/localization/src';
import { itemIcon } from '../../apps/web/src/native/game-equipment-panel';
import {
  updateContextDock,
  renderDockContent,
  dismissBuildDrawer,
  taskbar,
} from '../../apps/web/src/native/game-context-dock';
import { rosterPanel, rosterBounds } from '../../apps/web/src/native/game-roster';
import { inspectorHeightLimit } from '../../apps/web/src/native/mobile-layout';
import {
  commandCard,
  inspector,
  buildMenuBounds,
  buildGroups,
  placementPanel,
  placementPanelBounds,
} from '../../apps/web/src/native/game-hud';
import { objectives } from '../../apps/web/src/native/game-objectives';
import { skyMural } from '../../apps/web/src/native/game-sky-hud';
import { wakeEveryone, type GameCommandApp } from '../../apps/web/src/native/game-commands';
import * as input from '../../apps/web/src/native/game-input';
import { PointerButton, Tool, Order } from '../../packages/engine/src/game-tools';
import { actionButton } from '../../apps/web/src/native/hud-actions';
import {
  worldNameplateBounds,
  paintWorldNameplate,
  worldNameplateStyle,
} from '../../apps/web/src/native/world-nameplate';
import {
  personPanel,
  personPanelBounds,
  residentSelection,
} from '../../apps/web/src/native/game-unit-panel';
import { unitOrderRail } from '../../apps/web/src/native/unit-orders-card';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';
class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  pixels = new Uint8ClampedArray();
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return {
      putImageData: (image: Pixels) => {
        this.pixels = image.data.slice();
      },
      clearRect() {},
    };
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
function fixture(width = 880, height = 600) {
  const memory = new MemoryCanvas(width, height);
  const canvas = new tvg.Canvas(memory as any, {
    width,
    height,
    enableDevicePixelRatio: false,
  });
  const fonts = ['DejaVuSans', 'DejaVuSans-Bold'];
  if (locale() === 'KR') fonts.push(koreanFont, `${koreanFont}-Bold`);
  for (const font of fonts)
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  const metrics = Object.fromEntries(
    fonts.map((font) => [
      font,
      parseFontMetrics(new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`))),
    ]),
  );
  const context = new Context(tvg, metrics),
    town = new Town(5, 32),
    app = new GameAppState(town, {} as any, context) as GameHudApp;
  app.selectPeople = vi.fn();
  app.toggleAuto = vi.fn();
  app.commandCard = vi.fn();
  app.residentSelection = residentSelection.bind(app);
  const controls = vi.spyOn(context, 'control'),
    labels = vi.spyOn(context, 'text');
  canvas.add(context.scene());
  return {
    app,
    town,
    context,
    controls,
    labels,
    memory,
    capture(name: string) {
      const directory = process.env.GOLDFANTASY_UI_CAPTURE;
      if (!directory) return;
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${directory}/${name}.rgba`, memory.pixels);
      writeFileSync(`${directory}/${name}.json`, JSON.stringify({ width, height }));
    },
    draw(fn: () => void) {
      controls.mockClear();
      labels.mockClear();
      context.begin(app.theme, new Rect(0, 0, width, height), 1);
      fn();
      context.end();
      canvas.update().render();
    },
    dispose() {
      canvas.remove();
      context.dispose();
      app.campResources.dispose();
      for (const entry of app.dockPortraits.values()) entry.paint.dispose();
      canvas.destroy();
    },
  };
}
it.each([
  [360, 740],
  [390, 844],
  [844, 390],
])('keeps mobile placement and unit actions tappable at %ix%i', (width, height) => {
  const ui = fixture(width, height);
  try {
    ui.app.touchMode = true;
    ui.app.viewWidth = width;
    ui.app.viewHeight = height;
    ui.app.tool = Tool.Camp;
    ui.app.toolStructure = () => Structure.Camp;
    ui.app.touchPlacement = point(16, 16);
    ui.app.current.preview.valid = true;
    ui.app.confirmTouchPlacement = vi.fn();
    ui.app.rotate = vi.fn();
    const bounds = placementPanelBounds.call(ui.app, width, height);
    ui.draw(() => placementPanel.call(ui.app, bounds));
    const controls = ui.controls.mock.calls.filter(([id]) => id.startsWith('placement-'));
    expect(controls.map(([id]) => id)).toContain('placement-confirm');
    for (const [, r] of controls) {
      expect(r.w).toBeGreaterThanOrEqual(44);
      expect(r.h).toBeGreaterThanOrEqual(44);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(width);
      expect(r.y + r.h).toBeLessThanOrEqual(height);
    }
    const confirm = controls.find(([id]) => id === 'placement-confirm')![1];
    ui.context.pointerDown(confirm.x + 10, confirm.y + 10);
    ui.context.pointerUp(confirm.x + 10, confirm.y + 10);
    expect(ui.app.confirmTouchPlacement).toHaveBeenCalledOnce();
    ui.app.chosen = [ui.town.folk[0].id];
    ui.app.personPanelBounds = personPanelBounds.bind(ui.app);
    ui.app.tool = Tool.Select;
    ui.app.dockView = DockView.Unit;
    const selected = personPanelBounds.call(ui.app, width, height, true);
    ui.draw(() => {
      personPanel.call(ui.app, selected);
      unitOrderRail(ui.app, width, height);
    });
    expect(selected.y + selected.h).toBe(height - 12);
    const actions = ui.controls.mock.calls.filter(([id]) => id.startsWith('unit/card-'));
    // Build, and since a finger has no right button: Move, Attack, Hold, Work, in a rail on the right edge.
    expect(actions.map(([id]) => id)).toEqual([
      'unit/card-build',
      'unit/card-move',
      'unit/card-attack',
      'unit/card-hold',
      'unit/card-work',
    ]);
    for (const [id, r] of actions) {
      expect(r.w, id).toBeGreaterThanOrEqual(44);
      expect(r.h, id).toBeGreaterThanOrEqual(44);
      expect(r.x, id).toBeGreaterThan(width / 2);
      expect(r.x + r.w, id).toBeLessThanOrEqual(width - 12);
      expect(r.y, id).toBeGreaterThanOrEqual(64);
      expect(r.y + r.h, id).toBeLessThanOrEqual(height - 12);
      // Above the panel in an upright view, beside it in a low one: never on it.
      if (height >= 500) expect(r.y + r.h, id).toBeLessThanOrEqual(selected.y);
      else expect(r.x, id).toBeGreaterThanOrEqual(selected.x + selected.w);
    }
    if (width === 390) expect(actions.map(([, r]) => [r.x, r.y])).toEqual([424, 478, 532, 586, 640].map((y) => [320, y]));
    if (width === 844) expect(actions.map(([, r]) => [r.x, r.y])).toEqual([108, 162, 216, 270, 324].map((y) => [774, y]));
    // The lit order of an aim stays in the rail while the panel has given way to the cancel dock.
    ui.app.pending = Order.Attack;
    ui.app.dockView = DockView.Handle;
    ui.draw(() => unitOrderRail(ui.app, width, height));
    const aimed = ui.controls.mock.calls.filter(([id]) => id.startsWith('unit/card-'));
    expect(aimed.map(([, r]) => [r.x, r.y])).toEqual(actions.map(([, r]) => [r.x, r.y]));
    expect(ui.labels.mock.calls.find((call) => call[1] === 'Attack')![2]).toEqual(ui.app.theme.accentText);
    expect(ui.labels.mock.calls.find((call) => call[1] === 'Hold')![2]).toEqual(ui.app.theme.text);
  } finally {
    ui.dispose();
  }
});
it('shows village supplies in the bottom Camp inspector without requiring hover on touch', () => {
  const ui = fixture(390, 844);
  try {
    const camp = new Building(20, Structure.Camp, point(16, 16), 0, 0);
    camp.progress = 1;
    ui.town.placed = [camp];
    ui.app.selected = camp.id;
    ui.app.touchMode = true;
    const height = inspector.call(ui.app, new Rect(0, 0, 366, 0), false);
    expect(height).toBe(364); // stores, then who lives there
    const panel = new Rect(12, 844 - 12 - height, 366, height);
    ui.draw(() => inspector.call(ui.app, panel));
    const words = ui.labels.mock.calls.map(([, text]) => text);
    expect(words).toEqual(
      expect.arrayContaining(['Village stores', 'Gold', 'Wood', 'Food', 'Water', 'Bones', 'Residents']),
    );
    for (const [r] of ui.labels.mock.calls) {
      expect(r.y).toBeGreaterThanOrEqual(panel.y);
      expect(r.y + r.h).toBeLessThanOrEqual(panel.y + panel.h);
    }
  } finally {
    ui.dispose();
  }
});
it('provides a touch-sized Cancel action while a world order is armed', () => {
  const ui = fixture(390, 844);
  try {
    ui.app.touchMode = true;
    ui.app.pending = Order.Move;
    ui.app.reducedMotion = () => true;
    ui.app.animatingUi = () => false;
    ui.app.buildMenuBounds = buildMenuBounds.bind(ui.app);
    ui.app.renderDockContent = renderDockContent.bind(ui.app);
    ui.draw(() => {
      updateContextDock.call(ui.app, 390, 844);
      taskbar.call(ui.app, 390, 844);
    });
    const cancel = ui.controls.mock.calls.find(([id]) => id === 'command-cancel')![1];
    expect(cancel.w).toBe(44);
    expect(cancel.h).toBe(44);
    expect(ui.context.controlAt(cancel.x + 12, cancel.y + 12)).toBe(true);
    ui.context.pointerDown(cancel.x + 12, cancel.y + 12);
    ui.context.pointerUp(cancel.x + 12, cancel.y + 12);
    expect(ui.app.pending).toBe(Order.None);
  } finally {
    ui.dispose();
  }
});
it('keeps mobile workplace staffing controls inside the inspector', () => {
  const ui = fixture(390, 844);
  try {
    const camp = new Building(0, Structure.Camp, point(16, 16), 0, 0),
      yard = new Building(20, Structure.Lumberyard, point(18, 16), 0, 0);
    camp.progress = yard.progress = 1;
    ui.town.placed = [camp, yard];
    ui.app.touchMode = true;
    ui.app.selected = yard.id;
    const panel = new Rect(12, 500, 366, 332);
    ui.draw(() => inspector.call(ui.app, panel));
    for (const id of ['workers-less', 'workers-more']) {
      const r = ui.controls.mock.calls.find(([key]) => key === id)![1];
      expect(r.w).toBeGreaterThanOrEqual(44);
      expect(r.h).toBeGreaterThanOrEqual(44);
      expect(r.x).toBeGreaterThanOrEqual(panel.x);
      expect(r.x + r.w).toBeLessThanOrEqual(panel.x + panel.w);
    }
  } finally {
    ui.dispose();
  }
});
it.each([
  [Cursor.Default, ''],
  [Cursor.Text, 'tap'],
])('clears touch button focus while retaining text input focus (%s)', (cursor, expected) => {
  const ui = fixture(390, 844);
  try {
    const app = Object.assign(ui.app, {
      pointerMove: (x: number, y: number) => ui.context.pointerMove(x, y),
      pointerUp: (x: number, y: number) => ui.context.pointerUp(x, y),
    });
    ui.draw(() =>
      ui.context.control(
        'tap',
        new Rect(100, 100, 44, 44),
        () => {},
        true,
        true,
        false,
        false,
        cursor as Cursor,
      ),
    );
    ui.context.pointerDown(110, 110);
    app.touchGesture = { start: point(110, 110), last: point(110, 110), mode: 'ui' };
    handleTouchEvent.call(app as any, { ...emptyEvent('PointerUp'), x: 110, y: 110, pointerType: 'touch' });
    expect(ui.context.focused()).toBe(expected);
  } finally {
    ui.dispose();
  }
});
it('keeps mobile quests collapsed and removes their hit shield during placement or commands', () => {
  const ui = fixture(390, 844);
  try {
    ui.app.touchMode = true;
    ui.app.reducedMotion = () => true;
    ui.app.dockBounds = new Rect(12, 650, 366, 182);
    ui.draw(() => objectives.call(ui.app, 390, 844, 64));
    const panel = ui.controls.mock.calls.find(([id]) => id === 'objectives-panel')![1];
    const toggle = ui.controls.mock.calls.find(([id]) => id === 'objectives-toggle')![1];
    expect(panel.h).toBe(44);
    expect(panel.w).toBeLessThan(200);
    expect(toggle.h).toBe(44);
    expect(ui.labels.mock.calls.some(([, text]) => text.startsWith('Quests '))).toBe(true);
    ui.app.tool = Tool.Camp;
    ui.draw(() => objectives.call(ui.app, 390, 844, 64));
    expect(ui.controls.mock.calls.some(([id]) => id === 'objectives-panel')).toBe(false);
    ui.app.tool = Tool.Select;
    ui.app.pending = Order.Move;
    ui.draw(() => objectives.call(ui.app, 390, 844, 64));
    expect(ui.controls.mock.calls.some(([id]) => id === 'objectives-panel')).toBe(false);
  } finally {
    ui.dispose();
  }
});
it('lists actual lodging visitors without fabricated recruitment offers or a Hire action', () => {
  const ui = fixture();
  try {
    const guest = new Person(
      99,
      'A real traveller',
      Role.Guest,
      Calling.Traveller,
      Race.Human,
      5,
      point(10, 10),
    );
    const neutralGuest = new Person(
      100,
      'Neutral visitor',
      Role.Guest,
      Calling.Traveller,
      Race.Human,
      7,
      point(20, 20),
    );
    neutralGuest.faction = 2;
    ui.town.folk.push(guest, neutralGuest);
    ui.app.rosterTab = 'guests';
    ui.draw(() => rosterPanel.call(ui.app, rosterBounds.call(ui.app, 880, 600)));
    const ids = ui.controls.mock.calls.map((call) => call[0]);
    expect(ids.filter((id) => id.startsWith('roster-person-'))).toEqual(['roster-person-guests:99']);
    expect(ids).not.toContain('roster-hire');
    expect(ui.labels.mock.calls.some((call) => call[1] === 'Inspect guest')).toBe(true);
    ui.town.folk.splice(-2);
    ui.draw(() => rosterPanel.call(ui.app, rosterBounds.call(ui.app, 880, 600)));
    expect(ui.controls.mock.calls.some((call) => call[0].startsWith('roster-person-'))).toBe(false);
    expect(ui.labels.mock.calls.some((call) => call[1] === 'No guests are visiting the settlement.')).toBe(
      true,
    );
  } finally {
    ui.dispose();
  }
});

it('keeps Unit management open while equipping its selected resident without selecting the world', () => {
  const ui = fixture();
  try {
    const p = ui.town.folk[0];
    p.birthStrength = 1;
    p.birthVitality = 2;
    // Tools work from the pack; what goes in a slot is held or worn, like a shield.
    addInventory(p, 'shield');
    ui.app.rosterOpen = true;
    ui.app.rosterSelected = `units:${p.id}`;
    ui.app.chosen = [ui.town.folk[1].id];
    const draw = () => ui.draw(() => rosterPanel.call(ui.app, rosterBounds.call(ui.app, 880, 600)));
    const click = (id: string) => {
      const bounds = ui.controls.mock.calls.find(([key]) => key === id)![1];
      ui.context.pointerDown(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
      ui.context.pointerUp(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
    };
    draw();
    expect(ui.labels.mock.calls.some(([, label]) => label === 'STR 3 · DEX 2 · INT 1 · Vitality +2')).toBe(true);
    expect(ui.controls.mock.calls.filter(([id]) => id.startsWith('inventory-slot-'))).toHaveLength(16);
    click('inventory-slot-1');
    draw();
    click('equipment-slot-offhand');
    expect(p.equipment.offhand).toBe(1);
    expect(ui.app.rosterOpen).toBe(true);
    click(`roster-person-units:${ui.town.folk[1].id}`);
    expect(ui.app.inventorySelected).toBe(-1);
    expect(ui.app.equipmentTab).toBe('equipment');
    expect(ui.app.rosterSelected).toBe(`units:${ui.town.folk[1].id}`);
    expect(p.equipment.offhand).toBe(1);
    expect(ui.app.chosen).toEqual([ui.town.folk[1].id]);
    expect(ui.app.selectPeople).not.toHaveBeenCalled();
    const worker = ui.town.folk[1], camp = new Building(0, Structure.Camp, point(8, 8), 0, 0);
    const smith = new Building(1, Structure.Weaponsmith, point(14, 12), 0, 0);
    const guild = new Building(2, Structure.Guild, point(18, 12), 0, 0);
    const school = new Building(3, Structure.TrainingYard, point(20, 15), 0, 0);
    ui.town.placed = [camp, smith, guild, school];
    for (const b of ui.town.placed) b.village = 0;
    worker.village = worker.home = 0; worker.level = 4; worker.position = smith.door();
    ui.town.migrateSettlements(); ui.town.stock(0).wood = 20;
    ui.town.changes++; ui.town.tick(0);
    draw(); click('equipment-workbench'); draw();
    click('resident-choice-wooden-sword'); draw(); click('resident-service-order');
    expect([worker.craftWorkshop, worker.craftItem]).toEqual([smith.id, 'wooden-sword']);
    draw(); click('resident-cancel-craft'); draw();
    click('equipment-tab-guild'); draw(); click('resident-choice-' + Calling.Warrior); draw(); click('resident-service-order');
    expect([worker.task, worker.taskSite, worker.trainingCalling]).toEqual([Activity.Training, guild.id, Calling.Warrior]);
    expect(ui.app.rosterSelected).toBe(`units:${worker.id}`);
    expect(ui.app.rosterOpen).toBe(true);
    draw(); click('resident-cancel-training');
    expect(worker.task).not.toBe(Activity.Training);
  } finally {
    ui.dispose();
  }
});

it.each([[568, 320], [320, 568], [1280, 800]])('inspects an upgrade in place and uses village storage at %i × %i', (width, height) => {
  const ui = fixture(width, height);
  try {
    const app = ui.app, p = ui.town.folk[0], camp = new Building(0, Structure.Camp, point(8, 8), 0, 0),
      bench = new Building(1, Structure.Workbench, point(12, 8), 0, 0);
    for (let y = 6; y <= 11; y++) for (let x = 6; x <= 15; x++) Object.assign(ui.town.map().at(x, y), makeTile());
    ui.town.placed = [camp, bench];
    camp.village = bench.village = p.village = p.home = 0;
    ui.town.migrateSettlements();
    p.position = bench.door(); p.level = 5;
    ui.town.changes++; ui.town.tick(0);
    const stock = ui.town.stock(0);
    stock.wood = 9; stock.stone = 5;
    addInventory(p, 'wooden-axe');
    app.viewWidth = width; app.viewHeight = height; app.rosterOpen = true; app.rosterSelected = `units:${p.id}`;
    const bounds = rosterBounds.call(app, width, height);
    const draw = () => ui.draw(() => rosterPanel.call(app, bounds));
    const click = (id: string) => {
      const control = ui.controls.mock.calls.find(([key]) => key === id);
      expect(control, id).toBeDefined();
      const [, r, , enabled] = control!;
      expect(enabled, id).toBe(true);
      expect(r.intersect(bounds)).toEqual(r);
      ui.context.pointerDown(r.x + r.w / 2, r.y + r.h / 2);
      ui.context.pointerUp(r.x + r.w / 2, r.y + r.h / 2);
      draw();
    };
    draw(); click('inventory-slot-1');
    expect(ui.controls.mock.calls.find(([id]) => id === 'inventory-upgrade')?.[3]).toBe(false);
    bench.variant = levelVariant(2); draw(); click('inventory-upgrade');
    expect([app.equipmentTab, app.craftWorkshopFilter]).toEqual(['craft', Structure.Workbench]);
    expect(ui.labels.mock.calls.some(([, text]) => text === 'Stone axe')).toBe(true);
    expect(p.craftItem).toBeFalsy();
    click('resident-service-order');
    expect(craftOrder(p.craftItem)).toEqual({ kind: 'upgrade', item: itemSpec('stone-axe') });
    click('resident-cancel-craft'); click('equipment-tab-equipment');
    p.position = camp.door();
    click('inventory-storage');
    click('inventory-withdraw-wood');
    expect(stock.wood).toBe(8);
    expect(p.inventory[1]).toEqual({ item: 'wood', quantity: 1 });
    click('inventory-slot-2'); click('inventory-deposit');
    expect(stock.wood).toBe(9);
    expect(p.inventory[0]?.item).toBe('wooden-axe');
    if (width === 568) { click('roster-close'); expect(app.rosterOpen).toBe(false); }
  } finally { ui.dispose(); }
});

it.each([
  ['ENG', 1280, 800], ['KR', 1280, 800], ['KR', 360, 740], ['KR', 640, 360],
  ['KR', 320, 568], ['ENG', 568, 320], ['KR', 568, 320], ['KR', 720, 540], ['ENG', 600, 500],
  ['KR', 390, 500], ['KR', 460, 540],
] as const)('shows the same complete gear stats in recipes and inventory in %s at %ix%i', (language, width, height) => {
  const previous = locale();
  setLocale(language);
  const ui = fixture(width, height);
  try {
    ui.app.viewWidth = width;
    ui.app.viewHeight = height;
    const [resident, other] = ui.town.folk;
    resident.name = 'Bryn'; other.name = 'Signe';
    const camp = new Building(0, Structure.Camp, point(5, 5), 0, 0),
      bench = new Building(1, Structure.Workbench, point(12, 8), 0, 0),
      smith = new Building(2, Structure.Weaponsmith, point(14, 12), 0, 0);
    ui.town.placed = [camp, bench, smith];
    for (const b of ui.town.placed) b.village = camp.id;
    for (const p of [resident, other]) p.home = p.village = camp.id;
    resident.level = 5;
    resident.position = smith.door();
    ui.town.migrateSettlements();
    ui.town.stock(camp.id).wood = 40;
    ui.app.rosterOpen = true;
    ui.app.rosterSelected = `units:${resident.id}`;
    const board = rosterBounds.call(ui.app, width, height);
    const draw = () => ui.draw(() => rosterPanel.call(ui.app, board));
    const shown = (stats: string[], bounds: Rect) => {
      let bottom = bounds.y, right: number | undefined;
      for (const stat of stats) {
        const pair = /^(.*?) ([+-]?\d+(?:\.\d+)?(?: → \d+)?)$/.exec(stat);
        const target = translate(pair?.[1] ?? stat);
        if (language === 'KR') expect(target, stat).not.toMatch(/[A-Za-z]{2}/);
        const row = ui.labels.mock.calls.find(([box, text]) => translate(text) === target
          && box.x >= bounds.x && box.y >= bottom - 0.01 && box.x + box.w <= bounds.x + bounds.w + 0.01
          && box.y + box.h <= bounds.y + bounds.h + 0.01);
        expect(row, `${stat} inside ${bounds.y}..${bounds.y + bounds.h}, drawn at ${ui.labels.mock.calls
          .filter(([, text]) => translate(text) === target).map(([r]) => `${r.y}..${r.y + r.h}`).join(', ')}`).toBeDefined();
        expect(ui.context.textWidth(translate(row![1]), row![3], row![4]), stat).toBeLessThanOrEqual(row![0].w + 0.01);
        const box = row![0];
        bottom = box.y + box.h;
        if (pair) {
          const value = ui.labels.mock.calls.find(([r, text, , , , align]) => text === pair[2] && align === Align.End
            && r.y === box.y && r.x >= box.x + box.w && r.x + r.w <= bounds.x + bounds.w);
          expect(value, stat).toBeDefined();
          expect(ui.context.textWidth(pair[2], value![3], false, target)).toBeLessThanOrEqual(value![0].w);
          const edge = value![0].x + value![0].w;
          if (right !== undefined) expect(edge, stat).toBeCloseTo(right);
          right = edge;
        }
      }
    };
    for (const [station, id] of [[smith, 'wooden-spear'], [bench, 'wooden-mallet']] as const) {
      const item = itemSpec(id)!, stats = gearStats(item);
      ui.app.equipmentTab = 'craft';
      ui.app.craftWorkshopFilter = station.kind;
      ui.app.craftPage = ui.town.craftOptions(resident.id, station.id).filter(({ item }) => item.stationLevel === 1).findIndex(o => o.item.id === id);
      draw();
      shown([...stats, attackPreview(resident, item)], board);
      const order = ui.controls.mock.calls.find(([key]) => key === 'resident-service-order')![1];
      expect(order.y + order.h, id).toBeLessThanOrEqual(board.y + board.h);
      addInventory(resident, id);
      ui.app.equipmentTab = 'equipment';
      ui.app.inventorySelected = resident.inventory.findIndex(s => s?.item === id) + 1;
      draw();
      shown([...stats, attackPreview(resident, item)], board);
      const actions = ui.controls.mock.calls.filter(([key]) => ['inventory-equip', 'inventory-deposit'].includes(key) || key.startsWith('inventory-withdraw-'));
      for (const [i, [key, box]] of actions.entries()) {
        for (const [other, r] of actions.slice(i + 1)) {
          const overlap = box.intersect(r);
          expect(overlap.w * overlap.h, `${key} overlaps ${other}`).toBe(0);
        }
      }
      if (item.category === 'tool') expect(actions.some(([key]) => key === 'inventory-equip')).toBe(false);
    }
    // A proper name outside the phrase book must not turn its neighbouring stats back into English.
    const stationBoard = new Rect(12, 0, Math.min(width - 24, 620), inspectorHeightLimit(height, true));
    stationBoard.y = height - 12 - stationBoard.h;
    ui.app.selected = smith.id;
    ui.draw(() => inspector.call(ui.app, stationBoard, true));
    const sword = itemSpec('wooden-sword')!, who = ui.town.craftOffers(smith.id).find(o => o.item.id === sword.id)!.who!;
    shown([...gearStats(sword), attackPreview(who, sword)], stationBoard);
    for (const [key, box] of ui.controls.mock.calls.filter(([key]) => key.startsWith('station-') || key === 'clear-target')) {
      expect(box.y + box.h, key).toBeLessThanOrEqual(stationBoard.y + stationBoard.h);
    }
  } finally {
    ui.dispose();
    setLocale(previous);
  }
});

it('draws action tooltips after clipped icons and outside every control', () => {
  const ui = fixture(390, 844),
    anchor = new Rect(100, 100, 30, 30),
    neighbor = new Rect(90, 78, 100, 22);
  try {
    ui.context.pointerMove(110, 110);
    ui.draw(() => {
      ui.context.layer(new Rect(80, 80, 160, 50), () => {
        actionButton(ui.context, 'tooltip-anchor', anchor, 'gear', 'Manage equipment', () => {});
        actionButton(ui.context, 'tooltip-neighbor', neighbor, 'craft', 'Craft equipment', () => {});
        ui.context.text(new Rect(80, 160, 100, 20), 'Last normal icon', ui.app.theme.text, 10);
      });
    });
    const tip = ui.labels.mock.calls.find(([, text]) => text === 'Manage equipment')![0];
    expect(ui.labels.mock.calls.at(-1)![1]).toBe('Manage equipment');
    const clipped = tip.intersect(new Rect(80, 80, 160, 50));
    expect(clipped.w * clipped.h).toBe(0);
    for (const [, bounds] of ui.controls.mock.calls) {
      const overlap = tip.intersect(bounds);
      expect(overlap.w * overlap.h).toBe(0);
    }
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x + tip.w).toBeLessThanOrEqual(390);
    expect(tip.y + tip.h).toBeLessThanOrEqual(844);
    ui.capture('tooltip-390x844');
    ui.draw(() => {});
    expect(ui.labels.mock.calls.some(([, text]) => text === 'Manage equipment')).toBe(false);
  } finally {
    ui.dispose();
  }
});

it.each([
  [390, 844],
  [844, 390],
])(
  'opens pictogram build categories by pointer and keyboard with full labels, and a tooltip-free Back arrow at %sx%s',
  (width, height) => {
    const ui = fixture(width, height);
    try {
      ui.town.placed = Array.from({ length: Structure.Count }, (_, kind) => {
        const building = new Building(kind, kind, point(8, 8), 0, 0);
        building.progress = 1;
        return building;
      });
      while (ui.town.folk.length < 30)
        ui.town.folk.push(
          new Person(
            ui.town.folk.length,
            'Resident',
            Role.Resident,
            Calling.Settler,
            Race.Human,
            5,
            point(8, 8),
          ),
        );
      ui.app.globalCard = 0;
      ui.app.dismissBuildDrawer = dismissBuildDrawer.bind(ui.app);
      const draw = () =>
        ui.draw(() =>
          commandCard.call(ui.app, buildMenuBounds.call(ui.app, width, height, true), 1, true, true),
        );
      draw();
      const groups = buildGroups(ui.town);
      expect(groups.length).toBeGreaterThan(1);
      for (const [i, group] of groups.entries()) {
        const id = `global/card-group-${group.name}`;
        const bounds = ui.controls.mock.calls.find(([key]) => key === id)![1];
        expect(bounds.h).toBeGreaterThanOrEqual(28);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.w).toBeLessThanOrEqual(width);
        expect(ui.labels.mock.calls.some(([, text]) => text === group.name)).toBe(false);
        ui.context.pointerMove(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
        draw();
        expect(ui.labels.mock.calls.at(-1)?.[1]).toBe(group.name);
        ui.context.pointerDown(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
        ui.context.pointerUp(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
        expect(ui.app.globalCard).toBe(i + 1);
        draw();
        ui.context.focus('global/card-back');
        ui.context.pointerMove(-1, -1);
        draw();
        expect(ui.labels.mock.calls.some(([, text]) => text === 'Back')).toBe(false);
        ui.context.key(Key.Enter);
        expect(ui.app.globalCard).toBe(0);
        draw();
        ui.context.focus(id);
        draw();
        expect(ui.labels.mock.calls.at(-1)?.[1]).toBe(group.name);
        ui.context.key(Key.Enter);
        expect(ui.app.globalCard).toBe(i + 1);
        ui.app.globalCard = 0;
        ui.context.focus('');
        draw();
      }
      ui.capture(`build-categories-${width}x${height}`);
    } finally {
      ui.dispose();
    }
  },
);

it.each(['build', 'selection'] as const)(
  'dismisses the %s panel on an empty-world click without redundant close controls',
  (kind) => {
    const ui = fixture(390, 844);
    try {
      const app = Object.assign(ui.app, {
        pointerMove: input.pointerMove.bind(ui.app as any),
        cancelStroke: input.cancelStroke.bind(ui.app as any),
        sampleRoad: input.sampleRoad.bind(ui.app as any),
        press: input.press.bind(ui.app as any),
        select: input.select.bind(ui.app as any),
        dismissBuildDrawer: dismissBuildDrawer.bind(ui.app),
        renderDockContent: renderDockContent.bind(ui.app),
        commandCard: commandCard.bind(ui.app),
        rosterPanel: rosterPanel.bind(ui.app),
        personPanel: personPanel.bind(ui.app),
      });
      app.renderer.pick = () => null;
      app.viewWidth = 390;
      app.viewHeight = 844;
      app.dockProgress = 1;
      app.dockBounds = app.dockTarget = new Rect(12, 480, 366, 352);
      app.chosen = kind === 'selection' ? [ui.town.folk[0].id] : [];
      app.rosterOpen = false;
      app.globalCard = kind === 'build' ? 0 : -1;
      app.dockView = kind === 'build' ? DockView.Build : DockView.Unit;
      ui.draw(() => taskbar.call(app, 390, 844));
      expect(ui.controls.mock.calls.map(([id]) => id)).not.toContain('dock-close');
      expect(ui.controls.mock.calls.map(([id]) => id)).not.toContain('roster-close');
      input.pointerDown.call(app as any, 100, 200, PointerButton.Primary);
      input.pointerUp.call(app as any, 100, 200, PointerButton.Primary);
      expect(app.rosterOpen).toBe(false);
      expect(app.card).toBe(-1);
      expect(app.globalCard).toBe(-1);
      expect(app.chosen).toEqual([]);
      expect(app.selected).toBe(-1);
    } finally {
      ui.app.dockContent?.dispose();
      ui.app.dockContent = null;
      ui.dispose();
    }
  },
);

it('shows one viewport-clamped pointer tooltip instead of a competing focused tooltip', () => {
  const ui = fixture(390, 844);
  try {
    ui.context.focus('focused-action');
    ui.context.pointerMove(375, 12);
    ui.draw(() => {
      actionButton(
        ui.context,
        'hovered-action',
        new Rect(360, 4, 28, 28),
        'craft',
        'Hovered crafting action',
        () => {},
      );
      actionButton(
        ui.context,
        'focused-action',
        new Rect(4, 4, 28, 28),
        'gear',
        'Focused equipment action',
        () => {},
      );
    });
    expect(ui.labels.mock.calls.some(([, label]) => label === 'Focused equipment action')).toBe(false);
    const shown = ui.labels.mock.calls.filter(([, label]) => label === 'Hovered crafting action');
    expect(shown).toHaveLength(1);
    const bounds = shown[0][0];
    expect(bounds.x).toBeGreaterThanOrEqual(4);
    expect(bounds.y).toBeGreaterThanOrEqual(4);
    expect(bounds.x + bounds.w).toBeLessThanOrEqual(386);
    expect(bounds.y + bounds.h).toBeLessThanOrEqual(840);
  } finally {
    ui.dispose();
  }
});

it('uses the dungeon label plate, bold font and gold ink for world nameplates', () => {
  const ui = fixture(),
    rectangles = vi.spyOn(ui.context, 'rect');
  try {
    const bounds = worldNameplateBounds(ui.context, 'Ancient hall', 180, 80);
    ui.draw(() => paintWorldNameplate(ui.context, 'Ancient hall', bounds));
    expect(bounds.h).toBe(14);
    expect(bounds.w).toBeCloseTo(ui.context.textWidth('Ancient hall', 8, true) + 12, 4);
    expect(rectangles).toHaveBeenCalledWith(bounds, worldNameplateStyle.plate);
    expect(ui.labels.mock.calls[0].slice(1, 5)).toEqual(['Ancient hall', worldNameplateStyle.ink, 8, true]);
  } finally {
    ui.dispose();
  }
});
it('keeps overwhelmed player residents in Units while excluding defectors and guests', () => {
  const ui = fixture();
  try {
    const [player, neutral] = ui.town.folk;
    player.stressRecovery = true;
    neutral.faction = 8;
    ui.app.rosterTab = 'units';
    ui.draw(() => rosterPanel.call(ui.app, rosterBounds.call(ui.app, 880, 600)));
    expect(
      ui.controls.mock.calls.filter((call) => call[0].startsWith('roster-person-')).map((call) => call[0]),
    ).toEqual([`roster-person-units:${player.id}`]);
    expect(ui.labels.mock.calls.some((call) => String(call[1]).includes('Exhausted'))).toBe(true);
    ui.app.chosen = [player.id];
    ui.draw(() => personPanel.call(ui.app, personPanelBounds.call(ui.app, 880, 600, false)));
    expect(ui.controls.mock.calls.some((call) => call[0] === 'unit-auto')).toBe(false);
    expect(ui.app.commandCard).not.toHaveBeenCalled();
    expect(ui.labels.mock.calls.some((call) => String(call[1]).includes('Exhausted'))).toBe(true);
  } finally {
    ui.dispose();
  }
});

it('opens resource offerings from the altar without choosing or ordering a resident', () => {
  const ui = fixture();
  try {
    const { altar } = civicTown(ui.town);
    ui.app.viewHeight = 800;
    ui.app.paused = false;
    const before = ui.town.people().map((p) => ({ id: p.id, task: p.task, site: p.taskSite }));
    const order = vi.spyOn(ui.town, 'orderPrayAtAltar');
    ui.draw(() => civicInspector.call(ui.app, altar, new Rect(100, 200, 620, 286), true));
    expect(ui.controls.mock.calls.some((call) => String(call[0]).startsWith('civic-person-'))).toBe(false);
    const action = ui.controls.mock.calls.find((call) => call[0] === 'altar-pray')!;
    expect(action[3]).toBe(true);
    ui.context.pointerDown(action[1].x + 10, action[1].y + 10);
    ui.context.pointerUp(action[1].x + 10, action[1].y + 10);
    expect(ui.app.prayer?.altar).toBe(altar.id);
    expect(ui.app.paused).toBe(true);
    expect(order).not.toHaveBeenCalled();
    expect(ui.town.people().map((p) => ({ id: p.id, task: p.task, site: p.taskSite }))).toEqual(before);
    ui.draw(() => renderPrayer.call(ui.app, 880, 600));
    for (const key of ['water', 'bones', 'gold', 'food', 'stone'])
      expect(ui.controls.mock.calls.some((call) => call[0] === 'offering-' + key)).toBe(true);
    // An edit and click can share a browser frame. Validate the current input,
    // then let the next valid edit clear the rejection without reopening.
    const confirm = ui.controls.mock.calls.find((call) => call[0] === 'prayer-confirm')!;
    ui.app.prayer!.inputs.food.value = '0';
    ui.context.pointerDown(confirm[1].x + 10, confirm[1].y + 10);
    ui.context.pointerUp(confirm[1].x + 10, confirm[1].y + 10);
    expect(ui.app.prayer?.altar).toBe(altar.id);
    expect(ui.app.residentArrival).toBeNull();
    ui.draw(() => renderPrayer.call(ui.app, 880, 600));
    expect(ui.controls.mock.calls.find((call) => call[0] === 'prayer-confirm')![3]).toBe(false);
    ui.app.prayer!.inputs.food.value = '4';
    ui.draw(() => renderPrayer.call(ui.app, 880, 600));
    expect(ui.controls.mock.calls.find((call) => call[0] === 'prayer-confirm')![3]).toBe(true);
    closePrayer.call(ui.app);
    expect(ui.app.paused).toBe(false);
    ui.draw(() => {});
    altar.devotionDueDay = 2;
    ui.draw(() => civicInspector.call(ui.app, altar, new Rect(100, 200, 620, 286), true));
    const next = ui.controls.mock.calls.find((call) => call[0] === 'altar-pray')!;
    ui.context.pointerDown(next[1].x + 10, next[1].y + 10);
    ui.context.pointerUp(next[1].x + 10, next[1].y + 10);
    ui.draw(() => renderPrayer.call(ui.app, 880, 600));
    expect(ui.controls.mock.calls.find((call) => call[0] === 'prayer-confirm')![3]).toBe(false);
    closePrayer.call(ui.app);
    ui.draw(() => {});
  } finally {
    const pending = ui.app.prayer;
    ui.dispose();
    pending?.adapter.dispose();
  }
});
it('pages altar materials into finger-sized rows on a short landscape screen', () => {
  const ui = fixture(568, 320);
  try {
    ui.app.touchMode = true;
    const { altar } = civicTown(ui.town);
    openPrayer.call(ui.app, altar.id);
    const seen = new Set<string>();
    for (let page = 0; page < 5; page++) {
      ui.draw(() => renderPrayer.call(ui.app, 568, 320));
      const buttons = ui.controls.mock.calls;
      for (const [id, r] of buttons.filter(([id]) => id.startsWith('offering-') || id === 'prayer-cancel' || id === 'prayer-customize')) {
        expect(r.w, id).toBeGreaterThanOrEqual(44);
        expect(r.h, id).toBeGreaterThanOrEqual(44);
        if (id.startsWith('offering-more-')) seen.add(id.slice('offering-more-'.length));
      }
      const next = buttons.find(([id]) => id === 'offering-next')!;
      if (!next[3]) break;
      const r = next[1];
      ui.context.pointerDown(r.x + r.w / 2, r.y + r.h / 2);
      ui.context.pointerUp(r.x + r.w / 2, r.y + r.h / 2);
    }
    expect([...seen].sort()).toEqual(['bones', 'food', 'gold', 'stone', 'water']);
    closePrayer.call(ui.app);
    ui.draw(() => {});
  } finally {
    const pending = ui.app.prayer;
    ui.dispose();
    pending?.adapter.dispose();
  }
});
it('keeps an altar draft across editor visits and applies it once with the final offering', () => {
  const ui = fixture(390, 720);
  const { altar } = civicTown(ui.town);
  const draw = () => ui.draw(() => renderPrayer.call(ui.app, 390, 720));
  const click = (id: string) => {
    const control = ui.controls.mock.calls.find(([name]) => name === id);
    expect(control?.[3], id).toBe(true);
    const r = control![1];
    ui.context.pointerDown(r.x + r.w / 2, r.y + r.h / 2);
    ui.context.pointerUp(r.x + r.w / 2, r.y + r.h / 2);
  };
  try {
    ui.town.folk[0].level = 9;
    const dice = ui.town.dice, stock = ui.town.stock(0), before = stock.food;
    openPrayer.call(ui.app, altar.id);
    draw();
    click('offering-bundle-food');
    click('offering-less-food');
    click('offering-food');
    handlePrayerEvent.call(ui.app, { ...emptyEvent('KeyDown'), key: Key.Backspace });
    handlePrayerEvent.call(ui.app, { ...emptyEvent('KeyDown'), key: Key.Delete });
    handlePrayerEvent.call(ui.app, { ...emptyEvent('Text'), text: '8' });
    const editCues = [Cue.OfferFood, Cue.OfferTakeFood, Cue.OfferTakeFood, Cue.OfferFood];
    click('prayer-customize');
    draw();
    click('prayer-look-random');
    draw();
    click('prayer-tab-face');
    draw();
    click('prayer-eyes-next');
    click('prayer-tab-clothing');
    draw();
    click('prayer-cloth-tone-3');
    click('prayer-name');
    const draft = ui.app.prayer!.draft;
    draft.name.value = '';
    draft.name.cursor = 0;
    const name = 'Runa';
    handlePrayerEvent.call(ui.app, { ...emptyEvent('Text'), text: name });
    expect(draft.name.value).toBe(name);
    handlePrayerEvent.call(ui.app, { ...emptyEvent('KeyDown'), key: Key.Escape });
    draw();
    expect(ui.app.prayer!.editing).toBe(false);
    expect(ui.app.prayer!.offering.food).toBe(8);
    expect(ui.controls.mock.calls.some(([id]) => id === 'prayer-name')).toBe(false);
    expect(ui.town.dice).toBe(dice);
    expect(stock.food).toBe(before);
    expect(ui.app.cues.map((s) => s.cue)).toEqual(editCues);
    click('prayer-confirm');
    click('prayer-confirm');
    expect(ui.app.cues.map((s) => s.cue)).toEqual([...editCues, Cue.OfferFood, Cue.OfferAccepted]);
    expect(ui.app.cues.at(-1)!.delay).toBeGreaterThan(ui.app.cues.at(-2)!.delay);
    const born = ui.town.people().at(-1)!;
    expect(ui.town.people()).toHaveLength(2);
    expect(stock.food).toBe(before - 8);
    expect(born).toMatchObject({ name, calling: Calling.Settler, level: 4, customLook: draft.identity().look });
    expect(born.birthStrength + born.birthVitality).toBe(2);
    expect(ui.app.selectPeople).toHaveBeenCalledWith([born.id]);
    expect(ui.app.heardChosen).toEqual([born.id]);
    expect(ui.app.prayer).toBeNull();
    expect(ui.app.residentArrival?.person).toBe(born.id);
    expect(ui.town.notices.at(-1)).toBe('Runa joins the settlement');
    ui.draw(() => {});
  } finally {
    closePrayer.call(ui.app);
    ui.draw(() => {});
    ui.dispose();
  }
});
it('previews a calling and lets a trained resident choose a different open profession', () => {
  const ui = fixture();
  try {
    const { guild } = civicTown(ui.town),
      resident = ui.town.folk[0];
    resident.level = 3;
    ui.town.placed.push(new Building(8, Structure.Watchtower, point(16, 13), 0, 0));
    ui.app.viewHeight = 390;
    ui.app.inspectorPerson = resident.id;
    const train = vi.spyOn(ui.town, 'orderTrainAtGuild').mockReturnValue(true);
    const draw = () => ui.draw(() => civicInspector.call(ui.app, guild, new Rect(12, 100, 366, 204), true));
    draw();
    const ranger = ui.controls.mock.calls.find((call) => call[0] === `guild-class-${Calling.Ranger}`)!;
    ui.context.pointerDown(ranger[1].x + 10, ranger[1].y + 10);
    ui.context.pointerUp(ranger[1].x + 10, ranger[1].y + 10);
    draw();
    expect(ui.app.inspectorCalling).toBe(Calling.Ranger);
    expect(resident.calling).toBe(Calling.Settler);
    expect(ui.labels.mock.calls.some((call) => call[1] === 'Fights with a bow.')).toBe(true);
    expect(ui.town.power(resident)).toBe(1);
    const action = ui.controls.mock.calls.find((call) => call[0] === 'guild-train')!;
    expect(action[3]).toBe(true);
    ui.context.pointerDown(action[1].x + 10, action[1].y + 10);
    ui.context.pointerUp(action[1].x + 10, action[1].y + 10);
    expect(train).toHaveBeenCalledWith(resident.id, guild.id, Calling.Ranger);
    resident.task = Activity.Training;
    resident.taskSite = guild.id;
    resident.trainingCalling = Calling.Ranger;
    draw();
    expect(ui.labels.mock.calls.some((call) => call[1] === 'Changing calling')).toBe(true);
    expect(ui.controls.mock.calls.find((call) => call[0] === 'guild-train')![3]).toBe(false);
    resident.task = Activity.Idle;
    resident.trained = true;
    resident.calling = Calling.Warrior;
    draw();
    expect(ui.controls.mock.calls.find((call) => call[0] === 'guild-train')![3]).toBe(true);
    resident.calling = Calling.Ranger;
    draw();
    expect(ui.controls.mock.calls.find((call) => call[0] === 'guild-train')![3]).toBe(false);
  } finally {
    ui.dispose();
  }
});

function civicTown(town: Town) {
  const camp = new Building(0, Structure.Camp, point(8, 8), 0, 0);
  const altar = new Building(1, Structure.Shrine, point(12, 8), 0, 0);
  const guild = new Building(2, Structure.Guild, point(12, 12), 0, 0);
  town.placed = [camp, altar, guild];
  town.folk.splice(1);
  town.folk[0].home = town.folk[0].village = 0;
  town.migrateSettlements();
  town.stock(0).add(new Resources(100, 100, 100, 100));
  return { camp, altar, guild };
}

it('draws every staff with a distinct silhouette and the same ink as the other weapons in each slot state', () => {
  const ui = fixture(28, 28), slot = new Rect(0, 0, 28, 28);
  try {
    for (const [muted, selected] of [[false, false], [true, false], [false, true]]) {
      const draw = (id: string) => {
        ui.draw(() => itemIcon(ui.context, slot, itemSpec(id), muted, selected));
        return ui.memory.pixels.slice();
      };
      const staff = draw('wooden-staff'), club = draw('wooden-club');
      expect(staff).not.toEqual(club);
      const theme = ui.app.theme, ink = selected ? theme.accentText : muted ? theme.muted : theme.accent;
      for (const pixels of [staff, club]) {
        let solid = 0, error = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] !== 255) continue;
          ++solid;
          error = Math.max(error, Math.abs(pixels[i] - ink.r), Math.abs(pixels[i + 1] - ink.g), Math.abs(pixels[i + 2] - ink.b));
        }
        expect(solid).toBeGreaterThan(0);
        expect(error).toBeLessThanOrEqual(1);
      }
      for (const id of ['staff', 'seer-staff', 'frostwood-staff']) expect(draw(id)).toEqual(staff);
    }
  } finally {
    ui.dispose();
  }
});

it('equips the selected real inventory stack through the centered gear grid without creating items', () => {
  const ui = fixture();
  try {
    const p = ui.town.folk[0];
    ui.app.rosterOpen = true;
    ui.app.rosterSelected = `units:${p.id}`;
    expect(p.inventory.every((item) => item === null)).toBe(true);
    expect(p.equipment.offhand).toBe(-1);
    addInventory(p, 'shield');
    // No slots for tools: they work from the pack.
    expect(p.equipment.tool1).toBe(-1);
    const draw = () => ui.draw(() => rosterPanel.call(ui.app, rosterBounds.call(ui.app, 880, 600)));
    draw();
    expect(ui.controls.mock.calls.some((call) => call[0] === 'unit-auto')).toBe(false);
    expect(ui.controls.mock.calls.filter((call) => call[0].startsWith('inventory-slot-'))).toHaveLength(16);
    const click = (id: string) => {
      const r = ui.controls.mock.calls.find((call) => call[0] === id)![1];
      ui.context.pointerDown(r.x + r.w / 2, r.y + r.h / 2);
      ui.context.pointerUp(r.x + r.w / 2, r.y + r.h / 2);
    };
    click('inventory-slot-1');
    draw();
    expect(ui.controls.mock.calls.some((call) => call[0] === 'equipment-slot-tool1')).toBe(false);
    click('equipment-slot-offhand');
    expect(p.equipment.offhand).toBe(1);
    expect(p.inventory.filter(Boolean)).toHaveLength(1);
    expect(p.inventory[0]).toEqual({ item: 'shield', quantity: 1 });
    ui.app.inventorySelected = -1;
    draw();
    addInventory(p, 'reinforced-shield');
    p.level = 5;
    click('inventory-slot-2');
    draw();
    click('equipment-slot-offhand');
    expect(ui.app.inventorySelected).toBe(1);
    expect(p.equipment.offhand).toBe(1);
    draw();
    expect(ui.labels.mock.calls.some(([, label]) => label === 'Unequip')).toBe(true);
    click('inventory-equip');
    expect(p.equipment.offhand).toBe(-1);
    expect(p.inventory[0]?.item).toBe('shield');
  } finally {
    ui.dispose();
  }
});

it('opens the centered Unit window from the handle without moving the dock and captures outside taps', () => {
  const ui = fixture();
  try {
    const app = ui.app;
    app.reducedMotion = () => true;
    app.animatingUi = () => false;
    app.buildMenuBounds = () => new Rect(100, 200, 600, 250);
    app.rosterBounds = rosterBounds.bind(app);
    app.personPanelBounds = personPanelBounds.bind(app);
    app.selectTool = vi.fn();
    app.viewHeight = 600;
    app.viewWidth = 880;
    app.mouse = point(-1, -1);
    ui.draw(() => updateContextDock.call(app, 880, 600));
    expect(app.dockView).toBe(DockView.Handle);
    app.mouse = point(440, 579);
    ui.draw(() => {
      updateContextDock.call(app, 880, 600);
      renderDockContent.call(app, app.dockTarget);
    });
    expect(app.dockView).toBe(DockView.Menu);
    expect(ui.controls.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(['build-handle', 'unit-roster']),
    );
    const r = ui.controls.mock.calls.find((call) => call[0] === 'unit-roster')![1];
    ui.context.pointerDown(r.x + 10, r.y + 10);
    ui.context.pointerUp(r.x + 10, r.y + 10);
    const original = { ...app.dockTarget };
    ui.draw(() => {
      updateContextDock.call(app, 880, 600);
      renderDockContent.call(app, app.dockTarget);
      rosterPanel.call(app, app.rosterBounds(880, 600));
    });
    expect(app.dockTarget).toEqual(original);
    const panel = app.rosterBounds(880, 600);
    expect(panel.y + panel.h / 2).toBe(300);
    expect(ui.context.inModal()).toBe(true);
    expect(ui.context.focused()).toBe('roster-tab-units');
    ui.context.pointerDown(r.x + 10, 2);
    ui.context.pointerUp(r.x + 10, 2);
    expect(app.rosterOpen).toBe(false);
  } finally {
    ui.dispose();
  }
});

it.each([
  [844, 390],
  [800, 500],
  [390, 844],
  [1280, 800],
])('fits every bag and gear control inside Unit management at %sx%s', (width, height) => {
  const ui = fixture(width, height);
  try {
    ui.app.rosterOpen = true;
    ui.app.rosterSelected = `units:${ui.town.folk[0].id}`;
    const panel = rosterBounds.call(ui.app, width, height);
    ui.draw(() => rosterPanel.call(ui.app, panel));
    ui.capture(`roster-${width}x${height}`);
    const grid = ui.controls.mock.calls.filter(
      (call) => call[0].startsWith('inventory-slot-') || call[0].startsWith('equipment-slot-'),
    );
    // Sixteen bag cells and seven gear slots: tools have none, they work from the pack.
    expect(grid).toHaveLength(23);
    for (const [id, r] of grid) {
      expect(r.x, id).toBeGreaterThanOrEqual(panel.x);
      expect(r.x + r.w, id).toBeLessThanOrEqual(panel.x + panel.w);
      expect(r.y, id).toBeGreaterThanOrEqual(panel.y);
      expect(r.y + r.h, id).toBeLessThanOrEqual(panel.y + panel.h - 12);
    }
  } finally {
    ui.dispose();
  }
});

it('keeps a fixed-size object panel on screen when only viewport height changes', () => {
  const ui = fixture();
  try {
    const app = ui.app;
    app.reducedMotion = () => true;
    app.animatingUi = () => false;
    app.buildMenuBounds = () => new Rect();
    app.selectedTree = 1;
    ui.draw(() => updateContextDock.call(app, 880, 800));
    expect(app.dockTarget.y).toBe(640);
    ui.draw(() => updateContextDock.call(app, 880, 500));
    expect(app.dockTarget.y).toBe(340);
    expect(app.dockBounds.y).toBe(340);
  } finally {
    ui.dispose();
  }
});

it.each([
  [1, false],
  [1, true],
  [2, false],
  [2, true],
] as const)(
  'sets the orders of a mouse in the title row for %s selected residents, sheltered=%s',
  (count, sheltered) => {
    const ui = fixture(1280, 720);
    try {
      ui.app.chosen = ui.town.folk.slice(0, count).map((p) => p.id);
      ui.town.folk[0].inside = sheltered;
      const panel = personPanelBounds.call(ui.app, 1280, 720, true);
      ui.draw(() => personPanel.call(ui.app, panel));
      const byX = (ids: (id: string) => boolean) =>
          ui.controls.mock.calls.filter(([id]) => ids(id)).sort((a, b) => a[1].x - b[1].x),
        commands = byX((id) => id.startsWith('unit/card-')),
        row = byX((id) => id.startsWith('unit/card-') || id === 'unit-workbench' || id === 'unit-management');
      // With a mouse the right button moves and works: Build, Attack and Hold, indoors or out, and no order row.
      expect(commands.map(([id]) => id)).toEqual(['unit/card-build', 'unit/card-attack', 'unit/card-hold']);
      expect(row.map(([id]) => id)).toEqual([
        'unit/card-build',
        'unit/card-attack',
        'unit/card-hold',
        ...(count === 1 ? ['unit-workbench'] : []),
        'unit-management',
      ]);
      // One line, right-aligned to the panel's margin, with no hole where an opener is missing.
      for (const [id, bounds] of row) {
        expect(bounds.y, id).toBe(panel.y + 6);
        expect(bounds.h, id).toBe(28);
      }
      const last = row.at(-1)![1];
      expect(last.x + last.w).toBe(panel.x + panel.w - 12);
      const gaps = row.slice(1).map(([, bounds], i) => Math.round(bounds.x - row[i][1].x - row[i][1].w));
      expect(gaps).toEqual(count === 1 ? [4, 4, 13, 4] : [4, 4, 13]);
      const content = ui.controls.mock.calls.filter(
        ([id]) => id.startsWith('pick-person-') || id.startsWith('ability-') || id.startsWith('skill-'),
      );
      for (const [id, bounds] of content) expect(bounds.y, id).toBeGreaterThanOrEqual(panel.y + 6 + 27);
      expect(panel.h).toBe(count === 1 ? 144 : 102);
    } finally {
      ui.dispose();
    }
  },
);
it('folds the panel of a mouse to its title row while an attack is aimed, with the order lit', () => {
  const ui = fixture(1280, 720);
  try {
    const app = ui.app;
    app.reducedMotion = () => true;
    app.animatingUi = () => false;
    app.buildMenuBounds = () => new Rect(100, 200, 600, 250);
    app.personPanelBounds = personPanelBounds.bind(app);
    app.personPanel = personPanel.bind(app);
    app.mouse = point(-1, -1);
    app.chosen = ui.town.folk.slice(0, 2).map((p) => p.id);
    app.pending = Order.Attack;
    ui.draw(() => {
      updateContextDock.call(app, 1280, 720);
      app.personPanel(app.dockTarget);
    });
    expect(app.dockView).toBe(DockView.Unit);
    expect([app.dockTarget.x, app.dockTarget.y, app.dockTarget.w, app.dockTarget.h]).toEqual([280, 668, 720, 40]);
    const attack = ui.controls.mock.calls.find(([id]) => id === 'unit/card-attack')![1];
    expect(attack.y).toBe(674);
    expect(attack.y + attack.h).toBeLessThanOrEqual(708);
    expect(ui.labels.mock.calls.find((call) => call[1] === 'Attack')![2]).toEqual(app.theme.accentText);
    expect(ui.labels.mock.calls.find((call) => call[1] === 'Build')![2]).toEqual(app.theme.text);
    expect(ui.controls.mock.calls.some(([id]) => id.startsWith('pick-person-'))).toBe(false);
    // A selection that takes no orders has no legend, and its aim folds nothing.
    app.pending = Order.None;
    ui.town.folk[0].faction = 8;
    app.chosen = [ui.town.folk[0].id];
    ui.draw(() => personPanel.call(app, personPanelBounds.call(app, 1280, 720, false)));
    expect(ui.controls.mock.calls.filter(([id]) => /^unit[-/]/.test(id)).map(([id]) => id)).toEqual(['unit-management']);
  } finally {
    ui.dispose();
  }
});

it.each([
  [Structure.Weaponsmith, 'none'],
  [Structure.Weaponsmith, 'foreign'],
  [Structure.Weaponsmith, 'local'],
  [Structure.Workbench, 'none'],
  [Structure.Workbench, 'foreign'],
  [Structure.Workbench, 'local'],
] as const)('gives a workshop %s item to a resident of its own camp with %s selection', (kind, selected) => {
  const ui = fixture();
  try {
    const first = new Building(0, Structure.Camp, point(5, 5), 0, 0),
      second = new Building(10, Structure.Camp, point(24, 24), 0, 0),
      smith = new Building(11, kind, point(20, 20), 0, 0),
      [foreign, local] = ui.town.folk,
      preferred = new Person(
        20,
        'Selected craftsperson',
        Role.Resident,
        Calling.Settler,
        Race.Human,
        9,
        point(28, 27),
      );
    first.village = 0;
    second.village = smith.village = 10;
    foreign.home = foreign.village = 0;
    foreign.position = smith.door();
    local.home = local.village = preferred.home = preferred.village = 10;
    local.position = point(24, 24);
    ui.town.placed = [first, second, smith];
    ui.town.folk.push(preferred);
    ui.town.migrateSettlements();
    ui.town.stock(10).add(new Resources(50, 50, 50, 50));
    expect(ui.town.settlementOf(foreign)).toBe(0);
    expect(ui.town.settlementOf(local)).toBe(10);
    expect(ui.town.settlementOf(smith)).toBe(10);
    ui.app.selected = smith.id;
    ui.app.chosen = selected === 'none' ? [] : [selected === 'local' ? preferred.id : foreign.id];
    // The station gives to the nearest of its own camp, whoever is selected and whoever stands at its door.
    const made = kind === Structure.Weaponsmith ? 'wooden-sword' : 'wooden-axe';
    expect(ui.town.craftOffers(smith.id).find((offer) => offer.item.id === made)).toMatchObject({ who: local, reason: '' });
    ui.draw(() => inspector.call(ui.app, new Rect(100, 100, 620, 420), true));
    expect(ui.controls.mock.calls.some(([id]) => id === 'workshop-craft')).toBe(false);
    expect(ui.controls.mock.calls.some(([id]) => String(id).startsWith('station-craft-'))).toBe(true);
    local.faction = preferred.faction = 1;
    expect(ui.town.craftOffers(smith.id)).toEqual([]);
  } finally {
    ui.dispose();
  }
});
it.each([400, 960])('keeps the desktop clock face and caption at toolbar height at %i px', (width) => {
  const ui = fixture(width, 400);
  try {
    ui.app.reducedMotion = () => true;
    ui.app.timeExpanded = true;
    ui.draw(() => skyMural.call(ui.app, width));
    const clock = ui.app.skyBounds, speed = ui.app.timeToggleBounds;
    expect([clock.y, clock.h]).toEqual([speed.y, speed.h]);
    const alpha = (x: number, y: number) => ui.memory.pixels[(Math.floor(y) * width + Math.floor(x)) * 4 + 3];
    expect(alpha(clock.x + 8, clock.y + 1)).toBeGreaterThan(200);
    expect(alpha(clock.x + 8, clock.y + clock.h - 2)).toBeGreaterThan(200);
    const time = ui.labels.mock.calls.find(([, label]) => /^\d{2}:\d{2}$/.test(label));
    expect(time?.[3]).toBeGreaterThanOrEqual(13);
    const caption = ui.labels.mock.calls.find(([, label]) => /\dh \d+m/.test(label));
    expect(caption?.[3]).toBeGreaterThanOrEqual(12);
    expect(clock.x + clock.w).toBeLessThanOrEqual(speed.x - 8);
  } finally {
    ui.app.skyArtwork?.dispose();
    ui.dispose();
  }
});
it.each([
  [880, false],
  [390, true],
])('shows the wake button beside the sky only while someone is abed (%i px, touch=%s)', (width, touch) => {
  const ui = fixture(width, 700);
  try {
    ui.app.touchMode = touch;
    ui.app.reducedMotion = () => true;
    ui.app.wakeEveryone = wakeEveryone.bind(ui.app as unknown as GameCommandApp);
    (ui.app as unknown as GameCommandApp).cue = vi.fn();
    const wake = () => ui.controls.mock.calls.find(([id]) => id === 'wake-everyone')?.[1];
    ui.draw(() => skyMural.call(ui.app, width));
    expect(wake()).toBeUndefined();
    ui.town.folk[0].activity = ui.town.folk[1].activity = Activity.Sleeping;
    const woken = vi.spyOn(ui.town, 'wakeAll');
    ui.draw(() => skyMural.call(ui.app, width));
    const r = wake()!,
      size = touch ? 44 : 36;
    expect([r.w, r.h]).toEqual([size, size]);
    // Clear of the top-left button and of the sky itself.
    expect(r.x).toBeGreaterThanOrEqual(12 + size + 8);
    expect(r.x + r.w <= ui.app.skyBounds.x || r.y >= ui.app.skyBounds.y + ui.app.skyBounds.h + 6).toBe(true);
    ui.context.pointerDown(r.x + 10, r.y + 10);
    ui.context.pointerUp(r.x + 10, r.y + 10);
    ui.draw(() => skyMural.call(ui.app, width));
    expect(woken).toHaveBeenCalledOnce();
    expect(ui.town.folk.some((p) => p.activity === Activity.Sleeping)).toBe(false);
    expect(wake()).toBeUndefined();
  } finally {
    ui.dispose();
  }
});
