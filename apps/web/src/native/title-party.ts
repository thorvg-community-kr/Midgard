import type { Town } from '../../../../packages/engine/src/town';
import { Activity, Calling, type Person } from '../../../../packages/engine/src/person';
import { CombatCue } from '../../../../packages/engine/src/combat-events';
import { dungeonChallenge, dungeonStatus } from '../../../../packages/engine/src/dungeon-siege';
import { add, distance, normalized, point, scale, sub, type Point } from '../../../../packages/engine/src/geometry';
import { equippedItem } from '../../../../packages/engine/src/equipment';
import { TownState } from '../../../../packages/engine/src/town-state';
import { sealable } from '../../../../packages/engine/src/gate-seals';
import { RaidKind, raidKind } from '../../../../packages/engine/src/raid-progression';
import { lairOf } from '../../../../packages/engine/src/town-monsters';
import { isFighter } from './title-gear';
import { beyond, living, order, take, type TitleContext } from './title-roster';

/** Seconds between fresh orders to a fighting group, so blows land between them. */
const regroupSeconds = 2;

export interface PartyState {
  /** Residents committed to the outdoor assault. */
  members: number[];
  gate: number;
  lastEvent: bigint;
  dodgeUntil: number;
  orderedAt: number;
  breached: boolean;
  /** Expeditions sent, cleared and withdrawn, for the log and the tests. */
  sent: number;
  cleared: number;
  withdrew: number;
  castOut: number;
  /** When the attack was ordered. */
  enteredAt: number;
  homeOrderedAt: number;
  /** When the fighters were last sent out after raiders that hang back. */
  salliedAt: number;
  /** Why no party went out at the last look, for the log. */
  note: string;
}
export const partyState = (): PartyState => ({
  members: [],
  gate: -1,
  lastEvent: -1n,
  dodgeUntil: -1,
  orderedAt: -1e9,
  breached: false,
  sent: 0,
  cleared: 0,
  withdrew: 0,
  castOut: 0,
  enteredAt: 0,
  homeOrderedAt: -1e9,
  salliedAt: -1e9,
  note: '',
});
const centre = (items: readonly { position: Point }[]): Point =>
  items.reduce((c, p) => point(c.x + p.position.x / items.length, c.y + p.position.y / items.length), point());
const homeDefender = (p: Person): boolean =>
  p.health > 0.3 && (isFighter(p) || (!!equippedItem(p, 'weapon') && p.stress < 0.7));

/** Raiders near home are met at the fire by everyone armed: they gather at the camp door and fight what comes
 * within reach of it, so the hurt are close to help; the downed are tended once no raider stands over them. */
export function defend(ctx: TitleContext, state: PartyState): boolean {
  const { town } = ctx,
    seat = town.camp();
  if (!seat) return false;
  const raiders = town
    .monsters()
    .filter((m) => m.health > 0 && (m.raider || m.angry) && !town.inRealm(m.position) && distance(m.position, seat.center) < TownState.campReach * 1.8);
  const folk = living(town).filter((p) => !beyond(town, p));
  tendDowned(ctx, folk, town.people().filter((p) => p.faction === 0 && p.downedAt >= 0 && !town.inRealm(p.position)), raiders.map((m) => m.position), 1.5);
  if (!raiders.length) return false;
  const defenders = folk.filter(
    (p) => homeDefender(p) && p.task !== Activity.Praying && p.task !== Activity.Tending && !ctx.party.has(p.id),
  );
  for (const p of defenders) take(ctx, p);
  if (!defenders.length || town.clock() - state.homeOrderedAt < regroupSeconds) return true;
  state.homeOrderedAt = town.clock();
  const rally = seat.door(),
    near = raiders
      .filter((m) => distance(m.position, rally) < 6)
      .sort((a, b) => distance(a.position, rally) - distance(b.position, rally))[0],
    away = defenders.filter((p) => distance(p.position, rally) > 3 || p.health < 0.5),
    ready = defenders.filter((p) => !away.includes(p));
  if (away.length) order(ctx, `rally:${town.clock() | 0}`, [], () => (town.orderAttackMove(away.map((p) => p.id), rally), true));
  if (near && ready.length)
    order(ctx, `defend:${near.id}:${town.clock() | 0}`, [], () => (town.orderAttackMove(ready.map((p) => p.id), near.position), true));
  return true;
}
/**
 * Raiders that hang back far from home keep the raid alive, and with it everything that waits for the raid to
 * end. By day the fit fighters go out together and finish them, as a player would.
 */
