import { FrameStyle, Theme, rgba } from '../../../../packages/native-ui/src';
import { reducedMotionPreferred } from './motion-preference';
export { reducedMotionPreferred } from './motion-preference';

/**
 * The interface is cut from the same flat planes as the world: dusk-indigo boards with a thickness, lit from
 * above, ochre paint for trim and what matters, limewash for writing. No outline, gradient or glow.
 */
export function gameTheme(): Theme {
  const t = Theme.dark();
  t.background = rgba(24, 23, 38);
  t.surface = rgba(44, 42, 64);
  t.raised = rgba(64, 60, 90);
  t.well = rgba(28, 27, 44);
  t.border = rgba(170, 134, 78, 150);
  t.text = rgba(242, 232, 210);
  t.muted = rgba(170, 164, 174);
  t.accent = rgba(226, 180, 98);
  t.accentText = rgba(46, 32, 28);
  t.selection = rgba(84, 72, 104);
  t.danger = rgba(232, 118, 92);
  t.success = rgba(152, 196, 134);
  t.light = rgba(255, 240, 210);
  t.dusk = rgba(14, 12, 28);
  t.shadow = rgba(18, 15, 36, 96);
  t.paper = rgba(238, 227, 200);
  t.ink = rgba(50, 40, 48);
  t.inkMuted = rgba(112, 98, 98);
  t.inkAccent = rgba(158, 84, 44);
  t.inkDanger = rgba(172, 50, 38);
  t.radius = 3;
  t.font = 'AlegreyaSans-Medium';
  t.boldFont = 'AlegreyaSans-ExtraBold';
  t.titleFont = 'Cinzel-Bold';
  t.titleFrom = 14;
  t.fontScale = 1.14;
  t.frameStyle = FrameStyle.Carved;
  t.reducedMotion = reducedMotionPreferred();
  return t;
}
