import { Product, Resources, Structure, resourceKeys } from './building-catalog';
import { Activity, type Person } from './person';
import { naturalAttributes, scalingBonus, weaponGrades, type AttackAttribute, type Attributes, type Scaling, type WeaponShape } from './weapon-scaling';

export const inventoryColumns = 4,
  inventoryRows = 4,
  backpackSize = 15;
export const equipmentSlots = [
  'weapon',
  'tool1',
  'tool2',
  'head',
  'body',
  'feet',
  'hands',
  'offhand',
  'accessory',
] as const;
export type EquipmentSlot = (typeof equipmentSlots)[number];
export type WorkKind =
  | 'woodcutting'
  | 'mining'
  | 'construction'
  | 'farming'
  | 'watering'
  | 'sawing'
  | 'crafting'
  /** Laying and mending roads, breaking in a new field. */
  | 'digging'
  /** Harvesting a field of ripe crops. */
  | 'reaping';
/** Shapes drawn in the hand. */
export type HeldVisual =
  | 'axe'
  | 'pickaxe'
  | 'hammer'
  | 'sword'
  | 'bow'
  | 'staff'
  | 'mace'
  | 'hoe'
  | 'wateringCan'
  | 'saw'
  | 'shovel'
  | 'sickle'
  | 'knife'
  | 'spear';
/** Every drawn shape: what is held, and the pack basket worn on the back. */
export type EquipmentVisual = HeldVisual | 'basket';
export type ItemMaterial = 'wood' | 'stone' | 'iron' | 'embersteel' | 'frostwood';
export interface ItemSpec {
  id: string;
  name: string;
  category: 'resource' | 'tool' | 'weapon' | 'armor';
  description: string;
  maximumStack: number;
  minimumLevel: number;
  slots: readonly EquipmentSlot[];
  visual: EquipmentVisual | null;
  product: Product;
  /** Kilograms per unit carried. */
  weight: number;
  attackBonus: number;
  scaling?: Scaling;
  /** One attribute point while this piece of armor is worn. */
  attribute?: AttackAttribute;
  defense: number;
  reach: number;
  work: readonly WorkKind[];
  /** Work done per second with this tool in hand; bare hands manage `bareHandsRate`. */
  rate: number;
  /** What the head, blade or body is made of, for drawing; null where it means nothing (resources, cloth, leather). */
  material: ItemMaterial | null;
  /** Where it is crafted; null for what is no longer made (old saves still hold it). */
  workshop: Structure | null;
  cost: Resources;
  seconds: number;
  /** Extra share of food and bones from a hunt the wearer makes the kill in. */
  huntBonus: number;
  /** Kilograms more carried before slowing and before the pack is full. */
  carry: number;
  /** Pace while worn and the share of the snow penalty avoided. */
  walkBonus: number;
  snowGrip: number;
  lavaProof: boolean;
  /** Make within its kind: 1 wood, 2 stone, 3 iron, 4 regional masterwork; 0 outside the tiers. */
  tier: number;
  /** The level its workshop must have reached to make it. */
  stationLevel: number;
  /** Share of blows a shield turns aside; 0 for everything else. */
  block: number;
  /** Hands it takes; a shield needs the other one free. */
  hands: 1 | 2;
}
export interface ItemStack {
  item: string;
  quantity: number;
}
export type Equipment = Record<EquipmentSlot, number>;
export const emptyEquipment = (): Equipment => ({
  weapon: -1,
  tool1: -1,
  tool2: -1,
  head: -1,
  body: -1,
  feet: -1,
  hands: -1,
  offhand: -1,
  accessory: -1,
});
const tierOf: Record<ItemMaterial, number> = { wood: 1, stone: 2, iron: 3, embersteel: 4, frostwood: 4 };
// Long hafts, bows and staves take both hands, as the renderer poses them.
const twoHandedVisuals: readonly (EquipmentVisual | null)[] = ['axe', 'pickaxe', 'hoe', 'shovel', 'spear', 'bow', 'staff'];
export const bareReach = 0.9;
const entry = (id: string, name: string, data: Partial<ItemSpec>): ItemSpec => {
  const item: ItemSpec = {
    id,
    name,
    category: 'resource',
    description: name,
    maximumStack: 20,
    minimumLevel: 1,
    slots: [],
    visual: null,
    product: Product.None,
    weight: 1,
    attackBonus: 0,
    defense: 0,
    reach: bareReach,
    work: [],
    rate: 0,
    material: null,
    workshop: null,
    cost: new Resources(),
    seconds: 5,
    huntBonus: 0,
    carry: 0,
    walkBonus: 0,
    snowGrip: 0,
    lavaProof: false,
    tier: 0,
    stationLevel: 1,
    block: 0,
    hands: 1,
    ...data,
  };
  return {
    ...item,
    tier: data.tier ?? (item.category !== 'resource' && item.material ? tierOf[item.material] : 0),
    hands: data.hands ?? (twoHandedVisuals.includes(item.visual) ? 2 : 1),
  };
};
/** Authored workloads use this many work units per second without tools. Each efficiency point adds a quarter. */
export const bareHandsRate = 0.4;
const workPointsPerBaseRate = 4;
export const rateAtEfficiency = (points: number): number => bareHandsRate * (1 + points / workPointsPerBaseRate);
export const efficiencyAtRate = (rate: number): number => (rate / bareHandsRate - 1) * workPointsPerBaseRate;
export const woodenRate = rateAtEfficiency(1), stoneRate = rateAtEfficiency(2);
/** An upgrade costs this share of making the better item from scratch, and takes this share of its time. */
export const upgradeShare = 0.6;
const tool = (
  id: string,
  name: string,
  visual: EquipmentVisual,
  work: WorkKind[],
  attackBonus: number,
  wood: number,
  stone: number,
): ItemSpec =>
  entry(id, name, {
    category: 'tool',
    maximumStack: 1,
    slots: ['tool1', 'tool2'],
    visual,
    work,
    rate: rateAtEfficiency(3),
    material: 'iron',
    attackBonus,
    workshop: Structure.Workbench,
    stationLevel: 3,
    cost: Resources.from({ wood, stone, ironIngot: 1 }),
    seconds: 12,
    description: 'An iron-headed tool, made at a workbench fitted for iron.',
  });
