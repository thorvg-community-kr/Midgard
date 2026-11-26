import { attackReach } from '../../packages/engine/src/equipment';
import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Activity, AnimalKind, Calling, Monster, Person, Race, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { distance, point, type Point } from '../../packages/engine/src/geometry';
import { CombatCue } from '../../packages/engine/src/combat-events';
import { secondSkillLevel, skillPower, skillSpec } from '../../packages/engine/src/skill-catalog';
import { skillEffects } from '../../packages/engine/src/monster-ranks';
import { itemCatalog } from '../../packages/engine/src/equipment';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';

function fixture() {
  const map = new WorldMap();
  map.columns = map.rows = 48;
  map.mapSeed = 5;
  map.origin = { x: 12, y: 12 };
  map.tiles = Array.from({ length: 48 * 48 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(97 * 97).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [{ name: 'Raid source', kind: DungeonKind.Cave, origin: { x: 38, y: 38 }, discovered: true }];
  map.reveal(24, 24, 100);
  const town = new Town(map, 48, false);
  town.placed.push(new Building(0, Structure.Camp, point(12, 12), 0, 0));
  town.nextId = 1;
  town.migrateSettlements();
  Object.assign(town.stock(), new Resources(200, 60, 60, 60, 0, 60, 20, 20));
  town.folk = [];
  town.nextPerson = 0;
  town.editHour(12);
  town.wildlifeDay = town.days;
  town.tick(0);
  return town;
}
function resident(town: Town, at: Point, calling: Calling, visual: string | null = null, level = 5) {
  const p = new Person(town.nextPerson++, `R${town.nextPerson}`, Role.Resident, calling, Race.Human, 0, { ...at });
  p.home = p.village = 0;
  p.food = p.rest = p.health = p.hydration = 1;
  p.level = level;
  p.stress = 0;
  p.activity = p.task = Activity.Idle;
  p.until = town.clock();
  town.folk.push(p);
  if (visual) {
    const item = itemCatalog
      .filter((i) => i.category === 'weapon' && i.visual === visual && i.minimumLevel <= p.level)
      .sort((a, b) => b.attackBonus - a.attackBonus)[0];
    p.inventory[0] = { item: item.id, quantity: 1 };
    p.equipment.weapon = 1;
  }
  return p;
}
function monster(town: Town, at: Point, health = 100) {
  const m = new Monster(town.nextMonster++, 0, { ...at });
  m.home = { ...at };
  m.health = m.vigor = health;
  m.raider = true;
  m.ready = town.clock() + 1000;
  town.beasts.push(m);
  return m;
}
function step(town: Town, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); ++i) {
    town.wildlifeDay = town.days;
    town.advance(0.1);
  }
}
const cues = (town: Town, cue: CombatCue) => town.combatEvents().filter((event) => event.cue === cue);

describe('hold position', () => {
  it('stands, strikes what comes into reach and never chases', () => {
    const town = fixture(),
      p = resident(town, point(20, 20), Calling.Warrior, 'sword'),
      far = monster(town, point(26, 20));
    far.raider = false;
    expect(town.orderHold([p.id])).toBe(1);
    expect(p.holding).toBe(true);
    step(town, 2);
    expect(p.position).toEqual(point(20, 20));
    expect(far.health).toBe(100);
    far.position = point(20.7, 20);
    far.angry = true;
    step(town, 1.2);
    expect(far.health).toBeLessThan(100);
    expect(p.activity).toBe(Activity.Fighting);
    expect(distance(p.position, point(20, 20))).toBeLessThan(0.01);
    far.position = point(26, 20);
    far.angry = false;
    step(town, 1);
    expect(p.activity).toBe(Activity.Holding);
    expect(distance(p.position, point(20, 20))).toBeLessThan(0.01);
  });
  it('still uses skills left on auto, and any other order ends it', () => {
    const town = fixture(),
      cleric = resident(town, point(20, 20), Calling.Cleric),
      hurt = resident(town, point(21, 20), Calling.Settler);
    town.orderHold([cleric.id]);
    hurt.health = 0.2;
    step(town, 0.3);
    expect(hurt.health).toBeGreaterThan(0.5);
    town.orderMove([cleric.id], point(25, 25));
    expect(cleric.holding).toBe(false);
    town.orderHold([cleric.id]);
    town.orderStop([cleric.id]);
    expect(cleric.holding).toBe(false);
  });
});

