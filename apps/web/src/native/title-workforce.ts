// Hands for the title player's plan: builders on every site, a worker on every unfinished road, staff for the
// workplaces the settlement needs, a hunter when food or bones run short, and gatherers for what the plan lacks.
// Who does what is the pairing the efficiency system rates highest, not the nearest pair.
import type { Town } from '../../../../packages/engine/src/town';
import { Activity, AnimalKind, type Person } from '../../../../packages/engine/src/person';
import { Product, Structure, structureSpec } from '../../../../packages/engine/src/building-catalog';
import { distance, type Point } from '../../../../packages/engine/src/geometry';
import { treePosition } from '../../../../packages/engine/src/world-map';
import * as mining from '../../../../packages/engine/src/mining';
import { supplies } from '../../../../packages/engine/src/harvest-material';
import { carryLimit, heldAmount } from '../../../../packages/engine/src/carried-resources';
import { animalSpec } from '../../../../packages/engine/src/wildlife';
import { cropWater } from '../../../../packages/engine/src/farm-work';
import { herdLeader } from '../../../../packages/engine/src/livestock';
import type { Building } from '../../../../packages/engine/src/town-models';
import type { WorkRound } from '../../../../packages/engine/src/work-efficiency';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';
import { scoutPoint, unsourcedMaterial } from '../../../../packages/engine/src/settlement-progression';
import { living, order, take, type TitleContext } from './title-roster';
import { storeNear, stores } from './title-traffic';

const reach = 24;
/** Sources weighed along their real routes for one gatherer; the rest are ranked by the straight lines. */
const weighed = 4;
interface Source {
  cell: number;
  foot: Point;
  bank: Point;
}
/** The trees or rocks in sight that nobody is already working, the shortest rounds (there and on to a store) first. */
function harvestSources(town: Town, from: Point, stone: boolean, depots: readonly Building[], refused: (cell: number) => boolean): Source[] {
  const map = town.map(),
    width = map.width(),
    taken = new Set(town.people().map((p) => p.tree)),
    found: (Source & { gap: number })[] = [];
  for (let y = Math.max(0, Math.floor(from.y - reach)); y < Math.min(map.height(), from.y + reach); ++y)
    for (let x = Math.max(0, Math.floor(from.x - reach)); x < Math.min(width, from.x + reach); ++x) {
      if (!supplies(map, x, y, stone ? Product.Stone : Product.Wood)) continue;
      const cell = y * width + x;
      if (taken.has(cell) || refused(cell)) continue;
      const foot = stone ? mining.position(x, y) : treePosition(map, x, y, map.at(x, y).trees - 1);
      if (!map.revealed(foot)) continue;
      const bank = storeNear(town, foot, depots)?.door() ?? foot;
      found.push({ cell, foot, bank, gap: distance(from, foot) + distance(foot, bank) });
    }
  return found.sort((a, b) => a.gap - b.gap || a.cell - b.cell).slice(0, weighed * 3);
}
const harvestKey = (p: Person, cell: number, stone: boolean): string => `${stone ? 'mine' : 'chop'}:${p.id}:${cell}`;
/** The round of gathering the efficiency system rates highest for `p` among `sources`, or null. */
function bestSource(ctx: TitleContext, p: Person, stone: boolean, sources: readonly Source[], need: number, taken: Set<number>) {
  let best: { source: Source; worth: number; round: WorkRound } | null = null,
    tried = 0;
  for (const source of sources) {
    if (taken.has(source.cell)) continue;
    if (++tried > weighed) break;
    const round = ctx.efficiency.gathering(p, source.foot, source.bank, stone, need),
      // A source no route is found to is still tried when nothing else is: the town knows best whether it can be worked.
      worth = ctx.efficiency.efficiency(p, round) || 1e-9 / tried;
    if (!best || worth > best.worth) best = { source, worth, round };
  }
  return best;
}
const ownSites = (town: Town) => town.buildings().filter((b) => isPlayerBuilding(b) && !b.built());
/** Everyone not yet given a decision who is free of a workplace, the ones carrying most wood first. */
const handsFor = (ctx: TitleContext, product = Product.Wood): Person[] =>
  ctx.free
    .filter((p) => p.job < 0 && !ctx.party.has(p.id))
    .sort((a, b) => heldAmount(b, product) - heldAmount(a, product) || a.id - b.id);

