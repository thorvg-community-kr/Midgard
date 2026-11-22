import type { Shape } from '@thorvg/webcanvas';
import type { Context } from './context';
import { FrameStyle, type Theme } from './theme';
import { Rect, type Color } from './types';

const f = Math.fround;

/** `a` moved `amount` of the way to `b`, keeping its own opacity. */
export function tone(a: Color, b: Color, amount: number): Color {
  return {
    r: Math.round(a.r + (b.r - a.r) * amount),
    g: Math.round(a.g + (b.g - a.g) * amount),
    b: Math.round(a.b + (b.b - a.b) * amount),
    a: a.a,
  };
}
export const faded = (color: Color, alpha: number): Color => ({ ...color, a: Math.round(alpha) });
/** The plane of a fill that faces the light. */
export const litPlane = (theme: Theme, fill: Color, amount = 0.2): Color => tone(fill, theme.light, amount);
/** The plane of a fill that is turned from the light. */
export const shadePlane = (theme: Theme, fill: Color, amount = 0.46): Color => tone(fill, theme.dusk, amount);

const paintOf = (shape: Shape, color: Color) => shape.fill(color.r, color.g, color.b, color.a);

/** A rectangle with cut corners, the outline every carved piece shares. */
export function cutCorners(shape: Shape, x: number, y: number, w: number, h: number, cut: number): Shape {
  const c = Math.max(0, Math.min(cut, w / 2, h / 2)),
    r = f(x + w),
    b = f(y + h);
  if (c <= 0) return shape.appendRect(x, y, w, h);
  return shape
    .moveTo(f(x + c), y)
    .lineTo(f(r - c), y)
    .lineTo(r, f(y + c))
    .lineTo(r, f(b - c))
    .lineTo(f(r - c), b)
    .lineTo(f(x + c), b)
    .lineTo(x, f(b - c))
    .lineTo(x, f(y + c))
    .close();
}

export interface SlabLook {
  /** Thickness shown under the face, inside the bounds. */
  lip?: number;
  cut?: number;
  /** How far the piece is pushed into its own thickness, 0 to 1. */
  pressed?: number;
  /** Height of the lit strip along the top of the face. */
  bevel?: number;
  lit?: Color;
  edge?: Color;
  /** A line painted just inside the face. */
  trim?: Color;
}

/**
 * A raised piece: a face over its shaded thickness, lit along the top. The face is what `bounds` minus the
 * lip leaves; it is returned so a caller can centre its content on it.
 */
export function slab(c: Context, bounds: Rect, fill: Color, look: SlabLook = {}): Rect {
  const t = c.theme(),
    lip = Math.round(Math.max(0, Math.min(look.lip ?? 3, bounds.h / 3)) * t.depth),
    sink = f(Math.max(0, Math.min(1, look.pressed ?? 0)) * Math.max(0, lip - 1)),
    cut = look.cut ?? 3,
    bevel = f((look.bevel ?? f(1.5)) * t.depth),
    face = new Rect(bounds.x, f(bounds.y + sink), bounds.w, f(bounds.h - lip));
  if (bounds.w <= 0 || bounds.h <= 0) return face;
  const lit = look.lit ?? litPlane(t, fill),
    edge = look.edge ?? shadePlane(t, fill),
    trim = look.trim;
  c.paint(JSON.stringify(['slab', bounds, fill, lip, sink, cut, bevel, lit, edge, trim]), () => {
    const scene = new c.tvg.Scene(),
      add = (shape: Shape) => {
        scene.add(shape);
        shape.dispose();
      };
    if (lip - sink > 0)
      add(
        paintOf(
          cutCorners(new c.tvg.Shape(), bounds.x, f(bounds.y + sink), bounds.w, f(bounds.h - sink), cut),
          edge,
        ),
      );
    add(paintOf(cutCorners(new c.tvg.Shape(), face.x, face.y, face.w, face.h, cut), fill));
    if (bevel > 0 && lit.a > 0 && face.h > bevel * 3) {
      const k = Math.min(bevel, cut || bevel),
        left = f(face.x + (cut > 0 ? cut : 0)),
        right = f(face.x + face.w - (cut > 0 ? cut : 0));
      add(
        paintOf(
          new c.tvg.Shape()
            .moveTo(left, face.y)
            .lineTo(right, face.y)
            .lineTo(f(right + (cut > 0 ? k : 0)), f(face.y + bevel))
            .lineTo(f(left - (cut > 0 ? k : 0)), f(face.y + bevel))
            .close(),
          lit,
        ),
      );
    }
    if (trim && trim.a > 0 && face.w > 16 && face.h > 16) {
      const inset = 3.5,
        line = cutCorners(
          new c.tvg.Shape(),
          f(face.x + inset),
          f(face.y + inset),
          f(face.w - inset * 2),
          f(face.h - inset * 2),
          Math.max(0, cut - 1.5),
        );
      line.fill(0, 0, 0, 0).stroke({ width: 1, color: [trim.r, trim.g, trim.b, trim.a] });
      add(line);
    }
    return scene;
  });
  return face;
}

