import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Person, Monster, Calling, Role, Race, Activity, type Hit } from '../../packages/engine/src/person';
import { point, project } from '../../packages/engine/src/geometry';
import { Traffic } from '../../packages/engine/src/traffic';
import { Town } from '../../packages/engine/src/town';
import { SceneNode, ShapeNode, AnimationNode } from '../../packages/native-renderer/src/paint';
import { ceremonySeconds, type DevotionEvent } from '../../packages/engine/src/town-devotion';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { riseAnimation } from '../../packages/native-renderer/src/building-assets';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { PersonParts, personSprite } from '../../packages/native-renderer/src/world-sprites';
import { moveAgents } from '../../packages/native-renderer/src/world-people';
import { pickSource } from '../../packages/native-renderer/src/world-pick-registry';
import { barShapesOf, updateUnitBars } from '../../packages/native-renderer/src/unit-bars';
import { WebCanvasAdapter } from '../../packages/native-renderer/src/webcanvas-adapter';
import { heldTools, showEquipment } from '../../packages/native-renderer/src/person-equipment';
import { animateWork } from '../../packages/native-renderer/src/action-motion';
import { breedOf, monsterBite } from '../../packages/engine/src/town-monsters';

class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  pixels: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    return {
      putImageData: (p: Pixels) => {
        this.pixels = p.data.slice();
      },
      clearRect: () => this.pixels.fill(0),
    };
  }
}
let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({
    renderer: 'sw',
    locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
  });
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});
function surface(width: number, height: number) {
  const target = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(target as any, { width, height, enableDevicePixelRatio: false });
  const adapter = new WebCanvasAdapter(tvg),
    root = new SceneNode();
  root.add(new ShapeNode().appendRect(0, 0, width, height).fill(84, 101, 86));
  return {
    root,
    adapter,
    target,
    draw(name: string) {
      canvas.remove();
      canvas.add(adapter.sync(root));
      adapter.collect([root]);
      canvas.update().render();
      if (process.env.CAPTURE_FEEDBACK) {
        mkdirSync('artifacts/renderer-feedback', { recursive: true });
        writeFileSync(
          `artifacts/renderer-feedback/${process.env.CAPTURE_FEEDBACK}-${name}-${width}x${height}.rgba`,
          target.pixels,
        );
      }
    },
    dispose() {
      canvas.remove();
      adapter.dispose();
      canvas.destroy();
    },
  };
}
function actor() {
  return new Person(0, 'Resident', Role.Resident, Calling.Warrior, Race.Human, 499096, point(6, 6));
}
function scene(person: Person, hits: Hit[] = []) {
  const s = new WorldRendererState(tvg);
  s.rows = Array.from({ length: 32 }, () => new SceneNode());
  s.currentVisibility.sample = () => 255;
  let time = 0.2;
  const foe = { position: point(5.6, 6), health: 1 };
  const town = {
    people: () => [person],
    person: () => null,
    buildings: () => [],
    building: () => null,
    monsters: () => [],
    wildlife: () => [],
    hits: () => hits,
    treeEvents: () => [],
    devotionEvents: () => [],
    creatureTarget: () => foe,
    clock: () => time,
    map: () => ({ width: () => 32, giant: () => null, volcano: () => null }),
    roads: () => ({ road: () => null }),
  } as unknown as Town;
  return {
    s,
    town,
    drawGear() {
      moveAgents(s, town, new Traffic(5), time, []);
      const parts = s.figures.get(person.id)!.parts;
      return [...heldTools, 'shield' as const].filter((name) => parts[name]?.alpha);
    },
    setTime: (value: number) => {
      time = value;
    },
  };
}
it('faces the victim through a bite even when a crowd nudges the monster the other way', () => {
  const town = new Town(5, 64), s = new WorldRendererState(tvg), prey = actor();
  town.folk = [];
  town.animals = [];
  const beast = new Monster(9, 0, point(6.5, 6));
  town.beasts = [beast];
  s.rows = Array.from({ length: 64 }, () => new SceneNode());
  s.currentVisibility.sample = () => 255;
  try {
    monsterBite(town, beast, prey, breedOf(town.map().dungeons()[0].kind));
    for (let i = 0; i < 4; ++i) {
      town.time += 0.04;
      beast.position = point(6.5 + (i % 2) * 0.02, 6);
      moveAgents(s, town, new Traffic(5), town.time, []);
      expect(s.beasts.get(beast.id)!.paint.matrix[0]).toBeLessThan(0);
    }
    // A second contact almost directly below the monster in the isometric view keeps its facing.
    prey.position = point(beast.position.x + 0.41, beast.position.y + 0.4);
    monsterBite(town, beast, prey, breedOf(town.map().dungeons()[0].kind));
    moveAgents(s, town, new Traffic(5), town.time, []);
    expect(s.beasts.get(beast.id)!.paint.matrix[0]).toBeLessThan(0);
  } finally {
    s.adapter.dispose();
  }
});

