// The gates to the other worlds: caves, barrows and standing gates of weathered stone, drawn flat in two tones
// with every outline a curve; each hints at the world behind it.
import { point, project, type Point } from '../../engine/src/geometry';
import { DungeonKind, World, type Dungeon } from '../../engine/src/world-types';
import { PaintNode, SceneNode, ShapeNode, type Rgb } from './paint';
import { glow, mix, opaque } from './vector-paint';
import { appendBlob, blob, duskShade, type Local } from './flat-forms';
import { moved, pen, shapeOf, type Contour, type Form } from './outline-form';
import { paintForm } from './form-paint';
import { worldGlimpse } from './realm-palette';
import { Rect } from '../../native-ui/src/types';
const f = Math.fround;
const stoneLit: Rgb = [81, 76, 75],
  stoneShade: Rgb = [40, 40, 60],
  mouth: Rgb = [8, 8, 28],
  turfLit: Rgb = [44, 66, 40],
  turfShade: Rgb = [16, 34, 40],
  slabLit: Rgb = [92, 86, 82],
  slabShade: Rgb = [52, 50, 70],
  carved: Rgb = [24, 22, 50],
  rime: Rgb = [134, 143, 158];
export interface GateLook {
  site: Dungeon;
  world: World;
  sealed: boolean;
  dormant?: boolean;
}
const gateBodies = new WeakMap<SceneNode, readonly PaintNode[]>(),
  gateBoxes = new WeakMap<SceneNode, Rect>();
export const gateBody = (paint: SceneNode): readonly PaintNode[] => gateBodies.get(paint) ?? [];
/** Everything a gate draws, for culling. */
export const gateBounds = (paint: SceneNode): Rect | undefined => gateBoxes.get(paint);
export const gateCenter = (site: Dungeon): Point => project(f(site.origin.x + 1), f(site.origin.y + 1));

/** Outlines about the gate's centre, in two tones lit from the upper left. */
function tone(objects: SceneNode, c: Point, form: Form, lit: Rgb, shade: Rgb, rim: number): void {
  paintForm(objects, moved(form, c.x, c.y), lit, { ink: 0, rim }, shade);
}
/** Outlines about the gate's centre in one flat colour. */
const plain = (c: Point, form: Form, color: Rgb): ShapeNode => shapeOf(moved(form, c.x, c.y)).fill(...opaque(color));

/** A dome of earth or rock on the ground line `y`. */
const mound = (x: number, y: number, w: number, h: number): Contour =>
  pen(x - w / 2, y)
    .curve([x - w * 0.43, y - h * 0.58], [x - w * 0.22, y - h * 0.93], [x, y - h], [x + w * 0.22, y - h * 0.93], [x + w * 0.43, y - h * 0.58], [x + w / 2, y])
    .curve([x, y + h * 0.16], [x - w / 2, y])
    .close();
/** One of the two stones a doorway stands on: a slab set on end, leaning in by `lean` of its height. */
const jamb = (x: number, y: number, w: number, h: number, lean: number): Contour =>
  pen(x - w / 2, y)
    .curve(
      [x - w * 0.54 + lean * h * 0.5, y - h * 0.5],
      [x - w * 0.42 + lean * h, y - h * 0.96],
      [x + lean * h, y - h],
      [x + w * 0.42 + lean * h, y - h * 0.96],
      [x + w * 0.54 + lean * h * 0.5, y - h * 0.5],
      [x + w / 2, y],
    )
    .curve([x, y + w * 0.14], [x - w / 2, y])
    .close();
/** The stone laid across them: one long boulder, thickest a little left of its middle. */
const lintel = (x: number, y: number, w: number, h: number): Contour =>
  pen(x - w * 0.5, y)
    .curve(
      [x - w * 0.42, y - h * 0.62],
      [x - w * 0.14, y - h],
      [x + w * 0.18, y - h * 0.94],
      [x + w * 0.44, y - h * 0.56],
      [x + w * 0.5, y],
      [x + w * 0.42, y + h * 0.5],
      [x, y + h * 0.62],
      [x - w * 0.42, y + h * 0.5],
      [x - w * 0.5, y],
    )
    .close();
/** The way in: straight-sided below and arched above, standing on the line `y`. */
const way = (x: number, y: number, w: number, h: number): Contour =>
  pen(x - w / 2, y)
    .curve([x - w * 0.5, y - h * 0.62], [x - w * 0.34, y - h * 0.93], [x, y - h], [x + w * 0.34, y - h * 0.93], [x + w * 0.5, y - h * 0.62], [x + w / 2, y])
    .close();