describe('move orders share the clicked destination', () => {
  it.each(['orderMove', 'orderAttackMove'] as const)('%s gathers at one point in arrival order with room to stand', (order) => {
    const town = fixture(), destination = point(26.4, 22.1);
    town.scheduleAutomatic = () => false; // Observe the rally before any new settlement job.
    const group = [
      resident(town, point(22, 22), Calling.Mage, 'staff'),
      resident(town, point(19, 21), Calling.Warrior, 'sword'),
      resident(town, point(19, 23), Calling.Bard),
      resident(town, point(19, 22), Calling.Settler, 'spear'),
      resident(town, point(20, 21), Calling.Ranger, 'bow'),
      resident(town, point(20, 23), Calling.Cleric, 'mace'),
    ];
    town[order](group.map(p => p.id), destination);
    for (const p of group) {
      expect(p.goal).toEqual(destination);
      expect(p.path.at(-1)).toEqual(destination);
    }
    for (let i = 0; i < 150 && group.some(p => p.moving()); ++i) step(town, .1);
    expect(group.every(p => !p.moving())).toBe(true);
    // Whoever gets there first can stand on the click, irrespective of their weapon.
    expect(distance(group[0].position, destination)).toBeLessThan(.04);
    for (const [i, member] of group.entries()) {
      expect(distance(member.position, destination)).toBeLessThan(1.5);
      for (const other of group.slice(i + 1)) expect(distance(member.position, other.position)).toBeGreaterThan(.4);
    }
  });
  it('keeps the shared click beyond a narrow pass and gathers on the far side', () => {
    const town = fixture();
    town.scheduleAutomatic = () => false;
    for (let y = 0; y < town.world.height(); ++y)
      if (y !== 20) town.world.at(22, y).terrain = Terrain.Water;
    town.grid.rebuild(town.world, town.network, []);
    const destination = point(26.5, 20.5);
    const group = Array.from({ length: 14 }, (_, i) =>
      resident(town, point(16 + i % 4, 18 + Math.floor(i / 4)), Calling.Settler));
    town.orderMove(group.map(p => p.id), destination);
    for (let i = 0; i < 250 && group.some(p => p.moving()); ++i) step(town, .1);
    for (const [i, p] of group.entries()) {
      expect(p.moving()).toBe(false);
      expect(p.position.x).toBeGreaterThan(23);
      expect(distance(p.position, destination)).toBeLessThan(1.6);
      expect(p.goal).toEqual(destination);
      for (const other of group.slice(i + 1)) expect(distance(p.position, other.position)).toBeGreaterThan(.4);
    }
  });
  it('makes a spear thrust hand to hand: its blow is not a shot', () => {
    const town = fixture(),
      p = resident(town, point(20, 20), Calling.Warrior, 'spear'),
      foe = monster(town, point(21.2, 20)),
      behind = monster(town, point(22.2, 20));
    town.roll = () => 0.99;
    town.strike(p, foe);
    const hits = town.hits().filter((hit) => hit.attacker === p.id);
    expect(hits.map((hit) => [hit.ranged, hit.primary])).toEqual([[false, true]]);
    expect(behind.health).toBe(100);
  });
  it('sends a single resident to the exact point', () => {
    const town = fixture(),
      p = resident(town, point(10, 10), Calling.Warrior, 'sword');
    town.orderAttackMove([p.id], point(20.3, 14.6));
    expect(p.path.at(-1)).toEqual(point(20.3, 14.6));
  });
});

