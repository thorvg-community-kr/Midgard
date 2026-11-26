import type { TownState } from './town-state';
import { StrikeKind } from './skill-catalog';
import type { Monster } from './person';
import type { Building } from './town-models';
import { Structure } from './building-catalog';
import { distance } from './geometry';
import { f32 as f, lround } from './numeric';
import { campTier, seatVolley } from './raid-progression';
import { Boon, boon, boonRules } from './gate-boons';
import { towerVolley } from './progression-rules';

function nearestFoe(town: TownState, from: Building, reach: number): Monster | null {
  let mark: Monster | null = null;
  for (const beast of town.beasts)
    if (
      beast.health > 0 &&
      !beast.insideLair &&
      (beast.raider || (beast.angry && !beast.giant())) &&
      distance(beast.position, from.center) <= reach &&
      (!mark || distance(beast.position, from.center) < distance(mark.position, from.center))
    )
      mark = beast;
  return mark;
}
function shoot(town: TownState, from: Building, mark: Monster, damage: number, pause: number): void {
  town.engage(from);
  town.volleyAt.set(from.id, town.time + pause);
  mark.health = f(mark.health - damage);
  town.blows.push({
    serial: town.nextBlow++,
    from: { ...from.center },
    to: { ...mark.position },
    damage: lround(f(damage * 10)),
    onPerson: false,
    ranged: true,
    at: town.time,
    person: -1,
    strike: StrikeKind.Single,
    primary: true,
  });
}
/** Fortified seats and finished watchtowers answer a raid with arrows. */
export function defendSettlement(this: TownState, _dt: number): void {
  const might = boon(this, Boon.Bulwark) ? boonRules.bulwarkVolley : 1;
  for (const post of this.placed) {
    if (!post.built() || post.faction !== this.controlFaction) continue;
    if (this.time < (this.volleyAt.get(post.id) ?? 0)) continue;
    const tier = campTier(post.kind);
    if (tier) {
      const mark = nearestFoe(this, post, seatVolley.reach);
      if (mark) shoot(this, post, mark, f(seatVolley.damagePerTier * tier * might), seatVolley.pause);
    } else if (post.kind === Structure.Watchtower) {
      const mark = nearestFoe(this, post, towerVolley.reach);
      if (mark) shoot(this, post, mark, f(towerVolley.damage * might), towerVolley.pause);
    }
  }
}