/** A boulder half sunk in the ground: low and uneven, never a ball. */
const boulder = (x: number, y: number, w: number, h: number, lean = 0): Contour =>
  pen(x - w * 0.54, y)
    .curve(
      [x - w * 0.5, y - h * 0.34],
      [x - w * 0.3 + lean * w, y - h * 0.86],
      [x + w * 0.06 + lean * w, y - h],
      [x + w * 0.36 + lean * w, y - h * 0.74],
      [x + w * 0.52, y - h * 0.26],
      [x + w * 0.56, y],
    )
    .curve([x, y + h * 0.14], [x - w * 0.54, y])
    .close();
/** Boulders at the foot of a gate, each `[x, y, width, height, lean]`. */
function boulders(objects: SceneNode, c: Point, at: readonly (readonly [number, number, number, number, number])[]): void {
  tone(objects, c, at.map(([x, y, w, h, lean]) => boulder(x, y, w, h, lean)), stoneLit, stoneShade, 2);
}
/**
 * A rune stone: a broad slab set on end, one shoulder higher than the other, cut with a serpent band that loops
 * inside its edge and turns in on its own tail. `turnTo` (-1 or 1) says which shoulder is the high one.
 */
function runeStone(objects: SceneNode, c: Point, x: number, y: number, w: number, h: number, tilt: number, turnTo: number): void {
  const at = (u: number, v: number): [number, number] => [x + (u * turnTo + tilt * v) * w, y - v * h],
    to = (u: number, v: number): [number, number] => [f(c.x + at(u, v)[0]), f(c.y + at(u, v)[1])];
  tone(
    objects,
    c,
    [
      pen(...at(-0.46, 0))
        .curve(at(-0.56, 0.36), at(-0.5, 0.78), at(-0.3, 0.97), at(0, 1), at(0.32, 0.86), at(0.5, 0.6), at(0.58, 0.32), at(0.48, 0))
        .curve(at(0, -0.05), at(-0.46, 0))
        .close(),
    ],
    stoneLit,
    stoneShade,
    2.5,
  );
  objects.add(
    new ShapeNode()
      .moveTo(...to(-0.2, 0.16))
      .cubicTo(...to(-0.42, 0.34), ...to(-0.4, 0.74), ...to(-0.04, 0.82))
      .cubicTo(...to(0.36, 0.86), ...to(0.4, 0.42), ...to(0.2, 0.2))
      .cubicTo(...to(0.06, 0.06), ...to(-0.1, 0.3), ...to(0.04, 0.42))
      .strokeWidth(f(w * 0.07))
      .strokeCap('round')
      .strokeJoin('round')
      .strokeFill(...mix(stoneLit, [255, 246, 226], f(0.26)), 210),
  );
}
/** A braid cut along a lintel: two bands that cross and cross again between `from` and `to`. */
function braid(objects: SceneNode, c: Point, from: number, to: number, y: number, rise: number): void {
  const turns = 4,
    step = (to - from) / turns;
  for (const first of [-1, 1]) {
    const band = new ShapeNode().moveTo(f(c.x + from), f(c.y + y + rise * first));
    for (let k = 0; k < turns; k++) {
      const x = c.x + from + k * step,
        here = c.y + y + rise * first * (k % 2 ? -1 : 1),
        next = c.y + y - rise * first * (k % 2 ? -1 : 1);
      band.cubicTo(f(x + step * 0.44), f(here), f(x + step * 0.56), f(next), f(x + step), f(next));
    }
    objects.add(band.strokeWidth(1).strokeCap('round').strokeJoin('round').strokeFill(...mix(stoneLit, [255, 246, 226], f(0.24)), 200));
  }
}
/** The door stone and the rune that close a sealed gate for good: Tiwaz over a crossbar, cut into the slab. */
function shutDoor(objects: SceneNode, c: Point, door: Contour, rune: Local, sealed: boolean): void {
  tone(objects, c, [door], slabLit, slabShade, 3);
  if (!sealed) return;
  const x = f(c.x + rune[0]),
    y = f(c.y + rune[1]);
  objects.add(
    new ShapeNode()
      .moveTo(x, f(y + 7))
      .lineTo(x, f(y - 8))
      .moveTo(f(x - 5.5), f(y - 2.5))
      .lineTo(x, f(y - 8))
      .lineTo(f(x + 5.5), f(y - 2.5))
      .moveTo(f(x - 5), f(y + 3))
      .lineTo(f(x + 5), f(y + 3))
      .strokeWidth(1.8)
      .strokeCap('round')
      .strokeJoin('round')
      .strokeFill(...carved, 255),
  );
}
/** Small things at the foot of a gate that tell which world lies behind it, in that world's own light. */
function hint(objects: SceneNode, c: Point, world: World, sealed: boolean): void {
  const spots: Local[] = [
      [-46, 14],
      [40, 16],
      [52, 6],
      [-56, 4],
    ],
    glimpse = worldGlimpse(world),
    dim = mix(glimpse, duskShade, f(0.55)),
    form: Form = [],
    lit = new ShapeNode().fill(...opaque(glimpse)),
    shade = new ShapeNode().fill(...opaque(dim));
  for (const [i, [x, y]] of spots.entries()) {
    const k = 1 - i * 0.12;
    switch (world) {
      case World.Jotunheim:
        // Humps of old ice.
        form.push(boulder(x, y, 8 * k, 11 * k, i % 2 ? 0.08 : -0.08));
        break;
      case World.Niflheim:
        // Low banks of mist.
        form.push(boulder(x, y, 14 * k, 5 * k, 0));
        break;
      case World.Svartalfheim:
        // Lumps of ore.
        form.push(boulder(x, y, 9 * k, 7 * k, i % 2 ? -0.1 : 0.1));
        break;
      case World.Muspelheim:
        // Small flames, each a soft tongue; a sealed gate has none.
        if (sealed) break;
        form.push(
          pen(x - 3 * k, y)
            .curve([x - 3.6 * k, y - 5 * k], [x - 0.6 * k, y - 8 * k], [x + 0.4 * k, y - 12.5 * k], [x + 3.2 * k, y - 6 * k], [x + 3 * k, y])
            .curve([x, y + 1.6 * k], [x - 3 * k, y])
            .close(),
        );
        break;
      case World.Helheim:
        // Low grave mounds.
        form.push(boulder(x, y, 11 * k, 6.5 * k, 0));
        break;
      case World.Asgard:
        // Small slabs of gold-lit stone.
        form.push(boulder(x, y, 6.5 * k, 10 * k, i % 2 ? 0.05 : -0.05));
        break;
      default:
        // Vanaheim and Alfheim: leafy tufts.
        appendBlob(lit, c, [[f(x - 6 * k), y], [f(x - 4 * k), f(y - 7 * k)], [x, f(y - 9 * k)], [f(x + 1), y]]);
        appendBlob(shade, c, [[f(x + 1), y], [f(x + 2), f(y - 8 * k)], [f(x + 6 * k), f(y - 5 * k)], [f(x + 6 * k), y]]);
    }
  }
  if (form.length) tone(objects, c, form, glimpse, dim, 1.6);
  else objects.add(lit).add(shade);
}
/** A cave: a hump of bare rock with moss on its back and a low mouth worn round by the weather. */
function cave(objects: SceneNode, c: Point, look: GateLook): PaintNode | null {
  tone(
    objects,
    c,
    [pen(-58, 14).curve([-55, -14], [-37, -38], [-8, -50], [22, -44], [46, -24], [58, 10]).curve([30, 22], [-30, 22], [-58, 14]).close()],
    stoneLit,
    stoneShade,
    6,
  );
  tone(
    objects,
    c,
    [pen(-38, -33).curve([-23, -45], [-7, -51], [12, -48], [29, -40], [39, -31], [28, -33], [14, -38], [0, -36], [-14, -40], [-28, -33], [-38, -33]).close()],
    turfLit,
    turfShade,
    3,
  );
  const opening = (grow: number): Contour =>
    pen(-22 - grow, 20)
      .curve([-23 - grow, 2], [-16 - grow * 0.6, -12 - grow], [-6, -17 - grow], [5 + grow * 0.6, -12 - grow], [11 + grow, 2], [10 + grow, 20])
      .close();
  objects.add(plain(c, [opening(0)], mouth));
  // In the giants' world rime lies along the lip of the mouth.
  if (look.world === World.Jotunheim)
    objects.add(plain(c, [pen(-20, -7).curve([-13, -17], [-6, -20], [3, -16], [9, -7], [3, -12], [-6, -15], [-14, -12], [-20, -7]).close()], rime));
  boulders(objects, c, [
    [32, 21, 15, 9, 0.05],
    [45, 15, 10, 6, -0.05],
    [-45, 19, 12, 7, 0.04],
  ]);
  hint(objects, c, look.world, look.sealed || !!look.dormant);
  if (look.sealed || look.dormant) {
    shutDoor(objects, c, opening(1), [-6, 3], look.sealed);
    return null;
  }
  const pulse = plain(c, [pen(-16, 20).curve([-17, 6], [-12, -6], [-6, -10], [1, -6], [5, 6], [4, 20]).close()], worldGlimpse(look.world));
  objects.add(pulse);
  return pulse;
}
/** A barrow: a turfed mound with a doorway of three great stones, and a rune stone on either hand. */
function crypt(objects: SceneNode, c: Point, look: GateLook): PaintNode | null {
  tone(objects, c, [mound(0, 18, 120, 48)], turfLit, turfShade, 6);
  objects.add(plain(c, [way(0, 21, 20, 34)], mouth));
  tone(objects, c, [jamb(-13, 22, 9, 35, 0.03), jamb(13, 22, 9, 35, -0.03), lintel(0, -15, 46, 9)], stoneLit, stoneShade, 2.5);
  braid(objects, c, -15, 15, -15.5, 2.2);
  runeStone(objects, c, -43, 17, 19, 27, 0.06, 1);
  runeStone(objects, c, 45, 15, 21, 22, -0.05, -1);
  boulders(objects, c, [
    [-27, 23, 9, 5, 0],
    [29, 23, 10, 6, 0.05],
  ]);
  hint(objects, c, look.world, look.sealed || !!look.dormant);
  if (look.sealed || look.dormant) {
    shutDoor(objects, c, way(0, 21, 21, 35), [0, 6], look.sealed);
    return null;
  }
  const pulse = plain(c, [way(0, 21, 12, 25)], worldGlimpse(look.world));
  objects.add(pulse);
  return pulse;
}
/** A gate standing free in a ring of low stones: two tall slabs and the one laid across them. */
function portal(objects: SceneNode, c: Point, look: GateLook, home: boolean): PaintNode | null {
  const ring = (near: boolean): (readonly [number, number, number, number, number])[] => {
    const out: (readonly [number, number, number, number, number])[] = [];
    for (let i = 0; i < 6; ++i) {
      const a = i * 1.047 + 0.3,
        y = Math.sin(a) * 23;
      if (y >= 0 === near) out.push([Math.cos(a) * 46, y + 3, 11 + (i % 3) * 2, 7 + (i % 2) * 2, i % 2 ? 0.06 : -0.06]);
    }
    return out;
  };
  boulders(objects, c, ring(false));
  objects.add(plain(c, [way(0, 6, 26, 42)], mouth));
  tone(
    objects,
    c,
    [jamb(-17, 7, 10, 47, 0.03), jamb(17, 7, 10, 47, -0.03), lintel(0, -43, 56, 11)],
    home ? [96, 90, 84] : stoneLit,
    stoneShade,
    3,
  );
  braid(objects, c, -18, 18, -43.5, 2.6);
  // The way home has turf lying on its lintel, the green of Midgard.
  if (home)
    tone(
      objects,
      c,
      [pen(-27, -48).curve([-14, -55], [0, -57], [14, -55], [27, -48], [16, -50], [0, -52], [-16, -50], [-27, -48]).close()],
      turfLit,
      turfShade,
      2,
    );
  else hint(objects, c, look.world, look.sealed || !!look.dormant);
  boulders(objects, c, ring(true));
  if (look.sealed || look.dormant) {
    shutDoor(objects, c, way(0, 6, 27, 43), [0, -14], look.sealed);
    return null;
  }
  const glimpse: Rgb = home ? [150, 108, 54] : worldGlimpse(look.world),
    swirl = new SceneNode()
      .add(blob(point(), [[-9, 0], [-8, -14], [0, -22], [8, -14], [9, 0], [0, 4]], glimpse))
      .add(blob(point(), [[-4, -2], [-3, -12], [2, -16], [4, -8], [2, 0]], mix(glimpse, [255, 240, 210], f(0.35))));
  swirl.translate(c.x, f(c.y - 4));
  objects.add(swirl);
  return swirl;
}
/** A ruin: what is left of a great wall, worn down to a rolling top, with a doorway still in it. */
function ruin(objects: SceneNode, c: Point, look: GateLook): PaintNode | null {
  const b = project(f(look.site.origin.x + 1), f(look.site.origin.y + f(1.2))),
    x = f(b.x - c.x),
    y = f(b.y - c.y),
    glimpse = worldGlimpse(look.world);
  tone(
    objects,
    c,
    [
      pen(x - 23, y + 5)
        .curve(
          [x - 24, y - 26],
          [x - 22, y - 51],
          [x - 15, y - 57],
          [x - 8, y - 51],
          [x - 1, y - 55],
          [x + 7, y - 46],
          [x + 15, y - 40],
          [x + 22, y - 37],
          [x + 24, y - 14],
          [x + 23, y + 5],
        )
        .curve([x, y + 9], [x - 23, y + 5])
        .close(),
    ],
    stoneLit,
    stoneShade,
    5,
  );
  // One course of the wall still takes the light of the world behind the door.
  objects.add(
    plain(
      c,
      [
        pen(x - 20, y - 31)
          .curve([x, y - 32.5], [x + 20, y - 31], [x + 21, y - 29.5], [x + 20, y - 28], [x, y - 29.5], [x - 20, y - 28], [x - 21, y - 29.5], [x - 20, y - 31])
          .close(),
      ],
      mix(glimpse, duskShade, f(0.35)),
    ),
  );
  objects.add(plain(c, [way(x - 9, y + 5, 15, 21)], mouth));
  boulders(objects, c, [
    [x + 27, y + 11, 13, 8, 0.05],
    [x + 36, y + 5, 9, 6, -0.05],
    [x - 31, y + 9, 12, 7, 0.04],
    [x + 18, y + 16, 8, 5, 0],
  ]);
  hint(objects, c, look.world, look.sealed || !!look.dormant);
  if (look.sealed || look.dormant) {
    shutDoor(objects, c, way(x - 9, y + 5, 16, 22), [x - 9, y - 5], look.sealed);
    return null;
  }
  const pulse = plain(c, [way(x - 9, y + 5, 9.5, 16)], glimpse);
  objects.add(pulse);
  return pulse;
}
/** The giants' hall: a long low wall under a heavy back of turf, and a door tall enough for them. */
function giantHall(objects: SceneNode, c: Point): PaintNode | null {
  tone(
    objects,
    c,
    [pen(-52, 14).curve([-54, -6], [-49, -19], [-30, -25], [-8, -29], [20, -25], [47, -18], [53, -4], [51, 14]).curve([0, 21], [-52, 14]).close()],
    stoneLit,
    stoneShade,
    5,
  );
  tone(
    objects,
    c,
    [pen(-59, -15).curve([-44, -35], [-15, -47], [20, -43], [57, -22], [44, -17], [18, -22], [-10, -25], [-38, -20], [-59, -15]).close()],
    turfLit,
    turfShade,
    4,
  );
  objects.add(plain(c, [way(-1, 16, 34, 37)], mouth));
  tone(objects, c, [jamb(-19, 17, 8, 35, 0.02), jamb(17, 17, 8, 35, -0.02)], stoneLit, stoneShade, 2.5);
  tone(objects, c, [lintel(-1, -19, 46, 8)], mix(stoneLit, [255, 246, 226], f(0.15)), stoneShade, 2.5);
  // Rime lies on the back of the roof.
  objects.add(
    plain(
      c,
      [
        pen(-46, -27).curve([-36, -36], [-24, -41], [-12, -44], [-22, -38], [-34, -31], [-46, -27]).close(),
        pen(14, -43.5).curve([28, -39], [42, -31], [52, -24], [40, -30], [26, -36], [14, -43.5]).close(),
      ],
      rime,
    ),
  );
  boulders(objects, c, [
    [-46, 19, 14, 9, 0.05],
    [45, 19, 16, 10, -0.05],
  ]);
  return null;
}
/** Draws a gate into `objects`; returns the paint whose opacity the renderer pulses, if any. */
export function gateSprite(objects: SceneNode, lights: SceneNode, look: GateLook): PaintNode | null {
  const c = gateCenter(look.site),
    shadow = blob(c, [[-58, 10], [0, -14], [58, 10], [0, 30]], duskShade, 70);
  objects.add(shadow);
  let pulse: PaintNode | null;
  switch (look.site.kind) {
    case DungeonKind.Cave:
      pulse = cave(objects, c, look);
      break;
    case DungeonKind.Crypt:
      pulse = crypt(objects, c, look);
      break;
    case DungeonKind.Ruin:
      pulse = ruin(objects, c, look);
      break;
    case DungeonKind.GiantHall:
      pulse = giantHall(objects, c);
      break;
    default:
      pulse = portal(objects, c, look, look.site.kind === DungeonKind.Return);
  }
  if (pulse) lights.add(glow(point(c.x, f(c.y - 8)), 64, 32, look.site.kind === DungeonKind.Return ? [240, 170, 90] : worldGlimpse(look.world), 60));
  gateBodies.set(
    objects,
    objects.children.filter((paint) => paint !== pulse && paint !== shadow),
  );
  // No name is drawn here: hovering or selecting a gate shows it, like any other target.
  gateBoxes.set(objects, new Rect(f(c.x - 72), f(c.y - 90), 144, 132));
  return pulse;
}
