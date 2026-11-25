import {
  Align,
  ButtonStyle,
  Cursor,
  EventType,
  Key,
  Rect,
  button,
  frame,
  meter,
  textField,
} from '../../../../packages/native-ui/src';
import type { Rgb } from '../../../../packages/engine/src/building-catalog';
import {
  portraitBackdrop,
  portraitBackground,
} from '../../../../packages/native-renderer/src/portrait-background';
import { PersonParts, personSprite } from '../../../../packages/native-renderer/src/world-sprites';
import { portrait } from './resident-portrait';
import type { GameAppState } from './game-app-state';
import { hudPaint } from './hud-paint';
import {
  type ResidentColorId,
  type ResidentChoiceId,
  type ResidentDraft,
  residentColors,
  residentChoices,
} from './resident-draft';

const tabs = { hair: 'Hair', face: 'Face', marks: 'Markings', clothing: 'Clothing', body: 'Body' } as const;
export type ResidentTab = keyof typeof tabs;
export interface ResidentCreationView {
  draft: ResidentDraft;
  appearanceTab: ResidentTab;
  mixedColor: ResidentColorId | null;
  stylePicker: { id: ResidentChoiceId; first: number } | null;
}

function fullFigure(app: GameAppState, draft: ResidentDraft, r: Rect): void {
  const c = app.context,
    p = draft.person;
  frame(c, r);
  c.paint(JSON.stringify(['resident-body', p.look, String(p.lookRevision), r]), () => {
    const scene = portraitBackground(
      portraitBackdrop(app.town.map(), p.position, app.town.climate()),
      r.w,
      r.h,
    );
    // Keep the ground line and zoom fixed as height and build change.
    const scale = Math.min(r.h / 31, r.w / 19);
    const figure = personSprite(p, new PersonParts());
    figure.transform([scale, 0, r.w / 2, 0, scale, r.h * 0.87, 0, 0, 1]);
    scene.add(figure);
    const paint = hudPaint(c, scene);
    paint.translate(r.x, r.y);
    return paint;
  });
}

function identityPanel(app: GameAppState, view: ResidentCreationView, area: Rect, beside: boolean): void {
  const c = app.context,
    t = app.theme,
    draft = view.draft;
  const gap = 6,
    controlH = Math.min(38, beside ? (area.h - 76) / 3 : (area.h - 2 * gap) / 3);
  const controlsH = controlH * 3 + 2 * gap;
  const side = beside ? Math.min(area.w, area.h - controlsH - 10, 225) : Math.min(area.w * 0.37, area.h, 150);
  const picture = beside
    ? new Rect(area.x + (area.w - side) / 2, area.y + (area.h - side - controlsH - 10) / 2, side, side)
    : new Rect(area.x, area.y + (area.h - side) / 2, side, side);
  if (view.appearanceTab === 'body') fullFigure(app, draft, picture);
  else portrait(app, draft.person, picture);

  const x = beside ? area.x : picture.x + side + 12;
  const y = beside ? picture.y + side + 10 : area.y + (area.h - controlsH) / 2;
  const w = area.x + area.w - x,
    labelW = Math.min(43, w * 0.25);
  c.text(new Rect(x, y, labelW - 2, controlH), 'Name', t.text, 12, true);
  c.verbatim(
    () =>
      textField(
        c,
        'prayer-name',
        new Rect(x + labelW, y, w - labelW, controlH),
        draft.name,
        'Name',
        true,
        undefined,
        undefined,
        { fontSize: 13 },
      ),
    !!draft.name.value,
  );
  button(
    c,
    'prayer-name-random',
    new Rect(x, y + controlH + gap, w, controlH),
    'Random name',
    () => draft.randomName(),
    ButtonStyle.Quiet,
    true,
    undefined,
    false,
    { fontSize: 12 },
  );
  button(
    c,
    'prayer-look-random',
    new Rect(x, y + 2 * (controlH + gap), w, controlH),
    'Random appearance',
    () => draft.randomLook(),
    ButtonStyle.Default,
    true,
    undefined,
    false,
    { fontSize: 12 },
  );
}