describe('two skills per calling', () => {
  it('lists both skills, the second locked below its level, and keeps the slot-0 API', () => {
    const town = fixture(),
      young = resident(town, point(15, 15), Calling.Warrior, null, 1),
      old = resident(town, point(16, 15), Calling.Warrior, null, secondSkillLevel),
      settler = resident(town, point(17, 15), Calling.Settler);
    expect(town.skillsOf(young).map((s) => [s.id, s.slot, s.locked, s.ready, s.level])).toEqual([
      ['challenge', 0, false, true, 1],
      ['whirl', 1, true, false, secondSkillLevel],
    ]);
    expect(town.skillsOf(old)[1]).toMatchObject({ id: 'whirl', locked: false, ready: true });
    expect(town.skillsOf(settler)).toEqual([]);
    expect(town.abilityOf(old)).toEqual(town.skillsOf(old)[0]);
    expect(town.useSkill([young.id], 1)).toBe(0);
    expect(town.skillReach(old, 1)).toBe(attackReach(old));
    expect(town.abilityReach(old)).toBe(town.skillReach(old, 0));
    // Skills help on their own until the player takes one in hand.
    expect(town.skillsOf(old).map((s) => s.auto)).toEqual([true, true]);
    expect(town.setSkillAuto([old.id], 1, false)).toBe(1);
    expect(town.skillsOf(old)[1].auto).toBe(false);
    expect(town.skillsOf(old)[0].auto).toBe(true);
  });
  it.each([
    ['whirl' as const, Calling.Warrior, 'sword'],
    ['volley' as const, Calling.Ranger, 'bow'],
  ] as const)('%s follows the chosen enemy and spares the crowd around it', (skill, calling, weapon) => {
    const town = fixture(),
      p = resident(town, point(20, 20), calling, weapon),
      beside = monster(town, point(20.7, 20)),
      mark = monster(town, point(20.45, 20)),
      behind = monster(town, point(21.4, 20)),
      blow = town.blowStrength(p);
    p.foe = mark.id;
    town.setSkillAuto([p.id], 0, false);
    expect(town.skillsOf(p)[1].targeted).toBe(false);
    expect(town.useSkill([p.id], 1)).toBe(1);
    expect(cues(town, CombatCue.Ability).at(-1)).toMatchObject({ skill, creature: mark.id, radius: 0 });
    expect(mark.health).toBe(100);
    mark.position = point(20.5, 20.1);
    town.time += skillSpec(skill).delay;
    town.advanceAbilities();
    expect(100 - mark.health).toBeCloseTo(blow * skillPower[skill], 4);
    expect([beside.health, behind.health]).toEqual([100, 100]);
  });
  it('lets the target step out of a warrior’s reach during the wind-up', () => {
    const town = fixture(), p = resident(town, point(20, 20), Calling.Warrior, 'sword');
    const mark = monster(town, point(20.4, 20));
    town.setSkillAuto([p.id], 0, false);
    expect(town.useSkill([p.id], 1)).toBe(1);
    mark.position = point(21, 20);
    town.time += skillSpec('whirl').delay;
    town.advanceAbilities();
    expect(mark.health).toBe(100);
  });
  it('does not transfer a physical skill to a bystander when the target dies before impact', () => {
    const town = fixture(), p = resident(town, point(20, 20), Calling.Ranger, 'bow'),
      mark = monster(town, point(22, 20)), beside = monster(town, point(22.1, 20));
    town.setSkillAuto([p.id], 0, false);
    expect(town.useSkill([p.id], 1)).toBe(1);
    mark.health = 0;
    town.time += skillSpec('volley').delay;
    town.advanceAbilities();
    expect(beside.health).toBe(100);
  });
  it.each([Calling.Warrior, Calling.Ranger])('auto skills pass peaceful creatures to hit a raider for calling %i', calling => {
    const town = fixture(), p = resident(town, point(20, 20), calling),
      giant = monster(town, point(20.5, 20)), wildlife = monster(town, point(20.3, 20)),
      raider = monster(town, point(20.25, 20));
    giant.race = Race.Giant;
    wildlife.animal = AnimalKind.Wolf;
    town.beasts.splice(town.beasts.indexOf(wildlife), 1);
    town.animals.push(wildlife);
    giant.raider = giant.angry = wildlife.raider = wildlife.angry = false;
    p.activity = Activity.Fighting;
    town.setSkillAuto([p.id], 0, false);
    town.advanceAbilities();
    town.time += skillSpec(calling === Calling.Warrior ? 'whirl' : 'volley').delay;
    town.advanceAbilities();
    expect(raider.health).toBeLessThan(100);
    for (const neutral of [giant, wildlife]) expect(neutral).toMatchObject({ health: 100, angry: false });
  });
  it('honors an explicit attack order against a peaceful giant', () => {
    const town = fixture(), p = resident(town, point(20, 20), Calling.Ranger),
      raider = monster(town, point(21, 20)), giant = monster(town, point(24, 20));
    giant.race = Race.Giant;
    giant.raider = giant.angry = false;
    town.setSkillAuto([p.id], 0, false);
    expect(town.orderAttack([p.id], giant.id)).toBe(true);
    expect(town.useSkill([p.id], 1)).toBe(1);
    town.time += skillSpec('volley').delay;
    town.advanceAbilities();
    expect(giant.health).toBeLessThan(100);
    expect(giant.angry).toBe(true);
    expect(raider.health).toBe(100);
  });
  it('Frost Ring slows the enemies inside to half pace and half bite rate', () => {
    const town = fixture(),
      mage = resident(town, point(20, 20), Calling.Mage, 'staff'),
      inside = monster(town, point(25, 20)),
      outside = monster(town, point(30, 20));
    expect(town.useSkill([mage.id], 1, point(25, 20))).toBe(1);
    step(town, 0.5);
    expect(town.combatState.chilled.has(inside.id)).toBe(true);
    expect(town.combatState.chilled.has(outside.id)).toBe(false);
    expect(skillEffects.frostSlow).toBe(0.5);
    step(town, skillSpec('frost').duration + 0.5);
    expect(town.combatState.chilled.has(inside.id)).toBe(false);
  });
  it('Sanctuary mends the allies inside and keeps the downed from bleeding out', () => {
    const town = fixture(),
      c = resident(town, point(20, 20), Calling.Cleric),
      hurt = resident(town, point(21, 20), Calling.Settler),
      fallen = resident(town, point(20, 21), Calling.Settler);
    town.setSkillAuto([c.id], 0, false);
    town.orderHold([c.id, hurt.id]);
    hurt.health = 0.3;
    town.strikeDown(fallen, 'Killed by monsters');
    const left = town.bleedOutLeft(fallen);
    expect(town.useSkill([c.id], 1)).toBe(1);
    expect(town.hallowed(hurt)).toBe(true);
    step(town, 2);
    expect(hurt.health).toBeCloseTo(0.3 + 2 * skillPower.sanctuaryMend, 2);
    expect(fallen.downedAt).toBeGreaterThanOrEqual(0);
    expect(town.bleedOutLeft(fallen)).toBeCloseTo(left, 0);
  });
  it('Dirge softens the bites and slows the steps of enemies around the bard', () => {
    const town = fixture(),
      bard = resident(town, point(20, 20), Calling.Bard),
      m = monster(town, point(21, 20));
    m.ready = 0;
    town.orderHold([bard.id]);
    bard.ready = Infinity;
    town.roll = () => 0.99;
    step(town, 0.1);
    const plain = 1 - bard.health;
    bard.health = 1;
    expect(town.useSkill([bard.id], 1)).toBe(1);
    expect(town.combatState.dirged.has(m.id)).toBe(true);
    m.ready = 0;
    step(town, 0.1);
    expect(1 - bard.health).toBeCloseTo(plain * skillEffects.dirgeBite, 4);
  });
  it('fires skills on their own when they would help, except one the player has taken in hand', () => {
    const town = fixture(),
      w = resident(town, point(20, 20), Calling.Warrior, 'sword');
    for (const at of [point(21, 20), point(20, 21), point(19, 20), point(20, 19)]) monster(town, at);
    town.orderHold([w.id]);
    town.setSkillAuto([w.id], 1, false);
    step(town, 0.6);
    expect(w.abilityReadyAt2).toBe(0);
    town.setSkillAuto([w.id], 1, true);
    step(town, 0.6);
    expect(w.abilityReadyAt2).toBeGreaterThan(0);
  });
  it('keeps second-skill readiness, auto and hold position across a save, at the lowest version that holds them', () => {
    const town = fixture(),
      w = resident(town, point(20, 20), Calling.Warrior, 'sword');
    const version = (save: string) => Number.parseInt(save.slice(17, 19), 16);
    const plain = encodeTown(town);
    expect(version(plain)).toBeLessThan(15);
    // A combat record without anything new stays a version 15 save and loads as before.
    w.kills = 3;
    w.abilityReadyAt = town.clock() + 2;
    const older = encodeTown(town);
    expect(version(older)).toBe(15);
    expect(decodeTown(older, (map) => new Town(map, 48, false, true)).person(w.id)).toMatchObject({ kills: 3, abilityAuto2: -1, holding: false });
    town.setSkillAuto([w.id], 1, false);
    town.orderHold([w.id]);
    w.abilityReadyAt2 = town.clock() + 7;
    const save = encodeTown(town);
    expect(version(save)).toBe(16);
    const loaded = decodeTown(save, (map) => new Town(map, 48, false, true)).person(w.id)!;
    expect(loaded).toMatchObject({ abilityAuto2: 0, holding: true, abilityReadyAt2: w.abilityReadyAt2, cast: '', swingAt: -1 });
    expect(decodeTown(plain, (map) => new Town(map, 48, false, true)).person(w.id)!.holding).toBe(false);
  });
});

