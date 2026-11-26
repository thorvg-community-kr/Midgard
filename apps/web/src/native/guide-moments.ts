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
import { secondSkillLevel } from '../../../../packages/engine/src/skill-catalog';
import { playing } from '../../../../packages/engine/src/bard-phrases';
import type { DevotionEvent } from '../../../../packages/engine/src/town-devotion';
import type { Building } from '../../../../packages/engine/src/town-models';
import { serpentSighting } from '../../../../packages/native-renderer/src/serpent-ring';
import type { WorldObjectRef } from '../../../../packages/native-renderer/src/world-picking-types';
import { siegeLesson } from './dungeon-attack';

/** A sentence for the phrase tables: `text` is the key, `values` fill its `{0}`, `{1}`... */
export type Line = string | { readonly text: string; readonly values: readonly (string | number)[] };
export const line = (text: string, ...values: (string | number)[]): Line => ({ text, values });
/** The English a line reads as; the phrase tables translate it whole. */
export const fill = (value: Line): string =>
  typeof value === 'string' ? value : value.text.replace(/\{(\d+)\}/g, (_, n: string) => String(value.values[Number(n)] ?? ''));

/** What a moment saw this frame: where to look (or nowhere), the thing it introduces, lines worth adding, notices it replaces. */
export interface GuideSpot {
  at: Point | null;
  /**
   * The thing the note introduces: something seen for the first time, or someone who waits for the player. It is
   * selected and the note hangs on it (the first, when there are several). None for a first deed (the first tree,
   * kill, level or piece of gear), which is told on a plain card.
   */
  about?: WorldObjectRef[];
  detail?: string[];
  fold?: string[];
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
  text(town: Town): readonly Line[];
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
  inHandNotice = /^(.+) in hand · /,
  huntedNotice = / hunted \((carrying \d+|\+\d+) food\)$/,
  raidNotice = / will raid Camp #(\d+) tonight$/;

const moments: GuideMoment[] = [
  {
    key: 'opening',
    title: 'The founders wait for your word',
    text: () => [
      'The founders stand where they woke and do nothing until you act.',
      'Select them and give an order, or found a camp from the Quests panel. Once you do, they go about their work by themselves.',
    ],
    spot: (scan) => (scan.town.awaiting ? { at: null, about: residents(scan.town).map((p) => who(p.id)) } : null),
    met: () => true,
  },
  // Gathering
  {
    key: 'wood',
    title: 'The first tree is down',
    text: () => [
      'A felled tree gives wood. It rides in the feller\'s pack until the pack grows heavy; then they carry it to storage.',
      'A wooden axe fells trees faster than bare hands.',
    ],
    spot: (scan) => felled(scan, TreeWorkKind.Fall),
    met: (town) => played(town) || town.stock().wood > 0,
  },
  {
    key: 'stone',
    title: 'The first stone is broken',
    text: () => [
      'Rocky ground gives stone, carried like wood in the pack.',
      'A wooden pick breaks stone faster than bare hands. A quarry needs rocky ground close by.',
    ],
    spot: (scan) => felled(scan, TreeWorkKind.Shatter),
    met: (town) => town.stock().stone > 0 || completedFacility(town, Structure.Quarry),
  },
  {
    key: 'food',
    title: 'Food from the hunt',
    text: () => [
      'Hunt for early meals. Feed and water hens for eggs or cows for milk. Farmers grow crops in watered fields.',
      'Game grows scarce in winter, so lay food by before it comes.',
    ],
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
    text: () => [
      'Hunted animals and slain monsters leave bones, which go straight to storage.',
      'Bones can go on the altar alongside food. Every four extra goods give the new settler a point in strength or vitality.',
    ],
    spot: (scan) => (bones(scan.town) > 0 ? { at: null } : null),
    met: (town) => bones(town) > 0 || town.chronicle.monstersSlain > 0,
  },
  {
    key: 'burden',
    title: 'A heavy load',
    text: () => [
      'A heavy pack slows a resident down, and the fuller it gets, the slower they walk.',
      'They empty the pack at storage, so a store near the work saves long walks.',
    ],
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
    text: () => [
      'Gear is crafted from the settlement\'s stores, one piece at a time: tools at the workbench, weapons, shields and armor at the smithy.',
      'A tool works straight from the pack; a weapon, a shield or armor goes into a free slot it fits.',
    ],
    spot: (scan) => {
      const made = notice(scan, craftedNotice);
      if (!made) return null;
      const maker = named(scan.town, craftedNotice.exec(made)?.[1] ?? '');
      return { at: maker?.position ?? null, detail: [made], fold: [made] };
    },
    met: (town) =>
      town.chronicle.weaponsForged > 0 ||
      residents(town).some((p) => carriedTools(p).length > 0 || equipmentSlots.some((slot) => equippedItem(p, slot))),
  },
  {
    key: 'equip',
    title: 'Gear in hand',
    text: () => [
      'Tools speed their work from the pack. A resident with no weapon equipped fights with their strongest tool. Shields block blows and armor reduces damage.',
      'Compare attack before and after equipping a weapon. A higher scaling bonus means more of that attribute counts toward the attack.',
    ],
    spot: (scan) => {
      const held = notice(scan, inHandNotice),
        first = scan.gear[0];
      if (!held && !first) return null;
      return { at: first?.person.position ?? null, detail: held ? [held] : [], fold: held ? [held] : [] };
    },
    met: (town) => residents(town).some((p) => carriedTools(p).length > 0 || equipmentSlots.some((slot) => equippedItem(p, slot))),
  },
  {
    key: 'field',
    title: 'The first field',
    text: () => [
      'Farmhands till the soil, sow seeds, water the rows, tend the crop and harvest the grain.',
      'Keep water in the camp stores. One farmer takes about a week to bring in a crop. Fields rest in winter.',
    ],
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
    text: () => [
      'Residents walk faster on a road, and faster still once it is paved.',
      'Lumberyards and quarries haul along roads: they open once a road is finished.',
    ],
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
    title: 'A gate to another world',
    text: () => [
      'Raiders pour out of this dungeon and march on the camp. Press Attack to send your fighters.',
      siegeLesson,
    ],
    // A gate the map already knows of is no news until the player has it in front of them.
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
    text: () => [
      'The Allfather\'s likeness in stone stands by the founding shore, where the first two woke.',
      'Once a tent and a farmhouse stand, build an altar at home. Set aside four food and a bed to welcome another settler.',
    ],
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
    text: () => [
      'Thor, the god of thunder, has come to stay a few nights. He is a guest: he takes no orders, and no monster can harm him.',
      'By day he enjoys the settlement. By night he hunts the monsters that come near it. While he stays, rain brings storms and far more lightning.',
    ],
    spot: (scan) => {
      const thor = scan.town.thor;
      return thor.present && scan.shows(thor.position) ? { at: { ...thor.position }, about: [landmark(3)] } : null;
    },
    met: (town) => town.thor.visits > 0,
  },
  {
    key: 'serpent',
    title: 'Jormungandr',
    text: () => [
      'The world serpent lies in the sea around Midgard, so long that it holds its own tail in its jaws.',
      'It rises only in foul weather and sinks again when the sky clears. It does no harm to the land or its people.',
    ],
    spot: (scan) => {
      const at = serpentSighting(scan.town, (p) => scan.frames?.(p) ?? scan.shows(p));
      return at ? { at } : null;
    },
    met: () => false,
  },
  {
    key: 'volcano',
    title: 'Fire Mountain',
    text: () => ['A volcano smokes in the south of Midgard. Its slopes are bare mountain rock that no one can cross or build on.'],
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
    text: () => [
      'The deep spring in the north from which the rivers flow.',
      'A staffed well supplies drinking water and water for crops and livestock. It draws more near a lake or river.',
    ],
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
    text: () => [
      'Residents keep working after dark and take a break when they are tired.',
      'Resting under a roof restores energy faster. Open dungeons send raiders every night.',
    ],
    spot: (scan) => (scan.town.climate().night > 0.5 ? { at: null } : null),
    met: (town) => town.days >= 1,
  },
  {
    key: 'rain',
    title: 'Rain',
    text: () => ['Rain wears on residents caught outdoors, and a storm wears on them more. A roof or an evening at the tavern sets them right.'],
    spot: (scan) => {
      const sky = scan.town.climate();
      return (sky.weather === Weather.Rain || sky.weather === Weather.Storm) && sky.intensity > 0.2 ? { at: null } : null;
    },
    met: () => false,
  },
  {
    key: 'snow',
    title: 'Snow',
    text: () => ['Deep snow slows walking, and the cold wears on anyone without a roof.'],
    spot: (scan) => {
      const sky = scan.town.climate();
      return sky.weather === Weather.Snow && sky.intensity > 0.2 ? { at: null } : null;
    },
    met: () => false,
  },
  {
    key: 'winter',
    title: 'Winter',
    text: () => [
      'Fields lie fallow and game is scarce, so the settlement lives on what it stored.',
      'Keep everyone housed. The cold wears on anyone sleeping out.',
    ],
    spot: (scan) => (scan.town.calendar().season === Season.Winter ? { at: null } : null),
    met: (town) => town.calendar().year > 1 || town.calendar().season === Season.Winter,
  },
  {
    key: 'born',
    title: 'A newcomer from the altar',
    text: () => [
      'Each newcomer starts as a settler. Give them a tool for their first job.',
      'When the guild is ready, you can send a settler there to learn a fighting calling.',
    ],
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
    text: () => [
      'Monsters climb out of the gates. Swarmers are small and quick and fall to a blow or two, but they come in numbers.',
      'Fight them together, not one by one: select residents, press A and click to attack-move.',
    ],
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
    text: () => [
      'Defeating a monster gives experience to the killer and to allies fighting nearby. Many monsters leave bones.',
      'Levels improve endurance and unlock gear. Match a weapon to the resident’s strongest attribute for harder hits.',
    ],
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
    text: () => [
      'A resident at the end of their strength falls, and bleeds out unless an ally kneels beside them in time.',
      'Select a standing ally and right-click the fallen to raise them. The wound lingers for a few days and keeps their health low until it heals.',
    ],
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
    text: () => [
      'The dead do not come back. The memorial keeps their name and deeds.',
      'The settlement grieves; a runestone that names the fallen eases the grief.',
    ],
    spot: (scan) => {
      const e = scan.combat.find((event) => event.cue === CombatCue.Death && fallenOf(scan.town, event.person));
      return e ? { at: e.position } : null;
    },
    met: (town) => town.fallen.length > 0,
  },
  {
    key: 'raid',
    title: 'A raid is coming',
    text: () => [
      'The first raiders fall to a single blow. Later waves bring more enemies and their levels rise.',
      'Gather fighters at the camp named in the warning before nightfall. A watchtower shoots approaching raiders.',
    ],
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
    text: () => [
      'A wave of raiders is on its way; the arrow at the edge of the screen points to where it comes from.',
      'Fight them together near the camp. Once the camp grows into a fort, it shoots at them too.',
    ],
    spot: (scan) => {
      const e = fresh(scan, CombatCue.Wave, false);
      return e ? { at: e.position } : null;
    },
    met: (town) => town.raids() > 0,
  },
  {
    key: 'breach',
    title: 'The guardian is rising',
    text: () => ['The falling stones push everyone back. The guardian and its brood will rise from the marked ground.'],
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
    text: () => [
      'When the guardian marks the ground, move your residents out of the ring before the blow lands.',
      'An Aimed Shot breaks its wind-up.',
    ],
    spot: (scan) => {
      const g = scan.town.monsters().find(m => m.rank === MonsterRank.Guardian && m.health > 0 && scan.sees(m.position));
      return g ? { at: g.position, about: [beast(g.id)] } : null;
    },
    met: (town) => town.chronicle.guardiansSlain > 0 || deedCount(town, 'floors') > 0,
  },
  {
    key: 'sealed',
    title: 'A gate is sealed',
    text: () => [
      'No more raids come from it, and the settlement keeps the boon of its world for good.',
      'Raiders from the gates still open grow stronger week by week.',
    ],
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
    text: () => [
      'Defeating monsters and sealing dungeons earn experience. Levels improve endurance and unlock gear. Every ten levels, a settler’s training strengthens their weapon attacks.',
      line('Callings learn their second skill at level {0}.', secondSkillLevel),
    ],
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
    text: () => [
      line('Each calling has two skills: the first from level 1, the second from level {0}.', secondSkillLevel),
      'Select a resident and press Q or W, or use the skill buttons. On Auto they use them by themselves when it helps.',
    ],
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
    text: () => [
      line('At level {0} a calling learns its second skill.', secondSkillLevel),
      'Press W with the resident selected, or set it to Auto on the skill card.',
    ],
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
    text: () => [
      'Now and then a bard takes up the lyre while idle, strolling or resting, and plays a short tune.',
      'Residents who listen by the fire in the evening recover some energy.',
    ],
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
function buildingText(_town: Town, kind: Structure): Line[] {
  const spec = structureSpec(kind),
    out: Line[] = [spec.description];
  if (spec.jobs > 0) out.push(spec.jobs === 1 ? 'One resident works here.' : line('Up to {0} residents work here.', spec.jobs));
  if (kind === Structure.Camp) out.push('Roads open with it: lay one with the Road tool in the build menu.');
  if (kind === Structure.Farm) out.push('It needs more fields as the settlement grows: drag another area beside it with the Farm tool.');
  if (kind === Structure.Foundry) out.push('Gather ore and frostwood with a stone pick and axe. An iron pick opens the cinder veins on volcanic ground.');
  return out;
}
const buildingMoments: GuideMoment[] = Array.from({ length: Structure.Count }, (_, kind: Structure) => ({
  key: `built:${Structure[kind]}`,
  title: line('New building: {0}', structureSpec(kind).name),
  text: (town: Town) => buildingText(town, kind),
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
export const guideNoticePatterns = { craftedNotice, inHandNotice, huntedNotice, raidNotice };