function mixColor(app: GameAppState, view: ResidentCreationView, key: ResidentColorId, area: Rect): void {
  const c = app.context,
    t = app.theme,
    draft = view.draft;
  const h = Math.min(46, (area.h - 12) / 4),
    value = draft.color(key);
  c.text(new Rect(area.x, area.y, area.w - 88, h), residentColors[key].label, t.text, 15, true);
  button(
    c,
    'prayer-color-done',
    new Rect(area.x + area.w - 78, area.y, 78, h - 3),
    'Done',
    () => {
      view.mixedColor = null;
      c.focus('prayer-' + key + '-mix');
    },
    ButtonStyle.Quiet,
  );
  const channels = { r: 'Red', g: 'Green', b: 'Blue' } as const;
  (Object.keys(channels) as (keyof Rgb)[]).forEach((channel, index) => {
    const y = area.y + (index + 1) * (h + 3);
    const labelW = Math.min(66, area.w * 0.22);
    const track = new Rect(area.x + labelW, y, area.w - labelW - 42, h);
    const id = 'prayer-color-' + channel;
    const state = c.control(
      id,
      track,
      (event) => {
        let next = draft.color(key)[channel];
        if (event.type === EventType.Press || event.type === EventType.Drag)
          next = Math.round((255 * (event.x - track.x - 3)) / (track.w - 6));
        else if (event.type === EventType.Key) {
          if (event.key === Key.Left || event.key === Key.Down) next -= event.shift ? 10 : 1;
          else if (event.key === Key.Right || event.key === Key.Up) next += event.shift ? 10 : 1;
          else if (event.key === Key.Home) next = 0;
          else if (event.key === Key.End) next = 255;
          else return;
        } else return;
        draft.setColor(key, { ...draft.color(key), [channel]: Math.max(0, Math.min(255, next)) });
      },
      true,
      true,
      false,
      true,
      Cursor.ResizeHorizontal,
    );
    c.text(new Rect(area.x, y, labelW, h), channels[channel], t.text, 12, true);
    const bar = new Rect(track.x + 3, y + (h - 10) / 2, track.w - 6, 10);
    meter(c, bar, value[channel] / 255, { ...value, a: 255 });
    const knob = bar.x + (bar.w * value[channel]) / 255;
    c.rect(new Rect(knob - 2, bar.y - 3, 4, 16), state.focused ? t.accent : t.text);
    c.text(
      new Rect(track.x + track.w + 4, y, 38, h),
      String(value[channel]),
      t.text,
      13,
      false,
      Align.Center,
    );
  });
}

function pickStyle(app: GameAppState, view: ResidentCreationView, area: Rect): void {
  const picker = view.stylePicker!;
  const c = app.context,
    field = residentChoices[picker.id],
    gap = 4;
  const cols = Math.max(2, Math.floor(area.w / 132));
  const headH = Math.min(36, area.h * 0.18),
    bodyH = area.h - headH - gap;
  const rows = Math.max(1, Math.floor(bodyH / 38)),
    perPage = rows * cols;
  const page = Math.floor(picker.first / perPage),
    start = page * perPage;
  const pages = Math.ceil(field.options.length / perPage),
    w = (area.w - (cols - 1) * gap) / cols;
  const h = Math.min(43, (bodyH - (rows - 1) * gap) / rows);
  const close = () => {
    view.stylePicker = null;
    c.focus('prayer-' + picker.id + '-pick');
  };
  const right = area.x + area.w,
    navW = pages > 1 ? 124 : 0;
  c.text(new Rect(area.x, area.y, area.w - 65 - navW, headH), field.label, app.theme.text, 14, true);
  if (pages > 1) {
    const x = right - 65 - navW;
    button(
      c,
      'prayer-pick-prev',
      new Rect(x, area.y, 32, headH),
      '‹',
      () => {
        picker.first = start - perPage;
      },
      ButtonStyle.Quiet,
      page > 0,
    );
    c.text(
      new Rect(x + 32, area.y, 52, headH),
      page + 1 + ' / ' + pages,
      app.theme.muted,
      12,
      false,
      Align.Center,
    );
    button(
      c,
      'prayer-pick-next',
      new Rect(x + 84, area.y, 32, headH),
      '›',
      () => {
        picker.first = start + perPage;
      },
      ButtonStyle.Quiet,
      page + 1 < pages,
    );
  }
  button(c, 'prayer-pick-done', new Rect(right - 65, area.y, 65, headH), 'Done', close, ButtonStyle.Quiet);
  field.options.slice(start, start + perPage).forEach((name, i) => {
    const index = start + i;
    const r = new Rect(
      area.x + (i % cols) * (w + gap),
      area.y + headH + gap + Math.floor(i / cols) * (h + gap),
      w,
      h,
    );
    button(
      c,
      'prayer-pick-option-' + index,
      r,
      name,
      () => {
        view.draft.choose(picker.id, index);
        close();
      },
      ButtonStyle.Quiet,
      true,
      undefined,
      view.draft.choice(picker.id) === index,
      { fontSize: 12 },
    );
  });
}

