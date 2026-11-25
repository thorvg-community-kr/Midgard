// Wildlife in profile. The trunk carries weight above four independently posed limbs; coat markings
// follow the same bones as the hide beneath them. Feet, ears and muzzles keep their own outlines.
import { AnimalKind } from '../../engine/src/person';
import type { Rgb, ShapeNode } from './paint';
import { discs, fills, type RigSkin } from './rig-skin';
import { SkinnedPath, type OutlinePoint } from './rig-skinned-path';
import type { Skeleton } from './rig-skeleton';
import { mammalOf, type AnimalLeg, type LegSide } from './wildlife-anatomy';

type Knot = readonly [x: number, y: number, corner?: boolean];
type Loop = readonly OutlinePoint[];
interface Layer {
  color: Rgb;
  loops: readonly Loop[];
  /** Only the feet change drawings when a companion or wolf lies down. */
  resting?: boolean;
}
const on = (bone: string, ...knots: Knot[]): OutlinePoint[] =>
  knots.map(([x, y, corner]) => [x, y, bone, corner]);
const hip = (...p: Knot[]) => on('hips', ...p),
  chest = (...p: Knot[]) => on('chest', ...p),
  neck = (...p: Knot[]) => on('neck', ...p),
  face = (...p: Knot[]) => on('head', ...p),
  tail = (...p: Knot[]) => on('tail', ...p),
  feathers = (...p: Knot[]) => on('body', ...p);
const layer = (color: Rgb, ...loops: Loop[]): Layer => ({ color, loops });
interface Coat {
  hide: Rgb;
  far: Rgb;
  sole?: Rgb;
  /** Tail and far ear behind the trunk, then the outline of the trunk and head, then markings. */
  behind: Layer[];
  body: Loop;
  markings: Layer[];
  eye: readonly [number, number, number];
}
const eyeInk: Rgb = [47, 39, 35],
  glint: Rgb = [247, 232, 199];

// Red-pied cow: level topline, deep rib cage, sloping dewlap and long poll-to-nose profile.
const cowHide: Rgb = [220, 209, 176],
  cowRed: Rgb = [141, 83, 52],
  cowUmber: Rgb = [101, 66, 50];
