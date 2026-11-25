import { Rect } from '../../../../packages/native-ui/src';

export const compactViewport = (width: number, height: number): boolean => width < 600 || height < 500;
/** In landscape a crafting station can use the space immediately below the sky controls. */
export function inspectorHeightLimit(height: number, crafting = false): number {
  const spaceAbove = crafting ? Math.min(180, Math.max(60, height - 360)) : 180;
  return Math.max(120, Math.fround(height - spaceAbove));
}
export const touchPlacementHeight = 110;
/** Leave room for the sky controls, the entire placement dock, and the fingertip. */
export function placementMapBounds(width: number, height: number): Rect {
  const top = Math.min(120, height * 0.3),
    bottom = height - touchPlacementHeight - 52;
  return new Rect(32, top, Math.max(1, width - 64), Math.max(1, bottom - top));
}
