import { likenessOfAppearance, setResidentLikeness } from './character-cast';
import { refreshShades } from './character-preset';
import { legacyHairAsset, useCharacterReference } from './character-reference';
import { BrowCut, EyeCut, HairCut, JawCut, plainLikeness } from './likeness';
import { BodyType, Whiskers, type Appearance } from './person-appearance';
import { defaultAppearance, rgb } from './person-look';
import { digest } from './save-archive';

// MG1: six style indices, six toggle bits, four RGB dyes, two little-endian
// float32 proportions, and the low 24 bits of the town save's FNV-1a checksum.
const prefix = 'MG1-';
const styleLimits = [
  BodyType.Female,
  HairCut.Mane,
  EyeCut.Slit,
  BrowCut.Heavy,
  JawCut.Narrow,
  Whiskers.LongBeard,
];
const payloadBytes = 27;
const byteLength = payloadBytes + 3;
const inRange = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;
const bodyScale = (n: number) => n >= 0.75 && n <= 1.25;
const colors = ['skin', 'hair', 'cloth', 'trim'] as const;

function checksum(bytes: Uint8Array): number {
  return Number(digest(bytes.subarray(0, payloadBytes)) & 0xffffffn);
}

/** The same editable design always has the same code, in every settlement. */
export function encodeAppearanceCode(appearance: Appearance): string {
  const look = likenessOfAppearance(appearance);
  const styles = [look.body, look.cut, look.eyes, look.brows, look.jaw, look.whiskers];
  const dyes = colors.flatMap((key) => {
    const { r, g, b } = appearance[key];
    return [r, g, b];
  });
  if (
    !styles.every((value, i) => inRange(value, styleLimits[i])) ||
    !dyes.every((channel) => inRange(channel, 255)) ||
    !bodyScale(appearance.bodyHeight) ||
    !bodyScale(appearance.bodyWidth)
  )
    throw new RangeError('Invalid resident appearance');

  const bytes = new Uint8Array(byteLength);
  bytes.set(styles);
  const toggles = [look.band, look.kerchief !== null, look.freckles, look.scar, look.paint, look.elder];
  bytes[6] = toggles.reduce((bits, on, i) => bits | (Number(on) << i), 0);
  bytes.set(dyes, 7);
  const view = new DataView(bytes.buffer);
  view.setFloat32(19, appearance.bodyHeight, true);
  view.setFloat32(23, appearance.bodyWidth, true);
  const sum = checksum(bytes);
  bytes.set([sum >>> 16, (sum >>> 8) & 255, sum & 255], payloadBytes);
  return (
    prefix +
    btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
  );
}

/** Restore a complete, editable resident look. Damaged or unsupported codes leave the caller's draft alone. */
export function decodeAppearanceCode(code: string): Appearance | null {
  const text = code.trim();
  if (!/^MG1-[A-Za-z0-9_-]{40}$/.test(text)) return null;
  const binary = atob(text.slice(prefix.length).replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const storedSum = (bytes[27] << 16) | (bytes[28] << 8) | bytes[29];
  if (checksum(bytes) !== storedSum || !styleLimits.every((max, i) => bytes[i] <= max) || bytes[6] > 63)
    return null;
  const view = new DataView(bytes.buffer);
  const height = view.getFloat32(19, true),
    width = view.getFloat32(23, true);
  if (!bodyScale(height) || !bodyScale(width)) return null;

  const [body, cut, eyes, brows, jaw, whiskers, toggles] = bytes;
  const appearance = defaultAppearance();
  useCharacterReference(appearance, legacyHairAsset(cut));
  colors.forEach((key, i) => {
    const at = 7 + i * 3;
    appearance[key] = rgb(bytes[at], bytes[at + 1], bytes[at + 2]);
  });
  setResidentLikeness(appearance, {
    ...plainLikeness(),
    body,
    cut,
    eyes,
    brows,
    jaw,
    whiskers,
    skin: appearance.skin,
    hair: appearance.hair,
    wool: appearance.cloth,
    band: !!(toggles & 1),
    kerchief: toggles & 2 ? appearance.trim : null,
    freckles: !!(toggles & 4),
    scar: !!(toggles & 8),
    paint: !!(toggles & 16),
    elder: !!(toggles & 32),
  });
  appearance.bodyHeight = height;
  appearance.bodyWidth = width;
  appearance.hairEnd = { ...appearance.hair };
  refreshShades(appearance);
  return appearance;
}
