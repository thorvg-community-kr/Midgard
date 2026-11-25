import type { TownState } from './town-state';
import { sealFloors, sealable } from './gate-seals';

/** Population limit before any floor beyond a gate is cleared: a working settlement with a first party to spare. */
export const altarBaseCap = 8;
/** Added for each floor cleared for the first time, and again for each gate sealed. */
export const altarFloorBonus = 4;
export const altarSealBonus = 4;

/** Floors first cleared and gates sealed, read from the depth record the realm already saves. */
export function altarProgress(town: TownState): { floors: number; seals: number } {
  let floors = 0,
    seals = 0;
  town.world.dungeons().forEach((site, index) => {
    if (!sealable(site)) return;
    const cleared = Math.min(sealFloors, town.depth[index] ?? 0);
    floors += cleared;
    if (cleared >= sealFloors) ++seals;
  });
  return { floors, seals };
}

/** Most residents the settlement can hold; it only rises by clearing floors and sealing gates. */
export function altarCap(town: TownState): number {
  const { floors, seals } = altarProgress(town);
  return altarBaseCap + altarFloorBonus * floors + altarSealBonus * seals;
}

export const altarCapReason = 'Clear another floor beyond a gate to make room for more residents.';
export const altarCapLine = (cap: number): string => `Your settlement can now grow to ${cap} residents.`;
