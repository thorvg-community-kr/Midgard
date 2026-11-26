import type { Climate } from '../../engine/src/climate';
import { project, type Point } from '../../engine/src/geometry';
import { harvestProduct } from '../../engine/src/harvest-material';
import * as mining from '../../engine/src/mining';
import { clamp, hash01 } from '../../engine/src/numeric';
import { TreeWorkKind, type TreeWorkEvent } from '../../engine/src/person';
import type { WorldMap } from '../../engine/src/world-map';
import { depositColors } from './mining-stone';
import { SceneNode, ShapeNode, type Matrix } from './paint';
import { treeCrown, treeAt, TreeKind, type Tree } from './tree-painter';
import { mix } from './vector-paint';
import { drawLeaf, flutterLeaf } from './wind-leaves';
import type { WorldRendererState } from './world-renderer-state';

export interface HarvestDebris {
  paint: SceneNode;
  life: number;
  draw(age: number): void;
}
type Variation = (piece: number, salt: number) => number;

export const dustSeconds = 0.48;
/** A short wedge of earth rolls out of the joint while two flecks drop to the ground. */
export function buildingDust(at: Point, side: number, seed: number, event: TreeWorkEvent): HarvestDebris {
  const paint = new SceneNode();
  paint.transform([side, 0, at.x, 0, 1, at.y, 0, 0, 1]);
  const plume = new SceneNode();
  plume.add(new ShapeNode().moveTo(-4.6, 0.6).cubicTo(-5.0, -0.7, -3.8, -1.4, -2.5, -1.5)
    .cubicTo(-2.6, -3.2, -0.2, -4.1, 1.2, -2.6).cubicTo(3.2, -2.4, 2.9, -1.0, 4.6, -0.5)
    .cubicTo(4.2, 1.1, -0.8, 1.8, -4.6, 0.6).close().fill(141, 112, 87));
  plume.add(new ShapeNode().moveTo(-3.9, -0.5).cubicTo(-3.5, -1.8, -2.3, -1.0, -1.6, -2.6)
    .cubicTo(-0.7, -3.6, 0.8, -3.1, 1.2, -2.6).cubicTo(2.0, -1.4, 3.2, -1.4, 3.7, -0.8)
    .cubicTo(1.0, -1.0, -0.3, 0.8, -3.9, -0.5).close().fill(201, 173, 134));
  paint.add(plume);
  const chips = new SceneNode();
  for (const color of [[181, 145, 106], [123, 96, 73]] as const)
    chips.add(new ShapeNode().moveTo(-0.9, -0.25).lineTo(0.2, -0.7).lineTo(1, 0.1).lineTo(-0.4, 0.7).close()
      .fill(color[0], color[1], color[2]));
  paint.add(chips);
  const drift = 2 + 2.5 * hash01(seed, event.cell, Number(BigInt.asUintN(32, event.serial)), 0);
  return { paint, life: dustSeconds, draw(age) {
    const t = age / dustSeconds, out = 1 - (1 - t) ** 2;
    plume.transform([0.36 + out, 0, -drift * out, 0, 0.38 + 0.65 * out, -3.1 * out, 0, 0, 1])
      .opacity(200 * (1 - t * t));
    chips.children.forEach((chip, i) => chip.translate((i ? 3 : -5) * out, 5 * t * t - (i ? 2 : 1) * Math.sin(Math.PI * t)));
    chips.opacity(235 * (1 - t));
  } };
}

function stoneChips(base: Point, size: number, side: number, final: boolean,
  stone: ReturnType<typeof depositColors>, vary: Variation): HarvestDebris {
  const paint = new SceneNode().translate(base.x, base.y);
  const chips = Array.from({ length: final ? 7 : 4 }, (_, i) => {
    const node = new SceneNode(), tip = 1.1 + vary(i, 0);
    const color = i % 3 === 0 && stone.seam ? stone.seam : stone.lit;
    node.add(new ShapeNode().moveTo(-1.5, 0).lineTo(-0.55, -1.15).lineTo(tip, -0.35)
      .lineTo(0.6, 0.95).lineTo(-0.9, 0.65).close().fill(...mix(color, [224, 216, 207], 0.28 + 0.18 * vary(i, 1))));
    node.add(new ShapeNode().moveTo(-1.5, 0).lineTo(0.15, 0.15).lineTo(tip, -0.35)
      .lineTo(0.6, 0.95).lineTo(-0.9, 0.65).close().fill(...stone.shade));
    paint.add(node);
    return {
      node, air: 0.29 + 0.16 * vary(i, 2), lift: 3.8 + 5.5 * vary(i, 3),
      travel: (i % 4 === 3 ? side : -side) * (5 + (final ? 20 : 12) * vary(i, 4)),
      ground: 0.4 + 3.8 * vary(i, 5), spin: (vary(i, 6) - 0.5) * 6,
      angle: Math.PI * vary(i, 7), size: 0.67 + 0.62 * vary(i, 8) + (final ? 0.16 : 0),
    };
  });
  const life = Math.max(...chips.map(chip => chip.air)) + 0.27;
  return { paint, life, draw(age) {
    for (const chip of chips) {
      const t = Math.min(1, age / chip.air), hop = clamp((age - chip.air) / 0.15, 0, 1);
      const x = -side * size * 0.48 + chip.travel * (t + hop * 0.13);
      const y = -size * (side > 0 ? 0.60 : 0.45) * (1 - t) + chip.ground * t
        - 4 * chip.lift * (t * (1 - t) + 0.17 * hop * (1 - hop));
      const angle = chip.angle + chip.spin * (t + 0.14 * hop);
      const c = Math.cos(angle) * chip.size, sn = Math.sin(angle) * chip.size;
      chip.node.transform([c, -sn, x, sn, c, y, 0, 0, 1])
        .opacity(245 * clamp((chip.air + 0.27 - age) / 0.13, 0, 1));
    }
  } };
}