export interface BoardLook {
  /** Height of a title band across the top. */
  header?: number;
  /** Replaces the painted trim, to mark a state such as danger. */
  trim?: Color;
  trimWidth?: number;
  fill?: Color;
  /** A board that lies on another board casts no shadow and has no thickness. */
  flat?: boolean;
  cut?: number;
}

/**
 * A floating panel. Its face is exactly `bounds`, so layouts are untouched: the thickness and the hard
 * shadow hang below it.
 */
export function board(c: Context, bounds: Rect, look: BoardLook = {}): void {
  if (bounds.w <= 0 || bounds.h <= 0) return;
  const t = c.theme(),
    fill = look.fill ?? { ...t.surface, a: 255 };
  if (t.frameStyle !== FrameStyle.Carved) {
    c.rect(bounds, fill, t.radius, look.trim ?? t.border, look.trimWidth ?? 1);
    return;
  }
  const small = bounds.h < 30 || bounds.w < 30,
    cut = look.cut ?? (small ? 4 : 6),
    lip = look.flat ? 0 : Math.round((small ? 3 : 4) * t.depth),
    drop = look.flat ? 0 : Math.round((small ? 3 : 5) * t.depth),
    trim = look.trim ?? t.border,
    width = look.trimWidth ?? 1,
    header = Math.max(0, Math.min(look.header ?? 0, bounds.h)),
    lit = litPlane(t, fill, 0.24),
    edge = shadePlane(t, fill, 0.5),
    shadow = t.shadow;
  c.paint(JSON.stringify(['board', bounds, fill, cut, lip, drop, trim, width, header, lit, edge, shadow, t.depth]), () => {
    const scene = new c.tvg.Scene(),
      add = (shape: Shape) => {
        scene.add(shape);
        shape.dispose();
      },
      { x, y, w, h } = bounds;
    if (drop > 0 && shadow.a > 0)
      add(paintOf(cutCorners(new c.tvg.Shape(), x, f(y + lip + drop), w, h, cut), shadow));
    if (lip > 0) add(paintOf(cutCorners(new c.tvg.Shape(), x, f(y + lip), w, h, cut), edge));
    add(paintOf(cutCorners(new c.tvg.Shape(), x, y, w, h, cut), fill));
    if (header > cut) for (const piece of bandShapes(c, t, bounds, header, cut, fill, false)) add(piece);
    if (t.depth > 0)
      add(
        paintOf(
          new c.tvg.Shape()
            .moveTo(f(x + cut), y)
            .lineTo(f(x + w - cut), y)
            .lineTo(f(x + w - cut + 2), f(y + 2))
            .lineTo(f(x + cut - 2), f(y + 2))
            .close(),
          lit,
        ),
      );
    if (trim.a > 0 && w > 24 && h > 24) {
      const inset = small ? 3 : 4,
        line = cutCorners(
          new c.tvg.Shape(),
          f(x + inset),
          f(y + inset),
          f(w - inset * 2),
          f(h - inset * 2),
          Math.max(0, cut - 2),
        );
      line.fill(0, 0, 0, 0).stroke({ width, color: [trim.r, trim.g, trim.b, trim.a] });
      add(line);
    }
    return scene;
  });
}

