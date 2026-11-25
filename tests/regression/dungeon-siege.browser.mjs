import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Outdoor dungeon inspection, mouse and touch attacks, victory and revival in the real WebGL game.
const output = 'artifacts/regression/dungeon-siege';
const report = { errors: [], passed: false, shots: [] };
let server, browser, deadline;
const setup = async (page, width, height, touch) =>
  page.evaluate(
    async ([width, height, touch]) => {
      const [
        { initializeWebCanvas },
        { loadNativeFonts, loadKoreanFont },
        { BrowserFiles },
        { createNativeServices },
        { BrowserHost },
        { defaultLaunchOptions },
        { Calling, Role },
        { project, distance },
        { gateOrder },
        { monsterEntrance },
        { Building },
        { Structure },
        { isShield, itemCatalog },
        localization,
      ] = await Promise.all([
        import('/apps/web/src/native/startup-canvas.ts'),
        import('/packages/native-ui/src/index.ts'),
        import('/apps/web/src/native/browser-files.ts'),
        import('/apps/web/src/native/bootstrap.ts'),
        import('/apps/web/src/native/browser-host.ts'),
        import('/apps/web/src/native/application-contracts.ts'),
        import('/packages/engine/src/person.ts'),
        import('/packages/engine/src/geometry.ts'),
        import('/packages/engine/src/gate-progression.ts'),
        import('/packages/engine/src/town-monsters.ts'),
        import('/packages/engine/src/town-models.ts'),
        import('/packages/engine/src/building-catalog.ts'),
        import('/packages/engine/src/equipment.ts'),
        import('/packages/localization/src/index.ts'),
      ]);
      (await import('/apps/web/src/native/guide-preferences.ts')).setGuidePreference('cards', false);
      const tvg = await initializeWebCanvas('gl'),
        element = document.createElement('canvas');
      element.style.cssText = `display:block;width:${width}px;height:${height}px`;
      document.body.append(element);
      const fonts = await loadNativeFonts(tvg);
      await loadKoreanFont(tvg, fonts);
      const files = await BrowserFiles.open('dungeon-siege-validation'),
        services = createNativeServices(tvg, fonts, files),
        app = services.createApplication({ ...defaultLaunchOptions(), world: 'Random', seed: 5 }),
        host = new BrowserHost(element, tvg, app, { autoStart: false, devicePixelRatio: false }),
        game = app.game,
        town = game.town,
        gate = gateOrder(town)[0],
        site = town.map().dungeons()[gate];
      if (touch) app.setTouchInput?.(true);
      game.touchMode = touch;
      town.awaiting = false;
      site.discovered = true;
      const camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
      camp.village = 0;
      town.placed.push(camp);
      town.nextId = 1;
      town.foundSettlement(0);
      if (touch) {
        town.days = 2;
        town.editHour(8);
        town.stir(0);
        // A returning scout reaches a dungeon already weakened by the previous assault.
        town.sieges[gate] = { health: 8, summonAt: -1, reviveAt: -1, guardian: -1, village: camp.id };
      }
      town.folk = [];
      const shape = (c) => (c === Calling.Warrior ? 'sword' : c === Calling.Ranger ? 'bow' : c === Calling.Mage ? 'staff' : 'mace');
      const near = monsterEntrance(site);
      const party = touch ? [Calling.Warrior, Calling.Warrior] : [
        Calling.Warrior, Calling.Warrior, Calling.Warrior, Calling.Ranger, Calling.Ranger,
        Calling.Mage, Calling.Mage, Calling.Cleric, Calling.Cleric, Calling.Bard,
      ];
      party.forEach((calling, i) => {
        const position = touch && i === 1 ? camp.door() : { x: near.x + 1 + (i % 4) * 0.8, y: near.y + 1.5 + Math.floor(i / 4) };
        const p = town.makePerson(Role.Resident, calling, town.grid.nearestWalkable(position));
        p.level = touch ? 1 : 10;
        p.food = p.rest = p.hydration = 1;
        p.stress = 0;
        const gear = itemCatalog.filter(it => it.tier === (touch ? 1 : 2) && it.minimumLevel <= p.level);
        const weapon = gear.find(it => it.category === 'weapon' && it.visual === shape(calling));
        const shield = !touch && weapon?.hands === 1 && gear.find(isShield);
        const armor = !touch && gear.find(it => it.category === 'armor' && it.slots.includes('body'));
        for (const [slot, item] of [['weapon', weapon], ['offhand', shield], ['body', armor]]) {
          if (!item) continue;
          const index = p.inventory.findIndex(s => !s);
          p.inventory[index] = { item: item.id, quantity: 1 };
          p.equipment[slot] = index + 1;
        }
        if (touch) p.abilityAuto = 0;
        town.folk.push(p);
      });
      window.probe = {
        app,
        host,
        game,
        gate,
        localization,
        now: 1,
        visibleLabels() {
          const labels = [];
          const c = game.context, text = c.text;
          c.text = function(bounds, value, ...rest) {
            if (bounds.w > 0 && bounds.h > 0) labels.push(value);
            return text.call(this, bounds, value, ...rest);
          };
          try { this.frames(1, 0.001); } finally { c.text = text; }
          return labels;
        },
        retreat() {
          const scout = town.folk[0];
          // Pick a reachable refuge beyond the guardian's territory, leaving room for a full retreat.
          const refuge = town.map().dungeons().filter(other => other !== site)
            .map(other => town.grid.nearestWalkable(monsterEntrance(other)))
            .sort((a, b) => distance(near, a) - distance(near, b))
            .find(at => distance(near, at) > 24 && town.grid.path(scout.position, at).length > 0);
          if (!refuge) throw new Error('The scout needs a route out of the valley');
          town.orderMove([scout.id], refuge);
          if (!scout.moving() || scout.aggressive) throw new Error('The scout did not start retreating');
        },
        frames(count, dt = 0.05) {
          for (let i = 0; i < count; ++i) {
            this.now += dt;
            app.dirty = true;
            host.render(this.now);
          }
        },
        look(zoom = touch ? 1.1 : 1.3) {
          const at = project(near.x, near.y);
          game.camera.x = at.x;
          game.camera.y = at.y;
          game.camera.zoom = zoom;
          game.invalidatePresentation();
        },
        targetScreen(kind) {
          const scout = town.folk[0], o = site.origin;
          const id = kind === 'person' ? scout.id : gate;
          const foot = game.toScreen(kind === 'person' ? scout.position : { x: o.x + 1, y: o.y + 1 });
          for (let dy = 0; dy >= -90; dy -= 6) {
            for (let dx = -42; dx <= 42; dx += 6) {
              const at = { x: foot.x + dx, y: foot.y + dy };
              const hit = game.renderer.pick(at);
              if (!game.context.controlAt(at.x, at.y) && hit?.kind === kind && hit.id === id) return at;
            }
          }
          return null;
        },
        snapshot() {
          return {
            selected: [...game.chosen],
            paused: game.paused,
            controls: game.context.controls.map((c) => ({ id: c.id, bounds: { ...c.bounds }, enabled: c.enabled })),
          };
        },
      };
      probe.look();
      probe.frames(8);
      element.focus();
    },
    [width, height, touch],
  );