const cow: Coat = {
  hide: cowHide,
  far: [144, 131, 106],
  sole: [75, 65, 55],
  behind: [
    layer(
      cowUmber,
      tail(
        [-8.65, -12.0],
        [-9.6, -11.2],
        [-10.1, -8.4],
        [-10.55, -5.25],
        [-11.25, -4.0],
        [-11.99, -4.05, true],
        [-11.78, -5.5],
        [-11.1, -6.1],
        [-10.65, -9.1],
        [-10.1, -11.8],
        [-9.2, -12.65],
      ),
    ),
    layer(
      [168, 144, 102],
      face([8.35, -13.2], [8.15, -14.3], [8.45, -15.65, true], [8.8, -14.85], [9.35, -13.42]),
    ),
    layer(cowRed, face([8.9, -13.1], [10.0, -13.77], [11.25, -13.8, true], [10.75, -13.0], [9.35, -12.45])),
  ],
  body: [
    ...hip([-9.65, -11.45], [-8.85, -12.65], [-7.5, -13.1], [-5.8, -13.0], [-3.35, -12.83]),
    ...chest([-0.3, -12.97], [2.6, -13.4], [3.7, -13.55]),
    ...neck([4.9, -13.28], [6.1, -13.45]),
    ...face(
      [7.45, -13.95],
      [8.7, -14.04],
      [9.53, -13.65],
      [10.15, -12.82],
      [10.55, -11.85],
      [11.53, -10.9],
      [12.35, -10.29],
      [12.65, -9.67],
      [12.48, -9.13],
      [11.72, -8.85],
      [10.8, -9.02],
      [9.6, -9.59],
      [8.28, -10.12],
    ),
    ...neck([7.42, -9.63], [7.06, -8.53], [6.45, -7.55], [6.05, -7.57, true], [5.73, -6.67]),
    ...chest([5.0, -5.9], [3.5, -5.66], [1.35, -5.15], [-1.43, -4.94]),
    ...hip([-3.75, -4.95], [-5.3, -5.33], [-6.85, -5.05], [-8.36, -5.68], [-9.35, -7.45], [-9.78, -9.53]),
  ],
  markings: [
    layer(
      [182, 165, 133],
      [
        ...hip([-8.78, -7.05], [-7.36, -6.37], [-4.8, -6.08]),
        ...chest([-1.6, -5.94], [1.4, -6.27], [3.25, -6.9], [4.46, -8.1]),
        ...neck([6.2, -9.48], [7.7, -10.35]),
        ...face([9.63, -9.63], [10.58, -9.1], [9.24, -9.76]),
        ...neck([7.48, -9.6], [6.74, -7.99], [6.04, -7.05]),
        ...chest([5.2, -5.98], [2, -5.39], [-1.7, -5.04]),
        ...hip([-4.6, -5.15], [-7.25, -5.39], [-8.42, -6.1]),
      ],
    ),
    layer(
      cowRed,
      hip(
        [-9.12, -11.95],
        [-7.68, -12.92],
        [-5.62, -12.88],
        [-4.25, -12.81],
        [-4.13, -11.46],
        [-4.75, -10.4],
        [-4.63, -9.46],
        [-5.61, -8.48],
        [-7.12, -8.77],
        [-7.92, -9.6],
        [-8.95, -9.7],
      ),
      [
        ...chest([0.0, -12.83], [2.53, -13.25], [3.74, -13.38]),
        ...neck([5.05, -13.12], [5.76, -13.19], [5.52, -12.2], [4.81, -11.14]),
        ...chest([4.61, -9.85], [3.63, -9.16], [2.61, -9.32], [2.1, -10.35], [0.92, -10.65], [0.28, -11.75]),
      ],
      face(
        [7.4, -13.72],
        [8.66, -13.94],
        [9.58, -13.16],
        [9.91, -12.26],
        [9.42, -11.66],
        [8.3, -11.98],
        [7.67, -12.68],
      ),
    ),
    layer(
      [198, 161, 142],
      face(
        [10.87, -10.75],
        [11.67, -10.7],
        [12.52, -10.18],
        [12.72, -9.73],
        [12.5, -9.12],
        [11.72, -8.82],
        [10.78, -9.06],
        [10.43, -9.64],
      ),
    ),
    layer(
      cowUmber,
      face(
        [8.03, -12.93],
        [7.03, -13.17],
        [5.58, -13.11],
        [5.0, -12.72, true],
        [5.81, -12.13],
        [6.7, -12.11],
        [7.72, -12.45],
      ),
      face([11.74, -10.15], [12.12, -10.23], [12.32, -9.98], [11.89, -9.86]),
    ),
    layer(
      [238, 219, 172],
      face(
        [7.65, -13.37],
        [7.21, -13.92],
        [7.0, -14.64],
        [7.15, -15.34, true],
        [7.72, -14.62],
        [8.41, -14.02],
        [8.61, -13.59],
      ),
    ),
  ],
  eye: [9.23, -12.33, 0.31],
};

// A pig carries its weight low, with a convex loin, a jowl flowing into the chest and a raised snout.
const pigHide: Rgb = [207, 142, 123],
  pigShade: Rgb = [168, 105, 92];