export function sally(ctx: TitleContext, state: PartyState): boolean {
  const { town } = ctx,
    seat = town.camp(),
    day = town.dayFraction();
  if (!seat || !town.raiding() || town.realmActive() || day < 0.3 || day > 0.7) return false;
  const raiders = town.monsters().filter((m) => m.health > 0 && m.raider && !m.insideLair && !town.inRealm(m.position));
  if (!raiders.length) return false;
  const fighters = fitFighters(town).filter((p) => !ctx.party.has(p.id));
  if (fighters.length < 2) return false;
  for (const p of fighters) take(ctx, p);
  if (town.clock() - state.salliedAt < 15) return true;
  const target = raiders
    .filter((m) => town.grid.path(seat.door(), m.position).length > 0)
    .sort((a, b) => distance(a.position, seat.center) - distance(b.position, seat.center))[0];
  if (!target) return false;
  state.salliedAt = town.clock();
  state.note = 'out after the last raiders';
  order(ctx, `sally:${target.id}:${town.clock() | 0}`, [], () => (town.orderAttackMove(fighters.map((p) => p.id), target.position), true));
  return true;
}
/** The nearest free helper kneels by each downed resident no monster stands over. */
function tendDowned(ctx: TitleContext, helpers: readonly Person[], downed: readonly Person[], threats: readonly Point[], clear = 3): void {
  const { town } = ctx,
    busy = new Set(helpers.filter((p) => p.task === Activity.Tending).map((p) => p.id));
  for (const d of downed) {
    if (d.health <= -0.5 || helpers.some((p) => p.task === Activity.Tending && p.taskSite === d.id)) continue;
    if (threats.some((t) => distance(t, d.position) < clear)) continue;
    const helper = helpers
      .filter((p) => !busy.has(p.id) && p.health > 0.3 && p.downedAt < 0)
      .sort((a, b) => distance(a.position, d.position) - distance(b.position, d.position))[0];
    if (helper && order(ctx, `tend:${helper.id}:${d.id}`, [helper], () => town.orderTend([helper.id], d.id))) busy.add(helper.id);
  }
}
/** Fighters fit to go: healthy, fed, rested and unwounded, best first. */
function fitFighters(town: Town): Person[] {
  return living(town)
    .filter((p) => !beyond(town, p) && p.health >= 0.75 && p.woundDays <= 0 && p.food > 0.3 && p.rest > 0.3)
    // A resting settler with a sound weapon can answer the order and walk out of the house.
    .filter((p) => !!equippedItem(p, 'weapon'))
    .filter((p) => p.task !== Activity.Praying && p.task !== Activity.Crafting)
    .sort((a, b) => b.level - a.level || Number(isFighter(b)) - Number(isFighter(a)) || a.id - b.id);
}
export interface PartyChoice {
  members: Person[];
  gate: number;
}
/** Send a healthy armed force to the nearest known standing dungeon. */
export function readyParty(town: Town, available = Infinity): PartyChoice | null {
  const seat = town.camp();
  if (!seat || town.raiding()) return null;
  const gates = town.map().dungeons()
    .map((site, gate) => ({ site, gate }))
    .filter(({ site, gate }) => site.discovered && sealable(site) && dungeonStatus(town, gate).phase === 'standing')
    .sort((a, b) => distance(lairOf(a.site), seat.center) - distance(lairOf(b.site), seat.center));
  const fighters = fitFighters(town);
  for (const { gate } of gates) {
    const { partySize, level } = dungeonChallenge(town, gate);
    const members = fighters.filter(p => p.level >= Math.ceil(level * .65)).slice(0, Math.min(available, partySize));
    if (members.length === partySize && members.reduce((sum, p) => sum + p.level, 0) >= level * .9 * partySize)
      return { gate, members };
  }
  return null;
}
/** Sends the ready party, by day and with no raid at home. */
export function sendParty(ctx: TitleContext, state: PartyState): boolean {
  const { town } = ctx;
  if (state.members.length) return false;
  // A party leaves once the day's raid warning would have come: with none, home is safe tonight; with one, only
  // if two residents who can fight stay behind to hold the fire.
  const day = town.dayFraction(),
    warned = town.raidWarnedDay === town.days;
  // Late enough to know about tonight's raid, early enough to fight by daylight.
  if (day < 0.31 || day > 0.55) {
    state.note = 'waiting for the morning news';
    return false;
  }
  // The tracks tell the raid's shape. A horde, or raiders from two sides, swamp a guard of two: nobody leaves.
  if (warned && [RaidKind.Horde, RaidKind.Pincer].includes(raidKind(town.map().seed(), town.days))) {
    state.note = 'a raid too great for a small guard is coming tonight';
    return false;
  }
  const available = warned ? living(town).filter((p) => !beyond(town, p) && homeDefender(p)).length - 2 : Infinity,
    choice = readyParty(town, available);
  if (!choice) {
    const fit = fitFighters(town);
    state.note = warned && available < fit.length ? 'a raid is coming tonight' :
      `not ready: ${fit.length} fit fighters at ${fit.map((p) => p.level).join('/')}`;
    return false;
  }
  state.note = '';
  const ids = choice.members.map((p) => p.id);
  if (!order(ctx, `attack-dungeon:${choice.gate}:${ids.join(',')}`, choice.members, () => town.orderAttackDungeon(ids, choice.gate))) return false;
  for (const id of ids) ctx.party.add(id);
  Object.assign(state, { members: ids, gate: choice.gate, breached: false, enteredAt: town.clock(), orderedAt: -1e9 });
  ++state.sent;
  return true;
}