try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'dungeon-siege-validation',
        configureServer(vite) {
          vite.middlewares.use('/dungeon-siege-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dungeon siege validation</title></head><body style="margin:0;background:#11191c;overflow:hidden"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 400000);
  const url = `http://127.0.0.1:${server.httpServer.address().port}/dungeon-siege-probe`;

  for (const touch of [false, true]) {
    const width = touch ? 390 : 1280, height = touch ? 844 : 800;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch });
    const page = await context.newPage();
    page.on('pageerror', err => report.errors.push(err.stack ?? err.message));
    await page.goto(url);
    await setup(page, width, height, touch);
    const frame = () => page.evaluate(() => probe.frames(7, 0.05));
    const activate = async (x, y) => {
      if (touch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await frame();
    };
    const control = async id => {
      const found = await page.evaluate(id => probe.snapshot().controls.find(c => c.id === id), id);
      assert(found?.enabled, `Missing control ${id}`);
      await activate(found.bounds.x + found.bounds.w / 2, found.bounds.y + found.bounds.h / 2);
    };
    if (touch) {
      const scout = await page.evaluate(() => ({ at: probe.targetScreen('person'), id: probe.game.town.folk[0].id }));
      assert(scout.at, 'The scout beside the dungeon can be tapped');
      await activate(scout.at.x, scout.at.y);
      assert.deepEqual(await page.evaluate(() => probe.game.chosen), [scout.id]);
    }
    const gate = await page.evaluate(() => probe.targetScreen('dungeon'));
    if (!gate) {
      const state = await page.evaluate(() => ({ controls: probe.game.context.controls.map(c => c.id), camera: probe.game.camera }));
      throw new Error(`No exposed dungeon body on ${width}×${height}: ${JSON.stringify(state)}`);
    }
    await activate(gate.x, gate.y);
    const picked = await page.evaluate(at => ({ selected: probe.game.selectedDungeon, gate: probe.gate, hit: probe.game.renderer.pick(at)?.kind,
      covered: probe.game.context.controlAt(at.x, at.y), paused: probe.game.paused }), gate);
    assert.equal(picked.selected, picked.gate, JSON.stringify({ touch, gate, picked }));
    assert.deepEqual(await page.evaluate(() => probe.snapshot().selected), []);
    const inspection = await page.evaluate(() => probe.visibleLabels());
    assert.match(inspection.join(' '), /Recommended: 10 fighters at level 10/);
    assert.match(inspection.join(' '), /larger and stronger hordes/);
    assert.match(inspection.join(' '), /Defeat them all before the dungeon rises again\./);
    assert(!inspection.some(text => text.includes('Dungeon health')));
    assert(inspection.includes('Attack'), 'The dungeon inspector shows an Attack button');
    await control('gate-attack');
    const issued = await page.evaluate(() => probe.snapshot());
    assert.equal(issued.paused, picked.paused);
    const expected = await page.evaluate(touch => (touch ? probe.game.town.folk.slice(0, 1) : probe.game.town.folk).map(p => p.id), touch);
    assert.deepEqual(issued.selected, expected);
    assert(!issued.controls.some(c => c.id.startsWith('expedition-')), 'A single attack press issues the order in the world');
    const battle = await page.evaluate(async touch => {
      const { dungeonStatus } = await import('/packages/engine/src/dungeon-siege.ts');
      const { MonsterRank } = await import('/packages/engine/src/combat-events.ts');
      const { game, gate } = probe, town = game.town;
      const waves = [];
      const stepTo = (phase) => {
        const deadline = town.time + 90;
        while (town.time < deadline && dungeonStatus(town, gate).phase !== phase) {
          const next = town.nextMonster;
          town.advance(0.1);
          const wave = town.monsters().filter(m => m.id >= next && m.lair === gate && !m.raider);
          if (wave.length) waves.push({
            count: wave.length,
            level: Math.min(...wave.map(m => m.level)),
            guardian: wave.some(m => m.rank === MonsterRank.Guardian),
          });
        }
        return dungeonStatus(town, gate);
      };
      const before = dungeonStatus(town, gate);
      const initialHealth = touch ? 8 : before.maxHealth;
      for (let i = 0; i < 100 && dungeonStatus(town, gate).health === initialHealth; i++) town.advance(0.1);
      const hit = dungeonStatus(town, gate);
      const broken = stepTo('summoning');
      probe.frames(2, 0.01);
      return { hit, broken, waves, initialHealth, partySize: town.chronicle.largestParty, outdoors: !town.realmActive(), marching: town.parties.length };
    }, touch);
    assert(battle.hit.health < battle.initialHealth, 'Normal attack orders damage the structure');
    assert.equal(battle.broken.phase, 'summoning');
    assert.equal(battle.waves.length, touch ? 0 : 3);
    battle.waves.forEach((wave, i, waves) => {
      assert(!wave.guardian, 'The guardian waits for the collapse');
      if (i) {
        assert(wave.count > waves[i - 1].count);
        assert(wave.level > waves[i - 1].level);
      }
    });
    assert(battle.outdoors && !battle.marching);
    assert.equal(battle.partySize, touch ? 1 : 10);
    if (!touch) {
      await page.evaluate(() => {
        probe.game.selectPeople([]);
        probe.look(2.7);
        probe.frames(2, 0.01);
      });
      await page.screenshot({ path: `${output}/summoning.png` });
      report.shots.push('summoning');
    }
    const defenders = await page.evaluate(async withdraw => {
      const { dungeonStatus } = await import('/packages/engine/src/dungeon-siege.ts');
      const { CombatCue } = await import('/packages/engine/src/combat-events.ts');
      const town = probe.game.town;
      if (withdraw) probe.retreat();
      for (let i = 0; i < 45 && dungeonStatus(town, probe.gate).phase === 'summoning'; i++) town.advance(0.1);
      probe.frames(2);
      const boss = town.creature(town.sieges[probe.gate].guardian);
      const wave = town.events.find(e => e.cue === CombatCue.SiegeHorde && e.creature === boss.id);
      return { ...dungeonStatus(town, probe.gate), guardianLevel: boss.level, guardianVigor: boss.vigor, spawned: wave.amount };
    }, touch);
    assert.equal(defenders.phase, 'defending');
    assert(defenders.creatures > 1);
    assert.equal(defenders.guardianLevel, 10);
    if (!touch) {
      assert(defenders.spawned > battle.waves.at(-1).count);
      report.assault = { fighters: battle.partySize, fortHealth: battle.initialHealth, waves: battle.waves, guardianLevel: defenders.guardianLevel,
        guardianHealth: defenders.guardianVigor, defendersSummoned: defenders.spawned };
      // Let the figures finish emerging from the circle for the battle portrait.
      await page.evaluate(() => {
        probe.game.town.advance(0.9);
        probe.frames(3, 0.02);
      });
      await page.screenshot({ path: `${output}/guardian.png` });
      report.shots.push('guardian');
    }
    const result = await page.evaluate(async () => {
      const { dungeonStatus } = await import('/packages/engine/src/dungeon-siege.ts');
      const { game, gate } = probe, town = game.town;
      for (let i = 0; i < 1400 && dungeonStatus(town, gate).phase === 'defending'; i++) town.advance(0.1);
      probe.frames(2);
      return dungeonStatus(town, gate);
    });
    assert.equal(result.phase, touch ? 'standing' : 'sealed', JSON.stringify(result));
    assert.equal(result.health, touch ? result.maxHealth : 0);
    report[touch ? 'withdrawal' : 'victory'] = result.phase;
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)).catch(() => {});
  if (!report.passed) console.error(report.errors.join('\n'));
  else console.log('dungeon siege browser validation passed');
}
