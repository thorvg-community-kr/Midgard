import { Activity, Calling, type Person } from '../../../../packages/engine/src/person';
import { Structure } from '../../../../packages/engine/src/building-catalog';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';
import { altarCap } from '../../../../packages/engine/src/altar-cap';
import { defaultOffering, maxOfferingGoods, offeringStep } from '../../../../packages/engine/src/prayer-offering';
import { isFighter } from './title-gear';
import { hunt } from './title-workforce';
import { living, order, type TitleContext } from './title-roster';

// Leave three residents for food, building and the workshops as the party grows.
const settlersWanted = 3;
const partyCallings = [Calling.Warrior, Calling.Cleric, Calling.Ranger, Calling.Mage, Calling.Warrior, Calling.Ranger];
/** The missing callings, in party order, so a school still being built does not hold up another calling. */
function wantedCallings(folk: readonly Person[]): Calling[] {
  const have = folk.filter(isFighter).map((p) => p.calling);
  return partyCallings.filter(calling => {
    const at = have.indexOf(calling);
    if (at < 0) return true;
    have.splice(at, 1);
    return false;
  });
}
/** Send one eligible settler to learn a missing calling at the guild. */
function swearFighter(ctx: TitleContext, folk: readonly Person[]): boolean {
  const { town } = ctx,
    guild = town.buildings().find((b) => isPlayerBuilding(b) && b.built() && (b.kind === Structure.Guild || b.kind === Structure.GuildHall));
  if (!guild || town.people().some((p) => p.task === Activity.Training && p.faction === 0)) return false;
  if (folk.length - folk.filter(isFighter).length <= 2) return false;
  const settlers = ctx.free.filter(p => !isFighter(p) && !ctx.party.has(p.id)).sort((a, b) => b.level - a.level || a.id - b.id);
  for (const calling of new Set(wantedCallings(folk))) {
    const settler = settlers.find(p => !town.trainingReason(p.id, guild.id, calling));
    if (settler) return order(ctx, `oath:${settler.id}:${calling}`, [settler], () => town.orderTrainAtGuild(settler.id, guild.id, calling));
  }
  return false;
}
export function callResidents(ctx: TitleContext): string {
  const { town } = ctx,
    altar = town.buildings().find((b) => isPlayerBuilding(b) && b.kind === Structure.Shrine && b.built());
  if (!altar) return '';
  const folk = living(town), cap = altarCap(town);
  if (folk.filter(isFighter).length < Math.min(6, cap - settlersWanted) && swearFighter(ctx, folk))
    return 'swearing a fighter';
  if (town.population() >= cap) return 'at the cap';
  const reason = town.altarStatus(altar.id).reason;
  if (reason) {
    if (/food/.test(reason)) hunt(ctx);
    return reason;
  }
  const gift = defaultOffering();
  const bones = Math.floor(town.stock().bones / offeringStep) * offeringStep;
  gift.bones = Math.min(bones, maxOfferingGoods - gift.food);
  if (town.altarOfferingReason(altar.id, gift)) return '';
  return order(ctx, `offer:${altar.id}:${folk.length}`, [], () => !!town.offerAtAltar(altar.id, gift).born)
    ? 'welcoming a settler' : '';
}
