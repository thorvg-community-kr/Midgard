// The orders of a selection, each with its key and a tooltip that says what it does: with a mouse a legend of key
// caps in the title row of the selection panel, on touch a rail of worded tiles on the right edge.
import { Rect, Align, ButtonStyle, board, button, tag, type Context } from '../../../../packages/native-ui/src';
import { Order, Tool } from '../../../../packages/engine/src/game-tools';
import { f32, clamp } from '../../../../packages/engine/src/numeric';
import type { HudGlyph } from './hud-actions';
import { hudGlyph } from './hud-glyphs';
import { DockView } from './game-app-state';
import { touchHudTop } from './mobile-layout';
import { tooltip } from './game-combat-hud';
import { allHolding, holdPosition } from './army-orders';
import type { GameHudApp } from './game-hud-contract';

interface OrderButton {
  id: string;
  glyph: HudGlyph;
  label: string;
  key: string;
  lines: string[];
  run: () => void;
  active: boolean;
}
/**
 * The orders a selection is given by button. With a mouse the right button moves and works, so there are only
 * those it cannot say: Build (the build menu, for these residents to raise what is picked), attack-move and hold.
 * Hold is also how a resident is stopped. A finger has no right button, so on touch Move and Work are among them.
 */
export function unitOrders(app: GameHudApp): OrderButton[] {
  const orders: OrderButton[] = [
    {
      id: 'card-build',
      glyph: 'build',
      label: 'Build',
      key: 'B',
      lines: ['Build', 'Choose a building for the selected residents to raise.'],
      run: () => app.openUnitBuild(),
      active: false,
    },
    {
      id: 'card-attack',
      glyph: 'attack',
      label: 'Attack',
      key: 'A',
      lines: [
        'Attack-move',
        'Walk to the point you click and fight whatever they meet. Click an enemy to make it everyone’s first target.',
      ],
      run: () => app.prepare(Order.Attack),
      active: app.pending === Order.Attack,
    },
    {
      id: 'card-hold',
      glyph: 'hold',
      label: 'Hold',
      key: 'H',
      lines: [
        'Hold position',
        'Drop what they are doing and stand on this spot: strike whatever comes into reach and never chase. Skills on auto still fire. Any other order ends it.',
      ],
      run: () => holdPosition(app),
      active: allHolding(app.town, app.chosen),
    },
  ];
  if (app.touchMode) {
    orders.splice(1, 0, {
      id: 'card-move',
      glyph: 'move',
      label: 'Move',
      key: '',
      lines: [
        'Move',
        'Walk to the point you click and ignore enemies on the way. A group arrives in formation: blades in front, bows and staves behind.',
      ],
      run: () => app.prepare(Order.Move),
      active: app.pending === Order.Move,
    });
    orders.push({
      id: 'card-work',
      glyph: 'work',
      label: 'Work',
      key: '',
      lines: ['Work', 'Fell, mine, build, mend or tend what you tap next.'],
      run: () => app.prepare(Order.Work),
      active: app.pending === Order.Work,
    });
  }
  return orders;
}
/** Height of a control in the title row of the selection panel with a mouse. */
export const titleTile = 28;
/** A paper cap with the key that gives an order. */
function keyCap(c: Context, r: Rect, key: string): void {
  tag(c, r, { cut: 2, lip: 1 });
  c.text(r, key, c.theme().ink, 10, true, Align.Center);
}
/**
 * A control of the title row: a mark (a key cap or a glyph) and, with room, its word. Returns the control's state.
 * Its width is `titleTileWidth` of the same mark and word.
 */
export function titleTileWidth(c: Context, word: string): number {
  return word ? f32(Math.ceil(c.textWidth(word, 11, true)) + 37) : 30;
}
export function titleTileControl(
  c: Context,
  id: string,
  r: Rect,
  mark: { key: string } | { glyph: HudGlyph },
  word: string,
  run: () => void,
  active = false,
  enabled = true,
) {
  const t = c.theme(),
    s = button(c, id, r, '', run, active ? ButtonStyle.Primary : ButtonStyle.Quiet, enabled),
    color = !enabled ? t.muted : active ? t.accentText : s.hovered ? t.accent : t.text,
    middle = f32(r.y + r.h / 2 + (s.lift ?? 0)),
    x = word ? f32(r.x + 7) : f32(r.x + (r.w - 16) / 2);
  if ('key' in mark) keyCap(c, new Rect(x, f32(middle - 8), 16, 15), mark.key);
  else hudGlyph(c, mark.glyph, f32(x + 8), middle, color, 0.8);
  if (word) c.text(new Rect(f32(x + 22), f32(middle - r.h / 2), f32(r.w - 30), r.h), word, color, 11, true);
  return s;
}
/**
 * The orders with a mouse: a legend of key caps and words in the title row, each a control, right-aligned to
 * `right`. An order in force is lit. Returns the left edge of the legend.
 */