/** The title band of a board: a lighter plane that keeps the cut top corners and ends on a carved groove. */
function bandShapes(
  c: Context,
  t: Theme,
  bounds: Rect,
  height: number,
  cut: number,
  fill: Color,
  teeth: boolean,
): Shape[] {
  const { x, y, w } = bounds,
    dark = shadePlane(t, fill, 0.4),
    shapes = [
      paintOf(
        new c.tvg.Shape()
          .moveTo(f(x + cut), y)
          .lineTo(f(x + w - cut), y)
          .lineTo(f(x + w), f(y + cut))
          .lineTo(f(x + w), f(y + height))
          .lineTo(x, f(y + height))
          .lineTo(x, f(y + cut))
          .close(),
        litPlane(t, fill, 0.09),
      ),
      paintOf(new c.tvg.Shape().appendRect(x, f(y + height), w, 1.5), dark),
      paintOf(new c.tvg.Shape().appendRect(x, f(y + height + 1.5), w, 1), litPlane(t, fill, 0.1)),
    ];
  if (teeth) {
    // A dog-tooth frieze hangs from the groove.
    const row = new c.tvg.Shape(),
      step = 10,
      count = Math.floor((w - 16) / step),
      left = f(x + (w - count * step) / 2),
      top = f(y + height + 2.5);
    for (let i = 0; i < count; i++)
      row
        .moveTo(f(left + i * step + 1), top)
        .lineTo(f(left + i * step + step - 1), top)
        .lineTo(f(left + i * step + step / 2), f(top + 4))
        .close();
    shapes.push(paintOf(row, dark));
  }
  return shapes;
}
/** A title band laid on a board that is already drawn, for a window that fills a board of its own size. */
export function band(c: Context, bounds: Rect, height: number, teeth = false): void {
  const t = c.theme();
  if (t.frameStyle !== FrameStyle.Carved || height <= 0 || bounds.w <= 0) return;
  const fill = { ...t.surface, a: 255 };
  c.paint(JSON.stringify(['band', bounds.x, bounds.y, bounds.w, height, teeth, fill]), () => {
    const scene = new c.tvg.Scene();
    for (const piece of bandShapes(c, t, bounds, height, 6, fill, teeth)) {
      scene.add(piece);
      piece.dispose();
    }
    return scene;
  });
}

export interface WellLook {
  cut?: number;
  /** Outline for a marked well, such as a chosen slot. */
  rim?: Color;
  rimWidth?: number;
}

/** A recess in a board: a darker floor under the shadow of its upper wall. */
export function well(c: Context, bounds: Rect, fill?: Color, look: WellLook = {}): void {
  if (bounds.w <= 0 || bounds.h <= 0) return;
  const t = c.theme(),
    floor = fill ?? t.well;
  if (t.frameStyle !== FrameStyle.Carved) {
    c.rect(bounds, floor, t.radius, look.rim ?? { r: 0, g: 0, b: 0, a: 0 }, look.rimWidth ?? 1);
    return;
  }
  const cut = look.cut ?? (Math.min(bounds.w, bounds.h) < 14 ? 1 : 3),
    wall = shadePlane(t, floor, 0.42),
    sill = faded(t.light, 26),
    rim = look.rim,
    width = look.rimWidth ?? 1,
    deep = bounds.h >= 12 && t.depth > 0;
  c.paint(JSON.stringify(['well', bounds, floor, cut, wall, sill, rim, width, deep]), () => {
    const scene = new c.tvg.Scene(),
      add = (shape: Shape) => {
        scene.add(shape);
        shape.dispose();
      },
      { x, y, w, h } = bounds,
      body = cutCorners(new c.tvg.Shape(), x, y, w, h, cut);
    paintOf(body, floor);
    if (rim && rim.a > 0) body.stroke({ width, color: [rim.r, rim.g, rim.b, rim.a] });
    add(body);
    if (deep) {
      add(
        paintOf(
          new c.tvg.Shape()
            .moveTo(f(x + cut), y)
            .lineTo(f(x + w - cut), y)
            .lineTo(f(x + w - cut + 2), f(y + 2))
            .lineTo(f(x + cut - 2), f(y + 2))
            .close(),
          wall,
        ),
      );
      add(paintOf(new c.tvg.Shape().appendRect(f(x + cut), f(y + h - 1), f(w - cut * 2), 1), sill));
    }
    return scene;
  });
}

/** A bar in a recessed track; the fill is two flat planes. */
export function meter(c: Context, bounds: Rect, share: number, color: Color, track?: Color): void {
  if (bounds.w <= 0 || bounds.h <= 0) return;
  const t = c.theme(),
    amount = Math.max(0, Math.min(1, share)),
    floor = track ?? t.well;
  if (t.frameStyle !== FrameStyle.Carved) {
    c.rect(bounds, floor, bounds.h / 2);
    if (amount > 0) c.rect(new Rect(bounds.x, bounds.y, Math.max(bounds.h, f(bounds.w * amount)), bounds.h), color, bounds.h / 2);
    return;
  }
  const lit = litPlane(t, color, 0.32),
    width = amount <= 0 ? 0 : Math.max(Math.min(bounds.w, 2), f(bounds.w * amount)),
    cut = bounds.h >= 6 ? 1 : 0;
  c.paint(JSON.stringify(['meter', bounds, width, color, floor, lit, cut]), () => {
    const scene = new c.tvg.Scene(),
      add = (shape: Shape) => {
        scene.add(shape);
        shape.dispose();
      },
      { x, y, w, h } = bounds;
    add(paintOf(cutCorners(new c.tvg.Shape(), x, y, w, h, cut), floor));
    if (width > 0) {
      add(paintOf(cutCorners(new c.tvg.Shape(), x, y, width, h, cut), color));
      if (h >= 4)
        add(
          paintOf(
            new c.tvg.Shape().appendRect(f(x + cut), y, Math.max(0, f(width - cut * 2)), Math.max(1, f(h * 0.34))),
            lit,
          ),
        );
    }
    return scene;
  });
}

