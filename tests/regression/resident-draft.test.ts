import { beforeAll, describe, expect, it } from 'vitest';
import {
  ResidentDraft, residentChoices, residentColors, type ResidentChoiceId, type ResidentColorId,
} from '../../apps/web/src/native/resident-draft';
import { castMember, callingOutfit, likenessOf, likenessOfAppearance, residentCast } from '../../packages/engine/src/character-cast';
import { decodeCharacter, encodeCharacter, validCharacter } from '../../packages/engine/src/character-preset';
import { point } from '../../packages/engine/src/geometry';
import { BrowCut, EyeCut, HairCut, JawCut } from '../../packages/engine/src/likeness';
import { Whiskers } from '../../packages/engine/src/person-appearance';
import { Town } from '../../packages/engine/src/town';
import { korean } from '../../packages/localization/src/korean';

let town: Town;
beforeAll(() => { town = new Town(19, 32); });
const draftAtAltar = () => new ResidentDraft(town, point(16, 16));

describe('resident appearance choices', () => {
  it('translates every feature, style and dye in the resident creator', () => {
    const labels = ['Hair', 'Face', 'Markings', 'Clothing', 'Body', 'Mix', 'Done', 'Red', 'Green', 'Blue'];
    for (const row of Object.values(residentChoices)) labels.push(row.label, ...row.options);
    for (const row of Object.values(residentColors)) labels.push(row.label);
    for (const label of labels) expect(korean.translate(label), label).not.toBe(label);
  });

  it('starts from a whole cast member, keeps both random sequences independent, and leaves town dice alone', () => {
    const dice = town.dice, a = draftAtAltar(), b = draftAtAltar(), before = a.name.value;
    for (let i = 0; i < 64; i++) {
      const cast = castMember(a.person.look);
      expect(likenessOf(a.person)).toEqual({
        ...cast,
        wool: callingOutfit(a.person.calling, a.person.look, cast.wool).cloth,
      });
      expect(likenessOf(a.person)).toEqual(likenessOf(b.person));
      b.randomName();
      b.choose('beard', Whiskers.LongBeard);
      b.choose('height', 4);
      a.randomLook();
      b.randomLook();
      expect(a.person.customLook).toEqual(b.person.customLook);
    }
    expect(a.name.value).toBe(before);
    expect(town.dice).toBe(dice);
  });

  it('selects every cut and every face detail independently and keeps the choice in the character preset', () => {
    const draft = draftAtAltar();
    expect(residentChoices.hair.options.length).toBe(HairCut.Mane + 1);
    expect(residentChoices.beard.options.length).toBe(Whiskers.LongBeard + 1);
    expect(residentChoices.eyes.options.length).toBe(EyeCut.Slit + 1);
    expect(residentChoices.brows.options.length).toBe(BrowCut.Heavy + 1);
    expect(residentChoices.jaw.options.length).toBe(JawCut.Narrow + 1);
    const fields = {
      body: 'body', hair: 'cut', beard: 'whiskers', eyes: 'eyes', brows: 'brows', jaw: 'jaw',
      band: 'band', freckles: 'freckles', scar: 'scar', paint: 'paint', elder: 'elder',
    } as const;
    draft.choose('kerchief', 1);
    for (const id of Object.keys(fields) as (keyof typeof fields)[]) {
      const field = fields[id];
      residentChoices[id].options.forEach((_, index) => {
        const before = likenessOf(draft.person);
        draft.choose(id, index);
        const expected = { ...before, [field]: typeof before[field] === 'boolean' ? Boolean(index) : index };
        expect(draft.choice(id), id).toBe(index);
        expect(likenessOf(draft.person), id).toEqual(expected);
        const saved = decodeCharacter(encodeCharacter(draft.identity()));
        expect(likenessOfAppearance(saved.look), id).toEqual(expected);
      });
    }
    for (const [key, field] of [['height', 'bodyHeight'], ['width', 'bodyWidth']] as const) {
      for (let i = 0; i < residentChoices[key].options.length; i++) {
        const before = likenessOf(draft.person);
        draft.choose(key, i);
        expect(draft.choice(key)).toBe(i);
        expect(draft.identity().look[field]).toBe(0.75 + 0.125 * i);
        expect(likenessOf(draft.person)).toEqual(before);
      }
    }
    for (const id of Object.keys(residentChoices) as ResidentChoiceId[]) {
      draft.choose(id, 0);
      draft.step(id, -1);
      expect(draft.choice(id), id).toBe(residentChoices[id].options.length - 1);
      draft.step(id, 1);
      expect(draft.choice(id), id).toBe(0);
    }
  });

  it('keeps face marks, both accessories and their dyes independent of the hairstyle and body', () => {
    const draft = draftAtAltar();
    draft.choose('hair', HairCut.CrownBraid);
    draft.choose('beard', Whiskers.LongBeard);
    draft.choose('band', 1);
    draft.choose('kerchief', 1);
    draft.choose('scar', 1);
    draft.choose('freckles', 1);
    draft.choose('paint', 1);
    draft.choose('elder', 1);
    draft.choose('body', 1);
    for (const id of Object.keys(residentColors) as ResidentColorId[]) {
      for (const shade of residentColors[id].palette) {
        draft.setColor(id, shade);
        expect(draft.color(id)).toEqual(shade);
      }
    }
    const colors = { hair: { r: 97, g: 41, b: 22 }, skin: { r: 224, g: 152, b: 98 },
      cloth: { r: 74, g: 92, b: 112 }, kerchief: { r: 63, g: 100, b: 56 } };
    const beforeSkin = draft.identity().look.skinShade;
    draft.setColor('hair', colors.hair);
    expect(draft.identity().look.hairEnd).toEqual(colors.hair);
    expect(draft.identity().look.skinShade).toEqual(beforeSkin);
    for (const id of Object.keys(colors) as ResidentColorId[]) draft.setColor(id, colors[id]);
    draft.choose('kerchief', 0);
    expect(likenessOf(draft.person).kerchief).toBeNull();
    expect(likenessOf(draft.person).band).toBe(true);
    draft.choose('kerchief', 1);
    expect(validCharacter(draft.identity())).toBe(true);
    expect(likenessOfAppearance(decodeCharacter(encodeCharacter(draft.identity())).look)).toMatchObject({
      body: 1, cut: HairCut.CrownBraid, whiskers: Whiskers.LongBeard,
      freckles: true, scar: true, paint: true, elder: true, band: true,
      skin: colors.skin, hair: colors.hair, kerchief: colors.kerchief, wool: colors.cloth,
    });
    for (const cast of residentCast) {
      expect(residentColors.skin.palette).toContainEqual(cast.skin);
      expect(residentColors.hair.palette).toContainEqual(cast.hair);
      if (cast.kerchief) expect(residentColors.kerchief.palette).toContainEqual(cast.kerchief);
    }
  });
});
