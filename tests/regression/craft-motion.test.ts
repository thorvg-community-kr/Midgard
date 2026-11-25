import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { SceneNode, type Matrix } from '../../packages/native-renderer/src/paint';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { moveAgents } from '../../packages/native-renderer/src/world-people';
import type { PersonParts } from '../../packages/native-renderer/src/world-sprites';
import { heldTools } from '../../packages/native-renderer/src/person-equipment';
import { workHand } from '../../packages/native-renderer/src/work-pieces';
import { Activity, Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { Structure } from '../../packages/engine/src/building-catalog';
import { craftOrder, orderSeconds, stationOrder } from '../../packages/engine/src/craft-orders';
import { point, type Point } from '../../packages/engine/src/geometry';
import { hammerTiming, workElapsed } from '../../packages/engine/src/work-timing';
import { Traffic } from '../../packages/engine/src/traffic';
import type { Town } from '../../packages/engine/src/town';

let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', class {});
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({
    renderer: 'sw',
    locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
  });
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});

const states: WorldRendererState[] = [];
afterAll(() => {
  for (const state of states) state.adapter.dispose();
});
interface Order {
  item: string;
  /** Share of the item's making already done. */
  done?: number;
  tool?: string;
  /** Standing a pace aside for a busy station rather than working it. */
  waiting?: boolean;
  time?: number;
}
/** A resident at a station to the left of where they stand, drawn by the world renderer. */
function crafter(order: Order | null) {
  const state = new WorldRendererState(tvg);
  states.push(state);
  state.rows = Array.from({ length: 64 }, () => new SceneNode());
  state.currentVisibility.sample = () => 255;
  const person = new Person(7, 'Maker', Role.Resident, Calling.Settler, Race.Human, 499096, point(10, 10)),
    recipe = craftOrder(order?.item ?? null),
    bench = {
      id: 1,
      kind: recipe && recipe.kind !== 'station' ? recipe.item.workshop! : Structure.Workbench,
      center: point(8.8, 10.4),
      angle: 0,
    },
    time = order?.time ?? 0;
  if (order) {
    if (order.tool) {
      person.inventory[0] = { item: order.tool, quantity: 1 };
    }
    person.task = Activity.Crafting;
    person.activity = order.waiting ? Activity.Holding : Activity.Crafting;
    person.craftItem = order.item;
    person.craftWorkshop = person.target = bench.id;
    person.craftProgress = orderSeconds(craftOrder(order.item)!, bench.kind) * (order.done ?? 0.2);
  }
  const town = {
    people: () => [person],
    buildings: () => [],
    building: (id: number) => (id === bench.id ? bench : null),
    monsters: () => [],
    wildlife: () => [],
    hits: () => [],
    clock: () => time,
    map: () => ({
      giant: () => null,
      volcano: () => null,
      width: () => 32,
      seed: () => 5,
      inside: () => true,
      at: () => ({ trees: 0 }),
    }),
  } as unknown as Town;
  const traffic = new Traffic(5),
    draw = () => moveAgents(state, town, traffic, time, []);
  draw();
  const figure = state.figures.get(person.id)!;
  return { parts: figure.parts, facing: figure.facing, person, draw };
}
const shown = (parts: PersonParts): string[] => heldTools.filter((tool) => parts[tool]?.alpha === 255);
const material = (
  parts: PersonParts,
  tool: 'sword' | 'axe' | 'knife' | 'hammer' | 'bow' | 'staff',
): string[] =>
  Object.entries(parts.toolHeads[tool] ?? {})
    .filter(([, head]) => head.alpha === 255)
    .map(([name]) => name);
const through = (p: Point, m: Matrix): Point =>
  point(m[0] * p.x + m[1] * p.y + m[2], m[3] * p.x + m[4] * p.y + m[5]);

