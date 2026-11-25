// Translated from src/game/scene_application.cpp in the pinned native reference.
import type { Scene, ThorVGNamespace } from '@thorvg/webcanvas';
import {
  Align,
  ButtonStyle,
  Context,
  EventType,
  Key,
  Rect,
  Theme,
  board,
  button,
  loadKoreanFont,
  slab,
  tag,
  tone,
  well,
  type NativeFontMetrics,
} from '../../../../packages/native-ui/src/index';
import { locale, locales, setLocale, storeLocale, type Locale } from '../../../../packages/localization/src/index';
import {
  emptyEvent,
  type AppEvent,
  type Application,
  type Camera,
  type LaunchOptions,
  type NativeSound,
  type Preview,
  type Property,
  type SceneId,
  type SceneServices,
} from './application-contracts';

import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';
import { gameTheme, reducedMotionPreferred } from './game-theme';
import { motionPreference, motionPreferences, setMotionPreference } from './motion-preference';
import { startTitlePlay, type TitlePlay } from './title-session';
import { drawTitleWordmark } from './title-wordmark';
import { hudGlyph } from './hud-glyphs';
import { touchTarget } from './mobile-layout';
import { IntroSaga } from './intro-saga';
import { structureSpec } from '../../../../packages/engine/src/building-catalog';
import { Activity, activityName } from '../../../../packages/engine/src/person';
const f = Math.fround;
type Intro = 'None' | 'Cover' | 'Saga' | 'Loading' | 'Reveal';

/** Real seconds of unpaused play between automatic saves. */
export const autosaveInterval = 120;
/** Milestones in quick succession, like a row of placed buildings, share one autosave. */
export const milestoneSaveGap = 4;
const milestoneSaveDelay = 1.5;
export const saveSlotCount = 8;
/** Manual slots are 0..saveSlotCount-1; automatic saves never touch them. */
const autoSlot = -1;
type SettingsPage = 'Main' | 'Save' | 'Load';
export class SceneApplication implements Application {
  private readonly options: LaunchOptions;
  private current: SceneId = 'Title';
  private requested: SceneId | undefined = 'Title';
  private gameSession: Application | undefined;
  private editorSession: Application | undefined;
  private retiring: { app: Application; until: number }[] = [];
  private readonly tvg: ThorVGNamespace;
  private readonly root: Scene;
  private readonly overlay: Context;
  private newGame = false;
  private continueGame = false;
  private overlayPointer = false;
  private touchInput = false;
  private previewFromSave = false;
  private settingsOpen = false;
  private readonly savePath: string;
  private sinceSave = 0;
  private milestoneDue = false;
  private settingsPage: SettingsPage = 'Main';
  /** Manual slot the running game was loaded from or last saved to. */
  private currentSlot: number | undefined;
  private loadPath = '';
  private message = '';
  private messageUntil = -1;
  private titlePlay: TitlePlay | undefined;
  private preview: Preview | undefined;
  private titleSound: NativeSound | undefined;
  private hoveredTitleItem = '';
  private intro: Intro = 'None';
  private introTime = 0;
  private lastFrame = -1;
  private fog = 0;
  private introFrom: Camera = { x: 0, y: 0, zoom: 1 };
  private introTo: Camera = { x: 0, y: 0, zoom: 1 };
  private saga: IntroSaga | undefined;
  private sagaWanted = false;
  private previewWidth = 0;
  private previewHeight = 0;
  private previewDirty = true;

  private readonly fonts: NativeFontMetrics;
  private chooseLanguage(next: Locale): void {
    storeLocale(next);
    if (next !== 'KR') return setLocale(next);
    void loadKoreanFont(this.tvg, this.fonts).then(
      () => {
        setLocale(next);
        this.invalidatePresentation();
      },
      () => (this.message = 'The Korean font could not be loaded'),
    );
  }

  constructor(
    value: LaunchOptions,
    tvg: ThorVGNamespace,
    fonts: NativeFontMetrics,
    private readonly services: SceneServices,
  ) {
    this.options = { ...value, titleScreen: false };
    this.tvg = tvg;
    this.root = new tvg.Scene();
    this.overlay = new Context(tvg, fonts);
    this.fonts = fonts;
    this.savePath = value.saveFile || services.preferenceSavePath();
    if (value.studio || value.characterFile) this.requested = 'CharacterStudio';
    else if (value.mapEditor) this.requested = 'MapEditor';
    else if (value.demo || value.buildingStudio || value.buildingFile) this.requested = 'Game';
  }

  title(): string {
    return 'Midgard';
  }
  setTouchInput(enabled: boolean): void {
    this.touchInput = enabled;
    this.gameSession?.setTouchInput?.(enabled);
    this.editorSession?.setTouchInput?.(enabled);
  }
  scene(): Scene {
    return this.root;
  }
  presented(pixelRatio: number): void {
    const active = this.current === 'Game' ? this.gameSession : this.editorSession;
    if (this.current !== 'Title') active?.presented?.(pixelRatio);
  }
  invalidatePresentation(): void {
    this.previewDirty = true;
    this.gameSession?.invalidatePresentation?.();
    this.editorSession?.invalidatePresentation?.();
  }

