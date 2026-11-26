// Every first-time moment of the guide in one table: its key, title and text, how it is spotted,
// where the camera looks, the thing it introduces if any, and what an older save counts as already met.
import type { Town } from '../../../../packages/engine/src/town';
import type { Point } from '../../../../packages/engine/src/geometry';
import { centroid } from '../../../../packages/engine/src/geometry';
import { Structure, structureSpec } from '../../../../packages/engine/src/building-catalog';
import { Calling, TreeWorkKind, type Monster, type Person, type TreeWorkEvent } from '../../../../packages/engine/src/person';
import { isWater } from '../../../../packages/engine/src/world-types';
import { CombatCue, MonsterRank, type CombatEvent } from '../../../../packages/engine/src/combat-events';
import { Weather } from '../../../../packages/engine/src/climate';
import { Season } from '../../../../packages/engine/src/town-models';
import { isPlayerBuilding, isPlayerResident } from '../../../../packages/engine/src/faction';
import { burdenFrom, carriedWeight } from '../../../../packages/engine/src/carried-resources';
import { carriedTools, equipmentSlots, equippedItem } from '../../../../packages/engine/src/equipment';
import { gateSealed, sealProgress, sealable } from '../../../../packages/engine/src/gate-seals';
import { completedFacility, deedCount } from '../../../../packages/engine/src/settlement-progression';
import { playing } from '../../../../packages/engine/src/bard-phrases';
import type { DevotionEvent } from '../../../../packages/engine/src/town-devotion';
import type { Building } from '../../../../packages/engine/src/town-models';
import { serpentSighting } from '../../../../packages/native-renderer/src/serpent-ring';
import type { WorldObjectRef } from '../../../../packages/native-renderer/src/world-picking-types';

/** A sentence for the phrase tables: `text` is the key, `values` fill its `{0}`, `{1}`... */
export type Line = string | { readonly text: string; readonly values: readonly (string | number)[] };
export const line = (text: string, ...values: (string | number)[]): Line => ({ text, values });
/** The English a line reads as; the phrase tables translate it whole. */
export const fill = (value: Line): string =>
  typeof value === 'string' ? value : value.text.replace(/\{(\d+)\}/g, (_, n: string) => String(value.values[Number(n)] ?? ''));

/** What a moment saw this frame: where to look (or nowhere), the thing it introduces, and lines worth adding. */
export interface GuideSpot {
  at: Point | null;
  /**
   * The thing the note introduces: something seen for the first time, or someone who waits for the player. It is
   * selected and the note hangs on it (the first, when there are several). None for a first deed (the first tree,
   * kill, level or piece of gear), which is told on a plain card.
   */
  about?: WorldObjectRef[];
  detail?: string[];
}
/** The world as the guide reads it once per frame; event lists hold only what is new since the last frame. */
export interface GuideScan {
  town: Town;
  combat: readonly CombatEvent[];
  trees: readonly TreeWorkEvent[];
  births: readonly DevotionEvent[];
  notices: readonly string[];
  /** Animals alive last frame, to tell a hunt from a monster kill. */
  animals: ReadonlySet<number>;
  /** Gear newly in a player resident's hands this frame. */
  gear: readonly { person: Person; item: string }[];
  /** The first finished building of each kind the player owns. */
  built: ReadonlyMap<Structure, Building>;
  sees(at: Point): boolean;
  /** In sight and well inside the screen, so the player is actually looking at it. */
  shows(at: Point): boolean;
  /** Well inside the screen, seen or not: for what lies out at sea, beyond anyone's sight. */
  frames?(at: Point): boolean;
}
export interface GuideMoment {
  key: string;
  title: Line;
  /** Opens a guide card. Other milestones are recorded quietly. */
  card?: boolean;
  text?(town: Town): readonly Line[];
  spot(scan: GuideScan): GuideSpot | null;
  /** An older save that never kept this record has plainly met it already. */
  met(town: Town): boolean;
  /** Where to look again later, for a log entry rebuilt from a save. */
  where?(town: Town): Point | null;
}

const residents = (town: Town) => town.people().filter((p) => isPlayerResident(p));
const resident = (town: Town, id: number) => {
  const p = town.person(id);
  return isPlayerResident(p) ? p : null;
};
const fresh = (scan: GuideScan, cue: CombatCue, mine = true) =>
  scan.combat.find((e) => e.cue === cue && (!mine || resident(scan.town, e.person)));
