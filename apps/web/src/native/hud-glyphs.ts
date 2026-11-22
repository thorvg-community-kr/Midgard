// The command glyphs: solid silhouettes cut from one flat colour, like everything in the world. No hairlines.
import type { Shape } from '@thorvg/webcanvas';
import type { Color, Context } from '../../../../packages/native-ui/src';

export type HudGlyph =
  | 'build'
  | 'unit'
  | 'move'
  | 'attack'
  | 'work'
  | 'hold'
  | 'stop'
  | 'close'
  | 'bag'
  | 'gear'
  | 'craft'
  | 'back'
  | 'next'
  | 'rotate'
  | 'roads'
  | 'housing'
  | 'materials'
  | 'storage'
  | 'trade'
  | 'lodging'
  | 'faith'
  | 'quest'
  | 'cog';

/** Draws inside a 24 px box centred on the origin; the caller places and tints it. */
class Pen {
  constructor(readonly shape: Shape) {}
  /** Every outline is wound the same way, so overlapping pieces join instead of cutting holes. */
  poly(...points: number[]): this {
    let area = 0;
    for (let i = 0; i < points.length; i += 2) {
      const j = (i + 2) % points.length;
      area += points[i] * points[j + 1] - points[j] * points[i + 1];
    }
    const count = points.length / 2,
      at = (n: number) => (area < 0 ? count - 1 - n : n) * 2;
    this.shape.moveTo(points[at(0)], points[at(0) + 1]);
    for (let n = 1; n < count; ++n) this.shape.lineTo(points[at(n)], points[at(n) + 1]);
    this.shape.close();
    return this;
  }
  box(x: number, y: number, w: number, h: number): this {
    this.shape.appendRect(x, y, w, h);
    return this;
  }
  disc(x: number, y: number, r: number): this {
    this.shape.appendCircle(x, y, r, r);
    return this;
  }
  /** A straight bar from a to b, `half` wide either side. */
  bar(ax: number, ay: number, bx: number, by: number, half: number): this {
    const length = Math.hypot(bx - ax, by - ay) || 1,
      px = (-(by - ay) / length) * half,
      py = ((bx - ax) / length) * half;
    return this.poly(ax + px, ay + py, bx + px, by + py, bx - px, by - py, ax - px, ay - py);
  }
}
function hammer(pen: Pen, dx = 0, dy = 0, k = 1): void {
  pen.bar(dx - 8 * k, dy + 9 * k, dx + 3 * k, dy - 2 * k, 1.7 * k);
  pen.poly(
    dx + 2.1 * k,
    dy - 8.9 * k,
    dx + 9.9 * k,
    dy - 1.1 * k,
    dx + 5.9 * k,
    dy + 2.9 * k,
    dx - 1.9 * k,
    dy - 4.9 * k,
  );
}
function sword(pen: Pen, side: number): void {
  const d = 0.7071,
    at = (along: number, across: number): [number, number] => [side * (along * d + across * d), -along * d + across * d];
  pen.poly(...at(-3.5, -1.5), ...at(8.5, -1.5), ...at(12, 0), ...at(8.5, 1.5), ...at(-3.5, 1.5));
  pen.poly(...at(-5.2, -4.6), ...at(-3.4, -4.6), ...at(-3.4, 4.6), ...at(-5.2, 4.6));
  pen.poly(...at(-9.5, -1.1), ...at(-5.2, -1.1), ...at(-5.2, 1.1), ...at(-9.5, 1.1));
  pen.poly(...at(-11.6, -1.7), ...at(-9.5, -1.7), ...at(-9.5, 1.7), ...at(-11.6, 1.7));
}
const figures: Record<Exclude<HudGlyph, 'rotate' | 'hold'>, (pen: Pen) => void> = {
  build: (pen) => hammer(pen),
  // An axe: what felling, mining and tending have in common is a tool swung at something.
  work: (pen) => {
    pen.bar(-7, 9.5, 2.6, -8.4, 1.6);
    pen.poly(1.6, -9.4, 9.6, -7.2, 10.6, 0.2, 5.2, -3, 3.6, -5.4);
  },
  craft: (pen) => {
    hammer(pen, 0.5, -3.5, 0.72);
    pen.box(-9, 4.5, 18, 2.6).box(-3, 7.1, 6, 1.6).box(-6.5, 8.7, 13, 2);
  },
  unit: (pen) => {
    pen.disc(0, -5.6, 3.5);
    pen.poly(-8.5, 9.5, -8.5, 5.2, -5, 0.6, 5, 0.6, 8.5, 5.2, 8.5, 9.5);
  },
  // A pennant planted where they are to go.
  move: (pen) => {
    pen.box(-6.6, -9.6, 2.4, 19.2);
    pen.poly(-4.2, -9.2, 8.8, -4.8, -4.2, -0.4);
    pen.box(-9.6, 7.8, 8.4, 2.2);
  },
  attack: (pen) => {
    sword(pen, 1);
    sword(pen, -1);
  },
  stop: (pen) => pen.poly(-4, -6, 4, -6, 6, -4, 6, 4, 4, 6, -4, 6, -6, 4, -6, -4),
  close: (pen) => {
    pen.bar(-6, -6, 6, 6, 1.6);
    pen.bar(6, -6, -6, 6, 1.6);
  },
  bag: (pen) => {
    pen.poly(-8, 9.5, -8, -1.5, -5, -4.8, 5, -4.8, 8, -1.5, 8, 9.5);
    pen.box(-4.2, -9.8, 2, 5).box(2.2, -9.8, 2, 5).box(-4.2, -9.8, 8.4, 2);
  },
  // A helmet with its nasal: what a resident wears and carries.
  gear: (pen) => {
    pen.poly(-7.5, 2, -7.5, -2.6, -4.8, -7.2, 0, -9.4, 4.8, -7.2, 7.5, -2.6, 7.5, 2);
    pen.box(-1.2, 2, 2.4, 6.4);
    pen.poly(-7.5, 3.4, -3.6, 3.4, -3.6, 8.2, -7.5, 6);
    pen.poly(7.5, 3.4, 3.6, 3.4, 3.6, 8.2, 7.5, 6);
  },
  back: (pen) => pen.poly(9, -2.4, -1, -2.4, -1, -7.4, -10, 0, -1, 7.4, -1, 2.4, 9, 2.4),
  next: (pen) => pen.poly(-4.4, -7, -0.6, -7, 6, 0, -0.6, 7, -4.4, 7, 2.2, 0),
  roads: (pen) => {
    pen.poly(-9.6, 9.5, -5, -9.5, -2.8, -9.5, -6, 9.5);
    pen.poly(9.6, 9.5, 5, -9.5, 2.8, -9.5, 6, 9.5);
    pen.box(-1, -7.5, 2, 3.6).box(-1, -1.5, 2, 3.6).box(-1, 4.5, 2, 3.6);
  },
  housing: (pen) => {
    pen.poly(-10.5, -0.6, 0, -10, 10.5, -0.6);
    pen.box(-7.4, 0.8, 5.2, 8.7).box(2.2, 0.8, 5.2, 8.7).box(-2.2, 0.8, 4.4, 2.6);
  },
  materials: (pen) => {
    pen.box(-5.4, -9.5, 1.8, 19);
    for (const top of [-8.5, -3.5, 1.5]) {
      pen.poly(-4.5, top + 4.2, -9.6, top + 0.4, -9, top - 1.6, -4.5, top + 1.2);
      pen.poly(-4.5, top + 4.2, 0.6, top + 0.4, 0, top - 1.6, -4.5, top + 1.2);
    }
    pen.poly(2.6, 9.5, 2, 3.4, 6.2, -0.6, 10.2, 3.8, 9.4, 9.5);
  },
  // A chest: its lid stands a hair off the box.
  storage: (pen) => {
    pen.poly(-8.8, -3.6, -6.6, -8.8, 6.6, -8.8, 8.8, -3.6);
    pen.box(-8.8, -2, 7.2, 11.2).box(1.6, -2, 7.2, 11.2).box(-1.6, 2.2, 3.2, 7);
  },
  trade: (pen) => {
    pen.poly(-10.4, -2.2, -8.2, -8.8, 8.2, -8.8, 10.4, -2.2);
    pen.box(-8.4, -0.6, 2.2, 10.1).box(6.2, -0.6, 2.2, 10.1).box(-6.2, 3.4, 12.4, 2.4);
  },
  lodging: (pen) => {
    pen.box(-9.8, -7.5, 2.4, 17);
    pen.box(-7.4, 1, 17.2, 3.8);
    pen.box(7.4, -1.4, 2.4, 10.9);
    pen.poly(-6.6, 0, -6.6, -3.2, -5, -4.4, -1.6, -4.4, -0.6, -3.2, -0.6, 0);
  },
  faith: (pen) => {
    pen.poly(0, -10.4, 5.4, -4, 0, 2.4, -5.4, -4);
    pen.box(-7, 4.4, 14, 2.4).box(-5.2, 6.8, 2.6, 2.8).box(2.6, 6.8, 2.6, 2.8);
  },
  // A sealed scroll: something asked of the settlement.
  quest: (pen) => pen.poly(0, -9, 8, 0, 0, 9, -8, 0),
  cog: (pen) => {
    for (let i = 0; i < 8; ++i) {
      const a = (i * Math.PI) / 4,
        x = Math.cos(a),
        y = Math.sin(a);
      pen.poly(x * 9.6 - y * 2, y * 9.6 + x * 2, x * 9.6 + y * 2, y * 9.6 - x * 2, x * 5 + y * 2.6, y * 5 - x * 2.6, x * 5 - y * 2.6, y * 5 + x * 2.6);
    }
    pen.disc(0, 0, 6.6);
  },
};
/**
 * A glyph centred on (x, y) at `scale` (1 fills a 24 px box). `under` is the colour it lies on, for the
 * glyphs that have a piece cut out of them.
 */