  render(width: number, height: number, seconds: number): void {
    width = f(width);
    height = f(height);
    const dt = this.lastFrame < 0 ? 0 : Math.max(0, Math.min(0.1, seconds - this.lastFrame));
    this.lastFrame = seconds;
    this.retiring = this.retiring.filter((session) => {
      if (seconds < session.until) return true;
      session.app.dispose();
      return false;
    });
    if (this.requested) {
      this.transition(this.requested);
      this.requested = undefined;
    }
    if (this.intro !== 'None') this.advanceIntro(dt, width, height);
    else if (this.current === 'Game' && !this.settingsOpen) {
      this.sinceSave += dt;
      if (this.gameSession?.command('session.milestone')) {
        this.milestoneDue = true;
        // Saving a moment later keeps its pause off the click that placed the building.
        this.sinceSave = Math.min(this.sinceSave, milestoneSaveGap - milestoneSaveDelay);
      }
      if (this.sinceSave >= autosaveInterval || (this.milestoneDue && this.sinceSave >= milestoneSaveGap))
        this.save(autoSlot, true);
    }
    if (this.current === 'Title' && this.preview && !this.saga && this.intro !== 'Loading') {
      if (!this.settingsOpen) this.titlePlay?.advance(dt);
      // A run that has ended (or run long) gives way to a fresh world while nobody is starting a game.
      if (!this.settingsOpen && this.titlePlay?.finished() && this.intro === 'None') {
        this.preparePreview();
        this.stage();
      }
      if (!this.settingsOpen && this.intro === 'None' && this.titlePlay) {
        this.preview.setView(this.titlePlay.camera(width, height, dt, reducedMotionPreferred()));
        const subject = this.titlePlay.subject();
        if (subject) {
          const selected = this.preview.selectedPeople();
          if (selected.length !== 1 || selected[0] !== subject.id) this.preview.selectPeople([subject.id]);
        }
      }
      if (!this.settingsOpen || this.previewDirty || width !== this.previewWidth || height !== this.previewHeight) {
        if (this.preview.renderTitle) this.preview.renderTitle(width, height, seconds);
        else this.preview.render(width, height, seconds, false);
        this.previewWidth = width;
        this.previewHeight = height;
        this.previewDirty = false;
      }
      if (this.titleSound) {
        this.titleSound.setAmbience(this.preview.ambience());
        for (const cue of this.preview.takeCues()) this.titleSound.play(cue);
      }
    }
    const theme = gameTheme();
    theme.accent = { r: 210, g: 184, b: 113, a: 255 };
    if (this.current === 'Title') {
      theme.surface = { r: 0, g: 0, b: 0, a: 0 };
      theme.raised = { r: 0, g: 0, b: 0, a: 0 };
      theme.selection = { r: 0, g: 0, b: 0, a: 0 };
      theme.text = { r: 244, g: 231, b: 206, a: 255 };
      theme.accentText = { r: 46, g: 53, b: 37, a: 255 };
      theme.border = { r: 153, g: 129, b: 82, a: 180 };
      theme.radius = 3;
    }
    this.overlay.begin(theme, new Rect(0, 0, width, height), seconds);
    if (this.saga) {
      this.drawSagaCaption(width, height);
      this.overlay.end();
      return;
    }
    if (this.current === 'Title') {
      const low = this.touchInput && height < 500 && width >= 470,
        narrow = width < 680,
        titleCenter = f(width * (low ? 0.28 : narrow ? 0.5 : 0.8)),
        titleWidth = Math.min(520, low ? width * 0.44 : narrow ? width - 36 : f(width * f(0.36))),
        tagline = 'A WORLD WAITING FOR YOUR STORY',
        taglineSize = Math.min(12, (12 * (titleWidth - 8)) / this.overlay.textWidth(tagline, 12, true));
      this.overlay.text(
        new Rect(f(titleCenter - titleWidth / 2), low ? height * 0.34 - 28 : f(height * f(0.17)), titleWidth, 28),
        tagline,
        { r: 205, g: 217, b: 207, a: 255 },
        taglineSize,
        true,
        Align.Center,
      );
      drawTitleWordmark(this.overlay, titleCenter, low ? height * 0.34 : f(height * f(0.22)), titleWidth);
      const subject = this.titlePlay?.subject();
      if (subject) {
        let activity = activityName(subject.activity);
        if (subject.task === Activity.Building) {
          const site = this.preview?.state().building(subject.taskSite);
          if (site) activity = 'Building ' + structureSpec(site.kind).name;
        } else if (subject.task === Activity.Roadwork) activity = 'Building a road';
        this.overlay.text(
          new Rect(24, f(height - 52), f(f(width * f(0.5)) - 48), 20),
          'Following ' + subject.name,
          theme.text,
          12,
          true,
        );
        this.overlay.text(
          new Rect(24, f(height - 32), f(f(width * f(0.5)) - 48), 18),
          activity,
          theme.accent,
          11,
        );
      }
      const bw = Math.min(300, low ? width * 0.41 : narrow ? width - 48 : f(width * f(0.32)));
      const left = f((low ? width * 0.75 : titleCenter) - f(bw / 2)),
        top = low ? (height - 248) / 2 : this.touchInput ? Math.min(height * 0.42, height - 262) : f(height * f(0.42)),
        minorHeight = this.touchInput ? touchTarget : 40;
      let hoveredItem = '';
      // The menu is lettering alone; the item under the pointer is lit and flanked by two studs.
      const menu = (id: string, bounds: Rect, label: string, activate: () => void, enabled = true) => {
        const lit = enabled && this.hoveredTitleItem === id,
          state = button(this.overlay, id, bounds, label, activate, ButtonStyle.Quiet, enabled, undefined, false, {
            fontSize: 18,
            bold: true,
            text: lit ? theme.accent : theme.text,
          });
        if (enabled && state.hovered) hoveredItem = id;
        if (enabled && (state.hovered || state.focused || state.pressed)) {
          const color = state.pressed ? { r: 255, g: 245, b: 208, a: 255 } : theme.accent,
            half = f(this.overlay.textWidth(label, 18, true) / 2 + 20),
            middle = f(bounds.y + bounds.h / 2 + (state.lift ?? 0)),
            center = f(bounds.x + bounds.w / 2);
          for (const side of [-1, 1])
            this.overlay.paint(JSON.stringify(['title-stud', id, side, half, middle, color]), () => {
              const x = f(center + side * half);
              return new this.tvg.Shape()
                .moveTo(x, f(middle - 5))
                .lineTo(f(x + 5), middle)
                .lineTo(x, f(middle + 5))
                .lineTo(f(x - 5), middle)
                .close()
                .fill(color.r, color.g, color.b, color.a);
            });
        }
      };
      const saves = this.savedSlots().length > 0;
      menu(
        'continue',
        new Rect(left, top, bw, 44),
        'Continue',
        () => this.beginGame(true),
        !!this.gameSession || saves,
      );
      menu('new-game', new Rect(left, f(top + 53), bw, 44), 'Start New Game', () =>
        this.beginGame(false, undefined, true),
      );
      menu('load', new Rect(left, f(top + 106), bw, minorHeight), 'Load Game', () => this.openSettings('Load'), saves);
      menu('map-editor', new Rect(left, f(top + 155), bw, minorHeight), 'Map Editor', () => {
        this.requested = 'MapEditor';
      });
      menu('title-settings', new Rect(left, f(top + 204), bw, minorHeight), 'Settings', () => this.openSettings());
      if (hoveredItem !== this.hoveredTitleItem) {
        if (hoveredItem && this.intro === 'None' && this.titleSound)
          this.titleSound.play(new Sound(Cue.Click, f(0.35), 0));
        this.hoveredTitleItem = hoveredItem;
      }
      if (this.settingsOpen) this.drawSettings(width, height);
      else if (this.message)
        this.overlay.text(
          new Rect(24, f(top + 258), f(width - 48), 42),
          this.message,
          theme.danger,
          14,
          false,
          Align.Center,
        );
    } else {
      const session = this.active();
      if (!session) throw new Error('An active scene must own its application.');
      session.render(width, height, seconds);
      if (this.current !== 'Game' && !session.command('session.authoring')) {
        if (this.current === 'MapEditor') {
          this.retire(this.gameSession);
          this.gameSession = this.editorSession;
          this.editorSession = undefined;
          this.requested = 'Game';
        } else this.requested = 'Title';
      }
      if (this.intro === 'None' && (this.settingsOpen || !session.command('session.modal'))) {
        const bounds = new Rect(
          f(width - (this.touchInput ? 56 : 52)),
          12,
          this.touchInput ? 44 : 36,
          this.touchInput ? 44 : 36,
        );
        const state = button(this.overlay, 'settings', bounds, '', () => this.openSettings());
        hudGlyph(
          this.overlay,
          'cog',
          f(bounds.x + bounds.w / 2),
          f(bounds.y + bounds.h / 2 + (state.lift ?? 0)),
          state.hovered ? theme.accent : theme.text,
          1,
          tone(theme.raised, theme.light, state.hovered ? 0.16 : 0),
        );
        if (this.settingsOpen) this.drawSettings(width, height);
        else if (this.message && this.current === 'Game' && seconds < this.messageUntil) {
          const w = Math.min(300, f(width - 32)),
            toast = new Rect(f(f(width - w) / 2), 58, w, 30);
          tag(this.overlay, toast, { cut: 5, lip: 3 });
          this.overlay.text(toast.inset(4), this.message, theme.ink, 12, true, Align.Center);
          this.overlay.requestFrameAt(this.messageUntil);
        }
      }
    }
    if (this.intro !== 'None')
      this.overlay.rect(new Rect(0, 0, width, height), {
        r: 0,
        g: 0,
        b: 0,
        a: Math.trunc(f(Math.max(0, Math.min(1, this.fog)) * 255)),
      });
    this.overlay.end();
  }

