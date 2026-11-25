import { expect, it } from 'vitest';
import {
  castMember,
  likenessOf,
  residentCast,
  setResidentLikeness,
  settlerWool,
} from '../../packages/engine/src/character-cast';
import {
  applyCharacter,
  characterPreset,
  decodeCharacter,
  encodeCharacter,
  validCharacter,
} from '../../packages/engine/src/character-preset';
import { point } from '../../packages/engine/src/geometry';
import { BrowCut, EyeCut, HairCut, JawCut, MouthCut } from '../../packages/engine/src/likeness';
import { Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { appearanceOf } from '../../packages/engine/src/person-look';
import { Town } from '../../packages/engine/src/town';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Whiskers } from '../../packages/engine/src/person-appearance';
import {
  characterAssetGroup,
  hairAssetName,
  legacyHairAsset,
} from '../../packages/engine/src/character-reference';
import { characterHair, hairFitAnchors } from '../../packages/native-renderer/src/character-assets';
import { Mood, personPortrait } from '../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../packages/native-renderer/src/portrait-background';
import { serializePaint } from '../../packages/native-renderer/src/paint';
import { PersonParts, personSprite } from '../../packages/native-renderer/src/world-sprites';

const resident = () => new Person(8, 'Runa', Role.Resident, Calling.Settler, Race.Human, 17, point());

it('can hand-pick every cast face without losing its features to an approximate hair or eye shape', () => {
  const preview = resident();
  preview.customLook = appearanceOf(preview);
  for (const member of residentCast) {
    const look = { ...member, wool: settlerWool[2] };
    setResidentLikeness(preview.customLook, look);
    expect(likenessOf(preview)).toEqual(look);
    const preset = characterPreset(preview);
    expect(validCharacter(preset)).toBe(true);
    const copy = resident();
    expect(applyCharacter(copy, decodeCharacter(encodeCharacter(preset)))).toBe(true);
    expect(likenessOf(copy)).toEqual(look);
  }
});

it('keeps the original studio file format for legacy looks and reads resident cuts only in new files', () => {
  const person = resident();
  person.customLook = appearanceOf(person);
  const legacy = encodeCharacter(characterPreset(person));
  expect(legacy.startsWith('hearthold-character 9\n')).toBe(true);
  expect(encodeCharacter(decodeCharacter(legacy))).toBe(legacy);
  setResidentLikeness(person.customLook, castMember(person.look));
  const modern = encodeCharacter(characterPreset(person));
  expect(modern.startsWith('hearthold-character 10\n')).toBe(true);
  expect(() => decodeCharacter(modern.replace('hearthold-character 10', 'hearthold-character 9'))).toThrow();
});

it('shows the closest available reference head throughout the old studio when it opens a resident', () => {
  const person = resident();
  const look = appearanceOf(person);
  for (let cut = HairCut.SidePart; cut <= HairCut.Mane; ++cut) {
    setResidentLikeness(look, { ...castMember(person.look), cut });
    const reference = { ...look, hairAsset: legacyHairAsset(cut) };
    expect(hairAssetName(look.hairAsset)).toBe(hairAssetName(reference.hairAsset));
    expect(characterAssetGroup(look.hairAsset)).toBe(characterAssetGroup(reference.hairAsset));
    expect(hairFitAnchors(look)).toEqual(hairFitAnchors(reference));
    for (const front of [false, true]) {
      expect(serializePaint(characterHair(look, front))).toEqual(
        serializePaint(characterHair(reference, front)),
      );
    }
  }
});

it('stores a complete custom face, both head ornaments and body proportions in an ordinary save', () => {
  const town = new Town(WorldMap.generate(5, 32, 32), 32, false);
  const person = resident();
  const look = {
    ...castMember(person.look),
    cut: HairCut.WarBraid,
    jaw: JawCut.Square,
    eyes: EyeCut.Smile,
    brows: BrowCut.Arched,
    mouth: MouthCut.Wry,
    band: true,
    kerchief: { r: 107, g: 128, b: 92 },
    elder: true,
    scar: true,
    paint: true,
    wool: settlerWool[1],
  };
  person.customLook = appearanceOf(person);
  person.customLook.bodyWidth = 1.25;
  person.customLook.bodyHeight = 0.75;
  setResidentLikeness(person.customLook, look);
  town.folk.push(person);
  const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true)).person(person.id)!;
  expect(likenessOf(loaded)).toEqual(look);
  expect(loaded.customLook).toMatchObject({ bodyWidth: 1.25, bodyHeight: 0.75 });
});

it('draws every facial-hair choice distinctly on both the portrait and the street figure', () => {
  const person = resident();
  person.customLook = appearanceOf(person);
  const portraits = new Set<string>(),
    figures = new Set<string>();
  for (let whiskers = Whiskers.None; whiskers <= Whiskers.LongBeard; ++whiskers) {
    setResidentLikeness(person.customLook, { ...castMember(person.look), whiskers });
    const portrait = personPortrait(person, Mood.Content, 96, 120, portraitBackdrop());
    portraits.add(JSON.stringify(serializePaint(portrait)));
    figures.add(JSON.stringify(serializePaint(personSprite(person, new PersonParts()))));
  }
  expect(portraits.size).toBe(5);
  expect(figures.size).toBe(5);
});
