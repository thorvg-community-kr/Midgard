import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import '../../scripts/prepare-audio-worklet.mjs';

const renderer = process.argv.find((arg) => arg.startsWith('--renderer='))?.slice(11) ?? 'gl';
assert(['gl'].includes(renderer));
const output = 'artifacts/regression/prayer' + (renderer === 'gl' ? '' : '/' + renderer);
const report = { renderer, cases: [], errors: [], passed: false };
let server, browser, deadline;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'prayer-validation',
        configureServer(vite) {
          vite.middlewares.use('/prayer-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Offering validation</title></head><body style="margin:0;background:#11191c"></body></html>',
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
  deadline = setTimeout(() => void browser.close().catch(() => {}), 900000);
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, hasTouch: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/prayer-probe`);
  const startProbe = () => page.evaluate(async (renderer) => {
    const [
      { initializeWebCanvas },
      { loadNativeFonts, loadKoreanFont, Key },
      { BrowserFiles },
      { createNativeServices },
      { Town },
      { WorldMap },
      { Layer, Terrain },
      { Building },
      { Resources, Structure },
      { Person, Role, Calling, Race, Activity },
      { likenessOf },
      { Camera, project, point },
      { copyNative },
      { Weather },
      { encodeTown, decodeTown },
      { Cue },
      { offeringClipWindows },
      { BrowserSoundDevice, disposeNativeAudio },
      { setLocale, translate },
      { altarCap },
      { setMotionPreference },
    ] = await Promise.all([
      import('/apps/web/src/native/startup-canvas.ts'),
      import('/packages/native-ui/src/index.ts'),
      import('/apps/web/src/native/browser-files.ts'),
      import('/apps/web/src/native/bootstrap.ts'),
      import('/packages/engine/src/town.ts'),
      import('/packages/engine/src/world-map.ts'),
      import('/packages/engine/src/world-types.ts'),
      import('/packages/engine/src/town-models.ts'),
      import('/packages/engine/src/building-catalog.ts'),
      import('/packages/engine/src/person.ts'),
      import('/packages/engine/src/character-cast.ts'),
      import('/packages/engine/src/geometry.ts'),
      import('/packages/engine/src/native-copy.ts'),
      import('/packages/engine/src/climate.ts'),
      import('/packages/engine/src/save-game.ts'),
      import('/packages/native-audio/src/sound-types.ts'),
      import('/packages/native-audio/src/sound-catalog.ts'),
      import('/packages/native-audio/src/browser-audio.ts'),
      import('/packages/localization/src/index.ts'),
      import('/packages/engine/src/altar-cap.ts'),
      import('/apps/web/src/native/motion-preference.ts'),
    ]);
    const tvg = await initializeWebCanvas(renderer),
      element = document.createElement('canvas');
    document.body.append(element);
    element.tabIndex = 0;
    element.style.touchAction = 'none';
    const canvas = new tvg.Canvas(element, { width: 1024, height: 768, enableDevicePixelRatio: false }),
      fonts = await loadNativeFonts(tvg),
      files = await BrowserFiles.open('prayer-validation'),
      services = createNativeServices(tvg, fonts, files),
      game = services.createPreview(5),
      sound = new BrowserSoundDevice();
    const map = WorldMap.generate(5, 32, 32);
    map.ymir = map.fire = null;
    map.sites = [];
    map.stream = { path: [], width: [] };
    for (const layer of map.layers) layer.fill(0.4);
    map.layer(Layer.Land).fill(1);
    map.layer(Layer.Ridge).fill(-1);
    for (let y = 0; y < 32; ++y)
      for (let x = 0; x < 32; ++x)
        Object.assign(map.at(x, y), { terrain: Terrain.Grass, trees: 0, revealed: true, dungeon: -1 });
    map.reveal(16, 16, 100);
    const base = new Town(map, 32, false);
    base.placed = [
      new Building(0, Structure.Camp, point(10, 10), 0, 0),
      new Building(1, Structure.Shrine, point(14, 14), 0, 0),
    ];
    base.nextId = 2;
    base.migrateSettlements();
    Object.assign(base.stock(), new Resources(60, 60, 60, 60, 60, 60, 0, 0, 60));
    base.folk = [0, 1].map((id) => {
      const p = new Person(
        id,
        ['Eira', 'Halvor'][id],
        Role.Resident,
        Calling.Settler,
        Race.Human,
        id === 0 ? 13880 : 35710,
        point(12 + id, 13),
      );
      p.level = id === 0 ? 8 : 10;
      p.home = p.village = 0;
      p.food = p.rest = p.hydration = p.health = 1;
      p.stress = 0;
      p.autoMode = false;
      return p;
    });
    base.nextPerson = 2;
    base.wildlifeDay = base.days;
    base.editHour(12);
    base.tick(0);
    const focus = project(12, 12);
    window.prayerProbe = {
      game,
      canvas,
      tvg,
      files,
      now: 0,
      width: 1024,
      height: 768,
      heard: [],
      portraitBounds: null,
      editorLabels: new Set(),
      translate,
      disposeNativeAudio,
      async listen() {
        await sound.ready;
        const analyser = sound.session.context.createAnalyser();
        analyser.fftSize = 32768;
        sound.node.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        this.audible = () => {
          analyser.getFloatTimeDomainData(samples);
          return samples.some((sample) => Math.abs(sample) > 0.001);
        };
        const starts = new Set();
        return ['OfferFood', 'OfferWater', 'OfferBones', 'OfferGold', 'OfferStone', 'OfferAccepted'].filter((name) => {
          const [{ source, from, to }] = offeringClipWindows[Cue[name]];
          const bank = sound.session.library.clip(source, 0);
          const first = Math.round(from * bank.rate), end = Math.round(to * bank.rate);
          const samples = bank.pcm?.subarray(first, end);
          const distinct = !starts.has(first);
          starts.add(first);
          return !distinct || end > bank.frames || !samples?.some((sample) => sample !== 0);
        });
      },

      async setLocale(locale) {
        if (locale === 'KR') await loadKoreanFont(tvg, fonts);
        setLocale(locale);
        game.invalidatePresentation?.();
      },
      altarCap,
      setMotionPreference,
      fillTo(count) {
        while (game.town.population() < count) {
          const p = copyNative(game.town.people()[0]);
          p.id = game.town.nextPerson++;
          game.town.folk.push(p);
        }
      },
      addWorkSite() {
        const site = new Building(game.town.nextId++, Structure.Tent, point(19, 16), 0, 0);
        site.progress = 0.5;
        site.village = 0;
        game.town.placed.push(site);
        game.town.awaiting = false;
      },
      frame(dt = 0) {
        this.now += dt;
        this.editorLabels.clear();
        game.render(this.width, this.height, this.now, true, 0.25, this.now);
        canvas.update().render();
        // Measure the offering alone so a button click or background music cannot satisfy the audio check.
        for (const cue of game.takeCues()) {
          const name = Cue[cue.cue];
          if (!name.startsWith('Offer')) continue;
          this.heard.push(name);
          sound.play(cue);
        }
      },
      reset(weather, hour, paused = false, altarAngle = 0) {
        game.town = copyNative(base);
        game.town.building(1).angle = altarAngle;
        game.selected = -1;
        game.chosen = [];
        game.noticeFeed = [];
        game.town.editHour(hour);
        game.setSpeed(1);
        game.paused = paused;
        game.prayer = null;
        game.camera = new Camera(focus.x, focus.y, 2.8);
        game.renderer.invalidateMap();
        game.selectBuilding(1);
        for (let i = 0; i < 12; ++i) this.frame(0.05);
        // Freeze an actual climate checkpoint. Advancing spring time would
        // legitimately convert forced snow to rain before the modal opens.
        game.town.sky.force(Weather[weather], 0.9);
        if (weather === 'Snow') Object.assign(game.town.sky.now(), { snow: 0.7, temperature: -8 });
      },
      snapshot() {
        const d = game.prayer;
        const birth = game.town.devotionEvents().at(-1);
        const born = birth && game.town.person(birth.person);
        const figure = born && game.renderer.figures.get(born.id);
        return {
          clock: game.town.clock(),
          stock: { ...game.town.stock() },
          count: game.town.population(),
          paused: game.paused,
          open: !!d,
          editing: !!d?.editing,
          chosen: [...game.chosen],
          camera: { ...game.camera },
          groundEffects: game.renderer.combatGround.children.length,
          dice: game.town.dice,
          offering: d && { ...d.offering },
          draft: d && d.draft.identity(),
          likeness: d && likenessOf(d.draft.person),
          born: born
            ? {
                id: born.id,
                name: born.name,
                calling: born.calling,
                level: born.level,
                birthStrength: born.birthStrength,
                birthVitality: born.birthVitality,
                look: born.customLook,
                likeness: likenessOf(born),
                inventory: born.inventory,
                equipment: born.equipment,
                visible: game.renderer.visible(born.position),
                moved: Math.hypot(born.position.x - birth.position.x, born.position.y - birth.position.y),
                bodyOffset: figure?.parts.body?.matrix[5],
                risingFromGround: figure?.paint.children.some((node) =>
                  node.clipper && node.children?.includes(figure.parts.body)),
              }
            : null,
          tasks: game.town
            .people()
            .slice(0, 2)
            .map((p) => ({ id: p.id, task: p.task, site: p.taskSite, position: { ...p.position } })),
          controls: game.context.controls.map((c) => ({
            id: c.id,
            bounds: { ...c.bounds },
            enabled: c.enabled,
            ...(d?.editing && c.enabled && c.focusable ? {
              hit: game.context.hit(c.bounds.x + c.bounds.w / 2, c.bounds.y + c.bounds.h / 2)?.id ?? null,
            } : {}),
          })),
        };
      },
      encodeTown,
      savedAppearance(id) {
        const resident = decodeTown(encodeTown(game.town), (map) => new Town(map, 32, false, true)).person(id);
        return { name: resident.name, look: resident.customLook };
      },
    };
    const paint = game.context.paint.bind(game.context);
    game.context.paint = (key, make) => {
      if (game.prayer?.editing && (key.startsWith('["expedition-face",') || key.startsWith('["resident-body",')))
        prayerProbe.portraitBounds = JSON.parse(key).at(-1);
      if (game.prayer?.editing && key.startsWith('["T",')) prayerProbe.editorLabels.add(JSON.parse(key).at(-1));
      paint(key, make);
    };
    canvas.add(game.worldScene()).add(game.hudScene());
    const event = (type, e, extra = {}) => {
      game.handlePrayerEvent({
        type,
        x: e.clientX ?? 0,
        y: e.clientY ?? 0,
        button: e.button === 0 ? 1 : 2,
        pointerType: e.pointerType,
        key: Key[e.key?.replace(/^Arrow/, '')] ?? Key.Unknown,
        text: '',
        shift: !!e.shiftKey,
        ...extra,
      });
      prayerProbe.frame();
    };
    element.addEventListener('pointermove', (e) => {
      if (game.prayer) event('PointerMove', e);
      else game.pointerMove(e.clientX, e.clientY);
    });
    element.addEventListener('pointerdown', (e) => {
      if (game.prayer) event('PointerDown', e);
      else game.pointerDown(e.clientX, e.clientY, 0);
    });
    element.addEventListener('pointerup', (e) => {
      if (game.prayer) event('PointerUp', e);
      else {
        game.pointerUp(e.clientX, e.clientY, 0);
        prayerProbe.frame();
      }
    });
    element.addEventListener('wheel', (e) => {
      e.preventDefault();
      game.wheel(e.clientX, e.clientY, -Math.sign(e.deltaY));
      prayerProbe.frame();
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      e.preventDefault();
      event('KeyDown', e);
      if (e.key.length === 1) event('Text', e, { text: e.key });
    });
  }, renderer);
  await startProbe();
  const stopProbe = () => page.evaluate(async () => {
    await prayerProbe.disposeNativeAudio();
    prayerProbe.canvas.remove();
    prayerProbe.game.dispose();
    prayerProbe.canvas.destroy();
    await prayerProbe.files.close();
    prayerProbe.tvg.term();
  });
  const frame = (dt) => page.evaluate((dt) => prayerProbe.frame(dt), dt);
  const advance = (seconds) => page.evaluate((seconds) => {
    const frames = Math.ceil(seconds * 30);
    for (let i = 0; i < frames; ++i) prayerProbe.frame(seconds / frames);
  }, seconds);
  const snapshot = () => page.evaluate(() => prayerProbe.snapshot());
  const resize = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.evaluate(([w, h]) => {
      prayerProbe.width = w;
      prayerProbe.height = h;
      prayerProbe.canvas.resize(w, h);
      prayerProbe.frame();
    }, [width, height]);
  };
  const hit = async (suffix, expectedEnabled = true) => {
    const state = await snapshot(),
      control = state.controls.find((c) => c.id.endsWith(suffix));
    assert(control, `Missing ${suffix}: ${state.controls.map((c) => c.id).join(', ')}`);
    assert.equal(control.enabled, expectedEnabled, `Enabled state for ${suffix}`);
    return [control.bounds.x + control.bounds.w / 2, control.bounds.y + control.bounds.h / 2];
  };
  const click = async (suffix, expectedEnabled = true) => {
    await page.mouse.click(...await hit(suffix, expectedEnabled));
    await frame(0);
  };
  const tap = async (suffix) => {
    await page.touchscreen.tap(...await hit(suffix));
    await frame(0);
  };
  const picturePixels = async () => {
    const { x, y, w, h } = await page.evaluate(() => prayerProbe.portraitBounds);
    return page.screenshot({ clip: { x, y, width: w, height: h } });
  };
  const fill = async (key, value) => {
    await click(`offering-${key}`);
    await page.keyboard.press('Home');
    for (let i = 0; i < 4; ++i) await page.keyboard.press('Delete');
    await page.keyboard.type(String(value));
    await frame(0);
  };
  const reset = (paused = false) => page.evaluate((paused) => prayerProbe.reset('Clear', 12, paused), paused);
  const takeSounds = () => page.evaluate(() => prayerProbe.heard.splice(0));
  const waitForSound = (audible) =>
    page.waitForFunction((want) => prayerProbe.audible() === want, audible, { timeout: 5000 });
  const enabled = (state, suffix) => state.controls.find((control) => control.id.endsWith(suffix))?.enabled;
  const inWorld = (state) => {
    assert(!state.open, 'Confirmation immediately unveils the settlement');
    assert.deepEqual(state.chosen, [state.born.id], 'The new resident is already selected');
    assert(!state.controls.some((c) => c.id.startsWith('prayer-')));
    assert(state.born.visible, 'The arrival stands on visible ground');
  };
  const clearView = async () => {
    const { feet, head, hudAtFace, picked, panels } = await page.evaluate(() => {
      const g = prayerProbe.game;
      const resident = g.town.person(g.chosen[0]);
      g.worldPresented(1);
      const geometry = g.renderer.selectionGeometry({ kind: 'person', id: resident.id });
      if (!geometry) throw Error('The resident is missing from the rendered world');
      const feet = geometry.foot;
      const head = { x: feet.x, y: feet.y - geometry.bounds.h * 0.7 };
      const hudAtFace = g.context.hit(head.x, head.y)?.id;
      const picked = g.renderer.pick(head);
      const panels = g.context.controls.filter((c) => /guide-card|objective|notice|sky-hud|person-panel/.test(c.id) && c.bounds.w > 100)
        .map((c) => ({ id: c.id, bounds: { ...c.bounds } }));
      return { feet, head, hudAtFace, panels, picked: picked?.kind === 'person' && picked.id === resident.id };
    });
    const { width, height } = page.viewportSize();
    assert(head.x > 0 && head.x < width && head.y > 0 && feet.y < height, 'The full resident fits on screen');
    assert(!hudAtFace, `The resident at ${Math.round(head.x)},${Math.round(head.y)} is covered by ${hudAtFace}: ${JSON.stringify(panels)}`);
    assert(picked, `The resident can be picked at ${Math.round(head.x)},${Math.round(head.y)}`);
  };
  await reset(true);
  await click('altar-pray');
  const before = await snapshot();
  assert(before.open && before.paused);
  assert.equal(before.offering.food, 4);
  assert(enabled(before, 'prayer-confirm'));
  assert.deepEqual(await takeSounds(), []);
  assert.deepEqual(await page.evaluate(() => prayerProbe.listen()), [], 'All six offering sounds have distinct, audible windows in the decoded bank');
  assert.equal(await page.evaluate(() => prayerProbe.audible()), false);
  const materials = { food: 'Food', water: 'Water', bones: 'Bones', gold: 'Gold', stone: 'Stone' };
  for (const [key, material] of Object.entries(materials)) {
    await waitForSound(false);
    await click(`offering-more-${key}`);
    assert.deepEqual(await takeSounds(), ['Offer' + material]);
    await waitForSound(true);
  }
  for (const [key, material] of Object.entries(materials)) {
    await waitForSound(false);
    await click(`offering-less-${key}`);
    assert.deepEqual(await takeSounds(), ['OfferTake' + material], `Removing ${key} sounds once`);
    await waitForSound(true);
  }
  assert.deepEqual((await snapshot()).offering, before.offering);
  await click('offering-less-bones', false);
  await page.mouse.click(3, 3);
  assert.deepEqual(await takeSounds(), []);

  await fill('water', 12);
  assert.deepEqual(await takeSounds(), ['OfferWater', 'OfferWater']);
  await page.keyboard.press('Home');
  await page.keyboard.press('Delete');
  assert.equal((await snapshot()).offering.water, 2);
  assert.deepEqual(await takeSounds(), ['OfferTakeWater'], 'Deleting a digit removes ten water with one sound');
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  assert.equal((await snapshot()).offering.water, 0);
  assert.deepEqual(await takeSounds(), ['OfferTakeWater']);
  await page.keyboard.press('Backspace');
  await page.keyboard.type('0');
  await page.keyboard.press('Home');
  await page.keyboard.press('Delete');
  assert.deepEqual(await takeSounds(), [], 'Empty and zero are the same quantity');
  await click('offering-bundle-stone');
  assert.deepEqual(await takeSounds(), ['OfferStone']);
  await click('offering-less-stone');
  await frame(0.25);
  assert.deepEqual(await takeSounds(), ['OfferTakeStone']);
  await fill('water', 2);
  assert.deepEqual(await takeSounds(), ['OfferWater']);
  await fill('water', 1);
  assert.deepEqual(await takeSounds(), ['OfferTakeWater', 'OfferWater'], 'Replacing a quantity sounds on clear and refill');
  assert.deepEqual((await snapshot()).stock, before.stock);
  report.cases.push('All five materials sound when added or removed. Buttons and keyboard edits sound once per change, zero stays quiet, and the real mixer outputs audio.');
  await fill('food', 3);
  assert(!enabled(await snapshot(), 'prayer-confirm'));
  await fill('food', 17);
  assert(!enabled(await snapshot(), 'prayer-confirm'));
  await fill('food', 4);
  await takeSounds();
  const beforeCancel = await page.evaluate(() => prayerProbe.encodeTown(prayerProbe.game.town));
  await click('prayer-customize');
  await click('prayer-look-random');
  await click('prayer-beard-next');
  await click('prayer-name-random');
  await page.keyboard.press('Escape');
  assert(!(await snapshot()).editing && (await snapshot()).open);
  await click('prayer-cancel');
  assert.equal(await page.evaluate(() => prayerProbe.encodeTown(prayerProbe.game.town)), beforeCancel);
  assert((await snapshot()).paused);
  assert.deepEqual((await snapshot()).camera, before.camera, 'Cancelling leaves the camera at the altar');
  assert.deepEqual(await takeSounds(), []);
  report.cases.push('Explicit cancel and editor back preserve the settlement and its dice.');

  await reset();
  await page.evaluate(() => prayerProbe.addWorkSite());
  await click('altar-pray');
  const basicDraft = (await snapshot()).draft;
  await waitForSound(false);
  await click('prayer-confirm');
  const basic = await snapshot();
  inWorld(basic);
  assert.deepEqual(await takeSounds(), ['OfferFood', 'OfferAccepted']);
  await waitForSound(true);
  assert.equal(basic.count, before.count + 1);
  assert.equal(basic.born.level, 4);
  assert.equal(basic.born.calling, 0);
  assert.equal(basic.born.birthStrength + basic.born.birthVitality, 1);
  assert.equal(basic.stock.food, before.stock.food - 4);
  assert.deepEqual(basic.born.look, basicDraft.look);
  assert(basic.born.inventory.every((item) => item === null));
  assert(Object.values(basic.born.equipment).every((slot) => slot === -1));
  assert(!basic.paused);
  await advance(0.12);
  const moving = (await snapshot()).camera;
  await page.mouse.move(500, 330);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction((z) => prayerProbe.game.camera.zoom < z, moving.zoom);
  const manual = (await snapshot()).camera;
  await advance(0.46);
  const liveRise = await snapshot();
  assert(liveRise.born.risingFromGround, `The working village keeps the 1× reveal on its resident (moved ${liveRise.born.moved})`);
  await advance(0.34);
  assert.deepEqual((await snapshot()).camera, manual, 'Manual zoom takes over the arrival shot immediately');
  report.cases.push('Default creation costs four food and selects the level-four settler.');

  await reset();
  await page.evaluate(() => {
    prayerProbe.addWorkSite();
    prayerProbe.game.setSpeed(5);
  });
  await click('altar-pray');
  await click('prayer-confirm');
  const fastStart = await snapshot();
  assert.deepEqual(await takeSounds(), ['OfferFood', 'OfferAccepted']);
  await advance(0.58);
  const fastRise = await snapshot();
  assert(fastRise.clock > fastStart.clock, 'The busy settlement continues at the chosen speed');
  assert(fastRise.born.risingFromGround, 'A resident assigned work at top speed still emerges');
  await advance(0.22);
  await clearView();
  report.cases.push('The resident emerges in a working settlement at normal and maximum speed.');

  await reset(true);
  await click('altar-pray');
  await click('offering-bundle-stone');
  assert.deepEqual(await takeSounds(), ['OfferStone']);
  const prepared = await snapshot();
  await page.screenshot({ path: `${output}/offering-configuration.png` });
  await click('prayer-confirm');
  const direct = await snapshot();
  inWorld(direct);
  const mixed = await takeSounds();
  assert.equal(mixed.pop(), 'OfferAccepted');
  assert.deepEqual(mixed.sort(), ['OfferFood', 'OfferStone']);
  await frame(1);
  assert.deepEqual(await takeSounds(), []);
  assert.equal(direct.born.birthStrength + direct.born.birthVitality, 2);
  assert(direct.paused);

  await reset(true);
  await click('altar-pray');
  await click('offering-bundle-stone');
  assert.deepEqual((await snapshot()).offering, prepared.offering);
  await click('prayer-customize');
  const earlier = (await snapshot()).draft;
  await click('prayer-look-random');
  assert.notEqual((await snapshot()).draft.seed, earlier.seed);
  await click('prayer-name-random');
  const randomState = await snapshot(), random = randomState.draft;
  assert.notEqual(random.name, earlier.name);
  await click('prayer-name');
  await page.keyboard.press('Home');
  for (const letter of random.name) await page.keyboard.press('Delete');
  assert(!enabled(await snapshot(), 'prayer-confirm'));
  await page.keyboard.type('Astrid');
  await click('prayer-hair-next');
  await click('prayer-hair-pick');
  for (let i = 0; i < 25 && !enabled(await snapshot(), 'prayer-pick-option-24'); ++i)
    await click('prayer-pick-next');
  await click('prayer-pick-option-24');
  assert.equal((await snapshot()).likeness.cut, 24, 'The last haircut is reachable directly from the style list');
  await click('prayer-hair-tone-1');
  const beardPortraits = new Map();
  for (let i = 0; i < 5; ++i) {
    if (i === 0) await click('prayer-beard-next');
    else await page.keyboard.press('Enter');
    const { whiskers } = (await snapshot()).draft.look;
    beardPortraits.set(whiskers, await picturePixels());
  }
  assert.deepEqual([...beardPortraits.keys()].sort(), [0, 1, 2, 3, 4], 'Every beard can be selected with the keyboard');
  assert.notDeepEqual(beardPortraits.get(0), beardPortraits.get(4), 'The long beard changes the rendered portrait');
  for (let i = 0; i < 5 && (await snapshot()).draft.look.whiskers !== 4; ++i)
    await click('prayer-beard-next');
  await click('prayer-hair-mix');
  const customHair = { r: 131, g: 80, b: 60 };
  for (const [channel, amount] of Object.entries(customHair)) {
    await click(`prayer-color-${channel}`);
    await page.keyboard.press('Home');
    for (let i = 0; i < Math.floor(amount / 10); ++i) await page.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < amount % 10; ++i) await page.keyboard.press('ArrowRight');
  }
  assert.deepEqual((await snapshot()).likeness.hair, customHair);
  await click('prayer-color-done');
  await click('prayer-tab-face');
  await click('prayer-eyes-next');
  await click('prayer-skin-tone-3');
  await click('prayer-tab-marks');
  await click('prayer-scar-on');
  await click('prayer-tab-clothing');
  await click('prayer-cloth-tone-2');
  await click('prayer-kerchief-on');
  await click('prayer-kerchief-tone-2');
  await click('prayer-tab-body');
  const firstFigure = await picturePixels();
  await click('prayer-width-next');
  assert.notDeepEqual(await picturePixels(), firstFigure, 'Changing build updates the full-body preview');
  await click('prayer-tab-hair');
  const edited = await snapshot();
  assert.equal(edited.draft.name, 'Astrid');
  assert.notEqual(edited.likeness.cut, randomState.likeness.cut);
  assert.notEqual(edited.likeness.eyes, randomState.likeness.eyes);
  assert.deepEqual(edited.likeness.hair, customHair);
  assert.ok(edited.likeness.kerchief);
  assert.equal(edited.draft.look.whiskers, 4);
  assert.equal(edited.draft.look.scar, true);
  assert.deepEqual(edited.stock, prepared.stock);
  assert.equal(edited.dice, prepared.dice);
  await page.screenshot({ path: `${output}/resident-customization.png` });
  await click('prayer-back');
  assert.deepEqual((await snapshot()).offering, prepared.offering);
  await page.mouse.click(2, 2);
  assert((await snapshot()).open);
  await click('prayer-confirm');
  const born = await snapshot();
  inWorld(born);
  assert.equal(born.born.name, edited.draft.name);
  assert.deepEqual(born.born.look, edited.draft.look);
  assert.deepEqual(
    await page.evaluate((id) => prayerProbe.savedAppearance(id), born.born.id),
    { name: edited.draft.name, look: edited.draft.look },
  );
  assert.equal(born.born.birthStrength, direct.born.birthStrength);
  assert.equal(born.born.birthVitality, direct.born.birthVitality);
  assert.equal(born.stock.food, prepared.stock.food - 4);
  assert.equal(born.stock.stone, prepared.stock.stone - 4);
  assert.equal(born.clock, prepared.clock);
  assert.deepEqual(born.tasks, prepared.tasks);
  await page.mouse.move(2, 360);
  await advance(0.23);
  const opening = await snapshot();
  assert.notDeepEqual(opening.camera, prepared.camera, 'The camera moves on the presentation clock while paused');
  assert(opening.groundEffects > prepared.groundEffects, 'The summoning ground mark is drawn');
  await page.screenshot({ path: `${output}/resident-arrival-ground.png` });
  await advance(0.45);
  const rising = await snapshot();
  assert(rising.camera.zoom > prepared.camera.zoom);
  assert(rising.born.risingFromGround, 'The earth line clips the resident while rising');
  assert(rising.born.bodyOffset > 2, 'The actual customized resident is emerging through the ground');
  await page.screenshot({ path: `${output}/resident-arrival-rise.png` });
  await advance(0.42);
  const emerged = await snapshot();
  assert(emerged.born.bodyOffset < rising.born.bodyOffset, 'The resident rises to a normal standing pose');
  assert(!emerged.born.risingFromGround);
  await page.screenshot({ path: `${output}/resident-arrival-standing.png` });
  await advance(0.7);
  const standing = await snapshot();
  inWorld(standing);
  assert.equal(standing.clock, prepared.clock);
  assert.equal(standing.groundEffects, prepared.groundEffects, 'The summoning ground mark expires while paused');
  await clearView();
  assert.deepEqual((await snapshot()).stock, born.stock);
  assert.equal((await snapshot()).count, born.count);
  await page.screenshot({ path: `${output}/resident-created.png` });
  report.cases.push('An altar birth opens directly onto the selected resident. The camera and earthen reveal progress even while paused and a mouse wheel takes immediate control.');
  report.cases.push(
    'The last haircut is reachable from the list and all five beards respond to keyboard and mouse. Custom RGB and the edited likeness survive creating, saving and reloading the resident.',
    'Four surplus materials grant one extra point, even after editing the resident.',
  );
  await page.evaluate(() => prayerProbe.reset('Clear', 12, true, Math.PI));
  await click('altar-pray');
  await click('prayer-confirm');
  inWorld(await snapshot());
  await advance(1.05);
  await page.screenshot({ path: `${output}/resident-arrival-rotated.png` });
  await clearView();
  await reset(true);
  await click('altar-pray');
  await page.evaluate(() => prayerProbe.fillTo(prayerProbe.altarCap(prayerProbe.game.town)));
  await frame(0);
  const capped = await snapshot();
  assert(!enabled(capped, 'prayer-confirm'));
  await takeSounds();
  await click('prayer-confirm', false);
  await page.keyboard.press('Escape');
  assert.deepEqual(await takeSounds(), []);
  assert.deepEqual((await snapshot()).stock, capped.stock);
  const altarHit = await page.evaluate(() => {
    prayerProbe.reset('Clear', 12, false);
    const g = prayerProbe.game;
    g.selected = -1;
    prayerProbe.frame();
    g.worldPresented(1);
    const at = g.toScreen(g.town.building(1).center);
    for (let y = at.y - 110; y < at.y + 8; y += 4)
      for (let x = at.x - 30; x <= at.x + 30; x += 4) {
        const hit = g.renderer.pick({ x, y });
        if (hit?.kind === 'building' && hit.id === 1) return { x, y };
      }
    const v = g.renderer.visuals.get(1);
    throw Error(
      'The rendered altar could not be picked by its real silhouette: ' +
        JSON.stringify({
          at,
          geometry: g.renderer.selectionGeometry({ kind: 'building', id: 1 }),
          bounds: v?.picture && g.renderer.adapter.renderedBounds(v.picture),
          candidates: g.renderer.picker.candidates.map((c) => ({ hit: c.hit?.key, bounds: c.bounds })),
        }),
    );
  });
  await page.mouse.click(altarHit.x, altarHit.y);
  await frame(0.2);
  assert.equal(await page.evaluate(() => prayerProbe.game.selectedBuilding()), 1);
  await resize(390, 844);
  await page.evaluate(() => {
    prayerProbe.reset('Snow', 23, false);
    prayerProbe.game.openPrayer(1);
    prayerProbe.frame();
  });
  const phone = await snapshot();
  function inViewport(state, width, height) {
    for (const c of state.controls) {
      assert(
        c.bounds.x >= 0 &&
          c.bounds.y >= 0 &&
          c.bounds.w > 0 &&
          c.bounds.h > 0 &&
          c.bounds.x + c.bounds.w <= width + 0.01 &&
          c.bounds.y + c.bounds.h <= height + 0.01,
        JSON.stringify(c),
      );
      if ('hit' in c) assert.equal(c.hit, c.id, `Overlapping editor control ${c.id} at ${width} × ${height}`);
    }
  }
  inViewport(phone, 390, 844);
  await page.evaluate(() => prayerProbe.setLocale('KR'));
  await frame(0);
  await page.screenshot({ path: `${output}/mobile-offering-ko.png` });
  await takeSounds();
  await tap('offering-more-gold');
  await tap('offering-less-gold');
  assert.deepEqual(await takeSounds(), ['OfferGold', 'OfferTakeGold']);
  assert.deepEqual((await snapshot()).offering, phone.offering);
  await tap('prayer-customize');
  inViewport(await snapshot(), 390, 844);
  const untranslated = await page.evaluate(() =>
    ['Facial hair', 'Markings', 'Clothing', 'Mix'].filter((word) => {
      const local = prayerProbe.translate(word);
      return local === word || !prayerProbe.editorLabels.has(local);
    }),
  );
  assert.deepEqual(untranslated, [], 'Korean editing labels are actually painted');
  await page.screenshot({ path: `${output}/mobile-customization-ko.png` });
  const beforeTap = (await snapshot()).draft.look.whiskers;
  await tap('prayer-beard-next');
  const chosenBeard = (await snapshot()).draft.look.whiskers;
  assert.notEqual(chosenBeard, beforeTap);
  await tap('prayer-hair-mix');
  inViewport(await snapshot(), 390, 844);
  const slider = (await snapshot()).controls.find((c) => c.id.endsWith('prayer-color-b')).bounds;
  const touch = await context.newCDPSession(page), y = slider.y + slider.h / 2;
  try {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: slider.x + 2, y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: slider.x + slider.w - 2, y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await touch.detach();
  }
  assert.equal((await snapshot()).likeness.hair.b, 255, 'Dragging the blue slider reaches its upper bound');
  await tap('prayer-color-done');
  await tap('prayer-hair-pick');
  inViewport(await snapshot(), 390, 844);
  for (const tab of ['face', 'marks', 'clothing', 'body']) {
    await tap(`prayer-tab-${tab}`);
    inViewport(await snapshot(), 390, 844);
  }
  await tap('prayer-body-next');
  await resize(740, 360);
  for (const tab of ['body', 'clothing', 'marks', 'face', 'hair']) {
    await tap(`prayer-tab-${tab}`);
    inViewport(await snapshot(), 740, 360);
  }
  assert.equal((await snapshot()).draft.look.whiskers, chosenBeard);
  await page.screenshot({ path: `${output}/mobile-landscape-customization-ko.png` });
  await resize(390, 844);
  await tap('prayer-confirm');
  inWorld(await snapshot());
  assert.equal((await snapshot()).born.level, 4);
  assert.equal((await snapshot()).born.look.whiskers, chosenBeard);
  await advance(0.72);
  await page.screenshot({ path: `${output}/mobile-created-ko.png` });
  inWorld(await snapshot());
  await clearView();
  await advance(1);
  await clearView();
  report.cases.push('Real touch controls, color dragging and Korean portrait and landscape layouts preserve the appearance.');
  await resize(1024, 768);
  await reset(true);
  await click('altar-pray');
  const untouchedTown = await page.evaluate(() => prayerProbe.encodeTown(prayerProbe.game.town));
  await click('prayer-customize');
  await click('prayer-look-random');
  await click('prayer-beard-next');
  await click('prayer-tab-body');
  await click('prayer-height-next');
  const designed = await snapshot();
  await click('prayer-presets');
  await click('prayer-preset-name');
  await page.keyboard.type('Pine');
  await click('prayer-preset-save');
  const waitForControl = (id, present = true) => page.waitForFunction(([id, present]) => {
    prayerProbe.frame();
    return prayerProbe.game.context.controls.some((control) => control.id === id && control.enabled) === present;
  }, [id, present], { timeout: 10000 });
  await waitForControl('prayer-preset-use-0');
  await click('prayer-preset-name');
  for (let i = 0; i < 'Pine'.length; ++i) await page.keyboard.press('Backspace');
  await page.keyboard.type('Red');
  assert(await page.evaluate(() => prayerProbe.editorLabels.has('Red')), 'The player can type an English preset name while using Korean');
  await click('prayer-preset-save');
  await page.waitForFunction(() => {
    prayerProbe.frame();
    return prayerProbe.editorLabels.has('Red');
  });
  assert(!(await snapshot()).controls.some((c) => c.id === 'prayer-preset-use-1'));
  await click('prayer-presets-code');
  await click('prayer-code-copy');
  const readCopied = () => page.evaluate(() => navigator.clipboard.readText());
  await page.waitForFunction(async () => (await navigator.clipboard.readText()).length > 0);
  const code = await readCopied();
  assert.match(code, /^MG1-[A-Za-z0-9_-]+$/);
  await page.keyboard.press('Escape');
  await click('prayer-back');
  await click('prayer-cancel');
  assert.equal(await page.evaluate(() => prayerProbe.encodeTown(prayerProbe.game.town)), untouchedTown);

  // A reload discards the draft, the game services and any in-memory preset cache.
  await stopProbe();
  await page.reload();
  await startProbe();
  await reset(true);
  await click('altar-pray');
  await click('prayer-customize');
  await click('prayer-name-random');
  const nextResident = await snapshot();
  assert.notDeepEqual(nextResident.likeness, designed.likeness);
  assert.notEqual(nextResident.draft.name, designed.draft.name);
  const matchesDesign = (current) => {
    // The mouth value in old appearance records is not drawn by the resident renderer.
    const { mouth: _sourceMouth, ...source } = designed.likeness;
    const { mouth: _currentMouth, ...look } = current.likeness;
    assert.deepEqual(look, source);
    assert.deepEqual(current.draft.look.trim, designed.draft.look.trim);
    assert.equal(current.draft.look.bodyHeight, designed.draft.look.bodyHeight);
    assert.equal(current.draft.look.bodyWidth, designed.draft.look.bodyWidth);
    assert.equal(current.draft.name, nextResident.draft.name);
    assert.equal(current.draft.seed, nextResident.draft.seed);
    assert.deepEqual(current.stock, nextResident.stock);
    assert.equal(current.dice, nextResident.dice);
  };
  await click('prayer-presets');
  await waitForControl('prayer-preset-use-0');
  assert(await page.evaluate(() => prayerProbe.editorLabels.has('Red')));
  await page.screenshot({ path: `${output}/appearance-presets.png` });
  await page.evaluate(() => prayerProbe.setLocale('KR'));
  await frame(0);
  assert(await page.evaluate(() =>
    prayerProbe.editorLabels.has('Red') && prayerProbe.editorLabels.has(prayerProbe.translate('Preset name')) &&
    !prayerProbe.editorLabels.has(prayerProbe.translate('Red')),
  ), 'Preset names remain verbatim when the surrounding fields are translated');
  await click('prayer-preset-use-0');
  matchesDesign(await snapshot());
  await click('prayer-preset-delete-0');
  await click('prayer-preset-delete-cancel');
  await click('prayer-preset-delete-0');
  await click('prayer-preset-delete-confirm');
  await waitForControl('prayer-preset-use-0', false);

  await click('prayer-presets-back');
  await click('prayer-beard-next');
  const another = await snapshot();
  await page.evaluate(() => prayerProbe.setLocale('KR'));
  await resize(390, 844);
  await tap('prayer-presets');
  inViewport(await snapshot(), 390, 844);
  await tap('prayer-presets-code');
  inViewport(await snapshot(), 390, 844);
  await tap('prayer-code-input');
  await page.keyboard.type('invalid');
  await tap('prayer-code-apply');
  assert.deepEqual((await snapshot()).draft, another.draft);
  assert(await page.evaluate(() => prayerProbe.editorLabels.has(prayerProbe.translate('Invalid appearance code.'))));
  await tap('prayer-code-clear');
  assert(!enabled(await snapshot(), 'prayer-code-apply'));
  await tap('prayer-code-paste');
  await page.waitForFunction((code) => {
    prayerProbe.frame();
    return prayerProbe.editorLabels.has(code);
  }, code, { timeout: 10000 });
  await tap('prayer-code-apply');
  matchesDesign(await snapshot());
  await page.screenshot({ path: `${output}/mobile-appearance-code-ko.png` });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  try {
    const fallback = page.waitForEvent('dialog', { timeout: 5000 }).then(async (dialog) => {
      const value = dialog.defaultValue();
      await dialog.dismiss();
      return value;
    });
    await tap('prayer-code-copy');
    assert.equal(await fallback, code);
    await tap('prayer-code-paste');
    assert.equal(await page.evaluate(() => prayerProbe.game.context.focused()), 'prayer-code-input');
  } finally {
    await page.evaluate(() => { delete navigator.clipboard; });
  }
  await resize(740, 360);
  inViewport(await snapshot(), 740, 360);
  await tap('prayer-presets-saved');
  inViewport(await snapshot(), 740, 360);
  await tap('prayer-presets-back');
  const imported = await snapshot();
  await page.evaluate(() => { prayerProbe.setMotionPreference('Off'); prayerProbe.frame(); });
  await tap('prayer-confirm');
  const fromCode = await snapshot();
  inWorld(fromCode);
  assert(Math.abs(fromCode.born.bodyOffset) < 2, 'Reduced motion shows the full resident immediately');
  assert(!fromCode.born.risingFromGround);
  assert.equal(fromCode.born.name, nextResident.draft.name);
  assert.deepEqual(fromCode.born.look, imported.draft.look);
  assert.equal(fromCode.stock.food, nextResident.stock.food - 4);
  await advance(0.32);
  assert.deepEqual((await snapshot()).camera, fromCode.camera, 'Reduced motion has no camera sweep');
  await page.evaluate(() => prayerProbe.setMotionPreference('On'));
  report.cases.push('A named appearance survives a fresh game and page reload. The portable code restores the design after its preset is deleted, while keeping the new name, dice and settlement stock.');

  await resize(390, 844);
  await page.evaluate(() => {
    prayerProbe.game.openPrayer(1);
    prayerProbe.frame();
  });
  await tap('prayer-customize');
  const newcomer = await snapshot();
  assert.notDeepEqual(newcomer.likeness, fromCode.born.likeness);
  await tap('prayer-presets');
  await tap('prayer-presets-residents');
  inViewport(await snapshot(), 390, 844);
  await tap('prayer-settler-use-0');
  const fromResident = await snapshot();
  assert.deepEqual(fromResident.likeness, fromCode.born.likeness);
  assert.equal(fromResident.draft.name, newcomer.draft.name);
  assert.equal(fromResident.draft.seed, newcomer.draft.seed);
  assert.deepEqual(fromResident.stock, fromCode.stock);
  await tap('prayer-presets-back');
  await tap('prayer-back');
  await tap('prayer-cancel');
  assert.deepEqual((await snapshot()).stock, fromCode.stock);
  report.cases.push('The settlement list can recover an existing resident’s appearance on a phone; cancelling still costs no goods.');
  const townForPaste = await page.evaluate(() => prayerProbe.encodeTown(prayerProbe.game.town));
  await stopProbe();

  // Exercise the production hidden textarea as well as the in-game clipboard buttons above.
  await page.reload();
  await page.evaluate(async ({ renderer, town }) => {
    const [{ startNativeGame }, { loadSavedTown }] = await Promise.all([
      import('/apps/web/src/native/bootstrap.ts'), import('/apps/web/src/native/game-application.ts'),
    ]);
    const element = document.body.appendChild(document.createElement('canvas'));
    element.style.cssText = 'display:block;width:100vw;height:100vh;touch-action:none';
    const runtime = await startNativeGame(element, { titleScreen: false, world: 'Random', seed: 5 }, renderer, undefined, false);
    window.pasteRuntime = runtime;
    runtime.app.game.town = loadSavedTown(town);
    runtime.app.game.paused = true;
    runtime.app.game.openPrayer(1);
    runtime.host.render(0);
  }, { renderer, town: townForPaste });
  const clickHost = async (id, touch = false) => {
    const point = await page.evaluate((id) => {
      pasteRuntime.app.dirty = true;
      pasteRuntime.host.render(0);
      const control = pasteRuntime.app.game.context.controls.find((control) => control.id === id && control.enabled);
      if (!control) throw Error('Missing browser host control ' + id);
      const { x, y, w, h } = control.bounds;
      return [x + w / 2, y + h / 2];
    }, id);
    if (touch) await page.touchscreen.tap(...point);
    else await page.mouse.click(...point);
  };
  try {
    const editing = () => page.locator('[data-goldfantasy-text-input]').evaluate(field => field === document.activeElement);
    const residentName = () => page.evaluate(() => pasteRuntime.app.game.prayer.draft.name.value);
    await clickHost('prayer-customize', true);
    assert.equal(await editing(), false);
    const name = await residentName(), syllable = String.fromCodePoint(0xc194);
    await clickHost('prayer-name', true);
    assert.equal(await editing(), true);
    await page.keyboard.insertText(syllable);
    assert.equal(await residentName(), name + syllable);
    await clickHost('prayer-presets', true);
    assert.equal(await editing(), false);
    report.cases.push('Touching the name field accepts a Korean syllable and the preset button returns focus to the game.');
    await clickHost('prayer-presets-code');
    await clickHost('prayer-code-input');
    assert(await editing());
    await page.keyboard.press('Control+v');
    await clickHost('prayer-code-apply');
    assert.equal(await page.evaluate(async () => {
      const { encodeAppearanceCode } = await import('/packages/engine/src/appearance-code.ts');
      return encodeAppearanceCode(pasteRuntime.app.game.prayer.draft.person.customLook);
    }), code);
    report.cases.push('A native keyboard paste in the running game restores the copied appearance code.');
    await clickHost('prayer-presets-back');
    const savedClock = await page.evaluate(() => pasteRuntime.app.game.town.clock());
    await clickHost('prayer-confirm');
    assert(await page.evaluate(() => !pasteRuntime.app.game.prayer && !!pasteRuntime.app.game.residentArrival));
    await page.evaluate(() => pasteRuntime.host.start());
    await page.waitForFunction(() => {
      const g = pasteRuntime.app.game;
      return g.residentArrival && g.renderer.combatGround.children.length > 0 &&
        g.renderer.figures.get(g.residentArrival.person)?.parts.body?.matrix[5] > 2;
    });
    await page.waitForFunction(() => !pasteRuntime.app.game.residentArrival);
    assert.equal(await page.evaluate(() => pasteRuntime.app.game.town.clock()), savedClock);
    report.cases.push('The production browser frame loop plays and finishes the welcome while the town remains paused.');
  } finally {
    await page.evaluate(() => pasteRuntime.dispose());
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack ?? String(error);
  throw error;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server?.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
