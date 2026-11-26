// A party moves outside a dungeon in Midgard. The inspector sends the fighters to attack,
// its guardian and horde emerge, and an ally raises a fallen resident.
import { bootGame, clickControl, recordGif, still, wants } from './capture-session.mjs';

const width = 1280,
  height = 720;

/** Stage the recommended first-dungeon party at the approach to its entrance. */
async function stageParty(page) {
  await page.evaluate(async () => {
    const [{ gateOrder }, { monsterEntrance }, { dungeonStatus, targetedDungeon }, orders] = await Promise.all([
      import('/packages/engine/src/gate-progression.ts'),
      import('/packages/engine/src/town-monsters.ts'),
      import('/packages/engine/src/dungeon-siege.ts'),
      import('/apps/web/src/native/army-orders.ts'),
    ]);
    const { E, game } = media,
      t = game.town,
      map = t.map(),
      gate = gateOrder(t)[0],
      site = map.dungeons()[gate];
    media.condition = () => dungeonStatus(t, gate);
    media.assaultOrdered = () => t.folk.some(p => targetedDungeon(p) === gate);
    // The clips play on through a fall or a roused guardian, which would pause a real game for the player.
    media.playOn = () => {
      game.paused = false;
      game.speed = 1;
    };
    media.orders = orders;
    media.gate = gate;
    t.summonRaid = () => {};
    site.discovered = true;
    if (!t.place(E.Structure.Camp, map.camp(), 0)) throw Error('Cannot place the camp');
    t.completeConstruction();
    t.folk = [];
    const shape = (c) => (c === E.Calling.Warrior ? 'sword' : c === E.Calling.Ranger ? 'bow' : c === E.Calling.Mage ? 'staff' : 'mace');
    for (const calling of [E.Calling.Warrior, E.Calling.Warrior, E.Calling.Warrior, E.Calling.Ranger, E.Calling.Ranger,
      E.Calling.Mage, E.Calling.Mage, E.Calling.Cleric, E.Calling.Cleric, E.Calling.Bard]) {
      const p = t.makePerson(E.Role.Resident, calling, monsterEntrance(site));
      p.level = 10;
      p.food = p.rest = p.hydration = p.health = 1;
      const gear = E.itemCatalog.filter(it => it.tier === 2 && it.minimumLevel <= p.level);
      const weapon = gear.find(it => it.category === 'weapon' && it.visual === shape(calling));
      const shield = weapon?.hands === 1 && gear.find(E.isShield);
      const body = gear.find(it => it.category === 'armor' && it.slots.includes('body'));
      for (const [slot, item] of [['weapon', weapon], ['offhand', shield], ['body', body]]) {
        if (!item) continue;
        const index = p.inventory.findIndex(stack => !stack);
        p.inventory[index] = { item: item.id, quantity: 1 };
        p.equipment[slot] = index + 1;
      }
      p.abilityAuto = p.abilityAuto2 = 1;
      t.folk.push(p);
    }
    media.party = t.folk.map(p => p.id);
    media.entrance = monsterEntrance(site);
    for (const [i, p] of t.folk.entries())
      p.position = t.grid.nearestWalkable({ x: media.entrance.x - 6 + (i % 4) * 0.8, y: media.entrance.y - 4.5 + Math.floor(i / 4) });
    media.hour(11);
    game.objectivesCollapsed = true;
    media.inspect = () => {
      t.scout(media.entrance.x, media.entrance.y, 7);
      media.look(media.entrance, 1.6);
      game.selectObject({ kind: 'dungeon', id: gate });
      media.frames(6, 0.05);
    };
    media.quiet();
    media.inspect();
  });
}

