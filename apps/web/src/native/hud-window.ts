import { EventType, Rect, rgba, type Context } from '../../../../packages/native-ui/src';
import type { AppEvent } from './application-contracts';
import type { GameAppState } from './game-app-state';

export function hasHudWindow(app: GameAppState): boolean {
  return !!(app.prayer || app.rosterOpen || (app.touchMode && app.guide?.logOpen) || app.context?.inModal?.());
}

/** Draw at the root, after the HUD. The viewport and the window each absorb their own taps. */
export function windowBackdrop(c: Context, viewport: Rect, panel: Rect, id: string, first: string, close: () => void): void {
  c.modal(first, close);
  c.control(id + '/backdrop', viewport, e => { if (e.type === EventType.Activate) close(); }, true, false);
  c.rect(viewport, rgba(14, 12, 28, 155));
  c.control(id, panel, undefined, true, false);
}

/** A swipe that starts on an item scrolls the window and cancels the pending tap. */
export function windowEvent(app: GameAppState, e: AppEvent): void {
  const c = app.context, scroll = app.rosterScroll;
  const scrollable = app.rosterOpen && app.touchMode && scroll.limit > 0 && scroll.bounds.contains(e.x, e.y);
  const moveTo = (offset: number) => { scroll.offset = Math.max(0, Math.min(scroll.limit, offset)); };
  if (e.type === 'PointerCancel') {
    scroll.drag = null;
    c.cancelPointer();
  } else if (e.type === 'PointerDown' && e.button === 1) {
    scroll.drag = e.pointerType === 'touch' && scrollable ? { y: e.y, offset: scroll.offset, moved: false } : null;
    c.pointerDown(e.x, e.y);
  } else if (e.type === 'PointerMove') {
    const drag = scroll.drag;
    if (drag && (drag.moved || Math.abs(e.y - drag.y) > 7)) {
      if (!drag.moved) c.cancelPointer();
      drag.moved = true;
      moveTo(drag.offset + drag.y - e.y);
    } else c.pointerMove(e.x, e.y);
  } else if (e.type === 'PointerUp' && e.button === 1) {
    if (!scroll.drag?.moved) c.pointerUp(e.x, e.y);
    scroll.drag = null;
    if (e.pointerType === 'touch') {
      c.setPointerPosition(-1, -1);
      if (!c.textFocused()) c.focus('');
    }
  } else if (e.type === 'Wheel') {
    if (scrollable) moveTo(scroll.offset - e.delta * 72);
    else c.wheel(e.delta);
  } else if (e.type === 'KeyDown') {
    if (e.text === 'f1' && app.guide.logOpen) app.guide.logOpen = false;
    else c.key(e.key, e.shift);
  } else if (e.type === 'Text') c.textInput(e.text);
}
