import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { loadSavedTown } from '../../apps/web/src/native/game-application';
import { distance, point } from '../../packages/engine/src/geometry';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { designedWorldSeed } from '../../packages/engine/src/ymir-born';

describe('discovering Fire Mountain', () => {
  let world: WorldMap;
  beforeAll(() => {
    world = WorldMap.generate(designedWorldSeed);
  });

  it('updates the landmarks on the first sight of its slopes even without a new gate', () => {
    const town = new Town(world), map = town.map(), fire = map.volcano()!, heart = fire.center();
    for (const gate of map.dungeons()) gate.discovered = true;
    const revision = town.objectRevision();
    town.reveal(heart.x + 22, heart.y, 7.5);
    expect(map.revealed(heart)).toBe(false);
    expect(town.objectRevision()).toBe(revision);

    town.reveal(heart.x + 21.5, heart.y, 7.5);
    expect(map.revealed(heart)).toBe(true);
    expect(town.objectRevision()).toBeGreaterThan(revision);
    for (const sight of fire.sights()) expect(map.revealedWithin(sight.center, sight.radius)).toBe(true);
    const discovered = town.objectRevision(), count = map.sights().length;
    town.reveal(heart.x + 21.5, heart.y, 7.5);
    expect(town.objectRevision()).toBe(discovered);
    expect(map.sights()).toHaveLength(count);
  });

  it('lets a founder discover the volcano on foot from the founding shore', () => {
    const town = new Town(world), map = town.map(), heart = map.volcano()!.center(),
      founder = town.people()[0], approach = point(136.5, 114.5);
    town.awaiting = true;
    expect(map.revealed(heart)).toBe(false);
    expect(town.grid.path(founder.position, heart)).toHaveLength(0);
    town.orderMove([founder.id], approach);
    expect(founder.path.length).toBeGreaterThan(0);
    for (let i = 0; i < 1200 && distance(founder.position, approach) > 0.01; ++i) {
      town.advance(0.125);
      expect(town.grid.walkable(founder.position)).toBe(true);
    }
    expect(distance(founder.position, approach)).toBeLessThan(0.01);
    expect(map.revealed(heart)).toBe(true);
  });

  it.each([false, true])('preserves a pending navigation change on discovery (%s)', (pending) => {
    const town = new Town(world), map = town.map(), heart = map.volcano()!.center();
    town.advance(0.125);
    for (const gate of map.dungeons()) gate.discovered = true;
    const rebuild = vi.spyOn(town.grid, 'rebuild');
    if (pending) town.roadChanged();
    town.reveal(heart.x + 21.5, heart.y, 7.5);
    expect(town.volcanoRevision).toBe(town.objectRevision());
    town.advance(0.125);
    expect(rebuild).toHaveBeenCalledTimes(pending ? 1 : 0);
  });

  it('recognizes the slopes when daylight reaches them between exploration stamps', () => {
    const town = new Town(world), map = town.map(), heart = map.volcano()!.center(),
      perch = point(136.35, 109.75);
    expect(town.grid.walkable(perch)).toBe(true);
    town.awaiting = true;
    town.people()[0].position = perch;
    town.editHour(0);
    town.advance(0.05);
    expect(map.revealed(heart)).toBe(false);
    town.editHour(12);
    town.advance(0.05);
    expect(map.revealed(heart)).toBe(true);
  });

  it('recognizes the slopes already explored in an older save when play resumes', () => {
    const encoded = gunzipSync(readFileSync(new URL('./fixtures/native-v7.goldfantasy.gz', import.meta.url))).toString();
    const old = decodeTown(encoded, (map) => new Town(map, 32, false, true)).map();
    const heart = old.volcano()!.center();
    expect(old.revealed(heart)).toBe(false);
    const resumed = loadSavedTown(encoded), saved = encodeTown(resumed);
    expect(resumed.map().revealed(heart)).toBe(true);
    expect(encodeTown(loadSavedTown(saved))).toBe(saved);
  });
});
