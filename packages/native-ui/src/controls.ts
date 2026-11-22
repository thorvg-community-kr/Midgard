import { Context } from './context';
import { FrameStyle, resolve, type Appearance } from './theme';
import { litPlane, slab, tone, well } from './relief';
const f = Math.fround;
import {
  Align,
  Cursor,
  ButtonStyle,
  EventType,
  Icon,
  Key,
  Rect,
  iconName,
  transparent,
  type Event,
  type State,
} from './types';

const activated = (event: Event) =>
  event.type === EventType.Activate ||
  (event.type === EventType.Key && (event.key === Key.Enter || event.key === Key.Space));

export function button(
  context: Context,
  id: string,
  bounds: Rect,
  label: string,
  activate: (() => void) | undefined,
  style = ButtonStyle.Default,
  enabled = true,
  icon: Icon | string = Icon.None,
  active = false,
  appearance: Appearance = {},
): State {
  bounds = new Rect(bounds.x, bounds.y, bounds.w, bounds.h);
  const name = typeof icon === 'number' ? (icon === Icon.None ? '' : iconName(icon)) : icon;
  const state = context.control(
      id,
      bounds,
      (event) => {
        if (activated(event)) activate?.();
      },
      enabled,
    ),
    t = context.theme();
  const carved = t.frameStyle === FrameStyle.Carved;
  const hover = carved
    ? context.animate(id + '/hover', enabled && (state.hovered || state.focused) ? 1 : 0, 0.12)
    : 0;
  const press = carved ? context.animate(id + '/press', enabled && state.pressed ? 1 : 0, 0.08) : 0;
  let fill = style === ButtonStyle.Primary ? t.accent : style === ButtonStyle.Quiet ? t.surface : t.raised;
  let ink = style === ButtonStyle.Primary ? t.accentText : t.text;
  fill = resolve(appearance.fill, t, fill);
  ink = resolve(appearance.text, t, ink);
  if (active && style !== ButtonStyle.Primary) fill = resolve(appearance.activeFill, t, t.selection);
  let face = bounds;
  if (carved) {
    // A raised tile: it brightens under the pointer and sinks into its own thickness when pressed.
    const bare = fill.a === 0,
      toggled = active && style !== ButtonStyle.Primary,
      quiet = style === ButtonStyle.Quiet && !toggled && !appearance.fill;
    if (quiet && !bare) fill = tone(t.surface, t.raised, 0.8);
    if (toggled) ink = resolve(appearance.text, t, t.accent);
    if (!enabled) {
      ink = t.muted;
      fill = resolve(appearance.disabledFill, t, bare ? fill : tone(t.surface, t.dusk, 0.12));
    } else if (!bare) {
      fill = tone(fill, resolve(appearance.hoverFill, t, tone(fill, t.light, 0.16)), hover);
      if (appearance.pressedFill) fill = tone(fill, resolve(appearance.pressedFill, t, fill), press);
    }
    if (!bare && appearance.sunken && style !== ButtonStyle.Primary) {
      well(context, bounds, tone(t.well, t.light, f(hover * f(0.08))), {
        rim: toggled || hover > f(0.01) ? { ...t.accent, a: Math.round(255 * Math.max(hover, toggled ? 1 : 0)) } : undefined,
      });
    } else if (!bare) {
      const lip = !enabled ? 1 : bounds.h < 22 ? 2 : style === ButtonStyle.Quiet ? 2 : 3,
        border = appearance.border ? resolve(appearance.border, t, t.border) : undefined,
        lit =
          toggled || (enabled && hover > 0)
            ? tone(litPlane(t, fill), t.accent, toggled ? 0.85 : f(hover * f(0.7)))
            : litPlane(t, fill, enabled ? 0.2 : 0.08);
      face = slab(context, bounds, fill, {
        lip,
        cut: (appearance.radius ?? -1) >= 0 ? appearance.radius! : Math.min(3, bounds.h / 6),
        pressed: toggled ? Math.max(0.6, press) : press,
        lit,
        trim: border && border.a ? border : undefined,
      });
    } else face = new Rect(bounds.x, f(bounds.y + press), bounds.w, bounds.h);
  } else {
    if (state.hovered || state.pressed)
      fill = resolve(appearance.hoverFill, t, style === ButtonStyle.Primary ? t.success : t.selection);
    if (state.pressed) fill = resolve(appearance.pressedFill, t, fill);
    if (!enabled) {
      ink = t.muted;
      fill = resolve(appearance.disabledFill, t, t.surface);
    }
    context.rect(
      bounds,
      fill,
      (appearance.radius ?? -1) >= 0 ? appearance.radius! : t.radius,
      resolve(appearance.border, t, transparent),
      appearance.borderWidth ?? 1,
    );
  }
  if (state.focused && appearance.focusRing) context.focusRing(bounds.inset(4));
  if (name) {
    context.icon(
      id + '/icon',
      new Rect(face.x + (label ? 8 : (face.w - 24) / 2), face.y, 24, face.h),
      name,
      ink,
      { ...state, active, enabled },
    );
    if (label)
      context.text(
        new Rect(face.x + 36, face.y, face.w - 44, face.h),
        label,
        ink,
        appearance.fontSize ?? 0,
        appearance.bold ?? false,
        appearance.textAlign ?? Align.Start,
      );
  } else
    context.text(
      carved ? new Rect(f(face.x + 5), face.y, Math.max(0, f(face.w - 10)), face.h) : bounds.inset(6),
      label,
      ink,
      appearance.fontSize ?? 0,
      appearance.bold ?? false,
      appearance.textAlign ?? Align.Center,
    );
  state.lift = f(face.y + face.h / 2 - (bounds.y + bounds.h / 2));
  return state;
}