export function renderResidentCreation(app: GameAppState, view: ResidentCreationView, body: Rect): void {
  const c = app.context,
    t = app.theme,
    draft = view.draft;
  const beside = body.w >= 540,
    leftW = Math.min(242, body.w * 0.31);
  const topH = Math.min(153, body.h * 0.32);
  const identity = beside ? new Rect(body.x, body.y, leftW, body.h) : new Rect(body.x, body.y, body.w, topH);
  identityPanel(app, view, identity, beside);
  const form = beside
    ? new Rect(body.x + leftW + 19, body.y + 4, body.w - leftW - 19, body.h - 8)
    : new Rect(body.x, body.y + topH + 12, body.w, body.h - topH - 12);
  const tabH = Math.min(37, form.h * 0.16);
  const keys = Object.keys(tabs) as ResidentTab[],
    tabW = (form.w - (keys.length - 1) * 3) / keys.length;
  keys.forEach((tab, i) => {
    button(
      c,
      'prayer-tab-' + tab,
      new Rect(form.x + i * (tabW + 3), form.y, tabW, tabH),
      tabs[tab],
      () => {
        view.appearanceTab = tab;
        view.mixedColor = null;
        view.stylePicker = null;
      },
      ButtonStyle.Quiet,
      true,
      undefined,
      view.appearanceTab === tab,
      { fontSize: 12 },
    );
  });
  const area = new Rect(form.x, form.y + tabH + 10, form.w, form.h - tabH - 10);
  if (view.stylePicker) {
    pickStyle(app, view, area);
    return;
  }
  if (view.mixedColor) {
    mixColor(app, view, view.mixedColor, area);
    return;
  }

  const rowH = Math.min(65, area.h / 4),
    fieldH = Math.min(41, rowH - 5);
  const labelW = Math.min(106, area.w * 0.3),
    fieldX = area.x + labelW;
  const fieldW = area.w - labelW,
    right = area.x + area.w;
  let y = area.y;
  const label = (word: string, w = labelW - 4, h = fieldH) =>
    c.text(new Rect(area.x, y, w, h), word, t.text, 13, true);
  const choice = (id: ResidentChoiceId) => {
    const field = residentChoices[id],
      index = draft.choice(id),
      arrow = Math.min(41, fieldH + 3);
    label(field.label);
    button(
      c,
      'prayer-' + id + '-prev',
      new Rect(fieldX, y, arrow, fieldH),
      '‹',
      () => draft.step(id, -1),
      ButtonStyle.Quiet,
    );
    const value = new Rect(fieldX + arrow + 2, y, fieldW - 2 * arrow - 4, fieldH);
    button(
      c,
      'prayer-' + id + '-pick',
      value,
      field.options[index],
      () => {
        view.stylePicker = { id, first: index };
        c.focus('prayer-pick-option-' + index);
      },
      ButtonStyle.Default,
      true,
      undefined,
      false,
      { fontSize: 13 },
    );
    button(
      c,
      'prayer-' + id + '-next',
      new Rect(right - arrow, y, arrow, fieldH),
      '›',
      () => draft.step(id, 1),
      ButtonStyle.Quiet,
    );
    y += rowH;
  };
  const toggle = (id: ResidentChoiceId) => {
    label(residentChoices[id].label);
    const width = (fieldW - 4) / 2;
    residentChoices[id].options.forEach((name, i) => {
      button(
        c,
        'prayer-' + id + (i ? '-on' : '-off'),
        new Rect(fieldX + (width + 4) * i, y, width, fieldH),
        name,
        () => draft.choose(id, i),
        ButtonStyle.Quiet,
        true,
        undefined,
        draft.choice(id) === i,
      );
    });
    y += rowH;
  };
  const colors = (key: ResidentColorId) => {
    const { label: title, palette } = residentColors[key],
      color = draft.color(key);
    // In a narrow column place the label above the swatches to keep them easy to tap.
    const stacked = fieldW < 312 && rowH >= 49;
    const x = stacked ? area.x : fieldX,
      top = stacked ? y + 18 : y;
    const h = stacked ? Math.min(40, rowH - 21) : fieldH;
    label(title, stacked ? area.w : labelW - 4, stacked ? 17 : h);
    const mixW = Math.min(50, (right - x) * 0.19),
      gap = 3;
    const stride = Math.min(49, (right - x - mixW - gap) / palette.length);
    palette.forEach((tone, i) => {
      const swatch = new Rect(x + i * stride, top, stride - gap, h);
      const selected = color.r === tone.r && color.g === tone.g && color.b === tone.b;
      button(
        c,
        'prayer-' + key + '-tone-' + i,
        swatch,
        '',
        () => draft.setColor(key, tone),
        ButtonStyle.Default,
        true,
        undefined,
        selected,
        { fill: { ...tone, a: 255 }, activeFill: { ...tone, a: 255 }, focusRing: true },
      );
      if (selected) c.rect(new Rect(swatch.x + 5, top + 4, swatch.w - 10, 3), t.text);
    });
    button(
      c,
      'prayer-' + key + '-mix',
      new Rect(x + palette.length * stride + gap, top, mixW, h),
      'Mix',
      () => {
        view.mixedColor = key;
        c.focus('prayer-color-r');
      },
      ButtonStyle.Quiet,
      true,
      undefined,
      false,
      { fontSize: 12 },
    );
    y += rowH;
  };

  switch (view.appearanceTab) {
    case 'hair':
      choice('hair');
      choice('beard');
      colors('hair');
      break;
    case 'face':
      choice('eyes');
      choice('brows');
      choice('jaw');
      colors('skin');
      break;
    case 'marks':
      toggle('freckles');
      toggle('scar');
      toggle('paint');
      toggle('elder');
      break;
    case 'clothing':
      colors('cloth');
      toggle('band');
      toggle('kerchief');
      if (draft.choice('kerchief')) colors('kerchief');
      break;
    case 'body':
      choice('body');
      choice('height');
      choice('width');
      break;
  }
}
