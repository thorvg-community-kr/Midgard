import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Rect } from '../../packages/native-ui/src';
import { Town } from '../../packages/engine/src/town';
import { GameAppState } from '../../apps/web/src/native/game-app-state';
import {
  noticeDue,
  noticeKind,
  noticeRules,
  noticeToast,
  showNotice,
  type Notice,
} from '../../apps/web/src/native/notice-toast';
import { guideTimeline, guideUnread, toggleGuideLog, type GuideEntry } from '../../apps/web/src/native/game-guide';
import { guideHud } from '../../apps/web/src/native/game-guide-panel';

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

describe('how long a notice stays', () => {
  const feed = () => ({ noticeFeed: [] as Notice[] });
  const texts = (f: { noticeFeed: Notice[] }) => f.noticeFeed.map((notice) => notice.text);
  it('shows for eight seconds, up to three at a time', () => {
    const f = feed();
    showNotice(f, 'Embla crafted Wooden axe', 100);
    expect(f.noticeFeed[0].until - f.noticeFeed[0].from).toBe(8);
    expect(noticeRules).toEqual({ seconds: 8, shown: 3, yieldAfter: 2.5 });
    // While a place is free the next notice does not wait.
    expect(noticeDue(f, 100.1, true)).toBe(true);
    showNotice(f, 'Tent is finished', 100.5);
    showNotice(f, 'A road is laid', 101);
    expect(texts(f)).toEqual(['Embla crafted Wooden axe', 'Tent is finished', 'A road is laid']);
    expect(noticeDue(f, 107.9, false)).toBe(false);
    // The oldest has had its time: a place is free again.
    expect(noticeDue(f, 108, false)).toBe(true);
  });
  it('gives way to a waiting notice when full, but not before the oldest could be read', () => {
    const f = feed();
    showNotice(f, 'Embla crafted Wooden axe', 100);
    showNotice(f, 'Tent is finished', 100.5);
    showNotice(f, 'A road is laid', 101);
    expect(noticeDue(f, 102.4, true)).toBe(false);
    expect(noticeDue(f, 100 + noticeRules.yieldAfter, true)).toBe(true);
    showNotice(f, 'Askr reached level 2!', 102.5);
    expect(texts(f)).toEqual(['Tent is finished', 'A road is laid', 'Askr reached level 2!']);
  });
  it('tells trouble from good news', () => {
    expect(noticeKind('Embla is down and bleeding out')).toBe('danger');
    expect(noticeKind('Monsters destroyed the Tent')).toBe('danger');
    expect(noticeKind('A pack from Wargmaw will raid Camp #4 tonight')).toBe('danger');
    expect(noticeKind('Defenders pour out of Wargmaw.')).toBe('danger');
    expect(noticeKind('Askr has died of their wounds')).toBe('danger');
    expect(noticeKind('Tent is finished')).toBe('good');
    expect(noticeKind('Quest complete: Build a tent')).toBe('good');
    expect(noticeKind('Thor has come to Midgard')).toBe('info');
  });
});

