/** Real touch input through BrowserHost; no visible windows or shared profiles. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'artifacts/regression/mobile');
const report = { cases: [], errors: [], passed: false };
let server, browser;
await mkdir(output, { recursive: true });
try {
  server = await createServer({
    root,
    base: '/',
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'mobile-probe',
        configureServer(vite) {
          vite.middlewares.use('/mobile-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/apps/web/src/native/native.css"><canvas id="world"></canvas>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
  for (const [width, height, density] of [
    [390, 844, 3], [844, 390, 1], [360, 740, 2.625], [320, 568, 2], [568, 320, 1],
  ]) {
    const renderer = 'gl';
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: density,
      reducedMotion: width === 844 ? 'no-preference' : 'reduce',
    });
    const page = await context.newPage();
    const row = { width, height, density, renderer, checks: [] };
    report.cases.push(row);
    const check = (name, actual) => {
      row.checks.push({ name, passed: !!actual });
      assert.ok(actual, name);
    };
    page.on('pageerror', (e) => report.errors.push(e.stack ?? String(e)));
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })),
      });
    const frames = async (count = 2) =>
      page.evaluate((count) => {
        for (let i = 0; i < count; i++) {
          window.mobile.runtime.app.dirty = true;
          window.mobile.labels = [];
          window.mobile.hud = {};
          window.mobile.runtime.host.render(++window.mobile.frame / 60);
        }
      }, count);
    try {
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/mobile-probe`);
      await page.evaluate(async (renderer) => {
        if (innerWidth === 390 || innerWidth === 568)
          (await import('/packages/localization/src/index.ts')).storeLocale('KR');
        // Guide cards are covered by guide.browser.mjs; here they would sit under the gestures.
        (await import('/apps/web/src/native/guide-preferences.ts')).setGuidePreference('cards', false);
        const [{ startNativeGame }, { Tool }, { Terrain, Layer }, { WorldMap }, { Town }, { project, Camera }] =
          await Promise.all([
            import('/apps/web/src/native/bootstrap.ts'),
            import('/packages/engine/src/game-tools.ts'),
            import('/packages/engine/src/world-types.ts'),
            import('/packages/engine/src/world-map.ts'),
            import('/packages/engine/src/town.ts'),
            import('/packages/engine/src/geometry.ts'),
          ]);
        const runtime = await startNativeGame(
          document.querySelector('#world'),
          { titleScreen: false, world: 'Random', seed: 5 },
          renderer,
          undefined,
          false,
        );
        const game = runtime.app.game;
        game.paused = true;
        const map = WorldMap.generate(5, 32, 32),
          start = map.camp();
        for (const layer of map.layers) layer.fill(0.4);
        map.layer(Layer.Land).fill(1);
        map.layer(Layer.Ridge).fill(-1);
        map.stream = { path: [], width: [] };
        for (const tile of map.tiles)
          Object.assign(tile, { terrain: Terrain.Grass, trees: 0, wild: 0, quarried: true, dungeon: -1 });
        map.sites = [];
        map.ymir = null;
        map.fire = null;
        map.reveal(start, 100);
        game.town = new Town(map);
        game.town.scout(start.x, start.y, 100);
        game.town.editHour(12);
        game.chosen = game.town.people().map((p) => p.id);
        for (const p of game.town.people()) p.position = { x: start.x, y: start.y };
        const center = project(start.x, start.y);
        game.setView(new Camera(center.x, center.y, 1.4));
        game.renderer.invalidateMap();
        window.mobile = { runtime, game, Tool, frame: 0, labels: [], hud: {}, orders: [] };
        // Drive the real UI clock with the replay clock, including dock morphs.
        runtime.app.services.frameTime = () => window.mobile.frame / 60;
        const text = game.context.text.bind(game.context),
          control = game.context.control.bind(game.context),
          move = game.town.orderMove.bind(game.town);
        game.context.control = (...args) => {
          window.mobile.hud[args[0]] = { ...args[1] };
          return control(...args);
        };
        game.context.text = (...args) => {
          window.mobile.labels.push({ bounds: args[0], text: args[1], size: args[3] });
          return text(...args);
        };
        game.town.orderMove = (...args) => {
          window.mobile.orders.push(structuredClone(args));
          return move(...args);
        };
      }, renderer);
      await frames();
      check(
        'The touch fixture contains a real selected resident group',
        await page.evaluate(() => window.mobile.game.chosen.length >= 2),
      );
      await page.screenshot({ path: `${output}/${width}x${height}-initial.png` });
      const before = await page.evaluate(() => ({
        ...window.mobile.game.camera,
        chosen: [...window.mobile.game.chosen],
      }));
      const y = Math.round(height * 0.46);
      await touch('touchStart', [[width * 0.4, y]]);
      await touch('touchMove', [[width * 0.4 + 64, y + 24]]);
      await touch('touchEnd', []);
      await frames();
      const after = await page.evaluate(() => ({
        ...window.mobile.game.camera,
        chosen: [...window.mobile.game.chosen],
      }));
      check(
        'One finger pans the map without changing selection',
        Math.abs(after.x - before.x) > 20 && JSON.stringify(after.chosen) === JSON.stringify(before.chosen),
      );
      await touch('touchStart', [
        [width * 0.35, y, 0],
        [width * 0.65, y, 1],
      ]);
      await touch('touchMove', [
        [width * 0.25, y + 8, 0],
        [width * 0.75, y + 8, 1],
      ]);
      await touch('touchEnd', []);
      await frames();
      check(
        'Two fingers zoom without clearing selected units',
        await page.evaluate((chosen) => {
          const g = window.mobile.game;
          return g.camera.zoom > 1.4 && JSON.stringify(g.chosen) === JSON.stringify(chosen);
        }, before.chosen),
      );
      const button = async (id) =>
        page.evaluate((id) => {
          const c = window.mobile.game.context.controls.find((c) => c.id === id);
          if (!c) throw Error(`Missing control ${id}`);
          return {
            x: c.bounds.x + c.bounds.w / 2,
            y: c.bounds.y + c.bounds.h / 2,
            w: c.bounds.w,
            h: c.bounds.h,
          };
        }, id);
      const tapControl = async (id) => {
        const p = await button(id);
        await page.touchscreen.tap(p.x, p.y);
        await frames(16);
      };
      const clock = await button('speed-toggle');
      check('The centered clock has a 44 px touch target and readable time and countdown', await page.evaluate(() => {
        const { labels, game } = window.mobile, r = game.skyBounds;
        return r.x + r.w / 2 === innerWidth / 2 && r.w >= 180 && r.h >= 44 &&
          labels.some(l => /^\d\d:\d\d$/.test(l.text) && l.size >= 16) &&
          labels.some(l => /^Sun(set|rise) in /.test(l.text) && l.size >= 13 && game.context.textWidth(l.text, l.size) <= l.bounds.w);
      }));
      check('The phone bounds backing pixels while HUD and touch coordinates stay in CSS pixels', await page.evaluate(() => {
        const { runtime, game } = window.mobile, canvas = document.querySelector('#world');
        const ratio = runtime.host.pixelRatio;
        return game.viewWidth === canvas.clientWidth && Math.abs(canvas.width - game.viewWidth * ratio) < 1 &&
          Math.abs(canvas.height - game.viewHeight * ratio) < 1 && ratio <= 1.75 &&
          (devicePixelRatio === 1 ? ratio === 1 : ratio > 1);
      }));
      check('HUD lettering uses the display pixels while the world keeps its rendering budget', await page.evaluate(() => {
        const world = document.querySelector('#world'), hud = document.querySelector('canvas[data-goldfantasy-hud]');
        if (devicePixelRatio === 1) return !hud && world.width === world.clientWidth;
        if (!hud) return false;
        const face = hud.getBoundingClientRect(), view = world.getBoundingClientRect();
        return hud.width === Math.round(view.width * devicePixelRatio) && hud.height === Math.round(view.height * devicePixelRatio) &&
          face.x === view.x && face.y === view.y && face.width === view.width && face.height === view.height &&
          getComputedStyle(hud).pointerEvents === 'none' && hud.getAttribute('aria-hidden') === 'true';
      }));
      await tapControl('objectives-toggle');
      check('An expanded quest offers its full-size action even on short screens', await page.evaluate(() => {
        const action = window.mobile.game.context.controls.find(k => k.id.startsWith('quest-action/'));
        return action?.bounds.h >= 44 && action.bounds.y + action.bounds.h <= innerHeight;
      }));
      await tapControl('speed-toggle');
      await tapControl('speed-2x');
      check('The clock changes the live game speed', await page.evaluate(() => window.mobile.game.gameSpeed() === 2));
      await tapControl('speed-1x');
      await tapControl('speed-||');
      check('The same controls pause the game', await page.evaluate(() => window.mobile.game.gameSpeed() === 0));
      await page.screenshot({ path: `${output}/${width}x${height}-clock.png`, scale: 'css' });
      const underlying = () => page.evaluate(() => {
        const { game: g, hud } = window.mobile;
        return { dock: hud['context-dock'], quests: hud['objectives-panel'], rail: hud['unit/orders'], clock: hud['speed-toggle'],
          camera: { x: g.camera.x, y: g.camera.y, zoom: g.camera.zoom }, units: [...g.chosen], speed: g.timeExpanded, orders: g.pending };
      });
      const background = await underlying();
      await tapControl('unit-management');
      check('Opening Unit management leaves the clock, selection, orders and expanded HUD in place',
        JSON.stringify(await underlying()) === JSON.stringify(background));
      check('Only the centered window can receive input', await page.evaluate(() => {
        const c = window.mobile.game.context, r = c.controls.find(k => k.id === 'roster-panel')?.bounds;
        return r && r.x + r.w / 2 === innerWidth / 2 && r.y + r.h / 2 === innerHeight / 2 &&
          c.inModal() && !c.controls.some(k => ['speed-toggle', 'guide-log-button', 'objectives-toggle', 'unit-management'].includes(k.id));
      }));
      for (const id of ['roster-close', 'roster-tab-units', 'roster-tab-guests', 'equipment-tab-equipment', 'equipment-workbench', 'equipment-tab-guild', 'inventory-slot-0']) {
        const r = await button(id);
        check(id + ' has an in-view 44 px touch target', r.w >= 44 && r.h >= 44 && r.x >= 22 && r.y >= 22 && r.x <= width - 22 && r.y <= height - 22);
      }
      await page.screenshot({ path: `${output}/${width}x${height}-hall.png`, scale: 'css' });
      await page.keyboard.press('b');
      await page.keyboard.press('Tab');
      await touch('touchStart', [[width * .35, y, 0], [width * .65, y, 1]]);
      await touch('touchMove', [[width * .25, y, 0], [width * .75, y, 1]]);
      await touch('touchEnd', []);
      await frames();
      check('Pinching and army keys inside the window leave the world alone',
        JSON.stringify(await underlying()) === JSON.stringify(background));
      const scroll = await page.evaluate(() => {
        const s = window.mobile.game.rosterScroll;
        return { ...s.bounds, limit: s.limit };
      });
      if (scroll.limit > 0) {
        const x = scroll.x + scroll.w / 2, bottom = scroll.y + scroll.h - 8;
        await touch('touchStart', [[x, bottom]]);
        await touch('touchMove', [[x, scroll.y + 6]]);
        await touch('touchEnd', []);
        await frames();
        check('Swiping the inventory scrolls its contents without activating a slot', await page.evaluate(() => {
          const g = window.mobile.game;
          return g.rosterScroll.offset > 0 && g.inventorySelected === -1;
        }));
      }
      await tapControl('equipment-workbench');
      if (width === 390 || width === 568) {
        const sword = await page.evaluate(async () => {
          const g = window.mobile.game, p = g.town.person(Number(g.rosterSelected.split(':')[1]));
          const { addInventory } = await import('/packages/engine/src/equipment.ts');
          if (!addInventory(p, 'wooden-sword')) throw Error('No room in the fixture backpack');
          return { id: p.id, slot: p.inventory.findIndex(stack => stack?.item === 'wooden-sword') + 1 };
        });
        await tapControl('equipment-tab-equipment');
        await tapControl('inventory-slot-' + sword.slot);
        await page.screenshot({ path: `${output}/${width}x${height}-equipment-ko.png`, scale: 'css' });
        for (let swipe = 0; swipe < 4 && (await button('inventory-equip')).h < 44; ++swipe) {
          const { view, next } = await page.evaluate(() => ({ view: window.mobile.game.rosterScroll.bounds, next: window.mobile.hud['inventory-equip'] }));
          const x = view.x + view.w / 2, bottom = view.y + view.h - 6;
          await touch('touchStart', [[x, bottom]]);
          await touch('touchMove', [[x, bottom - Math.min(view.h - 12, Math.max(12, next.y + next.h - bottom))]]);
          await touch('touchEnd', []);
          await frames();
        }
        check('The complete Equip button is reachable for the selected item', (await button('inventory-equip')).h >= 44);
        await tapControl('inventory-equip');
        check('Tapping Equip changes the actual resident equipment', await page.evaluate(s => window.mobile.game.town.person(s.id).equipment.weapon === s.slot, sword));
        await tapControl('inventory-equip');
        check('The equipped item can be put back in the backpack', await page.evaluate(s => window.mobile.game.town.person(s.id).equipment.weapon < 0, sword));
        await page.evaluate(s => { window.mobile.game.town.person(s.id).inventory[s.slot - 1] = null; }, sword);
      }
      await tapControl('equipment-tab-guild');
      await tapControl('roster-tab-guests');
      await tapControl('roster-close');
      check('The close button restores the same expanded HUD', JSON.stringify(await underlying()) === JSON.stringify(background));
      await tapControl('unit-management');
      await page.touchscreen.tap(3, 3);
      await frames();
      check('An outside tap closes only the window', await page.evaluate(() => !window.mobile.game.rosterOpen) &&
        JSON.stringify(await underlying()) === JSON.stringify(background));
      await tapControl('guide-log-button');
      const journal = await button('guide-log');
      check('The mobile Log is centered above the HUD', journal.x === width / 2 && journal.y === height / 2);
      await page.keyboard.press('Escape');
      await frames();
      if (await page.evaluate(() => window.mobile.game.mobileQuestsExpanded)) await tapControl('objectives-toggle');
      if (await page.evaluate(() => window.mobile.game.timeExpanded)) await tapControl('speed-toggle');
      if (width === 390) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, mobile: true, deviceScaleFactor: 1 });
        await frames();
        check('A density-only change preserves the logical clock and refreshes the backing store',
          JSON.stringify(await button('speed-toggle')) === JSON.stringify(clock) &&
          await page.evaluate(() => document.querySelector('#world').width === window.mobile.game.viewWidth));
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, mobile: true, deviceScaleFactor: density });
        await frames();
      }
      if (Math.min(width, height) === 320) continue;
      await tapControl('unit/card-move');
      await touch('touchStart', [[width * 0.4, y]]);
      await touch('touchMove', [[width * 0.4 + 40, y + 12]]);
      await touch('touchEnd', []);
      await frames(4);
      check(
        'Panning with Move armed keeps the order pending and does not issue a destination',
        await page.evaluate(() => window.mobile.game.pending !== 0 && window.mobile.orders.length === 0),
      );
      await tapControl('command-cancel');
      check(
        'Cancel dismisses an armed order without losing the group',
        await page.evaluate(
          () =>
            window.mobile.game.pending === 0 &&
            window.mobile.game.chosen.length >= 2 &&
            window.mobile.orders.length === 0,
        ),
      );
      await tapControl('unit/card-move');
      await page.touchscreen.tap(width * 0.52, height * 0.4);
      await frames(8);
      check(
        'Tapping a destination issues Move once and keeps the group selected',
        await page.evaluate(() => window.mobile.orders.length === 1 && window.mobile.game.chosen.length >= 2),
      );
      // Use the actual on-canvas Build flow, including its touch-accessible menu.
      await page.evaluate(() => {
        const g = window.mobile.game;
        g.chosen = [];
        g.setView({
          ...g.camera,
          x: (g.town.map().camp().x - g.town.map().camp().y) * 32,
          y: (g.town.map().camp().x + g.town.map().camp().y) * 16,
          zoom: 1.4,
        });
      });
      await frames(16);
      check(
        'Build and Units are available without hovering',
        (await button('build-handle')).h >= 44 && (await button('unit-roster')).h >= 44,
      );
      // A new settlement can place a camp and nothing else, so the menu opens on it at once.
      await tapControl('build-handle');
      await tapControl('global/card-pick-Camp');
      check(
        'A building starts as a visible preview, with no construction placed',
        await page.evaluate(() => {
          const g = window.mobile.game;
          return !!g.touchPlacement && g.current.preview.valid && g.town.buildings().length === 0;
        }),
      );
      check(
        'Placement controls are at least 44 pixels and stay inside the viewport',
        await page.evaluate(() => {
          const g = window.mobile.game;
          return g.context.controls
            .filter((c) => c.id.startsWith('placement-'))
            .every(
              ({ bounds: r }) =>
                r.w >= 44 &&
                r.h >= 44 &&
                r.x >= 0 &&
                r.y >= 0 &&
                r.x + r.w <= innerWidth &&
                r.y + r.h <= innerHeight,
            );
        }),
      );
      check(
        'Quests do not cover building placement',
        await page.evaluate(
          () => !window.mobile.game.context.controls.some((c) => c.id === 'objectives-panel'),
        ),
      );
      await page.screenshot({ path: `${output}/${width}x${height}-placement.png` });
      const candidateBefore = await page.evaluate(() => ({ ...window.mobile.game.touchPlacement }));
      await tapControl('placement-rotate');
      check(
        'Releasing a touch button does not leave a focused tooltip on the map',
        await page.evaluate(() => !window.mobile.labels.some((l) => l.text === 'Rotate')),
      );
      check(
        'Rotating from the dock does not move the building onto the dock',
        await page.evaluate((before) => {
          const g = window.mobile.game;
          return (
            JSON.stringify(before) === JSON.stringify(g.touchPlacement) && g.town.buildings().length === 0
          );
        }, candidateBefore),
      );
      // Rotate the browser while a deliberately high candidate is selected.
      if (width === 390) {
        const camera = await page.evaluate(() => ({ ...window.mobile.game.camera }));
        await page.touchscreen.tap(width / 2, 180);
        await frames(4);
        const site = await page.evaluate(() => ({ ...window.mobile.game.touchPlacement }));
        await page.setViewportSize({ width: 844, height: 390 });
        await frames(16);
        check(
          'Rotation retains the chosen world site and keeps it above the dock',
          await page.evaluate((site) => {
            const g = window.mobile.game,
              screen = g.toScreen(g.touchPlacement);
            return (
              JSON.stringify(site) === JSON.stringify(g.touchPlacement) &&
              screen.y >= 64 &&
              screen.y < g.dockBounds.y - 24 &&
              screen.x > 12 &&
              screen.x < innerWidth - 12
            );
          }, site),
        );
        await page.screenshot({ path: `${output}/rotation-placement.png` });
        await page.setViewportSize({ width, height });
        await frames(16);
        await page.evaluate((camera) => window.mobile.game.setView(camera), camera);
        await frames(4);
      }
      const target = { x: width * 0.52, y: height * 0.42 };
      await touch('touchStart', [[target.x - 15, target.y]]);
      await touch('touchMove', [[target.x, target.y + 10]]);
      await touch('touchEnd', []);
      await frames(8);
      check(
        'Moving the preview does not place the building on touch-down',
        await page.evaluate(() => window.mobile.game.town.buildings().length === 0),
      );
      const chosen = await page.evaluate(() => ({ ...window.mobile.game.touchPlacement }));
      check(
        'A valid world position enables Place',
        await page.evaluate(
          () => window.mobile.game.context.controls.find((c) => c.id === 'placement-confirm').enabled,
        ),
      );
      const confirm = await button('placement-confirm');
      await touch('touchStart', [[confirm.x, confirm.y]]);
      await frames(3);
      check(
        'The preview remains visible while holding Place',
        await page.evaluate(() => window.mobile.game.current.preview.kind !== 0),
      );
      await touch('touchEnd', []);
      await frames(16);
      row.placement = await page.evaluate(() => {
        const g = window.mobile.game;
        return {
          candidate: g.touchPlacement,
          actual: g.town.camp()?.center,
          status: g.status,
          problem: g.current.problem,
          tool: g.tool,
        };
      });
      check(
        'Place builds the camp at the preview location on a map without dungeons',
        await page.evaluate((at) => {
          const town = window.mobile.game.town, camp = town.camp();
          return town.map().dungeons().length === 0 && !!camp && Math.hypot(camp.center.x - at.x, camp.center.y - at.y) < 1;
        }, chosen),
      );
      await page.evaluate(() => {
        const g = window.mobile.game;
        g.town.camp().progress = 1;
      });
      await frames(16);
      check(
        'A completed Camp shows supplies in the bottom inspector on touch',
        await page.evaluate(() => {
          const g = window.mobile.game;
          return (
            window.mobile.labels.some((l) => l.text === 'Village stores') &&
            window.mobile.labels.some((l) => l.text === 'Bones') &&
            g.dockBounds.y + g.dockBounds.h === g.viewHeight - 12
          );
        }),
      );
      await page.screenshot({ path: `${output}/${width}x${height}-stores.png` });
      await page.evaluate(() => {
        const g = window.mobile.game;
        g.selected = -1;
        g.chosen = [];
        g.selectTool(window.mobile.Tool.Road);
      });
      await frames(16);
      const start = { x: width * 0.35, y: height * 0.46 };
      const roadsBefore = await page.evaluate(() => window.mobile.game.town.roads().roads().length);
      await touch('touchStart', [[start.x, start.y, 0]]);
      await touch('touchMove', [[start.x + 20, start.y, 0]]);
      await touch('touchStart', [
        [start.x + 20, start.y, 0],
        [start.x + 85, start.y, 1],
      ]);
      await touch('touchMove', [
        [start.x + 10, start.y, 0],
        [start.x + 95, start.y, 1],
      ]);
      await touch('touchEnd', [[start.x + 10, start.y, 0]]);
      await touch('touchMove', [[start.x + 30, start.y, 0]]);
      await touch('touchEnd', []);
      await frames(16);
      check(
        'Pinching cancels a road stroke and ignores the remaining finger',
        await page.evaluate((n) => {
          const g = window.mobile.game;
          return g.roadPress === null && g.town.roads().roads().length === n;
        }, roadsBefore),
      );
      const line = await page.evaluate(async () => {
        const { point, project, add, rotated } = await import('/packages/engine/src/geometry.ts');
        const { sharpAnchor } = await import('/packages/engine/src/road-network.ts');
        const g = window.mobile.game,
          camp = g.town.camp(),
          a = add(camp.center, rotated(point(1, 0), camp.angle)),
          b = add(camp.center, rotated(point(5, 0), camp.angle)),
          focus = project((a.x + b.x) / 2, (a.y + b.y) / 2);
        const check = g.town.canBuildRoad([sharpAnchor(a), sharpAnchor(b)]);
        if (!check.ok) throw Error(check.reason);
        g.setView({ x: focus.x, y: focus.y + 45, zoom: 1.2 });
        return { a: g.toScreen(a), b: g.toScreen(b) };
      });
      await frames(16);
      await touch('touchStart', [[line.a.x, line.a.y]]);
      for (let step = 1; step <= 8; ++step)
        await touch('touchMove', [
          [line.a.x + ((line.b.x - line.a.x) * step) / 8, line.a.y + ((line.b.y - line.a.y) * step) / 8],
        ]);
      await touch('touchEnd', []);
      await frames(16);
      check(
        'A one-finger road stroke creates an actual construction request',
        await page.evaluate(
          (before) => window.mobile.game.town.roads().roads().length === before + 1,
          roadsBefore,
        ),
      );
      await page.screenshot({ path: `${output}/${width}x${height}-road.png` });
      await page.evaluate(() => window.mobile.game.selectTool(window.mobile.Tool.Road));
      await frames(16);
      await tapControl('placement-cancel');
      await tapControl('speed-toggle');
      check(
        'All time controls are visible and tappable',
        await page.evaluate(() => {
          const controls = window.mobile.game.context.controls.filter(
            (c) => c.id.startsWith('speed-') && c.id !== 'speed-toggle',
          );
          return (
            controls.length === 6 &&
            controls.every(({ bounds: r }) => r.w >= 44 && r.h >= 44 && r.x >= 0 && r.x + r.w <= innerWidth)
          );
        }),
      );
      await page.screenshot({ path: `${output}/${width}x${height}-controls.png` });
      // Exercise the same offset/size change produced by display cutout insets.
      const insetStyle = await page.addStyleTag({
        content:
          '#world{left:20px;top:16px;width:calc(100vw - 40px)!important;height:calc(100dvh - 32px)!important}',
      });
      await frames(8);
      const inset = await page.evaluate(() => {
        const g = window.mobile.game,
          r = document.querySelector('#world').getBoundingClientRect();
        return {
          x: g.camera.x,
          zoom: g.camera.zoom,
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        };
      });
      await touch('touchStart', [[inset.left + inset.width * 0.4, inset.top + inset.height * 0.46]]);
      await touch('touchMove', [[inset.left + inset.width * 0.4 + 50, inset.top + inset.height * 0.46]]);
      await touch('touchEnd', []);
      await frames(4);
      check(
        'Inset canvas coordinates pan correctly and match the logical game viewport',
        await page.evaluate((before) => {
          const g = window.mobile.game;
          return (
            Math.abs(g.camera.x - (before.x - 50 / before.zoom)) < 0.01 &&
            g.viewWidth === before.width &&
            g.viewHeight === before.height
          );
        }, inset),
      );
      await insetStyle.evaluate((style) => style.remove());
    } finally {
      await page.evaluate(() => window.mobile?.runtime.dispose()).catch(() => {});
      await context.close();
    }
  }
  // Exercise the actual title and game shell as well: its Settings layer sits outside the game HUD.
  const shellContext = await browser.newContext({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  try {
    const page = await shellContext.newPage();
    const scriptRuntimeRequests = [];
    page.on('request', request => {
      if (/\/lua[^/]*\.(wasm|mjs)(?:\?|$)/i.test(request.url())) scriptRuntimeRequests.push(request.url());
    });
    page.on('pageerror', e => report.errors.push(e.stack ?? String(e)));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/mobile-probe`);
    await page.evaluate(async () => {
      const { startNativeGame } = await import('/apps/web/src/native/bootstrap.ts');
      (await import('/packages/localization/src/index.ts')).storeLocale('KR');
      const { setGuidePreference } = await import('/apps/web/src/native/guide-preferences.ts');
      setGuidePreference('cards', false);
      setGuidePreference('focus', false);
      window.shell = await startNativeGame(document.querySelector('#world'), { titleScreen: true, seed: 5 }, 'gl', undefined, false);
      window.stamp = 0;
      // A brief focus between frames is enough to open a phone keyboard.
      window.textFocuses = 0;
      document.addEventListener('focusin', e => {
        if (e.target.matches('[data-goldfantasy-text-input]')) window.textFocuses++;
      });
    });
    const paint = (n = 2) => page.evaluate(n => {
      for (let i = 0; i < n; ++i) shell.host.render(window.stamp += .1);
    }, n);
    const textFocus = () => page.evaluate(() => ({
      editing: document.activeElement.matches('[data-goldfantasy-text-input]'), count: window.textFocuses,
    }));
    const tapAt = async (id, layer, fingerSized) => {
      const r = await page.evaluate(([id, layer]) => {
        const c = layer === 'overlay' ? shell.app.overlay : shell.app[layer].game.context;
        return c.controls.find(k => k.id === id)?.bounds;
      }, [id, layer]);
      assert.ok(r && r.w > 0 && r.h > 0, id + ' is on screen');
      if (fingerSized) assert.ok(r.w >= 44 && r.h >= 44, id + ' is a finger-sized button');
      await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
      await paint();
    };
    const tap = async (id, game = false) => {
      const { count } = await textFocus();
      await tapAt(id, game ? 'gameSession' : 'overlay', true);
      assert.deepEqual(await textFocus(), { editing: false, count }, id + ' must not summon the text keyboard');
    };
    await paint();
    await tap('title-settings');
    await tap('settings/close');
    await tap('map-editor');
    await page.setViewportSize({ width: 390, height: 844 });
    await paint();
    await tapAt('map-tool-1', 'editorSession');
    assert.deepEqual(await textFocus(), { editing: false, count: 0 });
    await tapAt('map-path', 'editorSession');
    assert.deepEqual(await textFocus(), { editing: true, count: 1 });
    const ime = await shellContext.newCDPSession(page);
    const syllable = String.fromCodePoint(0xd55c);
    const path = () => page.evaluate(() => shell.app.editorSession.game.atlas.path.value);
    const beforeTyping = await path();
    await ime.send('Input.imeSetComposition', { text: syllable, selectionStart: 1, selectionEnd: 1 });
    await page.setViewportSize({ width: 390, height: 520 });
    await paint();
    assert.deepEqual(await textFocus(), { editing: true, count: 1 }, 'The active field survives a keyboard-sized viewport change');
    await tapAt('map-path', 'editorSession');
    assert.deepEqual(await textFocus(), { editing: true, count: 1 }, 'Tapping the field again keeps its input session');
    await ime.send('Input.insertText', { text: syllable });
    assert.equal(await path(), beforeTyping + syllable, 'The composed syllable is committed once');
    await page.keyboard.press('Tab');
    assert.deepEqual(await textFocus(), { editing: false, count: 1 });
    await page.keyboard.press('Shift+Tab');
    assert.deepEqual(await textFocus(), { editing: true, count: 2 }, 'Tab navigation can return to the text field');
    await tap('settings');
    await tap('settings/close');
    await page.setViewportSize({ width: 390, height: 844 });
    await paint();
    await tapAt('map-tool-1', 'editorSession');
    assert.deepEqual(await textFocus(), { editing: false, count: 2 });
    await page.evaluate(() => shell.app.command('scene.title'));
    await page.setViewportSize({ width: 568, height: 320 });
    await paint();
    await tap('new-game');
    await page.evaluate(() => shell.app.command('scene.skip-saga'));
    await paint(30);
    await page.evaluate(() => { shell.app.gameSession.services.frameTime = () => window.stamp; });
    assert.ok(await page.evaluate(() => {
      const game = shell.app.gameSession.game, town = game.town, advance = town.advance;
      const step = game.gameSpeed() / 60, ticks = [];
      town.advance = function (dt) { ticks.push(dt); return advance.call(this, dt); };
      try {
        return [30, 60, 120].every(rate => {
          ticks.length = 0;
          const start = town.clock();
          for (let i = 0; i < rate / 2; i++) shell.host.render(window.stamp += 1 / rate);
          return ticks.length === 30 && ticks.every(dt => dt === step) &&
            Math.abs(town.clock() - start - 30 * step) < 1e-6;
        });
      } finally { town.advance = advance; }
    }), 'Half a second of live play takes the same simulation steps at 30, 60 and 120 Hz');
    await tap('settings');
    await paint(8);
    const frozen = await page.evaluate(() => {
      const game = shell.app.gameSession.game, clock = game.town.clock();
      const { update, presented } = game.renderer;
      const hud = shell.host.hud.canvas, draw = hud.render;
      let updates = 0, pickFrames = 0, hudDraws = 0;
      hud.render = function (...args) { hudDraws++; return draw.apply(this, args); };
      game.renderer.update = function (...args) { updates++; return update.apply(this, args); };
      game.renderer.presented = function (...args) { pickFrames++; return presented.apply(this, args); };
      try {
        for (let i = 0; i < 30; i++) shell.host.render(window.stamp += 1 / 60);
        const idle = updates, idlePicks = pickFrames, idleHud = hudDraws, delay = shell.app.nextFrameDelay();
        shell.app.invalidatePresentation();
        shell.host.render(window.stamp += 1 / 60);
        shell.host.render(window.stamp += 1 / 60);
        return { idle, idlePicks, idleHud, redraw: updates - idle, newPicks: pickFrames - idlePicks,
          unchanged: clock === game.town.clock(), delay };
      } finally {
        game.renderer.update = update;
        game.renderer.presented = presented;
        hud.render = draw;
      }
    });
    assert.deepEqual(frozen, { idle: 0, idlePicks: 0, idleHud: 0, redraw: 1, newPicks: 1, unchanged: true, delay: 0.5 });
    assert.ok(await page.evaluate(() => {
      const { app, host } = shell, full = host.capture();
      let world;
      try { app.worldOnly(true); world = host.capture(); }
      finally { app.worldOnly(false); }
      return full.startsWith('data:image/jpeg;') && full !== world && host.capture() === full;
    }), 'A save thumbnail can omit the interface and the next capture restores the same sharp HUD');
    assert.deepEqual(scriptRuntimeRequests, [], 'Starting the title and playing requires only the rendering runtime');
    await page.screenshot({ path: output + '/settings-landscape-ko.png', scale: 'css' });
    await tap('settings/save');
    assert.ok(await page.evaluate(() => {
      const slots = shell.app.overlay.controls.filter(k => k.id.startsWith('settings/slot'));
      return slots.length === 9 && slots.every(({ bounds: r }) => r.w >= 44 && r.h >= 44 && r.y >= 0 && r.y + r.h <= innerHeight);
    }), 'Every save slot fits on the short landscape screen');
    await tap('settings/back');
    await tap('settings/close');
    await page.setViewportSize({ width: 390, height: 844 });
    await paint(4);
    await page.evaluate(() => {
      const g = shell.app.gameSession.game;
      g.selectPeople(g.town.people().map(p => p.id));
    });
    await paint(6);
    await page.screenshot({ path: output + '/settlement-portrait-ko.png', scale: 'css' });
    await tap('unit-management', true);
    assert.ok(await page.evaluate(() => shell.app.gameSession.game.context.inModal() &&
      !shell.app.overlay.controls.some(k => k.id === 'settings')), 'The global Settings button cannot cover a game window');
    await page.setViewportSize({ width: 568, height: 320 });
    await paint(4);
    await page.screenshot({ path: output + '/settlement-hall-landscape-ko.png', scale: 'css' });
    await tap('roster-close', true);
    assert.ok(await page.evaluate(() => !shell.app.settingsOpen && !shell.app.gameSession.game.rosterOpen &&
      shell.app.overlay.controls.some(k => k.id === 'settings')), 'The overlapping close button closes the rotated window without opening Settings');
    report.shell = 'Title, settings, save slots, game, text focus, IME composition, viewport resizing and overlapping controls passed';
  } finally {
    await shellContext.pages()[0]?.evaluate(() => window.shell?.dispose()).catch(() => {});
    await shellContext.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
