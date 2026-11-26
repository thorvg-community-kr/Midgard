import {
  Align,
  ButtonStyle,
  Key,
  Rect,
  TextInput,
  board,
  button,
  rgba,
  setTransform,
  textField,
  well,
} from '../../../../packages/native-ui/src';
import { Resources, Structure } from '../../../../packages/engine/src/building-catalog';
import {
  defaultOffering,
  maxOfferingGoods,
  offeringBonus,
  offeringKeys,
  offeringStep,
  offeringTotal,
  residentStartingLevel,
  type OfferingKey,
} from '../../../../packages/engine/src/prayer-offering';
import { altarCap } from '../../../../packages/engine/src/altar-cap';
import type { Town } from '../../../../packages/engine/src/town';
import type { Building } from '../../../../packages/engine/src/town-models';
import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';
import { OfferingScene, offeringIcon } from '../../../../packages/native-renderer/src/offering-scene';
import { WebCanvasAdapter } from '../../../../packages/native-renderer/src/webcanvas-adapter';
import type { GameAppState } from './game-app-state';
import type { AppEvent } from './application-contracts';
import { hudPaint } from './hud-paint';
import { renderResidentCreation, type ResidentCreationView } from './resident-creation';
import { ResidentDraft } from './resident-draft';
import { beginResidentArrival } from './resident-arrival';
import { ResidentPresetPanel, renderResidentPresets } from './resident-preset-panel';

const resourceOrder: OfferingKey[] = ['food', 'water', 'bones', 'gold', 'stone'];
const materials: Record<OfferingKey, { name: string; cue: Cue; take: Cue }> = {
  food: { name: 'Food', cue: Cue.OfferFood, take: Cue.OfferTakeFood },
  water: { name: 'Water', cue: Cue.OfferWater, take: Cue.OfferTakeWater },
  bones: { name: 'Bones', cue: Cue.OfferBones, take: Cue.OfferTakeBones },
  gold: { name: 'Gold', cue: Cue.OfferGold, take: Cue.OfferTakeGold },
  stone: { name: 'Stone', cue: Cue.OfferStone, take: Cue.OfferTakeStone },
};
const materialGain = 0.72;

export function altarInspector(this: GameAppState, building: Building, panel: Rect, draw: boolean): number {
  const buttonH = this.touchMode ? 44 : 28, h = 50 + buttonH;
  if (!draw) return h;
  const c = this.context,
    t = this.theme,
    x = panel.x + 12,
    w = panel.w - 24;
  c.text(new Rect(x, panel.y + 8, w, 24), 'Altar of Odin', t.text, 17, true);
  button(
    c,
    'altar-pray',
    new Rect(x, panel.y + 39, w, buttonH),
    'Prepare an offering',
    () => openPrayer.call(this, building.id),
    ButtonStyle.Primary,
    building.built() && building.faction === this.town.controlFaction && building.health > 0,
  );
  return h;
}

export interface PrayerDialog extends ResidentCreationView {
  town: Town;
  altar: number;
  previousPaused: boolean;
  editing: boolean;
  presets: ResidentPresetPanel | null;
  error: string;
  offering: Resources;
  materialPage: number;
  inputs: Record<OfferingKey, TextInput>;
  scene: OfferingScene;
  adapter: WebCanvasAdapter;
}

type AltarApp = GameAppState & { selectPeople(ids: number[]): void };

export function openPrayer(this: GameAppState, altar: number): void {
  const place = this.town.building(altar);
  if (
    this.prayer ||
    !place?.built() ||
    place.health <= 0 ||
    place.kind !== Structure.Shrine ||
    place.faction !== this.town.controlFaction
  )
    return;
  const offering = defaultOffering();
  this.prayer = {
    town: this.town,
    altar,
    previousPaused: this.paused,
    editing: false,
    presets: null,
    error: '',
    offering,
    materialPage: 0,
    inputs: Object.fromEntries(
      offeringKeys.map((key) => [key, new TextInput(offering[key] ? String(offering[key]) : '')]),
    ) as Record<OfferingKey, TextInput>,
    draft: new ResidentDraft(this.town, place.center),
    appearanceTab: 'hair',
    mixedColor: null,
    stylePicker: null,
    scene: new OfferingScene(),
    adapter: new WebCanvasAdapter(this.context.tvg),
  };
  this.paused = true;
  this.pan.x = this.pan.y = 0;
  this.context.cancelPointer();
}

