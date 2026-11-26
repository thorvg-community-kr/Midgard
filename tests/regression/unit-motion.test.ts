import { describe, expect, it } from 'vitest';
import { Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { point } from '../../packages/engine/src/geometry';
import { harvestTiming, hammerTiming } from '../../packages/engine/src/work-timing';
import {
  layDown,
  PersonParts,
  personSprite,
  seatHead,
  stridePose,
} from '../../packages/native-renderer/src/world-sprites';
import {
  animateAction,
  animateBrood,
  animateGather,
  animateSip,
  animateTend,
  animateWork,
  strikePhase,
  workPose,
} from '../../packages/native-renderer/src/action-motion';
import {
  animateCraft,
  animateFieldWork,
  animateFoundry,
  animateProcessingWork,
  animateTrade,
  buildingContact,
  clearWorkProps,
  tradeOf,
} from '../../packages/native-renderer/src/work-motion';
import { Structure } from '../../packages/engine/src/building-catalog';
import { handOf } from '../../packages/native-renderer/src/person-arm';
import { showEquipment } from '../../packages/native-renderer/src/person-equipment';
import { workHand } from '../../packages/native-renderer/src/work-pieces';
import {
  animateBenchCraft,
  animateClearing,
  animateRoadwork,
  animateStationWork,
  passLoad,
  sitePhase,
} from '../../packages/native-renderer/src/site-work-motion';
import { appearanceOf } from '../../packages/engine/src/person-look';
import type { Matrix } from '../../packages/native-renderer/src/paint';

const figure = (calling = Calling.Settler) => {
  const parts = new PersonParts();
  personSprite(new Person(3, 'Rowan', Role.Resident, calling, Race.Human, 4242, point()), parts);
  stridePose(parts, 0, false);
  return parts;
};
/** The head as drawn: its own seat carried by the body. */
function headInWorld(parts: PersonParts): Matrix {
  const b = parts.body!.matrix,
    h = parts.head[1].matrix;
  return [
    b[0] * h[0] + b[1] * h[3],
    b[0] * h[1] + b[1] * h[4],
    b[0] * h[2] + b[1] * h[5] + b[2],
    b[3] * h[0] + b[4] * h[3],
    b[3] * h[1] + b[4] * h[4],
    b[3] * h[2] + b[4] * h[5] + b[5],
    0,
    0,
    1,
  ];
}
/** True when a matrix only turns, scales evenly and moves: no shear, no squash. */
function rigid(m: Matrix): boolean {
  const across = Math.hypot(m[0], m[3]),
    up = Math.hypot(m[1], m[4]),
    skew = m[0] * m[1] + m[3] * m[4];
  return Math.abs(across - up) < 1e-4 && Math.abs(skew) < 1e-4;
}
const poses: [string, (parts: PersonParts, t: number) => void][] = [
  ['a sword cut', (p, t) => animateAction(p, 'sword', t, 1)],
  ['a punch', (p, t) => animateAction(p, null, t, 1)],
  ['a bow shot', (p, t) => animateAction(p, 'bow', t, 1)],
  ['a staff cast', (p, t) => animateAction(p, 'staff', t, 1)],
  [
    'felling',
    (p, t) => animateWork(p, 'axe', t * harvestTiming.period, harvestTiming.period, harvestTiming.impact),
  ],
  [
    'mining',
    (p, t) => animateWork(p, 'pickaxe', t * harvestTiming.period, harvestTiming.period, harvestTiming.impact),
  ],
  [
    'hammering',
    (p, t) => animateWork(p, 'hammer', t * hammerTiming.period, hammerTiming.period, hammerTiming.impact),
  ],
  [
    'bare-handed work',
    (p, t) => animateWork(p, null, t * harvestTiming.period, harvestTiming.period, harvestTiming.impact),
  ],
  ['hoeing', (p, t) => animateFieldWork(p, false, t * 1.25)],
  ['watering', (p, t) => animateFieldWork(p, true, t * 1.25)],
  ['sawing', (p, t) => animateProcessingWork(p, true, t)],
  ['chiselling', (p, t) => animateProcessingWork(p, false, t)],
  ['fitting a piece at the smithy', (p, t) => animateCraft(p, null, false, t, 0)],
  ['beating a piece at the smithy', (p, t) => animateCraft(p, 'hammer', true, t * hammerTiming.period, 0)],
  ['holding up a finished piece', (p, t) => animateCraft(p, 'sword', false, 0, Math.max(0.02, t))],
  ['gathering', (p, t) => animateGather(p, Math.sin(Math.PI * t))],
  ['tending', (p, t) => animateTend(p, t)],
  ['eating', (p, t) => animateSip(p, t * 1.9, false)],
  ['brooding', (p, t) => animateBrood(p, t)],
  ['hauling at the well', (p, t) => animateTrade(p, 'haul', t * 2)],
  ['stacking stores', (p, t) => animateTrade(p, 'stack', t * 2.6)],
  ['keeping watch', (p, t) => animateTrade(p, 'watch', t * 9)],
  ['lying down', (p, t) => layDown(p, t)],
];

describe('the head on its neck', () => {
  it.each(poses)('stays one unsquashed shape through %s', (_, pose) => {
    const parts = figure();
    for (let i = 0; i <= 20; i++) {
      pose(parts, i / 20);
      seatHead(parts);
      const head = headInWorld(parts),
        b = parts.body!.matrix,
        neck = point(b[1] * parts.neck.y + b[2], b[4] * parts.neck.y + b[5]),
        // The head's own origin sits a fixed distance above wherever the body carries the neck.
        reach = Math.hypot(head[2] - neck.x, head[5] - neck.y);
      expect(rigid(head)).toBe(true);
      expect(Math.hypot(head[0], head[3])).toBeCloseTo(4.3, 4);
      expect(reach).toBeCloseTo(4, 3);
    }
  });
});

describe('blows', () => {
  it('draws back beside the head and lands on the strike with the body behind it', () => {
    const parts = figure(Calling.Warrior),
      lean = (t: number) => {
        animateAction(parts, 'sword', t, 1);
        return { forward: parts.body!.matrix[2], nod: parts.nod };
      };
    expect(lean(0.4).forward).toBeLessThan(0);
    expect(lean(0.4).nod).toBeLessThan(0);
    expect(lean(strikePhase).forward).toBeGreaterThan(1);
    expect(lean(strikePhase).nod).toBeGreaterThan(0.1);
  });
  it.each([[26, -9], [6, -19], [8, -1]])('aims the blade through the body at (%i, %i) on contact', (x, y) => {
    const parts = figure(Calling.Warrior);
    animateAction(parts, 'sword', strikePhase, 1, point(x, y));
    const arm = parts.arms[1], transform = (m: Matrix, p: { x: number; y: number }) =>
      point(m[0] * p.x + m[1] * p.y + m[2], m[3] * p.x + m[4] * p.y + m[5]);
    const shoulder = transform(parts.body!.matrix, arm.shoulder);
    let tip = point(arm.wrist.x + 7.6, arm.wrist.y - 13.4);
    for (const node of [arm.hand!, arm.forearm!, parts.body!]) tip = transform(node.matrix, tip);
    const dx = tip.x - shoulder.x, dy = tip.y - shoulder.y;
    expect((x - shoulder.x) * dx + (y - shoulder.y) * dy).toBeGreaterThan(0);
    expect(Math.abs((x - shoulder.x) * dy - (y - shoulder.y) * dx) / Math.hypot(dx, dy)).toBeLessThan(2);
  });
  it('keeps both feet where they stand while the body shifts over them', () => {
    const parts = figure(Calling.Warrior),
      planted = [0, 1].map(() => new Set<number>());
    for (let i = 0; i < 12; i++) {
      // Up to the strike only the body moves; the leading foot steps as the blow lands.
      animateAction(parts, 'sword', (i / 12) * 0.5, 1);
      parts.feet.forEach((foot, side) =>
        planted[side].add(Math.round((foot!.matrix[2] + parts.body!.matrix[2]) * 1000)),
      );
    }
    expect(planted[0].size).toBe(1);
    expect(planted[1].size).toBe(1);
  });
  it('holds the second hand to the shaft at the blow but never across the face in the wind-up', () => {
    const parts = figure(),
      hand = (t: number) => {
        animateWork(parts, 'axe', t * harvestTiming.period, harvestTiming.period, harvestTiming.impact);
        const arm = parts.arms[0],
          m = arm.forearm!.matrix;
        return m[3] * arm.wrist.x + m[4] * arm.wrist.y + m[5];
      };
    for (let i = 0; i <= 30; i++) expect(hand(i / 30)).toBeGreaterThan(parts.neck.y);
  });
  it.each(['axe', 'pickaxe', 'hammer'] as const)(
    'swings the %s furthest down exactly at the shared impact',
    (tool) => {
      for (const { period, impact } of [harvestTiming, hammerTiming]) {
        const contact = workPose(impact, period, impact, tool).direction;
        for (let i = 0; i < 60; i++)
          expect(workPose((i * period) / 60, period, impact, tool).direction).toBeLessThanOrEqual(
            contact + 1e-9,
          );
      }
    },
  );
});

describe('work at a building', () => {
  it('gives each kind of workplace its own motion and leaves tool work to the tool', () => {
    expect(tradeOf(Structure.Well)).toBe('haul');
    expect(tradeOf(Structure.Granary)).toBe('stack');
    expect(tradeOf(Structure.Apothecary)).toBe('counter');
    expect(tradeOf(Structure.MageTower)).toBe('channel');
    expect(tradeOf(Structure.Watchtower)).toBe('watch');
    for (const kind of [
      Structure.Sawmill,
      Structure.Weaponsmith,
      Structure.TrainingYard,
      Structure.Runestone,
    ])
      expect(tradeOf(kind)).toBeNull();
  });
  it("keeps a lookout's raised hand beside the head, never across the face", () => {
    const parts = figure();
    for (let i = 0; i <= 20; i++) {
      animateTrade(parts, 'watch', i * 0.45);
      const arm = parts.arms[1],
        m = arm.forearm!.matrix,
        hand = point(
          m[0] * arm.wrist.x + m[1] * arm.wrist.y + m[2],
          m[3] * arm.wrist.x + m[4] * arm.wrist.y + m[5],
        );
      expect(hand.y).toBeLessThan(parts.neck.y - 3);
      expect(hand.x).toBeGreaterThan(4.3);
    }
  });
});

describe('down and resting', () => {
  it('turns a fallen figure onto its back with the head carried round', () => {
    const parts = figure();
    layDown(parts, 1);
    seatHead(parts);
    const head = headInWorld(parts);
    // Feet stay at the origin; the head ends up behind them near the ground, turned with the body.
    expect(head[2]).toBeLessThan(-10);
    expect(head[5]).toBeGreaterThan(-6);
    expect(Math.atan2(head[3], head[0])).toBeCloseTo(-1.5, 2);
  });
  it('lifts the hand to the mouth to eat and tips the head back to drink', () => {
    const parts = figure();
    animateSip(parts, 0.8, false);
    expect(parts.nod).toBeGreaterThan(0);
    const raised = handOf(parts.arms[1]).y;
    expect(raised).toBeLessThan(parts.neck.y);
    animateSip(parts, 0.8, true);
    expect(parts.nod).toBeLessThan(0);
    animateSip(parts, 1.85, true);
    // The hand has come back down toward where it hangs.
    expect(handOf(parts.arms[1]).y).toBeGreaterThan(raised + 3);
  });
});

const sitePoses: [string, (parts: PersonParts, seconds: number) => void][] = [
  ['pressing and turning a piece on the bench', (p, t) => animateBenchCraft(p, 'wood', null, t, 0)],
  ['tapping a piece with a carried mallet', (p, t) => animateBenchCraft(p, 'wood', 'wood', t, 0)],
  ['pulling boards', (p, t) => animateClearing(p, 'building', null, t)],
  ['breaking a frame', (p, t) => animateClearing(p, 'building', 'hammer', t)],
  ['pegging a station rail', (p, t) => animateStationWork(p, 'hammer', t)],
  ['fitting a station rail by hand', (p, t) => animateStationWork(p, null, t)],
  ['lifting paving', (p, t) => animateClearing(p, 'road', null, t)],
  ['breaking paving', (p, t) => animateClearing(p, 'road', 'hammer', t)],
  ['pulling roots', (p, t) => animateClearing(p, 'field', null, t)],
  ['tamping a road', (p, t) => animateRoadwork(p, null, t)],
  ['shovelling', (p, t) => animateRoadwork(p, 'shovel', t)],
  ['reaping', (p, t) => animateFieldWork(p, false, t, 'sickle')],
  ['watering by hand', (p, t) => animateFieldWork(p, true, t, null)],
  ['watering with a can', (p, t) => animateFieldWork(p, true, t, 'wateringCan')],
  ['handling timber', (p, t) => animateProcessingWork(p, true, t, false)],
  ['turning stone', (p, t) => animateProcessingWork(p, false, t, false)],
  ['working with a saw', (p, t) => animateProcessingWork(p, true, t)],
  ['working with a chisel', (p, t) => animateProcessingWork(p, false, t)],
  ['working the bellows', (p, t) => animateFoundry(p, false, t)],
  ['binding wood', (p, t) => animateFoundry(p, true, t)],
  ['giving a blessing', (p, t) => animateTrade(p, 'bless', t)],
  ['taking a bite', (p, t) => animateSip(p, t, false)],
  ['drinking from a cup', (p, t) => animateSip(p, t, true)],
];
describe('outdoor work and meals', () => {
  it('passes one visible parcel from the giving hands to the receiving hands', () => {
    const giver = figure(), taker = figure();
    for (const progress of [0.25, 0.49, 0.51, 0.75]) {
      for (const [parts, taking] of [[giver, false], [taker, true]] as const) {
        stridePose(parts, 0, false);
        passLoad(parts, taking, progress);
      }
      expect(giver.workPieces.parcel!.alpha > 0).toBe(progress < 0.5);
      expect(taker.workPieces.parcel!.alpha > 0).toBe(progress > 0.5);
    }
  });
  it.each(sitePoses)('keeps wrists, elbows and planted boots continuous while %s', (_, pose) => {
    for (const [height, width] of [
      [1, 1],
      [0.85, 1.2],
      [1.2, 0.85],
    ]) {
      const person = new Person(1, 'Liv', Role.Resident, Calling.Settler, Race.Human, 4242, point());
      person.customLook = { ...appearanceOf(person), bodyHeight: height, bodyWidth: width };
      const parts = new PersonParts();
      personSprite(person, parts);
      let previous: number[] | undefined, planted: number[] | undefined;
      let maxStep = 0,
        maxWrist = 0,
        footSlip = 0;
      // Sample the return across a loop seam as well as the contact.
      for (let frame = 0; frame <= 180; ++frame) {
        pose(parts, frame / 60);
        const turns = parts.arms.flatMap((arm) => [arm.turn.upper, arm.turn.elbow, arm.turn.wrist]),
          at = parts.feet.map((foot) => foot!.matrix[2] + parts.body!.matrix[2]);
        if (previous) maxStep = Math.max(maxStep, ...turns.map((v, i) => Math.abs(v - previous![i])));
        if (planted) footSlip = Math.max(footSlip, ...at.map((v, i) => Math.abs(v - planted![i])));
        else planted = at;
        maxWrist = Math.max(maxWrist, ...parts.arms.map((a) => Math.abs(a.turn.wrist)));
        previous = turns;
      }
      expect(maxStep).toBeLessThan(0.38);
      expect(maxWrist).toBeLessThan(0.9);
      expect(footSlip).toBeLessThan(0.001);
    }
  });
  it('makes contact and releases debris on the same beat as the demolition sound', () => {
    const parts = figure(),
      { period, impact } = hammerTiming;
    for (let beat = 0; beat < 3; beat++) {
      const hit = period * beat + impact;
      expect(sitePhase(hit)).toBeCloseTo(0.5);
      animateClearing(parts, 'building', 'hammer', hit - 0.02);
      expect(parts.soilDust!.alpha).toBe(0);
      const before = parts.body!.matrix[2];
      animateClearing(parts, 'building', 'hammer', hit + 0.001);
      expect(parts.soilDust!.alpha).toBe(255);
      expect(parts.body!.matrix[2]).toBeGreaterThan(before);
    }
  });
  it('places building dust at the mallet face, or at the fingers when working by hand', () => {
    const parts = figure(), { period, impact } = hammerTiming;
    for (const tool of ['hammer', null] as const) {
      clearWorkProps(parts);
      showEquipment(parts, tool, 'wood', false);
      animateWork(parts, tool, impact, period, impact);
      const hand = workHand(parts), hit = buildingContact(parts);
      if (tool) expect(hit.x - hand.x).toBeGreaterThan(5);
      else expect(hit).toEqual(hand);
    }
  });
  it('ties lifted materials to their job and clears the previous grip and props between jobs', () => {
    const parts = figure();
    animateClearing(parts, 'road', null, hammerTiming.impact);
    expect(parts.workPieces.paver!.alpha).toBe(255);
    clearWorkProps(parts);
    animateClearing(parts, 'field', null, hammerTiming.impact);
    expect(parts.workPieces.paver!.alpha).toBe(0);
    expect(parts.workPieces.roots!.alpha).toBe(255);
    clearWorkProps(parts);
    animateRoadwork(parts, 'shovel', hammerTiming.impact);
    expect(parts.shovel!.matrix[0]).toBeLessThan(0);
    clearWorkProps(parts);
    expect(parts.workPieces.roots!.alpha).toBe(0);
    expect(parts.shovel!.matrix).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
  it('keeps bread and cup in the palm and tips the rim only at the mouth', () => {
    const parts = figure();
    for (const drinking of [false, true]) {
      const prop = drinking ? parts.cup! : parts.bread!;
      for (const t of [0, 0.4, 0.8, 1.1, 1.8]) {
        animateSip(parts, t, drinking);
        const wrist = handOf(parts.arms[1]);
        expect(prop.matrix[2]).toBeCloseTo(wrist.x, 4);
        expect(prop.matrix[5]).toBeCloseTo(wrist.y, 4);
        if (drinking && t === 1.1) {
          expect(prop.matrix[3]).toBeLessThan(-0.5);
          expect(wrist.y).toBeLessThan(parts.neck.y);
        } else if (drinking && (t === 0.4 || t === 1.8)) expect(prop.matrix[3]).toBeCloseTo(0);
      }
    }
  });
});