it('does not switch an in-range strike to walking or reverse facing for small combat spacing corrections', () => {
  const view = surface(640, 180),
    p = actor(),
    { s, town, setTime } = scene(p);
  p.activity = Activity.Fighting;
  p.foe = 5;
  p.ready = 1;
  try {
    for (let i = 0; i < 4; ++i) {
      p.position = point(6 + (i % 2 ? 0.001 : 0), 6);
      setTime(0.2 + i * 0.02);
      moveAgents(s, town, new Traffic(5), 0.2 + i * 0.02, []);
      const figure = s.figures.get(p.id)!;
      expect(figure.facing).toBe(-1);
      expect(figure.striding).toBe(false);
      expect(figure.parts.body!.matrix[4]).not.toBe(1);
    }
  } finally {
    s.adapter.dispose();
    view.dispose();
  }
});
it('renders compact hammer and readable axe work poses through the actual WebCanvas renderer', () => {
  const view = surface(720, 360);
  try {
    for (const [row, tool] of (['hammer', 'axe'] as const).entries())
      for (const [col, phase] of [0, 0.45, 0.6, 0.78].entries()) {
        const p = actor(),
          parts = new PersonParts(),
          sprite = personSprite(p, parts);
        showEquipment(parts, tool);
        animateWork(parts, tool, phase, 0.9, 0.6);
        sprite.transform([5, 0, col * 180 + 70, 0, 5, row * 180 + 155, 0, 0, 1]);
        view.root.add(sprite);
      }
    view.draw('tools');
  } finally {
    view.dispose();
  }
});
it('renders the altar through its actual build asset in every quarter turn', () => {
  const view = surface(800, 280);
  try {
    for (let i = 0; i < 4; ++i) {
      const layout = riseAnimation(Structure.Shrine, 5, [], (i * Math.PI) / 2),
        picture = new AnimationNode(layout.json).frame(layout.frames - 1),
        group = new SceneNode().transform([2.4, 0, i * 200 + 100, 0, 2.4, 205, 0, 0, 1]);
      picture.translate(-layout.originX, -layout.originY);
      group.add(picture);
      view.root.add(group);
      expect(layout.frames).toBeGreaterThan(0);
    }
    view.draw('altar');
  } finally {
    view.dispose();
  }
});