// Wooden tools: whittled at a first workbench from wood and a little stone, no gold.
const woodenTool = (
  id: string,
  name: string,
  visual: EquipmentVisual,
  work: WorkKind[],
  attackBonus: number,
  wood: number,
  stone: number,
): ItemSpec =>
  entry(id, name, {
    category: 'tool',
    maximumStack: 1,
    slots: ['tool1', 'tool2'],
    visual,
    work,
    rate: woodenRate,
    material: 'wood',
    attackBonus,
    workshop: Structure.Workbench,
    cost: new Resources(0, wood, stone),
    seconds: 6,
    description: 'A wooden tool, made at a workbench.',
  });
// Stone tools: a stone head lashed to a haft, once the workbench has been upgraded.
const stoneTool = (
  id: string,
  name: string,
  visual: EquipmentVisual,
  work: WorkKind[],
  attackBonus: number,
  wood: number,
  stone: number,
): ItemSpec => ({
  ...woodenTool(id, name, visual, work, attackBonus, wood, stone),
  rate: stoneRate,
  material: 'stone',
  tier: 2,
  stationLevel: 2,
  seconds: 9,
  description: 'A stone-headed tool, made at an upgraded workbench.',
});
const shovelText =
    'Digs: lays and mends roads and breaks in new fields.',
  sickleText = "Helps a farmer harvest ripe crops.",
  spearText = 'A long thrusting weapon: its point runs on through one enemy behind its target.';
const smithText = [
  '',
  'A wooden weapon, made at the smithy.',
  'A weapon with a stone head or edge, made at an upgraded smithy.',
  'Forged from a smelted ingot at the smithy.',
  'Refitted at the smithy with material from the foundry.',
];
/** A smithy weapon of `tier`; the smithy must be at that level, the wielder at `level`. */
const weapon = (
  id: string,
  name: string,
  visual: WeaponShape,
  material: ItemMaterial,
  tier: number,
  reach: number,
  cost: Resources,
): ItemSpec =>
  entry(id, name, {
    category: 'weapon',
    maximumStack: 1,
    slots: ['weapon'],
    visual,
    material,
    tier,
    attackBonus: tier,
    scaling: weaponGrades[visual][tier - 1],
    reach,
    minimumLevel: smithLevels[tier],
    workshop: Structure.Weaponsmith,
    stationLevel: Math.min(tier, 3),
    cost,
    seconds: smithSeconds[tier],
    description: visual === 'spear' ? spearText : smithText[tier],
  });
/** Level a resident needs to wield or wear smithy gear of each tier. */
const smithLevels = [1, 1, 3, 5, 7],
  smithSeconds = [8, 8, 12, 16, 20];
