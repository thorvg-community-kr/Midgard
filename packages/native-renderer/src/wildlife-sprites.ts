// Animals as rigged figures on the species skeletons: they stand, graze or peck, walk and lie down to sleep.
import snore from './assets/wildlife/snore.json?raw';
import { f32 as f } from '../../engine/src/numeric';
import { point } from '../../engine/src/geometry';
import { AnimalKind } from '../../engine/src/person';
import { birdClips, birdFigure } from './bird-rig';
import { AnimationNode, SceneNode, type Matrix, type PaintNode } from './paint';
import { quadrupedClips } from './quadruped-rig';
import { animalWalk, fitAnimalPose, mammalFigure, mammalOf } from './wildlife-anatomy';
import type { RigClip } from './rig-clip';
import type { RigFigure } from './rig-figure';
import { PoseBank } from './rig-pose-bank';
import { RigSkin } from './rig-skin';
import { ellipse } from './vector-paint';
import { dressAnimal } from './wildlife-skins';
import { restingPig } from './wildlife-rest';

/** A way of going shared by every animal on one skeleton. */
interface Gait {
  figure: RigFigure;
  bank: PoseBank;
  idle: RigClip;
  walk: RigClip;
  sleep?: RigClip;
  /** Head down to the ground for a while: grazing, rooting, sniffing. A hen pecks within its idle. */
  graze?: RigClip;
}
const gaits = new Map<AnimalKind, Gait>();
function gaitOf(kind: AnimalKind): Gait {
  let gait = gaits.get(kind);
  if (gait) return gait;
  if (kind === AnimalKind.Chicken) {
    const figure = birdFigure();
    gait = {
      figure,
      bank: new PoseBank(figure),
      idle: birdClips.idle,
      walk: birdClips.walk,
      sleep: birdClips.sleep,
    };
  } else {
    const build = mammalOf(kind),
      figure = mammalFigure(build);
    gait = {
      figure,
      bank: new PoseBank(figure),
      idle: quadrupedClips.idle,
      walk: animalWalk(build),
      sleep: build.profileMotion
        ? quadrupedClips.sleep
        : kind === AnimalKind.Cow
          ? fitAnimalPose(quadrupedClips.sleep, build, true)
          : undefined,
      graze: [AnimalKind.Cow, AnimalKind.Pig, AnimalKind.Dog].includes(kind)
        ? fitAnimalPose(quadrupedClips.graze, build, false)
        : undefined,
    };
  }
  gaits.set(kind, gait);
  return gait;
}
interface Animal {
  foldPaws?: (asleep: boolean) => void;
  snoreOrigin?: readonly [number, number];
  curled: boolean;
  rest: SceneNode | null;
  gait: Gait;
  scale: number;
  body: SceneNode;
  skin: RigSkin;
  snore: AnimationNode;
  headBone: number;
  muzzle: readonly [number, number];
  walkRate: number;
  shown: readonly Matrix[] | null;
}
const animals = new WeakMap<SceneNode, Animal>();
const snoreFrames = 90;
export function animalSprite(kind: AnimalKind): SceneNode {
  const bird = kind === AnimalKind.Chicken,
    build = mammalOf(kind),
    scale = bird ? 0.98 : build.scale,
    gait = gaitOf(kind),
    scene = new SceneNode(),
    body = new SceneNode(),
    skin = new RigSkin(gait.figure.skeleton),
    zs = new AnimationNode(snore);
  const foldPaws = dressAnimal(kind, skin);
  const [rx, ry] = bird ? [4.4, 0.95] : build.shadow;
  const companion = kind === AnimalKind.Dog || kind === AnimalKind.Cat;
  scene.add(
    companion
      ? ellipse(point(0, 0.3), rx, ry, [0, 0, 0, 85])
      : ellipse(point(-0.55, 0.25), rx, ry, [42, 34, 25, 46]),
  );
  scene.add(body.add(skin.node).transform([scale, 0, 0, 0, scale, 0, 0, 0, 1]));
  scene.add(zs.opacity(0));
  const animal: Animal = {
    foldPaws,
    snoreOrigin:
      kind === AnimalKind.Dog
        ? [9, -5.2]
        : kind === AnimalKind.Cat
          ? [8.4, -6]
          : kind === AnimalKind.Pig
            ? [9.5, -3.8]
            : undefined,
    curled: false,
    rest: null,
    gait,
    scale,
    body,
    skin,
    snore: zs,
    headBone: gait.figure.skeleton.bone('head'),
    muzzle: bird ? [4.6, -8.5] : [build.head[0] + 2.4, build.head[1] - 0.6],
    walkRate: bird ? 30 : gait.walk.frames / build.walk[0],
    shown: null,
  };
  animals.set(scene, animal);
  show(animal, gait.idle, 0, 1);
  return scene;
}
function show(animal: Animal, clip: RigClip, frame: number, hold: number): void {
  const matrices = animal.gait.bank.pose(clip, frame, hold);
  // Animals in step share their poses; one whose pose has not moved on is left alone.
  if (matrices === animal.shown) return;
  animal.shown = matrices;
  animal.skin.pose(matrices);
}
/** The art a click may land on. */
export function animalBody(sprite: SceneNode): PaintNode[] {
  const animal = animals.get(sprite);
  return animal ? [animal.body] : sprite.children.slice(1);
}
/** Poses one frame: lying asleep under rising Zs, walking, or standing with a spell of grazing now and then. */
export function poseAnimal(
  sprite: SceneNode,
  asleep: boolean,
  walking: boolean,
  clock: number,
  id: number,
  facing: number,
): void {
  const animal = animals.get(sprite);
  if (!animal) return;
  const { gait } = animal;
  // Each animal keeps its own offset so a herd never moves in step.
  const curled = asleep && !gait.sleep;
  if (curled !== animal.curled) {
    if (curled) {
      animal.rest ??= restingPig();
      animal.body.remove(animal.skin.node).add(animal.rest);
    } else {
      animal.body.remove(animal.rest!).add(animal.skin.node);
    }
    animal.curled = curled;
  }
  if (curled) {
    const breath = 1 + 0.012 * Math.sin(clock * 1.6 + id);
    animal.rest!.transform([1, 0, 0, 0, breath, 0, 0, 0, 1]);
  } else if (asleep && gait.sleep) show(animal, gait.sleep, clock * 30 + id * 17, 3);
  else if (walking) show(animal, gait.walk, clock * animal.walkRate + id * 7, 1);
  else {
    // Every so often a standing animal puts its head down for a few seconds.
    const every = 11 + (id % 5),
      since = (clock + id * 3.7) % every,
      spell = gait.graze ? gait.graze.frames / 30 : 0;
    if (since < spell) show(animal, gait.graze!, since * 30, 2);
    else show(animal, gait.idle, clock * 30 + id * 37, 3);
  }
  if (animal.snore.alpha > 0 !== asleep) {
    animal.foldPaws?.(asleep);
    animal.snore.opacity(asleep ? 255 : 0);
  }
  if (!asleep) return;
  // The 64-unit snore frame spans 9 world units and rises from its lower left corner; `facing` keeps
  // the letters readable when the sprite is mirrored.
  const size = 9 / 64,
    head = animal.shown![animal.headBone],
    [mx, my] = animal.muzzle,
    x = (animal.snoreOrigin?.[0] ?? head[0] * mx + head[1] * my + head[2]) * animal.scale,
    y = (animal.snoreOrigin?.[1] ?? head[3] * mx + head[4] * my + head[5]) * animal.scale;
  animal.snore.transform([f(facing * size), 0, f(x - facing * 1.5), 0, f(size), f(y - 9), 0, 0, 1]);
  animal.snore.frame((clock * 30 + id * 23) % snoreFrames);
}