/** A place for one more pair of hands, with what a round of it is for a given resident. */
interface Opening {
  slots: number;
  round(p: Person): WorkRound;
  run(p: Person): boolean;
  /** A site takes a workplace's own staff when nobody else is free, as a player would pull them. */
  site: boolean;
}
/** Seconds of carrying a site's missing materials still take a builder who holds some of them already. */
function fetchSeconds(ctx: TitleContext, p: Person, site: Building, depots: readonly Building[]): number {
  const { required, delivered } = site.materials,
    lacking =
      Math.max(0, required.wood - delivered.wood - heldAmount(p, Product.Wood)) +
      Math.max(0, required.stone - delivered.stone - heldAmount(p, Product.Stone));
  if (lacking <= 0) return 0;
  const store = storeNear(ctx.town, site.door(), depots);
  if (!store) return 0;
  const walk = ctx.efficiency.walkSeconds(store.door(), site.door());
  return Number.isFinite(walk) ? Math.ceil(lacking / carryLimit(p)) * 2 * walk : 0;
}
/** One builder per site (two on a large one in a larger settlement) and one worker per unfinished road, each
 * opening given to the free resident whose round of it is worth most; scouts when a material is nowhere in sight. */
export function staffSites(ctx: TitleContext): void {
  const { town } = ctx,
    folk = living(town),
    depots = stores(town),
    openings: Opening[] = [];
  for (const site of ownSites(town).sort((a, b) => a.id - b.id)) {
    const crew = folk.filter((p) => p.task === Activity.Building && p.taskSite === site.id).length,
      wanted = folk.length >= 6 && structureSpec(site.kind).size >= 1.4 ? 2 : 1;
    if (crew >= wanted) continue;
    const lacking = unsourcedMaterial(town, site);
    if (lacking !== null) {
      if (folk.some((p) => p.task === Activity.Moving && p.ordered)) continue;
      const p = handsFor(ctx)[0] ?? ctx.free.find((q) => !ctx.party.has(q.id)),
        at = p && scoutPoint(town, p.position);
      if (p && at) order(ctx, `scout:${p.id}:${Math.round(at.x)}:${Math.round(at.y)}`, [p], () => (town.orderMove([p.id], at), true));
      continue;
    }
    openings.push({
      slots: wanted - crew,
      site: true,
      round: (p) => ctx.efficiency.building(p, site.kind, site.door(), 1 - site.progress, fetchSeconds(ctx, p, site, depots)),
      run: (p) => order(ctx, `build:${p.id}:${site.id}`, [p], () => town.orderBuild([p.id], site.id)),
    });
  }
  for (const road of town.roads().roads()) {
    if (road.faction !== 0 || (road.built >= 1 && road.paving < 0 && road.wear <= 0)) continue;
    if (folk.some((p) => p.task === Activity.Roadwork && p.taskSite === road.id)) continue;
    openings.push({
      slots: 1,
      site: false,
      round: (p) => ctx.efficiency.roadwork(p, road.workPoint(), road.length(), road.built < 1 ? 1 - road.built : 1),
      run: (p) => order(ctx, `road:${p.id}:${road.id}`, [p], () => town.orderRoadwork([p.id], road.id)),
    });
  }
  if (!openings.length) return;
  const hands = handsFor(ctx),
    // A workplace's own staff build when nobody else is free, as a player would pull them.
    spare = hands.length ? [] : ctx.free.filter((p) => !ctx.party.has(p.id)),
    pairs: { opening: Opening; p: Person; worth: number; rank: number }[] = [];
  openings.forEach((opening, at) =>
    (opening.site ? [...hands, ...spare] : hands).forEach((p, turn) =>
      pairs.push({ opening, p, worth: ctx.efficiency.efficiency(p, opening.round(p)), rank: at * 1000 + turn }),
    ),
  );
  // A round that cannot be weighed still gets hands, after every one that can, in the old order. With only a few
  // residents a building comes before any road.
  const few = folk.length < 4;
  pairs.sort((a, b) => (few ? Number(b.opening.site) - Number(a.opening.site) : 0) || b.worth - a.worth || a.rank - b.rank);
  const busy = new Set<number>();
  for (const { opening, p } of pairs) {
    if (opening.slots <= 0 || busy.has(p.id)) continue;
    if (opening.run(p)) --opening.slots;
    busy.add(p.id);
  }
}
/** How many should work at a finished workplace for a settlement of `population`. */
function staffWanted(town: Town, kind: Structure, population: number): number {
  const stock = town.stock(),
    jobs = structureSpec(kind).jobs;
  if (!population) return 0;
  switch (kind) {
    case Structure.Farm: {
      if (!town.fieldAcres()) return 0;
      // Two founders share the field and the well. A lone survivor alternates as the water store fills.
      const hands = population === 1 ? Number(stock.water >= waterReserve(town, population)) : population - 1;
      return Math.min(jobs, hands, stock.food < population * 4 ? 3 : population >= 6 && stock.food < 80 ? 2 : 1);
    }
    case Structure.Well:
      return (town.fieldAcres() > 0 || population >= 3) && stock.water < waterReserve(town, population) ? 1 : 0;
    case Structure.Lumberyard:
      return population >= 7 ? 1 : 0;
    case Structure.Quarry:
      return population >= 7 ? 1 : 0;
    case Structure.Sawmill:
    case Structure.Stoneworks:
      return population >= 7 ? 1 : 0;
    case Structure.MarketStalls:
      return population >= 6 ? 1 : 0;
    case Structure.Tavern:
    case Structure.Apothecary:
      return population >= 8 ? 1 : 0;
    default:
      return 0;
  }
}
function waterReserve(town: Town, population: number): number {
  return town.fields().reduce((need, field) => Math.max(need, cropWater(field)), population * 3);
}
/** Sets a workplace's staff count when the player's own wish for it changes; the town's later shuffles stand. */
function setStaff(ctx: TitleContext, id: number, count: number): void {
  if (ctx.staffed.get(id) === count) return;
  ctx.staffed.set(id, count);
  // The panel's count always takes; whether someone is free to fill it shows only later.
  order(ctx, `staff:${id}:${count}:${ctx.step}`, [], () => (ctx.town.setWorkers(id, count), true));
}
/** Asks each workplace for the staff it needs; the town fills the jobs from idle hands. */
export function staffJobs(ctx: TitleContext): void {
  const { town } = ctx, population = town.population();
  let well: Building | undefined;
  for (const b of town.buildings()) {
    if (!isPlayerBuilding(b) || !b.built() || !structureSpec(b.kind).jobs) continue;
    if (b.kind === Structure.Well && !well) well = b;
    else setStaff(ctx, b.id, staffWanted(town, b.kind, population));
  }
  if (well) {
    const wanted = staffWanted(town, well.kind, population);
    // Other workplaces can borrow the last well worker and lower its requested staff permanently.
    if (wanted && well.wanted === 0) ctx.staffed.delete(well.id);
    setStaff(ctx, well.id, wanted);
  }
}
const prey = [AnimalKind.Chicken, AnimalKind.Pig, AnimalKind.Cow];
/** One hunter for the nearest livestock in sight when food or bones are wanted: whoever brings that kill home
 * fastest. */