const pig: Coat = {
  hide: pigHide,
  far: [160, 110, 95],
  behind: [
    layer(
      pigShade,
      tail(
        [-8.2, -7.58],
        [-9.13, -7.89],
        [-9.85, -8.46],
        [-10.02, -9.18],
        [-9.68, -9.68],
        [-9.1, -9.61],
        [-8.98, -9.16],
        [-9.37, -8.87],
        [-9.6, -9.11, true],
        [-9.37, -9.15],
        [-9.36, -9.37],
        [-9.6, -9.37],
        [-9.72, -9.1],
        [-9.46, -8.64],
        [-8.85, -8.35],
        [-8.15, -8.28],
      ),
    ),
    layer(pigShade, face([6.52, -9.43], [7.65, -10.9], [8.72, -11.18, true], [8.47, -10.22], [7.67, -9.02])),
  ],
  body: [
    ...hip([-8.99, -7.63], [-8.51, -9.02], [-7.18, -10.18], [-4.64, -10.85], [-2.77, -10.93]),
    ...chest([-0.45, -10.8], [1.75, -10.49], [3.68, -9.83]),
    ...neck([5, -9.18], [5.86, -9.24]),
    ...face(
      [6.97, -9.7],
      [7.77, -9.26],
      [8.39, -8.6],
      [9.12, -7.81],
      [9.83, -7.16],
      [10.62, -7.11],
      [11.19, -7.45],
      [11.57, -7.31],
      [11.64, -6.38],
      [11.22, -5.65],
      [10.28, -5.26],
      [9.48, -5.03],
      [8.46, -4.44],
      [7.45, -4.2],
    ),
    ...neck([6.1, -4.2], [5.25, -3.8]),
    ...chest([3.34, -3.22], [0.92, -2.7], [-1.19, -2.63]),
    ...hip([-3.64, -2.85], [-5.4, -3.35], [-6.61, -3.55], [-7.82, -4.23], [-8.77, -5.62]),
  ],
  markings: [
    layer(
      [188, 122, 106],
      [
        ...hip([-8.63, -6.07], [-7.35, -5.18], [-5.35, -5.1], [-3.48, -4.13]),
        ...chest([-1.6, -3.83], [0.91, -3.86], [3.22, -4.8]),
        ...neck([5.05, -5.53]),
        ...face([7.42, -5.6], [9.32, -5.38], [10.45, -5.65], [9.43, -4.94], [8.14, -4.4]),
        ...neck([6.13, -4.21], [5.26, -3.83]),
        ...chest([3.36, -3.24], [0.76, -2.78], [-1.29, -2.73]),
        ...hip([-4.27, -3.01], [-6.4, -3.59], [-8.03, -4.61]),
      ],
    ),
    layer(
      [225, 160, 139],
      face(
        [10.15, -7.15],
        [10.86, -7.48],
        [11.52, -7.57],
        [11.8, -7.28],
        [11.74, -6.33],
        [11.39, -5.86],
        [10.49, -5.79],
        [10.06, -6.27],
      ),
    ),
    layer(
      [137, 83, 76],
      face([10.88, -6.86], [11.06, -7.02], [11.16, -6.82], [10.99, -6.41]),
      face([11.42, -6.96], [11.56, -7.09], [11.6, -6.89], [11.48, -6.62]),
    ),
    layer(
      [223, 158, 136],
      face(
        [5.68, -9.0],
        [5.87, -10.0],
        [6.89, -10.62],
        [8.09, -10.52],
        [8.08, -9.82],
        [7.14, -8.43],
        [6.64, -7.99, true],
        [6.27, -8.37],
      ),
    ),
    layer(
      pigShade,
      face([6.24, -9.85], [6.91, -10.32], [7.79, -10.22], [7.22, -9.17], [6.72, -8.62, true], [6.69, -9.36]),
    ),
  ],
  eye: [8.6, -7.96, 0.26],
};

