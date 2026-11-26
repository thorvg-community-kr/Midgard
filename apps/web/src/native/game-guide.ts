// First-time moments: watches the world each frame, records what the player has been told, queues the
// cards, and when the player is not busy eases the camera to the place and lays the selection on the thing
// a card introduces.
import { project, type Point } from '../../../../packages/engine/src/geometry';
import type { Town } from '../../../../packages/engine/src/town';
import { Activity, type Person } from '../../../../packages/engine/src/person';
import { equipmentSlots, equippedItem, carriedTools } from '../../../../packages/engine/src/equipment';
import { isPlayerBuilding, isPlayerResident } from '../../../../packages/engine/src/faction';
import type { Structure } from '../../../../packages/engine/src/building-catalog';
import type { Building } from '../../../../packages/engine/src/town-models';
import { Order, Tool } from '../../../../packages/engine/src/game-tools';
import { Cue } from '../../../../packages/native-audio/src/sound-types';
import type { WorldObjectRef } from '../../../../packages/native-renderer/src/world-picking-types';
import type { GameAppState } from './game-app-state';
import { rememberCrew } from './clear-order-hud';
import { glideTo, inView, stepGlide, type CameraGlide } from './camera-glide';
import { guidePreferences } from './guide-preferences';
import type { NoticeRecord } from './notice-toast';
import { guideMoment, guideMoments, type GuideMoment, type GuideScan, type GuideSpot } from './guide-moments';

export const guideRules = {
  /** UI seconds a card stays unless dismissed; hovering keeps it. */
  cardSeconds: 12,
  /** Cards waiting behind the one shown; older ones go straight to the log. */
  queue: 3,
  /** The camera is the player's for this long after they move it or give an order. */
  busySeconds: 2,
  /** Residents the player picked or gave an order to stay in their hand for this long. */
  handSeconds: 10,
};
export interface GuideEntry {
  key: string;
  /** Day of the game it happened, from 1; null for entries rebuilt from a save. */
  day: number | null;
  at: Point | null;
  /** The thing it introduces, while this game runs: selected, or ringed, when its card is shown; none for a first deed. */
  about: readonly WorldObjectRef[];
  detail: string[];
  /** Shown as a card or read in the open log; the log button counts the rest. */
  seen: boolean;
}
export interface GuideCard {
  entry: GuideEntry;
  until: number;
  /** The camera went to the place, or it was already in view: no "Look" needed. */
  looked: boolean;
  /** Kept at the edge of the screen from now on: a fight began beside it, or the thing it stood by left the view. */
  edged: boolean;
}
/** Guide bookkeeping, owned by one game app and reset whenever its town is replaced. */
export class GuideState {
  town: object | null = null;
  /** Oldest first. */
  log: GuideEntry[] = [];
  /** The notices the feed has shown, oldest first; not saved, and only the newest are kept. */
  notices: NoticeRecord[] = [];
  queue: GuideEntry[] = [];
  card: GuideCard | null = null;
  logOpen = false;
  /** The entries whose body is unfolded; forgotten when the log is opened again. */
  logUnfolded = new Set<object>();
  /** Start of each page the log has shown, newest first; the last is the page on screen. */
  logPages: number[] = [0];
  heardCombat = 0n;
  heardTree = 0n;
  heardBirth = 0n;
  animals = new Set<number>();
  gear = new Map<number, string>();
  camera = { x: Number.NaN, y: Number.NaN, zoom: Number.NaN };
  cameraMovedAt = -Infinity;
  orderedAt = -Infinity;
  /** The residents selected last frame, and when the player last changed them. */
  hand = '';
  pickedAt = -Infinity;
  glide: CameraGlide | null = null;
  /** UI time the card was last drawn and of the last frame, so a card's time only runs while it is on screen. */
  drawnAt = -1;
  frameAt = -1;
}
export type GuideApp = Pick<
  GameAppState,
  | 'town'
  | 'camera'
  | 'viewWidth'
  | 'viewHeight'
  | 'renderer'
  | 'context'
  | 'tool'
  | 'pending'
  | 'panFrom'
  | 'boxFrom'
  | 'fieldFrom'
  | 'roadPress'
  | 'roadStroke'
  | 'touchGesture'
  | 'sceneDragAt'
  | 'pan'
  | 'cues'
  | 'combatHud'
  | 'army'
  | 'prayer'
  | 'rosterOpen'
  | 'residentArrival'
  | 'hoveredWorldTarget'
  | 'guide'
  | 'chosen'
  | 'selected'
  | 'selectedDungeon'
  | 'selectedObjects'
