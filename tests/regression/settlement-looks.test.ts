import { expect, it } from 'vitest';
import { settlementLooks } from '../../apps/web/src/native/settlement-looks';
import { decodeAppearanceCode, encodeAppearanceCode } from '../../packages/engine/src/appearance-code';
import { castMember, setResidentLikeness } from '../../packages/engine/src/character-cast';
import { point } from '../../packages/engine/src/geometry';
import { HairCut } from '../../packages/engine/src/likeness';
import { Activity, Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { Whiskers } from '../../packages/engine/src/person-appearance';
import { appearanceOf } from '../../packages/engine/src/person-look';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { foundingPeople } from '../../packages/engine/src/ymir-born';
import { serializePaint } from '../../packages/native-renderer/src/paint';
import { Mood, personPortrait } from '../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../packages/native-renderer/src/portrait-background';
import { PersonParts, personSprite } from '../../packages/native-renderer/src/world-sprites';

const village = () => new Town(WorldMap.generate(5, 32, 32), 32, false);
function add(town: Town, name: string): Person {
  const resident = new Person(
    town.nextPerson++,
    name,
    Role.Resident,
    Calling.Settler,
    Race.Human,
    17,
    point(),
  );
  resident.customLook = appearanceOf(resident);
  resident.faction = town.controlFaction;
  town.folk.push(resident);
  return resident;
}

it('recovers the rendered design of residents authored before and after the altar creator from the town save', () => {
  const town = village();
  const early = add(town, 'Eydis'),
    later = add(town, 'Liv');
  Object.assign(early.customLook!, {
    eyeHeight: 0.65,
    browVisible: true,
    browWeight: 2,
    bodyWidth: 1.125,
    whiskers: Whiskers.LongBeard,
  });
  setResidentLikeness(later.customLook!, {
    ...castMember(17),
    cut: HairCut.Mane,
    kerchief: { r: 97, g: 78, b: 65 },
  });
  const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true));
  const designs = settlementLooks(loaded);
  expect(designs.map(({ name }) => name)).toEqual(['Eydis', 'Liv']);
  for (const [index, row] of designs.entries()) {
    const original = loaded.people()[index];
    const copy = new Person(11, 'New resident', Role.Resident, Calling.Settler, Race.Human, 39, point());
    copy.customLook = decodeAppearanceCode(row.code);
    expect(copy.customLook).not.toBeNull();
    const portrait = (p: Person) =>
      serializePaint(personPortrait(p, Mood.Content, 86, 90, portraitBackdrop()));
    const figure = (p: Person) => serializePaint(personSprite(p, new PersonParts()));
    expect(portrait(copy)).toEqual(portrait(original));
    expect(figure(copy)).toEqual(figure(original));
  }
});

it('lists living designed humans of the controlled faction and skips unreproducible records independently', () => {
  const town = village();
  town.controlFaction = 3;
  add(town, 'Unedited').customLook = null;
  add(town, 'Visitor').role = Role.Guest;
  add(town, 'God').race = Race.God;
  add(town, 'Giant').race = Race.Giant;
  add(town, 'Outsider').faction = 0;
  add(town, 'Gone').health = 0;
  add(town, 'Departing').activity = Activity.Leaving;
  add(town, 'Old proportions').customLook!.bodyWidth = 1.5;
  for (const founder of foundingPeople) {
    for (const past of [founder.past, ...founder.formerPasts]) add(town, founder.name).past = past;
  }
  const survivor = add(town, 'Askr');
  survivor.health = 0;
  survivor.downedAt = 3;
  expect(settlementLooks(town)).toEqual([
    { name: survivor.name, code: encodeAppearanceCode(survivor.customLook!) },
  ]);
});
