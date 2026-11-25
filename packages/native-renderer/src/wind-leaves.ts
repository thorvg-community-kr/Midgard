import { Weather, type Climate } from '../../engine/src/climate';
import { project, unproject, type Point } from '../../engine/src/geometry';
import { hash01 } from '../../engine/src/numeric';
import { Rect } from '../../native-ui/src/types';
import { DepthSlot } from './combat-depth';
import { SceneNode, ShapeNode } from './paint';
import { mix } from './vector-paint';
import type { WorldRendererState } from './world-renderer-state';

interface Crown {
  tree: SceneNode;
  foot: Point;
  bounds: Rect;
}
const crowns = new WeakMap<SceneNode, Crown>();
export function registerLeafCrown(tree: SceneNode, foot: Point, bounds: Rect): void {
  crowns.set(tree, { tree, foot, bounds });
}

const inSight = (s: WorldRendererState, at: Point): boolean =>
  !s.fogged || s.mistLifted || s.currentVisibility.sample(at) >= 119;

/** A gust visits one living crown in view. Only the release needs to look through the tree rows. */
function nearestCrown(s: WorldRendererState, targetX: number, targetY: number): Crown | undefined {
  const halfW = s.viewWidth / (2 * s.view.zoom), halfH = s.viewHeight / (2 * s.view.zoom);
  let best: Crown | undefined, nearest = Infinity;
  for (let row = 0; row < s.rowCanopies.length; row++) {
    if (!s.rowTrees[row].alpha) continue;
    for (const tree of s.rowCanopies[row]) {
      const crown = crowns.get(tree);
      if (!crown) continue;
      const box = crown.bounds, x = box.x + box.w * 0.5, y = box.y + box.h * 0.5;
      if (Math.abs(x - s.view.x) > halfW || Math.abs(y - s.view.y) > halfH) continue;
      const gap = (x - targetX) ** 2 + (y - targetY) ** 2;
      if (gap < nearest && inSight(s, crown.foot)) {
        nearest = gap;
        best = crown;
      }
    }
  }
  return best;
}

export interface LeafFlight {
  start: Point;
  groundY: number;
  travel: number;
  phase: number;
  size: number;
}
interface Leaf extends LeafFlight {
  slot: DepthSlot;
  at: number;
  life: number;
}

export function drawLeaf(node: SceneNode, autumn: number, tint: number): void {
  const color = mix(mix([100, 132, 76], [139, 151, 83], tint), [177, 124, 61], autumn);
  const face = new ShapeNode().moveTo(-3.5, 0.3)
    .cubicTo(-1.8, -1.7, 0.4, -1.9, 3.6, -0.4)
    .cubicTo(1.4, 0.4, -0.6, 2.3, -3.5, 0.3).close().fill(...color);
  const fold = new ShapeNode().moveTo(-3.5, 0.3)
    .cubicTo(-1.5, 0.7, 1.2, -0.3, 3.6, -0.4)
    .cubicTo(1.4, 0.4, -0.6, 2.3, -3.5, 0.3).close().fill(...mix(color, [40, 54, 38], 0.48));
  node.add(face).add(fold);
}

/** A loose leaf catches the air, curls down toward its ground point and turns edge-on. */
export function flutterLeaf(s: WorldRendererState, paint: SceneNode, leaf: LeafFlight, t: number): void {
  if (t <= 0 || t >= 1) {
    paint.opacity(0);
    return;
  }
  const arc = Math.sin(Math.PI * t), turn = leaf.phase + t * 8.5;
  const x = leaf.start.x + leaf.travel * t * (1.32 - 0.32 * t) + arc * 3.5 * Math.sin(turn);
  const y = leaf.start.y + (leaf.groundY - leaf.start.y) * t * (0.45 + 0.55 * t)
    - arc * (3 + 4.8 * Math.cos(turn));
  const angle = 0.16 + 0.75 * Math.sin(turn);
  const c = Math.cos(angle) * leaf.size, sn = Math.sin(angle) * leaf.size;
  const roll = 0.16 + 0.84 * Math.abs(Math.cos(turn * 1.35));
  const alpha = inSight(s, unproject(x, leaf.groundY)) ? 230 * Math.min(1, t / 0.06, (1 - t) / 0.17) : 0;
  paint.transform([c, -sn * roll, x, sn, c * roll, y, 0, 0, 1]).opacity(alpha);
}

