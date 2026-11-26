import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { Building, Field } from '../../packages/engine/src/town-models';
import { Structure, structureSpec } from '../../packages/engine/src/building-catalog';
import { Tool, toolStructure } from '../../packages/engine/src/game-tools';
import { Activity, Calling, Role } from '../../packages/engine/src/person';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { point } from '../../packages/engine/src/geometry';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { RaidKind } from '../../packages/engine/src/raid-progression';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { Boon, boon } from '../../packages/engine/src/gate-boons';
import { sealFloors, sealable } from '../../packages/engine/src/gate-seals';
import { towerVolley } from '../../packages/engine/src/progression-rules';
import { BUILDING_ASSETS } from '../../packages/content/src/assets';
import { addInventory, itemSpec } from '../../packages/engine/src/equipment';
import { levelVariant, stationLevel } from '../../packages/engine/src/craft-stations';
import { decodeBuildingAsset } from '../../packages/native-renderer/src/building-asset';
import {
  GoalBranch,
  GoalKind,
  buildingUnlock,
  completedFacility,
  currentGoal,
  deedCount,
  goalComplete,
  goalProgress,
  settlementGoals,
  toolAvailable,
  unlockRequirements,
  type SettlementGoal,
} from '../../packages/engine/src/settlement-progression';

const added = [Structure.Watchtower, Structure.TrainingYard, Structure.Runestone];

function settlement(width = 32) {
  const town = new Town(5, width, false),
    camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(0);
  const gate = town.map().dungeons().findIndex((site) => site.kind !== DungeonKind.GiantHall);
  town.map().dungeons()[gate].discovered = true;
  return { town, camp, gate };
}
function facility(town: Town, kind: Structure, at = town.map().camp()): Building {
  const b = new Building(town.nextId++, kind, { ...at }, 0, 0);
  b.village = 0;
  town.placed.push(b);
  return b;
}
function residents(town: Town, count: number): void {
  while (town.population() < count)
    town.folk.push(town.makePerson(Role.Resident, Calling.Settler, town.map().camp()));
}
/** A finished road out of the camp, as the second founding quest asks. */
function road(town: Town): void {
  const c = town.map().camp(),
    id = town.roads().add([sharpAnchor(c), sharpAnchor(point(c.x + 3, c.y))], 1);
  town.roads().road(id)!.village = 0;
}
function worker(town: Town, job: Building) {
  const p = town.makePerson(Role.Resident, Calling.Settler, { ...job.center });
  p.job = job.id;
  town.folk.push(p);
  return p;
}