const shieldText = [
  '',
  'A round board shield for the free hand. Not with a spear, a bow or a staff.',
  'A board shield studded with stone. Not with a spear, a bow or a staff.',
  'An iron-rimmed shield. Not with a spear, a bow or a staff.',
];
const shield = (id: string, name: string, material: ItemMaterial, tier: number, block: number, weight: number, cost: Resources) =>
  entry(id, name, {
    category: 'armor',
    material,
    tier,
    weight,
    maximumStack: 1,
    slots: ['offhand'],
    block,
    minimumLevel: smithLevels[tier],
    workshop: Structure.Weaponsmith,
    stationLevel: tier,
    cost,
    seconds: smithSeconds[tier],
    description: shieldText[tier],
  });
const armor = (
  id: string,
  name: string,
  slot: EquipmentSlot,
  defense: number,
  level: number,
  cost: Resources,
  material: ItemMaterial | null = null,
): ItemSpec =>
  entry(id, name, {
    category: 'armor',
    material,
    // Worn belongings are light; resources, tools and weapons weigh a kilogram.
    weight: 0.1,
    maximumStack: 1,
    slots: [slot],
    defense,
    minimumLevel: level,
    cost,
    // No longer made; kept so the ones residents own keep working.
    tier: material ? undefined : 1,
    description: 'Worn armor that takes part of every blow.',
  });
const bodyText = [
  '',
  'Laced wooden slats worn over the tunic.',
  'Hide sewn with stone plates.',
  'A coat of iron rings.',
];
const bodyArmor = (id: string, name: string, material: ItemMaterial, tier: number, defense: number, weight: number, cost: Resources) => ({
  ...armor(id, name, 'body', defense, smithLevels[tier], cost, material),
  tier,
  weight,
  workshop: Structure.Weaponsmith,
  stationLevel: tier,
  seconds: smithSeconds[tier] + 2,
  description: bodyText[tier],
});
const refinedMaterial = (id: string, name: string, product: Product, cost: Resources, seconds: number, description: string) =>
  entry(id, name, { product, cost, seconds, description, workshop: Structure.Foundry });

const masterTool = (id: string, name: string, visual: HeldVisual, work: WorkKind[], attackBonus: number): ItemSpec =>
  entry(id, name, {
    category: 'tool', maximumStack: 1, slots: ['tool1', 'tool2'], visual, work, attackBonus,
    rate: rateAtEfficiency(4), material: 'embersteel', stationLevel: 3, minimumLevel: 6, workshop: Structure.Workbench,
    cost: Resources.from({ embersteel: 2 }), seconds: 18,
    description: 'A tool with a tempered embersteel head.',
  });
