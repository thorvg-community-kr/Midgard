import { describe, expect, it } from 'vitest';
import { MistField, type MistInput } from '../../packages/native-renderer/src/mist-bands';
import { project } from '../../packages/engine/src/geometry';

/** One resident at (40, 40) on a map explored only round them, seen through a 1280 by 720 view. */
function scene(zoom = 1, seconds = 0): MistInput {
  const eye = { x: 40, y: 40 },
    at = project(eye.x, eye.y),
    w = 1280 / zoom,
    h = 720 / zoom;
  return {
    sights: [{ center: eye, radius: 8.5 }],
    // The explored map's own falloff: whole to seven tenths of the stamp, gone at its rim.
    explored: (x, y) => {
      const u = Math.hypot(x - eye.x, y - eye.y) / 9.5;
      return u <= 0.7 ? 255 : u <= 0.86 ? 255 - ((u - 0.7) * 145) / 0.16 : u < 1 ? 110 - ((u - 0.86) * 110) / 0.14 : 0;
    },
    area: { x: -16, y: -16, w: 132, h: 132 },
    view: [at.x - w / 2, at.y - h / 2, w, h],
    zoom,
    seconds,
  };
}
const ring = (radius: number, count = 48) =>
  Array.from({ length: count }, (_, k) => ({
    x: 40 + radius * Math.cos((k / count) * Math.PI * 2),
    y: 40 + radius * Math.sin((k / count) * Math.PI * 2),
  }));
const seen = (input: MistInput, x: number, y: number): boolean => {
  const on = project(x, y),
    [left, top, width, height] = input.view;
  return on.x >= left && on.y >= top && on.x <= left + width && on.y <= top + height;
};