describe('new buildings', () => {
  it('are appended after the old catalog with tools, assets and growth chains intact', () => {
    expect(Structure.Watchtower).toBe(35);
    // The workbench came after these, appended so saved building kinds keep their numbers.
    expect(Structure.Workbench).toBe(38);
    expect(Structure.Foundry).toBe(39);
    expect(Structure.ChickenCoop).toBe(40);
    expect(Structure.Cowshed).toBe(41);
    expect(Structure.Count).toBe(42);
    expect(added.map((kind) => structureSpec(kind).name)).toEqual(['Watchtower', 'Training yard', 'Runestone']);
    expect(added.map((kind) => structureSpec(kind).jobs)).toEqual([0, 0, 0]);
    expect(structureSpec(Structure.Runestone).cost.stone).toBeGreaterThan(structureSpec(Structure.Runestone).cost.wood);
    for (let kind = 0; kind < Structure.Count; ++kind) {
      const next = structureSpec(kind).next;
      expect(next).toBeLessThanOrEqual(Structure.Count);
      expect([...added, Structure.Foundry]).not.toContain(next);
    }
    expect([Tool.Watchtower, Tool.TrainingYard, Tool.Runestone].map(toolStructure)).toEqual(added);
    expect(Tool.Runestone + 1).toBe(Tool.Workbench);
    expect(toolStructure(Tool.Workbench)).toBe(Structure.Workbench);
    expect(Tool.Workbench + 1).toBe(Tool.Foundry);
    expect(toolStructure(Tool.Foundry)).toBe(Structure.Foundry);
    expect(Tool.Foundry + 1).toBe(Tool.ChickenCoop);
    expect(toolStructure(Tool.ChickenCoop)).toBe(Structure.ChickenCoop);
    expect(Tool.ChickenCoop + 1).toBe(Tool.Cowshed);
    expect(toolStructure(Tool.Cowshed)).toBe(Structure.Cowshed);
    expect(Tool.Cowshed + 1).toBe(Tool.Count);
    for (const [key, id] of [
      ['Watchtower', 'watchtower'],
      ['TrainingYard', 'training-yard'],
      ['Runestone', 'runestone'],
      ['Foundry', 'foundry'],
      ['ChickenCoop', 'ranch'],
      ['Cowshed', 'cowshed'],
    ] as const) {
      const asset = decodeBuildingAsset(JSON.stringify(BUILDING_ASSETS[key]));
      expect(asset.id).toBe(id);
      expect(asset.footprint).toBe(structureSpec(Structure[key]).size);
      expect(asset.variants).toHaveLength(1);
      // The building art is lineless: the shaded side is the lit colour pulled toward dusk indigo.
      for (const block of BUILDING_ASSETS[key].variants[0].blocks)
        block.wallLit.forEach((lit, i) =>
          expect(Math.abs(block.wallShade[i] - (lit * 0.68 + [46, 44, 84][i] * 0.32))).toBeLessThanOrEqual(1),
        );
    }
  });
  it('rejects removed and unknown tools and building commands', () => {
    const { town, camp } = settlement();
    for (const tool of [Tool.Count, Tool.Count + 1]) {
      expect(toolAvailable(town, tool)).toBe(false);
      expect(toolStructure(tool)).toBeUndefined();
    }
    for (const kind of [Structure.Count, Structure.Count + 1]) {
      expect(town.place(kind, camp.center, 0)).toBe(false);
    }
    expect(town.placed).toEqual([camp]);
  });
  it('place, build and survive a save', () => {
    const { town, camp } = settlement();
    town.scout(camp.center.x, camp.center.y, 30);
    for (const kind of added) {
      let spot = null;
      for (let r = 3; r < 14 && !spot; ++r)
        for (let a = 0; a < 16 && !spot; ++a) {
          const p = point(camp.center.x + r * Math.cos(a * 0.39), camp.center.y + r * Math.sin(a * 0.39));
          if (town.canPlace(kind, p, 0).ok) spot = p;
        }
      expect(spot, structureSpec(kind).name).not.toBeNull();
      expect(town.place(kind, spot!, 0)).toBe(true);
    }
    town.completeConstruction();
    for (const kind of added) expect(town.placed.find((b) => b.kind === kind)?.built()).toBe(true);
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true));
    expect(loaded.placed.map((b) => [b.kind, b.built()])).toEqual(town.placed.map((b) => [b.kind, b.built()]));
    expect(encodeTown(loaded)).toBe(encodeTown(town));
  });
});

describe('watchtower', () => {
  function raid() {
    const { town, camp } = settlement();
    town.days = 14;
    town.summonRaid(RaidKind.Pack);
    const tower = facility(town, Structure.Watchtower, point(camp.center.x + 6, camp.center.y));
    for (const beast of town.beasts) beast.position = point(tower.center.x + 3, tower.center.y + 1);
    return { town, tower };
  }
  it('shoots raiders as soon as the tower is complete, with no worker', () => {
    const { town, tower } = raid(),
      before = town.beasts.map((b) => b.health);
    tower.progress = 0.9;
    town.defendSettlement(0.1);
    expect(town.beasts.map(b => b.health)).toEqual(before);
    tower.progress = 1;
    town.defendSettlement(0.1);
    const lost = before.reduce((sum, h, i) => sum + h - town.beasts[i].health, 0),
      might = boon(town, Boon.Bulwark) ? 1.5 : 1;
    expect(lost).toBeCloseTo(towerVolley.damage * might, 4);
    const shot = town.hits().at(-1)!;
    expect(shot).toMatchObject({ ranged: true, onPerson: false, person: -1, from: tower.center });
    // One arrow per pause.
    town.defendSettlement(0.1);
    expect(before.reduce((sum, h, i) => sum + h - town.beasts[i].health, 0)).toBeCloseTo(lost, 4);
    town.time += towerVolley.pause;
    town.defendSettlement(0.1);
    expect(before.reduce((sum, h, i) => sum + h - town.beasts[i].health, 0)).toBeCloseTo(lost * 2, 4);
  });
  it('reaches about nine tiles and ignores peaceful wildlife', () => {
    const { town, tower } = raid();
    for (const beast of town.beasts) beast.position = point(tower.center.x + towerVolley.reach + 0.5, tower.center.y);
    const before = town.beasts.map((b) => b.health);
    town.defendSettlement(0.1);
    expect(town.beasts.map((b) => b.health)).toEqual(before);
    for (const beast of town.beasts) beast.position = point(tower.center.x + towerVolley.reach - 0.5, tower.center.y);
    town.defendSettlement(0.1);
    expect(town.beasts.some((b, i) => b.health < before[i])).toBe(true);
  });
  it('shoots half again as hard with the Bulwark boon', () => {
    const { town, tower } = raid();
    const jotunheim = town
      .map()
      .dungeons()
      .findIndex((site, index) => {
        town.depth = town.map().dungeons().map((_, i) => (i === index ? sealFloors : 0));
        return sealable(site) && boon(town, Boon.Bulwark);
      });
    expect(jotunheim).toBeGreaterThanOrEqual(0);
    const might = 1.5,
      mark = town.beasts[0],
      before = mark.health;
    for (const beast of town.beasts.slice(1)) beast.position = point(0, 0);
    town.defendSettlement(0.1);
    expect(before - mark.health).toBeCloseTo(towerVolley.damage * might, 4);
  });
});