export const itemCatalog: readonly ItemSpec[] = [
  entry('wood', 'Wood', { product: Product.Wood }),
  entry('stone', 'Stone', { product: Product.Stone }),
  entry('food', 'Food', { product: Product.Food }),
  entry('water', 'Water', { product: Product.Water }),
  entry('planks', 'Planks', { product: Product.Planks }),
  entry('cut-stone', 'Cut stone', { product: Product.CutStone }),
  entry('gold', 'Gold', { product: Product.Goods }),
  entry('mana', 'Mana', { product: Product.Mana }),
  entry('bones', 'Bones', { product: Product.Bones, description: 'Bones from hunts and fallen monsters can be offered to Odin or worked at the foundry.' }),
  entry('hides', 'Hides', { product: Product.Hides, description: 'Tough skins from hunts and fallen brutes. A smith cuts them into boots.' }),
  entry('iron-ore', 'Iron ore', { product: Product.IronOre, description: 'Mine iron veins with a stone pick or win ore by sealing a dungeon.' }),
  entry('cinder-ore', 'Cinder ore', { product: Product.CinderOre, description: 'Mine the dark veins on volcanic ground with an iron pick.' }),
  entry('frostwood', 'Frostwood', { product: Product.Frostwood, description: 'Fell a frostwood spruce on frozen ground with a stone axe.' }),
  refinedMaterial('iron-ingot', 'Iron ingot', Product.IronIngot, Resources.from({ ironOre: 2, wood: 1 }), 6,
    'Smelt mountain ore for iron tools and arms.'),
  refinedMaterial('bound-frostwood', 'Bound frostwood', Product.BoundFrostwood, Resources.from({ frostwood: 2, bones: 1 }), 8,
    'Bind frostwood with bone glue for bows, staves and snow boots.'),
  refinedMaterial('embersteel', 'Embersteel', Product.Embersteel, Resources.from({ ironIngot: 1, cinderOre: 2, bones: 2 }), 10,
    'Temper iron with cinder ore and bone charcoal for stronger edges.'),
  woodenTool('wooden-axe', 'Wooden axe', 'axe', ['woodcutting'], 1, 3, 0),
  woodenTool('wooden-pick', 'Wooden pick', 'pickaxe', ['mining'], 1, 3, 1),
  woodenTool('wooden-mallet', 'Wooden mallet', 'hammer', ['construction', 'crafting'], 1, 3, 0),
  woodenTool('wooden-hoe', 'Wooden hoe', 'hoe', ['farming'], 1, 3, 0),
  { ...woodenTool('wooden-shovel', 'Wooden shovel', 'shovel', ['digging'], 1, 3, 0), description: shovelText },
  stoneTool('stone-axe', 'Stone axe', 'axe', ['woodcutting'], 2, 2, 3),
  stoneTool('stone-pick', 'Stone pick', 'pickaxe', ['mining'], 1, 2, 4),
  stoneTool('stone-hammer', 'Stone hammer', 'hammer', ['construction', 'crafting'], 1, 2, 3),
  stoneTool('stone-hoe', 'Stone hoe', 'hoe', ['farming'], 1, 2, 2),
  { ...stoneTool('flint-sickle', 'Flint sickle', 'sickle', ['reaping'], 1, 2, 2), description: sickleText },
  {
    ...stoneTool('hunting-knife', 'Hunting knife', 'knife', [], 1, 1, 2),
    rate: 0,
    huntBonus: 0.5,
    seconds: 6,
    description: 'Skins and butchers the kill of a hunt.',
  },
  weapon('wooden-sword', 'Wooden sword', 'sword', 'wood', 1, 0.9, new Resources(0, 4)),
  weapon('wooden-club', 'Wooden club', 'mace', 'wood', 1, 0.9, new Resources(0, 4)),
  weapon('short-bow', 'Short bow', 'bow', 'wood', 1, 2.6, new Resources(0, 5)),
  weapon('wooden-spear', 'Wooden spear', 'spear', 'wood', 1, 1.4, new Resources(0, 4)),
  weapon('wooden-staff', 'Wooden staff', 'staff', 'wood', 1, 1.6, new Resources(0, 4)),
  entry('pack-basket', 'Pack basket', {
    category: 'armor',
    maximumStack: 1,
    slots: ['accessory'],
    visual: 'basket',
    material: 'wood',
    weight: 0.5,
    carry: 15,
    workshop: Structure.Workbench,
    cost: new Resources(0, 4),
    seconds: 8,
    description: 'A wicker pack worn on the back.',
  }),
  tool('axe', 'Iron axe', 'axe', ['woodcutting'], 3, 2, 2),
  tool('pickaxe', 'Iron pick', 'pickaxe', ['mining'], 2, 2, 3),
  tool('hammer', 'Iron hammer', 'hammer', ['construction', 'crafting'], 2, 1, 2),
  tool('hoe', 'Iron hoe', 'hoe', ['farming'], 2, 2, 1),
  tool('watering-can', 'Watering can', 'wateringCan', ['watering'], 1, 1, 2),
  tool('saw', 'Iron saw', 'saw', ['sawing'], 2, 2, 2),
  { ...tool('shovel', 'Iron shovel', 'shovel', ['digging'], 2, 2, 2), description: shovelText },
  { ...tool('sickle', 'Iron sickle', 'sickle', ['reaping'], 2, 1, 2), description: sickleText },
  masterTool('embersteel-axe', 'Embersteel axe', 'axe', ['woodcutting'], 4),
  masterTool('embersteel-pick', 'Embersteel pick', 'pickaxe', ['mining'], 3),
  masterTool('embersteel-hammer', 'Embersteel hammer', 'hammer', ['construction', 'crafting'], 3),
  weapon('flint-sword', 'Flint sword', 'sword', 'stone', 2, 0.9, new Resources(0, 2, 4)),
  weapon('mace', 'Stone mace', 'mace', 'stone', 2, 0.9, new Resources(0, 2, 4)),
  weapon('bow', 'Hunting bow', 'bow', 'wood', 2, 2.8, new Resources(0, 5, 2)),
  weapon('flint-spear', 'Flint spear', 'spear', 'stone', 2, 1.4, new Resources(0, 3, 3)),
  weapon('staff', 'Rune staff', 'staff', 'stone', 2, 2.5, new Resources(0, 4, 3)),
  weapon('sword', 'Iron sword', 'sword', 'iron', 3, 0.9, Resources.from({ gold: 4, wood: 1, ironIngot: 2 })),
  weapon('iron-mace', 'Iron mace', 'mace', 'iron', 3, 0.9, Resources.from({ gold: 3, wood: 1, ironIngot: 2 })),
  weapon('longbow', 'Longbow', 'bow', 'wood', 3, 3, Resources.from({ gold: 3, wood: 6, ironIngot: 1 })),
  weapon('spear', 'Iron spear', 'spear', 'iron', 3, 1.4, Resources.from({ gold: 3, wood: 3, ironIngot: 1 })),
  weapon('seer-staff', "Seer's staff", 'staff', 'iron', 3, 2.5, Resources.from({ gold: 4, wood: 4, ironIngot: 1 })),
  weapon('embersteel-sword', 'Embersteel sword', 'sword', 'embersteel', 4, 0.9, Resources.from({ embersteel: 3 })),
  weapon('embersteel-mace', 'Embersteel mace', 'mace', 'embersteel', 4, 0.9, Resources.from({ embersteel: 3 })),
  weapon('embersteel-spear', 'Embersteel spear', 'spear', 'embersteel', 4, 1.4, Resources.from({ embersteel: 2 })),
  weapon('frostwood-bow', 'Frostwood warbow', 'bow', 'frostwood', 4, 3.2, Resources.from({ boundFrostwood: 3, hides: 1 })),
  weapon('frostwood-staff', 'Frostwood staff', 'staff', 'frostwood', 4, 2.7, Resources.from({ boundFrostwood: 2, ironIngot: 1 })),
  shield('shield', 'Wooden shield', 'wood', 1, 0.15, 1, new Resources(0, 5)),
  shield('reinforced-shield', 'Reinforced shield', 'stone', 2, 0.24, 1.5, new Resources(0, 3, 4)),
  shield('iron-shield', 'Iron shield', 'iron', 3, 0.32, 2, Resources.from({ gold: 3, wood: 2, ironIngot: 2 })),
  bodyArmor('wooden-armor', 'Wooden armor', 'wood', 1, 0.06, 2, new Resources(0, 8)),
  bodyArmor('studded-armor', 'Stone-studded armor', 'stone', 2, 0.12, 3, new Resources(0, 4, 8)),
  { ...bodyArmor('mail-armor', 'Mail armor', 'iron', 3, 0.2, 4, Resources.from({ gold: 6, ironIngot: 3 })), attribute: 'strength' },
  {
    // Light enough for a level 3 head, as it always was.
    ...armor('helmet', 'Iron helmet', 'head', 0.06, 3, Resources.from({ gold: 3, ironIngot: 1 }), 'iron'),
    workshop: Structure.Weaponsmith,
    stationLevel: 3,
    seconds: smithSeconds[3],
    description: 'An iron cap for the head.',
  },
  armor('cap', 'Leather cap', 'head', 0.03, 1, new Resources(2, 1, 0, 2)),
  armor('leather-armor', 'Leather armor', 'body', 0.1, 1, new Resources(4, 2, 0, 4)),
  { ...armor('robe', 'Runic robe', 'body', 0.08, 2, new Resources(5, 1, 0, 3, 1)), attribute: 'intelligence' },
  {
    ...armor('boots', 'Leather boots', 'feet', 0.04, 1, Resources.from({ hides: 2 })),
    workshop: Structure.Weaponsmith, walkBonus: 0.1, seconds: 7,
    description: 'Boots with supple hide soles.',
  },
  {
    ...armor('snow-boots', 'Snow boots', 'feet', 0.05, 4, Resources.from({ hides: 2, boundFrostwood: 1 })),
    tier: 2, stationLevel: 2, workshop: Structure.Weaponsmith, attribute: 'dexterity', walkBonus: 0.18, snowGrip: 0.5, seconds: 12,
    description: 'Boots with frostwood soles for snowy ground.',
  },
  {
    ...armor('embersteel-boots', 'Embersteel boots', 'feet', 0.06, 6, Resources.from({ embersteel: 3, hides: 2 }), 'embersteel'),
    workshop: Structure.Weaponsmith, stationLevel: 3, attribute: 'dexterity', walkBonus: 0.18, snowGrip: 0.5, lavaProof: true, seconds: 16,
    description: 'Embersteel soles cross lava at full pace and keep the grip of snow boots.',
  },
  armor('gloves', 'Work gloves', 'hands', 0.03, 1, new Resources(2, 1, 0, 1)),
  armor('cloak', 'Travel cloak', 'accessory', 0.04, 1, new Resources(3, 1, 0, 2)),
];
const items = new Map(itemCatalog.map((item) => [item.id, item]));
export const itemSpec = (id: string): ItemSpec | null => items.get(id) ?? null;
export const itemMaterial = (id: string): ItemMaterial | null => itemSpec(id)?.material ?? null;
export const productItem = (product: Product): ItemSpec | null =>
  itemCatalog.find((item) => item.category === 'resource' && item.product === product) ?? null;
