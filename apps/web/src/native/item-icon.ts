import { Rect, type Context } from '../../../../packages/native-ui/src';
import { isShield, type ItemSpec } from '../../../../packages/engine/src/equipment';
import { staffCrook } from '../../../../packages/native-renderer/src/staff-art';
import { hudPaint } from './hud-paint';

export function itemIcon(c: Context, r: Rect, item: ItemSpec | null, placeholder = false, active = false): void {
  const t = c.theme(),
    x = r.x + r.w / 2,
    y = r.y + r.h / 2,
    s = Math.min(r.w, r.h) / 32;
  const ink = active ? t.accentText : placeholder ? t.muted : t.accent;
  const line = (a: number, b: number, d: number, e: number, w = 2) =>
    c.line(x + a * s, y + b * s, x + d * s, y + e * s, ink, w * s);
  if (!item) return;
  if (item.category === 'resource') {
    if (item.id === 'wood' || item.id === 'frostwood' || item.id === 'bound-frostwood') {
      line(-8, 7, 7, -7, 7);
      line(-9, 6, 5, -8, 1);
      if (item.id === 'bound-frostwood') line(-4, -4, 3, 3, 3);
    } else if (item.id === 'planks') {
      for (const offset of [-7, 0, 7]) {
        line(-10, offset - 2, 10, offset - 2, 1.5);
        line(10, offset - 2, 10, offset + 2, 1.5);
        line(10, offset + 2, -10, offset + 2, 1.5);
        line(-10, offset + 2, -10, offset - 2, 1.5);
        line(-6, offset, 5, offset, 0.8);
      }
    } else if (item.id === 'hides') {
      line(-7, -7, -3, -3, 5); line(7, -7, 3, -3, 5);
      line(-6, 8, -2, 3, 5); line(6, 8, 2, 3, 5);
      c.rect(new Rect(x - 5 * s, y - 5 * s, 10 * s, 11 * s), ink, 3 * s);
    } else if (item.id === 'iron-ingot' || item.id === 'embersteel') {
      line(-8, 3, 7, -2, 8); line(-7, -1, 6, -5, 3);
    } else if (item.id === 'stone' || item.id === 'iron-ore' || item.id === 'cinder-ore') {
      line(-9, 7, -6, -5);
      line(-6, -5, 4, -9);
      line(4, -9, 10, 5);
      line(10, 5, -9, 7);
      line(-6, -5, 1, 1);
      line(1, 1, 10, 5);
    } else if (item.id === 'cut-stone') {
      for (const [left, top, width] of [
        [-10, 1, 9],
        [1, 1, 9],
        [-6, -7, 12],
      ]) {
        line(left, top, left + width, top, 1.5);
        line(left + width, top, left + width, top + 6, 1.5);
        line(left + width, top + 6, left, top + 6, 1.5);
        line(left, top + 6, left, top, 1.5);
      }
    } else if (item.id === 'bones') {
      line(-7, 6, 7, -6, 5);
      for (const [dx, dy] of [[-9, 4], [-6, 8], [6, -8], [9, -4]])
        c.rect(new Rect(x + (dx - 3) * s, y + (dy - 3) * s, 6 * s, 6 * s), ink, 3 * s);
    } else if (item.id === 'water') {
      line(0, -10, -7, 3);
      line(-7, 3, 0, 9);
      line(0, 9, 7, 3);
      line(7, 3, 0, -10);
    } else c.rect(new Rect(x - 7 * s, y - 7 * s, 14 * s, 14 * s), ink, 7 * s);
  } else if (item.id === 'cap' || item.id === 'helmet') {
    line(-9, 5, -7, -4);
    line(-7, -4, 0, -9);
    line(0, -9, 7, -4);
    line(7, -4, 9, 5);
    line(-10, 5, 10, 5);
    line(0, -8, 0, 3, 1);
  } else if (item.slots.includes('feet')) {
    line(-8, -9, -8, 7);
    line(-8, 7, -1, 7);
    line(-1, 7, -1, 2);
    line(-1, 2, -4, 1);
    line(-4, 1, -4, -9);
    line(2, -9, 2, 7);
    line(2, 7, 10, 7);
    line(10, 7, 9, 2);
    line(9, 2, 6, 1);
    line(6, 1, 6, -9);
  } else if (item.id === 'gloves') {
    line(-6, 9, -9, 0);
    line(-9, 0, -6, -2);
    line(-6, -2, -4, 2);
    line(-4, 2, -4, -8);
    line(-1, -7, -1, 0);
    line(2, -9, 2, 0);
    line(5, -6, 5, 4);
    line(5, 4, 2, 9);
    line(2, 9, -6, 9);
  } else if (isShield(item)) {
    line(-9, -8, 9, -8);
    line(9, -8, 7, 4);
    line(7, 4, 0, 10);
    line(0, 10, -7, 4);
    line(-7, 4, -9, -8);
    line(-6, -3, 6, -3, 1);
    line(0, -6, 0, 7, 1);
  } else if (item.id === 'cloak') {
    line(-4, -9, 4, -9);
    line(4, -9, 10, 10);
    line(10, 10, -10, 10);
    line(-10, 10, -4, -9);
    line(-4, -6, 0, -3);
    line(0, -3, 4, -6);
  } else if (item.visual === 'basket') {
    line(-8, -6, 8, -6);
    line(8, -6, 6, 9);
    line(6, 9, -6, 9);
    line(-6, 9, -8, -6);
    line(-7, -1, 7, -1, 1);
    line(-6, 4, 6, 4, 1);
    line(-4, -6, -2, -11, 1.5);
    line(-2, -11, 2, -11, 1.5);
    line(2, -11, 4, -6, 1.5);
  } else if (item.category === 'armor') {
    line(-9, -7, -3, -10);
    line(-3, -10, 3, -10);
    line(3, -10, 9, -7);
    line(9, -7, 6, 9);
    line(6, 9, -6, 9);
    line(-6, 9, -9, -7);
    line(0, -8, 0, 7, 1);
  } else if (item.visual === 'wateringCan') {
    c.rect(new Rect(x - 6 * s, y - 2 * s, 12 * s, 10 * s), ink, 2 * s);
    line(-5, -1, -8, -5); line(-8, -5, -6, -9); line(-6, -9, 0, -9); line(0, -9, 2, -4);
    line(5, 3, 10, -4, 3); line(8, -5, 12, -3, 2.2);
  } else if (item.visual === 'saw') {
    line(-10, 7, -5, 3, 5); line(-4, 2, 9, -8, 4.5);
    for (let i = 0; i < 4; i++) line(-2 + 3 * i, 3 - 2.3 * i, -1 + 3 * i, 5 - 2.3 * i, 2);
  } else if (item.visual === 'bow') {
    line(-5, -10, 2, -7);
    line(2, -7, 6, 0);
    line(6, 0, 2, 7);
    line(2, 7, -5, 10);
    line(-5, -10, -5, 10, 1);
    line(-9, 0, 10, 0, 1);
  } else if (item.visual === 'spear') {
    line(-9, 11, 6, -6, 2);
    line(6, -6, 4, -11, 2);
    line(4, -11, 10, -10, 2);
    line(10, -10, 6, -6, 2);
  } else if (item.visual === 'knife') {
    line(-8, 9, -3, 4, 3);
    line(-4, 3, 2, 1, 2);
    line(-1, 5, 8, -8, 3);
  } else if (item.visual === 'staff') {
    c.paint(JSON.stringify(['staff-icon', x, y, s, ink]), () => {
      const staff = staffCrook().strokeWidth(2).strokeFill(ink.r, ink.g, ink.b, ink.a);
      return hudPaint(c, staff.transform([s, 0, x - 3.2 * s, 0, s, y + 6 * s, 0, 0, 1]));
    });
  } else if (item.visual === 'sword' || item.visual === 'mace') {
    line(-7, 10, 7, -10, 3);
    line(-8, 4, -2, 9);
    if (item.visual === 'mace') c.rect(new Rect(x + 2 * s, y - 12 * s, 8 * s, 8 * s), ink, 3 * s);
  } else {
    line(-7, 10, 4, -8, 2);
    if (item.visual === 'hammer') line(-1, -10, 10, -3, 5);
    else if (item.visual === 'shovel') {
      line(2, -6, 9, -13, 7);
      line(1, -5, 6, -10, 3);
    } else if (item.visual === 'sickle') {
      line(4, -8, 9, -9);
      line(9, -9, 11, -4);
      line(11, -4, 8, 1);
    }
    else if (item.visual === 'axe') {
      line(1, -8, 10, -8, 5);
      line(10, -8, 10, 0, 3);
    } else line(-3, -10, 10, -3, 2);
  }
}