> & {
  selectPeople(ids: number[]): void;
  selectObject(ref: WorldObjectRef): void;
};

const nextSerial = (serials: Iterable<bigint>): bigint => {
  let next = 0n;
  for (const serial of serials) if (serial >= next) next = serial + 1n;
  return next;
};
function gearSignature(town: Town): Map<number, string> {
  const out = new Map<number, string>();
  for (const p of town.people())
    if (isPlayerResident(p))
      out.set(p.id, [...equipmentSlots.map((slot) => equippedItem(p, slot)?.id ?? ''), ...carriedTools(p).map((item) => item.id)].join('|'));
  return out;
}
function entryOf(town: Town, moment: GuideMoment): GuideEntry {
  return { key: moment.key, day: null, at: moment.where?.(town) ?? null, about: [], detail: [], seen: true };
}
export const guideUnread = (s: GuideState): number => s.log.reduce((n, e) => n + (e.seen ? 0 : 1), 0);
/** Everything the log holds as one timeline, newest first: explanations and the notices that came between them. */
export function guideTimeline(s: Pick<GuideState, 'log' | 'notices'>): (GuideEntry | NoticeRecord)[] {
  const out: (GuideEntry | NoticeRecord)[] = [];
  let n = s.notices.length - 1;
  for (let i = s.log.length - 1; i >= 0; --i) {
    while (n >= 0 && s.notices[n].after > i) out.push(s.notices[n--]);
    out.push(s.log[i]);
  }
  while (n >= 0) out.push(s.notices[n--]);
  return out;
}
/** A new town: the log is read back from what it was told, and an older save marks what it plainly met. */
function attach(app: GuideApp): void {
  const s = app.guide,
    town = app.town;
  s.town = town;
  s.queue = [];
  s.card = null;
  s.glide = null;
  s.logPages = [0];
  s.logUnfolded = new Set();
  s.heardCombat = nextSerial(town.combatEvents().map((e) => e.serial));
  s.heardTree = nextSerial(town.treeEvents().map((e) => e.serial));
  s.heardBirth = nextSerial(town.devotionEvents().map((e) => e.serial));
  s.animals = new Set(town.wildlife().map((a) => a.id));
  s.gear = new Map();
  // A new game waits for the player and has met nothing; a loaded game never waits.
  if (!town.told.length && !town.awaiting)
    for (const moment of guideMoments) if (moment.met(town)) town.told.push(moment.key);
  s.log = [];
  s.notices = [];
  for (const key of town.told) {
    const moment = guideMoment(key);
    if (moment) s.log.push(entryOf(town, moment));
  }
}
function scanOf(app: GuideApp, told: ReadonlySet<string>): GuideScan {
  const s = app.guide,
    town = app.town;
  const combat = town.combatEvents().filter((e) => e.serial >= s.heardCombat),
    trees = town.treeEvents().filter((e) => e.serial >= s.heardTree),
    births = town.devotionEvents().filter((e) => e.serial >= s.heardBirth),
    // Gear is only watched until the first piece in hand has been told.
    gear = told.has('equip') ? new Map<number, string>() : gearSignature(town),
    fresh: { person: Person; item: string }[] = [],
    built = new Map<Structure, Building>();
  for (const b of town.buildings()) if (b.built() && isPlayerBuilding(b) && !built.has(b.kind)) built.set(b.kind, b);
  for (const [id, signature] of gear) {
    // A resident not watched before brings their gear with them; only a change counts.
    if (!s.gear.has(id)) continue;
    const before = s.gear.get(id)?.split('|') ?? [],
      person = town.person(id);
    if (!person) continue;
    signature.split('|').forEach((item, slot) => {
      if (item && item !== before[slot]) fresh.push({ person, item });
    });
  }
  return {
    town,
    combat,
    trees,
    births,
    notices: town.notices,
    animals: s.animals,
    gear: fresh,
    built,
    sees: (at) => app.renderer.visible(at),
    shows: (at) => app.renderer.visible(at) && inView(app.camera, at, app.viewWidth, app.viewHeight, 0.12),
    frames: (at) => inView(app.camera, at, app.viewWidth, app.viewHeight, 0.12),
  };
}
function settle(app: GuideApp, scan: GuideScan): void {
  const s = app.guide,
    town = app.town;
  s.heardCombat = nextSerial([s.heardCombat - 1n, ...scan.combat.map((e) => e.serial)]);
  s.heardTree = nextSerial([s.heardTree - 1n, ...scan.trees.map((e) => e.serial)]);
  s.heardBirth = nextSerial([s.heardBirth - 1n, ...scan.births.map((e) => e.serial)]);
  s.animals = new Set(town.wildlife().map((a) => a.id));
  s.gear = town.told.includes('equip') ? new Map() : gearSignature(town);
}
/** A resident of the player is fighting on screen: the guide covers nothing there. */
export function guideFightInView(app: Pick<GuideApp, 'town' | 'camera' | 'viewWidth' | 'viewHeight'>): boolean {
  const { camera, viewWidth: w, viewHeight: h } = app;
  return app.town.people().some((p) => {
    if (!isPlayerResident(p) || p.activity !== Activity.Fighting) return false;
    const at = camera.toScreen(project(p.position.x, p.position.y), w, h);
    return at.x >= 0 && at.y >= 0 && at.x <= w && at.y <= h;
  });
}
/** The player is steering: the camera and the selection stay theirs. */
export function guideBusy(app: GuideApp, now: number): boolean {
  const s = app.guide;
  if (now - s.cameraMovedAt < guideRules.busySeconds || now - s.orderedAt < guideRules.busySeconds) return true;
  if (app.panFrom || app.boxFrom || app.fieldFrom || app.roadPress || app.roadStroke.length) return true;
  if (app.touchGesture || app.sceneDragAt || app.pan.x !== 0 || app.pan.y !== 0) return true;
  if (app.tool !== Tool.Select || app.pending !== Order.None || app.army.aim || app.prayer || app.rosterOpen) return true;
  return guideFightInView(app);
}
function standing(town: Town, ref: WorldObjectRef): boolean {
  if (ref.kind === 'person') return !!town.person(ref.id);
  if (ref.kind === 'monster') return (town.creature(ref.id)?.health ?? 0) > 0;
  if (ref.kind === 'building') return !!town.building(ref.id);
  if (ref.kind === 'dungeon') return !!town.map().dungeons()[ref.id];
  if (ref.kind === 'field') return !!town.field(ref.id);
  if (ref.kind === 'road') return !!town.roads().road(ref.id);
  return ref.kind === 'landmark';
}
/** The things an entry introduces that are still in the world; its card stands by the first. */
export const guideAbout = (town: Town, entry: GuideEntry): WorldObjectRef[] => entry.about.filter((ref) => standing(town, ref));
/** Where the thing an entry introduces stands now, or where a first deed happened; null for what is gone or indoors. */
export function guideSpot(town: Town, entry: GuideEntry): Point | null {
  const ref = guideAbout(town, entry)[0];
  if (ref?.kind === 'person') {
    const p = town.person(ref.id);
    return p && !p.inside ? p.position : null;
  }
  if (ref?.kind === 'monster') return town.creature(ref.id)?.position ?? null;
  return ref || !entry.about.length ? entry.at : null;
}
/** Where the camera looks for an entry; an entry that never had a place moves nothing. */
const placeOf = (town: Town, entry: GuideEntry): Point | null => (entry.at ? (guideSpot(town, entry) ?? entry.at) : null);
/** Takes the camera to `at` over a short ease; the player's next move cancels it. */
export function guideLook(app: Pick<GuideApp, 'guide' | 'camera' | 'context'>, at: Point): void {
  app.guide.glide = glideTo(app.camera, at, app.context.time());
}
/** Shows a card now: the camera eases to the place unless the player is busy or a party is beyond a gate. */
function present(app: GuideApp, entry: GuideEntry, now: number): boolean {
  const at = placeOf(app.town, entry);
  if (!at) return true;
  if (inView(app.camera, at, app.viewWidth, app.viewHeight)) return true;
  if (!guidePreferences().focus || app.town.realmActive() || guideBusy(app, now)) return false;
  guideLook(app, at);
  return true;
}
const holds = (app: GuideApp, ref: WorldObjectRef): boolean =>
  ref.kind === 'person'
    ? app.chosen.includes(ref.id)
    : ref.kind === 'building'
      ? app.selected === ref.id
      : ref.kind === 'dungeon'
        ? app.selectedDungeon === ref.id
        : app.selectedObjects.some((other) => other.kind === ref.kind && other.id === ref.id);
