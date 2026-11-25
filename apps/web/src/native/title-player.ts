// The title's own player: plays the real game behind the title through the orders a player has, a few
// decisions a second. Each step runs small behaviours in order of urgency; each takes the residents it orders.
import { currentGoal, GoalBranch, GoalKind, settlementGoals } from '../../../../packages/engine/src/settlement-progression';
import type { Town } from '../../../../packages/engine/src/town';
import { WorkEfficiency } from '../../../../packages/engine/src/work-efficiency';
import { OrderLedger } from './title-orders';
import { Traffic } from './title-traffic';
import { available, living, type TitleContext } from './title-roster';
import { commandSiege, defend, partyState, sally, sendParty } from './title-party';
import { equipFree, planSettlement, type Shortfall } from './title-settlement-plan';
import { callResidents } from './title-altar';
import { keepWell } from './title-wellbeing';
import { gatherShortfall, hunt, staffJobs, staffSites } from './title-workforce';
import { planRoads } from './title-road-plan';

export const titlePlayerRules = {
  /** Game seconds between decisions at home, and beyond a gate where a fight moves faster. */
  home: 1,
  beyond: 0.5,
};
export class TitlePlayer {
  readonly ledger = new OrderLedger();
  readonly party = partyState();
  steps = 0;
  /** What the last step worked toward, for the log. */
  goal = '';
  altar = '';
  shortfall: Shortfall = { wood: 0, stone: 0 };
  private gearShort: Shortfall = { wood: 0, stone: 0 };
  private nextAt = -1;
  private later = new Map<string, number>();
  private staffed = new Map<number, number>();
  private efficiency: WorkEfficiency | null = null;
  private town: Town | null = null;
  private traffic = new Traffic();
  constructor(readonly seed: number) {}
  goalTitle(): string {
    return this.goal;
  }
  /** Decides when the interval has passed; called every frame after the town advanced. */
  update(town: Town): void {
    const now = town.clock();
    if (now < this.nextAt) return;
    this.nextAt = now + (this.party.members.length ? titlePlayerRules.beyond : titlePlayerRules.home);
    this.decide(town);
  }
  decide(town: Town): void {
    if (this.town !== town) [this.town, this.efficiency] = [town, new WorkEfficiency(town)];
    const efficiency = this.efficiency!;
    efficiency.beginStep();
    const ctx: TitleContext = {
      town,
      seed: this.seed,
      ledger: this.ledger,
      free: living(town).filter((p) => available(town, p)),
      party: new Set(),
      step: ++this.steps,
      later: this.later,
      staffed: this.staffed,
      efficiency,
      traffic: this.traffic,
    };
    this.traffic.watch(ctx);
    if (this.party.members.length) commandSiege(ctx, this.party);
    const raided = defend(ctx, this.party) || sally(ctx, this.party);
    const foundingQuest = currentGoal(town, GoalBranch.Core);
    if (!raided && foundingQuest < 0) sendParty(ctx, this.party);
    keepWell(ctx);
    const plan = planSettlement(ctx);
    this.goal = plan.goal;
    this.shortfall = plan.shortfall;
    planRoads(ctx);
    staffSites(ctx);
    this.altar = callResidents(ctx);
    if (town.stock().food < town.population() * 2) hunt(ctx);
    if (town.stock().food < town.population()) hunt(ctx);
    staffJobs(ctx);
    this.gearShort = equipFree(ctx, this.gearShort);
    gatherShortfall(ctx, plan.shortfall.wood + this.gearShort.wood, plan.shortfall.stone + this.gearShort.stone,
      settlementGoals()[foundingQuest]?.kind === GoalKind.Station);
  }
}
