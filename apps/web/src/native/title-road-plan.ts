// Roads the title settlement lays because they pay: the main street as soon as the camp stands, then a road
// toward wherever its people walk most, when the walking it saves wins back the work of laying it.
import { TownState } from '../../../../packages/engine/src/town-state';
import { bareHandsRate, harvestSeconds, roadWorkKinds, taskEfficiency, workEfficiency } from '../../../../packages/engine/src/equipment';
import { distance, lerp, type Point } from '../../../../packages/engine/src/geometry';
import { flatten, type RoadPath } from '../../../../packages/engine/src/road-network';
import { firstRoad, roadBesideCamp, routedRoad } from './title-placement';
import { living, order, putOff, waiting, type TitleContext } from './title-roster';

export const roadPlanRules = {
  /** Decisions between two looks at the routes; routing walks the grid. */
  every: 20,
  /** Ends of routes weighed in one look, the busiest first. */
  weighed: 2,
  /** Laying roads takes no more than one part in this many of the residents' time. */
  labour: 10,
  /** Below this many residents every hand is needed for the quest's building and for food: only the quest's own
   * street is laid, never a road that pays back over a month. */
  hands: 4,
  /** A route's end this near a road is served already. */
  served: 1.2,
};
/** Seconds of felling a road along `line` asks before it can be laid: the trees on the tiles it crosses. */
function clearing(ctx: TitleContext, line: readonly Point[]): number {
  const map = ctx.town.map(),
    crossed = new Set<number>(),
    rate = Math.max(bareHandsRate, ...living(ctx.town).map((p) => workEfficiency(p, 'woodcutting')));
  let trees = 0;
  for (const p of line) {
    const x = Math.floor(p.x),
      y = Math.floor(p.y),
      cell = y * map.width() + x;
    if (!map.inside(x, y) || crossed.has(cell)) continue;
    crossed.add(cell);
    trees += map.at(x, y).trees;
  }
  return trees * harvestSeconds(rate);
}
/** Lays the main street, or the road that saves most walking for its work; one road at a time. */
export function planRoads(ctx: TitleContext): void {
  const { town } = ctx,
    seat = town.camp(),
    network = town.roads(),
    own = network.roads().filter((r) => r.faction === 0);
  if (!seat || !seat.built() || own.some((r) => r.built < 1)) return;
  if (!own.length) {
    // The floor: a settlement has a street from its first day, whatever the count says.
    if (waiting(ctx, 'main-street')) return;
    const path = firstRoad(town, ctx.seed) ?? roadBesideCamp(town);
    if (path) order(ctx, `main-street:${ctx.step}`, [], () => town.buildRoad(path));
    else putOff(ctx, 'main-street', 40);
    return;
  }
  if (living(town).length < roadPlanRules.hands) return;
  if (ctx.step % roadPlanRules.every !== roadPlanRules.every / 2 || waiting(ctx, 'road-plan')) return;
  const trips = ctx.traffic.trips(),
    ends = new Map<string, { key: string; to: Point; on: Point; busy: number }>();
  for (const trip of trips)
    for (const to of [trip.to, trip.from]) {
      const near = network.distance(to);
      if (!near.onRoad || near.distance < roadPlanRules.served || near.distance > TownState.maxRoadLength)
        continue;
      const key = `road-to:${Math.round(to.x / 2)}:${Math.round(to.y / 2)}`,
        end = ends.get(key) ?? { key, to, on: near.onRoad, busy: 0 };
      end.busy += trip.perDay * near.distance;
      ends.set(key, end);
    }
  const rate = Math.max(bareHandsRate, ...living(town).map((p) => taskEfficiency(p, roadWorkKinds)));
  let best: { key: string; path: RoadPath; ratio: number; cost: number } | null = null;
  for (const end of [...ends.values()]
    .sort((a, b) => b.busy - a.busy || (a.key < b.key ? -1 : 1))
    .slice(0, roadPlanRules.weighed)) {
    if (waiting(ctx, end.key)) continue;
    // The straight line tells cheaply whether a road there could pay; only then is one routed.
    if (!ctx.efficiency.roadWorth(trips, [end.on, end.to], rate).pays) {
      putOff(ctx, end.key, 60);
      continue;
    }
    // Try the full route first, then a shorter approach if the destination is blocked.
    let path: RoadPath | null = null;
    for (const share of [1, 0.7]) {
      const to = lerp(end.on, end.to, share);
      if (distance(end.on, to) >= 2 && (path = routedRoad(town, end.on, to))) break;
    }
    // A bridge costs wood and stone the plan has not set aside: such a road is the player's own choice.
    const bridge = path && town.canBuildRoad(path).cost;
    if (bridge && bridge.wood + bridge.stone > 0) path = null;
    const line = path ? flatten(path) : [],
      worth = path && ctx.efficiency.roadWorth(trips, line, rate, clearing(ctx, line));
    if (!path || !worth || !worth.pays) {
      // Ground that takes no road rarely changes; traffic does.
      putOff(ctx, end.key, path ? 60 : 240);
      continue;
    }
    if (!best || worth.saved / worth.cost > best.ratio)
      best = { key: end.key, path, ratio: worth.saved / worth.cost, cost: worth.cost };
  }
  if (!best) return;
  const { key, path, cost } = best;
  if (!order(ctx, `${key}:${ctx.step}`, [], () => town.buildRoad(path))) putOff(ctx, key, 80);
  else putOff(ctx, 'road-plan', Math.round((cost * roadPlanRules.labour) / Math.max(1, living(town).length)));
}