describe('military buildings without jobs', () => {
  it.each([Structure.Watchtower, Structure.TrainingYard])('frees old workers on load and keeps other jobs intact (%s)', kind => {
    const { town } = settlement(), school = facility(town, kind), old = worker(town, school);
    const wood = facility(town, Structure.Lumberyard), lumberjack = worker(town, wood);
    const arriving = worker(town, school);
    Object.assign(arriving, { job: -1, task: Activity.Working, activity: Activity.Moving, taskSite: school.id,
      target: -1, path: [school.door()], ordered: true });
    Object.assign(old, { task: Activity.Working, activity: Activity.Working, taskSite: school.id, target: school.id, inside: true });
    school.wanted = 1;
    expect(structureSpec(kind).jobs).toBe(0);
    expect(town.assignJob([lumberjack.id], school.id)).toBe(false);
    const loaded = decodeTown(encodeTown(town), map => new Town(map, 32, false, true));
    expect(loaded.person(old.id)).toMatchObject({ job: -1, task: Activity.Idle, activity: Activity.Idle, inside: false });
    expect(loaded.person(arriving.id)).toMatchObject({ task: Activity.Idle, activity: Activity.Idle, path: [], ordered: false });
    expect(loaded.building(school.id)).toMatchObject({ wanted: 0, workers: 0 });
    expect(loaded.person(lumberjack.id)?.job).toBe(wood.id);
    expect(loaded.setWorkers(school.id, 1)).toBe(false);
    loaded.staff();
    expect(loaded.building(school.id)?.workers).toBe(0);
  });
});

describe('runestone', () => {
  it('halves grief while one stands and names the fallen', () => {
    const { town } = settlement();
    town.fallen.push({
      id: 9,
      name: 'Ulf',
      past: '',
      look: 0,
      calling: Calling.Warrior,
      race: 0,
      level: 3,
      days: 4,
      kills: 2,
      cause: 'Slain by monsters',
      place: 'Midgard',
      day: 4,
      at: 1200,
      position: point(),
    });
    expect(town.memorialComfort()).toBe(1);
    expect(town.rememberedFallen()).toEqual([]);
    const stone = facility(town, Structure.Runestone);
    stone.progress = 0.4;
    expect(town.memorialComfort()).toBe(1);
    stone.progress = 1;
    expect(town.runestoneStands()).toBe(true);
    expect(town.memorialComfort()).toBe(0.5);
    expect(town.rememberedFallen().map((f) => f.name)).toEqual(['Ulf']);
    stone.faction = 1;
    expect(town.memorialComfort()).toBe(1);
  });
});