export function closePrayer(this: GameAppState): void {
  const state = this.prayer;
  if (!state) return;
  this.prayer = null;
  this.paused = state.previousPaused;
  // The previous frame borrows the stage paint until Context.end detaches it.
  this.context.deferRelease(() => state.adapter.dispose());
}

export function handlePrayerEvent(this: GameAppState, event: AppEvent): boolean {
  const state = this.prayer;
  if (!state) return false;
  const c = this.context;
  if (event.type === 'PointerMove') c.pointerMove(event.x, event.y);
  else if (event.type === 'PointerDown' && event.button === 1) c.pointerDown(event.x, event.y);
  else if (event.type === 'PointerUp' && event.button === 1) {
    c.pointerUp(event.x, event.y);
    if (event.pointerType === 'touch') c.setPointerPosition(-1, -1);
  } else if (event.type === 'PointerCancel') c.cancelPointer();
  else if (event.type === 'KeyDown') c.key(event.key, event.shift);
  else if (event.type === 'Text') {
    if (state.presets) {
      const panel = state.presets;
      const id = c.focused();
      if (id === 'prayer-preset-name' && panel.tab === 'saved') c.textInput(event.text);
      if (id === 'prayer-code-input' && panel.tab === 'code') {
        const value = event.text.trim();
        // A whole code pasted from the keyboard replaces the previous entry just like the Paste button.
        if (value.length <= 128 && /^MG\d+-/i.test(value)) {
          panel.input.value = value;
          panel.input.cursor = panel.input.byteLength();
        } else if (panel.input.value.length + value.length <= 128) c.textInput(value);
        else panel.message('Invalid appearance code.', true);
      }
    } else if (state.editing && c.focused() === 'prayer-name') {
      const clean = event.text.replace(/[\u0000-\u001f\u007f]/gu, '');
      if (state.draft.name.byteLength() + new TextEncoder().encode(clean).length <= 96) c.textInput(clean);
    } else if (!state.editing && /^\d+$/.test(event.text) && event.text.length <= 4) {
      const key = offeringKeys.find((key) => c.focused() === `offering-${key}`);
      if (key) {
        c.textInput(event.text);
        updateOfferingAmount(this, state, key);
      }
    }
  }
  return true;
}

function readOffering(state: PrayerDialog): void {
  for (const key of offeringKeys) {
    const input = state.inputs[key];
    if (input.value.length > 4) {
      input.value = input.value.slice(0, 4);
      input.cursor = input.byteLength();
    }
    state.offering[key] = Number(input.value || 0);
  }
}

function updateOfferingAmount(app: GameAppState, state: PrayerDialog, key: OfferingKey): void {
  const previous = state.offering[key];
  readOffering(state);
  const amount = state.offering[key];
  if (amount === previous || offeringTotal(state.offering) > maxOfferingGoods) return;
  const altar = state.town.building(state.altar);
  if (!altar || amount > state.town.stock(state.town.settlementOf(altar))[key]) return;
  const material = materials[key];
  const sound = amount < previous ? new Sound(material.take, 0.58) : new Sound(material.cue, materialGain);
  if (amount < previous) sound.pitch = 1.12;
  app.cues.push(sound);
}

function creationProblem(state: PrayerDialog): string {
  return (
    state.town.altarOfferingReason(state.altar, state.offering) ||
    (state.draft.name.value.trim() ? '' : 'Enter a name.')
  );
}