export function hunt(ctx: TitleContext): boolean {
  const { town } = ctx,
    seat = town.camp();
  if (!seat || town.raiding() || living(town).some((p) => p.hunting)) return false;
  const game = town
    .wildlife()
    .filter((a) => a.health > 0 && a.pen < 0 && a.animal !== null && prey.includes(a.animal) && !herdLeader(town, a) && town.map().revealed(a.position))
    .filter((a) => distance(a.position, seat.center) < 22)
    .sort((a, b) => distance(a.position, seat.center) - distance(b.position, seat.center));
  const fit = ctx.free.filter((p) => p.health > 0.7 && !ctx.party.has(p.id));
  const unassigned = fit.filter(p => p.job < 0);
  // When every free hand works the fields, one can bring back a meal before the harvest.
  const hunters = unassigned.length ? unassigned : fit.filter(p => town.building(p.job)?.kind === Structure.Farm);
  // The prey nearest the fire first: a long chase after richer game costs a founder the day. Prey across water or
  // behind rock cannot be walked to: its round is worth nothing, and nobody is sent after it.
  for (const target of game.slice(0, 4)) {
    const spec = animalSpec(target.animal!);
    let hunter: Person | null = null,
      most = 0;
    for (const p of hunters) {
      // The prey itself must be walked to; ground beside it is not enough for a kill.
      if (!town.grid.path(p.position, target.position).length) continue;
      const worth = ctx.efficiency.efficiency(p, ctx.efficiency.hunting(p, target.position, seat.door(), target.health, spec.food));
      if (worth > most) [hunter, most] = [p, worth];
    }
    if (!hunters.length) return false;
    if (!hunter) continue;
    const who = hunter;
    return order(ctx, `hunt:${who.id}:${target.id}`, [who], () => town.orderAttack([who.id], target.id));
  }
  return false;
}
/** Free hands fell trees or break rock, as many as the plan is short of: each takes the round (walk, work, carry
 * to the nearest store) worth most, a good weighing as much as its share of what is still wanted. When a station
 * waits for material and no hand is free, the worker of the matching yard fetches it farther afield. */