function shakenTree(s: WorldRendererState, tree: Tree, climate: Readonly<Climate>, side: number,
  final: boolean, wind: Matrix, vary: Variation): HarvestDebris {
  const base = project(tree.foot.x, tree.foot.y), paint = new SceneNode();
  const wood = new SceneNode().translate(base.x, base.y);
  for (let i = 0; i < 3; i++) {
    const splinter = new ShapeNode().moveTo(-0.5, -0.4).lineTo(1.3, -0.8).lineTo(0.7, 0.5).close();
    wood.add(i % 2 ? splinter.fill(147, 110, 68) : splinter.fill(194, 153, 95));
  }
  paint.add(wood);
  const count = tree.kind === TreeKind.Snag ? 0 : (final ? 5 : 2) + Math.floor(2 * vary(0, 0));
  const crown = treeCrown(tree), spruce = tree.kind === TreeKind.SnowySpruce;
  const leaves = Array.from({ length: count }, (_, i) => {
    const node = new SceneNode(), branch = i % 2 ? -side : side;
    drawLeaf(node, spruce ? 0 : climate.autumn, vary(i, 1));
    paint.add(node);
    const bx = base.x + branch * crown.halfWidth * (0.09 + 0.37 * vary(i, 2));
    const by = base.y - 5 * tree.size - crown.height * (0.27 + 0.40 * vary(i, 3));
    return {
      node, delay: 0.035 + 0.026 * i + 0.035 * vary(i, 4), life: 1.23 + 0.43 * vary(i, 5),
      start: { x: wind[0] * bx + wind[1] * by + wind[2], y: wind[3] * bx + wind[4] * by + wind[5] },
      groundY: base.y + 1 + 3 * vary(i, 6), travel: branch * (8 + 17 * vary(i, 7)) + 32 * climate.wind,
      phase: 2 * Math.PI * vary(i, 8), size: (spruce ? 0.54 : 0.68) + 0.4 * vary(i, 9),
    };
  });
  const splinterLife = 0.34;
  return { paint, life: Math.max(splinterLife, ...leaves.map(leaf => leaf.delay + leaf.life)), draw(age) {
    const t = Math.min(1, age / splinterLife), travel = 1 - (1 - t) ** 2;
    wood.opacity(Math.round(200 * (1 - t) ** 1.5));
    if (wood.alpha) wood.children.forEach((chip, i) => chip.translate(
      -side * (tree.size * 2.2 + travel * (3 + i * 1.7)),
      -tree.size * 1.2 * (1 - 0.7 * travel) - Math.sin(Math.PI * t) * (1.2 + i * 0.4),
    ));
    for (const leaf of leaves) flutterLeaf(s, leaf.node, leaf, (age - leaf.delay) / leaf.life);
  } };
}

export function harvestDebris(s: WorldRendererState, map: WorldMap, climate: Readonly<Climate>, event: TreeWorkEvent,
  side: number, final: boolean, wind: Matrix): HarvestDebris {
  const x = event.cell % map.width(), y = Math.floor(event.cell / map.width());
  const serial = Number(BigInt.asUintN(32, event.serial));
  const vary: Variation = (piece, salt) => hash01(map.seed(), event.cell, serial, piece * 16 + salt);
  if (event.kind === TreeWorkKind.Chop)
    return shakenTree(s, treeAt(map, x, y, event.index), climate, side, final, wind, vary);
  const foot = mining.position(x, y);
  const colors = depositColors(harvestProduct(map, x, y, true), map.basaltCell === event.cell);
  return stoneChips(project(foot.x, foot.y), mining.size(map, x, y), side, final, colors, vary);
}
