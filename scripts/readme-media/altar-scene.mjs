// Show the same resource and appearance controls the player uses to welcome a settler.
import { bootGame, recordGif } from './capture-session.mjs';
import { stageSettlement } from './settlement-scenes.mjs';

export async function captureAltar(session) {
  const page = await session.page(1280, 720);
  try {
    await bootGame(page, { width: 1280, height: 720 });
    await stageSettlement(page);
    const setup = await page.evaluate(() => {
      const { E, game } = media;
      const altar = game.town.buildings().find((b) => b.kind === E.Structure.Shrine);
      if (!altar) throw Error('The staged town has no altar');
      media.hour(17);
      game.selectPeople([]);
      game.openPrayer(altar.id);
      media.frames(4, 0.05);
      media.pressAltarControl = (id) => {
        const control = game.context.controls.find((c) => c.id.endsWith(id));
        if (!control?.enabled) throw Error('Unavailable altar control: ' + id);
        const x = control.bounds.x + control.bounds.w / 2, y = control.bounds.y + control.bounds.h / 2;
        for (const type of ['PointerMove', 'PointerDown', 'PointerUp'])
          game.handlePrayerEvent({ type, x, y, button: 1, key: 0, text: '', shift: false, control: false, alt: false, meta: false, delta: 0 });
      };
      return { altar: altar.id, population: game.town.population() };
    });
    const gif = await recordGif(page, 'altar', {
      count: 96,
      fps: 12,
      width: 800,
      colors: 192,
      clip: { x: 190, y: 82, width: 900, height: 556 },
      arg: [
        [7, 'offering-bundle-water'], [13, 'offering-bundle-bones'], [19, 'offering-more-stone'],
        [22, 'offering-more-stone'], [26, 'offering-more-gold'], [29, 'offering-more-gold'],
        [40, 'prayer-customize'], [50, 'prayer-hair-next'], [56, 'prayer-cloth-tone-2'],
        [65, 'prayer-back'], [76, 'prayer-confirm'],
      ],
      step: ([i, actions]) => {
        for (const [frame, control] of actions)
          if (i === Math.round(frame * media.rate)) media.pressAltarControl(control);
        media.frame(media.dt, true);
      },
    });
    const born = await page.evaluate(() => {
      const person = media.game.prayer?.born;
      if (!person) throw Error('No settler joined the town');
      return { name: person.name, level: person.level, calling: person.calling, strength: person.birthStrength, vitality: person.birthVitality };
    });
    return { setup, altar: { ...gif, born } };
  } finally {
    await page.context().close();
  }
}
