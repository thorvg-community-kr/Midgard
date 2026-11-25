import { decodeAppearanceCode } from '../../../../packages/engine/src/appearance-code';

export interface ResidentPreset {
  name: string;
  code: string;
}

// A design has its own key so saving in another tab cannot erase the rest of the library.
const prefix = 'midgard.resident-preset.v1.';

function presetName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ').normalize('NFC');
}

/** Read on opening the library, so a newly opened settlement sees the latest saves. */
export function listResidentPresets(): ResidentPreset[] {
  const storage = globalThis.localStorage;
  const rows: (ResidentPreset & { savedAt: number })[] = [];
  for (let i = 0; i < storage.length; ++i) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const code = key.slice(prefix.length);
    if (code !== code.trim() || !decodeAppearanceCode(code)) continue;
    const text = storage.getItem(key);
    if (text === null) continue;
    let row: unknown;
    try {
      row = JSON.parse(text);
    } catch {
      continue;
    }
    if (!row || typeof row !== 'object' || !('name' in row) || typeof row.name !== 'string') continue;
    const name = presetName(row.name);
    if (!name || !('savedAt' in row) || typeof row.savedAt !== 'number' || !Number.isSafeInteger(row.savedAt))
      continue;
    rows.push({ name, code, savedAt: row.savedAt });
  }
  return rows
    .sort((a, b) => b.savedAt - a.savedAt || a.code.localeCompare(b.code))
    .map(({ name, code }) => ({ name, code }));
}

/** Saving a design again updates its name. A different design may share that name. */
export function saveResidentPreset(name: string, code: string): ResidentPreset {
  const preset = { name: presetName(name), code: code.trim() };
  if (!preset.name) throw new Error('Enter a preset name.');
  if (!decodeAppearanceCode(preset.code)) throw new Error('Invalid appearance code.');
  globalThis.localStorage.setItem(
    prefix + preset.code,
    JSON.stringify({ name: preset.name, savedAt: Date.now() }),
  );
  return preset;
}

export function removeResidentPreset(code: string): void {
  globalThis.localStorage.removeItem(prefix + code.trim());
}
