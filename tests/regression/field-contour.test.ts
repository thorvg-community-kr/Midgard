import { describe, expect, it } from 'vitest';
import { fieldRegion } from '../../packages/native-renderer/src/field-contour';
import { Rings } from '../../packages/native-renderer/src/outline-rings';

/** A field over `nx` by `ny` cells: 1 on the corners `inside` names, -1 on the rest. */
function field(nx: number, ny: number, inside: (i: number, j: number) => boolean): Float32Array {
  const out = new Float32Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; ++j) for (let i = 0; i <= nx; ++i) out[j * (nx + 1) + i] = inside(i, j) ? 1 : -1;
  return out;
}
/** The corners of one outline, and twice the area it goes round: the sign tells which way it turns. */
function outline(rings: Rings, ring: number): { corners: number[][]; turn: number } {
  let from = 0;
  for (let k = 0; k < ring; ++k) from += rings.sizes[k];
  const corners = Array.from({ length: rings.sizes[ring] }, (_, k) => [
    rings.points[(from + k) * 2],
    rings.points[(from + k) * 2 + 1],
  ]);
  let turn = 0;
  corners.forEach(([x, y], k) => {
    const [nx, ny] = corners[(k + 1) % corners.length];
    turn += x * ny - nx * y;
  });
  return { corners, turn };
}

describe('the outline of a field', () => {
  it('is one ring round a region of many cells, with no line inside it', () => {
    // Inside on the corners 1 to 4 across and 1 to 3 down: a box from 0.5 to 4.5 and 0.5 to 3.5 with its
    // corners cut off, twelve cells whole and fourteen cut.
    const rings = new Rings();
    fieldRegion(rings, field(6, 5, (i, j) => i >= 1 && i <= 4 && j >= 1 && j <= 3), 6, 5, 0, 0, 1, 1);
    expect(rings.count).toBe(1);
    expect(outline(rings, 0).corners).toEqual([
      [0.5, 1],
      [1, 0.5],
      [4, 0.5],
      [4.5, 1],
      [4.5, 3],
      [4, 3.5],
      [1, 3.5],
      [0.5, 3],
    ]);
  });
  it('goes the other way round a hole, and the hole is not part of the region', () => {
    // Everything inside but the one corner in the middle: a diamond-shaped hole of half a cell each way.
    const rings = new Rings();
    fieldRegion(rings, field(6, 6, (i, j) => i !== 3 || j !== 3), 6, 6, 0, 0, 1, 1);
    expect(rings.count).toBe(2);
    const around = outline(rings, 0),
      hole = outline(rings, 1);
    expect(around.corners).toHaveLength(4);
    expect(hole.corners).toHaveLength(4);
    expect(around.turn).toBe(72);
    expect(hole.turn).toBe(-1);
    expect(rings.covers(3, 3)).toBe(false);
    expect(rings.covers(3.4, 3.4)).toBe(true);
    expect(rings.covers(0.2, 5.8)).toBe(true);
    expect(rings.covers(6.2, 3)).toBe(false);
  });
  it('follows the columns a row is narrowed to', () => {
    // All inside, but each row keeps three columns and the rows step to the right: a stair of whole cells.
    const rings = new Rings();
    fieldRegion(rings, field(6, 3, () => true), 6, 3, 0, 0, 1, 1, (row) => [row, row + 2]);
    expect(rings.count).toBe(1);
    expect(outline(rings, 0).corners).toEqual([
      [0, 0],
      [3, 0],
      [3, 1],
      [4, 1],
      [4, 2],
      [5, 2],
      [5, 3],
      [2, 3],
      [2, 2],
      [1, 2],
      [1, 1],
      [0, 1],
    ]);
  });
});
