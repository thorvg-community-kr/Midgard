import { isSeat, Structure } from './building-catalog';
import { isPlayerBuilding, isPlayerResident } from './faction';
import { gateSealed, sealable } from './gate-seals';
import { distance, point, type Point } from './geometry';
import { RaidKind } from './raid-progression';
import type { Building } from './town-models';
import type { TownState } from './town-state';
import type { Dungeon } from './world-types';

export const gateCenter = (site: Dungeon): Point => point(site.origin.x + 1, site.origin.y + 1);

/** The original open byte was 1 for a visited gate. Its low bits also distinguish a first raid still owed.
 * The upper bits reserve each wing of tonight's wave so sealing a source cancels it even across a save. */
const awaitingRaid = 2, lead = 4, flank = 8;
export function gateActive(town: TownState, gate: number): boolean {
  const site = town.world.dungeons()[gate];
  return !!site && sealable(site) && town.sieges[gate]?.health !== 0 && !gateSealed(town, gate) && (town.opened(gate) ||
    (town.depth[gate] ?? 0) > 0 || town.realmGate === gate ||
    town.parties.some(party => party.dungeon === gate && party.members.length > 0));
}

/** A new outpost or a temporary return gate must never change another gate's milestone. */
export function gateOrder(town: TownState): number[] {
  const sites = town.world.dungeons(), home = town.world.camp();
  return sites.flatMap((site, index) => sealable(site) ? [{ index, gap: distance(gateCenter(site), home) }] : [])
    .sort((a, b) => a.gap - b.gap || a.index - b.index)
    .map(({ index }) => index);
}
export function updateGateOpenings(town: TownState): void {
  const sites = town.world.dungeons();
  if (!sites.some((site, i) => sealable(site) && !town.opened(i) && !gateSealed(town, i))) return;
  const owned = town.placed.filter(b => isPlayerBuilding(b) && b.built());
  if (!owned.some(b => isSeat(b.kind))) return;
  const residents = town.folk.filter(isPlayerResident), gates = gateOrder(town);
  const sealed = gates.filter(gate => gateSealed(town, gate)).length;
  const met = [
    true,
    residents.length >= 4 && owned.some(b => b.kind === Structure.Weaponsmith),
    residents.some(p => p.level >= 4) && gates.some(gate => (town.depth[gate] ?? 0) > 0),
    residents.length >= 6 && owned.some(b => b.kind === Structure.Guild || b.kind === Structure.GuildHall),
  ];
  gates.forEach((gate, rank) => {
    if (town.opened(gate) || gateSealed(town, gate)) return;
    // Preserve progress and parties from saves predating milestone-based entry.
    if (gateActive(town, gate)) town.open[gate] = 1;
    else if (met[rank] ?? (sealed >= rank - 3)) {
      town.open[gate] = awaitingRaid;
      town.notify(`${sites[gate].name} has opened`);
      ++town.changes;
    }
  });
}

export function nearestRaidSeat(town: TownState, origin: Point): Building | null {
  let nearest: Building | null = null, best = Infinity;
  for (const seat of town.placed) {
    if (!isSeat(seat.kind) || !isPlayerBuilding(seat) || !seat.built()) continue;
    const gap = distance(origin, seat.center);
    if (!nearest || gap < best || (gap === best && seat.id < nearest.id)) {
      nearest = seat;
      best = gap;
    }
  }
  return nearest;
}
export function raidSeat(town: TownState, gate: number): Building | null {
  const site = town.world.dungeons()[gate];
  return site ? nearestRaidSeat(town, gateCenter(site)) : null;
}
export function inRaidedVillage(town: TownState, b: Building, seat: Building | null): boolean {
  if (!seat || !isPlayerBuilding(b)) return false;
  if (isSeat(b.kind)) return b === seat;
  return (b.village >= 0 ? b.village : nearestRaidSeat(town, b.center)?.id) === seat.id;
}
/** Give new gates their first turn, then rotate the whole roster using the saved raid count. */
export function raidSources(town: TownState, kind: RaidKind): number[] {
  const active = gateOrder(town).filter(gate => gateActive(town, gate));
  if (!active.length || !raidSeat(town, active[0])) return [];
  const start = town.raidCount % active.length;
  const rotation = [...active.slice(start), ...active.slice(0, start)];
  return [...rotation.filter(gate => town.open[gate] & awaitingRaid),
    ...rotation.filter(gate => !(town.open[gate] & awaitingRaid))].slice(0, kind === RaidKind.Pincer ? 2 : 1);
}
export function musteredGates(town: TownState): number[] {
  return [lead, flank].map(wing => town.open.findIndex(state => !!(state & wing))).filter(gate => gate >= 0);
}
export function musterRaid(town: TownState, kind: RaidKind): number[] {
  const reserved = musteredGates(town);
  if (reserved.length) return reserved;
  const gates = raidSources(town, kind);
  gates.forEach((gate, index) => { town.open[gate] = (town.open[gate] || 1) | (index === 0 ? lead : flank); });
  return gates;
}
export function clearMuster(town: TownState): void {
  for (let gate = 0; gate < town.open.length; ++gate) town.open[gate] &= ~(lead | flank);
}