export type HandSlot = 'weapon' | 'tool1' | 'tool2';
/** An item whose shape is drawn in the hand. */
export type HeldItem = ItemSpec & { visual: HeldVisual | null };
const isHeld = (item: ItemSpec): item is HeldItem => item.visual !== 'basket';
const handSlot = (slot: EquipmentSlot): slot is HandSlot => slot === 'weapon' || slot === 'tool1' || slot === 'tool2';
export function equippedItem(person: Person, slot: HandSlot): HeldItem | null;
export function equippedItem(person: Person, slot: EquipmentSlot): ItemSpec | null;
export function equippedItem(person: Person, slot: EquipmentSlot): ItemSpec | null {
  const index = person.equipment[slot],
    stack = person.inventory[index - 1];
  const item = stack ? itemSpec(stack.item) : null;
  return item &&
    stack?.quantity === 1 &&
    item.minimumLevel <= person.level &&
    item.slots.includes(slot) &&
    (!handSlot(slot) || isHeld(item))
    ? item
    : null;
}
/** Tools a resident carries, equipped or anywhere in the pack, that they are of a level to use. */
export function carriedTools(person: Person): HeldItem[] {
  const out: HeldItem[] = [];
  for (const stack of person.inventory) {
    const item = stack?.quantity === 1 ? itemSpec(stack.item) : null;
    if (item?.category === 'tool' && item.minimumLevel <= person.level && isHeld(item) && !out.includes(item))
      out.push(item);
  }
  return out;
}
/** The equipped weapon, else the hardest-hitting tool carried, else bare hands. A preview can include a new tool. */
export function combatItem(person: Person, extraTool?: ItemSpec): HeldItem | null {
  const weapon = equippedItem(person, 'weapon');
  if (weapon) return weapon;
  const tools = carriedTools(person);
  if (extraTool?.category === 'tool' && extraTool.minimumLevel <= person.level && isHeld(extraTool)) tools.push(extraTool);
  return tools.sort((a, b) => b.attackBonus - a.attackBonus || a.id.localeCompare(b.id))[0] ?? null;
}
/** The best tool carried for any of `kinds`, equipped or in the pack; with none, the work goes at `bareHandsRate`. */
export function toolFor(person: Person, kinds: readonly WorkKind[]): HeldItem | null {
  let best: HeldItem | null = null, bestKind = Infinity;
  for (const item of carriedTools(person)) {
    const kind = kinds.findIndex((k) => item.work.includes(k));
    if (kind < 0) continue;
    const preferred = kind < bestKind || (kind === bestKind && best && item.id < best.id);
    if (!best || item.rate > best.rate || (item.rate === best.rate && preferred)) {
      best = item;
      bestKind = kind;
    }
  }
  return best;
}
export const taskEfficiency = (person: Person, kinds: readonly WorkKind[]): number =>
  toolFor(person, kinds)?.rate ?? bareHandsRate;
