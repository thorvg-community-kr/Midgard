import { describe, it, expect, vi } from 'vitest';
import { pointerUp, wheel } from '../../apps/web/src/native/game-input';
import { issueOrder, type GameCommandApp } from '../../apps/web/src/native/game-commands';
import { Order, PointerButton, Tool } from '../../packages/engine/src/game-tools';
import { point } from '../../packages/engine/src/geometry';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { AnimalKind, Calling, Person, Race, Role, Monster } from '../../packages/engine/src/person';
import { GameApplication } from '../../apps/web/src/native/game-application';
import { presentedHit } from './fixtures/presented-hit';
import { ArmyState } from '../../apps/web/src/native/army-state';
import type { AppEvent } from '../../apps/web/src/native/application-contracts';

function fixture() {
  const people = [0, 1].map(
    (id) => new Person(id, 'Unit ' + id, Role.Resident, Calling.Settler, Race.Human, 5, point(10, 10)),
  );
  const animal = new Monster(10, -1, point(12, 12));
  animal.animal = AnimalKind.Cow;
  const app = {
    chosen: [0, 1],
    selectedObjects: [],
    mouse: point(50, 50),
    hoveredWorldTarget: { screen: point(50, 50), hit: null },
    cursor: point(12, 12),
    tool: Tool.Select,
    pending: Order.None,
    pressAt: point(50, 50),
    panMoved: false,
    panFrom: null,
    boxFrom: null,
    hudPointer: false,
    context: { controlAt: () => false },
    pointerMove: vi.fn(),
    issueOrder: vi.fn(),
    cue: vi.fn(),
    personAt: () => -1,
    animalAtScreen: () => -1,
    treeAtScreen: () => -1,
    rockAtScreen: () => -1,
    buildingAtScreen: () => -1,
    hoveredRoad: () => -1,
    town: {
      person: (id: number) => people[id] ?? null,
      downedResidents: () => [],
      buildings: () => [],
      world: { dungeons: () => [{ name: 'Cave', origin: point(8, 8), kind: DungeonKind.Cave, discovered: true }] },
      depth: [], sieges: [],
      map: () => ({ cell: () => ({ dungeon: -1 }), dungeons: () => [] }),
      monsterAt: () => -1,
      creature: () => animal,
      orderMove: vi.fn(),
      orderAttackDungeon: vi.fn(() => true),
      orderAttack: vi.fn(),
      orderAttackPerson: vi.fn(),
      orderAttackMove: vi.fn(),
      building: () => null,
      roads: () => ({ road: () => null }),
    },
    army: new ArmyState(),
  } as unknown as GameCommandApp;
  return { app, people, animal };
}
describe('target input and group commands', () => {
  /** A game with two residents selected and the select tool in hand: the Command state. */
  const commanding = (prepare: () => void) => {
    const people = [0, 1].map((id) => new Person(id, 'Unit ' + id, Role.Resident, Calling.Settler, Race.Human, 5, point(10, 10)));
    return {
      buildings: null,
      atlas: null,
      editor: null,
      chosen: [0, 1],
      tool: Tool.Select,
      army: new ArmyState(),
      town: { person: (id: number) => people[id] ?? null },
      selectedPeople: () => [0, 1],
      prepare,
    };
  };
  it.each(['a', 'A'])('group hotkey %s works even after a HUD button has focus', (text) => {
    const prepare = vi.fn(),
      app = {
        game: commanding(prepare),
        script: { ready: () => true },
        scriptContext: { focused: () => true, textFocused: () => false },
        editorAttached: false,
        authoringTool: () => false,
        keys: new Set<string>(),
      };
    GameApplication.prototype.event.call(
      app as unknown as GameApplication,
      { type: 'KeyDown', text, control: false, meta: false, alt: false } as AppEvent,
    );
    expect(prepare).toHaveBeenCalledWith(Order.Attack);
  });
  it('keeps A inside a focused text field', () => {
    const prepare = vi.fn(),
      key = vi.fn(),
      app = {
        game: commanding(prepare),
        script: { ready: () => true },
        scriptContext: { focused: () => true, textFocused: () => true, key },
        editorAttached: false,
        authoringTool: () => false,
        keys: new Set<string>(),
      };
    GameApplication.prototype.event.call(
      app as unknown as GameApplication,
      { type: 'KeyDown', text: 'a', control: false, meta: false, alt: false } as AppEvent,
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(key).toHaveBeenCalledOnce();
  });
  it.each([Order.Move, Order.Attack])(
    'executes armed group command %s with primary click and keeps selection',
    (order) => {
      const { app } = fixture();
      app.pending = order;
      pointerUp.call(app, 50, 50, PointerButton.Primary);
      expect(app.issueOrder).toHaveBeenCalledWith(order);
      expect(app.pending).toBe(Order.None);
      expect(app.chosen).toEqual([0, 1]);
    },
  );
  it('secondary click always targets even while Attack is armed', () => {
    const { app } = fixture();
    app.pending = Order.Attack;
    pointerUp.call(app, 50, 50, PointerButton.Secondary);
    expect(app.issueOrder).toHaveBeenCalledWith(Order.Work);
    expect(app.chosen).toEqual([0, 1]);
  });
  it('puts a building tool down on a right-click, and turns the building with the wheel instead of zooming', () => {
    const { app } = fixture(),
      zoomBy = vi.fn(),
      selectTool = vi.fn();
    Object.assign(app, { tool: Tool.Tent, freeAngle: 0, zoomBy, selectTool, pointerMove: vi.fn() });
    wheel.call(app, 50, 50, 1);
    expect(app.freeAngle).toBeCloseTo(Math.PI / 12, 5);
    wheel.call(app, 50, 50, -1);
    expect(app.freeAngle).toBeCloseTo(0, 5);
    expect(zoomBy).not.toHaveBeenCalled();
    app.pressAt = point(50, 50);
    pointerUp.call(app, 50, 50, PointerButton.Secondary);
    expect(selectTool).toHaveBeenCalledWith(Tool.Select);
    expect(app.issueOrder).not.toHaveBeenCalled();
    app.tool = Tool.Select;
    wheel.call(app, 50, 50, 1);
    expect(zoomBy).toHaveBeenCalledOnce();
  });
  it('contextual targeting of a neutral animal approaches without attacking', () => {
    const { app } = fixture();
    app.hoveredWorldTarget!.hit = presentedHit('animal', 10);
    issueOrder.call(app, Order.Work);
    expect(app.town.orderAttack).not.toHaveBeenCalled();
    expect(app.town.orderMove).toHaveBeenCalledWith([0, 1], app.cursor);
  });
  it('explicit Attack still hunts the clicked animal', () => {
    const { app } = fixture();
    app.hoveredWorldTarget!.hit = presentedHit('animal', 10);
    app.town.orderAttack = vi.fn(() => true);
    app.town.approachOrder = vi.fn();
    issueOrder.call(app, Order.Attack);
    expect(app.town.orderAttack).toHaveBeenCalledTimes(2);
  });
  it('contextual targeting can defend against an already hostile animal', () => {
    const { app, animal } = fixture();
    animal.angry = true;
    app.hoveredWorldTarget!.hit = presentedHit('animal', 10);
    app.town.orderAttack = vi.fn(() => true);
    app.town.approachOrder = vi.fn();
    issueOrder.call(app, Order.Work);
    expect(app.town.orderAttack).toHaveBeenCalledTimes(2);
  });
  it('an explicit Attack on a companion never strikes them: it is an attack-move to where they stand', () => {
    const { app } = fixture();
    app.hoveredWorldTarget!.hit = presentedHit('person', 1);
    issueOrder.call(app, Order.Attack);
    expect(app.town.orderAttackPerson).not.toHaveBeenCalled();
    expect(app.town.orderAttackMove).toHaveBeenCalledWith([0, 1], app.cursor);
    expect(app.chosen).toEqual([0, 1]);
  });
  it('an explicit Attack still targets a person of another settlement, without changing group selection', () => {
    const { app, people } = fixture();
    people[1].faction = 1;
    app.chosen = [0];
    app.hoveredWorldTarget!.hit = presentedHit('person', 1);
    issueOrder.call(app, Order.Attack);
    expect(app.town.orderAttackPerson).toHaveBeenCalledWith([0], 1);
    expect(app.town.orderAttackMove).not.toHaveBeenCalled();
    expect(app.chosen).toEqual([0]);
  });
  it.each([Order.Attack, Order.Work])('sends only the selected group to the dungeon with map order %s', order => {
    const { app } = fixture();
    app.chosen = [1];
    app.hoveredWorldTarget!.hit = presentedHit('dungeon', 0);
    issueOrder.call(app, order);
    expect(app.town.orderAttackDungeon).toHaveBeenCalledWith([1], 0);
    expect(app.town.orderMove).not.toHaveBeenCalled();
  });
  it('walks to the cursor when the picked dungeon no longer exists', () => {
    const { app } = fixture();
    app.hoveredWorldTarget!.hit = presentedHit('dungeon', 2);
    issueOrder.call(app, Order.Work);
    expect(app.town.orderAttackDungeon).not.toHaveBeenCalled();
    expect(app.town.orderMove).toHaveBeenCalledWith([0, 1], app.cursor);
  });
  it('right-clicking a companion approaches without friendly fire', () => {
    const { app, people } = fixture();
    app.hoveredWorldTarget!.hit = presentedHit('person', 1);
    issueOrder.call(app, Order.Work);
    expect(app.town.orderAttackPerson).not.toHaveBeenCalled();
    expect(app.town.orderMove).toHaveBeenCalledWith([0, 1], people[1].position);
  });
});
