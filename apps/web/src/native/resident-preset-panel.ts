import {
  Align,
  ButtonStyle,
  Rect,
  TextInput,
  button,
  textField,
  well,
} from '../../../../packages/native-ui/src';
import { decodeAppearanceCode } from '../../../../packages/engine/src/appearance-code';
import { Calling, Person, Race, Role } from '../../../../packages/engine/src/person';
import { translate } from '../../../../packages/localization/src';
import { Mood, personPortrait } from '../../../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import { portrait } from './resident-portrait';
import type { GameAppState } from './game-app-state';
import { hudPaint } from './hud-paint';
import type { ResidentDraft } from './resident-draft';
import {
  listResidentPresets,
  removeResidentPreset,
  saveResidentPreset,
  type ResidentPreset,
} from './resident-presets';
import { settlementLooks } from './settlement-looks';

type Page = 'saved' | 'residents' | 'code';

export class ResidentPresetPanel {
  tab: Page = 'saved';
  page = 0;
  rows: ResidentPreset[] = [];
  removing: ResidentPreset | null = null;
  readonly name = new TextInput();
  readonly input = new TextInput();
  notice = '';
  error = false;
  code: string;

  constructor(readonly draft: ResidentDraft) {
    this.code = draft.appearanceCode();
    this.readLibrary();
  }
  message(text: string, error = false): void {
    this.notice = text;
    this.error = error;
  }
  readLibrary(): void {
    try {
      this.rows = listResidentPresets();
    } catch {
      this.rows = [];
      this.message('Could not load presets.', true);
    }
  }
  use(code: string): boolean {
    if (!this.draft.applyAppearanceCode(code)) {
      this.message('Invalid appearance code.', true);
      return false;
    }
    this.code = this.draft.appearanceCode();
    this.message('Appearance applied.');
    return true;
  }
  save(): void {
    if (!this.name.value.trim()) return;
    try {
      const saved = saveResidentPreset(this.name.value, this.code);
      this.rows = [saved, ...this.rows.filter((row) => row.code !== saved.code)];
      this.page = 0;
      this.removing = null;
      this.name.value = '';
      this.name.cursor = 0;
      this.message('Preset saved.');
    } catch {
      this.message('Save failed. Copy the code instead.', true);
    }
  }
  remove(): void {
    const row = this.removing;
    if (!row) return;
    try {
      removeResidentPreset(row.code);
      this.rows = this.rows.filter((entry) => entry.code !== row.code);
      this.removing = null;
      this.message('Preset deleted.');
    } catch {
      this.message('Could not delete this preset.', true);
    }
  }
}

async function copyCode(app: GameAppState, panel: ResidentPresetPanel): Promise<void> {
  const code = panel.code;
  try {
    await navigator.clipboard.writeText(code);
    if (app.prayer?.presets === panel) panel.message('Appearance code copied.');
  } catch {
    if (app.prayer?.presets !== panel || panel.tab !== 'code') return;
    // A native selectable field also works in browsers without clipboard permission.
    window.prompt(translate('Copy your appearance code.'), code);
  }
}

async function pasteCode(app: GameAppState, panel: ResidentPresetPanel): Promise<void> {
  const previous = panel.input.value;
  try {
    const pasted = (await navigator.clipboard.readText()).trim();
    if (app.prayer?.presets !== panel || panel.tab !== 'code' || panel.input.value !== previous) return;
    if (!pasted || pasted.length > 128) {
      panel.message('Invalid appearance code.', true);
      return;
    }
    panel.input.value = pasted;
    panel.input.cursor = panel.input.byteLength();
    panel.message('');
  } catch {
    if (app.prayer?.presets !== panel || panel.tab !== 'code') return;
    panel.message('Paste into the code field.', true);
    app.context.focus('prayer-code-input');
  }
}

