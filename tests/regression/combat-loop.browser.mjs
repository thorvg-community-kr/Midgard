import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Real combat commands on the settlement map: skills, control groups, hold, attack-move, a dungeon, rescue and death.
const output = 'artifacts/regression/combat-loop';
const report = { errors: [], passed: false, shots: [] };
let server, browser, deadline;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'combat-loop-validation',
        configureServer(vite) {
          vite.middlewares.use('/combat-loop-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Combat loop validation</title></head><body style="margin:0;background:#11191c;overflow:hidden"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    // The real GPU: SwiftShader takes most of a second per frame in a full world.
    args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 560000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/combat-loop-probe`);
  await page.evaluate(async () => {
    const [
      { initializeWebCanvas },
      { loadNativeFonts },
      { BrowserFiles },
      { createNativeServices },
      { BrowserHost },
      { defaultLaunchOptions },
      { Activity, Calling, Role },
      { project },
      { sealable },
      { monsterEntrance },
      { Building },
      { Structure },
      { itemCatalog },
    ] = await Promise.all([
      import('/apps/web/src/native/startup-canvas.ts'),
      import('/packages/native-ui/src/index.ts'),
      import('/apps/web/src/native/browser-files.ts'),
      import('/apps/web/src/native/bootstrap.ts'),
      import('/apps/web/src/native/browser-host.ts'),
      import('/apps/web/src/native/application-contracts.ts'),
      import('/packages/engine/src/person.ts'),
      import('/packages/engine/src/geometry.ts'),
      import('/packages/engine/src/gate-seals.ts'),
      import('/packages/engine/src/town-monsters.ts'),
      import('/packages/engine/src/town-models.ts'),
      import('/packages/engine/src/building-catalog.ts'),
      import('/packages/engine/src/equipment.ts'),
    ]);
    (await import('/apps/web/src/native/guide-preferences.ts')).setGuidePreference('cards', false);
    const tvg = await initializeWebCanvas('gl'),
      element = document.createElement('canvas');
    element.style.cssText = 'display:block;width:1280px;height:800px';
    document.body.append(element);
    const fonts = await loadNativeFonts(tvg),
      files = await BrowserFiles.open('combat-loop-validation'),
      services = createNativeServices(tvg, fonts, files),
      app = services.createApplication({ ...defaultLaunchOptions(), world: 'Random', seed: 5 }),
      host = new BrowserHost(element, tvg, app, { autoStart: false, devicePixelRatio: false }),
      game = app.game,
      town = game.town,
      gate = town.map().dungeons().findIndex(sealable),
      site = town.map().dungeons()[gate];
    game.touchMode = false;
    // A new game waits for the first order; the start is not what this run is about.
    town.awaiting = false;
    site.discovered = true;
    town.open[gate] = 1;
    const camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    town.folk = [];
    for (const calling of [Calling.Warrior, Calling.Ranger, Calling.Mage, Calling.Cleric, Calling.Bard])
      town.folk.push(town.makePerson(Role.Resident, calling, monsterEntrance(site)));
    // Equip the weapon of each calling.
    const shape = (c) => (c === Calling.Warrior ? 'sword' : c === Calling.Ranger ? 'bow' : c === Calling.Mage ? 'staff' : 'mace');
    for (const p of town.folk) {
      p.level = 22;
      p.food = p.rest = p.hydration = 1;
      const item = itemCatalog
        .filter((i) => i.category === 'weapon' && i.visual === shape(p.calling) && i.minimumLevel <= p.level)
        .sort((a, b) => b.attackBonus - a.attackBonus)[0];
      if (item) {
        p.inventory[0] = { item: item.id, quantity: 1 };
        p.equipment.weapon = 1;
      }
    }
    window.gate = gate;
    window.loop = {
      app,
      host,
      game,
      now: 1,
      frame(dt = 0.05) {
        this.now += dt;
        app.dirty = true;
        host.render(this.now);
      },
      frames(count, dt = 0.05) {
        for (let i = 0; i < count; ++i) this.frame(dt);
      },
      screen(p) {
        return game.toScreen(p);
      },
      /** A screen point over the gate that the picker takes for it. */
      gateScreen() {
        const o = game.town.map().dungeons()[gate].origin;
        for (const [dx, dy] of [[1, 1], [1, 0.6], [1, 1.5], [0.6, 1], [1.4, 1], [1, 2], [0.5, 0.5], [1.5, 1.5]]) {
          const at = game.toScreen({ x: o.x + dx, y: o.y + dy });
          if (game.renderer.pick(at)?.kind === 'dungeon') return at;
        }
        return null;
      },
      member(calling) {
        return game.town.folk.find((p) => p.calling === calling);
      },
      look(p, zoom = 1.7) {
        const at = project(p.x, p.y);
        game.camera.x = at.x;
        game.camera.y = at.y;
        game.camera.zoom = zoom;
        game.invalidatePresentation();
      },
      snapshot() {
        const t = game.town;
        return {
          active: t.realmActive(),
          clock: t.clock(),
          paused: game.paused,
          status: game.status,
          chosen: [...game.chosen],
          party: t.folk.map((p) => ({
            id: p.id,
            calling: p.calling,
            downed: p.downedAt >= 0,
            task: p.task,
            activity: p.activity,
            ready: p.abilityReadyAt,
            health: p.health,
            woundDays: p.woundDays,
          })),
          fallen: t.fallen.map((f) => f.name),
          memorials: game.combatHud.memorials.length,
          autoPause: game.combatHud.autoPause?.title ?? null,
          camera: { x: game.camera.x, y: game.camera.y },
          controls: game.context.controls.map((c) => ({ id: c.id, bounds: { ...c.bounds }, enabled: c.enabled })),
          groups: Object.fromEntries([...game.army.groups].map(([digit, ids]) => [digit, [...ids]])),
          aim: game.army.aim ? { ...game.army.aim } : null,
          banners: game.army.banners.map((b) => b.title),
          sealed: t.depth[gate] >= 3,
          skills: t.folk.map((p) => ({ id: p.id, calling: p.calling, first: p.abilityReadyAt, second: p.abilityReadyAt2, holding: p.holding })),
        };
      },
    };
    loop.frames(6);
    element.focus();
  });
  const snapshot = () => page.evaluate(() => loop.snapshot());
  const frames = (count, dt = 0.05) => page.evaluate(([count, dt]) => loop.frames(count, dt), [count, dt]);
  const shot = async (name) => {
    await frames(2, 0.001);
    const path = `${output}/${name}.png`;
    await page.screenshot({ path });
    report.shots.push(path);
  };
  // A new selection slides the panel in; its buttons exist once it has settled.
  const settle = () =>
    page.evaluate(() => {
      for (let i = 0; i < 20 && loop.game.animatingUi(); ++i) loop.frame(0.05);
    });
  const click = async (id, options = {}) => {
    const control = (await snapshot()).controls.find((c) => c.id === id);
    assert(control, `Missing ${id}`);
    assert(control.enabled, `Disabled ${id}`);
    await page.mouse.click(control.bounds.x + control.bounds.w / 2, control.bounds.y + control.bounds.h / 2, options);
    await frames(2, 0.001);
    await settle();
  };
  const select = async (ids) => {
    await page.evaluate((ids) => loop.game.selectPeople(ids), ids);
    await frames(3, 0.001);
    await settle();
  };
  await page.evaluate(() => {
    const t = loop.game.town, site = t.world.sites[window.gate], o = site.origin;
    t.scout(o.x + 1, o.y + 2, 16);
    for (const [i, p] of t.folk.entries()) {
      p.position = t.grid.nearestWalkable({ x: o.x + 2 + i * 0.5, y: o.y + 4 });
      t.orderStop([p.id]);
    }
    loop.look({ x: o.x + 2, y: o.y + 4 }, 1.5);
    loop.game.selectPeople(t.folk.map(p => p.id));
  });
  await frames(6);
  await settle();
  let state = await snapshot();
  assert.equal(state.party.length, 5);
  assert.equal(state.chosen.length, 5);
  assert(state.controls.some((c) => c.id === 'skill-calling-4'), 'The card has a tab for each calling');
  await shot('abilities-party');
  // Tab cycles the card through the callings of the selection: warrior, ranger, mage.
  await page.mouse.move(640, 300);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await frames(1, 0.001);
  state = await snapshot();
  assert(state.controls.some((c) => c.id === 'ability-burst'), 'Tab shows the mage skills');
  assert(state.controls.some((c) => c.id === 'ability-frost'), 'The mage card lists the Frost Ring');
  await shot('abilities-tab-mage');
  // A party frame selects the mage alone: one ability entry with its auto-use toggle.
  const mage = state.party.find((p) => p.calling === 4);
  await select([mage.id]);
  state = await snapshot();
  assert.deepEqual(state.chosen, [mage.id]);
  assert(state.controls.some((c) => c.id === 'skill-auto-burst'));
  await shot('abilities-mage');
  await click('speed-toggle');
  await click('speed-5x');
  assert.equal(await page.evaluate(() => loop.game.gameSpeed()), 5);
  await click('speed-toggle');
  // Q quick-casts the rune at the ground under the cursor.
  const ground = await page.evaluate(() => {
    const t = loop.game.town, p = loop.member(4).position;
    loop.game.paused = true;
    t.releaseMonster(t.grid.nearestWalkable({ x: p.x + 2, y: p.y + 1 }));
    const mark = t.beasts.at(-1);
    mark.angry = true;
    loop.trainingTarget = mark.id;
    return loop.screen(mark.position);
  });
  await page.mouse.move(ground.x, ground.y);
  // Held: the rune's true radius lies on the ground under the cursor; the release casts it there.
  await page.keyboard.down('q');
  await frames(2, 0.001);
  state = await snapshot();
  assert.equal(state.aim?.slot, 0, 'Holding Q aims the Rune Burst');
  await shot('skill-aim-radius');
  await page.keyboard.up('q');
  await frames(2);
  state = await snapshot();
  assert(state.party.find((p) => p.id === mage.id).ready > state.clock, `Q cast the Rune Burst (${state.status})`);
  await page.keyboard.press('q');
  await frames(1, 0.001);
  state = await snapshot();
  assert.match(state.status, /^Rune Burst is ready in \d+ s$/);
  await shot('ability-cooldown');
  assert((await snapshot()).paused, 'Giving a combat order while paused keeps the game paused');
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => loop.game.gameSpeed()), 2, 'Casting at an enemy resumes at 2x before the rune lands');
  await click('speed-toggle');
  for (const speed of [3, 4, 5]) {
    const fast = (await snapshot()).controls.find(c => c.id === `speed-${speed}x`);
    assert(fast, 'The clock lists each speed during combat');
    await page.mouse.click(fast.bounds.x + fast.bounds.w / 2, fast.bounds.y + fast.bounds.h / 2);
    await frames(1, 0.001);
    assert.equal(await page.evaluate(() => loop.game.gameSpeed()), 2);
  }
  await click('speed-1x');
  await click('speed-toggle');
  // Backquote selects the whole party again.
  await page.keyboard.press('`');
  await frames(1, 0.001);
  assert.equal((await snapshot()).chosen.length, 5);
  // A hard blow downs the warrior: the game pauses and says so; the alert drains over them.
  await page.evaluate(() => {
    const warrior = loop.member(2), cleric = loop.member(5);
    loop.game.paused = false;
    loop.game.town.beasts = loop.game.town.beasts.filter(m => m.id !== loop.trainingTarget);

    // The cleric's Mend would get the warrior up at once; leave the rescue to the player.
    loop.game.town.setAbilityAuto([cleric.id], false);
    loop.game.town.strikeDown(warrior, 'Killed by the guardian');
    loop.look(warrior.position);
  });
  await frames(2);
  state = await snapshot();
  assert(state.paused, 'A fall pauses the game');
  assert.match(state.autoPause, /is down$/);
  const warrior = state.party.find((p) => p.calling === 2);
  assert(warrior.downed);
  assert(state.controls.some((c) => c.id === `downed-${warrior.id}`));
  await shot('downed-auto-pause');
  // Orders while paused: the alert selects the nearest helper, a right-click on the body sends them.
  await click(`downed-${warrior.id}`);
  state = await snapshot();
  assert.equal(state.chosen.length, 1, 'The alert selects the nearest ally');
  // Another ally is sent by hand: select the ranger from the party list, right-click the body.
  const helper = state.party.find((p) => p.calling === 3).id;
  await select([helper]);
  assert.deepEqual((await snapshot()).chosen, [helper]);
  const body = await page.evaluate(() => loop.screen(loop.member(2).position));
  await page.mouse.click(body.x, body.y, { button: 'right' });
  await frames(1, 0.001);
  state = await snapshot();
  assert.equal(state.party.find((p) => p.id === helper).task, 30 /* Activity.Tending */, `The helper goes to tend (${state.status})`);
  // Space resumes; the helper kneels and gets the warrior up.
  await page.keyboard.press('Space');
  await frames(2);
  assert(!(await snapshot()).paused, 'Space resumes');
  for (let i = 0; i < 30 && (await snapshot()).party.find((p) => p.id === warrior.id).downed; ++i) await frames(10, 0.1);
  state = await snapshot();
  const revived = state.party.find((p) => p.id === warrior.id);
  assert(!revived.downed && revived.woundDays > 0, 'The warrior is back up, wounded');
  // The ordinary group and movement keys remain available beside a dungeon.
  state = await snapshot();
  const id = (calling) => state.party.find((p) => p.calling === calling).id,
    [warriorId, rangerId, mageId, clericId, bardId] = [2, 3, 4, 5, 6].map(id);
  const resume = async () => {
    const now = await snapshot();
    if (!now.paused) return;
    if (now.controls.some((c) => c.id === 'memorial-close')) await click('memorial-close');
    await page.keyboard.press('Space');
    await frames(1, 0.001);
  };
  const fight = async (count, until) => {
    for (let i = 0; i < count; ++i) {
      await resume();
      await frames(4, 0.25);
      if (until && (await until())) return true;
    }
    return false;
  };
  const toScreen = (p) => page.evaluate((p) => loop.screen(p), p);
  // Group 1: the warrior and the bard hold; group 2: the ranger, the mage and the cleric who keeps them up.
  await select([warriorId]);
  await page.keyboard.press('Control+1');
  await select([bardId]);
  await page.keyboard.press('Shift+1');
  await select([rangerId]);
  await page.keyboard.press('Control+2');
  await select([mageId]);
  await page.keyboard.press('Shift+2');
  await select([clericId]);
  await page.keyboard.press('Shift+2');
  await frames(1, 0.001);
  state = await snapshot();
  assert.deepEqual(state.groups, { 1: [warriorId, bardId], 2: [rangerId, mageId, clericId] }, 'Ctrl and Shift with a digit make the groups');
  assert(state.controls.some((c) => c.id === 'group-1') && state.controls.some((c) => c.id === 'group-2'));
  await page.keyboard.press('1');
  await frames(1, 0.001);
  assert.deepEqual((await snapshot()).chosen, [warriorId, bardId], '1 selects group 1');
  const away = await page.evaluate(() => {
    loop.look({ x: loop.member(2).position.x + 12, y: loop.member(2).position.y + 9 });
    return { x: loop.game.camera.x, y: loop.game.camera.y };
  });
  await page.keyboard.press('1');
  await page.keyboard.press('1');
  await frames(1, 0.001);
  state = await snapshot();
  assert(Math.hypot(state.camera.x - away.x, state.camera.y - away.y) > 50, '1 twice looks at group 1');
  await shot('control-groups');
  const choke = await page.evaluate(() => {
    const p = loop.member(2), at = loop.game.town.grid.nearestWalkable({ x: p.position.x + 2, y: p.position.y + 2 });
    loop.look(at, 1.5);
    return at;
  });
  await frames(2, 0.001);
  await page.keyboard.press('1');
  await frames(2, 0.001);
  await settle();
  // A right-click on open ground is the plain Move.
  let at = await toScreen(choke);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await fight(20, () =>
    page.evaluate(
      (choke) =>
        [loop.member(2), loop.member(6)].every((p) => !p.moving() && Math.hypot(p.position.x - choke.x, p.position.y - choke.y) < 2.5),
      choke,
    ),
  );
  await page.keyboard.press('h');
  await frames(2, 0.001);
  state = await snapshot();
  assert(state.skills.filter((p) => p.holding).map((p) => p.id).sort().join() === [warriorId, bardId].sort().join(), 'H holds group 1');
  await shot('hold-chokepoint');
  // The ranger's and the mage's skills are timed by hand: their auto toggles go off with real clicks.
  await select([rangerId]);
  await click('skill-auto-aimed');
  await click('skill-auto-volley');
  await select([mageId]);
  await click('skill-auto-burst');
  await click('skill-auto-frost');
  // Group 2 issues an attack-move and both casters fire on the summoned horde.
  await page.keyboard.press('2');
  await page.keyboard.press('a');
  const rally = await page.evaluate(() => loop.screen(loop.game.town.grid.nearestWalkable({
    x: loop.member(4).position.x + 2, y: loop.member(4).position.y - 1,
  })));
  await page.mouse.click(rally.x, rally.y);
  await frames(2, 0.05);
  await shot('attack-move-formation');
  await page.evaluate(() => {
    const t = loop.game.town, site = t.world.sites[gate];
    for (const [i, p] of t.folk.entries()) {
      p.position = t.grid.nearestWalkable({ x: site.origin.x + 1 + i * 0.1, y: site.origin.y + 2.5 });
      p.woundDays = 0;
      p.health = 1;
    }
    // The command and skills exercise starts at the last part of a siege.
    t.sieges[gate] = { health: 36, summonAt: -1, reviveAt: -1, guardian: -1, village: t.camp().id };
    t.orderAttackDungeon(t.folk.map(p => p.id), gate);
    for (let i = 0; i < 400 && t.sieges[gate]?.health !== 0; ++i) t.advance(0.1);
    const siege = t.sieges[gate];
    if (!siege || siege.health !== 0) throw new Error('The dungeon did not fall');
    t.time = siege.summonAt;
    t.stir(0);
    loop.look(t.creature(siege.guardian).position, 1.5);
  });
  await frames(2);
  state = await snapshot();
  assert(state.controls.some(c => c.id === 'guardian-status'), 'The battle identifies the guardian outdoors');
  await shot('guardian-status');
  const pack = await page.evaluate(() => {
    const t = loop.game.town, boss = t.creature(t.sieges[gate].guardian);
    for (const p of [loop.member(3), loop.member(4)]) {
      p.abilityReadyAt = p.abilityReadyAt2 = 0;
      p.foe = boss.id;
    }
    loop.game.paused = true;
    loop.game.combatHud.autoPause = null;
    return loop.screen(boss.position);
  });
  await select([rangerId, mageId]);
  await page.mouse.move(pack.x, pack.y);
  for (const [key, slot] of [['q', 0], ['w', 1]]) {
    await page.keyboard.down(key);
    await frames(2, 0.001);
    assert.equal((await snapshot()).aim?.slot, slot);
    await page.keyboard.up(key);
    await frames(2, 0.001);
  }
  state = await snapshot();
  for (const id of [rangerId, mageId]) {
    const skills = state.skills.find(p => p.id === id);
    assert(skills.first > state.clock && skills.second > state.clock, 'Both skills fired');
  }
  await shot('skills-landed');
  await page.evaluate(() => {
    const t = loop.game.town, guardian = t.sieges[gate].guardian;
    for (const m of t.monsters()) if (m.brood === guardian && m.lair === gate) m.health = 0;
    t.stir(0);
    loop.game.paused = false;
  });
  await frames(1, 0.001);
  assert((await snapshot()).sealed);
  // A death: the bard falls and bleeds out.
  await page.evaluate(() => {
    const bard = loop.member(6);
    loop.game.town.strikeDown(bard, 'Killed by the guardian');
  });
  await frames(2);
  assert((await snapshot()).paused);
  await page.keyboard.press('Space');
  await page.evaluate(() => {
    const bard = loop.member(6);
    // Let the bleed-out run its course at once (the clock is past one full bleed-out by now).
    bard.downedAt = Math.max(0, loop.game.town.clock() - loop.game.town.bleedOutTotal(bard) - 0.5);
  });
  for (let i = 0; i < 10 && !(await snapshot()).fallen.length; ++i) await frames(2, 0.1);
  state = await snapshot();
  assert.equal(state.fallen.length, 1, 'The bard died');
  assert.equal(state.memorials, 1);
  assert(state.controls.some((c) => c.id === 'memorial'));
  await page.evaluate(() => (loop.game.paused = true));
  await shot('memorial');
  // The same moment at 1024x768, with a second resident down beside the memorial.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => {
    document.querySelector('canvas').style.cssText = 'display:block;width:1024px;height:768px';
    loop.game.town.strikeDown(loop.member(3), 'Killed by monsters');
  });
  await shot('memorial-downed-1024');
  await click('memorial-close');
  state = await snapshot();
  assert.equal(state.memorials, 0);
  assert(!state.controls.some((c) => c.id === 'memorial'));
  await shot('after-farewell');
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
  else console.log('combat loop browser validation passed');
}
