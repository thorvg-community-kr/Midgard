// The walks the title settlement's residents actually make: every walk a resident sets out on is noted from
// where it began to where it ends, as a tally that fades, so a route walked again and again counts and one
// walked once is forgotten. Roads and plots are weighed against these.
import type { Town } from '../../../../packages/engine/src/town';
import { TownState } from '../../../../packages/engine/src/town-state';
import type { Building } from '../../../../packages/engine/src/town-models';
import { Activity } from '../../../../packages/engine/src/person';
import { Structure, isMarket, isSeat } from '../../../../packages/engine/src/building-catalog';
import { burdenPace } from '../../../../packages/engine/src/carried-resources';
import { distance, point, type Point } from '../../../../packages/engine/src/geometry';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';
import type { Trip } from '../../../../packages/engine/src/work-efficiency';
import type { Serves } from './title-placement';
import { beyond, living, type TitleContext } from './title-roster';

/** Where gathered goods are banked: the seat, storehouses and markets. */
export const stores = (town: Town): Building[] =>
  town
    .buildings()
    .filter(
      (b) =>
        isPlayerBuilding(b) &&
        b.built() &&
        (isSeat(b.kind) || b.kind === Structure.Storehouse || isMarket(b.kind)),
    );
export function storeNear(town: Town, at: Point, among: readonly Building[] = stores(town)): Building | null {
  let best: Building | null = null;
  for (const b of among) if (!best || distance(at, b.door()) < distance(at, best.door())) best = b;
  return best;
}
interface Walk {
  from: Point;
  to: Point;
  /** Times a resident set out on it, fading. */
  walks: number;
  /** The share of an unladen pace it was last walked at. */
  pace: number;
  /** What the walk led to: a tree or a rock to work, or anything else. */
  source: 'wood' | 'stone' | '';
}
/** Ends this close together count as one place. */
const block = 3;
const place = (p: Point): string => `${Math.floor(p.x / block)}:${Math.floor(p.y / block)}`;
export class Traffic {
  /** What a tally keeps from one decision to the next: a walk counts for a day or two. */
  static readonly fade = 0.998;
  /** Walks shorter than this are not worth a road. */
  static readonly least = 3;
  /** Routes weighed at once, the busiest first. */
  static readonly weighed = 24;
  private tally = new Map<string, Walk>();
  private heading = new Map<number, string>();
  private seen = -1;
  /** Notes every walk a resident has set out on since the last step. */
  watch(ctx: TitleContext): void {
    const { town } = ctx,
      now = town.clock(),
      // The tally fades by the clock, whatever the pace of the decisions.
      fade = this.seen < 0 ? 1 : Traffic.fade ** Math.max(0, now - this.seen);
    this.seen = now;
    for (const [key, walk] of this.tally) {
      walk.walks *= fade;
      if (walk.walks < 0.05) this.tally.delete(key);
    }
    for (const p of living(town)) {
      const end = p.path.length && !p.inside && !beyond(town, p) ? p.path[p.path.length - 1] : null,
        to = end ? place(end) : '';
      if (to === (this.heading.get(p.id) ?? '')) continue;
      this.heading.set(p.id, to);
      if (!end || distance(p.position, end) < Traffic.least) continue;
      const key = `${place(p.position)}>${to}`,
        walk = this.tally.get(key) ?? {
          from: point(p.position.x, p.position.y),
          to: point(end.x, end.y),
          walks: 0,
          pace: 1,
          source: '',
        };
      ++walk.walks;
      walk.pace = burdenPace(p);
      if (p.tree >= 0 && (p.task === Activity.Felling || p.task === Activity.Mining))
        walk.source = p.task === Activity.Mining ? 'stone' : 'wood';
      this.tally.set(key, walk);
    }
  }
  /** The walks that recur, with how often a day each is made; the busiest first. */
  trips(): Trip[] {
    return [...this.tally.values()]
      .map((walk) => ({
        from: walk.from,
        to: walk.to,
        pace: walk.pace,
        perDay: walk.walks * (1 - Traffic.fade) * TownState.secondsPerDay,
        busy: walk.walks * distance(walk.from, walk.to),
      }))
      .sort((a, b) => b.busy - a.busy)
      .slice(0, Traffic.weighed);
  }
  /** The trees or rocks the residents walk to most. */
  private sources(stone: boolean): Point[] {
    return [...this.tally.values()]
      .filter((walk) => walk.source === (stone ? 'stone' : 'wood'))
      .sort((a, b) => b.walks - a.walks)
      .slice(0, 4)
      .map((walk) => walk.to);
  }
  /** The rounds a building of `kind` would shorten: a store the carrying, a yard the walk to its wood or stone. */
  serves(ctx: TitleContext, kind: Structure): Serves | undefined {
    const { efficiency } = ctx;
    if (kind === Structure.Storehouse || isMarket(kind)) {
      // What is carried to the stores now would be carried to the new one where that is nearer.
      const doors = stores(ctx.town).map((b) => b.door()),
        drops = this.trips()
          .filter((t) => doors.some((door) => distance(door, t.to) < block))
          .slice(0, 4);
      return drops.length ? { efficiency, drops, visits: [] } : undefined;
    }
    const stone = kind === Structure.Quarry || kind === Structure.Stoneworks;
    if (!stone && kind !== Structure.Lumberyard && kind !== Structure.Sawmill) return undefined;
    const visits = this.sources(stone);
    return visits.length ? { efficiency, drops: [], visits } : undefined;
  }
}
