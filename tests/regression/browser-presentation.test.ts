import { afterEach, expect, it, vi } from 'vitest';
import { BrowserFrameLoop, renderPixelRatio } from '../../apps/web/src/native/browser-presentation';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function display(delay: () => number) {
  vi.useFakeTimers();
  const doc = { hidden: false }, callbacks = new Map<number, FrameRequestCallback>();
  let serial = 0;
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { setTimeout });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  const draw = vi.fn(), loop = new BrowserFrameLoop(draw, delay, 1000 / 60);
  const refresh = (at: number) => {
    vi.advanceTimersByTime(Math.round(at) - performance.now());
    const waiting = [...callbacks.values()];
    callbacks.clear();
    for (const callback of waiting) callback(at);
  };
  return { loop, draw, refresh, doc, callbacks };
}

it('bounds the pixel cost of phones and tablets while respecting logical size and lower display densities', () => {
  expect(renderPixelRatio(390, 844, 3, true)).toBe(1.75);
  expect(renderPixelRatio(844, 390, 3, true)).toBe(1.75);
  const tablet = renderPixelRatio(820, 1180, 2, true);
  expect(tablet).toBeGreaterThan(1);
  expect(820 * 1180 * tablet ** 2).toBeCloseTo(1_200_000);
  expect(renderPixelRatio(1280, 1024, 3, true)).toBe(1);
  expect(renderPixelRatio(390, 844, 1, true)).toBe(1);
  expect(renderPixelRatio(1280, 800, 3, false)).toBe(2.5);
});

it.each([[1 / 30, 30], [0, 60]])('paces a 120 Hz screen with a frame delay of %f seconds', (delay, count) => {
  const { loop, refresh, draw } = display(() => delay);
  loop.start();
  for (let i = 0; i < 120; i++) refresh(i * 1000 / 120);
  expect(draw).toHaveBeenCalledTimes(count);
  loop.stop();
});

it('wakes a sleeping menu for input, suspends while hidden and excludes hidden time on return', () => {
  const { loop, refresh, draw, doc, callbacks } = display(() => 0.5);
  loop.start();
  refresh(0);
  expect(callbacks.size).toBe(0);
  refresh(120);
  expect(draw).toHaveBeenCalledTimes(1);
  loop.wake();
  refresh(128);
  expect(draw).toHaveBeenCalledTimes(2);
  doc.hidden = true;
  loop.visibilityChanged();
  loop.wake();
  refresh(10_128);
  expect(draw).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  doc.hidden = false;
  loop.visibilityChanged();
  refresh(10_144);
  expect(draw).toHaveBeenLastCalledWith(0.144);
  loop.stop();
  loop.wake();
  expect(callbacks.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