// A wolf reads by its low brush, pointed ears and tucked flank. The hide has one clean plane.
const wolf: Coat = {
  hide: [146, 154, 152],
  far: [102, 110, 114],
  behind: [],
  markings: [],
  body: [
    ...hip([-7.8, -9.2], [-4, -10.1]),
    ...chest([0.5, -9.8], [3.4, -10.6]),
    ...neck([5, -11.2]),
    ...face(
      [6, -11.6],
      [6.5, -13.9, true],
      [7.5, -11.8],
      [8.5, -14, true],
      [9.3, -11.5],
      [10.3, -10.7],
      [12.3, -9.7],
      [12.9, -9, true],
      [12.3, -8.2],
      [9.6, -7.7],
    ),
    ...neck([7.2, -7]),
    ...chest([5.9, -5.75], [4.85, -5.02], [3.53, -4.68], [2.12, -4.72], [0.5, -5.06], [-0.6, -5.36]),
    ...hip(
      [-2.1, -5.52],
      [-3.46, -5.38],
      [-4.48, -4.98],
      [-5.58, -4.92],
      [-6.71, -5.24],
      [-7.54, -5.8],
      [-8, -6.4],
    ),
    ...tail([-8.6, -6.6], [-11.4, -6], [-13, -7.4, true], [-11.2, -9.4], [-8.6, -9.1]),
  ],
  eye: [9.6, -10.4, 0.32],
};

// The companions keep their original profiles, markings and proportions. The hide closes behind their legs.
const dog: Coat = {
  hide: [198, 154, 104],
  far: [150, 112, 76],
  behind: [],
  markings: [],
  body: [
    ...hip([-7.4, -8.9], [-4, -9.9]),
    ...chest([0.5, -9.6], [3.2, -10.1]),
    ...neck([4.8, -10.8]),
    ...face(
      [5.8, -11.3],
      [7.4, -11.9],
      [9, -11.5],
      [10.1, -10.5],
      [11.7, -10],
      [12.3, -9.3, true],
      [11.8, -8.3],
      [9.2, -7.7],
    ),
    ...neck([7, -7]),
    ...chest([5.7, -5.6], [4.78, -4.95], [3.79, -4.55], [2.7, -4.39], [1.62, -4.41], [0.6, -4.4]),
    ...hip(
      [-0.82, -4.29],
      [-2.6, -4.2],
      [-3.71, -4.12],
      [-5.02, -4.17],
      [-6.24, -4.54],
      [-7.12, -5.28],
      [-7.6, -6.2],
    ),
    ...tail([-7.9, -7.4], [-9.7, -9.2], [-9.3, -11.9, true], [-8.4, -9.8], [-7.4, -8.7]),
  ],
  eye: [8.7, -10.3, 0.32],
};
const cat: Coat = {
  hide: [186, 164, 132],
  far: [140, 126, 106],
  behind: [],
  markings: [],
  body: [
    ...hip([-7.2, -8.7], [-4, -9.7]),
    ...chest([0.5, -9.4], [3.2, -9.8]),
    ...neck([4.6, -10.6]),
    ...face(
      [5.2, -11.6],
      [5.6, -14.4, true],
      [7.2, -12.5],
      [8, -12.6],
      [9.4, -14.6, true],
      [10, -11.9],
      [10.9, -10],
      [10.5, -8.1],
      [9.2, -7.2],
    ),
    ...neck([6.6, -6.9]),
    ...chest([5.5, -5.6], [4.63, -4.95], [3.82, -4.59], [2.71, -4.49], [1.54, -4.53], [0.6, -4.5]),
    ...hip(
      [-0.86, -4.36],
      [-2.6, -4.3],
      [-3.68, -4.19],
      [-4.91, -4.23],
      [-6.12, -4.63],
      [-6.98, -5.35],
      [-7.4, -6.2],
    ),
    ...tail([-7.7, -7.3], [-9.9, -8.8], [-9.9, -12.3], [-8.9, -12.9, true], [-8.6, -9.6], [-7.2, -8.5]),
  ],
  eye: [7.5, -10.3, 0.34],
};

/** Trace the muscle round a bent hind stifle or the straighter foreleg. The sole rides the foot
 * bone, so the planted contact stays level when the shin turns above it. */
