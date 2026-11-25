import { describe, expect, it } from 'vitest';
import { Structure } from '../../packages/engine/src/building-catalog';
import { add, Footprint, point, rotated } from '../../packages/engine/src/geometry';
import { Town } from '../../packages/engine/src/town';

describe('building placement at plot edges', () => {
  it('allows neighboring plots to share a side or a corner in every direction', () => {
    for (const angle of [0, Math.PI / 6]) {
      const plot = new Footprint(point(99.5, 56.5), 0.5, angle);
      for (const x of [-1, 0, 1]) {
        for (const y of [-1, 0, 1]) {
          if (x === 0 && y === 0) continue;
          const neighbor = (step: number) => new Footprint(
            add(plot.center, rotated(point(x * step, y * step), angle)), 0.5, angle,
          );
          expect(plot.overlaps(neighbor(1))).toBe(false);
          expect(neighbor(1).overlaps(plot)).toBe(false);
          expect(plot.overlaps(neighbor(0.999))).toBe(true);
        }
      }
    }
  });

  it('keeps a rotated corner clear until it crosses the side of another plot', () => {
    const plot = new Footprint(point(30, 30), 0.5);
    const againstSide = (offset: number) => new Footprint(
      point(30.5 + 0.4 * Math.SQRT2 + offset, 30), 0.4, Math.PI / 4,
    );
    expect(plot.overlaps(againstSide(0))).toBe(false);
    expect(againstSide(0).overlaps(plot)).toBe(false);
    expect(plot.overlaps(againstSide(-0.001))).toBe(true);
    expect(againstSide(-0.001).overlaps(plot)).toBe(true);
  });

  it.each([false, true])('checks the exact doorway whichever plot was previewed first (reversed = %s)', (reversed) => {
    const town = new Town(5), camp = town.map().camp();
    expect(town.place(Structure.Camp, camp, 0)).toBe(true);
    town.completeConstruction();
    town.tick(0);
    // The two doors straddle the clearance line beside the corner of the camp.
    const blocked = add(camp, point(0.68, -1.52));
    const walkable = add(camp, point(0.72, -1.52));
    const plots = [{ at: blocked, reason: 'Builders cannot reach its door' }, { at: walkable, reason: '' }];
    for (const { at, reason } of (reversed ? plots.reverse() : plots)) {
      expect(town.canPlace(Structure.Tent, at, 0).reason).toBe(reason);
    }
    expect(town.place(Structure.Tent, blocked, 0)).toBe(false);
    expect(town.place(Structure.Tent, walkable, 0)).toBe(true);
    town.tick(0);
    expect(town.grid.path(town.camp()!.door(), town.buildings().at(-1)!.door()).length).toBeGreaterThan(0);
  });
});