it('keeps the shared destination through a save while the archer stops to shoot', () => {
  const town = fixture(), goal = point(25, 20);
  const archer = resident(town, point(20, 20), Calling.Ranger, 'bow');
  const guard = resident(town, point(19.5, 20), Calling.Warrior, 'sword');
  archer.abilityAuto = archer.abilityAuto2 = 0;
  const foe = monster(town, point(20, 22));
  town.orderMove([guard.id, archer.id], goal);
  step(town, 0.1);
  expect(archer.activity).toBe(Activity.Fighting);
  expect(foe.health).toBeLessThan(100);
  expect(guard.activity).toBe(Activity.Moving);

  const loaded = decodeTown(encodeTown(town), map => new Town(map, 48, false, true));
  const party = [loaded.person(guard.id)!, loaded.person(archer.id)!];
  for (const p of party) expect(p).toMatchObject({ goal, task: Activity.Moving, ordered: true, aggressive: false });
  loaded.creature(foe.id)!.health = 0;
  for (let i = 0; i < 150 && party.some(p => p.ordered); ++i) step(loaded, 0.1);
  for (const p of party) {
    expect(p.ordered).toBe(false);
    expect(distance(p.position, goal)).toBeLessThan(0.9);
  }
  expect(distance(party[0].position, party[1].position)).toBeGreaterThan(0.08);
});