function limb(skeleton: Skeleton, side: LegSide, form: AnimalLeg, hoof: boolean): { limb: Loop; tip: Loop } {
  const fore = side[0] === 'f',
    upper = 'leg.' + side + '.1',
    lower = 'leg.' + side + '.2',
    foot = 'foot.' + side;
  const a = skeleton.bone(upper),
    b = skeleton.bone(lower),
    c = skeleton.bone(foot);
  const x = skeleton.restX[a],
    y = skeleton.restY[a],
    kx = skeleton.restX[b],
    ky = skeleton.restY[b],
    fx = skeleton.restX[c],
    fy = skeleton.restY[c],
    { muscle, shin, toe } = form,
    stifleX = fore ? x - 0.2 : x + muscle * 0.92,
    stifleY = y + (ky - y) * (fore ? 0.45 : 0.32);
  return {
    limb: [
      ...on(
        upper,
        [x - muscle * 0.76, y - 0.72],
        [x + muscle * 0.98, y - 0.72],
        [x + muscle * 1.13, y + 0.45],
        [stifleX + muscle * 0.82, stifleY],
        [stifleX + muscle * 0.48, stifleY + 0.72],
      ),
      ...on(
        lower,
        [kx + shin * 0.9, ky - 0.05],
        [kx * 0.45 + fx * 0.55 + shin * 0.75, (ky + fy) / 2],
        [fx + shin * 0.9, fy - 0.44],
      ),
      ...on(
        foot,
        [fx + toe * 0.82, fy - 0.31],
        [fx + toe, fy + 0.13],
        [fx + toe * 0.7, fy + 0.27],
        [fx - shin * 0.8, fy + 0.27],
        [fx - shin * 1.06, fy - 0.13],
      ),
      ...on(lower, [fx - shin * 0.75, fy - 0.8], [kx - shin * 1.2, ky + 0.28], [kx - shin * 1.4, ky - 0.18]),
      ...on(
        upper,
        [fore ? x - muscle * 1.02 : x - muscle * 0.62, stifleY + 0.15],
        [x - muscle * 1.07, y + 0.48],
      ),
    ],
    tip: hoof
      ? on(
          foot,
          [fx - shin * 0.91, fy - 0.48],
          [fx + shin * 0.46, fy - 0.66],
          [fx + toe * 0.77, fy - 0.38],
          [fx + toe * 1.13, fy + 0.2, true],
          [fx + toe * 0.86, fy + 0.34],
          [fx - shin * 1.08, fy + 0.32, true],
        )
      : on(
          foot,
          [fx - shin * 0.89, fy - 0.27],
          [fx + shin * 0.44, fy - 0.47],
          [fx + toe * 0.94, fy - 0.28],
          [fx + toe * 1.17, fy + 0.01],
          [fx + toe * 1.02, fy + 0.27],
          [fx + 0.06, fy + 0.33],
          [fx - shin * 1.04, fy + 0.19],
        ),
  };
}

