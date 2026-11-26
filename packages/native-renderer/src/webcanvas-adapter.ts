import type {
  Paint,
  Shape,
  Scene,
  Text,
  Picture,
  Animation,
  Accessor,
  ThorVGNamespace,
} from '@thorvg/webcanvas';
import type { Rings } from './outline-rings';
import {
  PaintNode,
  ShapeNode,
  SceneNode,
  StaticShapeLayer,
  TextNode,
  PictureNode,
  AnimationNode,
  SvgPictureNode,
  type Blend,
  type Matrix,
  type Gradient,
  type Rgba,
  type Shade,
  identity,
  evenShade,
  shadeWithin,
} from './paint';
interface Entry {
  paint: Paint;
  version: number;
  animation?: Animation;
  dataVersion?: number;
  childPaints?: Paint[];
  pathVersion?: number;
  styleVersion?: number;
  gradient?: Gradient;
  matrix?: Matrix;
  opacity?: number;
  blending?: Blend;
  children?: PaintNode[];
  clipper?: PaintNode;
  masking?: PaintNode;
  maskMethod?: 'alpha' | 'inverseAlpha';
  hitShapes?: { version: number; paints: Paint[] };
  /** The shade its colours were last sent with, and the one laid over it whole. */
  shade?: Shade;
  effect?: Shade;
}
const toned = (color: Rgba, shade?: Shade): Rgba => {
  if (!shade) return color;
  const k = shade.strength / 255,
    mix = (from: number, to: number) => Math.round(from + (to - from) * k);
  return [mix(color[0], shade.tone[0]), mix(color[1], shade.tone[1]), mix(color[2], shade.tone[2]), color[3]];
};
/** Where a rise eases from its foot to its top, as shares of its height and of the way: smooth at both ends. */
const riseSteps = [0, 1 / 3, 2 / 3, 1].map((t) => ({ t, w: t * t * (3 - 2 * t) }));
/** The colour of a gradient at `offset`, held at its ends. */
function colourAt(stops: readonly { offset: number; color: Rgba }[], offset: number): Rgba {
  if (offset <= stops[0].offset) return stops[0].color;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1],
      b = stops[i];
    if (offset > b.offset) continue;
    const k = b.offset > a.offset ? (offset - a.offset) / (b.offset - a.offset) : 1;
    return [0, 1, 2, 3].map((c) => Math.round(a.color[c] + (b.color[c] - a.color[c]) * k)) as unknown as Rgba;
  }
  return stops[stops.length - 1].color;
}
function matrix(value: Matrix) {
  return {
    e11: value[0],
    e12: value[1],
    e13: value[2],
    e21: value[3],
    e22: value[4],
    e23: value[5],
    e31: value[6],
    e32: value[7],
    e33: value[8],
  };
}
let rasterGeneration = 0;
/** A restored WebGL context cannot reuse textures uploaded by the lost context. */
export function invalidateWebCanvasRasterResources(): void {
  rasterGeneration++;
}
/** Mechanical native-paint API adaptation; it does not invent rendering geometry or style. */
export class WebCanvasAdapter {
  private entries = new Map<PaintNode, Entry>();
  private lastSweepSize = 0;
  private parents = new WeakMap<Paint, Entry>();
  private ringPairs: number[][] = [];
  private rasterGeneration = rasterGeneration;
  private hitAccessor?: Accessor;
  constructor(readonly tvg: ThorVGNamespace) {}
  /** `shade` is what a scene above asks of the colours below it; a scene's own shade takes its place. */
  sync(node: PaintNode, shade?: Shade): Paint {
    if (this.rasterGeneration !== rasterGeneration) {
      this.rasterGeneration = rasterGeneration;
      for (const [paint, entry] of this.entries)
        if (paint instanceof PictureNode) entry.dataVersion = undefined;
    }
    let entry = this.entries.get(node);
    if (!entry) {
      let animation: Animation | undefined;
      let paint: Paint;
      if (node instanceof AnimationNode) {
        animation = new this.tvg.Animation().load(node.json);
        if (!animation.picture) {
          animation.dispose();
          throw new Error('Cannot load native building animation.');
        }
        paint = animation.picture;
      } else if (node instanceof SvgPictureNode)
        paint = new this.tvg.Picture().load(node.svg, { type: 'svg' });
      else if (node instanceof PictureNode) paint = this.rawPicture(node);
      else
        paint =
          node instanceof ShapeNode
            ? new this.tvg.Shape()
            : node instanceof SceneNode
              ? new this.tvg.Scene()
              : new this.tvg.Text();
      entry = {
        paint,
        animation,
        version: -1,
        dataVersion: node instanceof PictureNode ? node.dataVersion : undefined,
      };
      this.entries.set(node, entry);
    }
    if (node instanceof PictureNode && entry.dataVersion !== node.dataVersion) {
      // WebCanvas's public raw loader copies its pixels. Detach the old picture
      // before replacing it, so its clip/mask targets can be rebound safely.
      const replacement = this.rawPicture(node);
      const parent = this.parents.get(entry.paint);
      if (parent) {
        (parent.paint as Scene).remove(entry.paint);
        parent.children = undefined;
        this.parents.delete(entry.paint);
      }
      entry.paint.dispose();
      entry.paint = replacement;
      entry.dataVersion = node.dataVersion;
      entry.version = -1;
      entry.matrix = undefined;
      entry.opacity = undefined;
      entry.blending = undefined;
      entry.clipper = undefined;
      entry.masking = undefined;
      entry.maskMethod = undefined;
    }
    if (node instanceof SceneNode) {
      // Detached children invalidate entry.children. A changed shade must reach the vector fills.
      if (node instanceof StaticShapeLayer && entry.children && entry.version === node.version &&
          entry.shade === shade && !node.clipper && !node.masking)
        return entry.paint;
      // A fully transparent child is switched off: not attached natively, nor even visited,
      // until it shows again. Most of a figure is tools and loads it is not holding.
      let visible = 0, reordered = !entry.children;
      for (const child of node.children)
        if (child.alpha !== 0) {
          if (child !== entry.children?.[visible]) reordered = true;
          visible++;
        }
      if (visible !== entry.children?.length) reordered = true;
      // Reuse the retained list while only poses change; a figure has many scenes with hidden tools.
      const shown = reordered ? node.children.filter((child) => child.alpha !== 0) : entry.children!;
      // Empty a changed scene BEFORE its children are synced. ThorVG traps ("null
      // function") when an attached scene is cleared while a nested scene already
      // holds paints it has never prepared, which is what syncing the children first
      // produced whenever a kept layer received new shapes in the same pass.
      if (reordered && entry.childPaints?.length && entry.paint instanceof this.tvg.Scene) {
        for (const previous of entry.childPaints)
          if (this.parents.get(previous) === entry) this.parents.delete(previous);
        entry.paint.clear();
        entry.children = undefined;
        entry.childPaints = [];
      }
      const below = node.shade ? (node.shade.whole ? undefined : node.shade) : shade;
      let children: Paint[] | undefined;
      for (let i = 0; i < shown.length; i++) {
        const child = shown[i],
          paint = this.sync(child, child instanceof SceneNode ? shadeWithin(below, child.matrix) : below);
        if (paint !== entry.childPaints?.[i]) {
          children ??= [...(entry.childPaints ?? [])];
          children[i] = paint;
        }
      }
      if (
        (reordered || !entry.children || children) &&
        entry.paint instanceof this.tvg.Scene
      ) {
        for (const previous of entry.childPaints ?? [])
          if (this.parents.get(previous) === entry) this.parents.delete(previous);
        entry.paint.clear();
        const paints = children ?? entry.childPaints ?? [];
        for (const child of paints) {
          // Native detach happens immediately; the retained TS tree reconciles at
          // frame end. Detach a reused figure from its previous native row first.
          const previous = this.parents.get(child);
          if (previous && previous !== entry) {
            (previous.paint as Scene).remove(child);
            previous.children = undefined;
          }
          entry.paint.add(child);
          this.parents.set(child, entry);
        }
        entry.children = shown;
        entry.childPaints = paints;
      }
    }
    if (node.clipper) this.sync(node.clipper);
    if (node.masking) this.sync(node.masking.paint);
    if (entry.version === node.version && entry.shade === shade) return entry.paint;
    if (node instanceof AnimationNode) entry.animation!.frame(node.currentFrame);
    if (
      (node instanceof PictureNode || node instanceof SvgPictureNode) &&
      node.displayWidth !== undefined &&
      node.displayHeight !== undefined
    )
      (entry.paint as Picture).size(node.displayWidth, node.displayHeight);
    if (node instanceof ShapeNode) {
      // Only a changed outline or style is sent again; a moved or faded shape keeps both.
      const path = entry.pathVersion !== node.pathVersion,
        recolour = entry.shade !== shade;
      if (entry.paint instanceof this.tvg.Shape && (path || recolour || entry.styleVersion !== node.styleVersion))
        this.shape(entry.paint, node, path, entry, shade, recolour);
      entry.pathVersion = node.pathVersion;
      entry.styleVersion = node.styleVersion;
    }
    entry.shade = shade;
    if (node instanceof SceneNode && entry.paint instanceof this.tvg.Scene) {
      const whole = node.shade?.whole ? node.shade : undefined;
      if (whole !== entry.effect) {
        entry.paint.resetEffects();
        // Black and white alike: every colour moves toward the one tone, as a recoloured shape does.
        if (whole) entry.paint.tint(...whole.tone, ...whole.tone, Math.round((whole.strength / 255) * 100));
        entry.effect = whole;
      }
    }
    if (node instanceof TextNode && entry.paint instanceof this.tvg.Text) this.text(entry.paint, node);
    const previousMatrix = entry.matrix ?? identity;
    if (node.matrix.some((value, i) => value !== previousMatrix[i]))
      entry.paint.transform(matrix(node.matrix));
    entry.matrix = node.matrix;
    const alpha = node instanceof TextNode ? Math.trunc((node.alpha * node.color[3]) / 255) : node.alpha;
    if (alpha !== (entry.opacity ?? 255)) entry.paint.opacity(alpha);
    entry.opacity = alpha;
    if (node.blending !== (entry.blending ?? 'normal')) entry.paint.blend(this.blend(node.blending));
    entry.blending = node.blending;
    if (node.clipper && entry.clipper !== node.clipper) {
      entry.paint.clip(this.sync(node.clipper));
      entry.clipper = node.clipper;
    }
    if (node.masking && (entry.masking !== node.masking.paint || entry.maskMethod !== node.masking.method)) {
      entry.paint.mask(
        this.sync(node.masking.paint),
        node.masking.method === 'alpha' ? this.tvg.MaskMethod.Alpha : this.tvg.MaskMethod.InvAlpha,
      );
      entry.masking = node.masking.paint;
      entry.maskMethod = node.masking.method;
    }
    entry.version = node.version;
    return entry.paint;
  }
  get retainedPaintCount(): number {
    return this.entries.size;
  }
  /** Read only the native geometry prepared by the last Canvas update. Never sync while picking. */
  intersectsRendered(node: PaintNode, region: { x: number; y: number; w: number; h: number }): boolean {
    if (!node.alpha) return false;
    const entry = this.entries.get(node);
    if (!entry) return false;
    if (entry.paint.intersects(region.x, region.y, region.w, region.h, true)) return true;
    // The pinned SDK's Lottie Picture root can miss transformed children. Its
    // actual prepared leaf shapes still carry the full ancestor/clip transform.
    if (node instanceof AnimationNode) this.prepareHitTest(node);
    if (
      entry.hitShapes?.paints.some((paint) => paint.intersects(region.x, region.y, region.w, region.h, true))
    )
      return true;
    return node instanceof SceneNode && node.children.some((child) => this.intersectsRendered(child, region));
  }
  /** Borrowed wrappers are frame-scoped; collecting them never changes native ownership. */
  prepareHitTest(node: PaintNode): void {
    const entry = this.entries.get(node);
    if (!entry || !node.alpha) return;
    if (node instanceof AnimationNode && entry.hitShapes?.version !== node.version) {
      const paints: Paint[] = [];
      this.hitAccessor ??= new this.tvg.Accessor();
      this.hitAccessor.set(entry.paint, (paint) => {
        if (paint instanceof this.tvg.Shape || paint instanceof this.tvg.Text) paints.push(paint);
        return true;
      });
      entry.hitShapes = { version: node.version, paints };
    }
    if (node instanceof SceneNode) node.children.forEach((child) => this.prepareHitTest(child));
  }
  renderedBounds(node: PaintNode): { x: number; y: number; w: number; h: number } | null {
    const paint = this.entries.get(node)?.paint;
    if (!paint) return null;
    const bounds = paint.bounds();
    return Number.isFinite(bounds.x + bounds.y + bounds.width + bounds.height)
      ? { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height }
      : null;
  }
  /** Bound the number of new native paints between sweeps during travel or combat. */
  needsCollection(): boolean {
    return this.entries.size >= this.lastSweepSize + 128;
  }
  /** Call after syncing every live root to release paints detached by a rebuild. */
  collect(roots: readonly PaintNode[]): void {
    const live = new Set<PaintNode>();
    const visit = (node: PaintNode) => {
      if (live.has(node)) return;
      live.add(node);
      if (node instanceof SceneNode) node.children.forEach(visit);
      if (node instanceof PictureNode && node.source) visit(node.source);
      if (node.clipper) visit(node.clipper);
      if (node.masking) visit(node.masking.paint);
    };
    roots.forEach(visit);
    for (const [node, entry] of this.entries)
      if (!live.has(node)) {
        this.release(entry);
        this.entries.delete(node);
      }
    this.lastSweepSize = this.entries.size;
  }
  dispose(): void {
    this.hitAccessor?.dispose();
    this.hitAccessor = undefined;
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
  }
  private release(entry: Entry): void {
    for (const child of entry.childPaints ?? [])
      if (this.parents.get(child) === entry) this.parents.delete(child);
    if (entry.animation) entry.animation.dispose();
    else entry.paint.dispose();
  }
  private rawPicture(node: PictureNode): Paint {
    if (node.source) return this.sync(node.source).duplicate();
    return new this.tvg.Picture().load(node.data, {
      type: 'raw',
      width: node.width,
      height: node.height,
      colorSpace: this.tvg.ColorSpace[node.colorSpace],
    });
  }
  private blend(method: Blend) {
    return method === 'softLight'
      ? this.tvg.BlendMethod.SoftLight
      : method === 'add'
        ? this.tvg.BlendMethod.Add
        : method === 'multiply'
          ? this.tvg.BlendMethod.Multiply
          : method === 'screen'
            ? this.tvg.BlendMethod.Screen
            : this.tvg.BlendMethod.Normal;
  }
  /** Every outline of a shape in one call: corner pairs are kept between calls, so nothing is allocated per corner. */
  private rings(paint: Shape, rings: Rings): void {
    const corners = rings.used / 2,
      commands = new Uint8Array(corners + rings.count),
      pairs = this.ringPairs,
      { MoveTo, LineTo, Close } = this.tvg.PathCommand;
    while (pairs.length < corners) pairs.push([0, 0]);
    let c = 0,
      p = 0;
    for (let ring = 0; ring < rings.count; ++ring) {
      for (let k = rings.sizes[ring]; k > 0; --k, ++p) {
        const pair = pairs[p];
        pair[0] = rings.points[p * 2];
        pair[1] = rings.points[p * 2 + 1];
        commands[c++] = LineTo;
      }
      commands[c - rings.sizes[ring]] = MoveTo;
      commands[c++] = Close;
    }
    // WebCanvas copies the commands as bytes; a typed array saves it a conversion.
    paint.appendPath(
      commands as unknown as Parameters<Shape['appendPath']>[0],
      corners === pairs.length ? pairs : pairs.slice(0, corners),
    );
  }
  private shape(
    paint: Shape,
    node: ShapeNode,
    rebuildPath: boolean,
    entry: Entry,
    shade?: Shade,
    recolour = false,
  ): void {
    if (rebuildPath) {
      paint.reset();
      for (const command of node.commands) {
        switch (command[0]) {
          case 'M':
            paint.moveTo(command[1], command[2]);
            break;
          case 'L':
            paint.lineTo(command[1], command[2]);
            break;
          case 'C':
            paint.cubicTo(command[1], command[2], command[3], command[4], command[5], command[6]);
            break;
          case 'Z':
            paint.close();
            break;
          case 'R':
            paint.appendRect(command[1], command[2], command[3], command[4], {
              rx: command[5],
              ry: command[6],
            });
            break;
          case 'E':
            paint.appendCircle(command[1], command[2], command[3], command[4]);
            break;
        }
      }
      if (node.rings?.count) this.rings(paint, node.rings);
    }
    const local = shadeWithin(shade, node.matrix),
      risen = local?.rise ? this.risen(node, local) : undefined,
      even = local && evenShade(local);
    if (risen) {
      paint.fill(risen);
      risen.dispose();
    } else {
      if (node.color) paint.fill(...toned(node.color, even));
      if (node.gradient && (node.gradient !== entry.gradient || recolour || local?.rise)) {
        const g = node.gradient,
          c = g.coordinates;
        const gradient =
          g.type === 'linear'
            ? new this.tvg.LinearGradient(c[0], c[1], c[2], c[3])
            : new this.tvg.RadialGradient(c[0], c[1], c[2], c[3], c[4], c[5]);
        for (const stop of g.stops) gradient.addStop(stop.offset, [...toned(stop.color, even)]);
        paint.fill(gradient);
        gradient.dispose();
      }
    }
    entry.gradient = node.gradient;
    if (node.width !== undefined) paint.stroke(node.width);
    if (node.strokeColor) paint.stroke({ color: [...toned(node.strokeColor, even)] });
    if (node.cap)
      paint.stroke({
        cap:
          node.cap === 'round'
            ? this.tvg.StrokeCap.Round
            : node.cap === 'square'
              ? this.tvg.StrokeCap.Square
              : this.tvg.StrokeCap.Butt,
      });
    if (node.join)
      paint.stroke({
        join:
          node.join === 'round'
            ? this.tvg.StrokeJoin.Round
            : node.join === 'bevel'
              ? this.tvg.StrokeJoin.Bevel
              : this.tvg.StrokeJoin.Miter,
      });
    if (node.dash) paint.stroke({ dash: node.dash });
    if (node.rule)
      paint.fillRule(node.rule === 'evenOdd' ? this.tvg.FillRule.EvenOdd : this.tvg.FillRule.Winding);
  }
  /**
   * A shape's fill under mist lying on the ground: one gradient down the shape that is as dim as the shade's
   * foot below its foot and as its top above, over the shape's own colour or its own vertical gradient. Null
   * where the fill cannot be told by height (a radial or slanted gradient): it is then shaded evenly.
   */
  private risen(node: ShapeNode, shade: Shade): InstanceType<ThorVGNamespace['LinearGradient']> | undefined {
    const rise = shade.rise!,
      mist = riseSteps.map(({ t, w }) => ({
        y: rise.foot - rise.height * (1 - t),
        strength: rise.top + (shade.strength - rise.top) * w,
      })),
      heights = mist.map((step) => step.y);
    let own: (y: number) => Rgba,
      x = 0;
    const g = node.gradient;
    if (g) {
      const [x1, y1, x2, y2] = g.coordinates;
      if (g.type !== 'linear' || x1 !== x2 || y1 === y2) return undefined;
      const stops = [...g.stops].sort((a, b) => a.offset - b.offset);
      x = x1;
      for (const stop of stops) heights.push(y1 + stop.offset * (y2 - y1));
      own = (y) => colourAt(stops, (y - y1) / (y2 - y1));
    } else if (node.color) {
      const color = node.color;
      own = () => color;
    } else return undefined;
    const ys = [...new Set(heights)].sort((a, b) => a - b),
      low = ys[0],
      high = ys[ys.length - 1];
    if (!(high - low > 0.01)) return undefined;
    const strengthAt = (y: number): number => {
      if (y <= mist[0].y) return mist[0].strength;
      for (let i = 1; i < mist.length; i++)
        if (y <= mist[i].y)
          return (
            mist[i - 1].strength +
            ((mist[i].strength - mist[i - 1].strength) * (y - mist[i - 1].y)) / (mist[i].y - mist[i - 1].y)
          );
      return mist[mist.length - 1].strength;
    };
    const gradient = new this.tvg.LinearGradient(x, low, x, high);
    for (const y of ys)
      gradient.addStop((y - low) / (high - low), [...toned(own(y), { tone: shade.tone, strength: strengthAt(y) })]);
    return gradient;
  }
  private text(paint: Text, node: TextNode): void {
    paint
      .font(node.font)
      .fontSize(node.size)
      .text(node.text)
      .fill(node.color[0], node.color[1], node.color[2]);
    if (node.stroke) paint.outline(node.stroke.width, ...node.stroke.color);
  }
}
