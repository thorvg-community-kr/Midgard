// Side-view landmarks in the same space as the artwork, with the soles on y = 0.
import { AnimalKind } from '../../engine/src/person';
import type { RigClip } from './rig-clip';
import { quadrupedClips, quadrupedFigure } from './quadruped-rig';
import { RigFigure } from './rig-figure';
import { Skeleton, type BoneSpec } from './rig-skeleton';

type Joint = readonly [x: number, y: number];
export type LegSide = 'fl' | 'fr' | 'hl' | 'hr';
export interface AnimalLeg {
  root: Joint;
  foot: Joint;
  muscle: number;
  shin: number;
  toe: number;
}
interface Mammal {
  hips: Joint;
  chest: Joint;
  neck: Joint;
  head: Joint;
  tail: Joint;
  fore: AnimalLeg;
  hind: AnimalLeg;
  hoof: boolean;
  knees?: { fore: Joint; hind: Joint };
  profileMotion?: boolean;
  scale: number;
  shadow: Joint;
  /** Cycle length in seconds, half stride, foot clearance and forefoot's lag behind the hind foot. */
  walk: readonly [number, number, number, number];
  /** Angle of the feeding neck relative to the grazing clip. */
  feedReach: number;
}
const leg = (root: Joint, foot: Joint, muscle: number, shin: number, toe: number): AnimalLeg => ({
  root,
  foot,
  muscle,
  shin,
  toe,
});

const cow: Mammal = {
  hips: [-6.4, -9.6],
  chest: [1.4, -9.7],
  neck: [4.1, -10.8],
  head: [8.3, -12.5],
  tail: [-9.1, -11.5],
  fore: leg([4.15, -8.7], [4.3, -0.38], 1.4, 0.47, 0.97),
  hind: leg([-6.45, -8.9], [-7, -0.38], 1.72, 0.49, 1),
  hoof: true,
  knees: { fore: [3.9, -3.75], hind: [-7.75, -3.8] },
  scale: 1.02,
  shadow: [9.8, 1.82],
  walk: [1.26, 1.78, 0.9, 0.22],
  feedReach: 1.18,
};
const pig: Mammal = {
  hips: [-5.5, -6.3],
  chest: [0.9, -6.15],
  neck: [4, -6.5],
  head: [6.8, -7.2],
  tail: [-8.8, -7.65],
  fore: leg([3.15, -5.15], [3.65, -0.3], 1.16, 0.52, 0.85),
  hind: leg([-5.95, -5.65], [-6.35, -0.3], 1.55, 0.51, 0.86),
  hoof: true,
  scale: 0.93,
  shadow: [8.5, 1.6],
  walk: [0.89, 0.78, 0.32, 0.2],
  feedReach: 0.76,
};
// These landmarks carry the original companion profiles and their head, back and tail motion.
const profile = {
  hips: [-5, -6.5],
  chest: [0, -6.8],
  neck: [4.5, -7.6],
  head: [6.6, -9.4],
  tail: [-6.6, -7.2],
  hoof: false,
  profileMotion: true,
  feedReach: 1,
} as const;
const companionCycle = quadrupedClips.walk.frames / 34;
const wolf: Mammal = {
  ...profile,
  fore: leg([3.15, -6.8], [3.56, -0.34], 0.92, 0.36, 1.03),
  hind: leg([-5.55, -7.22], [-6.38, -0.34], 1.2, 0.38, 1.05),
  scale: 1.18,
  shadow: [9.55, 1.55],
  walk: [0.98, 1.52, 0.58, 0.27],
};
const dog: Mammal = {
  ...profile,
  fore: leg([3.02, -6.52], [3.37, -0.32], 0.92, 0.39, 0.96),
  hind: leg([-5.29, -6.75], [-5.74, -0.32], 1.21, 0.4, 1.03),
  scale: 0.84,
  shadow: [8.64, 2.88],
  walk: [companionCycle, 1.14, 0.45, 0.26],
};
const cat: Mammal = {
  ...profile,
  fore: leg([2.96, -6.35], [3.16, -0.3], 0.7, 0.32, 0.8),
  hind: leg([-5.22, -6.6], [-5.68, -0.3], 1, 0.33, 0.84),
  scale: 0.56,
  shadow: [6.12, 2.04],
  walk: [companionCycle, 0.99, 0.4, 0.21],
};

export function mammalOf(kind: AnimalKind): Mammal {
  switch (kind) {
    case AnimalKind.Cow:
      return cow;
    case AnimalKind.Pig:
      return pig;
    case AnimalKind.Dog:
      return dog;
    case AnimalKind.Cat:
      return cat;
    default:
      return wolf;
  }
}
export function mammalFigure(build: Mammal): RigFigure {
  const simple = !build.knees;
  const bones: BoneSpec[] = [];
  function joint(name: string, parent: string | undefined, at: Joint, dx = 0, dy = 0) {
    bones.push({ name, parent, x: at[0] + dx, y: at[1] + dy });
  }
  if (simple) joint('ground', undefined, [0, 0]);
  joint('hips', simple ? 'ground' : undefined, build.hips);
  joint('chest', 'hips', build.chest);
  joint('neck', 'chest', build.neck);
  joint('head', 'neck', build.head);
  joint('tail', 'hips', build.tail);
  const sides: LegSide[] = ['hl', 'hr', 'fl', 'fr'];
  for (const side of sides) {
    const fore = side[0] === 'f',
      far = side[1] === 'l',
      leg = fore ? build.fore : build.hind;
    // In a three-quarter profile the far hooves land a little deeper in the ground plane.
    const dx = far ? (fore ? -1.35 : 1.38) : 0,
      dy = far ? -0.42 : 0;
    if (!build.knees) {
      joint('leg.' + side, 'ground', leg.root, dx, dy);
      continue;
    }
    joint('leg.' + side + '.1', fore ? 'chest' : 'hips', leg.root, dx, dy);
    joint('leg.' + side + '.2', 'leg.' + side + '.1', fore ? build.knees.fore : build.knees.hind, dx, dy);
    joint('foot.' + side, 'leg.' + side + '.2', leg.foot, dx, dy);
  }
  const skeleton = new Skeleton(bones);
  return new RigFigure(
    skeleton,
    simple
      ? []
      : sides.map((side) => ({
          hip: skeleton.bone('leg.' + side + '.1'),
          knee: skeleton.bone('leg.' + side + '.2'),
          foot: skeleton.bone('foot.' + side),
          step: 'step.' + side,
          bend: side[0] === 'f' ? -1 : 1,
        })),
  );
}

