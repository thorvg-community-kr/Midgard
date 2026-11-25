// The outline of a field sampled on a grid: where it is positive is inside. This is how the mist and the cloud
// shadows get edges that follow noise instead of circles, each as one path.
import type { Rings } from './outline-rings';

/** Smooth value noise in 0..1; the same everywhere for the same point and salt. */
const hash = (x: number, y: number, salt: number): number => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
export const noise = (x: number, y: number, salt: number): number => {
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0,
    sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy),
    a = hash(x0, y0, salt),
    b = hash(x0 + 1, y0, salt),
    c = hash(x0, y0 + 1, salt),
    d = hash(x0 + 1, y0 + 1, salt);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};
// The sides of a cell: a corner lies on two of them and a crossing on one.
const top = 1,
  right = 2,
  bottom = 4,
  left = 8;
// Kept between calls. The columns drawn in each row; for every corner and crossing of the grid the one that
// follows it along the outline, and a second where two outlines touch in a point; and where the outlines pass.
let firstColumn = new Int32Array(0),
  lastColumn = new Int32Array(0),
  next = new Int32Array(0),
  nextToo = new Int32Array(0);
const passed: number[] = [],
  spots = new Int32Array(8),
  sides = new Uint8Array(8);
/**
 * Adds to `out` the outline of the region where `field` is positive. The field holds one value for every
 * corner of a grid of `nx` by `ny` cells, row by row; a cell is `cw` by `ch` and the grid starts at (`x0`,
 * `y0`). `span` narrows a row to the columns worth drawing.
 *
 * Each cell has its part of the region: all of it, or a piece cut where the field passes zero between two
 * corners. Only the sides of those parts that no neighbour shares are kept and joined end to end, so the
 * region comes out as its outline alone: rings round it, and rings the other way round its holes. Parts
 * laid side by side would fill the same ground, but the line where two of them meet shows through as a hair
 * of what lies under, because each is drawn to the pixels on its own.
 */
export function fieldRegion(
  out: Rings,
  field: Float32Array,
  nx: number,
  ny: number,
  x0: number,
  y0: number,
  cw: number,
  ch: number,
  span?: (row: number) => readonly [number, number],
): void {
  const stride = nx + 1,
    nodes = stride * (ny + 1);
  if (firstColumn.length < ny) {
    firstColumn = new Int32Array(ny);
    lastColumn = new Int32Array(ny);
  }
  for (let j = 0; j < ny; ++j) {
    const [from, to] = span ? span(j) : [0, nx - 1];
    firstColumn[j] = Math.max(0, from);
    lastColumn[j] = Math.min(nx - 1, to);
  }
  // A spot on the outline is a corner of the grid, or a crossing on the edge that runs right or down from one.
  if (next.length < nodes * 3) {
    next = new Int32Array(nodes * 3);
    nextToo = new Int32Array(nodes * 3);
  }
  next.fill(-1, 0, nodes * 3);
  nextToo.fill(-1, 0, nodes * 3);
  passed.length = 0;
  const drawn = (i: number, j: number) => j >= 0 && j < ny && i >= firstColumn[j] && i <= lastColumn[j];
  for (let j = 0; j < ny; ++j)
    for (let i = firstColumn[j], end = lastColumn[j]; i <= end; ++i) {
      const at = j * stride + i,
        a = field[at] > 0,
        b = field[at + 1] > 0,
        c = field[at + stride + 1] > 0,
        d = field[at + stride] > 0;
      if (!(a || b || c || d)) continue;
      // The sides no drawn cell lies across: what runs along one of them is outline.
      const bare =
        (drawn(i, j - 1) ? 0 : top) | (i < end ? 0 : right) | (drawn(i, j + 1) ? 0 : bottom) | (i > firstColumn[j] ? 0 : left);
      if (a && b && c && d && !bare) continue;
      // Round the cell from its top left corner: every corner inside, and every crossing on the way.
      let count = 0;
      if (a) ((spots[count] = at), (sides[count++] = top | left));
      if (a !== b) ((spots[count] = nodes + at), (sides[count++] = top));
      if (b) ((spots[count] = at + 1), (sides[count++] = top | right));
      if (b !== c) ((spots[count] = 2 * nodes + at + 1), (sides[count++] = right));
      if (c) ((spots[count] = at + stride + 1), (sides[count++] = right | bottom));
      if (c !== d) ((spots[count] = nodes + at + stride), (sides[count++] = bottom));
      if (d) ((spots[count] = at + stride), (sides[count++] = bottom | left));
      if (d !== a) ((spots[count] = 2 * nodes + at), (sides[count++] = left));
      for (let k = 0; k < count; ++k) {
        const on = sides[k] & sides[k + 1 === count ? 0 : k + 1];
        // A cut through the cell is always outline; a run along a side only where nothing is drawn across it.
        if (on && !(on & bare)) continue;
        const from = spots[k],
          to = spots[k + 1 === count ? 0 : k + 1];
        if (next[from] < 0) next[from] = to;
        else nextToo[from] = to;
        passed.push(from);
      }
    }
  // Follow each outline round from spot to spot until it is back where it began.
  for (const start of passed) {
    if (next[start] < 0) continue;
    let at = start,
      steps = passed.length;
    do {
      const kind = at < nodes ? 0 : at < 2 * nodes ? 1 : 2,
        corner = at - kind * nodes,
        i = corner % stride,
        j = (corner - i) / stride;
      if (kind === 0) out.corner(x0 + i * cw, y0 + j * ch);
      else if (kind === 1) out.corner(x0 + (i + field[corner] / (field[corner] - field[corner + 1])) * cw, y0 + j * ch);
      else out.corner(x0 + i * cw, y0 + (j + field[corner] / (field[corner] - field[corner + stride])) * ch);
      const onward = nextToo[at] >= 0 ? nextToo[at] : next[at];
      if (nextToo[at] >= 0) nextToo[at] = -1;
      else next[at] = -1;
      at = onward;
    } while (at !== start && at >= 0 && --steps > 0);
    out.close();
  }
}