describe('making an item at a station', () => {
  it('fits the first wooden tools by hand from the first stroke to the final one', () => {
    for (const item of ['wooden-axe', 'wooden-mallet', 'pack-basket']) {
      for (const done of [0, 0.5, 0.99]) {
        const { parts } = crafter({ item, done });
        expect(shown(parts)).toEqual([]);
        expect(parts.activePiece?.alpha).toBe(255);
        expect(parts.nod).toBeGreaterThan(0.1);
      }
    }
  });
  it('uses only a carried crafting tool, including while making a saw or upgrading the mallet itself', () => {
    const irrelevant = crafter({ item: 'wooden-axe', tool: 'saw' });
    expect(shown(irrelevant.parts)).toEqual([]);
    for (const item of ['wooden-axe', 'saw', 'upgrade:stone-hammer']) {
      for (const done of [0.2, 0.99]) {
        const { parts } = crafter({ item, done, tool: 'wooden-mallet' });
        expect(shown(parts)).toEqual(['hammer']);
        expect(material(parts, 'hammer')).toEqual(['wood']);
        expect(parts.activePiece?.alpha).toBe(255);
      }
    }
  });
  it('meets the stock with the pressing palm or the actual striking face of the mallet', () => {
    const time = (at: number) => at - workElapsed(0, 7);
    const bare = crafter({ item: 'wooden-axe', time: time(1.55 * 1.5) }).parts;
    const palm = workHand(bare),
      pressed = through(point(1, -1.2), bare.activePiece!.matrix);
    expect(palm.x).toBeCloseTo(pressed.x, 2);
    expect(palm.y).toBeCloseTo(pressed.y, 2);
    const impact = hammerTiming.period + hammerTiming.impact;
    for (const [at, touching] of [
      [impact, true],
      [impact - hammerTiming.period * 0.5, false],
    ] as const) {
      const { parts } = crafter({ item: 'wooden-axe', tool: 'wooden-mallet', time: time(at) });
      const arm = parts.arms[1],
        wrist = arm.wrist;
      const face = [parts.hammer!.matrix, arm.hand!.matrix, arm.forearm!.matrix, parts.body!.matrix].reduce(
        through,
        point(wrist.x + 7.2 * 0.6 + 3.4 * 0.8, wrist.y - 7.2 * 0.8 + 3.4 * 0.6),
      );
      const stock = through(point(2.25, -1), parts.activePiece!.matrix);
      if (touching) {
        expect(face.x).toBeCloseTo(stock.x, 2);
        expect(face.y).toBeCloseTo(stock.y, 2);
      } else expect(face.y).toBeLessThan(stock.y - 2);
    }
  });
  it('puts down the workpiece and releases the short grip when the order stops', () => {
    const { person, parts, draw } = crafter({ item: 'wooden-axe', tool: 'wooden-mallet' });
    const piece = parts.activePiece!;
    person.activity = person.task = Activity.Idle;
    person.craftItem = null;
    draw();
    expect(piece.alpha).toBe(0);
    expect(parts.activePiece).toBeNull();
    expect(parts.workGrip).toBeNull();
    expect(shown(parts)).toEqual([]);
  });
  it('beats stone and iron into shape with the crafter’s own hammer', () => {
    for (const item of ['stone-axe', 'sword']) {
      const { parts } = crafter({ item, tool: 'wooden-mallet' });
      expect(shown(parts)).toEqual(['hammer']);
      expect(material(parts, 'hammer')).toEqual(['wood']);
    }
  });
  it('never mimes a hammer that is not there', () => {
    const { parts } = crafter({ item: 'sword' });
    expect(parts.activePiece?.alpha).toBe(255);
    expect(shown(parts)).toEqual([]);
    expect(parts.nod).toBeGreaterThan(0.1);
  });
  it('fits a rail while upgrading the station and only picks up a mallet when it has one', () => {
    const item = stationOrder(2),
      hands = crafter({ item }),
      pegging = crafter({ item, tool: 'wooden-mallet' }),
      waiting = crafter({ item, waiting: true });
    expect(hands.parts.workPieces.board?.alpha).toBe(255);
    expect(pegging.parts.workPieces.board?.alpha).toBe(255);
    expect(shown(hands.parts)).toEqual([]);
    expect(shown(pegging.parts)).toEqual(['hammer']);
    expect(material(pegging.parts, 'hammer')).toEqual(['wood']);
    expect(waiting.parts.workPieces.board).toBeUndefined();
  });
  it('holds the finished piece up as the making ends', () => {
    const before = crafter({ item: 'wooden-sword', done: 0.5 }),
      after = crafter({ item: 'wooden-sword', done: 0.93 }),
      stone = crafter({ item: 'flint-sword', tool: 'wooden-mallet', done: 0.99 });
    expect(before.parts.activePiece?.alpha).toBe(255);
    expect(after.parts.activePiece).toBeNull();
    expect(shown(after.parts)).toEqual(['sword']);
    expect(material(after.parts, 'sword')).toEqual(['wood']);
    // The arm goes up past the shoulder and the head tips back to look.
    expect(workHand(after.parts).y).toBeLessThan(workHand(before.parts).y - 1);
    expect(after.parts.arms[1].turn.upper).toBeLessThan(-1.5);
    expect(after.parts.nod).toBeLessThan(-0.05);
    expect(shown(stone.parts)).toEqual(['sword']);
    expect(material(stone.parts, 'sword')).toEqual(['stone']);
  });
  it('works the wicker by hand all the way through, including when the worker owns a mallet', () => {
    const { parts } = crafter({ item: 'pack-basket', tool: 'wooden-mallet', done: 0.99 });
    expect(shown(parts)).toEqual([]);
    expect(parts.workPieces.wicker?.alpha).toBe(255);
    expect(parts.nod).toBeGreaterThan(0.1);
  });
  it('shows the material of the finished regional weapon at the end of the upgrade', () => {
    for (const [item, tool, finish] of [
      ['embersteel-sword', 'sword', 'embersteel'],
      ['frostwood-bow', 'bow', 'frostwood'],
      ['frostwood-staff', 'staff', 'frostwood'],
    ] as const) {
      const { parts } = crafter({ item: 'upgrade:' + item, done: 0.99 });
      expect(parts[tool]?.alpha).toBe(255);
      expect(material(parts, tool)).toEqual([finish]);
    }
  });
  it('keeps both feet on the ground through every stroke and the lift', () => {
    for (const order of [
      { item: 'wooden-sword' },
      { item: 'stone-axe', tool: 'wooden-mallet' },
      { item: 'wooden-sword', done: 0.95 },
    ])
      for (let i = 0; i < 12; i++) {
        const { parts } = crafter({ ...order, time: i / 11 });
        expect(parts.body!.matrix[5]).toBe(0);
        expect(parts.feet.map((foot) => foot!.matrix[5])).toEqual([0, 0]);
        expect(parts.body!.matrix[4]).toBeGreaterThanOrEqual(0.95);
      }
  });
  it('faces the station while working it and while waiting a turn', () => {
    expect(crafter({ item: 'wooden-sword' }).facing).toBe(-1);
    const waiting = crafter({ item: 'wooden-sword', waiting: true });
    expect(waiting.facing).toBe(-1);
    // Waiting is only standing by: nothing is taken up.
    expect(shown(waiting.parts)).toEqual([]);
    expect(crafter(null).facing).toBe(1);
  });
});