describe('unlocks by deeds', () => {
  it('asks for a guild, then a beaten raid, then a cleared floor along the arms branch', () => {
    const { town, gate } = settlement();
    residents(town, 12);
    expect(buildingUnlock(town, Structure.TrainingYard).reason).toBe('Complete Guild');
    facility(town, Structure.Guild);
    expect(buildingUnlock(town, Structure.TrainingYard).available).toBe(true);
    expect(buildingUnlock(town, Structure.Watchtower).reason).toBe('Complete Training yard');
    // The smithy comes early: it follows the workbench and its first tool, not the guild.
    expect(unlockRequirements(town, Structure.Weaponsmith).map((r) => r.text)).toEqual([
      'Reach the quest "Build a smithy"',
      'Complete Workbench',
    ]);
    facility(town, Structure.TrainingYard);
    expect(buildingUnlock(town, Structure.Watchtower)).toEqual({ available: false, reason: 'Beat off a raid' });
    town.chronicle.raidsRepelled = 1;
    expect(buildingUnlock(town, Structure.Watchtower).available).toBe(true);
    road(town);
    facility(town, Structure.Workbench);
    expect(buildingUnlock(town, Structure.Weaponsmith).reason).toBe('Reach the quest "Build a smithy"');
    addInventory(town.people()[0], 'wooden-mallet');
    expect(buildingUnlock(town, Structure.Weaponsmith).available).toBe(true);
    // Iron is the smithy's top level: it asks for a cleared floor, as the armorer did.
    for (const kind of [Structure.Sawmill, Structure.Stoneworks]) facility(town, kind);
    const smith = facility(town, Structure.Weaponsmith);
    smith.variant = levelVariant(2);
    expect(town.stationNeeds(smith.id).find((r) => !r.done)?.text).toBe('Seal a dungeon');
    town.depth = town.map().dungeons().map((_, i) => (i === gate ? 1 : 0));
    expect(town.stationNeeds(smith.id).every((r) => r.done)).toBe(true);
    // The armorer is no longer built.
    expect(structureSpec(Structure.Armorer).buildable).toBe(false);
  });
  it('offers the runestone once there is a deed or a loss to remember, and the apothecary after the altar', () => {
    const { town } = settlement();
    expect(buildingUnlock(town, Structure.Runestone).reason).toBe('Slay a dungeon guardian');
    town.chronicle.guardiansSlain = 1;
    expect(toolAvailable(town, Tool.Runestone)).toBe(true);
    town.chronicle.guardiansSlain = 0;
    expect(toolAvailable(town, Tool.Runestone)).toBe(false);
    // SAFETY: the unlock only counts the fallen; the record's fields are not read.
    town.fallen.push({} as (typeof town.fallen)[number]);
    expect(toolAvailable(town, Tool.Runestone)).toBe(true);
    residents(town, 7);
    expect(buildingUnlock(town, Structure.Apothecary).reason).toBe('Complete Altar of Odin');
    facility(town, Structure.Shrine);
    expect(buildingUnlock(town, Structure.Apothecary).reason).toBe('Needs 8 residents');
    residents(town, 8);
    expect(buildingUnlock(town, Structure.Apothecary).available).toBe(true);
    expect(buildingUnlock(town, Structure.Chapel).reason).toBe('Needs 10 residents');
    expect(structureSpec(Structure.Apothecary).cost.mana).toBe(0);
    expect(buildingUnlock(town, Structure.MageTower).reason).toBe('Complete Apothecary');
  });
  it.each([Structure.Farm, Structure.ChickenCoop, Structure.Cowshed])(
    'opens the well for a completed food producer before its usual quest', kind => {
      const { town } = settlement();
      expect(buildingUnlock(town, Structure.Well).available).toBe(false);
      facility(town, kind);
      expect(buildingUnlock(town, Structure.Well).available).toBe(true);
    },
  );
  it('brings each founding building into the menu with its quest, one at a time', () => {
    const { town } = settlement();
    // A founded camp asks for a road first: nothing of the chain is offered until it is laid.
    expect(currentGoal(town, GoalBranch.Core)).toBe(1);
    expect(settlementGoals()[1].title).toBe('Lay a road');
    expect(buildingUnlock(town, Structure.Workbench).reason).toBe('Reach the quest "Build a workbench"');
    road(town);
    expect(buildingUnlock(town, Structure.Workbench)).toEqual({ available: true, reason: '' });
    expect(buildingUnlock(town, Structure.Tent).reason).toBe('Reach the quest "Build a tent"');
    expect(buildingUnlock(town, Structure.Farm).reason).toBe('Reach the quest "Lay out a farm"');
    expect(buildingUnlock(town, Structure.Well).reason).toBe('Reach the quest "Build a well"');
    // Roads are not kept back: they are the settlement's own from the first camp.
    expect(toolAvailable(town, Tool.Road)).toBe(true);
    expect(unlockRequirements(town, Structure.Shrine)).toEqual([
      { text: 'Reach the quest "Build an altar"', done: false },
      { text: 'Complete Tent', done: false, facility: Structure.Tent },
      { text: 'Complete Farmhouse', done: false, facility: Structure.Farm },
    ]);
    // What the settlement already has is known, whatever the quest; a later one still waits its turn.
    facility(town, Structure.Tent);
    expect(buildingUnlock(town, Structure.Tent).available).toBe(true);
    expect(buildingUnlock(town, Structure.Farm).reason).toBe('Reach the quest "Lay out a farm"');
    // Each finished step opens exactly the next building of the chain.
    const chain = settlementGoals().filter((goal) => goal.branch === GoalBranch.Core),
      staged = chain.filter((goal) => goal.kind === GoalKind.Building && goal.building !== Structure.Camp),
      open = () => staged.filter((goal) => buildingUnlock(town, goal.building).available).map((goal) => goal.title);
    expect(open()).toEqual(['Build a workbench', 'Build a tent']);
    // The farm quest is one step: the farmhouse standing is half of it, the planted field the rest.
    const farm = chain.find((goal) => goal.title === 'Lay out a farm')!;
    expect(goalProgress(town, farm)).toEqual({ have: 0, need: 2, label: 'No farm yet' });
    facility(town, Structure.Farm);
    expect(goalComplete(town, farm)).toBe(false);
    expect(goalProgress(town, farm)).toEqual({ have: 1, need: 2, label: 'No field yet' });
    town.farmland.push(new Field(78, [point(1, 1), point(5, 1), point(5, 5), point(1, 5)], 0));
    expect(goalComplete(town, farm)).toBe(true);
    facility(town, Structure.Workbench);
    residents(town, 1);
    addInventory(town.people()[0], 'wooden-axe');
    expect(open()).toEqual(['Build a workbench', 'Build a smithy', 'Build a tent', 'Build a well']);
  });
  it('keeps the depots, the granary, lodging and paving back until their own step', () => {
    const { town } = settlement();
    for (const [kind, needs] of [
      [Structure.Torch, 'Complete Altar of Odin'],
      [Structure.WoodStore, 'Complete Stoneworks'],
      [Structure.StoneStore, 'Complete Timber store'],
      [Structure.Granary, 'Complete Farmhouse'],
      [Structure.Hostel, 'Complete Tent'],
      [Structure.MarketStalls, 'Complete Tavern'],
    ] as const)
      expect(buildingUnlock(town, kind).reason, structureSpec(kind).name).toBe(needs);
    facility(town, Structure.Farm);
    facility(town, Structure.Tent);
    expect(buildingUnlock(town, Structure.Granary).reason).toBe('Needs 5 residents');
    expect(buildingUnlock(town, Structure.Hostel).reason).toBe('Needs 4 residents');
    // Paving is laid in stone.
    expect(toolAvailable(town, Tool.Pave)).toBe(false);
    facility(town, Structure.Quarry);
    expect(toolAvailable(town, Tool.Pave)).toBe(true);
  });
  it('opens the portal only after a gate is sealed', () => {
    const { town, gate } = settlement();
    residents(town, 30);
    for (const kind of [Structure.MageTower, Structure.Guild, Structure.Sawmill, Structure.Stoneworks])
      facility(town, kind);
    expect(buildingUnlock(town, Structure.Portal).reason).toBe('Seal a gate');
    town.depth = town.map().dungeons().map((_, i) => (i === gate ? sealFloors : 0));
    expect(buildingUnlock(town, Structure.Portal).available).toBe(true);
  });
  it('lists every requirement in the order buildingUnlock checks them', () => {
    const { town } = settlement();
    const check = () => {
      for (let kind = 0; kind < Structure.Count; ++kind) {
        const list = unlockRequirements(town, kind),
          unlock = buildingUnlock(town, kind);
        expect(unlock.available, structureSpec(kind).name).toBe(list.every((r) => r.done));
        expect(unlock.reason).toBe(list.find((r) => !r.done)?.text ?? '');
        expect(new Set(list.map((r) => r.text)).size).toBe(list.length);
      }
    };
    check();
    residents(town, 12);
    facility(town, Structure.Guild);
    facility(town, Structure.TrainingYard);
    town.chronicle.raidsRepelled = 2;
    check();
    expect(unlockRequirements(town, Structure.Watchtower)).toEqual([
      { text: 'Complete Training yard', done: true, facility: Structure.TrainingYard },
      { text: 'Beat off a raid', done: true },
    ]);
    expect(unlockRequirements(town, Structure.Camp)).toEqual([]);
  });
});