export const roadWorkKinds: readonly WorkKind[] = ['digging', 'construction'];
/** The best tool carried for `kind`. On a road a shovel serves as well as a hammer, so it is the one in hand. */
export function workItem(person: Person, kind: WorkKind): HeldItem | null {
  return toolFor(person, kind === 'construction' && person.activity === Activity.Roadwork ? roadWorkKinds : [kind]);
}
/** The item that adds most to a hunt's food and bones: a carried tool or worn gear, or null. */
export function huntItem(person: Person): ItemSpec | null {
  let best: ItemSpec | null = null;
  for (const item of [...carriedTools(person), ...equipmentSlots.map((slot) => equippedItem(person, slot))])
    if (item && item.huntBonus > (best?.huntBonus ?? 0)) best = item;
  return best;
}
/** Kilograms the worn gear adds to what a resident carries before slowing and before the pack is full. */
export const carryBonus = (person: Person): number =>
  equipmentSlots.reduce((total, slot) => total + (equippedItem(person, slot)?.carry ?? 0), 0);
/** The resident carries this item, or a make of the same kind: 'held' equipped, 'owned' in the pack, 'better' a stronger make. */
export function ownedMake(person: Person, item: ItemSpec): 'held' | 'owned' | 'better' | '' {
  let found: 'held' | 'owned' | 'better' | '' = '';
  person.inventory.forEach((stack, index) => {
    const other = stack ? itemSpec(stack.item) : null;
    if (!other) return;
    if (other.id === item.id) {
      const worn = equipmentSlots.some((slot) => person.equipment[slot] === index + 1);
      if (worn && item.category !== 'tool') found = 'held';
      else if (found !== 'held') found = 'owned';
    } else if (!found && betterMake(other, item)) found = 'better';
  });
  return found;
}
/** True when the resident carries nothing of this item's kind, of any make. */
export const lacksKind = (person: Person, item: ItemSpec): boolean =>
  !person.inventory.some((stack) => {
    const other = stack ? itemSpec(stack.item) : null;
    return !!other && (other.id === item.id || (other.tier > 0 && item.tier > 0 && lineOf(other) === lineOf(item)));
  });
