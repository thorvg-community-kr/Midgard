import { Activity, Role, type Person } from './person';
import type { Building } from './town-models';

export const playerFaction = 0;
type Affiliation = { faction?: number };

/** Old scenarios without explicit affiliation belong to the player. */
/** A resident walking to a gate can still be called back; one who has stepped in cannot. */
export const beyondOrders = (p: Person): boolean => p.activity === Activity.Expedition && p.inside;
export function belongsToFaction(item: Affiliation, faction = playerFaction): boolean {
  return (item.faction ?? playerFaction) === faction;
}
export function sameFaction(a: Affiliation, b: Affiliation): boolean {
  return (a.faction ?? playerFaction) === (b.faction ?? playerFaction);
}
export function livingResident(
  p: Person | null | undefined, faction: number,
): p is Person & { role: Role.Resident } {
  return (
    !!p &&
    p.role === Role.Resident &&
    (p.health > 0 || (p.downedAt >= 0 && p.health > -0.5)) &&
    p.activity !== Activity.Leaving &&
    belongsToFaction(p, faction)
  );
}
export function isPlayerResident(
  p: Person | null | undefined,
): p is Person & { role: Role.Resident; faction: 0 } {
  return livingResident(p, playerFaction);
}
export function canControl(
  p: Person | null | undefined,
  faction = playerFaction,
): p is Person & { role: Role.Resident; stressRecovery: false } {
  return (
    !!p &&
    p.role === Role.Resident &&
    p.health > 0 &&
    p.downedAt < 0 &&
    belongsToFaction(p, faction) &&
    !p.stressRecovery &&
    p.activity !== Activity.Leaving &&
    !beyondOrders(p)
  );
}
export function controlReason(p: Person | null | undefined): string {
  if (p && p.downedAt >= 0 && p.health > -0.5) return 'Downed. Send help.';
  if (!p || p.health <= 0 || p.activity === Activity.Leaving) return 'This resident is unavailable.';
  if (p.role !== Role.Resident) return 'Guests take no orders.';
  if (!belongsToFaction(p)) return 'From a neutral settlement.';
  if (p.stressRecovery) return 'Exhausted and resting.';
  if (beyondOrders(p)) return 'Beyond the gate.';
  return '';
}
export function isPlayerBuilding(b: Building | null | undefined): b is Building & { faction: 0 } {
  return !!b && belongsToFaction(b);
}
export function buildingControlReason(b: Building | null | undefined): string {
  if (!b) return 'This building is unavailable.';
  return belongsToFaction(b) ? '' : 'This building belongs to a neutral settlement.';
}