/** Keeps the attackers together through the breach and brings survivors back to the camp. */
export function commandSiege(ctx: TitleContext, state: PartyState): void {
  const { town } = ctx, now = town.clock();
  const party = state.members.map(id => town.person(id)).filter((p): p is Person => !!p);
  for (const p of party) {
    ctx.party.add(p.id);
    take(ctx, p);
  }
  const seat = town.camp();
  const hurt = party.filter(p => p.health > 0 && p.downedAt < 0 && p.health < .45);
  if (hurt.length && seat) {
    town.orderMove(hurt.map(p => p.id), seat.door());
    state.members = state.members.filter(id => !hurt.some(p => p.id === id));
  }
  const standing = party.filter(p => p.health > 0 && p.downedAt < 0 && !hurt.includes(p));
  const siege = dungeonStatus(town, state.gate);
  if (siege.phase === 'summoning' || siege.phase === 'defending') state.breached = true;
  const withdrawn = state.breached && siege.phase === 'standing';
  const required = dungeonChallenge(town, state.gate).partySize;
  const lostGround = standing.length < Math.ceil(required / 2) || (!state.breached && now - state.enteredAt > 240);
  if (siege.phase === 'sealed' || withdrawn || lostGround) {
    if (standing.length && seat) town.orderMove(standing.map(p => p.id), seat.door());
    if (siege.phase === 'sealed') ++state.cleared;
    else if (standing.length || hurt.length) ++state.withdrew;
    else ++state.castOut;
    state.members = [];
    return;
  }
  const guardian = town.sieges[state.gate]?.guardian ?? -1;
  if (guardian < 0 || siege.phase !== 'defending') return;
  const foes = town.monsters().filter(m => m.lair === state.gate && m.brood === guardian && m.health > 0);
  dodge(ctx, state, standing);
  if (now < state.dodgeUntil) return;
  tendDowned(ctx, standing, party.filter(p => p.downedAt >= 0), foes.map(m => m.position));
  handSkills(ctx, standing, foes);
  if (now - state.orderedAt < regroupSeconds || !foes.length) return;
  const middle = centre(standing);
  const foe = foes.reduce((best, m) => distance(m.position, middle) < distance(best.position, middle) ? m : best);
  const ready = standing.filter(p => p.task !== Activity.Tending);
  if (ready.length) order(ctx, `siege-foe:${foe.id}:${now | 0}`, [], () => town.orderAttack(ready.map(p => p.id), foe.id));
  state.orderedAt = now;
}
/** Everyone inside a freshly marked slam steps out of it, away from its centre. */
function dodge(ctx: TitleContext, state: PartyState, standing: readonly Person[]): void {
  const { town } = ctx;
  for (const e of town.combatEvents()) {
    if (e.serial <= state.lastEvent) continue;
    state.lastEvent = e.serial;
    if (e.cue !== CombatCue.Telegraph) continue;
    for (const p of standing) {
      if (distance(p.position, e.position) >= e.radius + 0.8) continue;
      const away = sub(p.position, e.position),
        out = add(e.position, scale(distance(p.position, e.position) > 0.05 ? normalized(away) : point(1, 0), e.radius + 1.5)),
        spot = town.grid.nearestWalkable(out);
      order(ctx, `dodge:${p.id}:${e.serial}`, [], () => (town.orderMove([p.id], spot), true));
    }
    state.dodgeUntil = Math.max(state.dodgeUntil, town.clock() + e.duration + 0.3);
  }
}
/** Skills left off auto are fired by hand when ready and a pack is in reach. */
function handSkills(ctx: TitleContext, standing: readonly Person[], foes: readonly { position: Point }[]): void {
  const { town } = ctx;
  for (const p of standing)
    for (const skill of town.skillsOf(p)) {
      if (skill.auto || skill.locked || !skill.ready) continue;
      const reach = town.skillReach(p, skill.slot),
        near = foes.filter((m) => distance(m.position, p.position) <= Math.max(2, reach));
      if (near.length < 2) continue;
      const aim = skill.targeted ? centre(near) : undefined;
      order(ctx, `skill:${p.id}:${skill.slot}:${town.clock() | 0}`, [], () => town.useSkill([p.id], skill.slot, aim) > 0);
    }
}
