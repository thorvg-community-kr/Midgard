import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Key, Rect } from '../../packages/native-ui/src';
import { defaultLocale, hasHangul, setLocale, translate } from '../../packages/localization/src/index';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Activity, Calling, Role, type Person } from '../../packages/engine/src/person';
import { CombatCue, MonsterRank } from '../../packages/engine/src/combat-events';
import { rankRules } from '../../packages/engine/src/monster-ranks';
import { Camera, distance, project, type Point } from '../../packages/engine/src/geometry';
import { lairOf, monsterEntrance } from '../../packages/engine/src/town-monsters';
import { sealable } from '../../packages/engine/src/gate-seals';
import { realmRules } from '../../packages/engine/src/town-realm';
import { ExpeditionEnd, FirstSlam, MemberState, type ExpeditionResult } from '../../packages/engine/src/expedition-record';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { Order } from '../../packages/engine/src/game-tools';
import { GameAppState } from '../../apps/web/src/native/game-app-state';
import { combatFrame, combatOverlays, type CombatFrameApp } from '../../apps/web/src/native/game-combat-hud';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';
import { Cue, Sound } from '../../packages/native-audio/src/sound-types';
import type { AppEvent } from '../../apps/web/src/native/application-contracts';

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
let base: WorldMap;
let metrics: ConstructorParameters<typeof Context>[1];
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({ renderer: 'sw', locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}` });
  for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  metrics = Object.fromEntries(
    ['DejaVuSans', 'DejaVuSans-Bold'].map((font) => [
      font,
      parseFontMetrics(new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`))),
    ]),
  );
  base = WorldMap.generate(5);
}, 120000);
afterAll(() => {
  setLocale(defaultLocale);
  tvg.term();
  vi.unstubAllGlobals();
});

/** An armed party already within reach of the nearest dungeon. */
function attackers(callings: Calling[], level: number) {
  const town = new Town(base, 176, false),
    camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(0);
  const gate = town
    .map()
    .dungeons()
    .map((site, index) => ({ site, index }))
    .filter((g) => sealable(g.site))
    .sort((a, b) => distance(lairOf(a.site), camp.center) - distance(lairOf(b.site), camp.center))[0].index;
  town.map().dungeons()[gate].discovered = true;
  const members = callings.map((calling) => {
    const p = town.makePerson(Role.Resident, calling, monsterEntrance(town.map().dungeons()[gate]));
    town.folk.push(p);
    p.level = level;
    p.food = p.rest = p.hydration = 1;
    return p;
  });
  expect(town.orderAttackDungeon(members.map(p => p.id), gate)).toBe(true);
  town.notices = [];
  return { town, gate, members };
}

type TestApp = GameHudApp & CombatFrameApp;
/** The app around a town, driven the way `render` drives it: advance unless held, then staging, then the combat HUD. */
function harness(town: Town, options: { reduced?: boolean; width?: number; height?: number } = {}) {
  // Fonts are loaded per canvas, as the other HUD suites do: destroying a canvas lets them go.
  for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  const width = options.width ?? 1024,
    height = options.height ?? 768,
    canvas = new tvg.Canvas(new MemoryCanvas(width, height) as never, { width, height, enableDevicePixelRatio: false }),
    context = new Context(tvg, metrics),
    renderer = { visible: () => true, invalidatePresentation: vi.fn(), pick: () => null },
    app = new GameAppState(town, renderer as never, context) as TestApp;
  app.viewWidth = width;
  app.viewHeight = height;
  const camp = project(town.map().camp().x, town.map().camp().y);
  app.camera = new Camera(camp.x, camp.y, 1.4);
  app.skyBounds = new Rect((width - 356) / 2, 14, 356, 32);
  app.dockBounds = new Rect(0, height - 160, width, 150);
  app.selectPeople = vi.fn((ids: readonly number[]) => {
    app.chosen = [...ids];
  });
  app.gameSpeed = () => (app.paused ? 0 : app.speed);
  app.reducedMotion = () => !!options.reduced;
  app.spatial = (cue) => new Sound(cue, 0.8);
  app.sayLine = vi.fn(() => true);
  canvas.add(context.scene());
  const controls = vi.spyOn(context, 'control'),
    labels = vi.spyOn(context, 'text');
  let now = 10;
  const h = {
    app,
    frame(dt = 0.1) {
      now += dt;
      if (!app.paused) town.advance(dt);
      combatFrame(app, dt);
      h.draw();
    },
    frames(seconds: number, dt = 0.1) {
      for (let t = 0; t < seconds - 1e-6; t += dt) h.frame(dt);
    },
    draw() {
      controls.mockClear();
      labels.mockClear();
      context.begin(app.theme, new Rect(0, 0, width, height), now);
      combatOverlays(app, width, height);
      context.end();
    },
    ids: () => controls.mock.calls.map((call) => call[0]),
    text: () => labels.mock.calls.map((call) => String(call[1])),
    dispose() {
      app.combatHud.dispose();
      canvas.remove();
      context.dispose();
      app.campResources.dispose();
      canvas.destroy();
    },
  };
  return h;
}

