// The fog of war as mist on the ground: a bank over land nobody has seen and a tint over land seen before.
// Where each lies is a field that flows like noise on the wind, so neither is a circle round an eye and neither
// stands still. The mist is drawn as one soft picture, a dot for every corner of the grid, so its edge melts
// away over a cell to each side instead of ending in a line. It lies under all that stands; what stands is told
// from the same fields whether it is gone, dimmed or plain (`depth`), whole, so nothing is ever cut across.
import type { Point } from '../../engine/src/geometry';
import { noise } from './field-contour';
import { SUN_PASSES } from './vector-paint';

export const mistRules = {
  /** Redraws a second; the flow is slow, so more would only cost frames. Halved when zoomed far out. */
  rate: 12,
  /**
   * Sight level (1 at the eye, 0 at the rim of its sight) from which the game shows units: ground at or above
   * it is never covered. It is the coverage 119 the renderer asks for, in these units.
   */
  inSight: 0.15,
  /** Tiles the middle of the mist's soft edge keeps off ground in sight. */
  clear: 0.3,
  /** Tiles toward the camera the fields run on past the view, so what stands below it knows its ground. */
  tallest: 5,
  /** Redraws a thing takes to go dim or plain again. */
  steps: 8,
};
/**
 * The tones: the bank over the unknown, and the tint over what is only remembered with its strength. Both lie
 * on the ground under the day's light. That light is a soft pass, which leaves black black and lifts a dark
 * tone only a little, and a warm pass, which would turn all of it grey: so the warm pass thins out as the mist
 * thickens (`warmth`), and the unknown stays black and the remembered dark, by day as by night.
 */
