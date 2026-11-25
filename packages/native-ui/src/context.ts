import type { Paint, Scene, Matrix } from '@thorvg/webcanvas';
import { koreanTitleFont, type NativeFontMetrics } from './fonts';
import { FrameStyle, Theme } from './theme';
import { lerpFloat } from './numeric';
import { hasHangul, koreanFont, translate } from '../../localization/src/index';
const f = Math.fround;
import {
  Align,
  Cursor,
  EventType,
  FrameRequest,
  Icon,
  Key,
  Rect,
  iconName,
  rgba,
  transparent,
  type Color,
  type Event,
  type IconState,
  type State,
  type WebCanvas,
} from './types';
import { Icons, type IconAsset } from './icons';

type Handler = (event: Event) => void;
interface Control {
  id: string;
  bounds: Rect;
  handler: Handler | undefined;
  enabled: boolean;
  focusable: boolean;
  scrollable: boolean;
  captureRelease: boolean;
  cursor: Cursor;
}
export type OverlayControl = Readonly<Pick<Control, 'id' | 'bounds' | 'focusable'>>;
type OverlayDraw = (viewport: Rect, controls: readonly OverlayControl[]) => void;
interface Drawn {
  key: string;
  paint: Paint;
}
class Layer {
  readonly scene: Scene;
  bounds = new Rect();
  pending: Paint[] = [];
  attached: Paint[] = [];
  queued = new Set<Paint>();
  clips: Layer[] = [];
  drawn: Drawn[] = [];
  usedClips = 0;
  usedDrawn = 0;
  retired: Paint[] = [];
  constructor(tvg: WebCanvas) {
    this.scene = new tvg.Scene();
  }
  begin(): void {
    this.pending = [];
    this.queued.clear();
    this.usedClips = this.usedDrawn = 0;
  }
}
const event = (type: EventType, x = 0, y = 0, key = Key.Unknown, shift = false, text = ''): Event => ({
  type,
  x,
  y,
  key,
  shift,
  text,
});
const matrixCache = new WeakMap<Paint, string>();
const originalText = (value: string) => value;
export function setTransform(paint: Paint, matrix: Matrix): void {
  const key = JSON.stringify(matrix);
  if (matrixCache.get(paint) === key) return;
  paint.transform(matrix);
  matrixCache.set(paint, key);
}