/** Lays the selection on what an entry is about, unless it already holds it. */
function pointAt(app: GuideApp, entry: GuideEntry): void {
  const about = guideAbout(app.town, entry),
    first = about[0];
  if (!first || holds(app, first)) return;
  rememberCrew(app, app.chosen);
  if (about.every((ref) => ref.kind === 'person')) app.selectPeople(about.map((ref) => ref.id));
  else app.selectObject(first);
}
/** The player holds residents they picked or commanded a moment ago: that selection is not taken from them. */
const handHeld = (app: GuideApp, now: number): boolean =>
  app.chosen.length > 0 &&
  (now - app.guide.pickedAt < guideRules.handSeconds || now - app.guide.orderedAt < guideRules.handSeconds);
/** The thing the card on screen introduces, to ring it in the world; null without a card or with a first deed's. */
export function guideSubject(app: Pick<GuideApp, 'guide' | 'town'>): WorldObjectRef | null {
  const card = app.guide.card;
  return card && !app.guide.logOpen ? (guideAbout(app.town, card.entry)[0] ?? null) : null;
}
/** The player asked to be shown: the camera goes there and the selection is laid on it. */
export function guideShow(app: GuideApp, entry: GuideEntry): void {
  const at = placeOf(app.town, entry);
  if (at) guideLook(app, at);
  pointAt(app, entry);
}
function fire(app: GuideApp, moment: GuideMoment, spot: GuideSpot, now: number): void {
  const s = app.guide,
    town = app.town;
  town.told.push(moment.key);
  const entry: GuideEntry = {
    key: moment.key,
    day: town.days + 1,
    at: spot.at ? { ...spot.at } : null,
    about: spot.about ?? [],
    detail: spot.detail ?? [],
    seen: !moment.card || s.logOpen,
  };
  s.log.push(entry);
  if (!moment.card) return;
  if (guidePreferences().cards) s.queue.push(entry);
  else if (!s.glide) present(app, entry, now);
}
/** Banners that already speak for the moment come first; the card waits behind them. */
const held = (app: GuideApp) =>
  !!app.combatHud.autoPause || app.combatHud.memorials.length > 0 || !!app.prayer || !!app.residentArrival || app.guide.logOpen || app.rosterOpen;

