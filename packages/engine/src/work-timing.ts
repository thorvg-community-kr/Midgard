import { TreeWorkKind, type Person } from './person';
import type { Point } from './geometry';
import type { TownState } from './town-state';
import { workEfficiency } from './equipment';

/** Shared simulation-time contacts for work poses and discrete sound events. */
export const harvestTiming = { duration: 6, period: 0.9, impact: 0.6 } as const;
export const harvestDuration = (person: Person, stone = false): number =>
  harvestTiming.duration / workEfficiency(person, stone ? 'mining' : 'woodcutting');
/** Keep the first contact at the usual time and fit whole swings up to the instant the tree or rock gives way. */
export function harvestSwingPeriod(duration: number): number {
  const span = duration - harvestTiming.impact;
  return span / Math.max(1, Math.round(span / harvestTiming.period));
}
/** Four parts of the same mining order: three visible fractures, then the final break. */
export function miningStageAtContact(contact: number, duration: number): number {
  return Math.min(3, Math.floor(4 * contact / duration + 1e-8));
}
/** Resume at the swing which freed the last piece, using the current miner's tool speed. */
export function minedSeconds(stage: number, duration: number): number {
  if (!stage) return 0;
  const period = harvestSwingPeriod(duration);
  const swings = Math.ceil((duration * stage / 4 - harvestTiming.impact) / period - 1e-8);
  return harvestTiming.impact + swings * period;
}
/** Seconds it takes to pick up what a felled tree or a broken load gives. */
export const collectSeconds = (stone: boolean): number => (stone ? 0.65 : 0.8);
/** Road length a second of construction work lays, paves or mends. */
export const roadWorkRate = { laying: 0.32, paving: 0.2, mending: 0.5 } as const;
/** How far the strokes of a crew can move a road's front within one tick: stepping after it is not a walk. */
export const roadCrewStep = 0.25;
export const hammerTiming = { period: 1.05, impact: 0.68 } as const;
export const treeFallTiming = { duration: 0.8, impact: 0.64 } as const;
export const titleAutoplayRate = 4;
export const workElapsed = (time: number, person: number): number => time + person * 0.17;

/** The fixed simulation step is shorter than a work cycle. Return its contact, if any. */
export function workImpactBetween(
  before: number,
  after: number,
  timing: { period: number; impact: number },
): number | null {
  const cycle = (time: number) => Math.floor((time - timing.impact) / timing.period + 1e-8);
  const current = cycle(after);
  return current > cycle(before) ? timing.impact + current * timing.period : null;
}

/** One productive stroke drives its sound and, against a building, the dust at its face. */
export function hammerContact(town: TownState, p: Person, dt: number, wall?: Point): void {
  const contact = workImpactBetween(workElapsed(town.time - dt, p.id), workElapsed(town.time, p.id), hammerTiming);
  if (contact === null) return;
  town.timberEvents.push({
    serial: town.nextTreeEvent++, kind: TreeWorkKind.Hammer, person: p.id,
    cell: Math.floor(p.position.y) * town.world.width() + Math.floor(p.position.x),
    index: 0, worker: { ...p.position }, at: contact - workElapsed(0, p.id), wall,
  });
}