  event(event: AppEvent): void {
    if (this.saga) {
      if (event.type === 'PointerMove') this.overlay.pointerMove(event.x, event.y);
      else if (event.type === 'PointerDown' && event.button === 1) {
        this.overlayPointer = this.overlay.controlAt(event.x, event.y);
        if (this.overlayPointer) this.overlay.pointerDown(event.x, event.y);
        else this.saga.next();
      } else if (event.type === 'PointerUp' && event.button === 1 && this.overlayPointer) {
        this.overlay.pointerUp(event.x, event.y);
        this.overlayPointer = false;
      } else if (event.type === 'KeyDown') {
        if (event.key === Key.Escape || event.text === 'escape') this.saga.skip();
        else if (event.key === Key.Enter || event.key === Key.Space) this.saga.next();
      }
      return;
    }
    if (this.intro !== 'None') return;
    if (this.settingsOpen) {
      if (event.type === 'PointerMove') this.overlay.pointerMove(event.x, event.y);
      else if (event.type === 'PointerDown' && event.button === 1) this.overlay.pointerDown(event.x, event.y);
      else if (event.type === 'PointerUp' && event.button === 1) this.overlay.pointerUp(event.x, event.y);
      else if (event.type === 'PointerCancel') {
        this.overlay.cancelPointer();
        this.overlayPointer = false;
      } else if (event.type === 'KeyDown') {
        if (event.key === Key.Escape || event.text === 'escape') this.closeSettings();
        else if ((event.control || event.meta) && event.text === 's' && this.current === 'Game')
          this.quickSave();
        else this.overlay.key(event.key, event.shift);
      }
      return;
    }
    if (this.current === 'Game' && this.active()?.command('session.modal')) {
      this.overlayPointer = false;
      this.active()?.event(event);
      return;
    }
    if (event.type === 'PointerCancel') {
      this.overlay.cancelPointer();
      this.overlayPointer = false;
      this.active()?.event(event);
      return;
    }
    if (
      event.type === 'KeyDown' &&
      (event.control || event.meta) &&
      event.text === 's' &&
      this.current === 'Game'
    ) {
      this.quickSave();
      return;
    }
    if (event.type === 'KeyDown' && event.text === 'escape' && this.current !== 'Game') {
      this.requested = 'Title';
      return;
    }
    if (event.type === 'PointerMove') this.overlay.pointerMove(event.x, event.y);
    if (event.type === 'PointerDown' && event.button === 1) {
      this.overlayPointer = this.overlay.controlAt(event.x, event.y);
      if (this.overlayPointer) {
        this.overlay.pointerDown(event.x, event.y);
        return;
      }
    }
    if (event.type === 'PointerUp' && event.button === 1 && this.overlayPointer) {
      this.overlay.pointerUp(event.x, event.y);
      this.overlayPointer = false;
      return;
    }
    if (
      event.type === 'KeyDown' &&
      this.overlay.focused() === 'settings' &&
      (event.key === Key.Enter || event.key === Key.Space)
    ) {
      this.overlay.key(event.key);
      return;
    }
    if (this.current === 'Title') {
      if (event.type === 'KeyDown') {
        this.overlay.key(event.key, event.shift);
        if (event.text === 'return' && !this.overlay.focused()) this.beginGame(false, undefined, true);
      }
      return;
    }
    // F3 opens an authoring tool, which the game scene does not offer; F2 is the game's own (select the army).
    if (this.current === 'Game' && event.type === 'KeyDown' && event.text === 'f3') return;
    if (!this.overlayPointer) this.active()?.event(event);
  }