const gustPeriod = 2.5;
export class WindLeaves {
  private readonly leaves: Leaf[] = [];
  private gust = -1;
  private lastTime = -1;

  clear(): void {
    for (const leaf of this.leaves) leaf.slot.detach();
    this.leaves.length = 0;
    this.gust = -1;
    this.lastTime = -1;
  }

  update(s: WorldRendererState, seed: number, climate: Readonly<Climate>, seconds: number): void {
    if (s.editorView || s.reducedMotion || s.view.zoom < 0.65 || !s.viewWidth || !s.viewHeight || !s.rows.length) {
      this.clear();
      return;
    }
    if (seconds < this.lastTime) this.clear();
    this.lastTime = seconds;
    const gust = Math.floor(seconds / gustPeriod);
    if (gust !== this.gust) {
      const release = (gust + 0.12 + 0.48 * hash01(seed, gust, 0, 1)) * gustPeriod;
      if (seconds >= release) {
        this.gust = gust;
        // Even a clear day's stronger breezes can catch a loose leaf before the whole tree sways.
        const canShed = climate.wind > 0.14 && climate.snow <= 0.3 && climate.weather !== Weather.Snow;
        const chance = 0.42 + 0.85 * climate.wind + 0.14 * climate.autumn;
        if (canShed && hash01(seed, gust, 0, 2) < chance) this.release(s, seed, gust, release, climate);
      }
    }
    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const leaf = this.leaves[i], t = Math.max(0, (seconds - leaf.at) / leaf.life);
      if (t >= 1) {
        leaf.slot.detach();
        this.leaves.splice(i, 1);
        continue;
      }
      flutterLeaf(s, leaf.slot.node, leaf, t);
    }
  }

  private release(s: WorldRendererState, seed: number, gust: number, at: number, climate: Readonly<Climate>): void {
    const crown = nearestCrown(
      s,
      s.view.x + (hash01(seed, gust, 0, 3) - 0.5) * s.viewWidth / s.view.zoom,
      s.view.y + (hash01(seed, gust, 0, 4) - 0.5) * s.viewHeight / s.view.zoom,
    );
    if (!crown) return;
    const { foot, bounds, tree } = crown;
    const groundY = project(foot.x, foot.y).y + 0.8, m = tree.matrix;
    const count = 1 + Math.floor(1.2 * climate.wind + 0.55 * climate.autumn + hash01(seed, gust, 0, 5));
    for (let i = 0; i < count; i++) {
      const part = (salt: number) => hash01(seed, gust, i, salt);
      const bx = bounds.x + bounds.w * (0.54 + 0.15 * part(6));
      const by = bounds.y + bounds.h * (0.36 + 0.28 * part(7));
      const start = { x: m[0] * bx + m[1] * by + m[2], y: m[3] * bx + m[4] * by + m[5] };
      const travel = (38 + 62 * climate.wind) * (0.85 + 0.5 * part(8));
      const slot = new DepthSlot(`leaf:${gust}:${i}`);
      drawLeaf(slot.node, climate.autumn, part(9));
      // Downwind is screen-right, along a single ground depth. Keep that place among the standing scenery.
      const midpoint = unproject(start.x + travel * 0.5, groundY);
      slot.place(s, midpoint, new Rect(start.x - 9, start.y - 12, travel + 18, groundY - start.y + 20));
      this.leaves.push({
        slot, start, travel, groundY,
        at: at + i * (0.14 + 0.22 * part(10)),
        life: 2.7 + part(11),
        phase: 2 * Math.PI * part(12),
        size: 0.78 + 0.4 * part(13),
      });
    }
  }
}
