import type { ThorVGNamespace, Scene } from '@thorvg/webcanvas';
import { Camera, isoMatrix, point, type Point } from '../../engine/src/geometry';
import { Preview } from '../../engine/src/game-tools';
import { VisibilityMap } from '../../engine/src/visibility-map';
import { Weather } from '../../engine/src/climate';
import type { Strike } from '../../engine/src/thunderstorm';
import type { Hit } from '../../engine/src/person';
import { Rect } from '../../native-ui/src/types';
import { PaintNode, ShapeNode, SceneNode, TextNode, AnimationNode, identity, type Matrix, type Rgb, PictureNode } from './paint';
import { SUN_PASSES, blendLayer } from './vector-paint';
import { WebCanvasAdapter } from './webcanvas-adapter';
import { Flicker } from './light-flicker';
import type { RiseAnimation } from './building-animation';
import { PersonParts, type TextBounds } from './world-sprites';
import type { Tinted } from './terrain-painter';
import type { TileRegion } from './render-types';
import type { YmirLight } from './ymir-statue';
import type { VolcanoLight } from './volcano-painter';
import type { CloudMottle } from './cloud-mottle';
import type { MistField } from './mist-bands';
export const isoLayer = (): SceneNode => new SceneNode().transform(isoMatrix() as unknown as Matrix);
export interface Visual {
  picture: AnimationNode;
  nestEggs?: ShapeNode[];
  layout: RiseAnimation;
  version: number;
  appearances: bigint[];
  center: Point;
  angle: number;
  start: number;
  frame: number;
}
export interface Sprite {
  paint: SceneNode;
  row: number;
  seen: boolean;
}
export interface Figure extends Sprite {
  lookKey: string;
  parts: PersonParts;
  last: Point;
  stride: number;
  facing: number;
  striding: boolean;
  /** Visible feet and progress of a newly arriving resident while their work continues in simulation. */
  arrival?: { foot: Point; rising: boolean };
  /** When the figure was last drawn, and the flinch spring a blow sets off. */
  shown?: number;
  squish?: number;
  squishSpeed?: number;
  shownHealth?: number;
  /** 0 standing, 1 flat on the ground: eased toward whichever the resident is. */
  lying?: number;
  /** Laying a road at its front: the small steps that keep them there do not turn the figure. */
  laying?: boolean;
}
export interface Pool {
  center: Point;
  rx: number;
  ry: number;
  warmth: Rgb;
  flicker: Flicker;
  glow?: PaintNode;
  halo?: PaintNode;
  flame: Point;
  hole?: PaintNode;
  tint?: PaintNode;
  glowAt: Matrix;
}
export const pool = (
  center: Point,
  rx: number,
  ry: number,
  warmth: Rgb = [0, 0, 0],
  flicker = Flicker.Magic,
  glow?: PaintNode,
  halo?: PaintNode,
  flame = point(),
): Pool => ({ center, rx, ry, warmth, flicker, glow, halo, flame, glowAt: identity });
export interface Landmark {
  paint?: SceneNode;
  key: bigint;
}
export interface GroundChunk {
  area: TileRegion;
  bounds: Rect;
  scene: SceneNode;
  terrain: SceneNode;
  tints: Tinted[];
  dirty: boolean;
  edited: boolean;
}
export interface FallingTree {
  paint: SceneNode;
  body: SceneNode;
  dust: ShapeNode;
  pivot: Point;
  row: number;
  at: number;
  side: number;
}
export interface GrowingTree {
  paint: SceneNode;
  body: SceneNode;
  leaves: ShapeNode;
  foot: Point;
  row: number;
  cell: number;
  index: number;
  at: number;
}
/** Native retained state. Browser/module ownership stays with the application. */
export class WorldRendererState {
  readonly adapter: WebCanvasAdapter;
  editorView = false;
  sceneView = false;
  root = new SceneNode();
  world = new SceneNode();
  ground = isoLayer();
  /** Jormungandr's coils in the sea: over the water, under the coast and all that stands on land. */
  serpent = new SceneNode();
  /** The serpent over the veil of known sea, and its silhouette over a lightning flash. */
  serpentLit = new SceneNode();
  serpentShade = new SceneNode();
  /** Surface details that disappear under each strip of freshly tilled soil. */
  groundCover = new SceneNode();
  farmland = isoLayer();
  /**
   * The fog of war, flat on the ground under all that stands: the tint on land only remembered and the bank on
   * land unknown. What stands is told whole from the same fields (`world-depth.ts`), so nothing is cut.
   */
  mist = isoLayer();
  roads = isoLayer();
  lights = new SceneNode();
  roadLights = new SceneNode();
  objects = new SceneNode();
  /** Silhouettes of units hidden behind trees and peaks, over every world object. */
  ghosts = new SceneNode();
  effects = new SceneNode();
  overlay = new SceneNode();
  selection = new SceneNode();
  background = new ShapeNode();
  vignette = new SceneNode();
  darkness = new SceneNode();
  warmth = new SceneNode();
  cloudMistPicture = new PictureNode(new Uint8Array(4), 1, 1);
  /** Keep the mask scene attached while the fog picture inside it is refreshed. */
  cloudMist = isoLayer().add(this.cloudMistPicture).opacity(0);
  /** Cloud shadows fall across the land, figures and daylight and fade under the mist. */
  clouds = new SceneNode().mask(this.cloudMist, 'inverseAlpha');
  sunlight = new SceneNode();
  ornaments = new SceneNode();
  combat = new SceneNode();
  /** Combat shapes flat on the ground (telegraphs, skill areas, rings), under selection rings and figures. */
  combatGround = new SceneNode();
  prints = isoLayer();
  /** Rain splashing on the ground and water, under every unit. */
  splashes = isoLayer();
  overcast = new ShapeNode();
  precipitation = new ShapeNode();
  mapName = new SceneNode();
  storm = new SceneNode();
  damageBack: ShapeNode | null = null;
  damageLeft: ShapeNode | null = null;
  strike: Strike | null = null;
  struck = point();
  nameDirty = true;
  lettering: { text: TextNode; shadow: TextNode; at: Point; box: TextBounds } | null = null;
  flame: ShapeNode | null = null;
  flameCore: ShapeNode | null = null;
  pulses: PaintNode[] = [];
  wispPaints: PaintNode[] = [];
  ymirGlints: (PaintNode | null)[] = [null, null];
  ymirRow = -1;
  fireRow = -1;
  ymirPaint: Landmark = { key: -1n };
  volcanoPaint: Landmark = { key: -1n };
  ymirLight: YmirLight | null = null;
  volcanoLight: VolcanoLight | null = null;
  rows: SceneNode[] = [];
  rowBuildings: SceneNode[] = [];
  rowLamps: SceneNode[] = [];
  rowTrees: SceneNode[] = [];
  rowCanopies: SceneNode[][] = [];
  swayAt = -1;
  swaying = false;
  treeKeys: bigint[] = [];
  miningRevision = 0;
  wisps: { center: Point; color: Rgb; radius: number }[] = [];
  pools: Pool[] = [];
  buildingPools = 0;
  lamps: Point[] = [];
  vision: { center: Point; radius: number }[] = [];
  exploredVisibility = new VisibilityMap();
  currentVisibility = new VisibilityMap();
  /** Vision has run: the world has a fog of war (the editors and scene views have none). */
  fogged = false;
  mistField: MistField | null = null;
  /** The mist's soft picture, once the fog of war is on. */
  mistPicture: PictureNode | null = null;
  /** The warm pass of the day's light as a picture that thins out under the mist, and the scene it is blended through. */
  warmPicture = new PictureNode(new Uint8Array(4), 1, 1);
  warmLayer = isoLayer().blend('add');
  /** When the mist was last redrawn, how many times so far, and the view and sight it was drawn for. */
  mistAt = -1;
  mistTick = 0;
  mistView = [0, 0, 0, 0];
  mistKey = '';
  /** Shows the land itself, as if all of it were in sight: for pictures and checks of the world. */
  mistLifted = false;
  /** Whether the warm pass of the day's light is the picture that spares the mist. */
  warmthCut = false;
  /** Landmarks seen so far, by their depth key: the bank keeps off their whole ground from then on. */
  mistKnown = new Map<string, { center: Point; radius: number }>();
  cloudShapes: SceneNode[] = [];
  mottle: CloudMottle | null = null;
  ornamentLook = -1n;
  /** A terrain edit waits this long for the stroke to move on before trees and props are rebuilt. */
  terrainEditedAt = -1;
  terrainEditPending = false;
  /** Screen-space centre of the latest terrain edit; its nearest ground chunks repaint first. */
  terrainEditFocus = { x: 0, y: 0 };
  sunPasses: ShapeNode[] = [];
  /** The scene each pass of the day's light is blended through, in the same order. */
  sunLayers: SceneNode[] = [];
  darkVeil: ShapeNode | null = null;
  fitted = [0, 0, 0, 0];
  shownGrey = 0;
  shownSun = 1;
  shownShade = 0;
  shownCloudy = 0;
  shownWet = 0;
  fallingIntensity = 0;
  falling = Weather.Rain;
  weatherAt = -1;
  footprints: { at: Point; made: number }[] = [];
  lastStep = new Map<number, Point>();
  leftFoot = false;
  printsAt = -1;
  firePosition = point();
  visuals = new Map<number, Visual>();
  figures = new Map<number, Figure>();
  beasts = new Map<number, Sprite>();
  climateKey = -1;
  sightCount = 0;
  lastAnimate = -1;
  revision = 0n;
  roadRevision = -1n;
  appearanceGeneration = 0n;
  groundTints: Tinted[] = [];
  groundChunks: GroundChunk[] = [];
  overviewChunks: GroundChunk[] = [];
  detailedGround: SceneNode | null = null;
  overviewGround: SceneNode | null = null;
  groundWidth = 0;
  groundHeight = 0;
  shownPreview = new Preview();
  view = new Camera();
  viewWidth = 0;
  viewHeight = 0;
  lastFlicker = -1;
  treeBounds: Rect[] = [];
  fallingTrees: FallingTree[] = [];
  growingTrees: GrowingTree[] = [];
  treeCounts = new Uint8Array();
  renderedAt = 0;
  /** Wall time for an altar arrival while the settlement clock is paused. */
  arrivalSeconds?: number;
  seenTreeEvent = 0n;
  /** Keeps water and other ambient motion still; the app may set it from its own preference. */
  reducedMotion = false;
  waterAt = -1;
  waterStill = false;
  constructor(readonly tvg: ThorVGNamespace) {
    this.adapter = new WebCanvasAdapter(tvg);
    this.root.add(this.background).add(this.world).add(this.overcast).add(this.vignette);
    for (const layer of [
      this.ground,
      this.serpent,
      this.groundCover,
      this.farmland,
      this.ornaments,
      this.roads,
      this.prints,
      this.splashes,
      this.lights,
      this.mist,
      // Combat marks lie under the selection and hover rings, so a ring stays readable on a skill's disc.
      this.combatGround,
      this.selection,
      this.objects,
      this.ghosts,
      this.effects,
      this.sunlight,
      this.clouds,
      this.darkness,
      this.warmth,
      this.serpentLit,
      this.combat,
      this.mapName,
      this.storm,
      this.serpentShade,
    ])
      this.world.add(layer);
    this.world.add(this.precipitation).add(this.overlay);
    this.warmth.blend('screen');
    for (const spec of SUN_PASSES) {
      const pass = new ShapeNode()
        .appendRect(0, 0, 1, 1)
        .fill(spec.color[0], spec.color[1], spec.color[2], spec.color[3]);
      const layer = blendLayer(pass, spec.method);
      this.sunlight.add(layer);
      this.sunPasses.push(pass);
      this.sunLayers.push(layer);
    }
    this.sunlight.add(this.warmLayer.add(this.warmPicture).opacity(0));
  }
  scene(): Scene {
    return this.adapter.sync(this.root) as Scene;
  }
  setEditorView(value: boolean): void {
    this.editorView = value;
  }
  setSceneView(value: boolean): void {
    this.sceneView = value;
    this.editorView = value;
  }
  measureText = (text: string, size: number, font: string): TextBounds | undefined => {
    let paint: InstanceType<ThorVGNamespace['Text']> | undefined;
    try {
      paint = new this.tvg.Text().font(font).fontSize(size).text(text);
      const b = paint.bounds();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    } catch {
      return undefined;
    } finally {
      paint?.dispose();
    }
  };
  dispose(): void {
    this.adapter.dispose();
  }
}
