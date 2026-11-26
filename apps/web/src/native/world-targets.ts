import { MonsterRank } from '../../../../packages/engine/src/combat-events';
import { dungeonAttackProblem } from '../../../../packages/engine/src/dungeon-siege';
import { harvestName, harvestProduct } from '../../../../packages/engine/src/harvest-material';
import type { GameCommandApp } from './game-commands';
import type { Point } from '../../../../packages/engine/src/geometry';
import { structureSpec } from '../../../../packages/engine/src/building-catalog';
import { animalSpec } from '../../../../packages/engine/src/wildlife';
import { isPlayerResident } from '../../../../packages/engine/src/faction';
import type { SelectionBounds } from '../../../../packages/native-renderer/src/selection-marker';
import {
  worldObjectKey as targetKey,
  type WorldObjectRef,
  type WorldHit,
  type SelectionGeometry,
} from '../../../../packages/native-renderer/src/world-picking-types';
export type {
  WorldObjectRef,
  WorldObjectKind,
} from '../../../../packages/native-renderer/src/world-picking-types';

export interface WorldTarget extends WorldObjectRef {
  key: string;
  name: string;
  bounds: SelectionBounds;
  geometry: SelectionGeometry;
}
export { targetKey };
const reference = (hit: WorldObjectRef): WorldObjectRef => ({
  kind: hit.kind,
  id: hit.id,
  ...(hit.instanceIndex === undefined ? {} : { instanceIndex: hit.instanceIndex }),
});

/** Rendering consumes the last presented hit; it never asks native paints to update or hit-test. */
export function cachedWorldHit(app: GameCommandApp, screen: Point = app.mouse): WorldHit | null {
  const cached = app.hoveredWorldTarget;
  if (
    !cached ||
    cached.screen.x !== screen.x ||
    cached.screen.y !== screen.y ||
    screen.x < 0 ||
    screen.y < 0 ||
    app.context.controlAt(screen.x, screen.y)
  )
    return null;
  return cached.hit;
}
/** Call only from pointer events or after the host has presented and synchronized the canvas. */
export function refreshHoveredTarget(app: GameCommandApp): void {
  const screen = { ...app.mouse };
  app.hoveredWorldTarget = {
    screen,
    hit:
      screen.x < 0 || screen.y < 0 || app.context.controlAt(screen.x, screen.y)
        ? null
        : app.renderer.pick(screen),
  };
}

export const landmarkDescription = (id: number): string =>
  [
    'A statue of the Allfather.',
    'Smoke rises from the crater.',
    'The northern source of the rivers.',
    'God of thunder.',
  ][id] ?? '';

export function worldTarget(app: GameCommandApp, ref: WorldObjectRef): WorldTarget | null {
  const geometry = app.renderer.selectionGeometry(ref);
  if (!geometry) return null;
  const town = app.town;
  let name: string | undefined;
  switch (ref.kind) {
    case 'person':
      name = town.person(ref.id)?.name;
      break;
    case 'building': {
      const building = town.building(ref.id);
      if (building) name = structureSpec(building.kind).name;
      break;
    }
    case 'animal': {
      const animal = town.creature(ref.id);
      if (animal?.animal !== null && animal?.animal !== undefined) name = animalSpec(animal.animal).name;
      break;
    }
    case 'monster': {
      const monster = town.creature(ref.id);
      if (monster) {
        const kind = monster.rank === MonsterRank.Guardian ? 'Guardian' : monster.giant() ? 'Giant' : monster.raider ? 'Raider' : 'Monster';
        name = monster.giant() && !monster.angry ? kind : `${kind} · Level ${monster.level}`;
      }
      break;
    }
    case 'tree':
    case 'rock': {
      const map = town.map(), x = ref.id % map.width(), y = Math.floor(ref.id / map.width());
      if (map.inside(x, y)) name = harvestName(harvestProduct(map, x, y, ref.kind === 'rock'), ref.kind === 'rock' && ref.id === map.basaltCell);
      break;
    }
    case 'dungeon':
      name = town.map().dungeons()[ref.id]?.name;
      break;
    case 'road': {
      const road = town.roads().road(ref.id);
      if (road) name = road.paving >= 0 ? 'Paving' : road.built < 1 ? 'Road construction' : 'Road';
      break;
    }
    case 'field':
      if (town.field(ref.id)) name = 'Field';
      break;
    case 'landmark':
      name = ['Odin', 'Fire Mountain', 'Hvergelmir', 'Thor'][ref.id];
      break;
  }
  return name ? { ...ref, key: targetKey(ref), name, bounds: geometry.bounds, geometry } : null;
}

/** Only player residents form command groups; other visible objects remain individually inspectable. */
export function targetsInBox(app: GameCommandApp, box: SelectionBounds): WorldObjectRef[] {
  const selected = new Set<number>();
  const result: WorldObjectRef[] = [];
  for (const hit of app.renderer.querySelection(box)) {
    if (hit.kind !== 'person' || selected.has(hit.id) || !isPlayerResident(app.town.person(hit.id))) continue;
    selected.add(hit.id);
    result.push({ kind: 'person', id: hit.id });
  }
  return result;
}
export function hoveredTarget(app: GameCommandApp): WorldObjectRef | null {
  const hit = cachedWorldHit(app);
  return hit ? reference(hit) : null;
}
/** Whether an Attack click on this hit strikes it: a creature, or a person who is no companion. */
export function struckByAttack(app: Pick<GameCommandApp, 'town'>, hit: WorldObjectRef | null): boolean {
  if (hit?.kind === 'dungeon') return !dungeonAttackProblem(app.town, hit.id);
  if (hit?.kind === 'person') {
    const person = app.town.person(hit.id);
    return !!person && !isPlayerResident(person);
  }
  if (hit?.kind !== 'animal' && hit?.kind !== 'monster') return false;
  const creature = app.town.creature(hit.id);
  return !!creature && !(creature.pen >= 0);
}
