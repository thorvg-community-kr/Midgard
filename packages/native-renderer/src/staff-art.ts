import { ShapeNode } from './paint';

/** A walking staff with a bent crown and one short branch, drawn around the grip. */
export function staffCrook(): ShapeNode {
  return new ShapeNode()
    .moveTo(-2.6, 4.8)
    .lineTo(4.3, -9.2)
    .cubicTo(5, -10.7, 3.5, -12.4, 4.2, -14.2)
    .cubicTo(5, -16.4, 7.5, -17.3, 9, -15.6)
    .moveTo(4.3, -9.2)
    .cubicTo(6, -9.6, 7.6, -10.7, 8.1, -12.2)
    .fill(0, 0, 0, 0)
    .strokeCap('round')
    .strokeJoin('round');
}
