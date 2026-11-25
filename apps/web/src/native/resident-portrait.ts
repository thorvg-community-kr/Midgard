import type { Person } from '../../../../packages/engine/src/person';
import { moodOf, personPortrait } from '../../../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import { frame, type Rect } from '../../../../packages/native-ui/src';
import type { GameAppState } from './game-app-state';
import { hudPaint } from './hud-paint';

export function portrait(app: GameAppState, p: Person, r: Rect): void {
  const c = app.context, mood = moodOf(p);
  frame(c, r);
  c.paint(JSON.stringify(['expedition-face', p.id, p.look, p.race, String(p.lookRevision), p.calling, mood, r]), () => {
    const paint = hudPaint(c, personPortrait(p, mood, r.w, r.h, portraitBackdrop(app.town.map(), p.position, app.town.climate())));
    paint.translate(r.x, r.y);
    return paint;
  });
}