function codePage(app: GameAppState, panel: ResidentPresetPanel, r: Rect): void {
  const c = app.context,
    t = app.theme;
  const row = Math.min(40, (r.h - 12) / 5);
  const fieldY = r.y + 3 * row + 6;
  c.text(new Rect(r.x, r.y, r.w - 94, row), 'Current appearance code', t.text, 14, true);
  button(
    c,
    'prayer-code-copy',
    new Rect(r.x + r.w - 90, r.y, 90, row),
    'Copy code',
    () => void copyCode(app, panel),
    ButtonStyle.Default,
  );
  const strip = new Rect(r.x, r.y + row + 3, r.w, row);
  well(c, strip);
  const size = c.textWidth(panel.code, 13) > strip.w - 14 ? 11 : 13;
  c.text(strip.inset(3), panel.code, t.text, size, false, Align.Center);
  c.text(new Rect(r.x, r.y + 2 * row + 6, r.w, row), 'Use an appearance code', t.text, 14, true);
  textField(
    c,
    'prayer-code-input',
    new Rect(r.x, fieldY, r.w - 62, row),
    panel.input,
    'Paste a code here',
    true,
    undefined,
    undefined,
    { fontSize: 13 },
  );
  button(
    c,
    'prayer-code-clear',
    new Rect(r.x + r.w - 58, fieldY, 58, row),
    'Clear field',
    () => {
      panel.input.value = '';
      panel.input.cursor = 0;
      panel.message('');
      c.focus('prayer-code-input');
    },
    ButtonStyle.Quiet,
    !!panel.input.value,
  );
  const half = (r.w - 6) / 2,
    y = fieldY + row + 4;
  button(
    c,
    'prayer-code-paste',
    new Rect(r.x, y, half, row),
    'Paste code',
    () => void pasteCode(app, panel),
    ButtonStyle.Quiet,
  );
  button(
    c,
    'prayer-code-apply',
    new Rect(r.x + half + 6, y, half, row),
    'Apply code',
    () => panel.use(panel.input.value),
    ButtonStyle.Primary,
    !!panel.input.value.trim(),
  );
}

function thumbnail(app: GameAppState, preset: ResidentPreset, r: Rect): void {
  const c = app.context;
  c.paint(JSON.stringify(['resident-preset-face', preset.code, r]), () => {
    const look = decodeAppearanceCode(preset.code);
    if (!look) return null;
    const subject = new Person(0, '', Role.Resident, Calling.Settler, Race.Human, 0, { x: 0, y: 0 });
    subject.customLook = look;
    const paint = hudPaint(c, personPortrait(subject, Mood.Content, r.w, r.h, portraitBackdrop()));
    paint.translate(r.x, r.y);
    return paint;
  });
}