export const craftsAt = (item: ItemSpec, kind: Structure): boolean => item.workshop !== null && kind === item.workshop;
/** Buildings where residents craft, one at a time, in the open at the door. */
export const isCraftStation = (kind: Structure): boolean =>
  kind === Structure.Workbench || kind === Structure.Weaponsmith || kind === Structure.Armorer || kind === Structure.Foundry;
export const baseAttack = 1;
export function combatAttributes(person: Person): Attributes {
  const stats = naturalAttributes(person);
  for (const slot of equipmentSlots) {
    const attribute = equippedItem(person, slot)?.attribute;
    if (attribute) ++stats[attribute];
  }
  return stats;
}
/** Omitting the item uses the same weapon or fallback tool as a real strike. Passing one previews a loadout. */
export function attackDamage(person: Person, item: ItemSpec | null = combatItem(person)): number {
  return baseAttack + (item?.attackBonus ?? 0) + (item?.scaling ? scalingBonus(combatAttributes(person), item.scaling) : 0);
}
export const attackReach = (person: Person): number => combatItem(person)?.reach ?? bareReach;
export const armorProtection = (person: Person): number =>
  Math.min(
    0.7,
    equipmentSlots.reduce((total, slot) => total + (equippedItem(person, slot)?.defense ?? 0), 0),
  );
export const workEfficiency = (person: Person, kind: WorkKind): number =>
  workItem(person, kind)?.rate ?? bareHandsRate;
/** Seconds to fell a tree or break a load of stone at `rate`; matches `harvestDuration`. */
export const harvestSeconds = (rate: number): number => 6 / rate;
/** Items of one kind in different makes share a line: a wooden, a flint and an iron sword. */
export const lineOf = (item: ItemSpec): string =>
  `${item.category}|${item.visual ?? item.slots.join()}|${item.work.join()}`;