function createResident(app: AltarApp, state: PrayerDialog): void {
  if (app.prayer !== state || app.town !== state.town || state.presets) return;
  // Text, button activation and keyboard repeats can arrive before the next draw.
  readOffering(state);
  if (creationProblem(state)) return;
  const { born } = app.town.offerAtAltar(state.altar, state.offering, state.draft.identity());
  if (!born) {
    state.error = 'Offering failed.';
    return;
  }
  closePrayer.call(app);
  app.selectPeople([born.id]);
  // The altar introduces this resident; their selection voice belongs to a later player click.
  app.heardChosen = [born.id];
  beginResidentArrival(app, born);
  // One sound per material in the paid offering, with time for each impact before the rune rings.
  let delay = 0;
  for (const key of resourceOrder) {
    if (state.offering[key] <= 0) continue;
    const sound = new Sound(materials[key].cue, materialGain);
    sound.delay = delay;
    app.cues.push(sound);
    delay += 0.16;
  }
  const accepted = new Sound(Cue.OfferAccepted, 0.7);
  // Let the rune ring as the resident emerges, after the last material has landed.
  accepted.delay = Math.max(0.48, delay);
  app.cues.push(accepted);
}

function showMaterials(app: GameAppState, state: PrayerDialog, stage: Rect): void {
  const c = app.context;
  state.scene.update(stage.w, stage.h, state.offering);
  well(c, new Rect(stage.x - 2, stage.y - 2, stage.w + 4, stage.h + 4), undefined, {
    rim: app.theme.border,
    cut: 0,
  });
  c.clip(stage, () => {
    const paint = state.adapter.sync(state.scene.root);
    setTransform(paint, {
      e11: 1,
      e12: 0,
      e13: stage.x,
      e21: 0,
      e22: 1,
      e23: stage.y,
      e31: 0,
      e32: 0,
      e33: 1,
    });
    c.add(paint);
    state.adapter.collect([state.scene.root]);
  });
}

function materialRows(app: GameAppState, state: PrayerDialog, area: Rect, stock: Resources): void {
  const c = app.context,
    t = app.theme,
    paged = app.touchMode && area.h < 47 * resourceOrder.length,
    perPage = paged ? Math.max(1, Math.floor((area.h - 50) / 47)) : resourceOrder.length,
    pages = Math.ceil(resourceOrder.length / perPage),
    rowH = Math.min(57, (area.h - (paged ? 50 : 0)) / perPage);
  state.materialPage = Math.min(state.materialPage, pages - 1);
  const start = state.materialPage * perPage;
  for (const [index, key] of resourceOrder.slice(start, start + perPage).entries()) {
    const y = area.y + index * rowH,
      h = Math.min(app.touchMode ? 44 : 38, rowH - 3),
      mid = y + rowH / 2,
      iconSize = Math.min(34, rowH - 4),
      controls = app.touchMode ? 185 : Math.min(158, area.w * 0.5),
      x = area.x + area.w - controls,
      nameX = area.x + iconSize + 5,
      labelW = x - nameX - 2;
    c.paint(JSON.stringify(['offering-icon', key, area.x, mid, iconSize]), () => {
      const node = offeringIcon(key),
        scale = iconSize / 30;
      node.transform([scale, 0, area.x + iconSize / 2, 0, scale, mid, 0, 0, 1]);
      return hudPaint(c, node);
    });
    c.text(new Rect(nameX, y, labelW, rowH * 0.53), materials[key].name, t.text, 13, true);
    c.text(new Rect(nameX, y + rowH * 0.5, labelW, rowH * 0.45), `${stock[key]} available`, t.muted, 11);
    const input = state.inputs[key],
      total = offeringTotal(state.offering),
      limit = Math.max(0, Math.min(stock[key], maxOfferingGoods - total + state.offering[key]));
    const step = (delta: number) => {
      readOffering(state);
      const amount = state.offering[key],
        room = maxOfferingGoods - offeringTotal(state.offering);
      const next =
        delta < 0
          ? Math.max(0, amount + delta)
          : amount + Math.max(0, Math.min(delta, stock[key] - amount, room));
      input.value = String(next);
      input.cursor = input.byteLength();
      updateOfferingAmount(app, state, key);
      state.error = '';
    };
    const part = (controls - 9) / 4,
      at = (i: number) => new Rect(x + i * (part + 3), mid - h / 2, part, h);
    button(c, `offering-less-${key}`, at(0), '−', () => step(-1), ButtonStyle.Quiet, state.offering[key] > 0);
    textField(c, `offering-${key}`, at(1), input, '0', true, (pressed) => {
      if (pressed !== Key.Backspace && pressed !== Key.Delete) return false;
      input.edit(pressed);
      updateOfferingAmount(app, state, key);
      return true;
    }, undefined, { fontSize: 12 });
    button(
      c,
      `offering-more-${key}`,
      at(2),
      '+',
      () => step(1),
      ButtonStyle.Quiet,
      state.offering[key] < limit,
    );
    button(
      c,
      `offering-bundle-${key}`,
      at(3),
      `+${offeringStep}`,
      () => step(offeringStep),
      ButtonStyle.Quiet,
      state.offering[key] + offeringStep <= limit,
    );
  }
  if (paged) {
    const y = area.y + area.h - 44;
    button(c, 'offering-prev', new Rect(area.x, y, 44, 44), '<', () => --state.materialPage, ButtonStyle.Quiet, state.materialPage > 0);
    c.text(new Rect(area.x + 44, y, area.w - 88, 44), `${state.materialPage + 1} / ${pages}`, t.muted, 13, false, Align.Center);
    button(c, 'offering-next', new Rect(area.x + area.w - 44, y, 44, 44), '>', () => ++state.materialPage, ButtonStyle.Quiet, state.materialPage + 1 < pages);
  }
}