export const mistTones = {
  bank: [0, 0, 1] as const,
  veil: [2, 3, 6] as const,
  memory: 218,
};
export interface MistSight {
  center: Point;
  radius: number;
}
export interface MistArea {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface MistInput {
  sights: readonly MistSight[];
  /** Places known for good, like a gate once found: the bank keeps off them, out to their radius at least. */
  known?: readonly MistSight[];
  /** How well a tile point is known, 0 to 255, as the explored map has it. */
  explored(x: number, y: number): number;
  /** The tiles the explored map covers; beyond them everything is unknown. */
  area: MistArea;
  /** The view in world pixels: left, top, width, height. */
  view: readonly [number, number, number, number];
  /** Screen pixels to a world pixel: far out, the grid is coarser. */
  zoom: number;
  /** Seconds of flow; a fixed value stills the mist. */
  seconds: number;
}
/** `veil` dims remembered land and `bank`, over it, hides the unknown. */
export type MistBand = 'veil' | 'bank';
const halfWidth = 32,
  halfHeight = 16;
const clamp = (v: number): number => (v <= -1 ? -1 : v >= 1 ? 1 : v);
/** The wind carries the pattern along the screen's long axis; each field rides it at its own pace. */
const flow = (x: number, y: number, seconds: number, scale: number, pace: number, salt: number): number =>
  noise(x * scale - seconds * pace, y * scale + seconds * pace * 0.45, salt);

/**
 * Builds the bands for one moment on a grid over the view: one tile a cell close up, two and four when
 * zoomed out.
 */
export class MistField {
  /**
   * The mist as a picture, a dot for every corner of the grid and four bytes a dot (red, green, blue, strength,
   * the colour already weighed by the strength): the tint, and the bank over it.
   */
  pixels = new Uint8Array(4);
  /**
   * The warm pass of the day's light on the same grid: whole where no mist lies, nothing under it. That pass
   * lifts black to grey, so it must thin out exactly as the mist thickens.
   */
  warmth = new Uint8Array(4);
  /** Projected world pixels where ground can show through the opaque bank in this view. */
  clearGround: MistArea | null = null;
  private level = new Float32Array();
  /** The radius of the sight that sees each corner best, to turn a level back into tiles. */
  private span = new Float32Array();
  /** Cells from each corner to the nearest place known for good, less its radius. */
  private open = new Float32Array();
  private veil = new Float32Array();
  /** How strong the bank and the tint are at each corner once their edges are melted, and room to work in. */
  private dark = new Float32Array();
  private dim = new Float32Array();
  private spare = new Float32Array();
  private bank = new Float32Array();
  private grid = { i0: 0, j0: 0, nx: 0, ny: 0, cell: 1 };
  /**
   * How deep in a band a tile point lies, as last built: above zero is inside. This is what tells a tree
   * whether it stands in the mist, so it agrees with the drawn edge. A little beyond the fields it is their
   * rim; farther out nothing is known and it is not a number.
   */
  depth(band: MistBand, x: number, y: number): number {
    const { i0, j0, nx, ny, cell } = this.grid,
      across = x / cell - i0,
      down = y / cell - j0,
      beyond = 4;
    if (!nx || !ny || across < -beyond || down < -beyond || across > nx + beyond || down > ny + beyond) return NaN;
    const u = Math.min(nx, Math.max(0, across)),
      v = Math.min(ny, Math.max(0, down)),
      i = Math.min(nx - 1, Math.floor(u)),
      j = Math.min(ny - 1, Math.floor(v)),
      a = u - i,
      b = v - j,
      field = this[band],
      at = j * (nx + 1) + i;
    return (
      (field[at] * (1 - a) + field[at + 1] * a) * (1 - b) + (field[at + nx + 1] * (1 - a) + field[at + nx + 2] * a) * b
    );
  }
  /**
   * How strongly the ground at a tile point is tinted, from none to all, as the picture shows it: what stands
   * there is dimmed by as much, so it fades with the mist instead of changing colour at a line.
   */
  tint(x: number, y: number): number {
    const { i0, j0, nx, ny, cell } = this.grid,
      across = x / cell - i0,
      down = y / cell - j0;
    if (!nx || !ny || across < -4 || down < -4 || across > nx + 4 || down > ny + 4) return NaN;
    const u = Math.min(nx, Math.max(0, across)),
      v = Math.min(ny, Math.max(0, down)),
      i = Math.min(nx - 1, Math.floor(u)),
      j = Math.min(ny - 1, Math.floor(v)),
      a = u - i,
      b = v - j,
      at = j * (nx + 1) + i,
      mix = (field: Float32Array) =>
        (field[at] * (1 - a) + field[at + 1] * a) * (1 - b) + (field[at + nx + 1] * (1 - a) + field[at + nx + 2] * a) * b;
    return Math.min(1, Math.max(0, mix(this.dim) * (1 - mix(this.dark))));
  }
  build(input: MistInput): void {
    const [vx, vy, vw, vh] = input.view,
      cell = input.zoom >= 0.7 ? 1 : input.zoom >= 0.35 ? 2 : 4,
      margin = 2,
      // The view is a slanted box in tiles; these are its corners.
      corner = (sx: number, sy: number) => ({ x: (sx / halfWidth + sy / halfHeight) / 2, y: (sy / halfHeight - sx / halfWidth) / 2 }),
      corners = [corner(vx, vy), corner(vx + vw, vy), corner(vx, vy + vh), corner(vx + vw, vy + vh)],
      tall = Math.ceil(mistRules.tallest / cell),
      i0 = Math.floor(Math.min(...corners.map((c) => c.x)) / cell) - margin,
      j0 = Math.floor(Math.min(...corners.map((c) => c.y)) / cell) - margin,
      // Toward the camera the grid runs on, so a cell knows what stands in front of it.
      nx = Math.ceil(Math.max(...corners.map((c) => c.x)) / cell) + margin + tall + 1 - i0,
      ny = Math.ceil(Math.max(...corners.map((c) => c.y)) / cell) + margin + tall + 1 - j0,
      stride = nx + 1,
      nodes = stride * (ny + 1);
    if (this.level.length < nodes)
      for (const name of ['level', 'span', 'open', 'veil', 'bank', 'dark', 'dim', 'spare'] as const)
        this[name] = new Float32Array(nodes);
    this.grid = { i0, j0, nx, ny, cell };
    const { level, span, open, veil, bank } = this,
      t = input.seconds,
      // A coarse grid cannot carry the small ripples: they would break up into specks.
      ripple = cell === 1 ? 1 : cell === 2 ? 0.35 : 0,
      swell = cell === 4 ? 0.5 : 1;
    // 1. How deep in someone's sight each corner lies.
    level.fill(-1, 0, nodes);
    span.fill(0, 0, nodes);
    for (const sight of input.sights) {
      const r = sight.radius;
      if (!(r > 0)) continue;
      const out = r * 1.6,
        a0 = Math.max(0, Math.floor((sight.center.x - out) / cell) - i0),
        a1 = Math.min(nx, Math.ceil((sight.center.x + out) / cell) - i0),
        b0 = Math.max(0, Math.floor((sight.center.y - out) / cell) - j0),
        b1 = Math.min(ny, Math.ceil((sight.center.y + out) / cell) - j0);
      for (let j = b0; j <= b1; ++j) {
        const dy = (j0 + j) * cell - sight.center.y;
        for (let i = a0; i <= a1; ++i) {
          const dx = (i0 + i) * cell - sight.center.x,
            v = 1 - Math.sqrt(dx * dx + dy * dy) / r,
            at = j * stride + i;
          if (v > level[at]) {
            level[at] = v;
            span[at] = r;
          }
        }
      }
    }
    open.fill(1, 0, nodes);
    for (const place of input.known ?? []) {
      const out = place.radius + 1.3 + cell,
        a0 = Math.max(0, Math.floor((place.center.x - out) / cell) - i0),
        a1 = Math.min(nx, Math.ceil((place.center.x + out) / cell) - i0),
        b0 = Math.max(0, Math.floor((place.center.y - out) / cell) - j0),
        b1 = Math.min(ny, Math.ceil((place.center.y + out) / cell) - j0);
      for (let j = b0; j <= b1; ++j)
        for (let i = a0; i <= a1; ++i) {
          const x = (i0 + i) * cell,
            y = (j0 + j) * cell,
            // No ring round the place: the clearing is as uneven as the rest of the bank's edge.
            reach = place.radius + 1.3 * noise(x * 0.45, y * 0.45, 13),
            gap = (Math.hypot(x - place.center.x, y - place.center.y) - reach) / cell,
            at = j * stride + i;
          if (gap < open[at]) open[at] = gap;
        }
    }
    // 2. The two fields, positive inside. Their edges wander with the flow; neither comes nearer to ground
    //    in sight than `clear`, and the bank keeps off what is known for good.
    const area = input.area,
      right = area.x + area.w,
      bottom = area.y + area.h;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let j = 0; j <= ny; ++j) {
      const y = (j0 + j) * cell;
      let first = -1, last = -1;
      for (let i = 0; i <= nx; ++i) {
        const x = (i0 + i) * cell,
          at = j * stride + i,
          l = level[at],
          // Tiles from here to ground in sight, less the margin: negative on that ground.
          room = span[at] > 0 ? ((mistRules.inSight - l) * span[at] - mistRules.clear) / cell : 1,
          inside = x >= area.x && y >= area.y && x < right && y < bottom,
          known = inside ? input.explored(x, y) : 0,
          limit = Math.min(room, open[at]);
        // Noise is in [0, 1], so the bank's threshold is always between 26 and 150.
        // Only partly explored ground between those clamped extremes needs the moving edge.
        if (limit <= -1 || known >= 176) bank[at] = -1;
        else if (known === 0) bank[at] = clamp(limit);
        else {
          const tongue = noise(x * 0.11, y * 0.11, 7),
            edge = 26 + 92 * tongue * Math.sqrt(tongue) + 32 * ripple * flow(x, y, t, 0.3, 0.06, 9);
          bank[at] = clamp(Math.min((edge - known) / 26, limit));
        }
        // Short of full strength the bank's soft edge still lets the ground through.
        if (bank[at] < 1) {
          if (first < 0) first = i;
          last = i;
        }
        // The tint over remembered land: a slow wide swell, a quicker one on it and a ripple on that.
        veil[at] =
          l < -0.55 || room <= -1
            ? clamp(room)
            : clamp(
                Math.min(
                  (0.1 -
                    0.2 * flow(x, y, t, 0.055, 0.016, 29) -
                    0.22 * swell * flow(x, y, t, 0.15, 0.05, 23) -
                    0.13 * ripple * flow(x, y, t, 0.31, 0.085, 31) -
                    l) /
                    0.09,
                  room,
                ),
              );
      }
      if (first >= 0) {
        // Projection is increasing in the column for both axes in this row.
        const a = (i0 + first) * cell, b = (i0 + last) * cell;
        minX = Math.min(minX, (a - y) * halfWidth);
        minY = Math.min(minY, (a + y) * halfHeight);
        maxX = Math.max(maxX, (b - y) * halfWidth);
        maxY = Math.max(maxY, (b + y) * halfHeight);
      }
    }
    // A corner can uncover any of its four neighbouring cells, out to their opposite corners.
    const padX = 2 * cell * halfWidth, padY = 2 * cell * halfHeight;
    this.clearGround = minX === Infinity ? null :
      { x: minX - padX, y: minY - padY, w: maxX - minX + 2 * padX, h: maxY - minY + 2 * padY };
    // 3. The pictures. A field runs from -1 to 1 across its edge, so half way is the middle of the soft edge.
    if (this.pixels.length !== nodes * 4) {
      this.pixels = new Uint8Array(nodes * 4);
      this.warmth = new Uint8Array(nodes * 4);
    }
    const { pixels, warmth } = this,
      [bankRed, bankGreen, bankBlue] = mistTones.bank,
      [veilRed, veilGreen, veilBlue] = mistTones.veil,
      [warmRed, warmGreen, warmBlue] = SUN_PASSES[1].color,
      memory = mistTones.memory / 255;
    // How strong each band is at every corner, melted over the corners round it: a field can leap from none
    // to all between two corners, and a picture stretched from such dots would show the grid as steps.
    const darkness = this.melted(bank, this.dark, stride, nodes),
      dimness = this.melted(veil, this.dim, stride, nodes);
    for (let at = 0; at < nodes; ++at) {
      const dark = darkness[at],
        dim = dimness[at],
        // The tint shows only where the bank does not already hide the land.
        tint = dim * memory * (1 - dark),
        lit = 1 - Math.max(dark, dim),
        dot = at * 4;
      pixels[dot] = Math.round(bankRed * dark + veilRed * tint);
      pixels[dot + 1] = Math.round(bankGreen * dark + veilGreen * tint);
      pixels[dot + 2] = Math.round(bankBlue * dark + veilBlue * tint);
      pixels[dot + 3] = Math.round(255 * (dark + tint));
      warmth[dot] = Math.round(warmRed * lit);
      warmth[dot + 1] = Math.round(warmGreen * lit);
      warmth[dot + 2] = Math.round(warmBlue * lit);
      warmth[dot + 3] = Math.round(255 * lit);
    }
  }
  /**
   * A field's strength from 0 to 1 at every corner (half at its edge), smoothed twice over the neighbouring
   * corners along each way of the grid, into `out`.
   */
  private melted(field: Float32Array, out: Float32Array, stride: number, nodes: number): Float32Array {
    const spare = this.spare,
      last = nodes - 1;
    for (let at = 0; at < nodes; ++at) out[at] = 0.5 + 0.5 * field[at];
    for (let pass = 0; pass < 2; ++pass) {
      // Across, then down; at the rim a corner stands in for the neighbour it lacks.
      for (let at = 0; at < nodes; ++at) {
        const column = at % stride;
        spare[at] = (out[column ? at - 1 : at] + 2 * out[at] + out[column < stride - 1 ? at + 1 : at]) / 4;
      }
      for (let at = 0; at < nodes; ++at)
        out[at] = (spare[at >= stride ? at - stride : at] + 2 * spare[at] + spare[at + stride <= last ? at + stride : at]) / 4;
    }
    return out;
  }
  /** Where the pictures lie: the tile of their first dot, how many dots across and down, and the tiles between dots. */
  frame(): { x: number; y: number; columns: number; rows: number; cell: number } {
    const { i0, j0, nx, ny, cell } = this.grid;
    return { x: i0 * cell, y: j0 * cell, columns: nx + 1, rows: ny + 1, cell };
  }
  /** Whether a tile point lies in a band, past the middle of its soft edge: for the checks. */
  covers(band: MistBand, x: number, y: number): boolean {
    return this.depth(band, x, y) > 0;
  }
}

