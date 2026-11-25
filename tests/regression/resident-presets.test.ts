import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  listResidentPresets,
  removeResidentPreset,
  saveResidentPreset,
} from '../../apps/web/src/native/resident-presets';
import { encodeAppearanceCode } from '../../packages/engine/src/appearance-code';
import { setResidentLikeness } from '../../packages/engine/src/character-cast';
import { plainLikeness } from '../../packages/engine/src/likeness';
import { defaultAppearance } from '../../packages/engine/src/person-look';

function design(red: number): string {
  const appearance = defaultAppearance();
  setResidentLikeness(appearance, { ...plainLikeness(), wool: { r: red, g: 40, b: 50 } });
  return encodeAppearanceCode(appearance);
}

const files = new Map<string, string>();
const storage = {
  get length() {
    return files.size;
  },
  key: (index: number) => [...files.keys()][index] ?? null,
  getItem: (key: string) => files.get(key) ?? null,
  setItem: (key: string, value: string) => {
    files.set(key, value);
  },
  removeItem: (key: string) => {
    files.delete(key);
  },
};
beforeEach(() => {
  files.clear();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps distinct designs even under the same name, and saving the same design renames it', () => {
  const first = design(20),
    second = design(21);
  const now = vi.spyOn(Date, 'now');
  now.mockReturnValue(1);
  saveResidentPreset('Summer folk', first);
  now.mockReturnValue(2);
  saveResidentPreset('Summer folk', second);
  expect(listResidentPresets()).toEqual([
    { name: 'Summer folk', code: second },
    { name: 'Summer folk', code: first },
  ]);
  now.mockReturnValue(3);
  expect(saveResidentPreset('  Summer\n  rider  ', ' ' + first + ' ')).toEqual({
    name: 'Summer rider',
    code: first,
  });
  expect(listResidentPresets()).toEqual([
    { name: 'Summer rider', code: first },
    { name: 'Summer folk', code: second },
  ]);
  removeResidentPreset(second);
  removeResidentPreset(second);
  expect(listResidentPresets()).toEqual([{ name: 'Summer rider', code: first }]);
});

it('shows valid stored designs alongside damaged, unknown and unrelated records without altering them', () => {
  const first = saveResidentPreset('Rún', design(20));
  const key = storage.key(0)!;
  const prefix = key.slice(0, -first.code.length);
  const other = design(30);
  storage.setItem('midgard.guide', '{"focus":true}');
  storage.setItem(prefix + 'damaged code', storage.getItem(key)!);
  storage.setItem(prefix + other, 'broken json');
  expect(listResidentPresets()).toEqual([first]);
  storage.setItem(prefix + other, '{"savedAt":"yesterday","name":"unfinished"}');
  expect(listResidentPresets()).toEqual([first]);
  removeResidentPreset(first.code);
  expect(storage.getItem(prefix + other)).toContain('unfinished');
  expect(storage.getItem('midgard.guide')).toBe('{"focus":true}');
});

it('rejects invalid input and reports storage failures without replacing a saved design', () => {
  const first = saveResidentPreset('Winter rider', design(20));
  expect(() => saveResidentPreset(' ', first.code)).toThrow();
  expect(() => saveResidentPreset('Winter rider', 'broken code')).toThrow();
  vi.spyOn(storage, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  expect(() => saveResidentPreset('Later name', first.code)).toThrow('Full');
  vi.spyOn(storage, 'removeItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  expect(() => removeResidentPreset(first.code)).toThrow('Blocked');
  expect(listResidentPresets()).toEqual([first]);
  vi.spyOn(storage, 'getItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  expect(() => listResidentPresets()).toThrow('Blocked');
});
