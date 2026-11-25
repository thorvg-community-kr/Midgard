import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Walks the smithy in the real app: build it beside the workbench, make a weapon and a shield there, see a recipe
// locked by the smithy's level, raise the bench and the smithy, turn a wooden weapon into a stone one, see owned
// a kind everyone carries fade with its mark and the station name who gets each item, the station looks per level,
// the unit window with a shield and armor, then the same in Korean and at phone width.
const output = 'artifacts/regression/smithy';
const report = { errors: [], passed: false, shots: [], notes: [] };
const gpu = ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'];
let server, browser, deadline;

async function open(width, height, { mobile = false, korean = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    ...(mobile ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/smithy-probe`);
  await page.evaluate(
    async ({ width, height, korean }) => {
      const [
        { initializeWebCanvas },
        { loadNativeFonts, loadKoreanFont },
        { BrowserFiles },
        { createNativeServices },
        { Camera, project },
        { Structure, Resources },
        { Activity },
        { addInventory, equipmentSlots },
        localization,
      ] = await Promise.all([
        import('/apps/web/src/native/startup-canvas.ts'),
        import('/packages/native-ui/src/index.ts'),
        import('/apps/web/src/native/browser-files.ts'),
        import('/apps/web/src/native/bootstrap.ts'),
        import('/packages/engine/src/geometry.ts'),
        import('/packages/engine/src/building-catalog.ts'),
        import('/packages/engine/src/person.ts'),
        import('/packages/engine/src/equipment.ts'),
        import('/packages/localization/src/index.ts'),
      ]);
      const tvg = await initializeWebCanvas('gl'),
        element = document.createElement('canvas');
      document.body.append(element);
      const canvas = new tvg.Canvas(element, { width, height, enableDevicePixelRatio: false }),
        fonts = await loadNativeFonts(tvg);
      if (korean) {
        await loadKoreanFont(tvg, fonts);
        localization.setLocale('KR');
      }
      const files = await BrowserFiles.open('smithy-validation'),
        game = createNativeServices(tvg, fonts, files).createPreview(5),
        town = game.town,
        origin = town.map().camp(),
        focus = project(origin.x, origin.y);
      // Raids are the combat pass's business; keep this walk about the stations.
      town.summonRaid = () => {};
      town.releaseMonster = () => {};
      game.camera = new Camera(focus.x, focus.y, 2.4);
      canvas.add(game.worldScene()).add(game.hudScene());
      const history = [],
        notify = town.notify.bind(town);
      town.notify = (text) => {
        history.push(text);
        notify(text);
      };
      const finish = (b) => {
        b.progress = 1;
        b.materials.delivered = b.materials.required.clone();
        town.changes++;
      };
      window.probe = {
        game,
        town,
        history,
        Activity,
        now: 0,
        frame(dt = 0.05, simulate = false) {
          this.now += dt;
          game.render(width, height, this.now, simulate, dt, this.now);
          canvas.update().render();
          game.worldPresented(1);
          game.takeCues();
        },
        frames(count, dt = 0.05, simulate = false) {
          for (let i = 0; i < count; ++i) this.frame(dt, simulate);
        },
        advance(seconds, until = () => false) {
          for (let t = 0; t < seconds && !until(); t += 0.1) {
            town.advance(0.1);
            game.dispatchWork();
          }
          this.frames(4);
        },
        controls() {
          return game.context.controls.map((c) => ({ id: c.id, bounds: { ...c.bounds }, enabled: c.enabled }));
        },
        /** A founded camp with a finished workbench and plenty in store. */
        settle() {
          if (!town.place(Structure.Camp, origin, 0)) return -1;
          finish(town.camp());
          town.foundSettlement?.(town.camp().id);
          town.stock().add(new Resources(60, 160, 160, 0, 0, 0, 30, 30));
          this.advance(1);
          return this.place('Workbench', 2.5);
        },
        /** Places a finished building of `name` near the camp where its door is reachable. */
        place(name, from = 3) {
          const camp = town.camp(),
            kind = Structure[name];
          for (let r = from; r < 12; r += 0.5)
            for (let a = 0; a < 24; ++a) {
              const at = { x: camp.center.x + r * Math.cos((a * Math.PI) / 12), y: camp.center.y + r * Math.sin((a * Math.PI) / 12) };
              if (!town.canPlace(kind, at, 0).ok || !town.place(kind, at, 0)) continue;
              const b = town.buildings().at(-1);
              finish(b);
              this.advance(0.5);
              return b.id;
            }
          return -1;
        },
        /** Lets the order of `id` run to its end. */
        work(id, seconds = 240) {
          this.advance(seconds, () => !town.person(id).craftItem);
          return !town.person(id).craftItem;
        },
        /** The resident with an order at the station, or -1. */
        sent(stationId) {
          return town.people().find((p) => p.health > 0 && p.craftItem && p.craftWorkshop === stationId)?.id ?? -1;
        },
        founders() {
          return town.people().filter((p) => p.health > 0).map((p) => p.id);
        },
        held(id) {
          return town.person(id).inventory.filter(Boolean).map((s) => s.item);
        },
        equip(id, items) {
          const p = town.person(id);
          for (const slot of equipmentSlots) p.equipment[slot] = -1;
          for (const item of items) {
            let index = p.inventory.findIndex((s) => s?.item === item);
            if (index < 0) {
              addInventory(p, item);
              index = p.inventory.findIndex((s) => s?.item === item);
            }
            if (!town.equipItem(id, index + 1)) return false;
          }
          return true;
        },
        lookAt(at, scale = 2.4) {
          const p = project(at.x, at.y);
          game.camera = new Camera(p.x, p.y, scale);
        },
        open(stationId, from = null) {
          if (from !== null) {
            game.selectPeople([from]);
            this.frames(2);
          }
          game.selectBuilding(stationId);
          this.lookAt(town.building(stationId).center);
          this.frames(8);
        },
      };
      element.addEventListener('pointermove', (e) => game.pointerMove(e.clientX, e.clientY));
      element.addEventListener('pointerdown', (e) => game.pointerDown(e.clientX, e.clientY, 0));
      element.addEventListener('pointerup', (e) => game.pointerUp(e.clientX, e.clientY, 0));
      probe.frames(20);
    },
    { width, height, korean },
  );
  return page;
}

try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'smithy-validation',
        configureServer(vite) {
          vite.middlewares.use('/smithy-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Smithy validation</title></head><body style="margin:0;background:#11191c"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: gpu });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 600000);

  const page = await open(1280, 800);
  const frames = (count, dt = 0.05, simulate = false) =>
    page.evaluate(([count, dt, simulate]) => probe.frames(count, dt, simulate), [count, dt, simulate]);
  const controls = (on = page) => on.evaluate(() => probe.controls());
  const click = async (id, on = page) => {
    const control = (await controls(on)).find((c) => c.id === id);
    assert(control, `Missing ${id}: ${(await controls(on)).map((c) => c.id).join(', ')}`);
    assert(control.enabled, `${id} is disabled`);
    await on.mouse.click(control.bounds.x + control.bounds.w / 2, control.bounds.y + control.bounds.h / 2);
    await on.evaluate(() => probe.frames(6));
  };
  const shot = async (name, caption, on = page) => {
    await on.mouse.move(5, 400);
    await on.evaluate(() => probe.frames(2));
    await on.screenshot({ path: `${output}/${name}.png` });
    report.shots.push({ file: `${name}.png`, caption });
  };

  // 1. A camp and a workbench; the smithy is placed beside them and stands.
  const bench = await page.evaluate(() => probe.settle());
  assert(bench >= 0, 'a workbench stands');
  const [a, b] = await page.evaluate(() => probe.founders());
  const smith = await page.evaluate(() => probe.place('Weaponsmith'));
  assert(smith >= 0, 'a smithy stands');
  await page.evaluate((id) => probe.open(id, null), smith);
  await shot('01-smithy-level-1', 'A new smithy: level 1 lists the wooden weapons it can make now, and nothing of stone or iron.');
  const listed = (await controls()).map((c) => c.id).filter((id) => /^station-(craft|upgrade)-[a-z]/.test(id));
  assert.deepEqual(
    listed,
    ['wooden-sword', 'wooden-club'].map((id) => `station-craft-${id}`),
    'a founding smithy lists the weapons available before the training yard, watchtower and mage tower',
  );

  // 2. The station picks who gets an item: selecting a resident first changes nothing it lists.
  await page.evaluate(([smith, b]) => probe.open(smith, b), [smith, b]);
  const sent = (station) => page.evaluate((station) => probe.sent(station), station);
  assert(!(await controls()).some((c) => c.id.startsWith('station-crafter-')), 'no crafter selector');
  await shot('02-station-names-receiver', 'Each row names who gets the item: the nearest resident who has none. There is no crafter to pick.');

  // 3. A wooden sword, then a shield, from the panel: each goes to whoever the row named.
  await click('station-craft-wooden-sword');
  const swordsman = await sent(smith);
  assert(swordsman >= 0, 'someone was sent to make the sword');
  assert.equal(await page.evaluate((id) => probe.work(id), swordsman), true, 'the sword is made');
  assert((await page.evaluate((id) => probe.held(id), swordsman)).includes('wooden-sword'), 'the sword is in its maker\'s pack');
  // The same row ordered again goes to another resident, who has none yet.
  await page.evaluate((smith) => probe.open(smith), smith);
  await click('station-craft-wooden-sword');
  const second = await sent(smith);
  assert(second >= 0 && second !== swordsman, 'the second sword goes to someone else');
  assert.equal(await page.evaluate((id) => probe.work(id), second), true, 'the second sword is made');
  await page.evaluate((smith) => probe.open(smith), smith);
  await click(`station-group-shields-${smith}`);
  await click('station-craft-shield');
  const shielded = await sent(smith);
  assert(shielded >= 0, 'someone was sent to make the shield');
  assert.equal(await page.evaluate((id) => probe.work(id), shielded), true, 'the shield is made');
  assert((await page.evaluate((id) => probe.held(id), shielded)).includes('shield'), 'the shield is in its maker\'s pack');
  await page.evaluate(() => {
    for (const id of probe.founders()) if (!probe.held(id).includes('wooden-sword')) probe.equip(id, ['wooden-sword']);
  });
  await page.evaluate((smith) => probe.open(smith), smith);
  await click(`station-group-weapons-${smith}`);
  assert(!(await controls()).some((c) => c.id === 'station-craft-wooden-sword'), 'nobody is left to take a sword');
  await shot('03-owned-fades', 'Every founder carries a sword: its row fades, marked Everyone has one, and says what a better one waits for.');

  // 4. Raise the workbench: the nearest free resident works at it, then the stone tools open.
  await page.evaluate((bench) => probe.open(bench), bench);
  await click(`station-upgrade-${bench}`);
  const raiser = await sent(bench);
  assert(raiser >= 0, 'someone was sent to raise the bench');
  await page.evaluate((a) => probe.advance(60, () => probe.town.person(a).activity === probe.Activity.Crafting), raiser);
  await page.evaluate((bench) => probe.lookAt(probe.town.building(bench).center, 4), bench);
  await frames(20, 0.1, true);
  await shot('04-bench-upgrading', 'The workbench being upgraded: the bar over it, nothing spent until it is done.');
  assert.equal(await page.evaluate((a) => probe.work(a), raiser), true, 'the bench upgrade is done');
  assert.equal(await page.evaluate((bench) => probe.town.building(bench).variant, bench), 1, 'the bench is level 2');
  await page.evaluate((bench) => probe.open(bench), bench);
  await shot('05-bench-level-2', 'Workbench level 2: the sickle and the knife are new on the list; iron is not listed yet.');

  // 5. Raise the smithy: it needs a quarry and four residents first.
  await page.evaluate(([smith, b]) => probe.open(smith, b), [smith, b]);
  await shot('06-smithy-needs', 'The smithy asks for a quarry and more residents before stone.');
  await page.evaluate(() => {
    const t = probe.town,
      q = t.makePerson(0, 0, t.camp().door()),
      r = t.makePerson(0, 0, t.camp().door());
    for (const p of [q, r]) {
      p.home = p.village = t.camp().village;
      t.folk.push(p);
    }
    probe.place('Quarry', 5);
  });
  const quarryStands = await page.evaluate(() => probe.town.buildings().some((b) => b.kind === 10 && b.built()));
  report.notes.push(`quarry placed: ${quarryStands}`);
  if (!quarryStands) {
    // Stand one in by hand where no rock is near: what counts is that it exists.
    await page.evaluate(async () => {
      const { Building } = await import('/packages/engine/src/town-models.ts');
      const t = probe.town,
        camp = t.camp(),
        q = new Building(t.nextId++, 10, { x: camp.center.x - 8, y: camp.center.y + 8 }, 0, 0);
      q.village = camp.village;
      t.placed.push(q);
      t.changes++;
    });
  }
  await page.evaluate(([smith, b]) => probe.open(smith, b), [smith, b]);
  await click(`station-upgrade-${smith}`);
  const smithRaiser = await sent(smith);
  assert(smithRaiser >= 0, 'someone was sent to raise the smithy');
  assert.equal(await page.evaluate((b) => probe.work(b), smithRaiser), true, 'the smithy upgrade is done');
  assert.equal(await page.evaluate((smith) => probe.town.building(smith).variant, smith), 1, 'the smithy is level 2');

  // 6. The flint sword is for level 3: until then the row keeps the wooden one and says what it waits for.
  // The newcomers get wooden swords too, so nobody is left for a first make.
  await page.evaluate(() => {
    for (const id of probe.founders()) if (!probe.held(id).includes('wooden-sword')) probe.equip(id, ['wooden-sword']);
  });
  await page.evaluate(([smith, b]) => probe.open(smith, b), [smith, b]);
  assert(!(await controls()).some((c) => c.id.endsWith('flint-sword')), 'no flint sword for a level 1 wielder');
  await shot('07-waits-for-level', 'Smithy level 2, wielder level 1: the sword row keeps the wooden sword and says the upgrade comes at level 3.');
  // At level 3 the row becomes the flint sword, marked New, as an upgrade of the one in hand.
  await page.evaluate((b) => {
    probe.town.person(b).level = 3;
    probe.frames(4);
  }, swordsman);
  await shot('07-upgrade-offered', 'Level 3: the sword row is now the flint sword, marked New, an upgrade of the wooden sword of the one resident strong enough.');
  await click('station-upgrade-flint-sword');
  assert.equal(await sent(smith), swordsman, 'the upgrade goes to the resident who can use it');
  assert.equal(await page.evaluate((b) => probe.work(b), swordsman), true, 'the upgrade is done');
  const after = await page.evaluate((b) => probe.held(b), swordsman);
  assert(after.includes('flint-sword') && !after.includes('wooden-sword'), after.join());
  report.notes.push('notices: ' + (await page.evaluate(() => probe.history.slice(-4).join(' | '))));

  // 7. The station looks per level, in daylight, each up close.
  const looks = await page.evaluate(([bench, smith]) => {
    const out = { Workbench: [bench], Weaponsmith: [smith] };
    for (const name of ['Workbench', 'Weaponsmith'])
      for (const level of [1, 3]) {
        const id = probe.place(name, 6);
        if (id >= 0) {
          const b = probe.town.building(id);
          b.variant = level - 1;
          b.version++;
          out[name].push(id);
        }
      }
    probe.town.editHour(12);
    probe.town.changes++;
    probe.game.selectPeople([]);
    probe.game.selected = -1;
    return out;
  }, [bench, smith]);
  report.notes.push('look ids: ' + JSON.stringify(looks));
  for (const name of ['Workbench', 'Weaponsmith'])
    for (const id of looks[name]) {
      const level = await page.evaluate((id) => {
        const b = probe.town.building(id);
        probe.lookAt(b.center, 6);
        probe.frames(12);
        return b.variant + 1;
      }, id);
      const label = name === 'Workbench' ? 'workbench' : 'smithy';
      await shot(`08-${label}-level-${level}`, `The ${label} at level ${level}, in the world.`);
    }

  // 8. The unit window: shield in the off hand, armor worn, tools from the pack.
  await page.evaluate((a) => {
    const t = probe.town;
    t.person(a).level = 3;
    probe.equip(a, ['wooden-club', 'shield', 'studded-armor']);
    t.person(a).activity = probe.Activity.Idle;
    probe.game.selectPeople([a]);
    probe.game.rosterOpen = true;
    probe.game.rosterTab = 'units';
    probe.game.rosterSelected = 'units:' + a;
    probe.game.equipmentTab = 'equipment';
    probe.frames(10);
  }, a);
  await shot('09-unit-window-shield-armor', 'The unit window: a club and a shield in hand, stone-studded armor worn, tools working from the pack.');
  await page.evaluate(() => {
    probe.game.rosterOpen = false;
    probe.frames(4);
  });
  await page.context().close();

  // 9. Korean.
  const ko = await open(1280, 800, { korean: true });
  const koSmith = await ko.evaluate(() => {
    probe.settle();
    const id = probe.place('Weaponsmith');
    const [a] = probe.founders();
    probe.equip(a, ['wooden-sword']);
    probe.open(id, a);
    return id;
  });
  assert(koSmith >= 0);
  const reading = await ko.evaluate(async (station) => {
    const { gearStats, attackPreview } = await import('/packages/engine/src/gear-stats.ts');
    const { translate } = await import('/packages/localization/src/index.ts');
    const { item, who } = probe.town.craftOffers(station).find(offer => offer.item.id === 'wooden-sword');
    who.name = 'Bryn';
    const c = probe.game.context, original = c.text, visible = new Set();
    c.text = function (box, words, ...style) {
      for (const field of translate(words).split(' · ')) visible.add(field);
      original.call(this, box, words, ...style);
    };
    try { probe.frames(3); } finally { c.text = original; }
    return { visible: [...visible], expected: [...gearStats(item), attackPreview(who, item)]
      .flatMap(words => words.split(' · ')).map(translate) };
  }, koSmith);
  for (const stat of reading.expected) {
    assert(!/[A-Za-z]/.test(stat), stat);
    assert(reading.visible.includes(stat), `missing localized stat: ${stat}`);
  }
  await shot('10-korean-smithy', 'The smithy panel in Korean.', ko);
  const [foundry, worker] = await ko.evaluate(() => {
    const id = probe.place('Foundry'), [resident] = probe.founders();
    Object.assign(probe.town.stock(), { ironOre: 4, frostwood: 2, bones: 3, cinderOre: 2, hides: 2 });
    probe.open(id, resident);
    return [id, resident];
  });
  assert(foundry >= 0);
  await shot('10a-korean-foundry', 'The foundry lists each ingredient and the village stock in Korean.', ko);
  for (const [id, product] of [['iron-ingot', 'ironIngot'], ['bound-frostwood', 'boundFrostwood'], ['embersteel', 'embersteel']]) {
    await click(`station-craft-${id}`, ko);
    // The foundry sends its nearest free resident, whoever was selected.
    assert(await ko.evaluate((f) => probe.sent(f) >= 0 && probe.work(probe.sent(f)), foundry));
    assert.equal(await ko.evaluate((k) => probe.town.stock()[k], product), 1);
    await ko.evaluate(([f, w]) => probe.open(f, w), [foundry, worker]);
  }
  assert.deepEqual(await ko.evaluate(() => {
    const { ironIngot, bones, cinderOre, ironOre } = probe.town.stock();
    return [ironIngot, bones, cinderOre, ironOre];
  }), [0, 0, 0, 2]);
  await ko.evaluate(([s, w]) => probe.open(s, w), [koSmith, worker]);
  await click(`station-group-gear-${koSmith}`, ko);
  await click('station-craft-boots', ko);
  assert(await ko.evaluate((w) => probe.work(w), worker));
  assert.equal(await ko.evaluate((w) => {
    const p = probe.town.person(w);
    return p.inventory[p.equipment.feet - 1]?.item;
  }, worker), 'boots');
  await ko.context().close();

  // 10. Phone width.
  const phone = await open(390, 844, { mobile: true });
  const phoneSmith = await phone.evaluate(() => {
    probe.settle();
    const id = probe.place('Weaponsmith');
    const [a] = probe.founders();
    probe.equip(a, ['wooden-sword']);
    probe.open(id, a);
    return id;
  });
  const fits = await phone.evaluate(() =>
    probe.controls().filter((c) => c.id.startsWith('station-') && (c.bounds.x < 0 || c.bounds.x + c.bounds.w > 390)),
  );
  assert.deepEqual(fits, [], 'every station control fits at phone width');
  assert(phoneSmith >= 0);
  await shot('11-phone-smithy', 'The smithy panel at phone width.', phone);
  const phoneFoundry = await phone.evaluate(() => {
    const id = probe.place('Foundry'), [worker] = probe.founders();
    probe.town.stock().ironOre = 2;
    probe.open(id, worker);
    return id;
  });
  assert(phoneFoundry >= 0);
  const refineButtons = (await controls(phone)).filter((c) => c.id.startsWith('station-craft-'));
  assert(refineButtons.some((c) => c.id === 'station-craft-iron-ingot' && c.enabled));
  assert(refineButtons.every((c) => c.bounds.x >= 0 && c.bounds.x + c.bounds.w <= 390));
  await shot('12-phone-foundry', 'The foundry recipes at phone width.', phone);
  await phone.context().close();

  const items = report.shots
    .map((s) => `<figure><img src="${s.file}" alt=""><figcaption>${s.file}: ${s.caption}</figcaption></figure>`)
    .join('\n');
  await writeFile(
    `${output}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Smithy walk</title><style>body{background:#11191c;color:#e8e2d0;font:14px sans-serif;margin:16px}figure{margin:0 0 24px}img{max-width:100%;border:1px solid #444}</style></head><body><h1>Smithy walk</h1>${items}</body></html>`,
  );
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
  else console.log('smithy browser validation passed', report.shots.length, 'shots');
}
