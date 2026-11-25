import { Structure, structureSpec, isHome, isSeat, isLodging } from './building-catalog';
import { belongsToFaction, isPlayerBuilding } from './faction';
import { f32 } from './numeric';
import type { TownState } from './town-state';
import type { Sight } from './world-types';

/** The player's eyes on the ground, before a landmark adds its own extent. */
export function currentSights(town: TownState): Sight[] {
  const night = town.climate().night,
    blend = (day: number, dark: number) => f32(day + f32(f32(dark - day) * night)),
    sights: Sight[] = [];
  for (const p of town.people())
    if (belongsToFaction(p) && p.visibility() > 0)
      sights.push({ center: { ...p.position }, radius: blend(8.5, 5) });
  // Thor sees what he hunts by night.
  if (town.thor.present) sights.push({ center: { ...town.thor.position }, radius: blend(8.5, 7) });
  for (const b of town.buildings()) {
    if (!isPlayerBuilding(b) || !b.built()) continue;
    if (b.kind === Structure.Torch) {
      sights.push({ center: { ...b.center }, radius: blend(4, 6.5) });
      continue;
    }
    const half = f32(structureSpec(b.kind).size / 2);
    let glow = 1;
    if (isSeat(b.kind)) glow = 4;
    else if (isLodging(b.kind) || [Structure.Tavern, Structure.Guild, Structure.GuildHall, Structure.Chapel].includes(b.kind))
      glow = 2.5;
    else if (isHome(b.kind)) glow = 1.5;
    sights.push({ center: { ...b.center }, radius: f32(half + blend(5, f32(3 + f32(glow * f32(1.4))))) });
  }
  return sights;
}

/** A moving scout can see the slopes between two exploration stamps. Old saves retain those stamps. */
export function spotVolcano(
  town: TownState & { reveal(x: number, y: number, radius: number): void },
  history?: readonly Sight[],
): void {
  const map = town.map(), fire = map.volcano();
  if (!fire) return;
  const heart = fire.center();
  if (!history && map.cell(heart)?.revealed) return;
  const sight = (history ?? currentSights(town)).find((source) => fire.inSight(source));
  if (sight && !map.revealed(heart)) town.reveal(sight.center.x, sight.center.y, sight.radius);
}
