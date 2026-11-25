// Which face the interface writes a text in: its own faces, the title face for large bold text, and DejaVu
// for anything those cannot write.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics, type FontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Rect, TextInput, Theme, textField } from '../../packages/native-ui/src';
import { locale, setLocale, translate } from '../../packages/localization/src';
import { gameTheme } from '../../apps/web/src/native/game-theme';

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
const metrics: Record<string, FontMetrics> = {};
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({
    renderer: 'sw',
    locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
  });
  for (const name of ['DejaVuSans', 'DejaVuSans-Bold', 'AlegreyaSans-Medium', 'AlegreyaSans-ExtraBold', 'Cinzel-Bold']) {
    const data = new Uint8Array(readFileSync(`public/assets/native-fonts/${name}.ttf`));
    tvg.Font.load(name, data);
    metrics[name] = parseFontMetrics(data);
  }
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});

/** The face each text of one frame was written in, by the text. */
function faces(theme: Theme, loaded: Record<string, FontMetrics>, draw: (c: Context) => void): Map<string, string> {
  const context = new Context(tvg, loaded),
    keys: string[] = [],
    paint = context.paint.bind(context);
  context.paint = (key, make) => {
    keys.push(key);
    paint(key, make);
  };
  context.begin(theme, new Rect(0, 0, 800, 600), 1);
  draw(context);
  context.end();
  context.dispose();
  const out = new Map<string, string>();
  for (const key of keys) {
    const parts: unknown = JSON.parse(key);
    if (Array.isArray(parts) && parts[0] === 'T') out.set(String(parts[7]), String(parts[6]));
  }
  return out;
}
const box = new Rect(0, 0, 400, 30),
  white = { r: 255, g: 255, b: 255, a: 255 };

describe('the faces of the interface', () => {
  it('keeps authored names and cursor widths verbatim while translating empty fields and surrounding labels', () => {
    const previous = locale();
    try {
      const used = faces(gameTheme(), metrics, (c) => {
        setLocale('ENG');
        const width = c.textWidth('Food', 13);
        setLocale('KR');
        expect(c.verbatim(() => c.textWidth('Food', 13))).toBe(width);
        const name = new TextInput('Food');
        const draw = () => c.verbatim(() => textField(c, 'test-name', box, name, 'Preset name'), !!name.value);
        draw();
        name.value = '';
        draw();
        c.verbatim(() => c.text(box, c.elideText('Red', box.w, 13), white, 13));
        expect(() => c.verbatim(() => { throw new Error('test'); })).toThrow('test');
        c.text(box, 'Red', white, 13);
      });
      expect(used.has('Food')).toBe(true);
      expect(used.has(translate('Food'))).toBe(false);
      expect(used.has('Red')).toBe(true);
      expect(used.has(translate('Red'))).toBe(true);
      expect(used.has(translate('Preset name'))).toBe(true);
    } finally {
      setLocale(previous);
    }
  });
  it('measures a repeated label once and uses the new size when the interface scale changes', () => {
    const context = new Context(tvg, metrics), bounds = vi.spyOn(tvg.Text.prototype, 'bounds'),
      theme = gameTheme(), frame = new Rect(0, 0, 800, 600);
    try {
      context.begin(theme, frame, 1);
      const width = context.textWidth('Workbench', 15, true), measured = bounds.mock.calls.length;
      expect(measured).toBeGreaterThan(0);
      expect(context.textWidth('Workbench', 15, true)).toBe(width);
      expect(bounds.mock.calls.length).toBe(measured);
      context.end();
      theme.fontScale *= 1.25;
      context.begin(theme, frame, 2);
      expect(context.textWidth('Workbench', 15, true)).toBeGreaterThan(width);
      expect(bounds.mock.calls.length).toBeGreaterThan(measured);
      context.end();
    } finally {
      bounds.mockRestore();
      context.dispose();
    }
  });
  it('writes text in Alegreya Sans, its bold in ExtraBold and large bold text in Cinzel', () => {
    const used = faces(gameTheme(), metrics, (c) => {
      c.text(box, 'Fells trees faster', white, 12);
      c.text(box, 'Residents 2 of 5', white, 12, true);
      c.text(box, 'Workbench', white, 17, true);
    });
    expect(used.get('Fells trees faster')).toBe('AlegreyaSans-Medium');
    expect(used.get('Residents 2 of 5')).toBe('AlegreyaSans-ExtraBold');
    expect(used.get('Workbench')).toBe('Cinzel-Bold');
  });
  it('falls back to DejaVu for a character its own face cannot write, and keeps line breaks in its own', () => {
    const used = faces(gameTheme(), metrics, (c) => {
      c.text(box, '▸ Roof', white, 12);
      c.text(box, 'Ready to play.\nPlay map starts a new settlement.', white, 12);
    });
    expect(used.get('▸ Roof')).toBe('DejaVuSans');
    expect(used.get('Ready to play.\nPlay map starts a new settlement.')).toBe('AlegreyaSans-Medium');
  });
  it('sets a title too long for its box in the narrower bold face instead of cutting it', () => {
    const title = 'The founders wait for your word',
      used = faces(gameTheme(), metrics, (c) => {
        c.text(new Rect(0, 0, 400, 30), title, white, 15, true);
        c.text(new Rect(0, 40, 260, 30), title + ' ', white, 15, true);
      });
    expect(used.get(title)).toBe('Cinzel-Bold');
    expect(used.get(title + ' ')).toBe('AlegreyaSans-ExtraBold');
  });
  it('still writes in DejaVu where only DejaVu is loaded', () => {
    const only = { DejaVuSans: metrics.DejaVuSans, 'DejaVuSans-Bold': metrics['DejaVuSans-Bold'] },
      used = faces(gameTheme(), only, (c) => {
        c.text(box, 'Workbench', white, 17, true);
        c.text(box, 'Fells trees faster', white, 12);
      });
    expect(used.get('Workbench')).toBe('DejaVuSans-Bold');
    expect(used.get('Fells trees faster')).toBe('DejaVuSans');
  });
});