describe('the notices on screen', () => {
  function screen() {
    const width = 1024,
      height = 768,
      canvas = new tvg.Canvas(new MemoryCanvas(width, height) as never, {
        width,
        height,
        enableDevicePixelRatio: false,
      }),
      fonts = ['DejaVuSans', 'DejaVuSans-Bold'];
    for (const font of fonts) tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
    const context = new Context(
      tvg,
      Object.fromEntries(
        fonts.map((font) => [
          font,
          parseFontMetrics(new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`))),
        ]),
      ),
    );
    const app = new GameAppState(new Town(5, 32, false), {} as never, context),
      controls = vi.spyOn(context, 'control'),
      words = vi.spyOn(context, 'text');
    app.dockBounds = new Rect(200, 640, 600, 100);
    canvas.add(context.scene());
    return {
      app,
      context,
      words: () => words.mock.calls.map(([, text]) => text),
      strips: () => controls.mock.calls.filter(([id]) => id.startsWith('notice/')),
      folds: () => controls.mock.calls.filter(([id]) => id.startsWith('guide-log/fold/')),
      press(bounds: Rect) {
        context.pointerDown(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
        context.pointerUp(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
      },
      drawLog(now: number) {
        controls.mockClear();
        words.mockClear();
        app.viewWidth = width;
        app.viewHeight = height;
        context.begin(app.theme, new Rect(0, 0, width, height), now);
        guideHud(app as never, width, height);
        context.end();
        canvas.update().render();
      },
      draw(now: number) {
        controls.mockClear();
        words.mockClear();
        context.begin(app.theme, new Rect(0, 0, width, height), now);
        noticeToast(app, width, height);
        context.end();
        canvas.update().render();
      },
      dispose() {
        canvas.remove();
        context.dispose();
        app.campResources.dispose();
        canvas.destroy();
      },
    };
  }
  it('are drawn until their time is up, each on its own strip', () => {
    const ui = screen();
    try {
      showNotice(ui.app, 'A den is destroyed', 1);
      showNotice(ui.app, 'Tent is finished', 2);
      ui.draw(2);
      expect(ui.words()).toEqual(expect.arrayContaining(['A den is destroyed', 'Tent is finished']));
      // The newest stands nearest the dock, the older one above it.
      const [older, newer] = ui.strips();
      expect(newer[1].y).toBeGreaterThan(older[1].y);
      expect(newer[1].y + newer[1].h).toBeLessThanOrEqual(ui.app.dockBounds.y);
      ui.draw(9.1);
      expect(ui.words()).not.toContain('A den is destroyed');
      expect(ui.words()).toContain('Tent is finished');
      ui.draw(10.1);
      expect(ui.strips()).toHaveLength(0);
    } finally {
      ui.dispose();
    }
  });
  it('go away at a click, making room for the next one at once', () => {
    const ui = screen();
    try {
      showNotice(ui.app, 'A den is destroyed', 1);
      showNotice(ui.app, 'Tent is finished', 1);
      showNotice(ui.app, 'A road is laid', 1);
      ui.draw(1.5);
      expect(noticeDue(ui.app, 1.6, false)).toBe(false);
      const [, bounds] = ui.strips()[0];
      ui.context.pointerDown(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
      ui.context.pointerUp(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
      expect(noticeDue(ui.app, 1.6, false)).toBe(true);
      ui.draw(1.6);
      expect(ui.strips()).toHaveLength(2);
      expect(ui.words()).not.toContain('A den is destroyed');
    } finally {
      ui.dispose();
    }
  });
  const told = (key: string, seen: boolean): GuideEntry => ({ key, day: 1, at: null, about: [], detail: [], seen });
  const lines = (app: GameAppState) =>
    guideTimeline(app.guide).map((item) => ('key' in item ? item.key : `${item.kind}: ${item.text} (day ${item.day})`));
  it('are written to the log with their kind and day, newest first among the explanations', () => {
    const ui = screen();
    try {
      ui.app.guide.log.push(told('wood', true));
      showNotice(ui.app, 'Tent is finished', 1);
      ui.app.town.days = 2;
      showNotice(ui.app, 'Embla is down and bleeding out', 2);
      ui.app.guide.log.push(told('kill', false));
      showNotice(ui.app, 'Thor has come to Midgard', 3);
      expect(lines(ui.app)).toEqual([
        'info: Thor has come to Midgard (day 3)',
        'kill',
        'danger: Embla is down and bleeding out (day 3)',
        'good: Tent is finished (day 1)',
        'wood',
      ]);
      // Notices were on screen in the feed: only the explanation not yet seen is counted.
      expect(guideUnread(ui.app.guide)).toBe(1);
    } finally {
      ui.dispose();
    }
  });
  it('lets the oldest notice go when one more than a hundred has come, and never an explanation', () => {
    const ui = screen();
    try {
      ui.app.guide.log.push(told('wood', true));
      for (let i = 1; i <= 101; ++i) showNotice(ui.app, `Askr reached level ${i}!`, i);
      ui.app.guide.log.push(told('kill', true));
      const kept = lines(ui.app);
      expect(kept).toHaveLength(102);
      expect(kept[0]).toBe('kill');
      expect(kept[1]).toBe('good: Askr reached level 101! (day 1)');
      expect(kept.at(-2)).toBe('good: Askr reached level 2! (day 1)');
      expect(kept.at(-1)).toBe('wood');
    } finally {
      ui.dispose();
    }
  });
  it('are read back in the open log, which tells no total', () => {
    const ui = screen();
    try {
      for (let i = 0; i < 101; ++i) showNotice(ui.app, i % 2 ? 'Tent is finished' : 'A den is destroyed', i);
      toggleGuideLog(ui.app);
      ui.drawLog(200);
      const words = ui.words().map(String);
      expect(words).toEqual(expect.arrayContaining(['Log', 'Tent is finished', 'A den is destroyed', 'Older']));
      expect(words.filter((text) => /\d{2,}| of /.test(text))).toEqual([]);
    } finally {
      ui.dispose();
    }
  });
  const body = (words: unknown[]) => words.map(String).filter((text) => text.startsWith("Ymir's thoughts"));
  it('opens the log folded, and a press on a title unfolds its body and folds it again', () => {
    const ui = screen();
    try {
      ui.app.guide.log.push(told('gate', true));
      toggleGuideLog(ui.app);
      ui.drawLog(1);
      expect(ui.words()).toContain('Dungeon');
      expect(body(ui.words())).toHaveLength(0);
      expect(ui.folds()).toHaveLength(1);
      ui.press(ui.folds()[0][1]);
      ui.drawLog(2);
      expect(body(ui.words())).toHaveLength(1);
      ui.press(ui.folds()[0][1]);
      ui.drawLog(3);
      expect(body(ui.words())).toHaveLength(0);
      // Closed and opened again, nothing stays unfolded.
      ui.press(ui.folds()[0][1]);
      toggleGuideLog(ui.app);
      toggleGuideLog(ui.app);
      ui.drawLog(4);
      expect(body(ui.words())).toHaveLength(0);
    } finally {
      ui.dispose();
    }
  });
  it('opens with an explanation not yet read unfolded', () => {
    const ui = screen();
    try {
      ui.app.guide.log.push(told('kill', true), told('gate', false));
      toggleGuideLog(ui.app);
      ui.drawLog(1);
      expect(body(ui.words())).toHaveLength(1);
      expect(ui.words()).toContain('The first kill');
      expect(ui.folds()).toHaveLength(1);
    } finally {
      ui.dispose();
    }
  });
  it('makes a control only of a notice too long for its row, which unfolds to all of its words', () => {
    const ui = screen();
    try {
      const long = 'Askr and Embla wake before the statue of Odin, an ash and an elm he gave breath, and look out over the shore of Midgard';
      showNotice(ui.app, 'Tent is finished', 1);
      toggleGuideLog(ui.app);
      ui.drawLog(1);
      expect(ui.folds()).toHaveLength(0);
      showNotice(ui.app, long, 2);
      ui.drawLog(2);
      expect(ui.folds()).toHaveLength(1);
      const joined = () => ui.words().map(String).join(' ');
      expect(joined()).not.toContain('shore of Midgard');
      ui.press(ui.folds()[0][1]);
      ui.drawLog(3);
      expect(joined()).toContain(long);
    } finally {
      ui.dispose();
    }
  });
});