it('shows only actually equipped tools and keeps a real chase walking', () => {
  const view = surface(100, 100),
    p = actor(),
    { s, town } = scene(p);
  p.activity = Activity.Fighting;
  p.foe = 5;
  p.ready = 1;
  try {
    moveAgents(s, town, new Traffic(5), 0.2, []);
    const parts = s.figures.get(p.id)!.parts;
    for (const tool of ['sword', 'axe', 'pickaxe', 'hammer'] as const) expect(parts[tool]!.alpha).toBe(0);
    p.inventory[0] = { item: 'axe', quantity: 1 };
    p.equipment.tool1 = 1;
    moveAgents(s, town, new Traffic(5), 0.2, []);
    expect(parts.axe!.alpha).toBe(255);
    expect(parts.sword!.alpha).toBe(0);
    p.path = [point(7, 6)];
    moveAgents(s, town, new Traffic(5), 0.2, []);
    expect(s.figures.get(p.id)!.striding).toBe(true);
    expect(s.figures.get(p.id)!.facing).toBe(1);
  } finally {
    s.adapter.dispose();
    view.dispose();
  }
});
it('puts tools away in transit and swaps work gear for the equipped weapon and shield in a fight', () => {
  const p = actor(),
    { s, drawGear } = scene(p);
  p.inventory[0] = { item: 'wooden-sword', quantity: 1 };
  p.inventory[1] = { item: 'shield', quantity: 1 };
  p.inventory[2] = { item: 'wooden-mallet', quantity: 1 };
  p.equipment.weapon = 1;
  p.equipment.offhand = 2;
  p.equipment.tool1 = 3;
  try {
    for (const activity of [Activity.Idle, Activity.Guarding, Activity.Holding, Activity.Relaxing]) {
      p.activity = activity;
      expect(drawGear()).toEqual([]);
    }
    p.activity = Activity.Roadwork;
    p.path = [point(7, 6)];
    expect(drawGear()).toEqual([]);
    p.path = [];
    expect(drawGear()).toEqual(['hammer']);
    const parts = s.figures.get(p.id)!.parts;
    expect(parts.arms[0].free).toBe(true);
    p.activity = Activity.Fighting;
    expect(drawGear()).toEqual(['sword', 'shield']);
    expect(parts.arms[0].free).toBe(false);
    p.activity = Activity.Moving;
    p.path = [point(6, 7)];
    expect(drawGear()).toEqual([]);
    expect(parts.arms[0].free).toBe(true);
    expect(p.equipment.weapon).toBe(1);
  } finally {
    s.adapter.dispose();
  }
});
it('keeps a weapon drawn beyond the gate between fights and puts it away for mining or rescue', () => {
  const p = actor(),
    { s, town, drawGear } = scene(p);
  p.inventory[0] = { item: 'short-bow', quantity: 1 };
  p.inventory[1] = { item: 'shield', quantity: 1 };
  p.inventory[2] = { item: 'stone-pick', quantity: 1 };
  p.equipment.weapon = 1;
  p.equipment.offhand = 2;
  town.realmArea = { x: 10, y: 4, size: 6 };
  try {
    p.activity = Activity.Expedition;
    p.path = [point(7, 6)];
    expect(drawGear()).toEqual([]);
    p.position = point(12, 6);
    p.path = [];
    p.activity = Activity.Holding;
    expect(drawGear()).toEqual(['bow']);
    p.activity = Activity.Moving;
    p.path = [point(13, 6)];
    expect(drawGear()).toEqual(['bow']);
    p.path = [];
    p.activity = Activity.Mining;
    p.tree = 6 * town.map().width() + 13;
    expect(drawGear()).toEqual(['pickaxe']);
    p.activity = Activity.Collecting;
    expect(drawGear()).toEqual([]);
    p.activity = Activity.Tending;
    expect(drawGear()).toEqual([]);
    p.activity = Activity.Idle;
    expect(drawGear()).toEqual(['bow']);
    p.position = point(6, 6);
    expect(drawGear()).toEqual([]);
    p.equipment.weapon = -1;
    p.activity = Activity.Fighting;
    expect(drawGear()).toEqual(['pickaxe']);
    expect(s.figures.get(p.id)!.parts.toolHeads.pickaxe!.stone!.alpha).toBe(255);
  } finally {
    s.adapter.dispose();
  }
});
it('draws the bow for a stationary skill or a drill in town and stows it when the action ends', () => {
  const p = actor(),
    { s, setTime, drawGear } = scene(p);
  p.inventory[0] = { item: 'short-bow', quantity: 1 };
  p.equipment.weapon = 1;
  try {
    p.activity = Activity.Holding;
    p.cast = 'aimed';
    p.castAt = 0.1;
    p.castUntil = 0.6;
    expect(drawGear()).toEqual(['bow']);
    setTime(0.6);
    expect(drawGear()).toEqual([]);
    p.activity = Activity.Training;
    expect(drawGear()).toEqual(['bow']);
    p.activity = Activity.Idle;
    expect(drawGear()).toEqual([]);
  } finally {
    s.adapter.dispose();
  }
});
it('uses the resident attacker on a person hit, without animating the victim as the striker', () => {
  const view = surface(100, 100),
    p = actor();
  const hit: Hit = {
    serial: 0n,
    from: point(6, 6),
    to: point(5.6, 6),
    damage: 1,
    onPerson: true,
    ranged: false,
    at: 0.15,
    person: 99,
    attacker: p.id,
  };
  const { s, setTime, drawGear } = scene(p, [hit]);
  p.inventory[0] = { item: 'wooden-sword', quantity: 1 };
  p.equipment.weapon = 1;
  p.ready = 1.15;
  try {
    expect(drawGear()).toEqual(['sword']);
    expect(s.figures.get(p.id)!.parts.body!.matrix[4]).toBeLessThan(1);
    setTime(0.41);
    expect(drawGear()).toEqual([]);
  } finally {
    s.adapter.dispose();
    view.dispose();
  }
});
it('bows outdoors with joined hands and grounded feet for the real altar ceremony', () => {
  const view = surface(800, 180),
    states: WorldRendererState[] = [];
  try {
    for (const [i, time] of [0, 0.5, 2.5, 4.6, 5].entries()) {
      const p = actor(),
        fixture = scene(p),
        { s, town } = fixture;
      states.push(s);
      const altar = new Building(12, Structure.Shrine, point(5.6, 6), 0, 5);
      town.building = () => altar;
      p.activity = Activity.Praying;
      p.target = altar.id;
      p.until = ceremonySeconds;
      fixture.setTime(time);
      moveAgents(s, town, new Traffic(5), time, []);
      const figure = s.figures.get(p.id)!;
      expect(figure.facing).toBe(-1);
      expect(figure.parts.body!.matrix[5]).toBe(0);
      for (const foot of figure.parts.feet) expect(foot!.matrix[5]).toBe(0);
      expect(figure.parts.body!.matrix[4]).toBeGreaterThan(0.85);
      if (time === 2.5) {
        // A bow from the waist with the head lowered, not a squashed figure.
        expect(figure.parts.body!.matrix[4]).toBeLessThan(0.95);
        expect(figure.parts.body!.matrix[1]).toBeLessThan(-0.04);
        expect(figure.parts.nod).toBeGreaterThan(0.2);
      }
      for (const tool of ['sword', 'axe', 'hammer'] as const) expect(figure.parts[tool]!.alpha).toBe(0);
      figure.paint.transform([4, 0, i * 160 + 72, 0, 4, 150, 0, 0, 1]);
      view.root.add(figure.paint);
    }
    view.draw('prayer');
  } finally {
    for (const s of states) s.adapter.dispose();
    view.dispose();
  }
});
it('opens the earth beneath the actual resident, even on a paused clock, and cleans up the world layers', () => {
  const view = surface(240, 220), p = actor(), { s, town, setTime } = scene(p);
  const events: DevotionEvent[] = [];
  town.devotionEvents = () => events;
  const group = new SceneNode().transform([3, 0, 120, 0, 3, -390, 0, 0, 1]);
  group.add(s.combatGround);
  for (const row of s.rows) group.add(row);
  group.add(s.combat);
  view.root.add(group);
  const render = (age: number) => {
    s.arrivalSeconds = age;
    moveAgents(s, town, new Traffic(5), 1, []);
    view.draw(`arrival-${age.toFixed(2)}`);
  };
  try {
    setTime(1);
    render(0);
    const count = view.adapter.retainedPaintCount, figure = s.figures.get(p.id)!;
    const normalHeight = figure.parts.body!.matrix[5];
    expect(s.combatGround.children).toHaveLength(0);
    events.push({ serial: 0n, altar: 12, person: p.id, at: 1, position: { ...p.position } });
    render(1);
    expect(s.combatGround.children).toHaveLength(1);
    expect(s.combat.children).toHaveLength(0);
    expect(figure.paint.alpha).toBe(0);
    const soil = s.rows.flatMap((row) => row.children).filter((node) => node !== figure.paint);
    expect(soil).toHaveLength(1);
    render(1.56);
    expect(figure.paint.alpha).toBe(255);
    expect(figure.parts.body!.matrix[5]).toBeGreaterThan(normalHeight + 3);
    const opened = view.target.pixels.slice();
    figure.paint.opacity(0);
    view.draw('arrival-ground-alone');
    const groundY = group.matrix[4] * figure.paint.matrix[5] + group.matrix[5];
    const bodyRows = new Set<number>();
    for (let i = 0; i < opened.length; i += 4) {
      if (opened[i] !== view.target.pixels[i]) bodyRows.add(Math.floor(i / (view.target.width * 4)));
    }
    // The emerging head is visible above the earth. Its lowered legs do not draw below the seam.
    expect(Math.min(...bodyRows)).toBeLessThan(groundY - 12);
    expect(Math.max(...bodyRows)).toBeLessThanOrEqual(groundY + 4);
    render(2.07);
    expect(figure.paint.children).toContain(figure.parts.body);
    expect(figure.parts.body!.matrix[5]).toBeCloseTo(normalHeight);
    expect(view.target.pixels).not.toEqual(opened);
    render(2.6);
    expect(s.combatGround.children).toHaveLength(0);
    expect(s.rows.flatMap((row) => row.children)).toEqual([figure.paint]);
    expect(view.adapter.retainedPaintCount).toBe(count);
    render(2.7);
    expect(s.combatGround.children).toHaveLength(0);
    s.currentVisibility.sample = () => 0;
    events.push({ serial: 1n, altar: 12, person: p.id, at: 1, position: { ...p.position } });
    render(3.1);
    expect(s.combatGround.children).toHaveLength(0);
    expect(figure.paint.alpha).toBe(0);
    s.currentVisibility.sample = () => 255;
    render(3.2);
    expect(s.combatGround.children).toHaveLength(0);
    expect(figure.paint.alpha).toBe(255);

    s.reducedMotion = true;
    events.push({ serial: 2n, altar: 12, person: p.id, at: 1, position: { ...p.position } });
    render(4);
    expect(figure.paint.alpha).toBe(255);
    expect(figure.paint.children).toContain(figure.parts.body);
    expect(figure.parts.body!.matrix[5]).toBeCloseTo(normalHeight);
    expect(s.rows.flatMap((row) => row.children)).toEqual([figure.paint]);
    const sign = s.combatGround.children[0], matrix = sign.matrix, alpha = sign.alpha;
    render(4.65);
    expect(sign.matrix).toEqual(matrix);
    expect(sign.alpha).toBe(alpha);
    render(5.6);
    expect(s.combatGround.children).toHaveLength(0);

    s.reducedMotion = false;
    events.push({ serial: 3n, altar: 12, person: p.id, at: 1, position: { ...p.position } });
    render(6);
    p.ordered = true;
    p.position = point(7, 6);
    render(6.3);
    expect(figure.paint.alpha).toBe(255);
    expect(figure.paint.children).toContain(figure.parts.body);
  } finally {
    s.adapter.dispose();
    view.dispose();
  }
});
it.each([0.638, 3.19])('keeps a worker at the opening while the simulation walks %s tiles', (walk) => {
  const p = actor(), { s, town } = scene(p);
  const origin = { ...p.position };
  const event = { serial: 0n, altar: 12, person: p.id, at: town.clock(), position: origin };
  town.devotionEvents = () => [event];
  const frame = (age: number) => {
    s.arrivalSeconds = age;
    moveAgents(s, town, new Traffic(5), town.clock(), []);
    return s.figures.get(p.id)!;
  };
  try {
    frame(0);
    p.position = point(origin.x + walk, origin.y);
    p.path = [point(origin.x + 6, origin.y)];
    const figure = frame(0.58), foot = project(origin.x, origin.y);
    expect(figure.paint.children).not.toContain(figure.parts.body);
    expect(figure.paint.matrix[2]).toBe(foot.x);
    expect(figure.paint.matrix[5]).toBe(foot.y);
    expect(figure.striding).toBe(false);
    expect(pickSource(figure.paint)?.foot).toEqual(origin);
    updateUnitBars(s, town, [p.id]);
    expect(barShapesOf(s)!.friend.commands).toHaveLength(0);
    frame(1);
    expect(figure.paint.children).not.toContain(figure.parts.body);
    frame(1.25);
    expect(figure.paint.children).toContain(figure.parts.body);
    const mid = pickSource(figure.paint)!.foot;
    expect(mid.x).toBeGreaterThan(origin.x);
    expect(mid.x).toBeLessThan(p.position.x);
    updateUnitBars(s, town, [p.id]);
    expect(barShapesOf(s)!.friend.commands[0][1]).toBeCloseTo(project(mid.x, mid.y).x - 7);
    frame(1.5);
    expect(pickSource(figure.paint)?.foot).toEqual(p.position);
    expect(figure.striding).toBe(true);
  } finally {
    s.adapter.dispose();
  }
});
it('renders real wearable accents only while equipped and restores the untouched clothing preset on removal', () => {
  const cases = [
    ['head', 'cap'],
    ['head', 'helmet'],
    ['body', 'leather-armor'],
    ['body', 'mail-armor'],
    ['body', 'robe'],
    ['accessory', 'cloak'],
    ['feet', 'boots'],
    ['hands', 'gloves'],
    ['offhand', 'shield'],
  ] as const;
  const view = surface(120, 160),
    montage = surface(1080, 160);
  try {
    for (const [i, [slot, item]] of cases.entries()) {
      const p = actor();
      p.level = 5;
      p.inventory[0] = { item, quantity: 1 };
      const holder = new SceneNode();
      view.root.add(holder);
      const render = (shieldReady = false) => {
        holder.remove();
        const parts = new PersonParts(),
          sprite = personSprite(p, parts);
        showEquipment(parts, null, 'iron', shieldReady);
        sprite.transform([5, 0, 60, 0, 5, 135, 0, 0, 1]);
        holder.add(sprite);
        view.draw('wearable-check');
        return view.target.pixels.slice();
      };
      const without = render();
      p.equipment[slot] = 1;
      if (slot === 'offhand') expect(render()).toEqual(without);
      const withItem = render(true);
      expect(withItem).not.toEqual(without);
      const parts = new PersonParts(),
        sprite = personSprite(p, parts);
      showEquipment(parts, null, 'iron', true);
      sprite.transform([5, 0, i * 120 + 60, 0, 5, 135, 0, 0, 1]);
      montage.root.add(sprite);
      p.equipment[slot] = -1;
      expect(render()).toEqual(without);
      view.root.remove(holder);
    }
    montage.draw('wearables');
  } finally {
    view.dispose();
    montage.dispose();
  }
});
it('renders barehanded and equipped combat poses without treating spacing corrections as walking', () => {
  const view = surface(960, 320),
    states: WorldRendererState[] = [];
  try {
    for (const [row, equipped] of [false, true].entries()) {
      for (const [col, phase] of [0, 0.2, 0.4, 0.55, 0.7, 0.9].entries()) {
        const p = actor(),
          { s, town, setTime } = scene(p);
        states.push(s);
        p.activity = Activity.Fighting;
        p.foe = 5;
        p.ready = 1.62;
        if (equipped) {
          p.inventory[0] = { item: 'axe', quantity: 1 };
          p.equipment.tool1 = 1;
        }
        moveAgents(s, town, new Traffic(5), 0, []);
        p.position.x += 0.001;
        setTime(phase);
        moveAgents(s, town, new Traffic(5), phase, []);
        const figure = s.figures.get(p.id)!;
        expect(figure.striding).toBe(false);
        expect(figure.facing).toBe(-1);
        figure.paint.transform([-4.5, 0, col * 160 + 92, 0, 4.5, row * 160 + 135, 0, 0, 1]);
        view.root.add(figure.paint);
      }
    }
    view.draw('combat');
  } finally {
    for (const s of states) s.adapter.dispose();
    view.dispose();
  }
});