/** A paper tag for a tooltip or a note; its writing uses the theme's ink. */
export function tag(c: Context, bounds: Rect, look: { fill?: Color; cut?: number; lip?: number } = {}): void {
  if (bounds.w <= 0 || bounds.h <= 0) return;
  const t = c.theme(),
    fill = look.fill ?? t.paper;
  if (t.frameStyle !== FrameStyle.Carved) {
    c.rect(bounds, fill, 3, t.border);
    return;
  }
  const cut = look.cut ?? 3,
    lip = Math.round((look.lip ?? 2) * t.depth),
    edge = shadePlane(t, fill, 0.36),
    shadow = t.shadow;
  c.paint(JSON.stringify(['tag', bounds, fill, cut, lip, edge, shadow]), () => {
    const scene = new c.tvg.Scene(),
      add = (shape: Shape) => {
        scene.add(shape);
        shape.dispose();
      },
      { x, y, w, h } = bounds;
    if (lip > 0) {
      add(paintOf(cutCorners(new c.tvg.Shape(), x, f(y + lip + 2), w, h, cut), shadow));
      add(paintOf(cutCorners(new c.tvg.Shape(), x, f(y + lip), w, h, cut), edge));
    }
    add(paintOf(cutCorners(new c.tvg.Shape(), x, y, w, h, cut), fill));
    return scene;
  });
}

/** A carved groove across a board, with a small stud at its middle when there is room. */
export function groove(c: Context, x: number, y: number, w: number, stud = false): void {
  if (w <= 0) return;
  const t = c.theme(),
    dark = shadePlane(t, t.surface, 0.42),
    light = litPlane(t, t.surface, 0.12),
    mark = t.border;
  c.paint(JSON.stringify(['groove', x, y, w, stud, dark, light, mark]), () => {
    const scene = new c.tvg.Scene(),
      add = (shape: Shape) => {
        scene.add(shape);
        shape.dispose();
      };
    add(paintOf(new c.tvg.Shape().appendRect(x, y, w, 1.5), dark));
    add(paintOf(new c.tvg.Shape().appendRect(x, f(y + 1.5), w, 1), light));
    if (stud && w > 60) {
      const cx = f(x + w / 2),
        cy = f(y + 1.25);
      add(
        paintOf(
          new c.tvg.Shape()
            .moveTo(cx, f(cy - 4))
            .lineTo(f(cx + 4), cy)
            .lineTo(cx, f(cy + 4))
            .lineTo(f(cx - 4), cy)
            .close(),
          { ...mark, a: 255 },
        ),
      );
    }
    return scene;
  });
}

/** A raised frame round a picture; the picture is drawn over `bounds` afterwards. */
export function frame(c: Context, bounds: Rect, tint?: Color): void {
  if (bounds.w <= 0 || bounds.h <= 0) return;
  const t = c.theme();
  if (t.frameStyle !== FrameStyle.Carved) {
    c.rect(bounds, t.raised, t.radius, tint ?? t.border);
    return;
  }
  const wood = tint ?? tone({ ...t.border, a: 255 }, t.surface, 0.3),
    lit = litPlane(t, wood, 0.3),
    edge = shadePlane(t, wood, 0.5),
    floor = t.well;
  c.paint(JSON.stringify(['frame', bounds, wood, lit, edge, floor]), () => {
    const scene = new c.tvg.Scene(),
      add = (shape: Shape) => {
        scene.add(shape);
        shape.dispose();
      },
      { x, y, w, h } = bounds;
    add(paintOf(cutCorners(new c.tvg.Shape(), f(x - 2), f(y - 2), f(w + 4), f(h + 6), 3), edge));
    add(paintOf(cutCorners(new c.tvg.Shape(), f(x - 2), f(y - 2), f(w + 4), f(h + 4), 3), wood));
    add(paintOf(new c.tvg.Shape().appendRect(f(x + 1), f(y - 2), f(w - 2), 1.5), lit));
    add(paintOf(new c.tvg.Shape().appendRect(x, y, w, h), floor));
    return scene;
  });
}