describe('the mist of the unknown', () => {
  it('never covers ground in sight, whatever the moment and the zoom', () => {
    for (const zoom of [1.7, 1, 0.5, 0.3])
      for (const seconds of [0, 3.7, 41]) {
        const bands = new MistField();
        bands.build(scene(zoom, seconds));
        // Units are shown out to 85 hundredths of a sight of 8.5 tiles: 7.2 tiles.
        for (const radius of [0, 3, 6, 7.2])
          for (const p of ring(radius))
            for (const band of ['veil', 'bank'] as const)
              expect(bands.covers(band, p.x, p.y), `${band} at ${radius} tiles, zoom ${zoom}, ${seconds} s`).toBe(false);
      }
  });
  it('covers every tile nobody has seen', () => {
    for (const zoom of [1.7, 1, 0.5]) {
      const input = scene(zoom, 12.5),
        bands = new MistField();
      bands.build(input);
      let checked = 0;
      for (let y = 22; y < 58; y += 0.5)
        for (let x = 22; x < 58; x += 0.5) {
          if (input.explored(x, y) > 0 || !seen(input, x, y)) continue;
          ++checked;
          expect(bands.covers('bank', x, y), `(${x}, ${y}) at zoom ${zoom}`).toBe(true);
        }
      expect(checked).toBeGreaterThan(100);
    }
  });
  it('tints land that was seen and is out of sight now, without hiding it', () => {
    const input = scene(1, 5);
    // Everything round the eye has been walked over before.
    input.explored = () => 255;
    const bands = new MistField();
    bands.build(input);
    for (const p of ring(14)) {
      expect(bands.covers('veil', p.x, p.y)).toBe(true);
      expect(bands.covers('bank', p.x, p.y)).toBe(false);
    }
  });
  it('draws the mist as a soft picture that agrees with what stands in it', () => {
    // A dot of the picture is a corner of the grid. Its strength there: none in sight, all on unknown land,
    // the tint's own on land only remembered; and half way where a thing changes from plain to dimmed or gone.
    const eye = { x: 40, y: 40 };
    for (const zoom of [1.7, 1, 0.5]) {
      const input = scene(zoom, 9),
        field = new MistField();
      input.explored = (x, y) => (Math.hypot(x - eye.x, y - eye.y) < 21.5 ? 255 : 0);
      field.build(input);
      const { x: left, y: top, columns, rows, cell } = field.frame(),
        strength = (x: number, y: number) =>
          field.pixels[(Math.round((y - top) / cell) * columns + Math.round((x - left) / cell)) * 4 + 3];
      expect(field.pixels).toHaveLength(columns * rows * 4);
      // The eye's own ground is clear; well out of sight on known land the tint; on unknown land the black.
      expect(strength(40, 40)).toBe(0);
      if (zoom <= 1) {
        expect(strength(40 + 16, 40)).toBe(218);
        expect(strength(40 + 26, 40)).toBe(255);
      }
      // The edge is soft: between clear and full the strength climbs over several corners, never in one leap.
      const climb: number[] = [];
      for (let x = 44; x <= 54; x += cell) climb.push(strength(Math.round(x / cell) * cell, 40));
      const steps = climb.slice(1).map((value, k) => value - climb[k]);
      expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
      expect(steps.filter((step) => step > 0).length).toBeGreaterThanOrEqual(cell === 1 ? 3 : 2);
      expect(Math.max(...steps)).toBeLessThan(160);
      // Far outside the picture nothing was built: there is no answer, not a guess.
      expect(field.depth('bank', 400, 400)).toBeNaN();
    }
  });
  it('keeps the bank off a place known for good', () => {
    // Fourteen tiles from the eye nothing has been seen: the bank lies there, unless a found gate stands there.
    const gate = { x: 54, y: 40 },
      plain = new MistField(),
      found = new MistField();
    plain.build(scene(1, 3));
    found.build({ ...scene(1, 3), known: [{ center: gate, radius: 3 }] });
    expect(plain.covers('bank', gate.x, gate.y)).toBe(true);
    expect(found.covers('bank', gate.x, gate.y)).toBe(false);
    expect(found.depth('bank', gate.x, gate.y)).toBeLessThanOrEqual(0);
    // It is remembered land there, not daylight.
    expect(found.covers('veil', gate.x, gate.y)).toBe(true);
  });
  it('keeps all visible ground and remembered openings inside the region sent to the GPU', () => {
    for (const zoom of [1.4, 0.5, 0.3]) {
      const field = new MistField(), input = scene(zoom, 6);
      field.build({ ...input, sights: [], explored: () => 0 });
      expect(field.clearGround).toBeNull();
      field.build({ ...input, known: [{ center: { x: 53, y: 40 }, radius: 3 }] });
      const box = field.clearGround!;
      let open = 0;
      for (let y = 12; y < 70; y += 0.73)
        for (let x = 12; x < 70; x += 0.79) {
          if (!seen(input, x, y) || field.depth('bank', x, y) > 0) continue;
          const p = project(x, y);
          expect(p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h).toBe(true);
          ++open;
        }
      expect(open).toBeGreaterThan(30);
    }
  });
  it('thins the warm light out exactly as the mist thickens', () => {
    // The warm pass of the day's light lifts black to grey: under it the unknown would not be black.
    const input = scene(1, 5),
      field = new MistField();
    field.build(input);
    const { x: left, y: top, columns, cell } = field.frame(),
      dot = (x: number, y: number) => (Math.round((y - top) / cell) * columns + Math.round((x - left) / cell)) * 4;
    // In sight the pass is whole, with its own colour; on unknown and on remembered land there is none of it.
    expect([...field.warmth.subarray(dot(40, 40), dot(40, 40) + 4)]).toEqual([34, 30, 22, 255]);
    expect(field.warmth[dot(40 + 24, 40) + 3]).toBe(0);
    expect(field.warmth[dot(40, 40 + 13) + 3]).toBe(0);
    // Everywhere the two add up: where the mist is at half strength or more, the light is at half or less.
    for (let y = 30; y <= 50; y += 2)
      for (let x = 30; x <= 50; x += 2) {
        const at = dot(x, y);
        if (field.pixels[at + 3] >= 128) expect(field.warmth[at + 3], `(${x}, ${y})`).toBeLessThanOrEqual(128);
        if (field.warmth[at + 3] === 255) expect(field.pixels[at + 3], `(${x}, ${y})`).toBe(0);
      }
  });
  it('flows: its edges are somewhere else a moment later, and the same again for the same moment', () => {
    const outline = (band: 'veil' | 'bank', seconds: number) => {
      const field = new MistField(),
        out: number[] = [];
      field.build(scene(1, seconds));
      for (let y = 26; y < 54; y += 0.5) for (let x = 26; x < 54; x += 0.5) out.push(field.depth(band, x, y));
      return out;
    };
    for (const band of ['veil', 'bank'] as const) {
      expect(outline(band, 4)).toEqual(outline(band, 4));
      expect(outline(band, 4)).not.toEqual(outline(band, 6));
    }
  });
});