type MotionTrack = { turn?: Float32Array; shiftX?: Float32Array; shiftY?: Float32Array };
let profileWalk: ReadonlyMap<string, MotionTrack> | undefined;
/** Keep the authored motion above the legs, including the original body's height over its supporting paw. */
function profileWalkTracks(): ReadonlyMap<string, MotionTrack> {
  if (profileWalk) return profileWalk;
  const clip = quadrupedClips.walk,
    figure = quadrupedFigure(),
    hips = figure.skeleton.bone('hips');
  const tracks = new Map<string, MotionTrack>();
  for (const bone of ['hips', 'chest', 'neck', 'head', 'tail']) {
    const track = clip.tracks.get(bone);
    if (track) tracks.set(bone, track);
  }
  const height = Float32Array.from({ length: clip.frames + 1 }, (_, frame) => {
    figure.play(clip, frame, 0, 0);
    return figure.frame.jointY[hips] - figure.skeleton.restY[hips];
  });
  tracks.set('hips', { ...tracks.get('hips'), shiftY: height });
  return (profileWalk = tracks);
}

/** In stance the ground travels back under the animal. Each paw lifts only on its return stroke. */
export function animalWalk(build: Mammal): RigClip {
  const simple = !build.knees;
  const frames = build.profileMotion ? quadrupedClips.walk.frames : 36,
    [, stride, lift, lag] = build.walk,
    tau = Math.PI * 2;
  const sample = (fn: (phase: number) => number) =>
    Float32Array.from({ length: frames + 1 }, (_, i) => fn((i % frames) / frames));
  const tracks = new Map<string, MotionTrack>(build.profileMotion ? profileWalkTracks() : undefined);
  if (!build.profileMotion) {
    tracks.set('hips', { shiftY: sample((t) => 0.11 * Math.cos(2 * tau * t)) });
    tracks.set('chest', { turn: sample((t) => 0.024 * Math.sin(2 * tau * t)) });
    tracks.set('neck', { turn: sample((t) => -0.045 * Math.sin(2 * tau * t - 0.3)) });
    tracks.set('head', { turn: sample((t) => 0.026 * Math.sin(2 * tau * t - 0.65)) });
    tracks.set('tail', { turn: sample((t) => 0.09 * Math.sin(tau * t - 0.55)) });
  }
  for (const [side, offset] of [
    ['hr', 0],
    ['fr', lag],
    ['hl', 0.5],
    ['fl', 0.5 + lag],
  ] as const) {
    const footPhase = (t: number) => (t - offset + 1) % 1,
      stance = 0.62;
    const travel = (t: number) => {
      const phase = footPhase(t);
      if (phase < stance) return stride * (1 - (2 * phase) / stance);
      const up = (phase - stance) / (1 - stance);
      return stride * (-1 + 2 * (up - Math.sin(tau * up) / tau));
    };
    const clearance = (t: number) => {
      const swing = Math.max(0, (footPhase(t) - stance) / (1 - stance));
      return lift * Math.sin(Math.PI * swing) ** 2;
    };
    if (simple) {
      const leg = side[0] === 'f' ? build.fore : build.hind;
      const length = leg.foot[1] - leg.root[1],
        ahead = leg.foot[0] - leg.root[0];
      const angle = (t: number) => -Math.asin(travel(t) / length);
      // A tiny shift of this same pivot keeps the sole on the contact plane. Nothing bends halfway down the leg.
      tracks.set('leg.' + side, {
        turn: sample(angle),
        shiftY: sample((t) => length * (1 - Math.cos(angle(t))) - ahead * Math.sin(angle(t)) - clearance(t)),
      });
    } else tracks.set('step.' + side, { shiftX: sample(travel), shiftY: sample((t) => -clearance(t)) });
  }
  return { name: 'animal walk', frames, loop: true, planted: !simple, markers: {}, tracks };
}

/** Keep the authored timing, with the head and weight lowered to this species' own feeding and resting heights. */
export function fitAnimalPose(clip: RigClip, build: Mammal, sleeping: boolean): RigClip {
  const tracks = new Map(clip.tracks);
  const scale = (name: string, field: 'turn' | 'shiftY', factor: number) => {
    const source = tracks.get(name),
      values = source?.[field];
    if (values) tracks.set(name, { ...source, [field]: values.map((v) => v * factor) });
  };
  scale('neck', 'turn', sleeping ? 0.06 : build.feedReach);
  if (sleeping) {
    // A recumbent cow lowers its flank but keeps its heavy head above its forelegs.
    scale('hips', 'shiftY', 4.55 / 3.4);
    scale('head', 'turn', 0.06);
  }
  return { ...clip, tracks };
}
