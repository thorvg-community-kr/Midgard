import { expect, it } from 'vitest';
import { decodeAppearanceCode, encodeAppearanceCode } from '../../packages/engine/src/appearance-code';
import {
  likenessOfAppearance,
  residentCast,
  setResidentLikeness,
} from '../../packages/engine/src/character-cast';
import { validCharacter } from '../../packages/engine/src/character-preset';
import {
  BrowCut,
  EyeCut,
  HairCut,
  JawCut,
  MouthCut,
  plainLikeness,
} from '../../packages/engine/src/likeness';
import { Calling, Race } from '../../packages/engine/src/person';
import { BodyType, MouthStyle, Whiskers } from '../../packages/engine/src/person-appearance';
import { defaultAppearance, rgb } from '../../packages/engine/src/person-look';
import { digest } from '../../packages/engine/src/save-archive';

const example = 'MG1-ARgGBQMEPwAQ_woVIMi0FF-k8AAAkD8AAGA_E2BC';
function design() {
  const appearance = defaultAppearance();
  setResidentLikeness(appearance, {
    ...plainLikeness(),
    body: BodyType.Female,
    cut: HairCut.Mane,
    eyes: EyeCut.Slit,
    brows: BrowCut.Heavy,
    jaw: JawCut.Narrow,
    whiskers: Whiskers.LongBeard,
    skin: rgb(0, 16, 255),
    hair: rgb(10, 21, 32),
    wool: rgb(200, 180, 20),
    kerchief: rgb(95, 164, 240),
    band: true,
    freckles: true,
    scar: true,
    paint: true,
    elder: true,
  });
  appearance.bodyHeight = 1.125;
  appearance.bodyWidth = 0.875;
  return appearance;
}

it('keeps an MG1 design readable with exact body dimensions, four dyes and both accessories', () => {
  const appearance = design();
  expect(encodeAppearanceCode(appearance)).toBe(example);
  const copy = decodeAppearanceCode(' \n' + example + '\t')!;
  expect(likenessOfAppearance(copy)).toEqual(likenessOfAppearance(appearance));
  expect(copy).toMatchObject({ bodyHeight: 1.125, bodyWidth: 0.875 });
  expect(
    validCharacter({ name: 'Lif', race: Race.Human, calling: Calling.Settler, seed: 99, look: copy }),
  ).toBe(true);
  expect(encodeAppearanceCode(copy)).toBe(example);
});

it('gives the same design the same code across seeds and preserves the saved dye of a removed scarf', () => {
  const appearance = design();
  appearance.seed = 0xffff_ffff;
  appearance.mouthStyle = MouthStyle.Pout;
  expect(encodeAppearanceCode(appearance)).toBe(example);
  setResidentLikeness(appearance, { ...likenessOfAppearance(appearance), kerchief: null });
  const bareHead = encodeAppearanceCode(appearance);
  expect(bareHead).not.toBe(example);
  const copy = decodeAppearanceCode(bareHead)!;
  expect(likenessOfAppearance(copy)).toMatchObject({ band: true, kerchief: null });
  expect(copy.trim).toEqual(rgb(95, 164, 240));
  setResidentLikeness(copy, { ...likenessOfAppearance(copy), kerchief: copy.trim });
  expect(encodeAppearanceCode(copy)).toBe(example);
});

it('round-trips every random resident face and every hair silhouette', () => {
  for (const cast of [
    ...residentCast,
    ...Array.from({ length: HairCut.Mane + 1 }, (_, cut) => ({ ...plainLikeness(), cut })),
  ]) {
    const appearance = design();
    setResidentLikeness(appearance, cast);
    const code = encodeAppearanceCode(appearance);
    const restored = decodeAppearanceCode(code)!;
    expect(likenessOfAppearance(restored)).toEqual({
      ...likenessOfAppearance(appearance),
      mouth: MouthCut.Smile,
    });
    expect(encodeAppearanceCode(restored)).toBe(code);
  }
});

it('rejects typos, unsupported versions, and invalid trait values even with a matching checksum', () => {
  for (let i = 4; i < example.length; i++) {
    const replacement = example[i] === 'A' ? 'B' : 'A';
    expect(decodeAppearanceCode(example.slice(0, i) + replacement + example.slice(i + 1))).toBeNull();
  }
  for (const wrong of [
    '',
    example + 'x',
    example.slice(0, -1),
    example.replace('MG1', 'MG2'),
    example.replace('_', '/'),
  ]) {
    expect(decodeAppearanceCode(wrong)).toBeNull();
  }
  function edited(change: (bytes: Buffer) => void) {
    const bytes = Buffer.from(example.slice(4), 'base64url');
    change(bytes);
    bytes.writeUIntBE(Number(digest(bytes.subarray(0, 27)) & 0xffffffn), 27, 3);
    return 'MG1-' + bytes.toString('base64url');
  }
  for (let index = 0; index <= 6; index++) {
    expect(
      decodeAppearanceCode(
        edited((bytes) => {
          bytes[index] = 255;
        }),
      ),
    ).toBeNull();
  }
  for (const value of [NaN, -Infinity, 0.74, 1.251]) {
    expect(
      decodeAppearanceCode(
        edited((bytes) => {
          bytes.writeFloatLE(value, 23);
        }),
      ),
    ).toBeNull();
  }
  const outOfRange = design();
  outOfRange.trim.g = 256;
  expect(() => encodeAppearanceCode(outOfRange)).toThrow(RangeError);
});