export async function captureArmy(session) {
  const out = {},
    page = await session.page(width, height);
  try {
    await bootGame(page, { width, height });
    await stageParty(page);
    if (wants('expedition')) out.expedition = await still(page, 'expedition');

    // The whole party moves toward one ground mark, then holds.
    const move = await page.evaluate(() => {
      const { E, game } = media,
        t = game.town,
        lead = t.person(media.party[0]).position,
        spot = t.grid.nearestWalkable({ x: lead.x + 5, y: lead.y - 0.7 }),
        mid = { x: (spot.x + lead.x) / 2, y: (spot.y + lead.y) / 2 };
      media.view = mid;
      media.look(mid, 2);
      media.frames(2, 0.05, true);
      game.selectPeople(media.party);
      game.prepare(E.Order.Move);
      media.frames(2, 0.001);
      media.quiet();
      game.noticeFeed.length = 0;
      return media.screen(spot);
    });
    if (wants('formation'))
      out.formation = await recordGif(page, 'formation', {
        count: 160,
        fps: 12,
        width: 720,
        step: async ([i, at]) => {
          media.playOn();
          if (i === Math.round(4 * media.rate)) {
            media.game.pointerMove(at.x, at.y);
            media.game.pointerDown(at.x, at.y, 0);
            media.game.pointerUp(at.x, at.y, 0);
          }
          if (i === Math.round(50 * media.rate)) {
            if (!media.orders.holdPosition(media.game)) throw Error('The party did not hold');
            media.heldAt = i;
          }
          media.look(media.view, 2);
          media.frame(1.5 * media.dt, true);
          return media.heldAt !== undefined && i >= media.heldAt + 14 * media.rate;
        },
        arg: move,
      });

    if (wants('army-fight')) {
      await page.evaluate(() => media.inspect());
      await clickControl(page, 'gate-attack');
      await page.evaluate(() => {
        if (!media.assaultOrdered()) throw Error('Clicking Attack did not order the siege');
        media.game.selectPeople([]);
      });
      out.armyFight = await recordGif(page, 'army-fight', {
        count: 1400,
        last: 88,
        fps: 12,
        width: 672,
        colors: 112,
        clip: { x: 160, y: 56, width: 960, height: 540 },
        step: ([i]) => {
          media.playOn();
          media.look(media.entrance, 1.9);
          media.frame(media.dt, true);
          if (media.condition().phase === 'defending' && media.fellAt === undefined) media.fellAt = i;
          return media.fellAt !== undefined && i >= media.fellAt + 60 * media.rate;
        },
      });
      out.armyFight.dungeonFell = await page.evaluate(() => media.fellAt ?? -1);
      if (out.armyFight.dungeonFell < 0) throw Error('The guardian and horde did not emerge');
      if (wants('revive')) await page.evaluate(() => media.live(120, () => media.condition().phase === 'sealed'));
    }

    // A fall and a rescue: a warrior is struck down; the bard runs to kneel beside them and gets them up.
    if (wants('revive')) {
      await page.evaluate(() => {
        const { E, game } = media,
          t = game.town,
          party = media.party.map((id) => t.person(id)),
          warrior = party.find((p) => p.calling === E.Calling.Warrior && p.downedAt < 0),
          helper = party.find((p) => p.calling === E.Calling.Bard && p.downedAt < 0) ?? party.find((p) => p !== warrior && p.downedAt < 0);
        // The cleric's Mend would raise them from afar; the rescue here is by hand.
        const cleric = party.filter((p) => p.calling === E.Calling.Cleric).map((p) => p.id);
        t.setSkillAuto(cleric, 0, false);
        t.setSkillAuto(cleric, 1, false);
        media.fallen = warrior.id;
        media.helper = helper.id;
        // The helper starts a few steps away so the run to the body shows.
        const from = t.grid.nearestWalkable({ x: warrior.position.x + 2.4, y: warrior.position.y + 1.2 });
        helper.position = from;
        helper.path = [];
        t.strikeDown(warrior, 'Killed by monsters');
        media.view = { x: (warrior.position.x + from.x) / 2, y: (warrior.position.y + from.y) / 2 };
        game.selectPeople([helper.id]);
        media.frames(2, 0.05, true);
      });
      out.revive = await recordGif(page, 'revive', {
        count: 400,
        fps: 12,
        width: 720,
        clip: { x: 240, y: 110, width: 800, height: 450 },
        step: ([i]) => {
          media.playOn();
          const t = media.town,
            hurt = t.person(media.fallen);
          if (i === Math.round(10 * media.rate)) t.orderTend([media.helper], media.fallen);
          media.look(media.view, 2.3);
          media.frame(media.dt, true);
          if (hurt.downedAt < 0 && media.upAt === undefined) media.upAt = i;
          return media.upAt !== undefined && i >= media.upAt + 20 * media.rate;
        },
      });
      out.revive.upAtFrame = await page.evaluate(() => media.upAt ?? -1);
    }
  } finally {
    await page.context().close();
  }
  return out;
}