/** One continuous, gently tapered leg. The light changes between the near and far legs, never at a joint. */
function wholeLeg(skeleton: Skeleton, side: LegSide, form: AnimalLeg, hoof: boolean): Loop {
  const bone = 'leg.' + side,
    index = skeleton.bone(bone),
    x = skeleton.restX[index],
    y = skeleton.restY[index],
    fx = x + form.foot[0] - form.root[0],
    fy = y + form.foot[1] - form.root[1],
    span = fy - y,
    fore = side[0] === 'f',
    width = form.muscle * (hoof ? 1.04 : 1.13),
    ankle = form.shin * (hoof ? 1.3 : 1.18),
    toe = form.toe,
    thigh = fore ? 0.05 : 0.55,
    heel = fore ? 0.06 : 0.43;
  return on(
    bone,
    [x - width * 0.82, y - 0.75],
    [x + width * 0.68, y - 0.8],
    [x + width, y + span * 0.13],
    [x + width * (0.78 + thigh), y + span * 0.32],
    [x + width * 0.58, y + span * 0.53],
    [fx + ankle * 0.62, y + span * 0.76],
    [fx + ankle * 0.66, fy - 0.64],
    [fx + toe * 0.65, fy - 0.38],
    [fx + toe, fy - 0.18],
    [fx + toe * 1.06, fy + 0.12],
    [fx + toe * 0.8, fy + 0.25],
    [fx - ankle * 0.6, fy + 0.26],
    [fx - ankle * 0.95, fy + 0.08],
    [fx - ankle, fy - 0.55],
    [fx - ankle - heel, y + span * 0.7],
    [x - width * 0.91 - heel, y + span * 0.49],
    [x - width * 1.12, y + span * 0.28],
    [x - width * 1.04, y + span * 0.05],
  );
}
/** A folded leg is one low, rounded contour which meets the underside of the resting body. */
function tuckedLeg(side: LegSide, form: AnimalLeg): Loop {
  const fore = side[0] === 'f',
    far = side[1] === 'l',
    x = form.root[0] + (far ? (fore ? -0.85 : 0.95) : 0),
    y = far ? -0.38 : 0,
    width = form.muscle,
    reach = form.toe * (fore ? 4.25 : 2.8);
  return on(
    'ground',
    [x - width * 1.25, y - 2.75],
    [x - width * 0.62, y - 3.45],
    [x + width * 0.52, y - 3.2],
    [x + width * 1.25, y - 2.32],
    [x + reach * 0.69, y - 1.22],
    [x + reach * 0.93, y - 0.94],
    [x + reach, y - 0.66],
    [x + reach * 0.96, y - 0.4],
    [x + reach * 0.76, y - 0.26],
    [x + width * 0.36, y - 0.28],
    [x - width * 0.74, y - 0.51],
    [x - width * 1.38, y - 1.15],
    [x - width * 1.48, y - 1.96],
  );
}

function mammalLayers(kind: AnimalKind, skeleton: Skeleton, coat: Coat): Layer[] {
  const build = mammalOf(kind);
  if (skeleton.find('leg.fr') >= 0) {
    const legs = (['fl', 'hl', 'fr', 'hr'] as const).map((side) =>
      wholeLeg(skeleton, side, side[0] === 'f' ? build.fore : build.hind, build.hoof),
    );
    const far = layer(coat.far, legs[0], legs[1]),
      near = layer(coat.hide, legs[2], legs[3]);
    const feet = [far, near];
    if (build.profileMotion) {
      far.resting = near.resting = false;
      feet.push(
        { ...layer(coat.far, tuckedLeg('fl', build.fore), tuckedLeg('hl', build.hind)), resting: true },
        { ...layer(coat.hide, tuckedLeg('fr', build.fore), tuckedLeg('hr', build.hind)), resting: true },
      );
    }
    return [...coat.behind, ...feet, layer(coat.hide, coat.body), ...coat.markings];
  }
  const legs = (['fl', 'hl', 'fr', 'hr'] as const).map((side) =>
    limb(skeleton, side, side[0] === 'f' ? build.fore : build.hind, build.hoof),
  );
  return [
    ...coat.behind,
    layer(coat.far, legs[0].limb, legs[1].limb),
    layer(coat.hide, legs[2].limb, legs[3].limb),
    layer(coat.sole ?? coat.hide, ...legs.map((l) => l.tip)),
    layer(coat.hide, coat.body),
    ...coat.markings,
  ];
}

const henCopper: Rgb = [180, 111, 64],
  henGold: Rgb = [217, 158, 89],
  henDark: Rgb = [77, 78, 64];