const who = (id: number): WorldObjectRef => ({ kind: 'person', id });
const house = (b: Building): WorldObjectRef => ({ kind: 'building', id: b.id });
const gateOf = (index: number): WorldObjectRef => ({ kind: 'dungeon', id: index });
const beast = (id: number): WorldObjectRef => ({ kind: 'monster', id });
/** The renderer's landmarks: Odin's statue, Fire Mountain, Hvergelmir, Thor. */
const landmark = (id: 0 | 1 | 2 | 3): WorldObjectRef => ({ kind: 'landmark', id });
const felled = (scan: GuideScan, kind: TreeWorkKind) => {
  const e = scan.trees.find((event) => event.kind === kind && resident(scan.town, event.person));
  return e ? { at: e.worker } : null;
};
const notice = (scan: GuideScan, pattern: RegExp) => scan.notices.find((text) => pattern.test(text));
const played = (town: Town) => town.buildings().some((b) => b.built() && isPlayerBuilding(b));
const builtOf = (town: Town, kind: Structure) =>
  town.buildings().find((b) => b.kind === kind && b.built() && isPlayerBuilding(b)) ?? null;
const sealableGates = (town: Town) =>
  town
    .map()
    .dungeons()
    .map((site, index) => ({ site, index }))
    .filter(({ site }) => sealable(site));
const gateFront = (town: Town, index: number): Point | null => {
  const site = town.map().dungeons()[index];
  return site ? { x: site.origin.x + 1, y: site.origin.y + 2.3 } : null;
};
const firstGate = (town: Town) => sealableGates(town).find(({ site }) => site.discovered) ?? null;
const hostile = (m: Monster) => m.animal === null && m.health > 0 && !m.insideLair;
const named = (town: Town, name: string) => residents(town).find((p) => p.name === name) ?? null;
const bones = (town: Town) =>
  [town.provisions, ...town.settlements().filter((v) => v.faction === town.controlFaction)].reduce(
    (sum, v) => sum + v.stock.bones,
    0,
  );
const fighters = (town: Town) => residents(town).some((p) => p.calling >= Calling.Warrior);

const craftedNotice = /^(.+) crafted (.+)$/,
  huntedNotice = / hunted \((carrying \d+|\+\d+) food\)$/,
  raidNotice = / will raid Camp #(\d+) tonight$/;