  command(id: string, argument = ''): boolean {
    if (id === 'scene.title') {
      this.requested = 'Title';
      return true;
    }
    if (id === 'scene.new') {
      this.beginGame(false);
      return true;
    }
    if (id === 'scene.skip-saga') {
      this.sagaWanted = false;
      this.saga?.skip();
      return true;
    }
    if (id === 'scene.continue') {
      this.beginGame(true, argument ? this.slotFromArgument(argument) : undefined);
      return true;
    }
    if (id === 'scene.preview-saved') return this.previewFromSave;
    if (id === 'scene.is-transitioning') return this.intro !== 'None';
    if (id === 'scene.is-title') return this.current === 'Title';
    if (id === 'scene.is-game') return this.current === 'Game';
    if (id === 'ui.cursor' && this.settingsOpen) return false;
    if (id === 'session.save')
      return this.save(argument ? this.slotFromArgument(argument) : (this.currentSlot ?? 0));
    if (id === 'session.autosave') return this.save(autoSlot);
    if (id === 'edit.character') {
      if (this.current !== 'Title') return false;
      this.requested = 'CharacterStudio';
      return true;
    }
    if (id === 'edit.map') {
      if (this.current !== 'Title') return false;
      this.requested = 'MapEditor';
      return true;
    }
    return this.active()?.command(id, argument) ?? false;
  }
  properties(): Property[] {
    return this.active()?.properties() ?? [];
  }
  property(id: string, value: number): boolean {
    return this.active()?.property(id, value) ?? false;
  }
  actions(): { id: string; label: string }[] {
    return [
      { id: 'scene.title', label: 'Back to Title' },
      { id: 'session.save', label: 'Save' },
    ];
  }
  private active(): Application | undefined {
    return this.current === 'Game'
      ? this.gameSession
      : this.current === 'Title'
        ? undefined
        : this.editorSession;
  }
  private retire(session: Application | undefined): void {
    if (!session) return;
    session.command('session.suspend');
    this.retiring.push({ app: session, until: this.lastFrame + 1.5 });
  }
  private slotPath(slot: number): string {
    // Slot 1 keeps the pre-slot path so existing saves stay loadable.
    return slot === autoSlot
      ? this.savePath + '.auto'
      : slot
        ? `${this.savePath}.slot${slot + 1}`
        : this.savePath;
  }
  private slotFromArgument(argument: string): number {
    if (argument === 'auto') return autoSlot;
    const slot = Number(argument) - 1;
    return Number.isInteger(slot) && slot >= 0 && slot < saveSlotCount ? slot : 0;
  }
  private savedSlots(): number[] {
    const slots = [autoSlot];
    for (let slot = 0; slot < saveSlotCount; slot++) slots.push(slot);
    return slots.filter((slot) => this.services.exists(this.slotPath(slot)));
  }
  private latestSlot(): number | undefined {
    let latest: number | undefined,
      time = -1;
    for (const slot of this.savedSlots()) {
      const at = this.services.savedAt(this.slotPath(slot));
      if (at > time) {
        latest = slot;
        time = at;
      }
    }
    return latest;
  }
  /** The title shows and continues the autosave; manual slots are reached through Load Game. */
  private titleSlot(): number | undefined {
    return this.services.exists(this.slotPath(autoSlot)) ? autoSlot : this.latestSlot();
  }
  private slotDetail(slot: number): string {
    const path = this.slotPath(slot);
    if (!this.services.exists(path)) return '- -';
    const time = this.services.savedAt(path);
    if (!time) return 'Saved game';
    return new Date(time).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  private worldOnly(on: boolean): void {
    this.overlay.scene().visible(!on);
    this.gameSession?.command('session.world-only', on ? 'on' : 'off');
  }
  private drawSlots(width: number, height: number): void {
    const saving = this.settingsPage === 'Save',
      // The title theme is transparent; the cards need the opaque in-game palette.
      theme = gameTheme(),
      accent = this.overlay.theme().accent,
      close = () => this.closeSettings(),
      slots = [autoSlot];
    for (let slot = 0; slot < saveSlotCount; slot++) slots.push(slot);
    const usable = (slot: number) => (saving ? slot !== autoSlot : this.services.exists(this.slotPath(slot)));
    this.overlay.modal(`settings/slot${slots.find(usable) ?? 0}`, close);
    const viewport = new Rect(0, 0, width, height);
    this.overlay.control(
      'settings/backdrop',
      viewport,
      (event) => {
        if (event.type === EventType.Activate) close();
      },
      true,
      false,
    );
    this.overlay.rect(viewport, { r: 14, g: 12, b: 28, a: 170 });
    const columns = this.touchInput && height < 420 && width >= 480 ? 5 : 3,
      rows = Math.ceil(slots.length / columns),
      pad = width < 520 ? 14 : 24,
      gap = width < 520 ? 8 : 14,
      head = 56,
      foot = 60,
      caption = 42;
    // Budget for captions and controls first, then fit the 16:9 save pictures.
    const gutter = pad * 2 + gap * (columns - 1),
      maxShot = Math.max(1, Math.floor((height - 24 - head - foot - (rows - 1) * gap) / rows) - caption),
      card = Math.floor(Math.min((Math.min(680, width - 24) - gutter) / columns, 2 + maxShot * 16 / 9)),
      w = card * columns + gutter, shot = Math.round((card - 2) * 9 / 16),
      h = head + rows * (shot + caption) + (rows - 1) * gap + foot;
    const panel = new Rect(f(Math.round((width - w) / 2)), f(Math.round((height - h) / 2)), f(w), h);
    this.overlay.control('settings/panel', panel, () => {}, true, false);
    board(this.overlay, panel, { header: 46 });
    this.overlay.text(
      new Rect(f(panel.x + pad), f(panel.y + 9), f(panel.w - 80), 28),
      saving ? 'Save Game' : 'Load Game',
      theme.accent,
      18,
      true,
    );
    const closeSize = this.touchInput ? touchTarget : 28;
    const dismiss = new Rect(panel.x + panel.w - pad - closeSize, panel.y + (head - closeSize) / 2, closeSize, closeSize);
    this.closeMark(dismiss, close, theme);
    const small = card < 120;
    slots.forEach((slot, index) => {
      const bounds = new Rect(
          f(panel.x + pad + (index % columns) * (card + gap)),
          f(panel.y + head + Math.floor(index / columns) * (shot + caption + gap)),
          card,
          shot + caption,
        ),
        path = this.slotPath(slot),
        filled = this.services.exists(path),
        enabled = usable(slot),
        current = saving && slot === this.currentSlot;
      const hit = this.overlay.control(
        `settings/slot${slot}`,
        bounds,
        (event) => {
          if (event.type !== EventType.Activate) return;
          if (saving) this.save(slot);
          else if (this.current === 'Title') {
            this.closeSettings();
            this.beginGame(true, slot);
          } else {
            // Replacing a running game needs no title intro; the transition swaps sessions.
            this.newGame = false;
            this.continueGame = true;
            this.loadPath = path;
            this.currentSlot = slot === autoSlot ? undefined : slot;
            this.requested = 'Game';
          }
        },
        enabled,
      );
      const lit = enabled && (hit.hovered || hit.focused || hit.pressed);
      // A save is a tile; the one in use is trimmed in ochre.
      slab(this.overlay, bounds, lit ? tone(theme.raised, theme.light, 0.14) : theme.raised, {
        lip: 3,
        cut: 4,
        pressed: enabled && hit.pressed ? 1 : 0,
        trim: current ? accent : undefined,
      });
      const picture = new Rect(f(bounds.x + 4), f(bounds.y + 4), card - 8, Math.round(((card - 8) * 9) / 16));
      well(this.overlay, picture, undefined, { cut: 2 });
      const time = filled ? this.services.savedAt(path) : 0;
      if (filled)
        this.overlay.paint(`shot:${path}:${time}:${picture.x}:${picture.y}:${picture.w}`, () => {
          const bytes = this.services.saveShot(path);
          if (!bytes) return null;
          try {
            return new this.tvg.Picture()
              .load(bytes, { type: 'jpg' })
              .size(picture.w, picture.h)
              .translate(picture.x, picture.y);
          } catch {
            return null;
          }
        });
      if (!filled) this.overlay.text(picture, 'EMPTY', theme.muted, small ? 10 : 13, true, Align.Center);
      const label = new Rect(
        f(bounds.x + (small ? 6 : 10)),
        f(bounds.y + shot + 5),
        card - (small ? 12 : 20),
        16,
      );
      this.overlay.text(
        label,
        slot === autoSlot ? 'Autosave' : `Slot ${slot + 1}`,
        enabled ? theme.text : theme.muted,
        small ? 11 : 13,
        true,
      );
      this.overlay.text(
        new Rect(label.x, f(label.y + 17), label.w, 14),
        this.overlay.elideText(this.slotDetail(slot), label.w, small ? 9 : 11),
        theme.muted,
        small ? 9 : 11,
      );
    });
    const backH = this.touchInput ? touchTarget : 34;
    const footer = panel.y + panel.h - (foot + backH) / 2;
    if (saving && this.message)
      this.overlay.text(
        new Rect(f(panel.x + pad), footer, f(panel.w - pad * 2 - 110), 34),
        this.message,
        theme.text,
        12,
      );
    button(
      this.overlay,
      'settings/back',
      new Rect(f(f(panel.x + panel.w) - pad - 100), footer, 100, backH),
      this.current === 'Game' ? 'Back' : 'Cancel',
      () => {
        if (this.current !== 'Game') return close();
        this.settingsPage = 'Main';
        this.message = '';
      },
    );
  }
  /** The cross that closes a window. */
  private closeMark(bounds: Rect, close: () => void, theme: Theme): void {
    const state = button(this.overlay, 'settings/close', bounds, '', close, ButtonStyle.Quiet);
    hudGlyph(
      this.overlay,
      'close',
      f(bounds.x + bounds.w / 2),
      f(bounds.y + bounds.h / 2 + (state.lift ?? 0)),
      state.hovered || state.focused ? theme.accent : theme.text,
      0.8,
    );
  }
  private quickSave(): void {
    if (this.currentSlot !== undefined) this.save(this.currentSlot);
    else {
      this.closeSettings();
      this.openSettings('Save');
    }
  }
  private openSettings(page: SettingsPage = 'Main'): void {
    if (this.settingsOpen) return;
    this.settingsPage = page;
    this.settingsOpen = true;
    this.previewDirty = true;
    this.message = '';
    const session = this.active();
    if (session) {
      session.event(emptyEvent('PointerCancel'));
      session.command('session.freeze', 'on');
      session.command('session.suspend');
    }
  }
  private closeSettings(): void {
    if (!this.settingsOpen) return;
    this.settingsOpen = false;
    this.previewDirty = true;
    this.overlay.cancelPointer();
    this.overlayPointer = false;
    const session = this.active();
    if (session) {
      session.command('session.freeze', 'off');
      session.command('session.resume');
    }
  }
  /** Settings are a window of the game's own boards, also over the bare title menu. */
  private drawSettings(width: number, height: number): void {
    const theme = gameTheme();
    this.overlay.withTheme(theme, () => {
      if (this.settingsPage !== 'Main') this.drawSlots(width, height);
      else this.drawSettingsPage(width, height, theme);
    });
  }
  private drawSettingsPage(width: number, height: number, theme: Theme): void {
    const game = this.current === 'Game';
    const close = () => this.closeSettings();
    this.overlay.modal(game ? 'settings/save' : `settings/language/${locale()}`, close);
    const viewport = new Rect(0, 0, width, height);
    this.overlay.control(
      'settings/backdrop',
      viewport,
      (event) => {
        if (event.type === EventType.Activate) close();
      },
      true,
      false,
    );
    this.overlay.rect(viewport, { r: 14, g: 12, b: 28, a: 150 });
    const touch = this.touchInput, horizontal = touch && height < 450 && width >= 450,
      w = Math.min(touch ? (horizontal ? 520 : 370) : 320, width - 24),
      h = Math.min(touch ? (game ? horizontal ? 250 : 350 : 180) : game ? 370 : 188, height - 24),
      pitch = touch ? 52 : game ? Math.min(50, (h - 100) / 5) : 50,
      rowHeight = touch ? touchTarget : Math.min(40, pitch - 8);
    const panel = new Rect(f(f(width - w) / 2), f(f(height - h) / 2), w, h);
    this.overlay.control('settings/panel', panel, () => {}, true, false);
    board(this.overlay, panel, { header: 52 });
    this.overlay.text(
      new Rect(f(panel.x + 24), f(panel.y + 12), f(panel.w - 80), 28),
      'Settings',
      theme.accent,
      18,
      true,
    );
    const closeSize = touch ? touchTarget : 28;
    const dismiss = new Rect(panel.x + panel.w - 10 - closeSize, panel.y + (52 - closeSize) / 2, closeSize, closeSize);
    this.closeMark(dismiss, close, theme);
    const pad = touch ? 16 : 24, inner = panel.w - 2 * pad, left = panel.x + pad;
    const labelW = touch ? Math.min(104, inner * 0.32) : 110;
    let y = panel.y + (touch ? 60 : 68);
    this.overlay.text(new Rect(left, y, labelW, rowHeight), 'Language', theme.text, 13);
    const choice = (inner - labelW - (locales.length - 1) * 8) / locales.length;
    locales.forEach((name, index) =>
      button(
        this.overlay,
        `settings/language/${name}`,
        new Rect(left + labelW + (choice + 8) * index, y, choice, rowHeight),
        name,
        () => this.chooseLanguage(name),
        ButtonStyle.Default,
        true,
        undefined,
        locale() === name,
      ),
    );
    y = f(y + pitch);
    this.overlay.text(new Rect(left, y, labelW, rowHeight), 'Animations', theme.text, 13);
    const motionWidth = (inner - labelW - (motionPreferences.length - 1) * 8) / motionPreferences.length;
    motionPreferences.forEach((value, index) =>
      button(
        this.overlay,
        `settings/motion/${value}`,
        new Rect(left + labelW + (motionWidth + 8) * index, y, motionWidth, rowHeight),
        value,
        () => {
          setMotionPreference(value);
          this.invalidatePresentation();
        },
        ButtonStyle.Default,
        true,
        undefined,
        motionPreference() === value,
      ),
    );
    y = f(y + pitch);
    const actionWidth = horizontal ? (inner - 16) / 3 : inner;
    const action = (index: number) => new Rect(left + (horizontal ? index * (actionWidth + 8) : 0),
      y + (horizontal ? 0 : index * pitch), actionWidth, rowHeight);
    if (game) {
      button(
        this.overlay,
        'settings/save',
        action(0),
        'Save',
        () => {
          this.settingsPage = 'Save';
          this.message = '';
        },
        ButtonStyle.Primary,
      );
      button(
        this.overlay,
        'settings/load',
        action(1),
        'Load',
        () => {
          this.settingsPage = 'Load';
          this.message = '';
        },
        ButtonStyle.Default,
        this.savedSlots().length > 0,
      );
    }
    if (game)
      button(
        this.overlay,
        'settings/title',
        action(2),
        'Back to Title',
        () => {
          this.requested = 'Title';
        },
      );
    if (game && this.message)
      this.overlay.text(
        new Rect(f(panel.x + 24), f(panel.y + panel.h - 42), f(panel.w - 48), 24),
        this.message,
        theme.text,
        12,
        false,
        Align.Center,
      );
  }
  private transition(next: SceneId): void {
    this.hoveredTitleItem = '';
    if (this.settingsOpen) this.active()?.command('session.freeze', 'off');
    this.settingsOpen = false;
    this.root.remove();
    this.overlay.cancelPointer();
    this.overlayPointer = false;
    this.titleSound?.fadeOut();
    const active = this.active();
    if (active) {
      if (next !== 'Game') this.save(autoSlot);
      active.event(emptyEvent('PointerCancel'));
      active.command('session.suspend');
    }
    this.message = '';
    if (next === 'Game') {
      if (this.newGame || !this.gameSession || (this.continueGame && this.loadPath)) {
        const candidate = this.services.createApplication({
          ...this.options,
          studio: false,
          mapEditor: false,
          characterFile: '',
        });
        if (this.continueGame && !candidate.command('session.load', this.loadPath)) {
          this.message = 'Could not load the saved game.';
          next = 'Title';
          candidate.dispose();
        } else {
          this.retire(this.gameSession);
          this.gameSession = candidate;
        }
      }
      this.newGame = this.continueGame = false;
    } else if (next !== 'Title') {
      const launch = {
        ...this.options,
        demo: false,
        raid: false,
        buildingStudio: false,
        buildingFile: '',
        studio: next === 'CharacterStudio',
        mapEditor: next === 'MapEditor',
      };
      if (!launch.studio) launch.characterFile = '';
      this.retire(this.editorSession);
      this.editorSession = this.services.createApplication(launch);
    }
    this.current = next;
    const session = this.active();
    if (session) {
      session.setTouchInput?.(this.touchInput);
      session.command('session.resume');
      this.root.add(session.scene());
    }
    this.root.add(this.overlay.scene());
    if (this.current === 'Title') {
      this.retire(this.editorSession);
      this.editorSession = undefined;
      this.preparePreview();
      this.stage();
    }
  }
  /** background finishes the file on a worker; saves that must land before the page goes do not use it. */
  private save(slot: number, background = false): boolean {
    const auto = slot === autoSlot;
    if (this.current !== 'Game' || !this.gameSession) return false;
    // An unfinished intro has nothing worth replacing the previous save with.
    if (auto && this.intro !== 'None') return false;
    this.sinceSave = 0;
    this.milestoneDue = false;
    const ok = this.gameSession.command(background ? 'session.save-later' : 'session.save', this.slotPath(slot));
    if (ok) {
      // Only a save the player asked for pays for a picture of the scene.
      if (auto) this.services.clearSaveShot(this.slotPath(slot));
      else this.services.captureSave(this.slotPath(slot), (on) => this.worldOnly(on));
      this.services.syncSave();
    }
    if (ok && !auto) this.currentSlot = slot;
    this.message = ok ? (auto ? 'Autosaved.' : 'Game saved.') : 'Could not save the game.';
    this.messageUntil = this.lastFrame + (auto && ok ? 1.5 : 2.5);
    return ok;
  }
  private preparePreview(): void {
    this.preview?.dispose();
    this.preview = this.services.createPreview(
      this.options.world === 'Designed'
        ? this.services.designedWorldSeed
        : (this.options.seed ?? this.services.randomDevice()),
    );
    this.previewFromSave = false;
    const latest = this.titleSlot();
    if (latest !== undefined) {
      if (this.services.loadPreview(this.preview, this.slotPath(latest))) this.previewFromSave = true;
      else this.message = 'Could not preview the save. Showing a new world.';
    } else if (this.options.mapFile) this.preview.loadMapFile(this.options.mapFile);
    this.preview.selectPeople([]);
    this.titlePlay = startTitlePlay(this.preview, this.services.randomDevice(), this.previewFromSave);
    if (!this.titleSound) this.titleSound = this.services.createSound();
    this.titleSound.fadeIn();
  }

  private static ease(t: number): number {
    t = f(Math.max(0, Math.min(1, t)));
    return f(f(t * t) * f(3 - f(2 * t)));
  }
  private static blend(a: Camera, b: Camera, t: number): Camera {
    t = SceneApplication.ease(t);
    return {
      x: f(a.x + f(f(b.x - a.x) * t)),
      y: f(a.y + f(f(b.y - a.y) * t)),
      zoom: f(a.zoom + f(f(b.zoom - a.zoom) * t)),
    };
  }
  private settlementCamera(): Camera {
    if (!this.preview) throw new Error('The title must own a preview world.');
    const p = this.preview.state().camp()?.center ?? this.preview.state().map().camp();
    return { x: f(f(p.x - p.y) * 32), y: f(f(f(p.x + p.y) * 16) - 32), zoom: f(1.4) };
  }
  /** `saga` tells the opening story first; scripted starts go straight to the shore. */
  private beginGame(continuing: boolean, slot?: number, saga = false): void {
    if (this.intro !== 'None' || this.current !== 'Title') return;
    this.sagaWanted = saga && !continuing;
    this.newGame = !continuing;
    this.continueGame = continuing;
    slot = continuing ? (slot ?? this.titleSlot()) : undefined;
    this.loadPath = slot === undefined ? '' : this.slotPath(slot);
    // Without a save, Continue resumes the session already in memory and keeps its slot.
    if (this.loadPath || !continuing) this.currentSlot = slot === autoSlot ? undefined : slot;
    this.intro = 'Cover';
    this.introTime = 0;
    this.overlay.cancelPointer();
    if (this.preview) {
      this.introFrom = { ...this.preview.view() };
      this.introTo = this.settlementCamera();
    }
  }
  private drawSagaCaption(width: number, height: number): void {
    const saga = this.saga;
    if (!saga) return;
    const { text, shown } = saga.caption(),
      top = saga.captionTop(width, height),
      band = f(height - top),
      ink = { r: 236, g: 226, b: 204, a: Math.trunc(255 * shown) };
    if (text && shown > 0) {
      const size = Math.min(34, Math.max(14, band * 0.3)),
        fit = f(width - 32) / Math.max(1, this.overlay.textWidth(text, size));
      this.overlay.text(
        new Rect(8, f(top + band * 0.18), f(width - 16), f(band * 0.5)),
        text,
        ink,
        f(size * Math.min(1, fit)),
        false,
        Align.Center,
      );
    }
    const skip = new Rect(f(width - 96), f(height - 38), 84, 28);
    button(this.overlay, 'saga-skip', skip, 'Skip', () => this.saga?.skip(), ButtonStyle.Quiet);
    this.overlay.requestAnimationFrame();
  }
  private endSaga(): void {
    const saga = this.saga;
    if (!saga) return;
    this.saga = undefined;
    this.root.remove(saga.paint);
    saga.dispose();
  }
  private stage(): void {
    this.root.remove();
    // Opaque story panels replace the world, so the GPU must not draw it underneath.
    if (this.saga) this.root.add(this.saga.paint);
    else if (this.preview) this.root.add(this.preview.worldScene());
    this.root.add(this.overlay.scene());
  }
  private advanceIntro(dt: number, width: number, height: number): void {
    this.introTime += dt;
    if (this.intro === 'Saga') {
      if (this.saga?.advance(dt, width, height)) return;
      this.endSaga();
      this.overlay.cancelPointer();
      this.overlayPointer = false;
      this.intro = 'Loading';
      this.introTime = 0;
      this.fog = 1;
      return;
    }
    if (this.intro === 'Cover') {
      this.preview?.setView(SceneApplication.blend(this.introFrom, this.introTo, f(this.introTime / 1.6)));
      this.fog = SceneApplication.ease(f(this.introTime / 0.7));
      if (this.introTime >= 0.7) {
        this.intro = this.sagaWanted ? 'Saga' : 'Loading';
        this.introTime = 0;
        if (this.sagaWanted) {
          this.sagaWanted = false;
          this.titleSound?.fadeOut();
          this.saga = new IntroSaga(this.tvg, reducedMotionPreferred());
          this.saga.advance(0, width, height);
          this.stage();
        }
      }
    } else if (this.intro === 'Loading') {
      this.fog = 1;
      if (this.introTime < 0.18) return;
      this.transition('Game');
      if (this.current !== 'Game') {
        this.intro = 'None';
        this.fog = 0;
        return;
      }
      const session = this.gameSession;
      if (!session) throw new Error('The game scene must own a session.');
      session.command('session.freeze', 'on');
      session.command('session.focus-settlement');
      for (const property of session.properties()) {
        if (property.id === 'camera.x') this.introTo.x = f(property.value);
        if (property.id === 'camera.y') this.introTo.y = f(property.value);
        if (property.id === 'zoom') this.introTo.zoom = f(property.value);
      }
      this.introFrom = { ...(this.preview?.view() ?? this.introTo) };
      this.intro = 'Reveal';
      this.introTime = 0;
    } else if (this.intro === 'Reveal') {
      const camera = SceneApplication.blend(this.introFrom, this.introTo, f(this.introTime / 1.1));
      this.gameSession?.property('camera.x', camera.x);
      this.gameSession?.property('camera.y', camera.y);
      this.gameSession?.property('zoom', camera.zoom);
      this.fog = f(1 - SceneApplication.ease(f(this.introTime / 1.1)));
      if (this.introTime >= 1.1) {
        this.intro = 'None';
        this.fog = 0;
        this.gameSession?.command('session.freeze', 'off');
      }
    }
  }
  dispose(): void {
    this.root.remove();
    this.root.dispose();
    this.overlay.dispose();
    this.gameSession?.dispose();
    this.gameSession = undefined;
    this.editorSession?.dispose();
    this.editorSession = undefined;
    this.preview?.dispose();
    this.preview = undefined;
    this.saga?.dispose();
    this.saga = undefined;
    this.titleSound?.dispose();
    this.titleSound = undefined;
    for (const session of this.retiring) session.app.dispose();
    this.retiring = [];
  }
}