describe('quests that follow the combat loop', () => {
  const goals = settlementGoals();
  function fulfil(town: Town, goal: SettlementGoal): void {
    switch (goal.kind) {
      case GoalKind.Building:
        facility(town, goal.building);
        break;
      case GoalKind.Population:
        residents(town, goal.count);
        break;
      case GoalKind.Road:
        road(town);
        break;
      case GoalKind.Field:
        if (goal.building !== Structure.Count) facility(town, goal.building);
        town.farmland.push(new Field(77, [point(1, 1), point(5, 1), point(5, 5), point(1, 5)], 0));
        break;
      case GoalKind.Floor:
      case GoalKind.Seal: {
        let left = goal.count || Infinity;
        town.depth = town
          .map()
          .dungeons()
          .map((site, i) => (sealable(site) && left-- > 0 ? sealFloors : (town.depth[i] ?? 0)));
        break;
      }
      case GoalKind.Craft:
        residents(town, 1);
        for (const id of goal.items.slice(0, goal.count)) addInventory(town.people()[0], id);
        break;
      case GoalKind.Equip:
        residents(town, goal.count);
        for (const p of town.people().slice(0, goal.count))
          if (addInventory(p, 'wooden-axe')) town.equipItem(p.id, p.inventory.findIndex((s) => s?.item === 'wooden-axe') + 1, 'tool2');
        break;
      case GoalKind.Station: {
        const station =
          town.buildings().find((b) => b.kind === goal.building && b.built()) ?? facility(town, goal.building);
        station.variant = levelVariant(goal.count);
        break;
      }
      case GoalKind.Deed:
        if (goal.deed === 'sworn') {
          const p = town.makePerson(Role.Resident, Calling.Warrior, town.map().camp());
          town.folk.push(p);
        } else if (goal.deed === 'floors' || goal.deed === 'seals')
          town.depth = town.map().dungeons().map(() => sealFloors);
        else if (goal.deed) town.chronicle[goal.deed] = goal.count;
        break;
    }
  }
  it('advances each branch in order and reports progress for every goal', () => {
    for (const branch of [GoalBranch.Core, GoalBranch.Trade, GoalBranch.Arms, GoalBranch.Faith, GoalBranch.Saga]) {
      // Saga awards the first seal and the last seal as separate goals.
      const { town } = settlement(48),
        // The fixture already stands on a founded camp.
        chain = goals.filter((goal) => goal.branch === branch && goal.building !== Structure.Camp),
        seen: string[] = [];
      for (let step = 0; step < chain.length + 2; ++step) {
        const index = currentGoal(town, branch);
        if (index < 0) break;
        const goal = goals[index],
          progress = goalProgress(town, goal);
        expect(progress.label, goal.title).not.toBe('');
        expect(progress.need).toBeGreaterThan(0);
        expect(goalComplete(town, goal)).toBe(false);
        seen.push(goal.title);
        fulfil(town, goal);
        expect(goalComplete(town, goal), goal.title).toBe(true);
        expect(goalProgress(town, goal).have).toBeGreaterThanOrEqual(goalProgress(town, goal).need);
      }
      expect(seen, GoalBranch[branch]).toEqual(chain.map((goal) => goal.title));
    }
  });
  it('opens every founding step with the steps before it, crafting before shelter and the altar after homes and food', () => {
    const { town } = settlement(),
      chain = goals.filter((goal) => goal.branch === GoalBranch.Core && goal.building !== Structure.Camp);
    expect(chain.map((goal) => goal.title)).toEqual([
      'Lay a road',
      'Build a workbench',
      'Craft a wooden tool',
      'Build a smithy',
      'Make a weapon or a shield',
      'Build a tent',
      'Lay out a farm',
      'Build an altar',
      'Reach 4 residents',
      'Upgrade the workbench',
      'Build a lumberyard',
      'Build a well',
      'Build a quarry',
      'Upgrade the smithy',
      'Build a storehouse',
      'Build a sawmill',
      'Build stoneworks',
    ]);
    for (const goal of chain) {
      if (goal.kind === GoalKind.Building)
        expect(buildingUnlock(town, goal.building), goal.title).toEqual({ available: true, reason: '' });
      if (goal.kind === GoalKind.Road) expect(toolAvailable(town, Tool.Road)).toBe(true);
      if (goal.kind === GoalKind.Field) expect(toolAvailable(town, Tool.Farm)).toBe(true);
      // Growth needs a standing altar and a free bed by the time the chain asks for it.
      if (goal.kind === GoalKind.Population) {
        expect(goalComplete(town, goals.find((g) => g.building === Structure.Shrine)!)).toBe(true);
        expect(town.housing()).toBeGreaterThanOrEqual(goal.count);
      }
      // Tools are made at the workbench and arms at the smithy, each already standing and at the level asked.
      if (goal.kind === GoalKind.Craft)
        for (const id of goal.items) {
          const item = itemSpec(id)!;
          expect(item.workshop, id).toBe(item.category === 'tool' ? Structure.Workbench : Structure.Weaponsmith);
          expect(completedFacility(town, item.workshop!), id).toBe(true);
          expect(item.stationLevel, id).toBe(1);
        }
      // A station upgrade asks only for what the chain has already given, cost aside.
      if (goal.kind === GoalKind.Station) {
        const station = town.buildings().find((b) => b.kind === goal.building)!;
        expect(stationLevel(station) + 1, goal.title).toBe(goal.count);
        residents(town, 4);
        expect(town.stationNeeds(station.id).filter((r) => !r.done), goal.title).toEqual([]);
      }
      fulfil(town, goal);
    }
  });
  it('introduces the founding buildings in order and offers water when the farm needs it', () => {
    const { town } = settlement(),
      chain = goals.filter((goal) => goal.branch === GoalBranch.Core && goal.building !== Structure.Camp),
      placing: Tool[] = [];
    for (let tool = 0; tool < Tool.Count; ++tool)
      if (toolStructure(tool) !== undefined || tool === Tool.Road || tool === Tool.Pave)
        placing.push(tool);
    const known = new Set(placing.filter((tool) => toolAvailable(town, tool)));
    expect([...known].map((tool) => Tool[tool])).toEqual(['Road', 'Camp', 'ChickenCoop', 'Cowshed']);
    const steps: string[] = [];
    for (const goal of chain) {
      fulfil(town, goal);
      const opened = placing.filter((tool) => !known.has(tool) && toolAvailable(town, tool));
      for (const tool of opened) known.add(tool);
      steps.push(`${goal.title}: ${opened.map((tool) => Tool[tool]).join(' + ')}`);
    }
    // The farm unlocks its water supply alongside the altar.
    expect(steps).toEqual([
      'Lay a road: Workbench',
      'Build a workbench: ',
      'Craft a wooden tool: Weaponsmith',
      'Build a smithy: ',
      'Make a weapon or a shield: Tent',
      'Build a tent: Farm',
      'Lay out a farm: Well + Shrine',
      'Build an altar: Torch',
      'Reach 4 residents: Inn',
      'Upgrade the workbench: Lumberyard',
      'Build a lumberyard: ',
      'Build a well: Quarry',
      'Build a quarry: Pave',
      'Upgrade the smithy: Storehouse',
      'Build a storehouse: Sawmill',
      'Build a sawmill: Stoneworks',
      'Build stoneworks: WoodStore',
    ]);
  });
  it('passes the tool quest with any one wooden tool, and the arms quest with one weapon or a shield', () => {
    const tool = goals.find((goal) => goal.title === 'Craft a wooden tool')!,
      arm = goals.find((goal) => goal.title === 'Make a weapon or a shield')!;
    for (const [goal, items] of [
      [tool, ['wooden-axe', 'wooden-pick', 'wooden-mallet', 'wooden-hoe', 'wooden-shovel']],
      [arm, ['wooden-sword', 'wooden-club', 'wooden-spear', 'short-bow', 'wooden-staff', 'shield']],
    ] as const)
      for (const id of items) {
        const { town } = settlement();
        residents(town, 1);
        expect(goalComplete(town, goal), id).toBe(false);
        addInventory(town.people()[0], id);
        expect(goalComplete(town, goal), id).toBe(true);
        expect(goalProgress(town, goal)).toEqual({ have: 1, need: 1, label: 'Crafted' });
      }
    // The founding chain asks for no other piece of gear.
    expect(goals.filter((goal) => goal.branch === GoalBranch.Core && goal.kind !== GoalKind.Building).map((goal) => goal.title)).toEqual([
      'Lay a road',
      'Craft a wooden tool',
      'Make a weapon or a shield',
      'Lay out a farm',
      'Reach 4 residents',
      'Upgrade the workbench',
      'Upgrade the smithy',
    ]);
  });
  it('keeps a passed crafting lesson when its maker is lost, and reports it done', () => {
    const { town } = settlement(),
      tool = goals.find((goal) => goal.title === 'Craft a wooden tool')!;
    fulfil(town, tool);
    expect(goalComplete(town, tool)).toBe(true);
    for (const p of town.people()) p.inventory.fill(null);
    expect(goalComplete(town, tool)).toBe(false);
    expect(goalProgress(town, tool).label).toBe('Wood 0 / 3 for Wooden axe');
    facility(town, Structure.Tent);
    expect(goalComplete(town, tool)).toBe(true);
    expect(goalProgress(town, tool)).toEqual({ have: 1, need: 1, label: 'Crafted' });
  });
  it('teaches the arms and saga loop with deeds', () => {
    const titles = (branch: GoalBranch) => goals.filter((g) => g.branch === branch).map((g) => g.title);
    expect(titles(GoalBranch.Arms)).toEqual([
      'Build a guild',
      'Build a training yard',
      'Swear a fighter',
      'Beat off a raid',
      'Build a watchtower',
      'Reach 10 residents',
      'Build a foundry',
      'Raise the smithy to iron',
      'Forge an iron weapon',
      'Reach 12 residents',
      'Arm a fighter in iron',
    ]);
    expect(titles(GoalBranch.Saga)).toEqual([
      'Lead a party of three',
      'Slay a dungeon guardian',
      'Revive a downed ally',
      'Raise a runestone',
      'Seal a gate',
      'Reach 30 residents',
      'Build a portal',
      'Seal every gate',
    ]);
    // Every building goal is reachable: its own unlock never needs a goal further down the same branch.
    for (const branch of [GoalBranch.Arms, GoalBranch.Faith, GoalBranch.Saga]) {
      const chain = goals.filter((g) => g.branch === branch);
      chain.forEach((goal, i) => {
        if (goal.kind !== GoalKind.Building) return;
        const later = chain.slice(i + 1).filter((g) => g.kind === GoalKind.Building).map((g) => structureSpec(g.building).name);
        const { town } = settlement();
        for (const r of unlockRequirements(town, goal.building))
          expect(later.map((name) => 'Complete ' + name), goal.title).not.toContain(r.text);
      });
    }
  });
  it('reads deeds from the chronicle and the gates', () => {
    const { town, gate } = settlement();
    const swear = goals.find((g) => g.deed === 'sworn')!,
      party = goals.find((g) => g.deed === 'largestParty')!;
    expect(goalProgress(town, swear)).toEqual({ have: 0, need: 1, label: '0 / 1 residents sworn to a calling' });
    town.folk.push(town.makePerson(Role.Resident, Calling.Ranger, town.map().camp()));
    town.folk.push(town.makePerson(Role.Resident, Calling.Settler, town.map().camp()));
    expect(deedCount(town, 'sworn')).toBe(1);
    town.chronicle.largestParty = 2;
    expect(goalProgress(town, party)).toEqual({ have: 2, need: 3, label: 'Largest party 2 / 3' });
    expect(goalComplete(town, party)).toBe(false);
    town.depth = town.map().dungeons().map((_, i) => (i === gate ? 2 : 0));
    expect(deedCount(town, 'floors')).toBe(2);
    expect(deedCount(town, 'seals')).toBe(0);
    const every = goals.at(-1)!;
    expect(goalProgress(town, every).label).toMatch(/^0 \/ \d+ gates sealed$/);
    const portal = goals.find((g) => g.building === Structure.Portal)!;
    expect(goalProgress(town, portal)).toEqual({ have: 0, need: 1, label: 'Not built yet' });
    facility(town, Structure.Portal).progress = 0.2;
    expect(goalProgress(town, portal).label).toBe('Under construction');
  });
});