describe('outdoor siege presentation', () => {
  it('keeps the view on the battlefield when the dungeon falls and shows the guardian there', () => {
    const { town, gate } = attackers([Calling.Warrior, Calling.Ranger, Calling.Mage], 12);
    const h = harness(town), camera = [h.app.camera.x, h.app.camera.y];
    try {
      for (let step = 0; step < 200 && !town.sieges[gate]; step++) h.frame();
      expect(town.sieges[gate]?.health).toBeGreaterThan(0);
      town.sieges[gate]!.health = 0.1;
      for (let step = 0; step < 100 && (town.sieges[gate]?.guardian ?? -1) < 0; step++) h.frame();
      expect(town.sieges[gate]?.guardian).toBeGreaterThanOrEqual(0);
      expect(h.ids()).toContain('guardian-bar');
      expect(h.ids()).not.toContain('expedition-result-panel');
      expect(town.realmActive()).toBe(false);
      expect([h.app.camera.x, h.app.camera.y]).toEqual(camera);
    } finally { h.dispose(); }
  });
  it('pairs the on-screen guardian with its own countdown and warns about both simultaneous summons', () => {
    const { town, gate } = attackers([Calling.Warrior], 8), second = 1;
    const h = harness(town);
    try {
      combatFrame(h.app, 0);
      for (const [i, seconds] of [[gate, 87], [second, 53]]) {
        town.sieges[i] = { health: 0, summonAt: town.time, reviveAt: town.time + seconds, guardian: -1, village: 0 };
      }
      town.stir(0);
      const bosses = [gate, second].map(i => town.creature(town.sieges[i]!.guardian)!);
      bosses[0].health = bosses[0].vigor * .25;
      bosses[1].health = bosses[1].vigor * .75;
      const focus = (i: number, zoom: number) => {
        const location = bosses[i].position, center = project(location.x, location.y);
        h.app.camera = new Camera(center.x, center.y, zoom);
        h.draw();
      };
      const countdown = (i: number, seconds: number) => {
        const count = town.beasts.filter(m => m.brood === bosses[i].id && m.health > 0).length;
        return `Defenders left: ${count} · Dungeon rises in ${seconds}s`;
      };
      combatFrame(h.app, 0);
      expect(h.app.combatHud.autoPause?.creature).toBe(bosses[0].id);
      h.app.paused = false;
      combatFrame(h.app, 0);
      expect(h.app.combatHud.autoPause?.creature).toBe(bosses[1].id);
      h.app.paused = false;
      combatFrame(h.app, 0);
      expect(h.app.paused).toBe(false);

      // Zoomed in, the first battle is outside the view even though the town can see both.
      focus(1, 1.5);
      expect(h.text()).toContain('75%');
      expect(h.text()).toContain(countdown(1, 53));
      expect(h.text()).not.toContain(countdown(0, 87));
      // Both are now on screen. Moving the camera centre changes which battle is described.
      focus(1, .18);
      expect(h.text()).toContain('75%');
      focus(0, .18);
      expect(h.text()).toContain('25%');
      expect(h.text()).toContain(countdown(0, 87));
      // A dead boss still leaves a local clock for the rest of its horde.
      bosses[1].health = 0;
      focus(1, .18);
      expect(h.text()).toContain('25%');
      expect(h.text()).toContain(countdown(0, 87));
      focus(1, 1.5);
      expect(h.ids()).not.toContain('guardian-bar');
      expect(h.text()).toContain(countdown(1, 53));
    } finally { h.dispose(); }
  });
});