export function hudGlyph(
  c: Context,
  glyph: HudGlyph,
  x: number,
  y: number,
  color: Color,
  scale = 1,
  under?: Color,
): void {
  c.paint(JSON.stringify(['glyph', glyph, x, y, color, scale, under]), () => {
    const scene = new c.tvg.Scene(),
      shape = new c.tvg.Shape(),
      ink = [color.r, color.g, color.b, color.a] as [number, number, number, number];
    if (glyph === 'rotate') {
      shape
        .moveTo(6.6, -3.4)
        .cubicTo(3, -11, -9.4, -7.6, -8, 1.6)
        .cubicTo(-6.4, 9.6, 5.4, 10.2, 7.8, 3)
        .fill(0, 0, 0, 0)
        .stroke({ width: 2.6, color: ink, cap: c.tvg.StrokeCap.Butt });
      const head = new c.tvg.Shape().moveTo(9.8, -9.6).lineTo(9.8, -0.8).lineTo(1, -0.8).close().fill(...ink);
      scene.add(head);
      head.dispose();
    } else if (glyph === 'hold') {
      // A round shield: its rim and its boss.
      shape.appendCircle(0, 0, 8, 8).fill(0, 0, 0, 0).stroke({ width: 2.8, color: ink });
      const boss = new c.tvg.Shape().appendCircle(0, 0, 3, 3).fill(...ink);
      scene.add(boss);
      boss.dispose();
    } else {
      figures[glyph](new Pen(shape));
      shape.fill(...ink);
    }
    scene.add(shape);
    shape.dispose();
    if (under && (glyph === 'cog' || glyph === 'quest')) {
      // The hub of the cog and the heart of the mark are cut out.
      const cut = new c.tvg.Shape();
      if (glyph === 'cog') cut.appendCircle(0, 0, 2.8, 2.8);
      else cut.moveTo(0, -4.2).lineTo(3.8, 0).lineTo(0, 4.2).lineTo(-3.8, 0).close();
      cut.fill(under.r, under.g, under.b, under.a);
      scene.add(cut);
      cut.dispose();
    }
    scene.transform({ e11: scale, e12: 0, e13: x, e21: 0, e22: scale, e23: y, e31: 0, e32: 0, e33: 1 });
    return scene;
  });
}
