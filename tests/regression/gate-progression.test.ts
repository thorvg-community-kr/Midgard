import { describe, expect, it } from 'vitest';
import { Structure } from '../../packages/engine/src/building-catalog';
import { gateActive, gateOrder, musteredGates, raidSeat, raidSources } from '../../packages/engine/src/gate-progression';
import { gateSealed, sealFloors } from '../../packages/engine/src/gate-seals';
import { distance, point } from '../../packages/engine/src/geometry';
import { Calling, Role } from '../../packages/engine/src/person';
import { RaidKind, raidDue, raidKind } from '../../packages/engine/src/raid-progression';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { Town } from '../../packages/engine/src/town';
import { Building } from '../../packages/engine/src/town-models';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, makeTile, Terrain } from '../../packages/engine/src/world-types';

function building(town: Town, kind: Structure, x: number, y: number, faction = 0) {
  const b = new Building(town.nextId++, kind, point(x, y), 0, 0);
  b.faction = faction;
  town.placed.push(b);
  return b;
}
function settlement() {
  const map = new WorldMap(), size = 64;
  map.columns = map.rows = size;
  map.mapSeed = 5;
  map.origin = { x: 5, y: 9 };
  map.tiles = Array.from({ length: size * size }, (_, i) => ({
    ...makeTile(), terrain: Math.floor(i / size) >= 38 ? Terrain.Sea : Terrain.Grass, revealed: true,
  }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array((size * 2 + 1) ** 2));
  map.layer(Layer.Land).fill(1);
  map.sites = [48, 12, 52, 24, 36, 44].map(x => ({
    name: `Gate ${x}`, kind: DungeonKind.Cave, origin: { x, y: 12 }, discovered: false,
  }));
  map.sites.push({ name: 'Stone Hall', kind: DungeonKind.GiantHall, origin: { x: 4, y: 28 }, discovered: true });
  const town = new Town(map, size, false), camp = building(town, Structure.Camp, 5, 9);
  town.depth = town.world.dungeons().map(() => 0);
  camp.village = camp.id;
  town.foundSettlement(camp.id);
  const addResident = () => {
    const p = town.makePerson(Role.Resident, Calling.Settler, point(5, 13));
    town.folk.push(p);
    return p;
  };
  return { town, camp, gates: gateOrder(town), addResident };
}
function hour(town: Town, day: number, time: number) {
  town.days = day;
  town.editHour(time);
  town.stir(0);
}
const warnings = (town: Town) => town.notices.filter(line => line.endsWith(' tonight'));

describe('dormant gates and raids on settlements', () => {
  it('lets a discovered dungeon be assaulted before it awakens, and gives an unprovoked settlement two quiet nights', () => {
    const { town, camp, gates, addResident } = settlement(), hero = addResident();
    const [first, second] = gates;
    town.map().dungeons()[second].discovered = true;
    expect(town.canSendExpedition([hero.id], second).ok).toBe(true);
    expect(gates.every(gate => !gateActive(town, gate) && !town.floorOpen(gate, 0))).toBe(true);
    expect(town.orderAttackDungeon([hero.id], second)).toBe(true);
    town.orderStop([hero.id]);
    for (const day of [0, 1]) {
      hour(town, day, 12);
      hour(town, day, 23);
      town.releaseMonster(camp.center);
      expect(town.beasts.filter(b => !b.giant())).toHaveLength(0);
    }
    camp.progress = 0.9;
    hour(town, 2, 12);
    expect(raidSources(town, RaidKind.Pack)).toEqual([]);
    expect(warnings(town)).toEqual([]);
    camp.progress = 1;
    hour(town, 2, 13);
    expect(gates.filter(gate => gateActive(town, gate))).toEqual([first]);
    expect(town.canSendExpedition([hero.id], first).reason).toBe('No known dungeon there');
    expect(warnings(town)).toEqual(['A pack from Gate 12 will raid Camp #1 tonight']);
    expect(town.raids()).toBe(0);
    town.map().dungeons()[first].discovered = true;
    expect(town.sendExpedition([hero.id], first)).toBe(true);
    expect(town.floorOpen(first, 1)).toBe(false);
    hour(town, 2, 23);
    expect(town.raids()).toBe(1);
    expect(town.beasts.filter(b => b.raider).every(b => b.lair === first)).toBe(true);
    hour(town, 2, 23);
    expect(town.raids()).toBe(1);
    expect(town.notices.filter(n => n.endsWith('has opened'))).toEqual(['Gate 12 has opened']);
  });

  it('uses player deeds and completed buildings, and remembers each opening after losses and a save', () => {
    const { town, gates, addResident } = settlement();
    const [first, smith, veteran, guild, sealOne, sealTwo] = gates;
    const folk = Array.from({ length: 6 }, addResident);
    folk[3].faction = folk[4].faction = folk[5].faction = 1;
    const forge = building(town, Structure.Weaponsmith, 19, 8, 1);
    const hall = building(town, Structure.GuildHall, 24, 7);
    const refresh = () => hour(town, 2, 8);
    refresh();
    expect(gates.filter(gate => gateActive(town, gate))).toEqual([first]);
    forge.faction = 0;
    forge.progress = 0.8;
    folk[3].faction = 0;
    refresh();
    expect(gateActive(town, smith)).toBe(false);
    forge.progress = 1;
    refresh();
    expect(gateActive(town, smith)).toBe(true);
    town.depth[first] = 1;
    folk[5].level = 4;
    refresh();
    expect(gateActive(town, veteran)).toBe(false);
    folk[0].level = 4;
    refresh();
    expect(gateActive(town, veteran)).toBe(true);
    expect(gateActive(town, guild)).toBe(false);
    folk[4].faction = folk[5].faction = 0;
    refresh();
    expect(gateActive(town, guild)).toBe(true);
    expect(gateActive(town, sealOne)).toBe(false);
    town.depth[first] = sealFloors;
    refresh();
    expect(gateActive(town, sealOne)).toBe(true);
    expect(gateActive(town, sealTwo)).toBe(false);
    town.depth[smith] = sealFloors;
    refresh();
    expect(gateActive(town, sealTwo)).toBe(true);
    town.folk = [];
    town.placed = town.placed.filter(b => b !== forge && b !== hall);
    const resumed = decodeTown(encodeTown(town), map => new Town(map, 64, false, true));
    expect(resumed.open).toEqual(town.open);
    expect(gateSealed(resumed, first)).toBe(true);
    expect(gateActive(resumed, guild)).toBe(true);
    expect(gateActive(resumed, resumed.world.dungeons().length - 1)).toBe(false);
    expect(raidSources(resumed, RaidKind.Pincer)).toEqual(raidSources(town, RaidKind.Pincer));
  });

  it('marches from each gate to its own closest finished player seat and rotates older gates back in', () => {
    const { town, gates, camp } = settlement();
    const outer = building(town, Structure.Keep, 43, 20);
    const neutral = building(town, Structure.Camp, 48, 15, 1);
    const unfinished = building(town, Structure.Camp, 46, 15);
    unfinished.progress = 0.9;
    town.migrateSettlements();
    const chosen = [gates[0], gates[3], gates[5]];
    for (const gate of chosen) town.open[gate] = 1;
    expect(raidSeat(town, chosen[0])).toBe(camp);
    expect(raidSeat(town, chosen[1])).toBe(outer);
    const seen = new Set<number>();
    for (let i = 0; i < chosen.length; ++i) {
      town.summonRaid(RaidKind.Pack);
      const wave = town.beasts.filter(b => b.raider), gate = wave[0].lair, seat = raidSeat(town, gate)!;
      expect(wave.every(b => b.lair === gate && b.prey === seat.id)).toBe(true);
      expect(wave.every(b => b.path.length && distance(b.path.at(-1)!, seat.center) < 4)).toBe(true);
      expect(wave.every(b => distance(b.home, point(town.world.dungeons()[gate].origin.x + 1, 14.3)) < 2)).toBe(true);
      const before = distance(wave[0].position, seat.center);
      for (let step = 0; step < 30; ++step) town.stir(0.1);
      expect(distance(wave[0].position, seat.center)).toBeLessThan(before);
      expect(neutral.health).toBe(1);
      expect(unfinished.progress).toBe(0.9);
      seen.add(gate);
      town.beasts = [];
    }
    expect(seen).toEqual(new Set(chosen));
    const later = gates[4];
    town.open[later] = 2;
    town.summonRaid(RaidKind.Pincer);
    expect(new Set(town.beasts.map(b => b.lair)).size).toBe(2);
    expect(town.beasts.some(b => b.lair === later)).toBe(true);
    expect(town.open[later]).toBe(1);
  });

  it('only launches the warned routes and holds a late opening for the next daylight warning', () => {
    const { town, gates } = settlement();
    town.open[gates[0]] = town.open[gates[1]] = 1;
    let day = 7;
    while (!raidDue(5, day) || raidKind(5, day) !== RaidKind.Pincer) ++day;
    hour(town, day, 12);
    expect(warnings(town)).toHaveLength(2);
    expect(musteredGates(town)).toEqual(gates.slice(0, 2));
    town.depth[gates[0]] = sealFloors;
    const reloaded = decodeTown(encodeTown(town), map => new Town(map, 64, false, true));
    hour(reloaded, day, 23);
    expect(new Set(reloaded.beasts.filter(b => b.raider).map(b => b.lair))).toEqual(new Set([gates[1]]));
    hour(town, day, 23);
    expect(new Set(town.beasts.filter(b => b.raider).map(b => b.lair))).toEqual(new Set([gates[1]]));
    expect(gateActive(town, gates[4])).toBe(true);
    expect(town.notices.some(n => n === 'Raiders from Gate 12 march on Camp #1')).toBe(false);
    hour(town, day + 1, 12);
    expect(musteredGates(town)).toContain(gates[4]);
    hour(town, day + 1, 23);
    expect(town.beasts.some(b => b.raider && b.lair === gates[4])).toBe(true);
  });

  it('defers a gate that wakes at night and reconstructs the next dusk muster across a save', () => {
    const { town, gates } = settlement();
    hour(town, 2, 23);
    expect(gateActive(town, gates[0])).toBe(true);
    expect(warnings(town)).toEqual([]);
    expect(town.raids()).toBe(0);
    hour(town, 3, 14);
    expect(warnings(town)).toHaveLength(1);
    const resume = (t: Town) => decodeTown(encodeTown(t), map => new Town(map, 64, false, true));
    const loaded = resume(town);
    for (const t of [town, loaded]) {
      hour(t, 3, 23);
      expect(t.raids()).toBe(1);
      expect(t.open[gates[0]]).toBe(1);
      const pack = t.beasts.filter(m => m.raider);
      expect(pack).toHaveLength(10);
      expect(pack.every(m => m.lair === gates[0])).toBe(true);
    }
    const afterRaid = resume(loaded);
    hour(afterRaid, 3, 23);
    expect(afterRaid.raids()).toBe(1);
  });
});
