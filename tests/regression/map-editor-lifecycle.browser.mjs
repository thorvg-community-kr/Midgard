import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const backend = process.env.GOLDFANTASY_TEST_RENDERER ?? 'gl';
const cycles = Number(process.env.GOLDFANTASY_TEST_CYCLES ?? 4);
const output = process.env.GOLDFANTASY_TEST_OUTPUT ?? 'artifacts/runtime-lifecycle/map-editor';
const report = { backend, cycles: [], errors: [], passed: false };
let server, browser, page, deadline;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 180000);
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, mobile: false, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?test&renderer=${backend}&seed=5`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () => !!window.goldfantasy || !!document.querySelector('#startup-error'),
    {},
    { timeout: 90000 },
  );
  await page.evaluate(() => {
    if (!window.goldfantasy) throw Error(document.querySelector('#startup-error')?.textContent);
    goldfantasy.host.stop();
    window.testTime = 0;
    window.disposedPaints = new WeakMap();
    window.lifecycleFailure = null;
    const { Paint, Scene } = goldfantasy.tvg,
      dispose = Paint.prototype.dispose,
      remove = Scene.prototype.remove;
    Paint.prototype.dispose = function () {
      let ptr;
      try {
        ptr = this.ptr;
      } catch {}
      disposedPaints.set(this, { ptr, stack: new Error('Paint disposed').stack });
      return dispose.call(this);
    };
    Scene.prototype.remove = function (paint) {
      try {
        return remove.call(this, paint);
      } catch (error) {
        lifecycleFailure = {
          message: String(error),
          stack: error.stack,
          disposal: disposedPaints.get(paint),
        };
        throw error;
      }
    };
    goldfantasy.host.render(testTime);
  });
  const step = async (count = 1) =>
    page.evaluate((count) => {
      for (let i = 0; i < count; i++) goldfantasy.host.render((window.testTime += 0.1));
    }, count);
  const clickControl = async (name, editor = false) => {
    const bounds = await page.evaluate(
      ({ name, editor }) => {
        const app = goldfantasy.app;
        const c = editor ? app.editorSession.game.context : app.overlay;
        const control = c.controls.find((x) => x.id === name && x.enabled);
        if (!control) throw Error(`Missing enabled control: ${name}`);
        return control.bounds;
      },
      { name, editor },
    );
    await page.mouse.click(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
    await step();
  };
  // Move an already presented title from a 1x screen to a denser one.
  assert.equal(await page.locator('canvas[data-goldfantasy-hud]').count(), 0);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, mobile: false, deviceScaleFactor: 2 });
  await step();
  assert.equal(await page.locator('canvas[data-goldfantasy-hud]').evaluate(el => el.width), 2048);
  for (let i = 0; i <= cycles; i++) {
    const close = i === cycles ? 'map-play' : 'map-cancel';
    await clickControl('map-editor');
    await step(2);
    assert.equal(await page.evaluate(() => goldfantasy.app.current), 'MapEditor');
    await cdp.send('HeapProfiler.collectGarbage');
    await step();
    if (i === 0) await page.screenshot({ path: `${output}/before-cancel.png` });
    await clickControl(close, true);
    await step(3);
    assert.equal(await page.evaluate(() => goldfantasy.app.current), 'Game');
    await cdp.send('HeapProfiler.collectGarbage');
    await step(3);
    await page.evaluate(() => goldfantasy.app.command('scene.title'));
    await step(3);
    assert.equal(await page.evaluate(() => goldfantasy.app.current), 'Title');
    report.cycles.push({ cycle: i + 1, close, closed: true });
  }
  if (backend === 'gl') {
    await clickControl('title-settings');
    await step(3);
    await page.evaluate(() => {
      window.worldBeforeRestore = goldfantasy.app.preview.state();
      window.clockBeforeRestore = worldBeforeRestore.clock();
      const hud = document.querySelector('canvas[data-goldfantasy-hud]');
      window.recovery = [document.querySelector('#world'), hud].map(canvas =>
        canvas.getContext('webgl2').getExtension('WEBGL_lose_context'));
      if (recovery.some(ext => !ext)) throw Error('WebGL context recovery is unavailable');
      window.headerPixels = () => {
        goldfantasy.host.present();
        const { x, y } = goldfantasy.app.overlay.controls.find(c => c.id === 'settings/panel').bounds;
        const scale = hud.width / hud.clientWidth, w = Math.round(110 * scale), h = Math.round(28 * scale);
        const sample = new OffscreenCanvas(w, h).getContext('2d');
        sample.drawImage(hud, (x + 24) * scale, (y + 12) * scale, w, h, 0, 0, w, h);
        const { data } = sample.getImageData(0, 0, w, h);
        let ink = 0, hash = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 150) ink++;
          hash = Math.imul(hash, 31) + data[i] | 0;
        }
        return { ink, hash };
      };
    });
    const title = await page.evaluate(() => headerPixels());
    assert.ok(title.ink > 20, 'The settings title is visible on the native-density surface');
    for (const lost of [[0], [1], [0, 1]]) {
      await page.evaluate(layers => layers.forEach(i => recovery[i].loseContext()), lost);
      await page.waitForFunction(layers => layers.every(i => [goldfantasy.host.world, goldfantasy.host.hud][i].lost), lost);
      await cdp.send('HeapProfiler.collectGarbage');
      for (const i of lost) await page.evaluate(i => recovery[i].restoreContext(), i);
      await page.waitForFunction(() => !goldfantasy.host.surfaceLost);
      assert.deepEqual(await page.evaluate(() => headerPixels()), title);
      assert.ok(await page.evaluate(() => goldfantasy.app.preview.state() === worldBeforeRestore &&
        worldBeforeRestore.clock() === clockBeforeRestore));
    }
    await step(3);
    report.contextRestored = true;
  }
  await page.screenshot({ path: `${output}/after-cycles.png` });
  assert.deepEqual(report.errors, []);
  await page.evaluate(() => goldfantasy.dispose());
  assert.equal(await page.locator('canvas[data-goldfantasy-hud]').count(), 0);
  report.passed = true;
} catch (error) {
  report.failure = error.stack ?? String(error);
  if (page) report.nativeFailure = await page.evaluate(() => window.lifecycleFailure).catch(() => null);
  throw error;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server?.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));