type Rgb = [number, number, number];
const materials: Record<NonNullable<ItemSpec['material']>, [Rgb, Rgb]> = {
  wood: [[220, 176, 117], [157, 111, 75]], stone: [[193, 195, 180], [123, 134, 136]],
  iron: [[207, 216, 219], [131, 148, 164]], embersteel: [[227, 159, 122], [158, 99, 93]],
  frostwood: [[200, 219, 200], [130, 163, 158]],
};

/** Larger inventory and recipe pictures show the material and cutting edge against a dark mount. */
export function itemIllustration(c: Context, box: Rect, item: ItemSpec): void {
  const kind = item.visual;
  if (!kind || !['axe', 'pickaxe', 'hammer', 'mace', 'sword', 'knife', 'spear', 'hoe', 'shovel'].includes(kind)) {
    itemIcon(c, box, item);
    return;
  }
  c.paint(JSON.stringify(['item-picture', kind, item.material, box]), () => {
    const scene = new c.tvg.Scene(), [face, bevel] = materials[item.material ?? 'wood'];
    const wood: Rgb = [163, 116, 78], binding: Rgb = [233, 198, 140];
    const plane = (ink: Rgb, ...points: number[]) => {
      const shape = new c.tvg.Shape().moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) shape.lineTo(points[i], points[i + 1]);
      shape.close().fill(...ink, 255);
      scene.add(shape);
      shape.dispose();
    };
    plane(wood, -1.6, 13, 1.6, 13, 1.2, -9, -1.2, -9);
    switch (kind) {
      case 'sword':
      case 'knife':
        plane(face, -2.5, 5, -2.5, -8, 0, -14, 2.5, -8, 2.5, 5);
        plane(bevel, 0, -14, 2.5, -8, 2.5, 5, 0, 5);
        plane(binding, -5.5, 6, -5.5, 4, 5.5, 4, 5.5, 6);
        break;
      case 'axe':
        plane(face, -3, -10, 2, -11, 5, -10, 9, -12, 10, -8, 9.6, -4, 8, 0, 4.4, -2.5, 3.4, -5.8, -3, -6);
        plane(bevel, 9, -12, 10, -8, 9.6, -4, 8, 0, 6.5, -1, 8.5, -6);
        break;
      case 'pickaxe':
      case 'hoe':
        plane(face, -9, -4, -7, -8, -2, -11, 3, -11, 7, -9, 10, -4, 4, -7, 0, -7, -4, -7);
        plane(bevel, 0, -8.5, 6, -8.4, 10, -4, 4, -7, 0, -7);
        if (kind === 'hoe') plane(bevel, 5, -9, 9, -8, 9, -1, 5, -3);
        break;
      case 'hammer':
      case 'mace':
        if (kind === 'hammer') {
          plane(face, -6, -11, 5, -11, 7, -9, 7, -4, -5, -4, -7, -6, -7, -10);
          plane(bevel, -7, -6, 5, -6, 7, -9, 7, -4, -5, -4);
        } else {
          plane(face, -2, -13, 3, -13, 5, -10, 4, -5, 2, -2, -2, -2, -5, -6, -5, -10);
          plane(bevel, 2, -13, 5, -10, 4, -5, 2, -2, -1, -2);
        }
        break;
      case 'spear':
        plane(face, 0, -15, 3.5, -8, 1.2, -4.5, -1.2, -4.5, -3.5, -8);
        plane(bevel, 0, -15, 3.5, -8, 1.2, -4.5, 0, -4.5);
        break;
      case 'shovel':
        plane(face, 0, -14, 3, -12, 5, -8, 4.5, -4, -4.5, -4, -5, -8, -3, -12);
        plane(bevel, 0, -14, 3, -12, 5, -8, 4.5, -4, 0, -4);
        break;
    }
    plane(binding, -1.6, 10, 1.6, 9.3, 1.6, 10.6, -1.6, 11.3);
    const scale = Math.min(box.w, box.h) / 29, a = scale * 0.81, b = scale * 0.59;
    scene.transform({ e11: a, e12: -b, e13: box.x + box.w / 2, e21: b, e22: a, e23: box.y + box.h / 2, e31: 0, e32: 0, e33: 1 });
    return scene;
  });
}