/** Once per frame, before the toast takes its notice: hear new moments, run the queue and the camera. */
export function guideFrame(app: GuideApp): void {
  const town = app.town;
  if (town.isTitleAutoplay()) return;
  const s = app.guide,
    now = app.context.time(),
    camera = app.camera;
  if (s.town !== town) attach(app);
  if (s.camera.x !== camera.x || s.camera.y !== camera.y || s.camera.zoom !== camera.zoom) {
    if (!Number.isNaN(s.camera.x)) s.cameraMovedAt = now;
    s.glide = null;
  }
  if (app.cues.some((sound) => sound.cue === Cue.Order)) s.orderedAt = now;
  const hand = app.chosen.join();
  if (hand !== s.hand) {
    s.hand = hand;
    s.pickedAt = now;
  }
  if (s.glide) {
    if (!stepGlide(camera, s.glide, now)) s.glide = null;
    app.hoveredWorldTarget = null;
    app.renderer.invalidatePresentation();
  }
  const told = new Set(town.told),
    scan = scanOf(app, told);
  for (const moment of guideMoments) {
    if (told.has(moment.key)) continue;
    const spot = moment.spot(scan);
    if (spot) fire(app, moment, spot, now);
  }
  settle(app, scan);
  // The wait the opening card speaks of is over.
  if (!town.awaiting) {
    if (s.card?.entry.key === 'opening') s.card = null;
    s.queue = s.queue.filter((entry) => entry.key !== 'opening');
  }
  if (s.card && s.drawnAt < s.frameAt) s.card.until += now - s.frameAt;
  if (s.card && now >= s.card.until) s.card = null;
  const next = !s.card && guidePreferences().cards && !held(app) ? s.queue.shift() : undefined;
  if (next) {
    next.seen = true;
    const looked = present(app, next, now);
    s.card = { entry: next, until: now + guideRules.cardSeconds, looked, edged: false };
    // The hand is left alone like the camera: only a free one is laid on the thing, and never beyond a gate.
    if (looked && !town.realmActive() && !guideBusy(app, now) && !handHeld(app, now)) {
      pointAt(app, next);
      s.hand = app.chosen.join();
    }
    s.drawnAt = now;
  }
  // The first of a burst shows at once; of the rest only the newest few wait for a card.
  if (s.queue.length > guideRules.queue) s.queue.splice(0, s.queue.length - guideRules.queue);
  s.frameAt = now;
  s.camera = { x: camera.x, y: camera.y, zoom: camera.zoom };
}
export function dismissGuideCard(app: Pick<GuideApp, 'guide'>): void {
  app.guide.card = null;
}
const unlockPrefix = 'unlock:';
/** The tool a card announces as new in the build menu, or null for an ordinary first-time moment. */
export function unlockOf(entry: GuideEntry): Tool | null {
  return entry.key.startsWith(unlockPrefix) ? Number(entry.key.slice(unlockPrefix.length)) : null;
}
/**
 * A building has just come into the build menu: it gets a card of its own, one at a time behind whatever is
 * already waiting. It is no record (not logged, not saved). False when cards are switched off.
 */