export function gatherShortfall(ctx: TitleContext, wood: number, stone: number, stationWaiting = false): void {
  if (wood <= 0 && stone <= 0) return;
  const { town } = ctx,
    depots = stores(town),
    left = [Math.max(0, wood), Math.max(0, stone)],
    idle: Person[] = [],
    felling = new Set<Person>();
  // About one gatherer for every ten units still wanted.
  const share = 10;
  const gathering = (p: Person) => p.task === Activity.Felling || p.task === Activity.Mining;
  let wanted = Math.ceil((wood + stone) / share),
    hands = handsFor(ctx).filter((p) => p.task === Activity.Idle || gathering(p)),
    fetcher: Person | undefined;
  // A staffed yard may have run out of deposits. Its worker can fetch the station's missing material farther afield.
  if (stationWaiting && !hands.length) {
    const yard = stone > 0 ? Structure.Quarry : Structure.Lumberyard;
    fetcher = ctx.free.find((p) => !ctx.party.has(p.id) && town.building(p.job)?.kind === yard &&
      (p.task === Activity.Idle || p.task === Activity.Working));
    if (fetcher) hands = [fetcher];
  }
  // Everyone has a workplace and nobody gathers: one of them is pulled for it, as a player would.
  const pulled = !hands.length && !living(town).some(gathering);
  if (pulled) {
    hands = ctx.free.filter((p) => !ctx.party.has(p.id) && p.job >= 0 && (p.task === Activity.Idle || p.task === Activity.Working));
    wanted = Math.min(wanted, 1);
  }
  // Stone is the scarcer hand: its share of the gatherers is filled first, as a site waits longest for it.
  let miners = stone > 0 ? Math.max(1, Math.round((wanted * stone) / (wood + stone))) : 0;
  for (const p of hands.slice().sort((a, b) => Number(b.task === Activity.Mining) - Number(a.task === Activity.Mining))) {
    if (gathering(p)) {
      // Whoever is at it already stays at it.
      const kind = p.task === Activity.Mining ? 1 : 0;
      if (wanted <= 0) continue;
      if (left[kind] <= 0 || (!kind && miners > 0)) {
        // Nothing more of this is wanted: the gatherer may turn to the other good.
        idle.push(p);
        if (!kind) felling.add(p);
        continue;
      }
      take(ctx, p);
      --wanted;
      if (kind) --miners;
      left[kind] = Math.max(0, left[kind] - share);
    } else if (p.task === Activity.Idle || pulled || p === fetcher) idle.push(p);
  }
  const sources = new Map<string, Source[]>(),
    taken = new Set<number>(),
    near = (p: Person, stone: boolean) => {
      const key = `${p.id}:${stone}`;
      // A source the town refused this resident before is not offered again.
      if (!sources.has(key)) sources.set(key, harvestSources(town, p.position, stone, depots, (cell) => ctx.ledger.blocked(harvestKey(p, cell, stone))));
      return sources.get(key)!;
    };
  while (wanted > 0 && idle.length && left[0] + left[1] > 0) {
    let best: { p: Person; stone: boolean; cell: number; worth: number; instead: boolean } | null = null;
    for (const p of idle)
      for (const stone of miners > 0 ? [true] : [false, true]) {
        const short = left[stone ? 1 : 0];
        if (short <= 0) continue;
        let found = bestSource(ctx, p, stone, near(p, stone), short / (left[0] + left[1]), taken),
          instead = false;
        // No rock in sight: the hand fells a tree meanwhile, which also takes them out to see more.
        if (!found && stone && (instead = true)) found = bestSource(ctx, p, false, near(p, false), 0.01, taken);
        if (found && (!best || found.worth > best.worth))
          best = { p, stone: stone && !instead, cell: found.source.cell, worth: found.worth, instead };
      }
    if (!best) break;
    const { p, stone, cell, instead } = best;
    idle.splice(idle.indexOf(p), 1);
    if (!stone && felling.has(p)) {
      // Already at a tree: a new order would only start the felling over.
      take(ctx, p);
      --wanted;
      if (instead) --miners;
      continue;
    }
    taken.add(cell);
    if (!order(ctx, harvestKey(p, cell, stone), [p], () => (stone ? town.orderMine([p.id], cell) : town.orderChop([p.id], cell)))) continue;
    --wanted;
    if (stone || instead) --miners;
    if (!instead) left[stone ? 1 : 0] = Math.max(0, left[stone ? 1 : 0] - share);
  }
}
