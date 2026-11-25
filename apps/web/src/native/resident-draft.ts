import type { Rgb } from '../../../../packages/engine/src/building-catalog';
import { decodeAppearanceCode, encodeAppearanceCode } from '../../../../packages/engine/src/appearance-code';
import {
  castHair,
  castKerchiefs,
  castMember,
  castSkins,
  likenessOfAppearance,
  setResidentLikeness,
  settlerWool,
} from '../../../../packages/engine/src/character-cast';
import { characterPreset, refreshShades } from '../../../../packages/engine/src/character-preset';
import { hairAssetName } from '../../../../packages/engine/src/character-reference';
import type { Point } from '../../../../packages/engine/src/geometry';
import { HairCut, type Likeness } from '../../../../packages/engine/src/likeness';
import { hash01 } from '../../../../packages/engine/src/numeric';
import { Calling, Person, Race, Role } from '../../../../packages/engine/src/person';
import { appearanceOf } from '../../../../packages/engine/src/person-look';
import type { Town } from '../../../../packages/engine/src/town';
import { humanNames } from '../../../../packages/engine/src/town-residents';
import { TextInput } from '../../../../packages/native-ui/src';

const yesNo = ['Off', 'On'];
const bodyScales = [0.75, 0.875, 1, 1.125, 1.25];
export const residentChoices = {
  body: { label: 'Body type', options: ['Male', 'Female'] },
  height: { label: 'Height', options: ['Very short', 'Short', 'Average', 'Tall', 'Very tall'] },
  width: { label: 'Body build', options: ['Slender', 'Lean', 'Average', 'Broad', 'Stout'] },
  hair: {
    label: 'Hair',
    options: [
      ...Array.from({ length: HairCut.Topknot }, (_, i) => hairAssetName(i)),
      'Topknot', 'War braid', 'Crown braid', 'Side braid', 'Mane',
    ],
  },
  beard: {
    label: 'Facial hair',
    options: ['Clean-shaven', 'Stubble', 'Moustache', 'Short beard', 'Long beard'],
  },
  jaw: { label: 'Jaw', options: ['Soft jaw', 'Round jaw', 'Square jaw', 'Narrow jaw'] },
  eyes: {
    label: 'Eyes',
    options: ['Oval eyes', 'Round eyes', 'Low lids', 'Wide eyes', 'Almond eyes', 'Smiling eyes', 'Slit eyes'],
  },
  brows: {
    label: 'Eyebrows',
    options: ['None', 'Soft brows', 'Straight brows', 'Stern brows', 'Arched brows', 'Heavy brows'],
  },
  band: { label: 'Headband', options: yesNo },
  kerchief: { label: 'Kerchief', options: yesNo },
  freckles: { label: 'Freckles', options: yesNo },
  scar: { label: 'Scar', options: yesNo },
  paint: { label: 'Face paint', options: yesNo },
  elder: { label: 'Age lines', options: yesNo },
} as const;
export type ResidentChoiceId = keyof typeof residentChoices;

export const residentColors = {
  skin: { label: 'Skin tone', palette: castSkins },
  hair: { label: 'Hair color', palette: castHair },
  cloth: { label: 'Tunic dye', palette: settlerWool },
  kerchief: { label: 'Kerchief dye', palette: [...castKerchiefs, ...settlerWool] },
} as const;
export type ResidentColorId = keyof typeof residentColors;

const features = {
  body: 'body', hair: 'cut', beard: 'whiskers', jaw: 'jaw', eyes: 'eyes', brows: 'brows',
  band: 'band', freckles: 'freckles', scar: 'scar', paint: 'paint', elder: 'elder',
} as const satisfies Partial<Record<ResidentChoiceId, keyof Likeness>>;

/** A creation preview draws its names and whole cast members from its own deterministic sequence. */
export class ResidentDraft {
  readonly person: Person;
  readonly name: TextInput;
  private readonly seed: number;
  private readonly names: readonly string[];
  private lookIndex = 0;
  private nameIndex = 0;

  constructor(town: Town, at: Point) {
    this.seed = Math.floor(hash01(town.world.seed(), town.nextPerson, town.controlFaction, 821) * 0x100000000);
    const used = new Set(town.people().map((resident) => resident.name));
    const available = humanNames.filter((name) => !used.has(name));
    this.names = available.length ? available : humanNames;
    this.name = new TextInput('');
    this.person = new Person(town.nextPerson, '', Role.Resident, Calling.Settler, Race.Human, this.seed, { ...at });
    this.randomName();
    this.randomLook();
  }
  randomName(): void {
    const first = Math.floor(hash01(this.seed, 0, 0, 823) * this.names.length);
    this.name.value = this.names[(first + this.nameIndex++) % this.names.length];
    this.name.cursor = this.name.byteLength();
  }
  randomLook(): void {
    const p = this.person;
    p.look = Math.floor(hash01(this.seed, this.lookIndex++, 0, 827) * 0x100000000);
    p.customLook = null;
    p.customLook = appearanceOf(p);
    const cast = castMember(p.look);
    setResidentLikeness(p.customLook, cast);
    ++p.lookRevision;
  }
  appearanceCode(): string {
    return encodeAppearanceCode(this.person.customLook!);
  }
  applyAppearanceCode(code: string): boolean {
    const look = decodeAppearanceCode(code);
    if (!look) return false;
    this.person.customLook = look;
    ++this.person.lookRevision;
    return true;
  }
  choice(id: ResidentChoiceId): number {
    const a = this.person.customLook!;
    if (id === 'height' || id === 'width') {
      const value = id === 'height' ? a.bodyHeight : a.bodyWidth;
      return bodyScales.reduce((nearest, scale, i) =>
        Math.abs(scale - value) < Math.abs(bodyScales[nearest] - value) ? i : nearest, 0);
    }
    const look = likenessOfAppearance(a);
    return id === 'kerchief' ? Number(look.kerchief !== null) : Number(look[features[id]]);
  }
  step(id: ResidentChoiceId, direction: number): void {
    const count = residentChoices[id].options.length;
    this.choose(id, ((this.choice(id) + direction) % count + count) % count);
  }
  choose(id: ResidentChoiceId, index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= residentChoices[id].options.length) return;
    const a = this.person.customLook!;
    if (id === 'height') a.bodyHeight = bodyScales[index];
    else if (id === 'width') a.bodyWidth = bodyScales[index];
    else {
      const look = likenessOfAppearance(a);
      if (id === 'kerchief') look.kerchief = index ? { ...a.trim } : null;
      else {
        const field = features[id];
        Object.assign(look, { [field]: typeof look[field] === 'boolean' ? Boolean(index) : index });
      }
      setResidentLikeness(a, look);
    }
    ++this.person.lookRevision;
  }
  color(id: ResidentColorId): Rgb {
    const a = this.person.customLook!;
    return { ...a[id === 'kerchief' ? 'trim' : id] };
  }
  setColor(id: ResidentColorId, color: Rgb): void {
    if (![color.r, color.g, color.b].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return;
    const a = this.person.customLook!;
    a[id === 'kerchief' ? 'trim' : id] = { ...color };
    if (id !== 'kerchief') {
      const shades = { ...a }, shade = `${id}Shade` as const;
      refreshShades(shades);
      a[shade] = shades[shade];
      if (id === 'hair') a.hairEnd = { ...color };
    }
    ++this.person.lookRevision;
  }
  identity() {
    return { ...characterPreset(this.person), name: this.name.value.trim() };
  }
}