function chickenLeg(side: 'l' | 'r'): Loop[] {
  const x = side === 'l' ? -0.7 : 0.4,
    leg = 'leg.' + side + '.1',
    shin = 'leg.' + side + '.2',
    foot = 'foot.' + side;
  return [
    [
      ...on(leg, [x - 0.24, -3.53], [x + 0.33, -3.56], [x + 0.39, -2.76]),
      ...on(shin, [x + 0.38, -1.76], [x + 0.13, -0.55]),
      ...on(foot, [x + 0.21, -0.39], [x - 0.2, -0.34]),
      ...on(shin, [x - 0.15, -0.77], [x + 0.01, -1.77]),
      ...on(leg, [x - 0.2, -2.81]),
    ],
    on(
      foot,
      [x - 0.12, -0.64],
      [x + 0.65, -0.52],
      [x + 1.58, -0.37, true],
      [x + 0.63, -0.28],
      [x + 1.15, -0.04, true],
      [x + 0.29, -0.22],
      [x - 0.17, -0.26],
      [x - 0.92, -0.15, true],
      [x - 0.61, -0.43],
    ),
  ];
}
const hen: Layer[] = [
  layer(
    henDark,
    tail(
      [-2.12, -6.34],
      [-3.53, -7.63],
      [-5.12, -9.72],
      [-5.82, -10.03, true],
      [-5.7, -8.57],
      [-5.25, -7.37],
      [-6.61, -8.16, true],
      [-6.35, -7.22],
      [-5.31, -5.79],
      [-6.19, -6.05, true],
      [-5.21, -5.02],
      [-3.2, -4.39],
      [-2.08, -5.18],
    ),
  ),
  layer(
    [111, 109, 84],
    tail(
      [-2.63, -5.79],
      [-4.1, -6.91],
      [-5.05, -8.35],
      [-4.94, -7.24],
      [-4.07, -5.89],
      [-5.3, -6.52, true],
      [-4.29, -5.42],
    ),
  ),
  layer([155, 113, 65], ...chickenLeg('l')),
  layer([193, 137, 66], ...chickenLeg('r')),
  layer(henCopper, [
    ...feathers([-4.06, -5.93], [-3.34, -6.78], [-2.07, -7.18], [-0.63, -7.32], [0.53, -7.19]),
    ...neck([1.35, -7.68], [1.7, -8.71]),
    ...face(
      [2.01, -9.39],
      [2.85, -9.77],
      [3.62, -9.58],
      [4.08, -9.14],
      [4.24, -8.55],
      [4.13, -7.92],
      [3.9, -7.34],
    ),
    ...neck([3.69, -6.78], [3.64, -6.02]),
    ...feathers(
      [3.87, -5.29],
      [3.7, -4.38],
      [3.18, -3.5],
      [2.1, -2.82],
      [0.6, -2.58],
      [-0.93, -2.78],
      [-2.63, -3.37],
      [-3.75, -4.46],
      [-4.17, -5.27],
    ),
  ]),
  layer(henGold, [
    ...feathers([-1.31, -6.88], [0.43, -7.03]),
    ...neck([1.37, -7.65], [1.76, -8.71]),
    ...face([2.11, -9.41], [2.9, -9.72], [3.64, -9.51], [4.08, -9.05], [4.16, -8.29], [3.88, -7.44]),
    ...neck([3.59, -6.74], [3.6, -5.89]),
    ...feathers(
      [3.49, -5.4, true],
      [3.15, -5.77],
      [2.81, -5.06, true],
      [2.44, -5.63],
      [2.06, -5.15, true],
      [1.97, -5.75],
      [1.46, -5.38, true],
      [1.39, -6.12],
      [0.33, -6.44],
    ),
  ]),
  layer(
    [141, 92, 62],
    feathers(
      [-3.31, -5.65],
      [-2.4, -6.3],
      [-0.79, -6.37],
      [0.66, -5.94],
      [1.07, -5.22],
      [0.7, -4.58],
      [-0.21, -4.0],
      [-1.71, -3.89],
      [-2.93, -4.28],
      [-3.62, -4.92, true],
      [-2.54, -4.92],
      [-3.37, -5.19, true],
      [-2.25, -5.2],
    ),
  ),
  layer(
    [204, 142, 83],
    feathers(
      [-2.91, -5.66],
      [-2.11, -6.13],
      [-0.88, -6.18],
      [0.24, -5.92],
      [0.64, -5.49],
      [0.21, -5.13],
      [-0.98, -4.92],
      [-2.59, -5.05, true],
      [-1.34, -5.36],
      [-2.81, -5.31, true],
      [-1.74, -5.59],
    ),
  ),
  layer(
    [162, 70, 52],
    face(
      [1.81, -9.23],
      [2.02, -9.93],
      [2.3, -10.35],
      [2.51, -10.04],
      [2.85, -10.68],
      [3.06, -10.27],
      [3.44, -10.57],
      [3.53, -10.03],
      [3.9, -10.15],
      [3.83, -9.57],
      [3.54, -9.37],
      [2.8, -9.46],
      [2.27, -9.24],
    ),
    face(
      [3.84, -7.98],
      [4.16, -7.82],
      [4.29, -7.27],
      [4.0, -6.78],
      [3.61, -6.86],
      [3.49, -7.22],
      [3.67, -7.76],
    ),
  ),
  layer(
    [197, 142, 66],
    face([3.98, -8.85], [4.69, -8.81], [5.64, -8.39, true], [5.05, -8.17], [4.13, -8.16]),
  ),
  layer([132, 95, 58], face([4.09, -8.24], [4.74, -8.29], [5.52, -8.39, true], [4.75, -7.98], [4.1, -7.94])),
];