/** Source-equivalent immediate UI over retained ThorVG WebCanvas paints. */
export class Context {
  private readonly rootLayer: Layer;
  private target: Layer;
  private readonly paintLayers = new Map<Paint, Layer>();
  private readonly frames = new FrameRequest();
  private readonly textWidths = new Map<string, number>();
  private localize = translate;
  private tokens = Theme.dark();
  private seconds = 0;
  private motions = new Map<
    string,
    { from: number; target: number; value: number; started: number; used: number }
  >();
  private moving = false;
  private clipBounds = new Rect();
  private controls: Control[] = [];
  private focusId = '';
  private pressedId = '';
  private savedFocus = '';
  private pointerX = -1;
  private pointerY = -1;
  private modalActive = false;
  private modalFrame = false;
  private dismissModal: (() => void) | undefined;
  private readonly icons: Icons;
  private iconSequence = 0;
  private deferredReleases: (() => void)[] = [];
  private overlayDraws: { draw: OverlayDraw; key: string; priority: number }[] = [];
  private viewportBounds = new Rect();
  fontFor: ((text: string, bold: boolean) => string | undefined) | undefined;
  constructor(
    readonly tvg: WebCanvas,
    readonly metrics: NativeFontMetrics,
  ) {
    this.rootLayer = new Layer(tvg);
    this.target = this.rootLayer;
    this.icons = new Icons(tvg);
  }
  scene(): Scene {
    return this.rootLayer.scene;
  }
  theme(): Theme {
    return this.tokens;
  }
  /** Draws `render` under another theme, such as an opaque window over a bare title menu. */
  withTheme(theme: Theme, render: () => void): void {
    const previous = this.tokens;
    this.tokens = theme;
    try {
      render();
    } finally {
      this.tokens = previous;
    }
  }
  /** Measure and draw player-authored text exactly as entered, including names that match interface labels. */
  verbatim<T>(render: () => T, enabled = true): T {
    if (!enabled) return render();
    const previous = this.localize;
    this.localize = originalText;
    try {
      return render();
    } finally {
      this.localize = previous;
    }
  }
  time(): number {
    return this.seconds;
  }
  requestFrameAt(when: number): void {
    this.frames.requestAt(when);
  }
  requestAnimationFrame(): void {
    this.requestFrameAt(this.seconds + 1 / 60);
  }
  frameRequest(): FrameRequest {
    return this.frames;
  }
  begin(theme: Theme, viewport: Rect, seconds = -1): void {
    this.rootLayer.begin();
    this.target = this.rootLayer;
    seconds = Number.isFinite(seconds) && seconds >= 0 ? seconds : performance.now() / 1000;
    if (seconds < this.seconds) this.motions.clear();
    for (const [id, state] of this.motions) if (state.used + 2 < seconds) this.motions.delete(id);
    this.moving = false;
    this.seconds = seconds;
    this.frames.clear();
    this.icons.begin(this.seconds);
    this.iconSequence = 0;
    this.tokens = theme;
    this.clipBounds = viewport;
    this.viewportBounds = viewport;
    this.overlayDraws = [];
    this.controls = [];
    this.modalFrame = false;
  }
  end(): void {
    // Paint overlays only after all clipped panels and their controls exist.
    // They remain ordinary retained root paints, detached before disposal.
    const previousTarget = this.target,
      previousClip = this.clipBounds;
    this.target = this.rootLayer;
    this.clipBounds = this.viewportBounds;
    try {
      const controls = this.controls.map(({ id, bounds, focusable }) => ({ id, bounds, focusable }));
      for (const overlay of this.overlayDraws.splice(0)) overlay.draw(this.viewportBounds, controls);
    } finally {
      this.target = previousTarget;
      this.clipBounds = previousClip;
    }
    this.finishLayer(this.rootLayer);
    for (const release of this.deferredReleases.splice(0)) release();
    this.icons.end();
    if (this.icons.animating()) this.requestAnimationFrame();
    if (this.modalActive && !this.modalFrame) this.focusId = this.savedFocus;
    this.modalActive = this.modalFrame;
    if (!this.modalActive) this.dismissModal = undefined;
    const focused = this.find(this.focusId);
    if (!focused?.enabled || !focused.focusable) this.focusId = '';
    const pressed = this.find(this.pressedId);
    if (!pressed?.enabled) this.pressedId = '';
  }
  private syncLayer(layer: Layer): void {
    // WebCanvas has no insert-before overload. Preserve the common prefix and
    // reattach only the changed suffix, keeping each wrapper reference alive.
    let common = 0;
    while (
      common < layer.attached.length &&
      common < layer.pending.length &&
      layer.attached[common] === layer.pending[common]
    )
      common++;
    for (const paint of layer.attached.slice(common)) {
      layer.scene.remove(paint);
      this.paintLayers.delete(paint);
    }
    for (const paint of layer.pending.slice(common)) {
      const previous = this.paintLayers.get(paint);
      if (previous && previous !== layer) {
        previous.scene.remove(paint);
        previous.attached = previous.attached.filter((p) => p !== paint);
      }
      layer.scene.add(paint);
      this.paintLayers.set(paint, layer);
    }
    layer.attached = [...layer.pending];
  }
  private finishLayer(layer: Layer): void {
    this.syncLayer(layer);
    layer.pending = [];
    for (const entry of layer.drawn.splice(layer.usedDrawn)) entry.paint.dispose();
    for (const paint of layer.retired) paint.dispose();
    layer.retired = [];
    for (const clip of layer.clips.splice(layer.usedClips)) this.discardLayer(clip);
  }
  private discardLayer(layer: Layer): void {
    for (const paint of layer.attached) this.paintLayers.delete(paint);
    layer.scene.remove();
    for (const clip of layer.clips) this.discardLayer(clip);
    for (const entry of layer.drawn) entry.paint.dispose();
    for (const paint of layer.retired) paint.dispose();
    layer.scene.dispose();
  }
  destroy(): void {
    this.discardLayer(this.rootLayer);
    this.textWidths.clear();
    for (const release of this.deferredReleases.splice(0)) release();
    this.icons.destroy();
    this.controls = [];
    this.overlayDraws = [];
  }
  dispose(): void {
    this.destroy();
  }
  /** Native retained paints stay alive until the previous frame is detached.
   * WebCanvas wrappers must likewise survive Scene.remove(), even if their owner changes. */
  deferRelease(release: () => void): void {
    this.deferredReleases.push(release);
  }
  /** A keyed overlay is drawn once per frame; pointer feedback can outrank focus. */
  deferOverlay(draw: OverlayDraw, key = '', priority = 0): void {
    const previous = key ? this.overlayDraws.findIndex((item) => item.key === key) : -1;
    if (previous < 0) this.overlayDraws.push({ draw, key, priority });
    else if (priority >= this.overlayDraws[previous].priority)
      this.overlayDraws[previous] = { draw, key, priority };
  }
  setIcons(assets: readonly IconAsset[]): boolean {
    return this.icons.replace(assets);
  }
  iconError(): string {
    return this.icons.error;
  }
  modal(initialFocus: string, dismiss?: () => void): void {
    if (!this.modalActive) this.cancelPointer();
    this.controls = [];
    this.overlayDraws = [];
    this.dismissModal = dismiss;
    if (!this.modalActive) {
      this.savedFocus = this.focusId;
      this.focus(initialFocus);
    }
    this.modalFrame = true;
  }
  /** The foreground window owns the rest of this frame and input until the next one. */
  inModal(): boolean {
    return this.modalFrame;
  }
  private find(id: string): Control | undefined {
    return this.controls.find((control) => control.id === id);
  }
  private hit(x: number, y: number): Control | undefined {
    for (let i = this.controls.length - 1; i >= 0; i--)
      if (this.controls[i].bounds.contains(x, y)) return this.controls[i];
    return undefined;
  }
  controlAt(x: number, y: number): boolean {
    return this.controls.some((control) => control.bounds.contains(x, y));
  }
  control(
    id: string,
    bounds: Rect,
    handler: Handler | undefined,
    enabled = true,
    focusable = true,
    scrollable = false,
    captureRelease = false,
    cursor = Cursor.Default,
  ): State {
    bounds = bounds.intersect(this.clipBounds);
    this.controls.push({ id, bounds, handler, enabled, focusable, scrollable, captureRelease, cursor });
    return {
      hovered: enabled && bounds.contains(this.pointerX, this.pointerY),
      pressed: enabled && this.pressedId === id,
      focused: enabled && this.focusId === id,
    };
  }
  focus(id: string): void {
    this.focusId = id;
  }
  focused(): string {
    return this.focusId;
  }
  textFocused(): boolean {
    const control = this.find(this.focusId);
    return !!control?.enabled && control.cursor === Cursor.Text;
  }
  cursor(): Cursor {
    const pressed = this.find(this.pressedId);
    if (pressed?.enabled && pressed.cursor !== Cursor.Default) return pressed.cursor;
    const hit = this.hit(this.pointerX, this.pointerY);
    return hit?.enabled ? hit.cursor : Cursor.Default;
  }
  focusedWithin(bounds: Rect): boolean {
    const c = this.find(this.focusId);
    return (
      !!c?.enabled &&
      c.focusable &&
      c.bounds.w > 0 &&
      c.bounds.h > 0 &&
      bounds.contains(c.bounds.x + c.bounds.w / 2, c.bounds.y + c.bounds.h / 2)
    );
  }
  cancelPointer(): void {
    const id = this.pressedId;
    this.pressedId = '';
    this.motions.clear();
    this.moving = false;
    if (this.find(id)?.captureRelease) this.send(id, event(EventType.Cancel, this.pointerX, this.pointerY));
  }
  private send(id: string, value: Event): void {
    const target = this.find(id);
    if (target?.enabled && target.handler) {
      const handler = target.handler;
      handler(value);
    }
  }
  setPointerPosition(x: number, y: number): void {
    this.pointerX = x;
    this.pointerY = y;
  }
  contextMenu(x: number, y: number): void {
    this.setPointerPosition(x, y);
    const target = this.hit(x, y);
    if (target?.enabled) this.send(target.id, event(EventType.ContextMenu, x, y));
  }
  pointerMove(x: number, y: number): void {
    this.setPointerPosition(x, y);
    if (this.pressedId) this.send(this.pressedId, event(EventType.Drag, x, y));
  }
  pointerDown(x: number, y: number): void {
    this.cancelPointer();
    this.setPointerPosition(x, y);
    const target = this.hit(x, y);
    if (!target?.enabled) {
      this.focusId = '';
      return;
    }
    this.pressedId = target.id;
    if (target.focusable) this.focusId = target.id;
    this.send(this.pressedId, event(EventType.Press, x, y));
  }
  pointerUp(x: number, y: number): void {
    this.setPointerPosition(x, y);
    const id = this.pressedId;
    this.pressedId = '';
    const release = this.find(id)?.captureRelease,
      activate = this.hit(x, y)?.id === id;
    if (release) this.send(id, event(EventType.Release, x, y));
    if (activate) this.send(id, event(EventType.Activate, x, y));
  }
  key(key: Key, shift = false): void {
    if (key === Key.Escape && this.find(this.pressedId)?.captureRelease) {
      this.cancelPointer();
      return;
    }
    if (key === Key.Escape && this.modalActive && this.dismissModal) {
      const dismiss = this.dismissModal;
      dismiss();
      return;
    }
    if (key === Key.Tab) {
      const order = this.controls
        .filter((c) => c.enabled && c.focusable && c.bounds.w > 0 && c.bounds.h > 0)
        .map((c) => c.id);
      if (!order.length) return;
      const found = order.indexOf(this.focusId),
        index = found < 0 ? (shift ? 0 : -1) : found;
      this.focusId = order[(index + (shift ? order.length - 1 : 1)) % order.length];
      return;
    }
    this.send(this.focusId, event(EventType.Key, 0, 0, key, shift));
  }
  textInput(text: string): void {
    this.send(this.focusId, event(EventType.Text, 0, 0, Key.Unknown, false, text));
  }
  wheel(vertical: number, horizontal = 0): boolean {
    if (!vertical && !horizontal) return false;
    for (let i = this.controls.length - 1; i >= 0; i--) {
      const c = this.controls[i];
      if (!c.enabled || !c.scrollable || !c.bounds.contains(this.pointerX, this.pointerY)) continue;
      this.send(c.id, event(EventType.Scroll, horizontal, vertical));
      return true;
    }
    return false;
  }
  clip(): Rect;
  clip(bounds: Rect, render: () => void): void;
  clip(bounds?: Rect, render?: () => void): Rect | void {
    if (bounds && render) this.layer(bounds, render);
    else return this.clipBounds;
  }
  layer(bounds: Rect, render: () => void, opacity = 255): Scene | null {
    bounds = bounds.intersect(this.clipBounds);
    if (bounds.w <= 0 || bounds.h <= 0) return null;
    const previousTarget = this.target,
      previousBounds = this.clipBounds,
      index = this.target.usedClips++;
    const layer = this.target.clips[index] ?? (this.target.clips[index] = new Layer(this.tvg));
    this.add(layer.scene);
    // Append-only WebCanvas may need to move this retained scene. Do that while
    // its old descendants still have renderer data: removing it after adding
    // fresh descendants asks ThorVG for their not-yet-initialized render bounds.
    this.syncLayer(previousTarget);
    if (JSON.stringify(layer.bounds) !== JSON.stringify(bounds)) {
      const shape = new this.tvg.Shape()
        .appendRect(bounds.x, bounds.y, bounds.w, bounds.h)
        .fill(255, 255, 255);
      layer.scene.clip(shape);
      // Native Context::layer invalidates fast-track clip coverage this way.
      layer.scene.transform({ e11: 1, e12: 0, e13: 0, e21: 0, e22: 1, e23: 0, e31: 0, e32: 0, e33: 1 });
      shape.dispose();
      layer.bounds = bounds;
    }
    if (layer.scene.opacity() !== opacity) layer.scene.opacity(opacity);
    layer.begin();
    this.target = layer;
    this.clipBounds = bounds;
    try {
      render();
      this.finishLayer(layer);
    } finally {
      this.target = previousTarget;
      this.clipBounds = previousBounds;
    }
    return layer.scene;
  }
  add(paint: Paint | null): void {
    if (!paint || this.target.queued.has(paint)) return;
    this.target.queued.add(paint);
    const previous = this.paintLayers.get(paint);
    if (previous && previous !== this.target) {
      previous.scene.remove(paint);
      previous.attached = previous.attached.filter((p) => p !== paint);
      this.paintLayers.delete(paint);
    }
    this.target.pending.push(paint);
  }
  paint(key: string, make: () => Paint | null): void {
    const index = this.target.usedDrawn++,
      entry = this.target.drawn[index];
    if (!entry || entry.key !== key) {
      const paint = make();
      if (!paint) return;
      if (entry) this.target.retired.push(entry.paint);
      this.target.drawn[index] = { key, paint };
    }
    this.add(this.target.drawn[index].paint);
  }
  rect(bounds: Rect, fill: Color, radius = 0, border = transparent, stroke = 1): void {
    if (bounds.w <= 0 || bounds.h <= 0) return;
    const carved =
      this.tokens.frameStyle === FrameStyle.Carved && radius > 0 && bounds.w >= 20 && bounds.h >= 20;
    this.paint(JSON.stringify(['R', bounds, fill, radius, border, stroke, carved]), () => {
      const shape = new this.tvg.Shape();
      if (carved) {
        const c = Math.min(6, Math.max(2, radius), f(bounds.w / 4), f(bounds.h / 4));
        const x = bounds.x,
          y = bounds.y,
          r = f(x + bounds.w),
          b = f(y + bounds.h);
        shape
          .moveTo(f(x + c), y)
          .lineTo(f(r - c), y)
          .lineTo(r, f(y + c))
          .lineTo(r, f(b - c))
          .lineTo(f(r - c), b)
          .lineTo(f(x + c), b)
          .lineTo(x, f(b - c))
          .lineTo(x, f(y + c))
          .close();
      } else shape.appendRect(bounds.x, bounds.y, bounds.w, bounds.h, { rx: radius, ry: radius });
      shape.fill(fill.r, fill.g, fill.b, fill.a);
      if (border.a) shape.stroke({ width: stroke, color: [border.r, border.g, border.b, border.a] });
      return shape;
    });
  }
  animate(id: string, target: number, duration = 0.14): number {
    target = f(target);
    let state = this.motions.get(id);
    const inserted = !state;
    if (!state) {
      state = { from: target, target, value: target, started: this.seconds, used: this.seconds };
      this.motions.set(id, state);
    }
    const valueAt = () => {
      const t = duration <= 0 ? 1 : f(Math.max(0, Math.min(1, (this.seconds - state.started) / duration)));
      return lerpFloat(state.from, state.target, f(1 - f(f(f(1 - t) * f(1 - t)) * f(1 - t))));
    };
    if (!inserted) state.value = valueAt();
    if (state.target !== target) {
      state.from = state.value;
      state.target = target;
      state.started = this.seconds;
    }
    state.used = this.seconds;
    if (this.tokens.reducedMotion) {
      state.from = target;
      state.started = this.seconds;
    }
    state.value = this.tokens.reducedMotion ? target : valueAt();
    if (!this.tokens.reducedMotion && Math.abs(f(state.value - target)) > f(0.001)) {
      this.moving = true;
      this.requestAnimationFrame();
    } else state.value = target;
    return state.value;
  }
  motionActive(): boolean {
    return this.moving;
  }
  line(x1: number, y1: number, x2: number, y2: number, color: Color, width = 1): void {
    this.paint(JSON.stringify(['L', x1, y1, x2, y2, color, width]), () =>
      new this.tvg.Shape()
        .moveTo(x1, y1)
        .lineTo(x2, y2)
        .stroke({ width, cap: this.tvg.StrokeCap.Round, color: [color.r, color.g, color.b, color.a] }),
    );
  }
  text(
    bounds: Rect,
    value: string,
    color: Color,
    size = 0,
    bold = false,
    align = Align.Start,
    horizontalOffset = 0,
    /** A numeric cell can share the script and baseline of its neighbouring label. */
    fontContext = '',
  ): void {
    if (bounds.w <= 0 || bounds.h <= 0 || !value) return;
    value = this.localize(value);
    const logicalSize = size > 0 ? size : this.tokens.fontSize,
      font = this.fittedFont(value, bold, logicalSize, bounds.w, fontContext),
      points = Math.fround(logicalSize * 0.75 * this.faceScale(font));
    this.paint(JSON.stringify(['T', bounds, color, points, align, horizontalOffset, font, value]), () => {
      const label = new this.tvg.Text()
        .font(font)
        .fontSize(points)
        .text(value)
        .fill(color.r, color.g, color.b)
        .opacity(color.a);
      const measured = label.bounds(),
        metrics = this.metrics[font];
      if (!metrics) {
        label.dispose();
        throw new Error(`No native font metrics loaded for ${font}.`);
      }
      const scale = Math.fround(Math.fround(points * (96 / 72)) / metrics.unitsPerEm);
      const ascent = Math.fround(metrics.ascent * scale),
        descent = Math.fround(metrics.descent * scale);
      const offset =
        align === Align.Center
          ? (bounds.w - measured.width) / 2
          : align === Align.End
            ? bounds.w - measured.width
            : 0;
      label.translate(
        bounds.x + offset - measured.x - horizontalOffset,
        bounds.y + (bounds.h - (ascent - descent)) / 2,
      );
      const clip = new this.tvg.Shape()
        .appendRect(bounds.x, bounds.y, bounds.w, bounds.h)
        .fill(255, 255, 255);
      const group = new this.tvg.Scene().add(label).clip(clip);
      label.dispose();
      clip.dispose();
      return group;
    });
  }
  /**
   * The theme's face for a text: its title face for large bold text, else its bold or regular face. Korean
   * takes the Korean faces once they are loaded, and a text the theme's face cannot write (or a theme face
   * that is not loaded) falls back to DejaVu.
   */
  private scriptFont(value: string, bold: boolean, size: number): string {
    const t = this.tokens,
      title = bold && !!t.titleFont && size >= t.titleFrom;
    if (hasHangul(value)) {
      const korean = bold ? `${koreanFont}-Bold` : koreanFont,
        heading = this.metrics[koreanTitleFont]?.covered;
      if (title && this.metrics[koreanTitleFont] && (!heading || this.writes(heading, value)))
        return koreanTitleFont;
      if (this.metrics[korean]) return korean;
      if (this.metrics[koreanFont]) return koreanFont;
    }
    for (const name of title ? [t.titleFont, t.boldFont] : [bold ? t.boldFont : t.font]) {
      const covered = this.metrics[name]?.covered;
      if (this.metrics[name] && (!covered || this.writes(covered, value))) return name;
    }
    return bold ? 'DejaVuSans-Bold' : 'DejaVuSans';
  }
  /** A title too long for its box is set in the narrower bold face instead of being cut. */
  private fittedFont(value: string, bold: boolean, size: number, width: number, fontContext = ''): string {
    const sample = fontContext || value;
    const font = this.fontFor?.(sample, bold) || this.scriptFont(sample, bold, size);
    if (!this.titled(font) || this.measure(value, font, size) <= width) return font;
    return this.scriptFont(sample, bold, 0);
  }
  private titled(font: string): boolean {
    return !!this.tokens.titleFont && (font === this.tokens.titleFont || font === koreanTitleFont);
  }
  private measure(value: string, font: string, size: number): number {
    const points = size * 0.75 * this.faceScale(font),
      key = JSON.stringify([font, points, value]),
      cached = this.textWidths.get(key);
    if (cached !== undefined) return cached;
    const label = new this.tvg.Text()
      .font(font)
      .fontSize(points)
      .text(value);
    try {
      const width = label.bounds().width;
      // Do not retain fallback measurements while an optional face is loading.
      if (this.metrics[font]) {
        if (this.textWidths.size >= 2048) this.textWidths.delete(this.textWidths.keys().next().value!);
        this.textWidths.set(key, width);
      }
      return width;
    } finally {
      label.dispose();
    }
  }
  private writes(covered: ReadonlySet<number>, value: string): boolean {
    for (const character of value) {
      const code = character.codePointAt(0)!;
      // Line breaks and tabs are layout, not glyphs.
      if (code >= 32 && !covered.has(code)) return false;
    }
    return true;
  }
  private faceScale(font: string): number {
    const t = this.tokens;
    return font === t.font || font === t.boldFont || font === t.titleFont ? t.fontScale : 1;
  }
  textWidth(value: string, size = 0, bold = false, fontContext = ''): number {
    if (!value) return 0;
    value = this.localize(value);
    const logicalSize = size > 0 ? size : this.tokens.fontSize,
      font =
        this.fontFor?.(fontContext || value, bold) || this.scriptFont(fontContext || value, bold, logicalSize);
    return this.measure(value, font, logicalSize);
  }
  elideText(value: string, width: number, size = 0, bold = false, suffix = ''): string {
    if (width <= 0 || !value) return '';
    value = this.localize(value);
    const full = value + suffix,
      logicalSize = size > 0 ? size : this.tokens.fontSize;
    if (this.textWidth(full, size, bold) <= width) return full;
    // text() sets such a title in the bold face, where it may fit whole.
    if (this.titled(this.scriptFont(full, bold, logicalSize))) {
      if (this.measure(full, this.scriptFont(full, bold, 0), logicalSize) <= width) return full;
    }
    const points = Array.from(value);
    const shortened = (length: number) => points.slice(0, length).join('') + '…' + suffix;
    let low = 0,
      high = points.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.textWidth(shortened(middle), size, bold) <= width) low = middle;
      else high = middle - 1;
    }
    return low ? shortened(low) : '';
  }
  icon(bounds: Rect, icon: Icon, color: Color): void;
  icon(
    instance: string,
    bounds: Rect,
    icon: Icon | string,
    color: Color,
    state?: IconState,
    size?: number,
  ): void;
  icon(
    first: Rect | string,
    second: Rect | Icon,
    third: Icon | string | Color,
    fourth?: Color,
    state: IconState = { hovered: false, pressed: false, active: false, enabled: true, focused: false },
    size = 24,
  ): void {
    if (first instanceof Rect) {
      if (typeof second !== 'number' || typeof third !== 'object')
        throw new TypeError('An icon requires its native identifier and color.');
      this.icon(`icon/${this.iconSequence++}`, first, second, third);
      return;
    }
    if (!(second instanceof Rect) || typeof third === 'object' || !fourth)
      throw new TypeError('An icon instance requires bounds, an identifier, and a color.');
    const bounds = second,
      name = typeof third === 'number' ? iconName(third) : third;
    if (bounds.w <= 0 || bounds.h <= 0 || !Number.isFinite(size) || size <= 0 || !name || name === 'none')
      return;
    const picture = this.icons.picture(first, name, state, fourth, (paint) => this.add(paint));
    if (!picture) return;
    const { width, height } = picture.size();
    if (width <= 0 || height <= 0) return;
    const scale = size / Math.max(width, height);
    setTransform(picture, {
      e11: scale,
      e12: 0,
      e13: bounds.x + (bounds.w - width * scale) / 2,
      e21: 0,
      e22: scale,
      e23: bounds.y + (bounds.h - height * scale) / 2,
      e31: 0,
      e32: 0,
      e33: 1,
    });
  }
  iconsAnimating(): boolean {
    return this.icons.animating();
  }
  focusRing(bounds: Rect): void {
    this.rect(bounds.inset(-3), rgba(0, 0, 0, 0), this.tokens.radius + 3, this.tokens.accent, 1.5);
  }
}