export function announceUnlock(app: Pick<GuideApp, 'guide' | 'town'>, tool: Tool): boolean {
  if (!guidePreferences().cards) return false;
  // The road quest opens with the camp and gives the drawing instruction.
  if (tool === Tool.Road) return true;
  const s = app.guide,
    key = unlockPrefix + tool;
  if (s.card?.entry.key !== key && !s.queue.some((entry) => entry.key === key))
    s.queue.push({ key, day: app.town.days + 1, at: null, about: [], detail: [], seen: true });
  return true;
}
export function toggleGuideLog(app: Pick<GuideApp, 'guide'>): void {
  const s = app.guide;
  s.logOpen = !s.logOpen;
  s.logPages = [0];
  // What the badge counted is read at once; the rest opens folded.
  s.logUnfolded = new Set(s.logOpen ? s.log.filter((entry) => !entry.seen) : []);
  if (s.logOpen) for (const entry of s.log) entry.seen = true;
}
const isGuideApp = (game: object): game is GuideApp => 'guide' in game && 'town' in game && 'context' in game;
/** F1 opens or closes the log; Escape closes it. False leaves the key to its usual meaning. */
export function guideHotkey(game: object, key: string): boolean {
  if (!isGuideApp(game) || game.town.isTitleAutoplay()) return false;
  if (key === 'f1') toggleGuideLog(game);
  else if (key === 'escape' && game.guide.logOpen) game.guide.logOpen = false;
  else return false;
  return true;
}