const moments: GuideMoment[] = [
  {
    key: 'opening',
    title: 'Askr and Embla',
    card: true,
    text: () => ['Found your first camp from the Quests panel.'],
    spot: (scan) => (scan.town.awaiting ? { at: null, about: residents(scan.town).map((p) => who(p.id)) } : null),
    met: () => true,
  },
  // Gathering
  {
    key: 'wood',
    title: 'The first tree is down',
    spot: (scan) => felled(scan, TreeWorkKind.Fall),
    met: (town) => played(town) || town.stock().wood > 0,
  },
  {
    key: 'stone',
    title: 'The first stone is broken',
    spot: (scan) => felled(scan, TreeWorkKind.Shatter),
    met: (town) => town.stock().stone > 0 || completedFacility(town, Structure.Quarry),
  },
  {
    key: 'food',
    title: 'Food from the hunt',
    spot: (scan) => {
      const hunt = notice(scan, huntedNotice);
      if (!hunt) return null;
      const kill = scan.combat.find((e) => e.cue === CombatCue.Kill && scan.animals.has(e.creature));
      return { at: kill?.position ?? null };
    },
    met: played,
  },
  {
    key: 'bones',
    title: 'Bones',
    spot: (scan) => (bones(scan.town) > 0 ? { at: null } : null),
    met: (town) => bones(town) > 0 || town.chronicle.monstersSlain > 0,
  },
  {
    key: 'burden',
    title: 'A heavy load',
    spot: (scan) => {
      const p = residents(scan.town).find((r) => carriedWeight(r) > burdenFrom(r));
      return p ? { at: p.position } : null;
    },
    met: played,
  },
  // Making
  {
    key: 'craft',
    title: 'The first piece of gear',
    spot: (scan) => {
      const made = notice(scan, craftedNotice);
      if (!made) return null;
      const maker = named(scan.town, craftedNotice.exec(made)?.[1] ?? '');
      return { at: maker?.position ?? null, detail: [made] };
    },
    met: (town) =>
      town.chronicle.weaponsForged > 0 ||
      residents(town).some((p) => carriedTools(p).length > 0 || equipmentSlots.some((slot) => equippedItem(p, slot))),
  },
  {
    key: 'equip',
    title: 'Gear in hand',
    spot: (scan) => {
      const first = scan.gear[0];
      return first ? { at: first.person.position } : null;
    },
    met: (town) => residents(town).some((p) => carriedTools(p).length > 0 || equipmentSlots.some((slot) => equippedItem(p, slot))),
  },
  {
    key: 'field',
    title: 'The first field',
    spot: (scan) => {
      const plot = scan.town.fields().find((f) => f.faction === scan.town.controlFaction);
      return plot ? { at: centroid(plot.outline) } : null;
    },
    met: (town) => town.fieldAcres() > 0,
    where: (town) => {
      const plot = town.fields().find((f) => f.faction === town.controlFaction);
      return plot ? centroid(plot.outline) : null;
    },
  },
  {
    key: 'road',
    title: 'The first road',
    spot: (scan) => {
      const road = playerRoad(scan.town);
      return road ? { at: road } : null;
    },
    met: (town) => !!playerRoad(town),
    where: playerRoad,
  },
  // The world
  {
    key: 'gate',
    title: 'A hostile dungeon',
    card: true,
    text: () => ['Select the dungeon and choose Attack.'],
    spot: (scan) => {
      for (const { site, index } of sealableGates(scan.town)) {
        const at = gateFront(scan.town, index);
        if (site.discovered && at && scan.shows(at)) return { at, about: [gateOf(index)] };
      }
      return null;
    },
    met: (town) => !!firstGate(town),
    where: (town) => {
      const gate = firstGate(town);
      return gate ? gateFront(town, gate.index) : null;
    },
  },
  {
    key: 'statue',
    title: 'Odin\'s statue',
    card: true,
    text: () => ['Here Odin gave life to two trees.'],
    spot: (scan) => {
      const at = statue(scan.town);
      return at && scan.shows(at) ? { at, about: [landmark(0)] } : null;
    },
    met: (town) => !!statue(town),
    where: statue,
  },
  {
    key: 'thor',
    title: 'Thor comes to Midgard',
    card: true,
    text: () => ['The thunder god has come to stay.'],
    spot: (scan) => {
      const thor = scan.town.thor;
      return thor.present && scan.shows(thor.position) ? { at: { ...thor.position }, about: [landmark(3)] } : null;
    },
    met: (town) => town.thor.visits > 0,
  },
  {
    key: 'serpent',
    title: 'Jormungandr',
    card: true,
    text: () => ['The world serpent circles Midgard with its tail in its jaws.'],
    spot: (scan) => {
      const at = serpentSighting(scan.town, (p) => scan.frames?.(p) ?? scan.shows(p));
      return at ? { at } : null;
    },
    met: () => false,
  },
  {
    key: 'volcano',
    title: 'Fire Mountain',
    card: true,
    text: () => ['Smoke rises from the southern slopes.'],
    spot: (scan) => {
      const at = volcano(scan.town);
      return at && scan.shows(at) ? { at, about: [landmark(1)] } : null;
    },
    met: (town) => !!volcano(town),
    where: volcano,
  },
  {
    key: 'spring',
    title: 'Hvergelmir',
    card: true,
    text: () => ['The rivers of Midgard rise here.'],
    spot: (scan) => {
      const at = spring(scan.town);
      return at && scan.shows(at) ? { at, about: [landmark(2)] } : null;
    },
    met: (town) => !!spring(town),
    where: spring,
  },
  {
    key: 'night',
    title: 'Night falls',
    spot: (scan) => (scan.town.climate().night > 0.5 ? { at: null } : null),
    met: (town) => town.days >= 1,
  },
  {
    key: 'rain',
    title: 'Rain',
    spot: (scan) => {
      const sky = scan.town.climate();
      return (sky.weather === Weather.Rain || sky.weather === Weather.Storm) && sky.intensity > 0.2 ? { at: null } : null;
    },
    met: () => false,
  },
  {
    key: 'snow',
    title: 'Snow',
    spot: (scan) => {
      const sky = scan.town.climate();
      return sky.weather === Weather.Snow && sky.intensity > 0.2 ? { at: null } : null;
    },
    met: () => false,
  },
  {
    key: 'winter',
    title: 'Winter',
    spot: (scan) => (scan.town.calendar().season === Season.Winter ? { at: null } : null),
    met: (town) => town.calendar().year > 1 || town.calendar().season === Season.Winter,
  },
  {
    key: 'born',
    title: 'A newcomer from the altar',
    spot: (scan) => {
      const birth = scan.births.find((e) => resident(scan.town, e.person));
      if (!birth) return null;
      const newcomer = resident(scan.town, birth.person);
      return { at: birth.position, detail: newcomer ? [line('{0} joins the settlement', newcomer.name)].map(fill) : [] };
    },
    met: (town) => residents(town).length + town.fallen.length > 2,
  },
  // Danger
  {
    key: 'monster',
    title: 'A monster',
    spot: (scan) => {
      const foe = scan.town.monsters().find((m) => hostile(m) && m.rank !== MonsterRank.Den && scan.sees(m.position));
      if (foe) return { at: foe.position, about: [beast(foe.id)] };
      // One that came and fell between two looks was still met.
      const kill = scan.combat.find((e) => e.cue === CombatCue.Kill && !scan.animals.has(e.creature) && resident(scan.town, e.person));
      return kill ? { at: kill.position } : null;
    },
    met: (town) => town.chronicle.monstersSlain > 0 || town.raids() > 0,
  },
  {
    key: 'kill',
    title: 'The first kill',
    spot: (scan) => {
      const kill = scan.combat.find(
        (e) => e.cue === CombatCue.Kill && !scan.animals.has(e.creature) && resident(scan.town, e.person),
      );
      return kill ? { at: kill.position } : null;
    },
    met: (town) => town.chronicle.monstersSlain > 0,
  },
  {
    key: 'downed',
    title: 'A resident is down',
    card: true,
    text: () => ['Send a settler to revive their fallen ally.'],
    spot: (scan) => {
      const e = scan.combat.find(
        (event) => event.cue === CombatCue.Downed && (resident(scan.town, event.person) || fallenOf(scan.town, event.person)),
      );
      return e ? { at: e.position, about: resident(scan.town, e.person) ? [who(e.person)] : [] } : null;
    },
    met: (town) => town.chronicle.rescues > 0 || town.fallen.length > 0,
  },
  {
    key: 'death',
    title: 'A resident has died',
    spot: (scan) => {
      const e = scan.combat.find((event) => event.cue === CombatCue.Death && fallenOf(scan.town, event.person));
      return e ? { at: e.position } : null;
    },
    met: (town) => town.fallen.length > 0,
  },
  {
    key: 'raid',
    title: 'A raid is coming',
    spot: (scan) => {
      const warning = notice(scan, raidNotice);
      if (!warning) return null;
      const camp = scan.town.building(Number(raidNotice.exec(warning)![1]) - 1);
      return { at: camp?.center ?? null, about: camp ? [house(camp)] : [] };
    },
    met: (town) => town.raids() > 0,
  },
  {
    key: 'wave',
    title: 'The raid is here',
    spot: (scan) => {
      const e = fresh(scan, CombatCue.Wave, false);
      return e ? { at: e.position } : null;
    },
    met: (town) => town.raids() > 0,
  },
  {
    key: 'breach',
    title: 'The guardian is rising',
    spot: ({ town, sees }) => {
      for (const [gate, siege] of town.sieges.entries()) {
        if (!siege || siege.health > 0 || siege.guardian >= 0) continue;
        const at = gateFront(town, gate);
        if (at && sees(at)) return { at };
      }
      return null;
    },
    met: town => town.chronicle.partiesLed > 0,
  },
  {
    key: 'guardian',
    title: 'The guardian',
    spot: (scan) => {
      const g = scan.town.monsters().find(m => m.rank === MonsterRank.Guardian && m.health > 0 && scan.sees(m.position));
      return g ? { at: g.position, about: [beast(g.id)] } : null;
    },
    met: (town) => town.chronicle.guardiansSlain > 0 || deedCount(town, 'floors') > 0,
  },
  {
    key: 'sealed',
    title: 'A gate is sealed',
    spot: (scan) => {
      const gate = sealedGate(scan.town);
      return gate !== null ? { at: gateFront(scan.town, gate) } : null;
    },
    met: (town) => sealProgress(town).sealed > 0,
    where: (town) => {
      const gate = sealedGate(town);
      return gate !== null ? gateFront(town, gate) : null;
    },
  },
  {
    key: 'level',
    title: 'A new level',
    spot: (scan) => {
      const e = fresh(scan, CombatCue.LevelUp);
      const hero = e ? resident(scan.town, e.person) : null;
      return e && hero ? { at: e.position, detail: [line('{0} reached level {1}!', hero.name, e.amount)].map(fill) } : null;
    },
    met: (town) => residents(town).some((p) => p.level > 1),
  },
  {
    key: 'skill',
    title: 'A skill',
    spot: (scan) => {
      const e = scan.combat.find((event) => event.cue === CombatCue.Ability && event.skill && resident(scan.town, event.person));
      const caster = e ? resident(scan.town, e.person) : null;
      return e && caster ? { at: e.position, detail: [fill(line('{0} used {1}', caster.name, e.text))] } : null;
    },
    met: (town) => fighters(town) && town.chronicle.monstersSlain > 0,
  },
  {
    key: 'skill2',
    title: 'A second skill',
    spot: (scan) => {
      for (const p of residents(scan.town)) {
        const second = scan.town.skillsOf(p)[1];
        if (second && !second.locked) return { at: p.position, detail: [fill(line('{0} learned {1}', p.name, second.name))] };
      }
      return null;
    },
    met: (town) => residents(town).some((p) => !(town.skillsOf(p)[1]?.locked ?? true)),
  },
  {
    key: 'bard',
    title: 'A bard plays',
    spot: (scan) => {
      const bard = scan.town
        .people()
        .find((p) => p.calling === Calling.Bard && playing(p, scan.town.clock()) && scan.shows(p.position));
      return bard ? { at: bard.position, about: [who(bard.id)] } : null;
    },
    met: () => false,
  },
];
function playerRoad(town: Town): Point | null {
  const road = town
    .roads()
    .roads()
    .find((r) => r.built >= 1 && isPlayerBuilding(town.camp(r.village)));
  return road ? (road.line[Math.floor(road.line.length / 2)] ?? null) : null;
}
function statue(town: Town): Point | null {
  const giant = town.map().giant();
  return giant && town.map().revealed(giant.center()) ? giant.center() : null;
}
function volcano(town: Town): Point | null {
  const fire = town.map().volcano();
  return fire && town.map().revealed(fire.center()) ? fire.center() : null;
}
function spring(town: Town): Point | null {
  const map = town.map(),
    at = map.hvergelmir();
  return map.giant() && map.inside(Math.floor(at.x), Math.floor(at.y)) && map.revealed(at) && isWater(map.terrainAt(at)) ? at : null;
}
function sealedGate(town: Town): number | null {
  const gate = sealableGates(town).find(({ index }) => gateSealed(town, index));
  return gate ? gate.index : null;
}
function fallenOf(town: Town, id: number) {
  return town.fallen.find((f) => f.id === id) ?? null;
}

// One entry for the first finished building of each kind, from the catalog. What it opens is told by the
// card each new building gets when it comes into the build menu.
const buildingMoments: GuideMoment[] = Array.from({ length: Structure.Count }, (_, kind: Structure) => ({
  key: `built:${Structure[kind]}`,
  title: line('New building: {0}', structureSpec(kind).name),
  card: kind === Structure.Farm,
  text: () => kind === Structure.Farm ? ['Assign a farmer at the farmhouse.'] : [],
  spot: (scan: GuideScan) => {
    const b = scan.built.get(kind);
    return b ? { at: b.center, about: [house(b)] } : null;
  },
  met: (town: Town) => completedFacility(town, kind),
  where: (town: Town) => builtOf(town, kind)?.center ?? null,
}));

/** Every moment, in the order they are checked each frame. */
export const guideMoments: readonly GuideMoment[] = [...moments, ...buildingMoments];
const byKey = new Map(guideMoments.map((m) => [m.key, m]));
export const guideMoment = (key: string): GuideMoment | null => byKey.get(key) ?? null;
/** The engine notices the guide reads, for tests. */
export const guideNoticePatterns = { craftedNotice, huntedNotice, raidNotice };
