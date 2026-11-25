import { dungeonAttackProblem, type dungeonChallenge, dungeonWeaponTier, targetedDungeon } from '../../../../packages/engine/src/dungeon-siege';
import { equippedItem } from '../../../../packages/engine/src/equipment';
import { canControl } from '../../../../packages/engine/src/faction';
import { Activity } from '../../../../packages/engine/src/person';
import { skillOfCalling } from '../../../../packages/engine/src/skill-catalog';
import type { Town } from '../../../../packages/engine/src/town';
import type { DungeonKind } from '../../../../packages/engine/src/world-types';
import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';
import type { GameAppState } from './game-app-state';
import { controllableIds } from './game-control';

export const gateKindName = (kind: DungeonKind): string =>
  ['Cave', 'Crypt', 'Rift portal', 'Ruined tower', 'Coastal giant hall', 'Rift'][kind] ?? '';
const suggestedWeapons = {
  stone: 'Bring flint or stone weapons.',
  iron: 'Bring iron weapons.',
  regional: 'Bring embersteel or frostwood weapons.',
};
export function partyRecommendation({ tier, level, partySize }: ReturnType<typeof dungeonChallenge>): string[] {
  return [`Recommended: ${partySize} fighters at level ${level}`, suggestedWeapons[dungeonWeaponTier(tier)]];
}
export const siegeLesson = 'As the dungeon weakens, larger and stronger hordes emerge. The guardian leads the last wave. Defeat them all before the dungeon rises again.';

interface AttackApp extends Pick<GameAppState, 'town' | 'chosen' | 'selectedDungeon' | 'dungeonAttackers' | 'status' | 'cues'> {
  selectPeople(ids: readonly number[]): void;
}

/** Fighters and armed settlers answer first. Other settlers can go if none of those can reach the dungeon. */
function settlementAttackers(town: Town, gate: number): number[][] {
  const fighters: number[] = [], settlers: number[] = [];
  for (const p of town.people()) {
    if (!canControl(p, town.controlFaction) || p.woundDays > 0 || p.activity === Activity.Expedition || town.inRealm(p.position)) continue;
    const target = targetedDungeon(p);
    if (target >= 0 && target !== gate) continue;
    if (skillOfCalling(p.calling, 0) || equippedItem(p, 'weapon')?.category === 'weapon') fighters.push(p.id);
    else settlers.push(p.id);
  }
  return [fighters, settlers];
}

/** An explicit group receives the same ordinary order as an aimed attack on the map. */
export function attackDungeon(app: AttackApp, gate: number): boolean {
  const town = app.town, problem = dungeonAttackProblem(town, gate);
  if (problem) {
    app.status = problem;
    return false;
  }
  const chosen = app.selectedDungeon === gate && !app.chosen.length ? app.dungeonAttackers : app.chosen;
  const groups = chosen.length ? [controllableIds(town, chosen)] : settlementAttackers(town, gate);
  for (const ids of groups) {
    if (!ids.length || !town.orderAttackDungeon(ids, gate)) continue;
    app.selectPeople(ids.filter(id => targetedDungeon(town.person(id)!) === gate));
    app.status = '';
    if (app.cues.length < 32) app.cues.push(new Sound(Cue.Order));
    return true;
  }
  app.status = groups.some(ids => ids.length > 0) ? 'No path to the dungeon' : 'No settler is available to attack.';
  return false;
}