export function checkbox(
  context: Context,
  id: string,
  bounds: Rect,
  label: string,
  value: boolean,
  change: (value: boolean) => void,
  enabled = true,
): void {
  const state = context.control(
      id,
      bounds,
      (event) => {
        if (activated(event)) change(!value);
      },
      enabled,
    ),
    t = context.theme();
  const box = new Rect(bounds.x, bounds.y + (bounds.h - 18) / 2, 18, 18);
  if (t.frameStyle !== FrameStyle.Carved)
    context.rect(box, value && enabled ? t.accent : t.surface, 4, state.hovered ? t.accent : t.border);
  else if (value && enabled) slab(context, box, t.accent, { lip: 2, cut: 3 });
  else well(context, box, undefined, { rim: state.hovered ? t.accent : undefined });
  if (value)
    context.icon(id + '/check', box, Icon.Check, enabled ? t.accentText : t.muted, {
      ...state,
      active: value,
      enabled,
    });
  context.text(new Rect(bounds.x + 28, bounds.y, bounds.w - 28, bounds.h), label, enabled ? t.text : t.muted);
  if (state.focused) context.focusRing(box);
}

const encoder = new TextEncoder(),
  decoder = new TextDecoder();
function previous(bytes: Uint8Array, cursor: number): number {
  if (!cursor) return 0;
  --cursor;
  while (cursor && (bytes[cursor] & 0xc0) === 0x80) --cursor;
  return cursor;
}
function next(bytes: Uint8Array, cursor: number): number {
  if (cursor === bytes.length) return cursor;
  ++cursor;
  while (cursor < bytes.length && (bytes[cursor] & 0xc0) === 0x80) ++cursor;
  return cursor;
}
/** Cursor offsets retain the native UTF-8 byte semantics. */
export class TextInput {
  constructor(
    public value = '',
    public cursor = 0,
  ) {}
  byteLength(): number {
    return encoder.encode(this.value).length;
  }
  prefix(): string {
    return decoder.decode(encoder.encode(this.value).subarray(0, Math.min(this.cursor, this.byteLength())));
  }
  insert(text: string): void {
    const bytes = encoder.encode(this.value);
    this.cursor = Math.min(this.cursor, bytes.length);
    const inserted = encoder.encode(text).filter((value) => value >= 32 && value !== 127);
    const result = new Uint8Array(bytes.length + inserted.length);
    result.set(bytes.subarray(0, this.cursor));
    result.set(inserted, this.cursor);
    result.set(bytes.subarray(this.cursor), this.cursor + inserted.length);
    this.value = decoder.decode(result);
    this.cursor += inserted.length;
  }
  edit(key: Key): void {
    const bytes = encoder.encode(this.value);
    this.cursor = Math.min(this.cursor, bytes.length);
    switch (key) {
      case Key.Left:
        this.cursor = previous(bytes, this.cursor);
        break;
      case Key.Right:
        this.cursor = next(bytes, this.cursor);
        break;
      case Key.Home:
        this.cursor = 0;
        break;
      case Key.End:
        this.cursor = bytes.length;
        break;
      case Key.Backspace: {
        const start = previous(bytes, this.cursor);
        this.value = decoder.decode(
          new Uint8Array([...bytes.subarray(0, start), ...bytes.subarray(this.cursor)]),
        );
        this.cursor = start;
        break;
      }
      case Key.Delete:
        this.value = decoder.decode(
          new Uint8Array([...bytes.subarray(0, this.cursor), ...bytes.subarray(next(bytes, this.cursor))]),
        );
        break;
    }
  }
}

export function textField(
  context: Context,
  id: string,
  bounds: Rect,
  input: TextInput,
  placeholder: string,
  enabled = true,
  keyHandler?: (key: Key) => boolean,
  leadingIcon = Icon.None,
  appearance: Appearance = {},
): void {
  const state = context.control(
      id,
      bounds,
      (event) => {
        if (event.type === EventType.Text) input.insert(event.text);
        else if (event.type === EventType.Press) input.cursor = input.byteLength();
        else if (event.type === EventType.Key && (!keyHandler || !keyHandler(event.key)))
          input.edit(event.key);
      },
      enabled,
      true,
      false,
      false,
      Cursor.Text,
    ),
    t = context.theme();
  if (t.frameStyle === FrameStyle.Carved && !appearance.fill)
    well(context, bounds, undefined, { rim: state.focused ? t.accent : undefined });
  else
    context.rect(
      bounds,
      resolve(appearance.fill, t, t.background),
      (appearance.radius ?? -1) >= 0 ? appearance.radius! : t.radius,
      resolve(appearance.border, t, state.focused ? t.accent : t.border),
      appearance.borderWidth ?? 1,
    );
  if (leadingIcon !== Icon.None)
    context.icon(id + '/leading', new Rect(bounds.x + 8, bounds.y, 22, bounds.h), leadingIcon, t.muted, {
      ...state,
      active: false,
      enabled,
    });
  const inset = leadingIcon === Icon.None ? 8 : 38,
    content = new Rect(bounds.x + inset, bounds.y + 2, bounds.w - inset - 12, bounds.h - 4);
  const cursorWidth = state.focused
    ? context.textWidth(input.prefix(), appearance.fontSize ?? 0, appearance.bold ?? false, input.value)
    : 0;
  const offset = state.focused ? Math.max(0, cursorWidth - content.w + 4) : 0;
  context.text(
    content,
    input.value || placeholder,
    enabled && input.value ? resolve(appearance.text, t, t.text) : t.muted,
    appearance.fontSize ?? 0,
    appearance.bold ?? false,
    Align.Start,
    offset,
  );
  if (state.focused)
    context.rect(new Rect(content.x + cursorWidth - offset, bounds.y + 9, 1.5, bounds.h - 18), t.accent);
}
