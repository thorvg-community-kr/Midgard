import { Rect, rgba } from '../../../../packages/native-ui/src';
import type { GameCommandApp } from './game-commands';
import { selectionReferences } from './selection-targets';
import { hoveredTarget, struckByAttack, worldTarget, targetKey } from './world-targets';
import { Tool, Order } from '../../../../packages/engine/src/game-tools';
import type {
  WorldObjectRef,
  GroundSelectionMarker,
} from '../../../../packages/native-renderer/src/world-picking-types';
import { nameplateAnchor, nameplatePlace, paintWorldNameplate } from './world-nameplate';
import { guideSubject } from './game-guide';

/** Ground feedback belongs beneath world objects; only nameplates are drawn in the HUD. */
export function objectSelectionOverlay(app: GameCommandApp): void {
  const selected = selectionReferences(app);
  const refs = selected.length
    ? selected
    : !app.touchMode && app.tool === Tool.Select && !app.boxFrom && !app.panFrom
      ? [hoveredTarget(app)].filter((ref): ref is WorldObjectRef => !!ref)
      : [];
  const occupied: Rect[] = [],
    markers: GroundSelectionMarker[] = [],
    // What the guide's note is about is ringed like a hovered thing, unless the selection is already on it.
    told = guideSubject(app),
    marked = refs.map((ref) => ({ ref, hover: selected.length === 0 })),
    // An aimed attack marks the unit a click would strike, as a hovered one.
    aimed =
      selected.length && app.pending === Order.Attack && !app.touchMode && !app.boxFrom && app.targetingCursor()
        ? hoveredTarget(app)
        : null;
  if (aimed && struckByAttack(app, aimed) && !refs.some((ref) => ref.kind === aimed.kind && ref.id === aimed.id)) {
    marked.push({ ref: aimed, hover: true });
    refs.push(aimed);
  }
  if (told && !refs.some((ref) => ref.kind === told.kind && ref.id === told.id)) marked.push({ ref: told, hover: true });
  for (const { ref, hover } of marked) {
    const target = worldTarget(app, ref);
    // Ground feedback resolves current model positions even before a new frame is presented.
    markers.push({
      key: targetKey(ref),
      kind: ref.kind,
      hover,
      ...(target ? { geometry: target.geometry } : {}),
    });
    if (!target) continue;
    const g = target.geometry,
      dock = app.dockBounds,
      anchor = nameplateAnchor(g),
      center = anchor.x + anchor.w / 2,
      // The name sits under the target, where no health bar or mark is; the bottom panel is its floor.
      floor = dock && dock.h > 0 && center > dock.x - 90 && center < dock.x + dock.w + 90 ? dock.y : app.viewHeight,
      { bounds: r, below } = nameplatePlace(app.context, target.name, g, app.viewWidth, floor, 1.25),
      taken = () =>
        occupied.some(
          (other) =>
            r.x < other.x + other.w && r.x + r.w > other.x && r.y < other.y + other.h && r.y + r.h > other.y,
        );
    // Plates of neighbours stack away from the targets rather than over one another.
    if (below) while (taken() && r.y + r.h + 20 <= floor - 4) r.y += 20;
    else while (taken() && r.y > 25) r.y -= 20;
    occupied.push(r);
    paintWorldNameplate(
      app.context,
      app.context.elideText(target.name, r.w - 14, 10, true),
      r,
      hover ? rgba(143, 205, 225) : undefined,
    );
  }
  app.renderer.setGroundSelection(markers);
}
