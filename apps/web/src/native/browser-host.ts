import type { Canvas, Scene, ThorVGNamespace } from '@thorvg/webcanvas';
import { Key } from '../../../../packages/native-ui/src';
import { emptyEvent, type Application, type AppEvent } from './application-contracts';
import { applicationCursor } from './browser-cursor';
import { BrowserTouch } from './browser-touch';
import { BrowserFrameLoop, renderPixelRatio } from './browser-presentation';
import { isLetterCode, keyText } from './key-text';
import { invalidateWebCanvasRasterResources } from '../../../../packages/native-renderer/src/webcanvas-adapter';

const keys = new Map<string, Key>([
  ['Tab', Key.Tab],
  ['Enter', Key.Enter],
  [' ', Key.Space],
  ['Escape', Key.Escape],
  ['ArrowLeft', Key.Left],
  ['ArrowRight', Key.Right],
  ['ArrowUp', Key.Up],
  ['ArrowDown', Key.Down],
  ['Home', Key.Home],
  ['End', Key.End],
  ['Backspace', Key.Backspace],
  ['Delete', Key.Delete],
]);
export interface BrowserHostOptions {
  autoStart?: boolean;
  devicePixelRatio?: boolean;
}
/** Browser event/device boundary. Every visible control is painted by the original ThorVG UI. */
export class BrowserHost {
  private canvas!: Canvas;
  private readonly viewport: Scene;
  private readonly loop: BrowserFrameLoop;
  private readonly touchDisplay: boolean;
  private readonly devicePixelRatio: boolean;
  private readonly events = new AbortController();
  private readonly resizeObserver: ResizeObserver;
  private readonly textInput: HTMLTextAreaElement;
  private composing = false;
  private closed = false;
  private surfaceLost = false;
  private resumeAfterRestore = false;
  private renderedAt = 0;
  private width = 0;
  private height = 0;
  private scale = 1;
  private readonly pressed = new Set<string>();
  /** What each held physical key was called when it went down, so its release carries the same name. */
  private readonly heldText = new Map<string, string>();
  private touch: BrowserTouch;
  constructor(
    private readonly element: HTMLCanvasElement,
    private readonly tvg: ThorVGNamespace,
    readonly app: Application,
    options: BrowserHostOptions = {},
  ) {
    this.devicePixelRatio = options.devicePixelRatio ?? true;
    this.touchDisplay = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    this.loop = new BrowserFrameLoop(
      seconds => this.render(seconds),
      () => app.nextFrameDelay?.() ?? 0,
      this.touchDisplay ? 1000 / 60 : 0,
    );
    this.viewport = new tvg.Scene();
    this.viewport.add(app.scene());
    this.resize(true);
    element.tabIndex = 0;
    this.textInput = document.createElement('textarea');
    this.textInput.dataset.goldfantasyTextInput = '';
    this.textInput.setAttribute('aria-label', 'Game text input');
    this.textInput.tabIndex = -1;
    this.textInput.autocomplete = 'off';
    this.textInput.autocapitalize = 'off';
    this.textInput.spellcheck = false;
    this.textInput.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;resize:none;';
    document.body.append(this.textInput);
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resize()) this.loop.wake();
    });
    this.resizeObserver.observe(element);
    const signal = this.events.signal,
      dispatch = (event: AppEvent) => {
        if (!this.closed) {
          this.app.event(event);
          this.loop.wake();
          this.syncTextInput(event);
        }
      };
    element.addEventListener(
      'webglcontextlost',
      (event) => {
        if (this.closed || this.surfaceLost || this.canvas.renderer !== 'gl') return;
        event.preventDefault();
        const running = this.loop.running;
        this.stop();
        this.resumeAfterRestore = running;
        this.surfaceLost = true;
        this.app.invalidatePresentation?.();
        this.releaseInput();
        this.canvas.remove();
        this.canvas.destroy();
      },
      { signal },
    );
    element.addEventListener(
      'webglcontextrestored',
      () => {
        if (this.closed || !this.surfaceLost) return;
        invalidateWebCanvasRasterResources();
        this.surfaceLost = false;
        this.resize(true);
        const resume = this.resumeAfterRestore;
        this.resumeAfterRestore = false;
        // Repaint the same simulation instant before resuming any animation loop.
        this.render(this.renderedAt);
        if (resume) this.start();
      },
      { signal },
    );
    this.touch = new BrowserTouch(dispatch);
    this.app.setTouchInput?.(this.touchDisplay);
    const pointer = (
      type: 'PointerDown' | 'PointerMove' | 'PointerUp' | 'PointerCancel',
      e: PointerEvent,
    ) => {
      const bounds = element.getBoundingClientRect(),
        event = emptyEvent(type);
      event.x = e.clientX - bounds.left;
      event.y = e.clientY - bounds.top;
      if (
        type === 'PointerDown' &&
        (document.activeElement !== this.textInput || !this.app.takesTyping?.(event))
      ) {
        // Finish any composition on the old field before dispatch changes the in-game focus.
        element.focus({ preventScroll: true });
      }
      if (e.pointerType === 'touch') {
        this.app.setTouchInput?.(true);
        this.touch.event(type, e.pointerId, { x: event.x, y: event.y });
        return;
      }
      if (type === 'PointerDown') this.app.setTouchInput?.(false);
      event.pointerType = e.pointerType;
      event.button = e.button + 1;
      event.shift = e.shiftKey;
      event.control = e.ctrlKey;
      event.alt = e.altKey;
      event.meta = e.metaKey;
      dispatch(event);
    };
    element.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    element.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        element.setPointerCapture(e.pointerId);
        pointer('PointerDown', e);
      },
      { signal },
    );
    element.addEventListener('pointermove', (e) => pointer('PointerMove', e), { signal });
    element.addEventListener(
      'pointerup',
      (e) => {
        pointer('PointerUp', e);
        if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
      },
      { signal },
    );
    element.addEventListener('pointercancel', (e) => pointer('PointerCancel', e), { signal });
    element.addEventListener(
      'pointerleave',
      (e) => {
        if (e.pointerType !== 'touch' && e.buttons === 0) {
          const event = emptyEvent('PointerMove');
          event.x = event.y = -1;
          dispatch(event);
        }
      },
      { signal },
    );
    element.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const bounds = element.getBoundingClientRect(),
          event = emptyEvent('Wheel');
        event.x = e.clientX - bounds.left;
        event.y = e.clientY - bounds.top;
        event.delta = -e.deltaY / (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? 100 : 1);
        dispatch(event);
      },
      { passive: false, signal },
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.ownsFocus()) return;
        const typing = document.activeElement === this.textInput,
          composed = this.composing || e.isComposing || e.keyCode === 229;
        // Composition belongs to a text field. Outside one, a letter pressed under an input method
        // (Hangul, say) is still a hotkey, named by its place on the board.
        if (composed && (typing || !isLetterCode(e.code))) return;
        const event = emptyEvent('KeyDown');
        event.key = keys.get(e.key) ?? Key.Unknown;
        event.text = keyText(e.key, e.code, typing);
        event.code = e.code;
        if (e.code) this.heldText.set(e.code, event.text);
        event.shift = e.shiftKey;
        event.control = e.ctrlKey;
        event.alt = e.altKey;
        event.meta = e.metaKey;
        this.pressed.add(event.text);
        dispatch(event);
        const editable = typing && (!keys.has(e.key) || e.key === ' ') && !/^F\d{1,2}$/.test(e.key);
        // Native key handling owns cursor/editing keys and app shortcuts. The
        // editable bridge owns committed text, including dead keys and IMEs.
        if (
          (!editable && !e.metaKey && !e.ctrlKey) ||
          ((e.metaKey || e.ctrlKey) && ['s', 'o', 'z', 'y'].includes(event.text)) ||
          // Ctrl/Cmd+1..9 makes a control group; left alone, the browser would switch tabs.
          ((e.metaKey || e.ctrlKey) && /^Digit[1-9]$/.test(e.code))
        )
          e.preventDefault();
      },
      { signal },
    );
    window.addEventListener(
      'keyup',
      (e) => {
        if (!this.ownsFocus()) return;
        const typing = document.activeElement === this.textInput,
          // A release is named as its press was, even if a text field opened in between.
          held = e.code ? this.heldText.get(e.code) : undefined;
        if (e.code) this.heldText.delete(e.code);
        if (held === undefined && (this.composing || e.isComposing || e.keyCode === 229)) return;
        const event = emptyEvent('KeyUp');
        event.key = keys.get(e.key) ?? Key.Unknown;
        event.text = held ?? keyText(e.key, e.code, typing);
        event.code = e.code;
        event.shift = e.shiftKey;
        event.control = e.ctrlKey;
        event.alt = e.altKey;
        event.meta = e.metaKey;
        if (!this.pressed.delete(event.text)) return;
        dispatch(event);
      },
      { signal },
    );
    this.textInput.addEventListener(
      'compositionstart',
      () => {
        this.composing = true;
      },
      { signal },
    );
    this.textInput.addEventListener(
      'compositionend',
      (e) => {
        this.composing = false;
        const event = emptyEvent('Text');
        event.text = e.data;
        this.textInput.value = '';
        if (event.text) dispatch(event);
      },
      { signal },
    );
    this.textInput.addEventListener(
      'input',
      (e) => {
        if (this.composing || (e instanceof InputEvent && e.isComposing)) return;
        const text = this.textInput.value;
        this.textInput.value = '';
        // Composition is committed by compositionend. Some engines also send a
        // final input event afterward; it must not insert the same text twice.
        if ((e instanceof InputEvent && e.inputType.includes('Composition')) || !text) return;
        const event = emptyEvent('Text');
        event.text = text;
        dispatch(event);
      },
      { signal },
    );
    window.addEventListener(
      'focusout',
      () => {
        queueMicrotask(() => {
          if (!this.closed && !this.ownsFocus()) this.releaseInput();
        });
      },
      { signal },
    );
    window.addEventListener('blur', () => this.releaseInput(), { signal });
    document.addEventListener('visibilitychange', () => {
      this.loop.visibilityChanged();
      if (document.hidden) this.releaseInput();
    }, { signal });
    window.addEventListener('pagehide', () => this.dispose(), { signal });
    if (options.autoStart !== false) this.start();
  }
  private ownsFocus(): boolean {
    return (
      document.hasFocus() &&
      (document.activeElement === this.element || document.activeElement === this.textInput)
    );
  }
  private syncTextInput(event?: AppEvent): void {
    if (!this.ownsFocus()) return;
    const editing = document.activeElement === this.textInput;
    const press = event?.type === 'PointerDown' && event.button === 1;
    // A redraw or a menu restoring its focus must not summon a phone's keyboard.
    if (!editing && this.touchDisplay && !press && !(event?.type === 'KeyDown' && event.key === Key.Tab)) return;
    // Desktop hosts may still use the original text-input command. Touch requires an explicit editable target.
    const wanted = this.app.takesTyping?.(press ? event : undefined) ??
      (!this.touchDisplay && !this.app.command('ui.text-input', 'off'));
    if (wanted && !editing) {
      const bounds = this.element.getBoundingClientRect();
      this.textInput.style.left = `${bounds.left}px`;
      this.textInput.style.top = `${bounds.top}px`;
      this.textInput.focus({ preventScroll: true });
    } else if (!wanted && editing) {
      this.textInput.value = '';
      this.element.focus({ preventScroll: true });
    }
  }
  private releaseInput(): void {
    this.touch?.cancel();
    for (const text of this.pressed) {
      const event = emptyEvent('KeyUp');
      event.text = text;
      this.app.event(event);
    }
    this.pressed.clear();
    this.heldText.clear();
    this.app.event(emptyEvent('PointerCancel'));
  }
  /** Physical WebGL pixels per logical HUD or picking coordinate. */
  get pixelRatio(): number {
    return this.scale;
  }
  private resize(recreate = false): boolean {
    if (this.closed || this.surfaceLost) return false;
    const width = Math.max(1, this.element.clientWidth),
      height = Math.max(1, this.element.clientHeight),
      scale = this.devicePixelRatio ? renderPixelRatio(width, height, window.devicePixelRatio, this.touchDisplay) : 1;
    if (!recreate && width === this.width && height === this.height && scale === this.scale) return false;
    const pixelsWide = Math.max(1, Math.round(width * scale));
    const pixelsHigh = Math.max(1, Math.round(height * scale));
    // WebCanvas writes inline dimensions. Keep the layout and input surface in CSS pixels.
    const style = this.element.style;
    const cssWidth = style.width || width + 'px', cssHeight = style.height || height + 'px';
    if (recreate) {
      this.canvas = new this.tvg.Canvas(this.element, {
        width: pixelsWide, height: pixelsHigh, enableDevicePixelRatio: false,
      });
      this.canvas.add(this.viewport);
    } else this.canvas.resize(pixelsWide, pixelsHigh);
    style.width = cssWidth;
    style.height = cssHeight;
    this.viewport.transform({ e11: scale, e12: 0, e13: 0, e21: 0, e22: scale, e23: 0, e31: 0, e32: 0, e33: 1 });
    this.width = width;
    this.height = height;
    this.scale = scale;
    this.app.invalidatePresentation?.();
    return true;
  }
  render(seconds = this.loop.seconds()): void {
    if (this.closed || this.surfaceLost) return;
    this.resize();
    this.renderedAt = seconds;
    this.app.render(this.width, this.height, seconds);
    if (this.closed || this.surfaceLost) return;
    this.syncTextInput();
    this.canvas.update().render();
    this.app.presented?.(this.scale);
    this.element.style.cursor = applicationCursor(this.app);
  }
  /** Renders the scene as it stands and returns it cropped to a small 16:9 JPEG data URL. */
  capture(width = 384, height = 216): string {
    if (this.closed || this.surfaceLost) return '';
    // The GPU back buffer is only readable in the task that rendered it.
    this.canvas.update().render();
    const target = document.createElement('canvas'),
      context = target.getContext('2d'),
      scale = Math.max(width / this.element.width, height / this.element.height),
      w = this.element.width * scale,
      h = this.element.height * scale;
    if (!context || !this.element.width || !this.element.height) return '';
    target.width = width;
    target.height = height;
    context.drawImage(this.element, (width - w) / 2, (height - h) / 2, w, h);
    return target.toDataURL('image/jpeg', 0.75);
  }
  present(): void {
    if (!this.closed && !this.surfaceLost) this.canvas.update().render();
  }
  start(): void {
    if (this.closed) return;
    if (this.surfaceLost) {
      this.resumeAfterRestore = true;
      return;
    }
    this.loop.start();
  }
  stop(): void {
    this.resumeAfterRestore = false;
    this.loop.stop();
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.stop();
    this.events.abort();
    this.resizeObserver.disconnect();
    this.textInput.remove();
    if (!this.surfaceLost) this.canvas.remove();
    this.viewport.remove();
    this.app.dispose();
    this.viewport.dispose();
    if (!this.surfaceLost) this.canvas.destroy();
  }
}
