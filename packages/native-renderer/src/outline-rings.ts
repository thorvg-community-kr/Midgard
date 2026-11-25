// Closed straight-sided outlines for one shape, packed so the whole path goes to ThorVG in a single call.
// A path redrawn many times a second is far cheaper this way than as curves, which are flattened again on
// every change.
export class Rings {
  /** The x and y of every corner in order, and how many corners each outline has. */
  points = new Float32Array(2048);
  sizes = new Uint32Array(256);
  count = 0;
  used = 0;
  private from = 0;
  clear(): this {
    this.count = this.used = this.from = 0;
    return this;
  }
  /**
   * One more corner of the outline being drawn. A corner that only carries a level or an upright run farther
   * takes the place of the one before it, and one on the same spot as the last is dropped.
   */
  corner(x: number, y: number): this {
    const fx = Math.fround(x),
      fy = Math.fround(y),
      { points, used } = this,
      drawn = used - this.from;
    if (drawn >= 2) {
      const bx = points[used - 2],
        by = points[used - 1];
      if (bx === fx && by === fy) return this;
      if (drawn >= 4 && ((points[used - 4] === bx && bx === fx) || (points[used - 3] === by && by === fy))) {
        points[used - 2] = fx;
        points[used - 1] = fy;
        return this;
      }
    }
    if (used + 2 > points.length) {
      const grown = new Float32Array(points.length * 2);
      grown.set(points.subarray(0, used));
      this.points = grown;
    }
    this.points[this.used++] = fx;
    this.points[this.used++] = fy;
    return this;
  }
  /** Ends the outline being drawn; one of fewer than three corners is dropped. */
  close(): this {
    const { points, used, from } = this;
    // The last corner may only carry a run on to the first.
    if (
      used - from >= 8 &&
      ((points[used - 4] === points[used - 2] && points[used - 2] === points[from]) ||
        (points[used - 3] === points[used - 1] && points[used - 1] === points[from + 1]))
    )
      this.used -= 2;
    const corners = (this.used - this.from) / 2;
    if (corners < 3) {
      this.used = this.from;
      return this;
    }
    if (this.count >= this.sizes.length) {
      const grown = new Uint32Array(this.sizes.length * 2);
      grown.set(this.sizes);
      this.sizes = grown;
    }
    this.sizes[this.count++] = corners;
    this.from = this.used;
    return this;
  }
  /**
   * Whether a point lies in the region the outlines bound: for the checks, not for drawing. An outline inside
   * another is a hole in it, so the point is in when an odd number of them go round it.
   */
  covers(x: number, y: number): boolean {
    let from = 0,
      inside = false;
    for (let ring = 0; ring < this.count; ++ring) {
      const size = this.sizes[ring];
      for (let k = 0, last = size - 1; k < size; last = k++) {
        const ax = this.points[(from + k) * 2],
          ay = this.points[(from + k) * 2 + 1],
          bx = this.points[(from + last) * 2],
          by = this.points[(from + last) * 2 + 1];
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      }
      from += size;
    }
    return inside;
  }
}