const compiled = new WeakMap<
  Skeleton,
  Map<AnimalKind, { color: Rgb; path: SkinnedPath; resting?: boolean }[]>
>();
export function dressAnimal(kind: AnimalKind, skin: RigSkin): ((asleep: boolean) => void) | undefined {
  const bird = kind === AnimalKind.Chicken;
  const coat =
    kind === AnimalKind.Cow
      ? cow
      : kind === AnimalKind.Pig
        ? pig
        : kind === AnimalKind.Dog
          ? dog
          : kind === AnimalKind.Cat
            ? cat
            : wolf;
  let variants = compiled.get(skin.skeleton);
  if (!variants) compiled.set(skin.skeleton, (variants = new Map()));
  let shapes = variants.get(kind);
  if (!shapes) {
    const layers = bird ? hen : mammalLayers(kind, skin.skeleton, coat);
    shapes = layers.map(({ color, loops, resting }) => ({
      color,
      path: new SkinnedPath(skin.skeleton, loops),
      resting,
    }));
    variants.set(kind, shapes);
  }
  const paws: { shape: ShapeNode; resting: boolean }[] = [];
  for (const { color, path, resting } of shapes) {
    const shape = skin.outline(color, path);
    if (resting !== undefined) {
      paws.push({ shape, resting });
      if (resting) shape.opacity(0);
    }
  }
  const [x, y, r] = bird ? [3.45, -8.83, 0.24] : coat.eye;
  const ink: Rgb = [40, 34, 38];
  if (kind === AnimalKind.Dog) {
    skin.piece(
      'head',
      fills(
        [226, 200, 160],
        [
          [8.9, -9.5],
          [11.7, -9.9],
          [12.2, -9.3],
          [11.8, -8.3],
          [9.2, -7.7],
        ],
      ),
      discs([116, 84, 62], [6.6, -9.9, 1, 1.9]),
      discs(ink, [x, y, r, 0.38], [12, -9.3, 0.34, 0.3]),
    );
  } else if (kind === AnimalKind.Cat) {
    skin.piece(
      'head',
      discs([228, 212, 176], [9.4, -8.9, 1.4, 1.05]),
      fills(ink, [
        [9.3, -9.4],
        [9.9, -9.4],
        [9.6, -9],
      ])
        .appendCircle(x, y, r, 0.44)
        .appendCircle(9.6, -10.3, 0.32, 0.44),
    );
  } else if (kind === AnimalKind.Wolf) {
    skin.piece('head', discs(ink, [x, y, r, 0.28], [12.6, -9.1, 0.3, 0.28]));
  } else {
    skin.piece(
      'head',
      discs(eyeInk, [x, y, r * 1.12, r]),
      discs(glint, [x + r * 0.23, y - r * 0.37, r * 0.29]),
    );
  }
  if (paws.length)
    return (asleep) => {
      for (const { shape, resting } of paws) shape.opacity(resting === asleep ? 255 : 0);
    };
}
