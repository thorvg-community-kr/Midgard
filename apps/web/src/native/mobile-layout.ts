import { Rect } from '../../../../packages/native-ui/src';

/** All HUD measurements are logical CSS pixels. The backing canvas owns the display density. */
export const touchTarget = 44;
export const topBarInset = 12, topBarGap = 8;
export const topBarSize = (touch: boolean): number => touch ? touchTarget : 36;
export function topBarEndButton(width: number, touch: boolean, slot = 0): Rect {
  const size = topBarSize(touch);
  return new Rect(width - topBarInset - size - slot * (size + topBarGap), topBarInset, size, size);
}
export function touchClockBounds(width: number): Rect {
  const w = Math.min(224, Math.max(1, width - (topBarInset + touchTarget + topBarGap) * 2));
  return new Rect((width - w) / 2, topBarInset, w, touchTarget);
}
export const speedColumns = (width: number): number => width < 300 ? 3 : 6;
export const touchHudTop = (width: number, expanded: boolean): number =>
  expanded ? 70 + (6 / speedColumns(width)) * 46 : 64;
export const compactViewport = (width: number, height: number): boolean => width < 600 || height < 500;
/** In landscape a station or dungeon can use the space immediately below the sky controls. */
export function inspectorHeightLimit(height: number, expanded = false): number {
  const spaceAbove = expanded ? Math.min(180, Math.max(60, height - 360)) : 180;
  return Math.max(120, Math.fround(height - spaceAbove));
}
export const touchPlacementHeight = 110;
/** Leave room for the sky controls, the entire placement dock, and the fingertip. */
export function placementMapBounds(width: number, height: number): Rect {
  const top = Math.min(120, height * 0.3),
    bottom = height - touchPlacementHeight - 52;
  return new Rect(32, top, Math.max(1, width - 64), Math.max(1, bottom - top));
}
