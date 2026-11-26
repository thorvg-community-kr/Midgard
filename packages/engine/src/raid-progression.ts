import { Structure, isSeat } from './building-catalog';
import type { Building } from './town-models';
import type { Point } from './geometry';
import { distance } from './geometry';
import { TownState } from './town-state';
import { hash01 } from './numeric';

export function campTier(kind: Structure): number {
  return kind === Structure.Castle ? 3 : kind === Structure.Keep ? 2 : kind === Structure.Palisade ? 1 : 0;
}

/** The number in a wave stops growing with the calendar after this many weeks. */
export const threatWeeks = 12;
/** A creature keeps the level it had when it left its dungeon. */
const highestWaveLevel = 16;
export function raidMonsterLevel(days: number, previousRaids: number): number {
  if (previousRaids === 0) return 1;
  return Math.min(highestWaveLevel, 1 + Math.max(Math.floor(days / 7), Math.floor((previousRaids + 1) / 2)));
}
export function siegeMonsterLevel(days: number, distanceFromCamp: number): number {
  const distanceLevels = Math.floor(Math.max(0, distanceFromCamp - 12) / 12);
  return Math.min(highestWaveLevel, 1 + Math.floor(days / 7) + distanceLevels);
}
/** A wave keeps the threat of its muster. Fortifying the target does not increase damage or health. */
export function dungeonThreat(days: number, origin: Point, buildings: readonly Building[], level?: number) {
  const nearest = buildings
    .filter((b) => isSeat(b.kind) && b.built() && distance(b.center, origin) <= TownState.campReach * 2)
    .sort((a, b) => distance(a.center, origin) - distance(b.center, origin))[0];
  const week = Math.max(0, Math.floor(days / 7)),
    growth = level === undefined ? Math.min(threatWeeks, week) : level - 1,
    tier = nearest ? campTier(nearest.kind) : 0;
  return {
    week,
    tier,
    count: Math.min(12, 2 + week),
    health: 1 + growth * 0.32,
    damage: 1 + growth * 0.08,
  };
}

export enum RaidKind {
  Pack,
  Horde,
  Brutes,
  Pincer,
}
/** Raiders still on the field share the population limit with the next night's reinforcements. */
export function raidRoom(town: TownState): number {
  const alive = town.beasts.reduce((count, m) => count + Number(m.raider && m.health > 0), 0);
  return Math.max(0, TownState.maxRaiders - alive);
}
export function raidKind(seed: number, day: number): RaidKind {
  // The first raids are plain packs so the shapes are learned one at a time.
  if (day < 6) return RaidKind.Pack;
  const pick = hash01(seed, day, 11, 302);
  return pick < 0.4 ? RaidKind.Pack : pick < 0.62 ? RaidKind.Horde : pick < 0.82 ? RaidKind.Brutes : RaidKind.Pincer;
}
/** How a raid answers what the settlement has. */
export const raidMuster = {
  /** Might of each resident at home: their blow times their vitality, so arms and levels count. */
  perBlow: 1,
  /** Might of each completed watchtower and of each tier of a fortified seat. */
  perTower: 2,
  perTier: 2.5,
  /** Might the dungeons add each week on their own. */
  perWeek: 3,
  /** How much of a settlement's fighting strength an opening gate can match in the first week. */
  openingMight: 6,
  /** Swarmers per point of might; a leader for every `leaderMight`, an extra brute for every `bruteMight`. */
  swarm: 2.2,
  leastSwarm: 10,
  leaderMight: 6,
  bruteMight: 14,
  /** A swarmer bites more softly than the wave's larger fighters. */
  swarmBite: 0.46,
};
/** Gates learn to field larger forces over time. Well-armed founders still get a first week of scouting packs. */
export function raidMight(settlement: number, week: number): number {
  const age = Math.min(threatWeeks, week);
  return Math.min(settlement, raidMuster.openingMight + age) + raidMuster.perWeek * age;
}
/** A raid is a wave sized to the settlement's `might`: `count` leaders (grunts, or brutes for a brute raid) with
 * the shape's `health` and `damage`, a few extra `brutes`, and a `swarm` of swarmers. The first raids on a young
 * camp are probes: a few swarmers and no leader. */
export function raidShape(kind: RaidKind, might: number) {
  const swarm = Math.max(raidMuster.leastSwarm, Math.round(raidMuster.swarm * might)),
    leaders = Math.floor(might / raidMuster.leaderMight);
  if (kind === RaidKind.Horde)
    return { count: Math.floor(leaders / 2), health: 0.8, damage: 0.9, brutes: 0, swarm: Math.round(swarm * 1.6) };
  if (kind === RaidKind.Brutes)
    return { count: Math.max(1, Math.ceil(leaders / 2)), health: 1.8, damage: 1.25, brutes: 0, swarm: Math.round(swarm / 2) };
  return { count: leaders, health: 1, damage: 1, brutes: Math.floor(might / raidMuster.bruteMight), swarm };
}
export const raidWarning = (kind: RaidKind, gate: string, camp: number): string =>
  kind === RaidKind.Horde
    ? `A horde from ${gate} will raid Camp #${camp + 1} tonight`
    : kind === RaidKind.Brutes
      ? `Brutes from ${gate} will raid Camp #${camp + 1} tonight`
      : kind === RaidKind.Pincer
        ? `One wing from ${gate} will raid Camp #${camp + 1} tonight`
        : `A pack from ${gate} will raid Camp #${camp + 1} tonight`;
/** A fortified seat shoots at raiders; a bare camp cannot. */
export const seatVolley = { reach: 8, pause: 1.5, damagePerTier: 1.5 };
