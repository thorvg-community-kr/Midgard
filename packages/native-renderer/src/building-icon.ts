import { point } from '../../engine/src/geometry';
import { f32 } from '../../engine/src/numeric';
import { Structure, structureSpec } from '../../engine/src/building-catalog';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { BuildingProjection, orientModel, splitAngle, type Model } from './building-model';
import { validateBuildingAsset } from './building-asset';
import { buildingFaces, Motion, FaceStyle, softEdge } from './building-faces';
import { depthBatches } from './building-depth';
import { structureModel } from './building-assets';
export function buildingIcon(
  source: Model,
  size: number,
  width: number,
  height: number,
  angle = 0,
  projection = new BuildingProjection(),
): SceneNode {
  validateBuildingAsset({ id: 'preview', name: 'Preview', footprint: size, variants: [source] });
  if (
    ![angle, width, height, projection.halfWidth, projection.halfHeight].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    projection.halfWidth <= 0 ||
    projection.halfWidth > 512 ||
    projection.halfHeight <= 0 ||
    projection.halfHeight > 512
  )
    throw new Error('invalid building icon dimensions');
  const model = structuredClone(source),
    { quarterTurns: quarter, remainder: turn } = splitAngle(angle);
  orientModel(model, quarter, size);
  const still = new Motion();
  still.turn = turn;
  still.projection = projection;
  still.pivot = point(f32(size / 2), f32(size / 2));
  const faces = buildingFaces(model, still),
    batches = depthBatches(faces, 1000),
    icon = new SceneNode();
  if (!batches.length) return icon;
  let minX = 3.4028234663852886e38,
    minY = minX,
    maxX = -minX,
    maxY = -minX;
  for (const batch of batches)
    for (const polygon of batch.polygons)
      for (const p of polygon) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
  const k = Math.min(f32(width / Math.max(1, f32(maxX - minX))), f32(height / Math.max(1, f32(maxY - minY))));
  for (const batch of batches) {
    const face = faces[batch.source],
      alpha = face.opacity.length ? f32(face.opacity[f32(face.opacity.length - 1)][1] / 100) : 1;
    if (alpha <= 0) continue;
    const shape = new ShapeNode();
    for (const polygon of batch.polygons) {
      shape.moveTo(f32(f32(polygon[0].x - minX) * k), f32(f32(polygon[0].y - minY) * k));
      for (let j = 1; j < polygon.length; j++)
        shape.lineTo(f32(f32(polygon[j].x - minX) * k), f32(f32(polygon[j].y - minY) * k));
      if (!batch.line) shape.close();
    }
    const a = Math.trunc(f32(255 * alpha)) & 255;
    if (batch.line) {
      const outline = face.style === FaceStyle.Outlined,
        color: Rgb = outline ? softEdge(face) : face.color;
      shape
        .strokeWidth(Math.max(outline ? f32(0.5) : f32(0.6), f32(face.width * k)))
        .strokeCap('round')
        .strokeJoin('round')
        .strokeFill(...color, a);
    } else shape.fill(...face.color, a);
    icon.add(shape);
  }
  icon.translate(
    f32(f32(width - f32(f32(maxX - minX) * k)) / 2),
    f32(f32(height - f32(f32(maxY - minY) * k)) / 2),
  );
  return icon;
}
export function structureIcon(kind: Structure, width: number, height: number): SceneNode {
  const building = buildingIcon(structureModel(kind, 4), structureSpec(kind).size, width, height);
  if (kind !== Structure.ChickenCoop && kind !== Structure.Cowshed) return building;
  const badge = new SceneNode().add(new ShapeNode().appendCircle(12, 12, 12).fill(46, 48, 55));
  if (kind === Structure.ChickenCoop) {
    // A hen in profile, with her tail lifted and her red comb above the bill.
    badge.add(new ShapeNode().moveTo(4, 9).lineTo(9, 12).cubicTo(12, 12, 11, 7, 14, 7)
      .cubicTo(18, 6, 19, 9, 18, 12).cubicTo(18, 17, 15, 19, 11, 19)
      .cubicTo(7, 19, 5, 16, 4, 13).lineTo(6, 14).close().fill(244, 224, 177));
    badge.add(new ShapeNode().moveTo(13, 7.5).cubicTo(11, 5, 13, 3, 15, 5)
      .cubicTo(16, 2, 19, 4, 18, 7.5).close().fill(218, 95, 72));
    badge.add(new ShapeNode().moveTo(18, 9).lineTo(22, 11).lineTo(17.5, 12).close().fill(235, 173, 70));
    badge.add(new ShapeNode().appendCircle(16, 9.5, 0.9).fill(52, 47, 49));
  } else {
    // The cow's horns, wide ears and pale muzzle read head-on.
    badge.add(new ShapeNode().moveTo(9, 9).cubicTo(5, 9, 4, 6, 5, 3)
      .cubicTo(6, 6, 8, 6, 10, 6.5).close()
      .moveTo(15, 9).cubicTo(19, 9, 20, 6, 19, 3)
      .cubicTo(18, 6, 16, 6, 14, 6.5).close().fill(242, 221, 171));
    badge.add(new ShapeNode().moveTo(7, 8.5).cubicTo(9, 6.5, 15, 6.5, 17, 8.5)
      .cubicTo(19, 8, 20, 8, 22, 9).cubicTo(21, 12, 19, 13, 17, 12)
      .lineTo(15.5, 18).cubicTo(15, 21, 9, 21, 8.5, 18).lineTo(7, 12)
      .cubicTo(5, 13, 3, 12, 2, 9).cubicTo(4, 8, 5, 8, 7, 8.5).close().fill(198, 136, 88));
    badge.add(new ShapeNode().appendCircle(12, 17.5, 4.3, 2.8).fill(244, 208, 165));
    badge.add(new ShapeNode().appendCircle(9.5, 11.5, 0.9).appendCircle(14.5, 11.5, 0.9).fill(52, 47, 49));
  }
  // The building is centered in the slot. Keep the animal against the artwork even in a wide card.
  const size = Math.min(24, Math.min(width, height) * 0.48),
    scale = size / 24,
    right = width - building.matrix[2],
    bottom = height - building.matrix[5];
  badge.transform([scale, 0, right - size, 0, scale, bottom - size, 0, 0, 1]);
  return new SceneNode().add(building).add(badge);
}
