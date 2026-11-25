import { tileHalfWidth, tileHalfHeight } from '../../engine/src/geometry';
import type { Rect } from '../../native-ui/src/types';
import { SceneNode, ShapeNode, type Command } from './paint';

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A run wholly beyond one edge of the view can be replaced by its chord.
 * Both enclose exactly the same ground inside the view, including holes. */
function visibleContours(source: readonly Command[], bounds: Bounds): Command[] {
  const kept: Command[] = [];
  let sides = 0,
    start = 0,
    last: Command | undefined;
  for (const cmd of source) {
    if (cmd[0] === 'Z') {
      if (last) kept.push(last);
      if (kept.length - start < 3) kept.length = start;
      else kept.push(cmd);
      last = undefined;
      continue;
    }
    if (cmd[0] !== 'M' && cmd[0] !== 'L') continue;
    const x = (cmd[1] - cmd[2]) * tileHalfWidth,
      y = (cmd[1] + cmd[2]) * tileHalfHeight,
      outside =
        (x < bounds.left ? 1 : x > bounds.right ? 2 : 0) | (y < bounds.top ? 4 : y > bounds.bottom ? 8 : 0);
    if (cmd[0] === 'M') start = kept.length;
    else if (sides & outside) {
      sides &= outside;
      last = cmd;
      continue;
    } else if (last) kept.push(last);
    kept.push(cmd);
    sides = outside;
    last = undefined;
  }
  return kept;
}

/** Bound the distance from every omitted corner to its replacement segment in projected world pixels.
 * Fixed anchors bound the work on long shorelines and keep at least four runs around each large ring. */
function distantContours(source: Command[]): Command[] {
  type Vertex = ['M' | 'L', number, number];
  const kept: Command[] = [];
  const simplify = (first: number, last: number) => {
    const a = source[first] as Vertex, b = source[last] as Vertex;
    const dx = b[1] - a[1], dy = b[2] - a[2];
    const vx = (dx - dy) * tileHalfWidth, vy = (dx + dy) * tileHalfHeight;
    const length = vx * vx + vy * vy;
    // At the upper zoom limit this is 0.26 CSS pixels.
    let farthest = 0.4 ** 2, split = -1;
    for (let i = first + 1; i < last; i++) {
      const p = source[i] as Vertex, tx = p[1] - a[1], ty = p[2] - a[2];
      const x = (tx - ty) * tileHalfWidth, y = (tx + ty) * tileHalfHeight;
      const t = length ? Math.max(0, Math.min(1, (x * vx + y * vy) / length)) : 0;
      const ex = x - t * vx, ey = y - t * vy, error = ex * ex + ey * ey;
      if (error > farthest) {
        farthest = error;
        split = i;
      }
    }
    if (split < 0) kept.push(source[last]);
    else {
      simplify(first, split);
      simplify(split, last);
    }
  };
  let first = 0;
  for (let end = 0; end < source.length; end++) {
    if (source[end][0] !== 'Z') continue;
    const count = end - first;
    if (count < 12) {
      for (let i = first; i < end; i++) kept.push(source[i]);
    } else {
      kept.push(source[first]);
      const stride = Math.min(32, Math.floor((count - 1) / 4));
      for (let i = first; i < end - 1; i += stride) simplify(i, Math.min(i + stride, end - 1));
    }
    kept.push(source[end]);
    first = end + 1;
  }
  return kept.length < source.length ? kept : source;
}

/** Keeps the complete, ordered terrain paths in tile space for travel and zoom.
 * ThorVG only prepares the contours and cliff faces that can reach the padded view. */
export class GroundViewport {
  private readonly paths: { shape: ShapeNode; source: Command[]; distant?: Command[]; bounds: Bounds }[] = [];
  private prepared?: Bounds;
  private distant = false;

  constructor(private readonly ground: SceneNode) {
    for (const child of ground.children) {
      if (!(child instanceof ShapeNode)) continue;
      this.index(child);
      if (child.clipper instanceof ShapeNode) this.index(child.clipper);
    }
  }

  private index(shape: ShapeNode): void {
    const source = shape.commands;
    if (source.at(-1)?.[0] !== 'Z' || shape.rings || shape.strokeColor) return;
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const cmd of source) {
      if (cmd[0] === 'Z') continue;
      if (cmd[0] !== 'M' && cmd[0] !== 'L') return;
      const x = (cmd[1] - cmd[2]) * tileHalfWidth,
        y = (cmd[1] + cmd[2]) * tileHalfHeight;
      bounds.left = Math.min(bounds.left, x);
      bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.bottom = Math.max(bounds.bottom, y);
    }
    this.paths.push({ shape, source, bounds });
  }

  update(view: Rect, clear?: Pick<Rect, 'x' | 'y' | 'w' | 'h'> | null, zoom = 1): void {
    // Water translates in tile space. Keep its entire drift as well as the screen-space guard in viewRect.
    const left = Math.max(view.x, clear?.x ?? view.x) - 32,
      right = Math.min(view.x + view.w, clear ? clear.x + clear.w : Infinity) + 32,
      top = Math.max(view.y, clear?.y ?? view.y) - 32,
      bottom = Math.min(view.y + view.h, clear ? clear.y + clear.h : Infinity) + 32,
      old = this.prepared;
    const shown = clear !== null && left < right && top < bottom;
    if (this.ground.alpha !== (shown ? 255 : 0)) this.ground.opacity(shown ? 255 : 0);
    if (!shown) return;
    const distant = zoom <= 0.65;
    if (
      old && distant === this.distant &&
      left >= old.left &&
      right <= old.right &&
      top >= old.top &&
      bottom <= old.bottom &&
      right - left >= (old.right - old.left) / 3 &&
      bottom - top >= (old.bottom - old.top) / 3
    )
      return;
    const padX = (right - left) / 3,
      padY = (bottom - top) / 3,
      area = { left: left - padX, right: right + padX, top: top - padY, bottom: bottom + padY };
    this.prepared = area;
    this.distant = distant;
    for (const path of this.paths) {
      const { shape, bounds } = path;
      const shown =
        bounds.right >= area.left &&
        bounds.left <= area.right &&
        bounds.bottom >= area.top &&
        bounds.top <= area.bottom;
      if (shape.alpha !== (shown ? 255 : 0)) shape.opacity(shown ? 255 : 0);
      if (!shown || path.source.length < 32) continue;
      const source = distant ? (path.distant ??= distantContours(path.source)) : path.source;
      const subset =
        bounds.left >= area.left &&
        bounds.right <= area.right &&
        bounds.top >= area.top &&
        bounds.bottom <= area.bottom
          ? source
          : visibleContours(source, area);
      // At overview scale nearly all of some bands fits. Keep their original tessellation across pans.
      const commands = subset.length < source.length * 0.8 ? subset : source;
      const current = shape.commands;
      if (
        commands === current ||
        (commands.length === current.length && commands.every((cmd, i) => cmd === current[i]))
      )
        continue;
      shape.reset().commands = commands;
    }
  }
}