function looksPage(app: GameAppState, p: ResidentPresetPanel, r: Rect): void {
  const c = app.context,
    t = app.theme;
  const saved = p.tab === 'saved';
  const rowH = Math.min(44, (r.h - 8) / 3);
  let y = r.y;
  if (saved && !p.removing) {
    const saveW = Math.min(115, r.w * 0.29);
    c.verbatim(
      () =>
        textField(
          c,
          'prayer-preset-name',
          new Rect(r.x, y, r.w - saveW - 6, rowH),
          p.name,
          'Preset name',
          true,
          undefined,
          undefined,
          { fontSize: 13 },
        ),
      !!p.name.value,
    );
    button(
      c,
      'prayer-preset-save',
      new Rect(r.x + r.w - saveW, y, saveW, rowH),
      'Save preset',
      () => p.save(),
      ButtonStyle.Primary,
      !!p.name.value.trim(),
    );
    y += rowH + 8;
  }
  const removing = p.removing;
  if (removing) {
    c.text(new Rect(r.x, y, r.w, rowH), 'Delete this saved look?', t.text, 14, true);
    c.verbatim(() =>
      c.text(new Rect(r.x, y + rowH, r.w, rowH), c.elideText(removing.name, r.w, 14), t.muted, 14),
    );
    const half = (r.w - 5) / 2;
    button(
      c,
      'prayer-preset-delete-cancel',
      new Rect(r.x, y + 2 * rowH, half, rowH),
      'Cancel',
      () => {
        p.removing = null;
      },
      ButtonStyle.Quiet,
    );
    button(
      c,
      'prayer-preset-delete-confirm',
      new Rect(r.x + half + 5, y + 2 * rowH, half, rowH),
      'Delete preset',
      () => p.remove(),
      ButtonStyle.Default,
    );
    return;
  }
  if (!p.rows.length) {
    c.text(
      new Rect(r.x, y, r.w, rowH),
      saved ? 'No saved looks yet.' : 'No custom looks yet.',
      t.muted,
      13,
    );
    return;
  }
  const room = r.y + r.h - y,
    navH = Math.min(33, rowH);
  const needsPages = p.rows.length > Math.max(1, Math.floor((room + 3) / (rowH + 3)));
  const count = Math.max(1, Math.floor((room - (needsPages ? navH + 3 : 0) + 3) / (rowH + 3)));
  const pages = Math.ceil(p.rows.length / count);
  p.page = Math.min(p.page, pages - 1);
  p.rows.slice(p.page * count, (p.page + 1) * count).forEach((entry, i) => {
    const at = y + i * (rowH + 3),
      size = rowH - 4;
    const deleteW = saved ? Math.min(60, r.w * 0.19) : 0;
    const itemW = r.w - (saved ? deleteW + 5 : 0);
    const active = entry.code === p.code;
    button(
      c,
      (saved ? 'prayer-preset-use-' : 'prayer-settler-use-') + i,
      new Rect(r.x, at, itemW, rowH),
      '',
      () => p.use(entry.code),
      ButtonStyle.Quiet,
      true,
      undefined,
      active,
    );
    thumbnail(app, entry, new Rect(r.x + 3, at + 2, size, size));
    const nameW = itemW - size - 57;
    c.verbatim(() =>
      c.text(new Rect(r.x + size + 9, at, nameW, rowH), c.elideText(entry.name, nameW, 14), t.text, 14),
    );
    c.text(
      new Rect(r.x + itemW - 48, at, 44, rowH),
      active ? 'In use' : 'Use',
      t.accent,
      12,
      false,
      Align.Center,
    );
    if (saved)
      button(
        c,
        'prayer-preset-delete-' + i,
        new Rect(r.x + r.w - deleteW, at, deleteW, rowH),
        'Delete',
        () => {
          p.removing = entry;
          p.message('');
          c.focus('prayer-preset-delete-cancel');
        },
        ButtonStyle.Quiet,
        true,
        undefined,
        false,
        { fontSize: 12 },
      );
  });
  if (pages <= 1) return;
  const navY = r.y + r.h - navH,
    x = r.x + r.w / 2 - 67;
  button(
    c,
    'prayer-preset-prev',
    new Rect(x, navY, 37, navH),
    '‹',
    () => {
      --p.page;
    },
    ButtonStyle.Quiet,
    p.page > 0,
  );
  c.text(new Rect(x + 37, navY, 60, navH), p.page + 1 + ' / ' + pages, t.muted, 12, false, Align.Center);
  button(
    c,
    'prayer-preset-next',
    new Rect(x + 97, navY, 37, navH),
    '›',
    () => {
      ++p.page;
    },
    ButtonStyle.Quiet,
    p.page < pages - 1,
  );
}

export function renderResidentPresets(app: GameAppState, p: ResidentPresetPanel, body: Rect): void {
  const c = app.context,
    t = app.theme;
  const wide = body.w >= 540;
  const side = Math.min(wide ? body.w * 0.29 : body.h * 0.24, wide ? body.h - 36 : 105, 175);
  const preview = new Rect(body.x, wide ? body.y + (body.h - side - 30) / 2 : body.y, side, side);
  portrait(app, p.draft.person, preview);
  const caption = wide
    ? new Rect(preview.x, preview.y + side + 4, side, 24)
    : new Rect(body.x + side + 12, body.y, body.w - side - 12, side);
  c.verbatim(() =>
    c.text(
      caption,
      c.elideText(p.draft.name.value, caption.w, 15, true),
      t.text,
      15,
      true,
      wide ? Align.Center : Align.Start,
    ),
  );
  const form = wide
    ? new Rect(body.x + side + 16, body.y, body.w - side - 16, body.h)
    : new Rect(body.x, body.y + side + 8, body.w, body.h - side - 8);
  const tabs = [
    ['saved', 'Saved looks'],
    ['residents', 'Residents'],
    ['code', 'Appearance code'],
  ] as const;
  const w = (form.w - 8) / 3,
    h = Math.min(38, form.h * 0.16);
  tabs.forEach(([key, name], i) => {
    button(
      c,
      'prayer-presets-' + key,
      new Rect(form.x + i * (w + 4), form.y, w, h),
      name,
      () => {
        p.tab = key;
        p.page = 0;
        p.removing = null;
        p.message('');
        if (key === 'saved') p.readLibrary();
        if (key === 'residents') p.rows = settlementLooks(app.town);
      },
      ButtonStyle.Quiet,
      true,
      undefined,
      p.tab === key,
      { fontSize: 12 },
    );
  });
  const area = new Rect(form.x, form.y + h + 8, form.w, form.h - h - 8);
  if (p.tab === 'code') codePage(app, p, area);
  else looksPage(app, p, area);
}
