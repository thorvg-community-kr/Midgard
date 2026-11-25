import { describe, expect, it } from 'vitest';
import { MonsterRank } from '../../packages/engine/src/combat-events';
import { point } from '../../packages/engine/src/geometry';
import { AnimalKind, Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { humanoidClips, humanoidFigure } from '../../packages/native-renderer/src/humanoid-rig';
import {
  fallSeconds,
  monsterBody,
  monsterKind,
  poseFallenMonster,
  poseMonster,
} from '../../packages/native-renderer/src/monster-figures';
import { SceneNode, ShapeNode, type PaintNode } from '../../packages/native-renderer/src/paint';
import { handOf, poseArm, reachArm } from '../../packages/native-renderer/src/person-arm';
import { quadrupedClips, quadrupedFigure } from '../../packages/native-renderer/src/quadruped-rig';
import { clipTurn, type RigClip } from '../../packages/native-renderer/src/rig-clip';
import { animateBrace, animateCast, strikePhase } from '../../packages/native-renderer/src/action-motion';
import { skills } from '../../packages/engine/src/skill-catalog';
import { animalBody, animalSprite, poseAnimal } from '../../packages/native-renderer/src/wildlife-sprites';
import { animalWalk, mammalFigure, mammalOf } from '../../packages/native-renderer/src/wildlife-anatomy';
import {
  PersonParts,
  personSprite,
  seatHead,
  stridePose,
} from '../../packages/native-renderer/src/world-sprites';

const degrees = Math.PI / 180;
const blows: [string, RigClip][] = [
  ['slash', humanoidClips.slash],
  ['chop', humanoidClips.chop],
  ['thrust', humanoidClips.thrust],
  ['claw', humanoidClips.claw],
  ['punch', humanoidClips.punch],
  ['slam', humanoidClips.slam],
  ['bite', quadrupedClips.bite],
];
const every = (clip: RigClip, check: (frame: number) => void) => {
  for (let frame = 0; frame <= clip.frames; frame += 0.5) check(frame);
};

describe('rig clips', () => {
  it.each(blows)('lands the %s on the residents’ strike and holds the feet', (_, clip) => {
    // One share of the cycle for every armed figure, so a blow drawn for a goblin is on time for a resident.
    expect(clip.markers.contact / clip.frames).toBeCloseTo(strikePhase, 6);
    expect(clip.planted).toBe(true);
    expect(clip.loop).toBe(true);
  });
  it.each(Object.entries(humanoidClips))('never folds an elbow or a knee backward in %s', (_, clip) => {
    every(clip, (frame) => {
      for (const side of ['l', 'r']) {
        const elbow = clipTurn(clip, `arm.${side}.2`, frame);
        expect(elbow).toBeLessThanOrEqual(12 * degrees);
        expect(elbow).toBeGreaterThanOrEqual(-165 * degrees);
        if (!clip.planted) {
          const knee = clipTurn(clip, `leg.${side}.2`, frame);
          expect(knee).toBeGreaterThanOrEqual(-4 * degrees);
          expect(knee).toBeLessThanOrEqual(150 * degrees);
        }
      }
    });
  });
  it('closes every loop on the pose it started from', () => {
    // A fall is played once and ends on the ground; everything else comes round again.
    for (const clip of [...Object.values(humanoidClips), ...Object.values(quadrupedClips)])
      for (const [bone, track] of clip.loop ? clip.tracks : []) {
        if (track.turn) expect(track.turn[clip.frames], `${clip.name} ${bone}`).toBeCloseTo(track.turn[0], 4);
        if (track.shiftX) expect(track.shiftX[clip.frames]).toBeCloseTo(track.shiftX[0], 4);
      }
  });
  it('keeps planted feet on their spots while the trunk moves over them', () => {
    const figure = humanoidFigure({
        hip: 5.4,
        chest: 8.2,
        neck: 11,
        shoulder: 2.9,
        shoulderDrop: 1,
        upperArm: 2.9,
        forearm: 3.1,
        stance: 1.4,
        knee: 3.2,
        ankle: 1,
      }),
      foot = figure.skeleton.bone('foot.l'),
      hips = figure.skeleton.bone('hips');
    let travelled = 0;
    every(humanoidClips.slash, (frame) => {
      figure.play(humanoidClips.slash, frame);
      // The far foot never steps in a cut: it stays put however far the hips travel.
      expect(figure.frame.jointX[foot]).toBeCloseTo(-1.4 - 0.6, 1);
      expect(figure.frame.jointY[foot]).toBeCloseTo(-1, 1);
      travelled = Math.max(travelled, Math.abs(figure.frame.jointX[hips]));
    });
    expect(travelled).toBeGreaterThan(1);
  });
});

describe('a resident’s arm', () => {
  const figure = () => {
    const parts = new PersonParts();
    personSprite(new Person(3, 'Rowan', Role.Resident, Calling.Settler, Race.Human, 4242, point()), parts);
    stridePose(parts, 0, false);
    return parts;
  };
  it('reaches the hand to its mark with the elbow hanging, never raised above the shoulder to get there', () => {
    const parts = figure();
    for (const arm of parts.arms)
      for (let x = -5; x <= 5; x += 1)
        for (let y = -5; y <= 4; y += 1) {
          // Marks all round the shoulder, the face and chest among them.
          const mark = point(arm.shoulder.x + x, arm.shoulder.y + y),
            span = Math.hypot(x, y);
          if (span < 0.5) continue;
          reachArm(arm, mark, 1, 0, 0);
          const hand = handOf(arm),
            m = arm.forearm!.matrix,
            elbow = point(
              m[0] * arm.elbow.x + m[1] * arm.elbow.y + m[2],
              m[3] * arm.elbow.x + m[4] * arm.elbow.y + m[5],
            );
          if (span < 5.8) {
            expect(hand.x).toBeCloseTo(mark.x, 3);
            expect(hand.y).toBeCloseTo(mark.y, 3);
          }
          // A hand at or below the shoulder never needs an elbow in the air.
          if (y >= 0) expect(elbow.y).toBeGreaterThanOrEqual(arm.shoulder.y - 0.01);
          // And a raised hand lifts the elbow no higher than the hand itself.
          else expect(elbow.y).toBeGreaterThanOrEqual(mark.y - 0.01);
        }
  });
  it('moves from rest to a mark by turning its joints, a fraction at a time', () => {
    const parts = figure(),
      arm = parts.arms[1],
      mark = point(1.7, parts.neck.y - 1.3);
    reachArm(arm, mark, 1, 0, 0);
    const full = { ...arm.turn };
    for (const weight of [0, 0.25, 0.5, 0.75]) {
      reachArm(arm, mark, weight, 0, 0);
      expect(arm.turn.upper).toBeCloseTo(full.upper * weight, 5);
      expect(arm.turn.elbow).toBeCloseTo(full.elbow * weight, 5);
    }
  });
  it('draws the sleeve as one curve through five joints, shoulder to cuff', () => {
    const parts = figure(),
      arm = parts.arms[1];
    poseArm(arm, -1.2, -1.4, 0);
    const [upper, lower] = arm.sleeves.map((sleeve) => sleeve.shape.commands);
    // Two curve spans each side of the elbow, meeting at one point.
    expect(upper.map((c) => c[0]).join('')).toBe('MCC');
    expect(lower.map((c) => c[0]).join('')).toBe('MCC');
    const end = upper[2],
      start = lower[0];
    expect([end[5], end[6]]).toEqual([start[1], start[2]]);
    // The sleeve starts at the shoulder.
    expect(upper[0][1]).toBeCloseTo(arm.shoulder.x, 4);
    expect(upper[0][2]).toBeCloseTo(arm.shoulder.y, 4);
  });
});

describe('a resident’s skills', () => {
  it.each(skills.map((skill) => skill.id))(
    'gives %s a pose of its own that never squashes the head',
    (id) => {
      const parts = new PersonParts();
      personSprite(new Person(3, 'Rowan', Role.Resident, Calling.Warrior, Race.Human, 4242, point()), parts);
      for (const tool of ['sword', 'bow', 'staff', null] as const)
        for (let i = 0; i <= 10; i++) {
          stridePose(parts, 0, false);
          animateCast(parts, id, tool, i / 10);
          seatHead(parts);
          const b = parts.body!.matrix,
            h = parts.head[1].matrix,
            // The head as drawn: its own seat carried by the body.
            across = Math.hypot(b[0] * h[0] + b[1] * h[3], b[3] * h[0] + b[4] * h[3]),
            up = Math.hypot(b[0] * h[1] + b[1] * h[4], b[3] * h[1] + b[4] * h[4]);
          expect(across).toBeCloseTo(up, 3);
          // Half-way through, the tool arm has left its rest.
          if (i === 5) expect(Math.abs(parts.arms[1].turn.upper)).toBeGreaterThan(0.3);
        }
    },
  );
  it('braces a resident who is ordered to hold, feet apart and weapon forward', () => {
    const parts = new PersonParts();
    personSprite(new Person(3, 'Rowan', Role.Resident, Calling.Warrior, Race.Human, 4242, point()), parts);
    stridePose(parts, 0, false);
    animateBrace(parts, 'sword', 2);
    expect(parts.feet[1]!.matrix[2] - parts.feet[0]!.matrix[2]).toBeGreaterThan(1.2);
    expect(parts.body!.matrix[4]).toBeLessThan(1);
    expect(parts.arms[1].turn.elbow).toBeLessThan(-0.8);
  });
});

describe('rigged monsters', () => {
  const lairs = [
    DungeonKind.Cave,
    DungeonKind.Crypt,
    DungeonKind.Portal,
    DungeonKind.Ruin,
    DungeonKind.GiantHall,
  ];
  const shapes = (node: PaintNode): number =>
    node instanceof SceneNode
      ? node.children.reduce((sum, child) => sum + shapes(child), 0)
      : node instanceof ShapeNode
        ? 1
        : 0;
  it.each(lairs)(
    'keeps lair %i within a crowd’s paint budget, with a child list that never changes',
    (lair) => {
      for (const rank of [
        MonsterRank.Grunt,
        MonsterRank.Brute,
        MonsterRank.Stalker,
        MonsterRank.Guardian,
        MonsterRank.Swarmer,
        MonsterRank.Spitter,
      ])
        for (let id = 1; id <= 12; id++) {
          const body = new SceneNode();
          monsterBody(body, lair, id, rank);
          // The bulk of a brood is the cheapest thing on the field.
          expect(shapes(body)).toBeLessThanOrEqual(
            lair === DungeonKind.GiantHall ? 32 : rank === MonsterRank.Swarmer ? 12 : 22,
          );
          const before = JSON.stringify(
            body.children.map((child) => (child instanceof SceneNode ? child.children.length : 0)),
          );
          for (let i = 0; i < 40; i++)
            poseMonster(body, {
              walking: i % 2 === 0,
              moved: 0.05,
              blow: i % 3 ? -1 : i / 40,
              clock: i / 30,
            });
          expect(
            JSON.stringify(
              body.children.map((child) => (child instanceof SceneNode ? child.children.length : 0)),
            ),
          ).toBe(before);
        }
    },
  );
  it('shares one solved pose between every monster of a kind in step', () => {
    const kind = monsterKind(DungeonKind.Ruin),
      clip = kind.walk;
    expect(kind.bank.pose(clip, 7.2)).toBe(kind.bank.pose(clip, 6.9));
    expect(kind.bank.pose(clip, 7)).not.toBe(kind.bank.pose(clip, 8));
    // Held poses: a horde steps on fewer frames.
    expect(kind.bank.pose(clip, 7, 3)).toBe(kind.bank.pose(clip, 5.6, 3));
    expect(kind.bank.pose(clip, clip.frames + 3)).toBe(kind.bank.pose(clip, 3));
  });
  it('draws a den as a nest that no clip moves, and folds a slain monster to the ground', () => {
    const pieces = (body: SceneNode) =>
      JSON.stringify((body.children[0] as SceneNode).children.map((child) => child.matrix));
    for (const lair of lairs) {
      const den = new SceneNode();
      monsterBody(den, lair, 1, MonsterRank.Den);
      expect(shapes(den)).toBeGreaterThan(2);
      expect(poseFallenMonster(den, 0.1)).toBe(false);
      const body = new SceneNode();
      monsterBody(body, lair, 2, MonsterRank.Grunt);
      const standing = pieces(body);
      expect(poseFallenMonster(body, fallSeconds * 0.9)).toBe(true);
      expect(pieces(body)).not.toBe(standing);
      expect(poseFallenMonster(body, fallSeconds)).toBe(false);
      // A guardian breaks apart instead (combat-effects.ts), so it has no fall of its own.
      const guardian = new SceneNode();
      monsterBody(guardian, lair, 3, MonsterRank.Guardian);
      expect(poseFallenMonster(guardian, 0.1)).toBe(false);
    }
  });
  it('raises a wound-up weapon before the blow and brings it down on contact', () => {
    const body = new SceneNode();
    monsterBody(body, DungeonKind.GiantHall, 5, MonsterRank.Guardian);
    const weapon = () => {
      // The maul rides in the tool hand: its matrix tells where the head of the weapon points.
      const arm = (body.children[0] as SceneNode).children.at(-2)!.matrix;
      return Math.atan2(arm[3] * 0.6 + arm[4] * -0.8, arm[0] * 0.6 + arm[1] * -0.8);
    };
    poseMonster(body, { walking: false, moved: 0, blow: -1, windup: 1, clock: 1 });
    const raised = weapon();
    poseMonster(body, { walking: false, moved: 0, blow: 0, clock: 1.1 });
    const landed = weapon();
    // Up and back while it waits (pointing above the horizon), ahead and down when it lands.
    expect(raised).toBeLessThan(-70 * degrees);
    expect(landed).toBeGreaterThan(0);
  });
});

describe('rigged animals', () => {
  const kinds = [
    AnimalKind.Cow,
    AnimalKind.Pig,
    AnimalKind.Chicken,
    AnimalKind.Wolf,
    AnimalKind.Dog,
    AnimalKind.Cat,
  ];
  const shapes = (node: PaintNode): number =>
    node instanceof SceneNode
      ? node.children.reduce((sum, child) => sum + shapes(child), 0)
      : node instanceof ShapeNode
        ? 1
        : 0;
  const pieces = (sprite: SceneNode) =>
    ((animalBody(sprite)[0] as SceneNode).children[0] as SceneNode).children;
  /** The animal's own outline: the filled shape with the longest path. */
  const outline = (sprite: SceneNode) =>
    pieces(sprite)
      .filter(
        (piece): piece is ShapeNode =>
          piece instanceof ShapeNode &&
          !!piece.color &&
          piece.commands.filter((c) => c[0] === 'M').length === 1,
      )
      .reduce((best, shape) => (shape.commands.length > best.commands.length ? shape : best));
  const top = (shape: ShapeNode) =>
    Math.min(...shape.commands.map((command) => (command[0] === 'C' ? command[6] : Infinity)));
  it.each(kinds)('keeps the outline of animal %i coherent through walking, sleeping and waking', (kind) => {
    const sprite = animalSprite(kind),
      count = pieces(sprite).length;
    // A herd is cheap: one shadow and well under a score of paints.
    expect(shapes(sprite)).toBeLessThanOrEqual(16);
    // At this clock animal 2 stands with its head up, between spells of grazing.
    poseAnimal(sprite, false, false, 12, 2, 1);
    const body = outline(sprite),
      standing = top(body),
      still = JSON.stringify(body.commands);
    // The trunk has a continuous contour above the legs.
    expect(body.commands.filter((command) => command[0] === 'M')).toHaveLength(1);
    expect(body.commands.length).toBeGreaterThan(kind === AnimalKind.Chicken ? 14 : 30);
    expect(sprite.children.at(-1)!.alpha).toBe(0);
    poseAnimal(sprite, false, true, 12, 2, 1);
    expect(JSON.stringify(outline(sprite).commands)).not.toBe(still);
    poseAnimal(sprite, true, false, 12, 2, 1);
    // Asleep, the whole outline has come down onto the ground and the snore shows.
    expect(top(outline(sprite))).toBeGreaterThan(standing + 1.5);
    expect(sprite.children.at(-1)!.alpha).toBe(255);
    const sleepingBody = (animalBody(sprite)[0] as SceneNode).children[0];
    poseAnimal(sprite, true, false, 13, 2, -1);
    expect((animalBody(sprite)[0] as SceneNode).children[0]).toBe(sleepingBody);
    poseAnimal(sprite, false, false, 12, 2, 1);
    expect(pieces(sprite)).toHaveLength(count);
    expect(outline(sprite).commands).toBe(body.commands);
  });
  it('shares solved drawings among animals of the same species', () => {
    for (const kind of kinds) {
      const a = animalSprite(kind),
        b = animalSprite(kind);
      for (const clock of [3.2, 7.9]) {
        poseAnimal(a, false, true, clock, 5, 1);
        poseAnimal(b, false, true, clock, 5, 1);
        expect(outline(a).commands).toBe(outline(b).commands);
      }
    }
  });
  it.each([
    [AnimalKind.Dog, 0.84, [198, 154, 104]],
    [AnimalKind.Cat, 0.56, [186, 164, 132]],
  ] as const)('keeps the original coat, scale and head motion of companion %i', (kind, scale, hide) => {
    const sprite = animalSprite(kind),
      original = quadrupedFigure();
    expect(animalBody(sprite)[0].matrix[0]).toBeCloseTo(scale);
    expect(outline(sprite).color?.slice(0, 3)).toEqual(hide);
    for (const frame of [0, 5, 12, 21]) {
      poseAnimal(sprite, false, true, frame / 34, 0, 1);
      original.play(quadrupedClips.walk, frame, 0, 0);
      const head = original.frame.matrix(original.skeleton.bone('head'));
      pieces(sprite)
        .at(-1)!
        .matrix.forEach((value, i) => expect(value).toBeCloseTo(head[i], 5));
    }
    poseAnimal(sprite, true, false, 0, 0, 1);
    const visibility = pieces(sprite).map((piece) => piece.alpha);
    expect(visibility.filter((alpha) => alpha === 0)).toHaveLength(2);
    poseAnimal(sprite, false, false, 8, 0, 1);
    expect(pieces(sprite).filter((piece, i) => piece.alpha !== visibility[i])).toHaveLength(4);
  });
  it.each([AnimalKind.Dog, AnimalKind.Cat, AnimalKind.Pig, AnimalKind.Wolf])(
    'swings the complete leg of animal %i from one joint',
    (kind) => {
      const build = mammalOf(kind),
        figure = mammalFigure(build),
        clip = animalWalk(build);
      for (const side of ['fl', 'fr', 'hl', 'hr']) {
        const bone = figure.skeleton.bone('leg.' + side),
          leg = side[0] === 'f' ? build.fore : build.hind,
          root = point(figure.skeleton.restX[bone], figure.skeleton.restY[bone]),
          toe = point(root.x + leg.foot[0] - leg.root[0], root.y + leg.foot[1] - leg.root[1]);
        expect(figure.skeleton.parents).not.toContain(bone);
        let contacts = 0,
          lift = 0;
        for (let i = 0; i < clip.frames; i++) {
          figure.play(clip, i, 0, 0);
          const foot = figure.frame.carry(bone, toe.x, toe.y),
            at = figure.frame.joint(bone);
          expect(Math.hypot(foot.x - at.x, foot.y - at.y)).toBeCloseTo(
            Math.hypot(toe.x - root.x, toe.y - root.y),
            4,
          );
          expect(foot.y).toBeLessThanOrEqual(toe.y + 0.0001);
          if (Math.abs(foot.y - toe.y) < 0.001) contacts++;
          lift = Math.max(lift, toe.y - foot.y);
        }
        expect(contacts).toBeGreaterThan(clip.frames / 2);
        expect(lift).toBeGreaterThan(0.25);
      }
    },
  );
});
