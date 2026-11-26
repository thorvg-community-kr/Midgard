import type { Canvas, ThorVGNamespace } from '@thorvg/webcanvas';
import { Key } from '../../../../packages/native-ui/src';
import { emptyEvent, type Application, type AppEvent } from './application-contracts';
import { applicationCursor } from './browser-cursor';
import { BrowserTouch } from './browser-touch';
import { BrowserFrameLoop, renderPixelRatio } from './browser-presentation';
import { BrowserSurface } from './browser-surface';
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
  private readonly world: BrowserSurface;
  private hud?: BrowserSurface;
  private hudNeedsDraw = true;
  private hudUnavailable = false;
  private readonly loop: BrowserFrameLoop;
  private readonly touchDisplay: boolean;
  private readonly devicePixelRatio: boolean;
  private readonly events = new AbortController();
  private readonly resizeObserver: ResizeObserver;
  private readonly textInput: HTMLTextAreaElement;
  private composing = false;
  private closed = false;
  private resumeAfterRestore = false;
  private renderedAt = 0;
  private width = 0;
  private height = 0;
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
    this.world = new BrowserSurface(element, tvg);
    this.world.viewport.add(app.scene());
    this.watchContext(this.world);
    this.resize();
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
      this.alignHud();
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
  /** Physical pixels of the world surface per logical picking coordinate. */
  get pixelRatio(): number {
    return this.world.scale;
  }
  private get canvas(): Canvas {
    return this.world.canvas!;
  }
  private get surfaceLost(): boolean {
    return this.world.lost || !!this.hud?.lost;
  }
  private watchContext(surface: BrowserSurface): void {
    const signal = this.events.signal;
    surface.element.addEventListener('webglcontextlost', event => {
      if (this.closed || surface.lost || surface.canvas?.renderer !== 'gl') return;
      event.preventDefault();
      if (!this.surfaceLost) {
        const running = this.loop.running;
        this.stop();
        this.resumeAfterRestore = running;
        this.app.invalidatePresentation?.();
        this.releaseInput();
      }
      surface.lost = true;
      surface.releaseCanvas();
    }, { signal });
    surface.element.addEventListener('webglcontextrestored', () => {
      if (this.closed || !surface.lost) return;
      surface.lost = false;
      if (this.surfaceLost) return;
      invalidateWebCanvasRasterResources();
      const resume = this.resumeAfterRestore;
      this.resumeAfterRestore = false;
      // Rebuild the lost targets and repaint the same simulation instant before resuming.
      this.render(this.renderedAt);
      if (resume) this.start();
    }, { signal });
  }
  private alignHud(element = this.hud?.element): void {
    if (!element) return;
    const box = this.element.getBoundingClientRect();
    Object.assign(element.style, {
      left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px',
    });
  }
  private createHud(width: number, height: number, density: number): void {
    const element = document.createElement('canvas');
    element.dataset.goldfantasyHud = '';
    element.setAttribute('aria-hidden', 'true');
    element.style.cssText = 'position:fixed;display:block;pointer-events:none;';
    element.style.zIndex = getComputedStyle(this.element).zIndex;
    this.element.after(element);
    this.alignHud(element);
    const hud = new BrowserSurface(element, this.tvg);
    try {
      hud.resize(width, height, density);
    } catch {
      // A browser with no spare WebGL context can still draw the complete scene at display density.
      hud.detach();
      hud.dispose();
      element.remove();
      this.hudUnavailable = true;
      return;
    }
    hud.viewport.add(this.app.separateHud!());
    this.hud = hud;
    this.watchContext(hud);
    window.addEventListener('scroll', () => this.alignHud(), { capture: true, passive: true, signal: this.events.signal });
  }
  private resize(): boolean {
    if (this.closed || this.surfaceLost) return false;
    const width = Math.max(1, this.element.clientWidth), height = Math.max(1, this.element.clientHeight);
    const density = this.devicePixelRatio ? window.devicePixelRatio || 1 : 1;
    const worldRatio = renderPixelRatio(width, height, density, this.touchDisplay);
    const split = !this.hud && !this.hudUnavailable && density > worldRatio &&
      !!this.app.separateHud && this.element.parentElement !== null;
    const worldChanged = this.world.resize(width, height, this.hud || split ? worldRatio : density);
    if (split) {
      this.createHud(width, height, density);
      if (!this.hud) this.world.resize(width, height, density);
    }
    const hudChanged = this.hud?.resize(width, height, density);
    if (!worldChanged && !hudChanged && !split) return false;
    this.hudNeedsDraw = true;
    this.width = width;
    this.height = height;
    this.alignHud();
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
    this.present(false);
    this.app.presented?.(this.world.scale);
    this.element.style.cursor = applicationCursor(this.app);
  }
  /** Renders the scene as it stands and returns it cropped to a small 16:9 JPEG data URL. */
  capture(width = 384, height = 216): string {
    if (this.closed || this.surfaceLost) return '';
    // The GPU back buffer is only readable in the task that rendered it.
    this.present();
    const target = document.createElement('canvas'),
      context = target.getContext('2d'),
      scale = Math.max(width / this.element.width, height / this.element.height),
      w = this.element.width * scale,
      h = this.element.height * scale;
    if (!context || !this.element.width || !this.element.height) return '';
    target.width = width;
    target.height = height;
    context.drawImage(this.element, (width - w) / 2, (height - h) / 2, w, h);
    if (this.hud) context.drawImage(this.hud.element, (width - w) / 2, (height - h) / 2, w, h);
    return target.toDataURL('image/jpeg', 0.75);
  }
  present(forceHud = true): void {
    if (this.closed || this.surfaceLost) return;
    this.canvas.update().render();
    if (this.hud?.canvas) {
      const changed = this.app.takeHudChanges?.() ?? true;
      if (changed || this.hudNeedsDraw || forceHud) this.hud.canvas.update().render();
      this.hudNeedsDraw = false;
    }
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
    this.world.detach();
    this.hud?.detach();
    this.app.dispose();
    this.world.dispose();
    this.hud?.dispose();
    this.hud?.element.remove();
  }
}
