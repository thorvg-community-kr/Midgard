import { Rect, button, ButtonStyle, Align, tag, type Context } from '../../../../packages/native-ui/src';
import { hudGlyph, type HudGlyph } from './hud-glyphs';
export type { HudGlyph } from './hud-glyphs';
function tooltipPlacement(
  viewport: Rect,
  anchor: Rect,
  width: number,
  controls: readonly Rect[],
): Rect | null {
  const height = 25,
    gap = 6,
    area = viewport.inset(4);
  if (area.w < width || area.h < height) return null;
  // Panel input shields contain their child controls; only the leaves obstruct
  // a tooltip. This includes disabled buttons and inventory cells, not just the
  // icons drawn by this helper.
  const obstacles = controls.filter(
    (a) =>
      a.w > 0 &&
      a.h > 0 &&
      !controls.some(
        (b) =>
          b !== a &&
          b.w > 0 &&
          b.h > 0 &&
          b.w * b.h < a.w * a.h &&
          b.x >= a.x &&
          b.y >= a.y &&
          b.x + b.w <= a.x + a.w &&
          b.y + b.h <= a.y + a.h,
      ),
  );
  const clampX = (x: number) => Math.max(area.x, Math.min(area.x + area.w - width, x)),
    clampY = (y: number) => Math.max(area.y, Math.min(area.y + area.h - height, y)),
    centerX = anchor.x + anchor.w / 2,
    centerY = anchor.y + anchor.h / 2,
    xs = new Set([clampX(centerX - width / 2), area.x, area.x + area.w - width]),
    ys = new Set([
      clampY(anchor.y - height - gap),
      clampY(anchor.y + anchor.h + gap),
      area.y,
      area.y + area.h - height,
    ]);
  for (const r of obstacles) {
    xs.add(clampX(r.x - width - gap));
    xs.add(clampX(r.x + r.w + gap));
    ys.add(clampY(r.y - height - gap));
    ys.add(clampY(r.y + r.h + gap));
  }
  let best: Rect | null = null,
    score = Infinity;
  for (const y of ys)
    for (const x of xs) {
      const candidate = new Rect(x, y, width, height);
      if (
        obstacles.some(
          (r) =>
            candidate.x < r.x + r.w + 3 &&
            candidate.x + candidate.w > r.x - 3 &&
            candidate.y < r.y + r.h + 3 &&
            candidate.y + candidate.h > r.y - 3,
        )
      )
        continue;
      const distance = (x + width / 2 - centerX) ** 2 + (y + height / 2 - centerY) ** 2;
      if (distance < score) {
        best = candidate;
        score = distance;
      }
    }
  return best;
}
/** Small vector controls share hover/press feedback and explicit descriptive tooltips. */
export function actionButton(
  c: Context,
  id: string,
  r: Rect,
  glyph: HudGlyph,
  label: string,
  run: () => void,
  active = false,
  enabled = true,
  tooltip = true,
  /** With room to spare the label is written beside the glyph instead of waiting for the pointer. */
  captioned = false,
): void {
  const s = button(c, id, r, '', run, active ? ButtonStyle.Primary : ButtonStyle.Quiet, enabled),
    t = c.theme();
  const color = !enabled ? t.muted : active ? t.accentText : s.hovered ? t.accent : t.text,
    scale = Math.min(1, (r.h - 6) / 22),
    middle = r.y + r.h / 2 + (s.lift ?? 0);
  if (captioned) {
    const width = Math.min(r.w - 52, c.textWidth(label, 12, true)),
      left = r.x + (r.w - width - 30) / 2;
    hudGlyph(c, glyph, left + 11, middle, color, scale);
    c.text(new Rect(left + 30, r.y + (s.lift ?? 0), width + 2, r.h), c.elideText(label, width + 2, 12, true), color, 12, true);
    return;
  }
  hudGlyph(c, glyph, r.x + r.w / 2, middle, color, scale);
  if (tooltip && (s.hovered || s.focused)) {
    c.deferOverlay(
      (area, controls) => {
        const anchor = controls.find((control) => control.id === id)?.bounds;
        if (!anchor || anchor.w <= 0 || anchor.h <= 0) return;
        const width = Math.min(area.w - 8, 260, Math.max(70, c.textWidth(label, 11) + 20)),
          tip = tooltipPlacement(
            area,
            anchor,
            width,
            controls.map((control) => control.bounds),
          );
        if (!tip) return;
        tag(c, tip);
        c.text(tip, c.elideText(label, tip.w - 12, 11), t.ink, 11, true, Align.Center);
      },
      'hud-action-tooltip',
      s.hovered ? 1 : 0,
    );
  }
}
