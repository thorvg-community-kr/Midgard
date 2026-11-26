import { describe, expect, it } from 'vitest';
import * as rendering from '../../apps/web/src/native/game-render';
import { GameAppState } from '../../apps/web/src/native/game-app-state';
import { titlePace, titleSessionRules } from '../../apps/web/src/native/title-session';
import { Town } from '../../packages/engine/src/town';
import { Activity, AnimalKind, Calling, Monster, Role } from '../../packages/engine/src/person';
import { CombatCue } from '../../packages/engine/src/combat-events';
import { breedOf, monsterBite } from '../../packages/engine/src/town-monsters';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Building } from '../../packages/engine/src/town-models';
import { sealable } from '../../packages/engine/src/gate-seals';

function app(realmGate = -1) {
  const town = new Town(5, 32, false);
  town.realmGate = realmGate;
  const a = { town, speed: 1, paused: false, ...rendering };
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the speed functions read only town, speed and paused.
  return a as unknown as typeof a & { speed: number; paused: boolean } & typeof rendering;
}

describe('speed beyond a gate', () => {
  it('runs at 1x inside, ignores raising it, keeps pause, and restores the chosen speed on leaving', () => {
    const a = app();
    a.setSpeed(4);
    expect(a.gameSpeed()).toBe(4);
    a.town.realmGate = 2;
    expect(a.speedLimit()).toBe(1);
    expect(a.gameSpeed()).toBe(1);
    a.cycleSpeed();
    a.setSpeed(5);
    expect(a.gameSpeed()).toBe(1);
    a.togglePause();
    expect(a.gameSpeed()).toBe(0);
    a.setSpeed(1);
    expect(a.gameSpeed()).toBe(1);
    a.town.realmGate = -1;
    expect(a.gameSpeed()).toBe(4);
    a.cycleSpeed();
    expect(a.gameSpeed()).toBe(GameAppState.maxSpeed);
  });
  it('a game loaded inside a gate starts held at 1x', () => {
    const a = app(0);
    a.speed = 3;
    expect(a.gameSpeed()).toBe(1);
  });
});

describe('speed during combat in Midgard', () => {
  it('drops 5x on the first enemy hit, including a killing blow, and keeps pause and slower speeds available', () => {
    const a = app(), town = a.town, at = town.map().camp();
    const resident = town.makePerson(Role.Resident, Calling.Settler, at);
    const enemy = new Monster(town.nextMonster++, 0, at);
    town.folk.push(resident);
    town.beasts.push(enemy);
    a.setSpeed(5);
    a.togglePause();
    town.hurtCreature(enemy, enemy.health, resident);
    expect(a.gameSpeed()).toBe(0);
    a.setSpeed(5);
    expect(a.gameSpeed()).toBe(0);
    a.togglePause();
    expect(a.gameSpeed()).toBe(2);
    a.cycleSpeed();
    expect(a.gameSpeed()).toBe(1);
    a.setSpeed(4);
    expect(a.gameSpeed()).toBe(1);
    a.cycleSpeed();
    expect(a.gameSpeed()).toBe(2);
    town.time += 4;
    expect(a.gameSpeed()).toBe(2);
    a.setSpeed(5);
    expect(a.gameSpeed()).toBe(5);
  });

  it('leaves travel, a raid warning, ordinary hunting and distant neutral combat at the chosen speed', () => {
    const a = app(), town = a.town, at = town.map().camp();
    const resident = town.makePerson(Role.Resident, Calling.Settler, at);
    const chicken = new Monster(town.nextMonster++, -1, at);
    chicken.animal = AnimalKind.Chicken;
    const enemy = new Monster(town.nextMonster++, 0, at);
    enemy.raider = true;
    town.beasts.push(enemy);
    town.emit(CombatCue.Wave, at);
    resident.activity = Activity.Fighting;
    resident.hunting = true;
    a.setSpeed(5);
    town.hurtCreature(chicken, 1, resident);
    const neutral = town.makePerson(Role.Resident, Calling.Settler, at);
    neutral.faction = 1;
    monsterBite(town, enemy, neutral, breedOf(DungeonKind.Cave));
    expect(a.gameSpeed()).toBe(5);
    // An incoming blow counts even when its victim is obeying a move order.
    resident.activity = Activity.Moving;
    monsterBite(town, enemy, resident, breedOf(DungeonKind.Cave));
    expect(a.gameSpeed()).toBe(2);
    town.time += 2;
    monsterBite(town, enemy, resident, breedOf(DungeonKind.Cave));
    town.time += 2;
    expect(a.speedLimit()).toBe(2);
  });

  it.each([Calling.Ranger, Calling.Mage])('slows from the cast against an enemy, before impact, for calling %i', (calling) => {
    const a = app(), town = a.town, at = town.map().camp();
    const caster = town.makePerson(Role.Resident, calling, at);
    caster.level = 4;
    town.folk.push(caster);
    town.scout(at.x, at.y, 6);
    a.setSpeed(5);
    if (calling === Calling.Mage) {
      expect(town.useSkill([caster.id], 0, at)).toBe(1);
      expect(a.gameSpeed()).toBe(5);
      caster.abilityReadyAt = 0;
    }
    const enemy = new Monster(town.nextMonster++, 0, at);
    enemy.raider = true;
    town.beasts.push(enemy);
    const health = enemy.health;
    expect(town.useSkill([caster.id], calling === Calling.Mage ? 0 : 1, at)).toBe(1);
    expect(enemy.health).toBe(health);
    expect(a.gameSpeed()).toBe(2);
  });

  it('keeps a dungeon approach fast and slows down when the attackers reach the structure', () => {
    const a = app(), town = a.town;
    const gate = town.map().dungeons().findIndex(sealable);
    town.map().dungeons()[gate].discovered = true;
    const resident = town.makePerson(Role.Resident, Calling.Settler, town.map().camp());
    town.folk.push(resident);
    a.setSpeed(5);
    expect(town.orderAttackDungeon([resident.id], gate)).toBe(true);
    town.fight(resident, 0.05);
    expect(a.gameSpeed()).toBe(5);
    resident.position = { ...resident.goal };
    town.fight(resident, 0.05);
    expect(a.gameSpeed()).toBe(2);
  });

  it('includes defensive fire even before a resident takes part in the fighting', () => {
    const a = app(), town = a.town, at = town.map().camp();
    const tower = new Building(town.nextId++, Structure.Watchtower, at, 0, 0);
    town.placed.push(tower);
    const raider = new Monster(town.nextMonster++, 0, at);
    raider.raider = true;
    town.beasts.push(raider);
    a.setSpeed(5);
    town.defendSettlement(0.05);
    expect(raider.health).toBeLessThan(3);
    expect(a.gameSpeed()).toBe(2);
  });

  it('slows the title simulation during an encounter outside a raid or realm', () => {
    const { town } = app(), at = town.map().camp();
    const resident = town.makePerson(Role.Resident, Calling.Settler, at);
    town.folk.push(resident);
    const enemy = new Monster(town.nextMonster++, 0, at);
    town.beasts.push(enemy);
    expect(town.raiding()).toBe(false);
    expect(titlePace(town)).toBe(titleSessionRules.pace);
    town.strike(resident, enemy);
    expect(titlePace(town)).toBe(2);
    town.time += 4;
    expect(titlePace(town)).toBe(titleSessionRules.pace);
  });
});