export function orderLegend(app: GameHudApp, right: number, y: number, worded: boolean): number {
  const c = app.context;
  let x = right;
  for (const order of [...unitOrders(app)].reverse()) {
    const w = titleTileWidth(c, worded ? order.label : ''),
      id = 'unit/' + order.id,
      s = titleTileControl(c, id, new Rect(f32(x - w), y, w, titleTile), { key: order.key }, worded ? order.label : '', order.run, order.active);
    tooltip(c, id, s.hovered, [`${order.lines[0]}  (${order.key})`, ...order.lines.slice(1)]);
    x = f32(x - w - 4);
  }
  return f32(x + 4);
}
const railTile = 52,
  railPad = 6,
  railGap = 6;
/** Width the order rail takes beside the selection panel, with its gap. */
export const railGutter = railTile + railPad * 2 + 8;
/** In a low view there is no room above the selection panel: the rail stands beside it, down to the bottom edge. */
export const railBeside = (touch: boolean, height: number): boolean => touch && height < 500;
export interface OrderRail {
  bounds: Rect;
  columns: number;
  tileHeight: number;
  beside: boolean;
}
/**
 * Where the orders stand on touch, or null when there is none: an upright rail on the right edge, above the selection
 * panel or beside it. It keeps its place while an aimed order has folded the panel away, so nothing moves under the
 * finger. In two columns when one does not fit under the sky controls.
 */
export function orderRail(app: GameHudApp, width: number, height: number): OrderRail | null {
  if (
    !app.touchMode ||
    !app.residentSelection() ||
    app.tool !== Tool.Select ||
    app.town.isTitleAutoplay() ||
    !(app.dockView === DockView.Unit || app.pending !== Order.None)
  )
    return null;
  const count = unitOrders(app).length,
    panel = app.personPanelBounds(width, height, true),
    beside = railBeside(true, height),
    // The same line the quest panel starts from: below the sky and its time controls.
    top = beside && width >= 480 ? 56 : touchHudTop(width, app.timeExpanded),
    bottom = beside ? height - 12 : panel.y - 10,
    room = bottom - top - railPad * 2,
    columns = beside || room >= count * 44 + (count - 1) * railGap ? 1 : 2,
    rows = Math.ceil(count / columns),
    tileHeight = clamp(Math.floor((room - (rows - 1) * railGap) / rows), 44, 48),
    w = columns * railTile + (columns - 1) * railGap + railPad * 2,
    h = rows * tileHeight + (rows - 1) * railGap + railPad * 2;
  return { bounds: new Rect(width - 12 - w, Math.max(top, bottom - h), w, h), columns, tileHeight, beside };
}
/** The order rail of a touch player: a tile an order, the glyph with its word under it; an order in force is lit. */
export function unitOrderRail(app: GameHudApp, width: number, height: number): void {
  const rail = orderRail(app, width, height);
  if (!rail) return;
  const c = app.context,
    t = app.theme,
    r = rail.bounds;
  c.control('unit/orders', r, undefined, true, false);
  board(c, r);
  unitOrders(app).forEach((order, i) => {
    const tile = new Rect(
        r.x + railPad + (i % rail.columns) * (railTile + railGap),
        r.y + railPad + Math.floor(i / rail.columns) * (rail.tileHeight + railGap),
        railTile,
        rail.tileHeight,
      ),
      s = button(c, 'unit/' + order.id, tile, '', order.run, order.active ? ButtonStyle.Primary : ButtonStyle.Default),
      lift = s.lift ?? 0,
      color = order.active ? t.accentText : t.text;
    hudGlyph(c, order.glyph, f32(tile.x + tile.w / 2), f32(tile.y + tile.h / 2 - 8 + lift), color, 0.9);
    c.text(new Rect(tile.x + 1, f32(tile.y + tile.h - 20 + lift), tile.w - 2, 17), order.label, color, 12, true, Align.Center);
  });
}
