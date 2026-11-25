import { describe, expect, it, vi } from 'vitest';
import { attackDungeon } from '../../apps/web/src/native/dungeon-attack';
import { targetedDungeon } from '../../packages/engine/src/dungeon-siege';
import { point } from '../../packages/engine/src/geometry';
import { Activity, Calling, Role } from '../../packages/engine/src/person';
import { sealFloors } from '../../packages/engine/src/gate-seals';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Cue, Sound } from '../../packages/native-audio/src/sound-types';

/** A dungeon across open land, with an island from which no one can march to it. */
function fixture(...callings: Calling[]) {
  const size = 32, map = new WorldMap();
  map.columns = map.rows = size;
  map.origin = point(4, 5);
  map.mapSeed = 7;
  map.tiles = Array.from({ length: size * size }, (_, i) => {
    const x = i % size;
    return { ...makeTile(), terrain: x >= 16 && x < 23 ? Terrain.Sea : Terrain.Grass, revealed: true };
  });
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array((size * 2 + 1) ** 2));
  map.layer(Layer.Land).fill(1);
  map.sites = [
    { kind: DungeonKind.Cave, origin: point(10, 6), name: 'Cave', discovered: true },
    { kind: DungeonKind.Crypt, origin: point(10, 12), name: 'Crypt', discovered: true },
    { kind: DungeonKind.GiantHall, origin: point(8, 15), name: 'Giant hall', discovered: true },
  ];
  const town = new Town(map, size, false);
  const folk = callings.map((calling, index) => {
    const person = town.makePerson(Role.Resident, calling, point(3 + index, 5));
    town.folk.push(person);
    return person;
  });
  const app = {
    town, chosen: [] as number[], selectedDungeon: -1, dungeonAttackers: [] as number[],
    cues: [] as Sound[], status: '', paused: false,
    selectPeople: vi.fn((ids: readonly number[]) => { app.chosen = [...ids]; }),
  };
  const marching = (gate: number) => folk.filter(p => targetedDungeon(p) === gate).map(p => p.id);
  return { app, town, folk, marching };
}

describe('the dungeon attack command', () => {
  it('sends combat callings and armed settlers with one order, leaving the work crew in place', () => {
    const { app, folk, marching } = fixture(Calling.Warrior, Calling.Cleric, Calling.Settler, Calling.Settler);
    folk[2].inventory[0] = { item: 'wooden-sword', quantity: 1 };
    folk[2].equipment.weapon = 1;
    folk[3].inventory[0] = { item: 'wooden-mallet', quantity: 1 };
    expect(attackDungeon(app, 0)).toBe(true);
    const attackers = folk.slice(0, 3).map(p => p.id);
    expect(marching(0)).toEqual(attackers);
    expect(app.chosen).toEqual(attackers);
    expect(app.cues.map(sound => sound.cue)).toEqual([Cue.Order]);
    expect(app.paused).toBe(false);
  });

  it('uses available settlers when the trained fighter cannot reach the dungeon', () => {
    const { app, folk, marching } = fixture(Calling.Ranger, Calling.Settler, Calling.Settler);
    folk[0].position = point(27, 10);
    expect(attackDungeon(app, 0)).toBe(true);
    expect(marching(0)).toEqual([folk[1].id, folk[2].id]);
    expect(app.chosen).toEqual(marching(0));
  });

  it('leaves the injured, recovering, downed, visiting and independently settled out of an automatic attack', () => {
    const { app, town, folk, marching } = fixture(
      Calling.Settler, Calling.Warrior, Calling.Ranger, Calling.Mage, Calling.Cleric, Calling.Warrior, Calling.Warrior,
    );
    folk[1].woundDays = 2;
    folk[2].stressRecovery = true;
    folk[3].downedAt = town.time;
    folk[3].activity = Activity.Downed;
    folk[4].role = Role.Guest;
    folk[5].faction = 1;
    expect(town.orderAttackDungeon([folk[6].id], 1)).toBe(true);
    expect(attackDungeon(app, 0)).toBe(true);
    expect(marching(0)).toEqual([folk[0].id]);
    expect(marching(1)).toEqual([folk[6].id]);
  });

  it('respects a selected group, a paused game and subsequent move orders', () => {
    const { app, town, folk, marching } = fixture(Calling.Warrior, Calling.Settler, Calling.Warrior);
    app.chosen = [folk[1].id, folk[2].id];
    folk[2].position = point(27, 10);
    app.paused = true;
    expect(attackDungeon(app, 0)).toBe(true);
    expect(marching(0)).toEqual([folk[1].id]);
    expect(app.chosen).toEqual([folk[1].id]);
    expect(app.paused).toBe(true);
    town.orderMove(app.chosen, point(5, 8));
    expect(marching(0)).toEqual([]);
  });

  it('reports a failed explicit order without drafting someone else', () => {
    const { app, folk, marching } = fixture(Calling.Settler, Calling.Warrior);
    app.chosen = [folk[0].id];
    folk[0].position = point(27, 10);
    expect(attackDungeon(app, 0)).toBe(false);
    expect(app.status).toBe('No path to the dungeon');
    folk[0].stressRecovery = true;
    expect(attackDungeon(app, 0)).toBe(false);
    expect(app.status).toBe('No settler is available to attack.');
    expect(marching(0)).toEqual([]);
    expect(app.chosen).toEqual([folk[0].id]);
    expect(app.cues).toEqual([]);
  });

  it('accepts dormant dungeons and refuses sealed, undiscovered, breached and neutral sites', () => {
    const { app, town, folk } = fixture(Calling.Settler);
    expect(attackDungeon(app, 0)).toBe(true);
    town.orderHold([folk[0].id]);
    town.depth[0] = sealFloors;
    expect(attackDungeon(app, 0)).toBe(false);
    town.map().sites[1].discovered = false;
    expect(attackDungeon(app, 1)).toBe(false);
    town.map().sites[1].discovered = true;
    town.sieges[1] = { health: 0, summonAt: 1, reviveAt: -1, guardian: -1, village: 0 };
    expect(attackDungeon(app, 1)).toBe(false);
    expect(attackDungeon(app, 2)).toBe(false);
    expect(targetedDungeon(folk[0])).toBe(-1);
  });
});
