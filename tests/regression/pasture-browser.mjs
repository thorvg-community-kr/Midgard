import assert from 'node:assert/strict';

/** Draw a pasture through the browser, staff it through the inspector and follow an animal inside. */
export async function checkPasture(browser, url, output, touch) {
  const width = 1080, height = 760;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch });
  try {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const plot = await page.evaluate(async ({ width, height, touch }) => {
      const [{ initializeWebCanvas }, { loadNativeFonts }, { BrowserFiles }, { createNativeServices },
        { BrowserHost }, { defaultLaunchOptions }, { setGuidePreference }, { Structure }, { Building }, { Tool },
        { AnimalKind, Monster }, { point, project, centroid, distance, contains }, { pastureGate }] = await Promise.all([
        import('/apps/web/src/native/startup-canvas.ts'), import('/packages/native-ui/src/index.ts'),
        import('/apps/web/src/native/browser-files.ts'), import('/apps/web/src/native/bootstrap.ts'),
        import('/apps/web/src/native/browser-host.ts'), import('/apps/web/src/native/application-contracts.ts'),
        import('/apps/web/src/native/guide-preferences.ts'), import('/packages/engine/src/building-catalog.ts'),
        import('/packages/engine/src/town-models.ts'), import('/packages/engine/src/game-tools.ts'),
        import('/packages/engine/src/person.ts'), import('/packages/engine/src/geometry.ts'),
        import('/packages/engine/src/pasture-roaming.ts'),
      ]);
      setGuidePreference('cards', false);
      setGuidePreference('focus', false);
      const tvg = await initializeWebCanvas('gl'), element = document.createElement('canvas');
      element.style.cssText = `display:block;width:${width}px;height:${height}px`;
      document.body.append(element);
      const fonts = await loadNativeFonts(tvg), files = await BrowserFiles.open('pasture-validation');
      const app = createNativeServices(tvg, fonts, files).createApplication({ ...defaultLaunchOptions(), world: 'Random', seed: 5 });
      const host = new BrowserHost(element, tvg, app, { autoStart: false, devicePixelRatio: false });
      const game = app.game, town = game.town, origin = town.map().camp();
      const kind = touch ? Structure.Cowshed : Structure.ChickenCoop;
      const camp = new Building(0, Structure.Camp, origin, 0, 0);
      town.placed.push(camp);
      town.nextId = 1;
      town.foundSettlement(0);
      town.awaiting = false;
      town.stock().food = town.stock().water = 30;
      town.scout(origin.x, origin.y, 18);
      town.tick(0);
      town.editHour(9);
      game.paused = true;
      if (touch) app.setTouchInput(true);
      game.selectTool(touch ? Tool.Cowshed : Tool.ChickenCoop);
      let clock = 1;
      const frame = (count = 1) => {
        for (let i = 0; i < count; ++i) {
          app.dirty = true;
          host.render(clock += 0.05);
        }
      };
      frame(4);
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = origin.x + dx, y = origin.y + dy;
        const outline = [point(x,y), point(x+6,y), point(x+6,y+4), point(x,y+4)];
        if (touch) outline.splice(2, 1, point(x+6,y+2), point(x+4,y+4));
        const layout = town.pastureLayout(kind, outline);
        if (!layout.check.ok) continue;
        const focus = centroid(outline), at = project(focus.x, focus.y);
        Object.assign(game.camera, { x: at.x, y: at.y, zoom: 1.6 });
        game.invalidatePresentation();
        frame(4);
        window.pasture = {
          frame, game, town, kind,
          pen: () => town.buildings().find(b => b.kind === kind),
          grass() {
            const pen = this.pen();
            for (let gy = y + .25; gy < y + 4; gy += .5) for (let gx = x + .25; gx < x + 6; gx += .5) {
              const tile = point(gx, gy);
              if (!contains(pen.pasture, tile)) continue;
              const at = game.toScreen(tile), hit = game.renderer.pick(at);
              if (hit?.kind === 'building' && hit.id === pen.id && !game.context.controlAt(at.x, at.y)) return at;
            }
            throw new Error('No exposed pasture grass');
          },
          stockForTest() {
            const pen = this.pen(), gate = pastureGate(pen);
            town.animals = [];
            for (let i = 0; i < 3; i++) {
              const animal = new Monster(town.nextMonster++, -1, town.grid.nearestWalkable(point(gate.x + i * 0.4, gate.y)));
              animal.animal = touch ? AnimalKind.Cow : AnimalKind.Chicken;
              animal.home = { ...animal.position };
              animal.ready = town.time + 120;
              town.animals.push(animal);
            }
            for (const p of town.folk) {
              town.orderStop([p.id]);
              p.position = { ...gate };
              p.food = p.hydration = p.rest = 1;
            }
            return town.animals[0].id;
          },
          follow(id) {
            const pen = this.pen(), animal = town.creature(id);
            const herd = town.animals.slice(0, 3);
            for (let i = 0; i < 1800 && herd.some(a => a.pen < 0); i++) town.advance(0.1);
            const start = { ...animal.position };
            let range = 0, inside = true;
            for (let i = 0; i < 600; ++i) {
              town.advance(0.1);
              inside &&= herd.every(a => contains(pen.pasture, a.position));
              range = Math.max(range, distance(start, animal.position));
            }
            frame(3);
            game.notice = '';
            frame(3);
            const picked = herd.some(a => {
              const foot = game.toScreen(a.position);
              for (let y = 0; y <= 24; y += 2) for (let x = -8; x <= 8; x += 2) {
                const hit = game.renderer.pick(point(foot.x + x, foot.y - y));
                if (hit?.kind === 'animal' && hit.id === a.id) return true;
              }
              return false;
            });
            return { housed: herd.filter(a => a.pen === pen.id).length, picked, range, inside };
          },
        };
        return { points: outline.map(p => game.toScreen(p)), capacity: layout.capacity };
      }
      throw new Error('No clear plot near the camp');
    }, { width, height, touch });
    const frame = () => page.evaluate(() => pasture.frame(8));
    const [start, , end] = plot.points;
    if (touch) {
      for (const p of [...plot.points, start]) {
        await page.touchscreen.tap(p.x, p.y);
        await frame();
      }
    } else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 8 });
      await frame();
      assert.equal(await page.evaluate(() => pasture.game.current.problem), `Room for ${plot.capacity} hens`);
      await page.mouse.up();
      await frame();
    }
    assert(await page.evaluate(() => !!pasture.pen()?.pasture.length), 'The drawing stakes out the shelter and its pasture');
    const id = await page.evaluate(() => {
      pasture.town.completeConstruction();
      pasture.town.tick(0);
      const id = pasture.stockForTest();
      for (let i = 0; i < 100; ++i) pasture.town.advance(0.1);
      if (pasture.town.creature(id).pen >= 0) throw new Error('An unstaffed pasture took an animal');
      pasture.game.selectBuilding(pasture.pen().id);
      pasture.frame(10);
      return id;
    });
    const button = await page.evaluate(() => pasture.game.context.controls.find(c => c.id === 'workers-more' && c.enabled)?.bounds);
    assert(button, 'The shelter inspector has an enabled worker assignment button');
    const x = button.x + button.w / 2, y = button.y + button.h / 2;
    if (touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await frame();
    assert.equal(await page.evaluate(() => pasture.pen().workers), 1, 'The worker button assigns a nearby settler');
    const result = await page.evaluate(id => pasture.follow(id), id);
    assert(result.housed === 3 && result.inside && result.range > 0.5 && result.picked, JSON.stringify(result));
    const grass = await page.evaluate(() => {
      pasture.game.selectPeople([]);
      pasture.frame(8);
      return pasture.grass();
    });
    if (touch) await page.touchscreen.tap(grass.x, grass.y);
    else await page.mouse.click(grass.x, grass.y);
    await frame();
    assert(await page.evaluate(() => pasture.game.selected === pasture.pen().id), 'Selecting grass opens its shelter');
    await page.screenshot({ path: `${output}/${touch ? 'cowshed' : 'coop'}-pasture.png` });
    if (!touch) {
      const spot = await page.evaluate(() => {
        pasture.game.selectPeople([pasture.town.folk.find(p => p.job < 0).id]);
        pasture.frame(8);
        return pasture.grass();
      });
      await page.mouse.click(spot.x, spot.y, { button: 'right' });
      await frame();
      assert.equal(await page.evaluate(() => pasture.pen().workers), 2, 'A selected settler takes the job from the pasture');
    }
    assert.deepEqual(errors, []);
    return { capacity: plot.capacity, distance: result.range };
  } finally {
    await context.close();
  }
}