const sameLine = (a: ItemSpec, b: ItemSpec): boolean => a.tier > 0 && b.tier > 0 && lineOf(a) === lineOf(b);
/** The next weaker make of the same kind (stone axe for an iron one), preferring what is still made, or null. */
export function lowerTier(item: ItemSpec): ItemSpec | null {
  let best: ItemSpec | null = null;
  for (const other of itemCatalog)
    if (
      sameLine(other, item) &&
      other.tier < item.tier &&
      (!best ||
        other.tier > best.tier ||
        (other.tier === best.tier && best.workshop === null && other.workshop !== null))
    )
      best = other;
  return best;
}
/** The next better make that is still made (a flint sword for a wooden one), or null at the top. */
export function upperTier(item: ItemSpec): ItemSpec | null {
  let best: ItemSpec | null = null;
  for (const other of itemCatalog)
    if (sameLine(other, item) && other.workshop !== null && other.tier > item.tier && (!best || other.tier < best.tier))
      best = other;
  return best;
}
/** The make below that is still made, which `item` is upgraded from; null for the first make of its kind, the only one made new. */
export function madeFrom(item: ItemSpec): ItemSpec | null {
  let best: ItemSpec | null = null;
  for (const other of itemCatalog)
    if (sameLine(other, item) && other.workshop !== null && other.tier < item.tier && (!best || other.tier > best.tier))
      best = other;
  return best;
}
/** The first make of every kind a station makes, in catalog order. */
export const stationKinds = (kind: Structure): ItemSpec[] => itemCatalog.filter((item) => craftsAt(item, kind) && !madeFrom(item));
/** The best make of `item`'s kind in the pack, or null. */
export function carriedMake(person: Person, item: ItemSpec): ItemSpec | null {
  let best: ItemSpec | null = null;
  for (const stack of person.inventory) {
    const other = stack ? itemSpec(stack.item) : null;
    if (other && (other.id === item.id || sameLine(other, item)) && (!best || other.tier > best.tier)) best = other;
  }
  return best;
}
/** The make of a kind a resident gets next: its first with none in the pack, else the one above the best carried; null at the top. */
export function nextMake(person: Person, first: ItemSpec): ItemSpec | null {
  if (first.category === 'resource') return first;
  const carried = carriedMake(person, first);
  return carried ? upperTier(carried) : first;
}
/** True when `better` is a stronger make of the same kind as `item`. */
export const betterMake = (better: ItemSpec, item: ItemSpec): boolean => sameLine(better, item) && better.tier > item.tier;
/** What turning a weaker make into `target` costs: a share of making it new, rounded up. */
export function upgradeCost(target: ItemSpec): Resources {
  const out = new Resources();
  for (const key of resourceKeys) out[key] = Math.ceil(target.cost[key] * upgradeShare - 1e-9);
  return out;
}
export const upgradeSeconds = (target: ItemSpec): number => Math.round(target.seconds * upgradeShare * 10) / 10;
export const isShield = (item: ItemSpec | null): boolean => !!item && item.block > 0 && item.slots.includes('offhand');
export function aMake(item: ItemSpec): string {
  const name = item.name.toLowerCase();
  if (item.slots.includes('feet')) return `a pair of ${name}`;
  return `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`;
}
/** The shield this resident can raise: one in the off hand while the item in hand leaves that hand free. */
export function raisedShield(person: Person): ItemSpec | null {
  const shield = equippedItem(person, 'offhand');
  return isShield(shield) && (combatItem(person)?.hands ?? 1) === 1 ? shield : null;
}
export interface InventorySlot {
  slot: number;
  item: ItemSpec | null;
  quantity: number;
  equipped: EquipmentSlot[];
  cargo: boolean;
}
export function inventorySlots(person: Person): readonly InventorySlot[] {
  return [
    {
      slot: 0,
      item: person.carrying > 0 ? productItem(person.carriedProduct) : null,
      quantity: person.carrying,
      equipped: [],
      cargo: true,
    },
    ...person.inventory.map((stack, index) => ({
      slot: index + 1,
      item: stack ? itemSpec(stack.item) : null,
      quantity: stack?.quantity ?? 0,
      equipped: equipmentSlots.filter((slot) => person.equipment[slot] === index + 1),
      cargo: false,
    })),
  ];
}
export function inventoryRoom(person: Person, id: string): number {
  const item = itemSpec(id);
  return item
    ? person.inventory.reduce(
        (room, stack) =>
          room + (!stack ? item.maximumStack : stack.item === id ? item.maximumStack - stack.quantity : 0),
        0,
      )
    : 0;
}
export function addInventory(person: Person, id: string, quantity = 1): boolean {
  const item = itemSpec(id);
  if (!item || !Number.isSafeInteger(quantity) || quantity <= 0 || inventoryRoom(person, id) < quantity)
    return false;
  for (const stack of person.inventory)
    if (stack?.item === id) {
      const added = Math.min(quantity, item.maximumStack - stack.quantity);
      stack.quantity += added;
      quantity -= added;
    }
  for (let index = 0; quantity > 0 && index < backpackSize; ++index)
    if (!person.inventory[index]) {
      const added = Math.min(quantity, item.maximumStack);
      person.inventory[index] = { item: id, quantity: added };
      quantity -= added;
    }
  return true;
}
export function validInventory(person: Person): boolean {
  if (!Array.isArray(person.inventory) || person.inventory.length !== backpackSize) return false;
  if (
    !person.equipment ||
    equipmentSlots.some(
      (slot) =>
        !Number.isInteger(person.equipment[slot]) ||
        person.equipment[slot] < -1 ||
        person.equipment[slot] === 0 ||
        person.equipment[slot] > backpackSize,
    )
  )
    return false;
  for (const stack of person.inventory) {
    if (stack === null) continue;
    const item = stack && typeof stack.item === 'string' ? itemSpec(stack.item) : null;
    if (
      !item ||
      !Number.isInteger(stack.quantity) ||
      stack.quantity < 1 ||
      stack.quantity > item.maximumStack
    )
      return false;
  }
  const used = new Set<number>();
  for (const slot of equipmentSlots)
    if (person.equipment[slot] >= 1) {
      if (used.has(person.equipment[slot]) || !equippedItem(person, slot)) return false;
      used.add(person.equipment[slot]);
    }
  return true;
}