export function renderPrayer(this: AltarApp, width: number, height: number): void {
  const state = this.prayer;
  if (!state) return;
  const altar = this.town.building(state.altar);
  if (state.town !== this.town || !altar) {
    closePrayer.call(this);
    return;
  }
  const c = this.context,
    t = this.theme;
  readOffering(state);
  const switchEditor = (editing: boolean) => {
    if (this.prayer !== state) return;
    state.editing = editing;
    state.mixedColor = null;
    state.stylePicker = null;
    c.focus(editing ? 'prayer-look-random' : 'prayer-customize');
  };
  const depart = () => {
    if (this.prayer !== state) return;
    if (state.presets) {
      if (state.presets.removing) {
        state.presets.removing = null;
        c.focus('prayer-presets-saved');
      } else {
        state.presets = null;
        c.focus('prayer-presets');
      }
      return;
    }
    if (state.editing) {
      if (state.mixedColor || state.stylePicker) {
        c.focus(state.mixedColor ? 'prayer-' + state.mixedColor + '-mix' : 'prayer-' + state.stylePicker!.id + '-pick');
        state.mixedColor = null;
        state.stylePicker = null;
        return;
      }
      switchEditor(false);
      return;
    }
    closePrayer.call(this);
  };
  c.modal('prayer-customize', depart);
  c.control('prayer-backdrop', new Rect(0, 0, width, height), undefined, true, false);
  c.rect(new Rect(0, 0, width, height), rgba(14, 12, 28, 200));
  const margin = width < 440 || height < 440 ? 6 : 14,
    w = Math.min(870, width - margin * 2),
    preferredH = w >= 636 ? (state.editing ? 530 : 475) : 680,
    h = Math.min(preferredH, height - margin * 2),
    panel = new Rect((width - w) / 2, (height - h) / 2, w, h),
    pad = w < 400 ? 12 : 18,
    x = panel.x + pad,
    innerW = w - pad * 2,
    short = h < 460,
    header = this.touchMode ? 54 : short ? 38 : 52,
    footer = this.touchMode ? 72 : short ? 60 : 74,
    body = new Rect(x, panel.y + header, innerW, h - header - footer - 4),
    footY = panel.y + h - footer,
    buttonY = footY + (this.touchMode ? 21 : short ? 20 : 26),
    buttonH = this.touchMode ? 44 : short ? 31 : 38;
  c.control('prayer-panel', panel, undefined, true, false);
  board(c, panel, { header: header - 5 });
  const title = state.presets ? 'Appearance presets' : state.editing ? 'Customize resident' : 'An offering to Odin';
  c.text(new Rect(x, panel.y + 4, innerW - 90, header - 9), title, t.accent, short ? 16 : 20, true);
  if (state.editing && !state.presets)
    button(
      c,
      'prayer-presets',
      new Rect(panel.x + w - pad - 84, panel.y + 4, 84, header - 10),
      'Presets',
      () => {
        state.presets = new ResidentPresetPanel(state.draft);
        c.focus('prayer-presets-saved');
      },
      ButtonStyle.Default,
    );
  if (!state.editing)
    button(
      c,
      'prayer-cancel',
      new Rect(panel.x + w - pad - 67, panel.y + 5, 67, this.touchMode ? 44 : header - 14),
      'Cancel',
      depart,
      ButtonStyle.Quiet,
    );
  if (state.presets) {
    renderResidentPresets(this, state.presets, body);
    const status = state.presets.notice;
    if (status)
      c.text(
        new Rect(x, footY, innerW, short ? 18 : 23),
        c.elideText(status, innerW, 12),
        state.presets.error ? t.danger : t.muted, 12,
      );
    button(
      c,
      'prayer-presets-back',
      new Rect(x, buttonY, innerW, buttonH),
      'Back to customization',
      () => {
        state.presets = null;
        c.focus('prayer-presets');
      },
      ButtonStyle.Quiet,
    );
    return;
  }
  if (state.editing) renderResidentCreation(this, state, body);
  else {
    const wide = body.w >= 590 || (this.touchMode && short && body.w >= 455),
      colW = wide ? (this.touchMode ? Math.min(body.w * 0.48, body.w - 282) : body.w * 0.53) : body.w,
      stageH = wide ? body.h - 50 : Math.min(colW / 2.08, body.h * 0.34),
      stage = new Rect(body.x, body.y + 2, colW, stageH);
    showMaterials(this, state, stage);
    const readY = stage.y + stage.h + 8,
      available = this.town.stock(this.town.settlementOf(altar));
    const bonus = offeringBonus(state.offering),
      summaryH = 44,
      rows = wide
        ? new Rect(stage.x + colW + 18, body.y, body.w - colW - 18, body.h)
        : new Rect(body.x, readY + summaryH, body.w, Math.max(5, body.y + body.h - readY - summaryH));
    c.text(
      new Rect(stage.x, readY, colW, 19),
      `Settler · Level ${residentStartingLevel(this.town)}`,
      t.text,
      14,
      true,
    );
    c.text(new Rect(stage.x, readY + 22, colW, 18), `Stat points: ${1 + bonus}`, t.accent, 12, true);
    materialRows(this, state, rows, available);
    if (wide && rows.h > 315)
      c.text(
        new Rect(rows.x, rows.y + 292, rows.w, 20),
        `Residents: ${this.town.population()} / ${altarCap(this.town)}`,
        t.muted,
        11,
      );
  }
  const reason = creationProblem(state) || state.error;
  if (reason)
    c.text(new Rect(x, footY, innerW, short ? 18 : 23), c.elideText(reason, innerW, 11), t.danger, 11);
  const half = (innerW - 8) / 2;
  button(
    c,
    state.editing ? 'prayer-back' : 'prayer-customize',
    new Rect(x, buttonY, half, buttonH),
    state.editing ? 'Back to offering' : 'Customize resident',
    () => switchEditor(!state.editing),
    ButtonStyle.Quiet,
  );
  button(
    c,
    'prayer-confirm',
    new Rect(x + half + 8, buttonY, half, buttonH),
    'Create resident',
    () => createResident(this, state),
    ButtonStyle.Primary,
    !creationProblem(state),
  );
}
