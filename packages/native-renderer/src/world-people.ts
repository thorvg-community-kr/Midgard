import { isRanchHarvest, ranchWorkSeconds } from '../../engine/src/livestock';
// World agents, articulated action poses, combat feedback and footprints.
import { Town } from '../../engine/src/town';
import { Agent, AgentKind, type Traffic } from '../../engine/src/traffic';
import {
  point,
  sub,
  add,
  mul,
  distance,
  normalized,
  project,
  tileHalfWidth,
} from '../../engine/src/geometry';
import { f32 as f, clamp, lround } from '../../engine/src/numeric';
import { Activity, TreeWorkKind, type TreeWorkEvent } from '../../engine/src/person';
import { farmWorkPhase, fieldWork } from '../../engine/src/farm-work';
import { breedOf } from '../../engine/src/town-monsters';
import { animalSpec } from '../../engine/src/wildlife';
import { injuryOf, Injury } from '../../engine/src/person-look';
import { Product, Structure, structureSpec } from '../../engine/src/building-catalog';
import { Weather } from '../../engine/src/climate';
import { treePosition } from '../../engine/src/world-map';
import * as mining from '../../engine/src/mining';
import * as woodcutting from '../../engine/src/woodcutting';
import { harvestTiming, harvestDuration, harvestSwingPeriod, hammerTiming, roadCrewStep, workElapsed } from '../../engine/src/work-timing';
import { roadWorkHeading } from '../../engine/src/person-navigation';
import { combatItem, equippedItem, productItem, toolFor, workItem, type WorkKind } from '../../engine/src/equipment';
import { inArea } from '../../engine/src/realm-layout';
import { craftOrder, orderSeconds } from '../../engine/src/craft-orders';
import { ceremonySeconds } from '../../engine/src/town-devotion';
import { playing } from '../../engine/src/bard-phrases';
import { clearMarks, clearTargetPoint } from '../../engine/src/town-clearing';
import { drinkSeconds, mealSeconds } from '../../engine/src/resident-meals';
import { humanoidClips } from './humanoid-rig';
import { clipTurn } from './rig-clip';
import { poseArm } from './person-arm';
import { SceneNode, ShapeNode, TextNode, type Rgb } from './paint';
import { registerPick } from './world-pick-registry';
import { WorldRendererState } from './world-renderer-state';
import { standingRow, registerDepth, cullAround, standsInView, viewRect } from './world-depth';
import {
  agentSprite,
  personSprite,
  PersonParts,
  stridePose,
  strideBob,
  seatHead,
  layDown,
  monsterParts,
} from './world-sprites';
import { animalBody, animalSprite, poseAnimal } from './wildlife-sprites';
import { fallSeconds, poseFallenMonster, poseMonster } from './monster-figures';
import { CombatCue } from '../../engine/src/combat-events';
import { moodOf } from './person-portrait';
import { canIdleGesture, idleGesture, animateGesture, IdleGesture } from './idle-gesture';
import { expressionOf, poseFace } from './likeness-head';
import { line, opaque } from './vector-paint';
import { updateBuildingDamage } from './building-damage';
import {
  clearWorkProps,
  animateCraft,
  animateFoundry,
  animateFieldWork,
  animateProcessingWork,
  animateTrade,
  tradeOf,
} from './work-motion';
import {
  animateBenchCraft,
  animateClearing,
  animateRoadwork,
  animateStationWork,
  braceLoad,
  passLoad,
  transferSeconds,
} from './site-work-motion';
import { materialOf, showEquipment, poseBow } from './person-equipment';
import {
  animateAction,
  animateBrace,
  animateBrood,
  animateCast,
  animateGather,
  animateSip,
  animateTend,
  animateWork,
  strikePhase,
} from './action-motion';
import { altarArrivals, animatePrayer } from './devotion-effects';
import { releaseBeast } from './combat-effects';
import { monsterHeight, poseRank, windupOf } from './monster-rank-look';
const inSight = (s: WorldRendererState, p: { x: number; y: number }) => s.currentVisibility.sample(p) >= 119;
/** A smith holds a finished weapon up during the last part of its order. */
const craftLiftSeconds = 1.3;
const supplyActivities = new Set([
  Activity.Idle,
  Activity.Holding,
  Activity.FetchingMaterials,
  Activity.DeliveringMaterials,
  Activity.WaitingMaterials,
  Activity.Hauling,
  Activity.Building,
  Activity.Roadwork,
  Activity.Working,
  Activity.Felling,
  Activity.Mining,
]);
function finalHarvestContact(town: Town, person: number): TreeWorkEvent | undefined {
  const events = town.treeEvents();
  for (let i = events.length - 1; i >= 0; --i) {
    const event = events[i],
      age = town.clock() - event.at;
    if (
      event.person === person &&
      (event.kind === TreeWorkKind.Chop || event.kind === TreeWorkKind.Mine) &&
      age >= 0 &&
      age <= 0.12
    )
      return event;
  }
  return undefined;
}
// Keep the legacy traffic argument for reference callers; only real simulated actors are drawn.
export function moveAgents(
  s: WorldRendererState,
  town: Town,
  _traffic: Traffic,
  seconds: number,
  selected: readonly number[],
): void {
  const count = s.rows.length;
  const strikes = new Map<number, ReturnType<Town['hits']>[number]>();
  for (const hit of town.hits()) {
    const attacker = hit.attacker ?? (!hit.onPerson ? hit.person : -1);
    if (attacker >= 0) strikes.set(attacker, hit);
  }
  const view = viewRect(s);
  const arrivalTime = s.arrivalSeconds ?? seconds;
  const arrivals = s.sceneView ? undefined : altarArrivals(s, town, arrivalTime);
  for (const figure of s.figures.values()) figure.seen = false;
  for (const person of town.people()) {
    let figure = s.figures.get(person.id);
    const key = JSON.stringify([
      person.look,
      person.race,
      person.calling,
      person.lookRevision.toString(),
      injuryOf(person) === Injury.Bandaged,
    ]);
    if (!figure) {
      const parts = new PersonParts();
      figure = {
        paint: personSprite(person, parts),
        row: -1,
        seen: false,
        lookKey: key,
        parts,
        last: point(-1, -1),
        stride: 0,
        facing: 1,
        striding: false,
      };
      s.figures.set(person.id, figure);
    }
    figure.seen = true;
    if (figure.lookKey !== key) {
      if (figure.row >= 0) s.rows[figure.row].remove(figure.paint);
      figure.parts = new PersonParts();
      figure.paint = personSprite(person, figure.parts);
      figure.row = -1;
      figure.striding = false;
      figure.lookKey = key;
    }
    figure.arrival = arrivals?.get(person.id)?.pose(person, s, arrivalTime);
    const foot = figure.arrival?.foot ?? person.position,
      rising = figure.arrival?.rising,
      crossing = !rising && person.crossingDoorway(),
      baseline = crossing ? person.entrance : foot,
      row = standingRow(town, baseline, count);
    if (row !== figure.row) {
      if (figure.row >= 0) s.rows[figure.row].remove(figure.paint);
      s.rows[row].add(figure.paint);
      figure.row = row;
    }
    registerDepth(figure.paint, baseline, `person:${person.id}`);
    cullAround(figure.paint, foot);
    // Out of sight or off the screen: keep the place it stands, pose nothing, draw nothing.
    if (!s.sceneView && (!inSight(s, foot) || !standsInView(s, view, foot))) {
      const at = project(foot.x, foot.y);
      figure.paint.transform([figure.facing, 0, at.x, 0, 1, at.y, 0, 0, 1]);
      figure.paint.opacity(0);
      figure.last = { ...foot };
      figure.striding = false;
      figure.shown = seconds;
      continue;
    }
    const screen = project(foot.x, foot.y),
      strike = strikes.get(person.id),
      followingThrough = !!strike && town.clock() - strike.at < 0.25,
      fighting = person.activity === Activity.Fighting || followingThrough;

    let ahead = point();
    if (crossing)
      ahead = person.inside ? sub(person.threshold, person.entrance) : sub(person.entrance, person.threshold);
    else if (person.moving()) ahead = sub(person.path[0], person.position);
    else if (figure.last.x >= 0) ahead = sub(foot, figure.last);
    const outdoors = !s.sceneView && !rising && !person.inside && !crossing && person.downedAt < 0,
      working = outdoors && !person.moving(),
      ranchWork = working && !person.approachingOrder && isRanchHarvest(person.activity) ? ranchWorkSeconds(person.activity) : 0,
      clearing =
        working && !fighting && person.activity === Activity.Holding && person.clearing >= 0
          ? clearMarks(town).find((mark) => mark.serial === person.clearing)
          : undefined,
      workplace = person.activity === Activity.Working ? town.building(person.target) : null,
      buildSite = working && person.activity === Activity.Building ? town.building(person.target) : null,
      servingTime = person.activity === Activity.Drinking ? drinkSeconds : mealSeconds,
      sinceServed = town.clock() - (person.until - servingTime),
      dining =
        working &&
        !fighting &&
        (person.activity === Activity.Eating || person.activity === Activity.Drinking) &&
        sinceServed >= 0 &&
        sinceServed < servingTime;
    const transfer = person.transfer,
      transferAge = transfer ? town.clock() - transfer.at : -1,
      passing =
        outdoors &&
        !fighting &&
        !clearing &&
        transferAge >= 0 &&
        transferAge < transferSeconds &&
        supplyActivities.has(person.activity);
    if (clearing) {
      const at =
        clearing.kind === 'building'
          ? town.building(clearing.id)?.center
          : clearing.kind === 'field'
            ? clearTargetPoint(town, clearing)
            : person.goal;
      if (at) ahead = sub(at, person.position);
    } else if (working) {
      const place = buildSite ?? (dining && person.target >= 0 ? town.building(person.target) : workplace);
      if (place && !(place.kind === Structure.Farm && person.workField >= 0))
        ahead = sub(place.center, person.position);
    }
    const prayerSite = person.activity === Activity.Praying ? town.building(person.target) : null,
      praying = prayerSite?.kind === Structure.Shrine && !person.moving() && !crossing && !person.inside;
    if (praying) ahead = sub(prayerSite.center, person.position);
    // A helper turns to the one they kneel beside.
    const patient = person.activity === Activity.Tending ? town.person(person.target) : null;
    if (patient && !person.moving()) ahead = sub(patient.position, person.position);
    // A crafter, and anyone waiting a turn beside the station, faces it.
    const station =
      person.task === Activity.Crafting && (person.activity === Activity.Crafting || person.activity === Activity.Holding) && !person.moving() && !crossing
        ? town.building(person.refining ? person.target : person.craftWorkshop)
        : null;
    if (station) ahead = sub(station.center, person.position);
    // Whoever lays a road faces the way it grows. Once they stand at its front, the steps that keep them
    // there and the sidestep that makes room for a crew mate are not a turn.
    const front =
      outdoors && !fighting && person.activity === Activity.Roadwork ? town.roads().road(person.target) : null;
    figure.laying =
      !!front &&
      (!person.moving() ||
        (!!figure.laying &&
          person.path.length === 1 &&
          distance(person.position, person.path[0]) <= roadCrewStep));
    if (front && figure.laying) ahead = roadWorkHeading(front) ?? ahead;
    const chopping = working && person.activity === Activity.Felling && person.tree >= 0,
      miningNow = working && person.activity === Activity.Mining && person.tree >= 0;
    // The final hit changes the simulation to Collecting immediately. Preserve
    // its short grounded follow-through from the real event, not the new deadline.
    const workContact =
      !s.sceneView &&
      person.activity === Activity.Collecting &&
      !person.moving() &&
      !crossing &&
      !person.inside
        ? finalHarvestContact(town, person.id)
        : undefined;
    if (miningNow)
      ahead = sub(
        mining.position(person.tree % town.map().width(), Math.trunc(person.tree / town.map().width())),
        person.position,
      );
    if (chopping) {
      const x = person.tree % town.map().width(),
        y = Math.trunc(person.tree / town.map().width());
      if (town.map().inside(x, y) && town.map().at(x, y).trees)
        ahead = sub(treePosition(town.map(), x, y, town.map().at(x, y).trees - 1), person.position);
    }
    if (ranchWork) {
      const pen = town.building(person.taskSite);
      if (pen) ahead = sub(pen.center, person.position);
    }
    if (passing && transfer?.toward && !person.moving()) ahead = sub(transfer.toward, person.position);
    if (fighting && !person.moving()) {
      const foe =
        person.foe >= 0
          ? town.creatureTarget(person.foe)
          : person.attackPerson >= 0
            ? town.person(person.attackPerson)
            : null;
      if (foe) ahead = sub(foe.position, person.position);
      else if (strike) ahead = sub(strike.to, person.position);
    }
    // In-range spacing is not walking. Keep the strike facing its target, and
    // avoid mirroring for subpixel corrections around the target's centerline.
    const facingThreshold = fighting && !person.moving() ? 2 / tileHalfWidth : 0.0001;
    if (Math.abs(f(ahead.x - ahead.y)) > facingThreshold) figure.facing = f(ahead.x - ahead.y) < 0 ? -1 : 1;
    const step = figure.last.x >= 0 ? distance(figure.last, foot) : 0;
    figure.stride = f(figure.stride + f(Math.min(1, step) * f(5.5)));
    figure.last = { ...foot };
    const striding = !s.sceneView && !rising && (person.moving() || crossing || (!!figure.arrival && step > 0.005)),
      bob = striding ? strideBob(figure.stride) : 0,
      // A resting chest rises and settles; each person keeps their own rhythm.
      // It moves in eight steps a second: finer would redraw every idle figure on every frame.
      breath =
        striding || s.sceneView
          ? 0
          : f(Math.sin((Math.floor(seconds * 8) / 8) * 1.6 + person.id * 1.7) * 0.009),
      gatherDuration = ranchWork || (person.activity === Activity.Collecting
        ? person.carriedProduct === Product.Stone ? mining.collectSeconds : woodcutting.fallSeconds : 0),
      collecting = !s.sceneView && gatherDuration
        ? f(Math.sin(Math.PI * clamp(1 - (person.until - town.clock()) / gatherDuration, 0, 1))) : 0;
    figure.paint.transform([figure.facing, 0, screen.x, 0, 1, screen.y, 0, 0, 1]);
    // A blow makes the figure flinch and settle; nothing else squashes it.
    const elapsed = figure.shown === undefined ? 0 : clamp(seconds - figure.shown, 0, 0.1);
    let squish = figure.squish ?? 0,
      speed = figure.squishSpeed ?? 0;
    if (!s.sceneView && person.health < (figure.shownHealth ?? person.health)) speed -= 1.6;
    for (let i = 0; i < 2; ++i) {
      speed += (-260 * squish - 16 * speed) * (elapsed / 2);
      squish = clamp(squish + speed * (elapsed / 2), -0.12, 0.12);
    }
    figure.squish = s.sceneView ? 0 : squish;
    figure.squishSpeed = s.sceneView ? 0 : speed;
    figure.shown = seconds;
    figure.shownHealth = person.health;
    figure.parts.body?.transform([
      f(1 - figure.squish * 0.6),
      striding ? f(-0.03) : 0,
      0,
      0,
      f(1 + breath + figure.squish),
      bob,
      0,
      0,
      1,
    ]);
    const sway = s.sceneView
      ? 0
      : striding
        ? -(0.07 + 0.03 * Math.sin(2 * figure.stride - 1))
        : -0.012 * Math.sin(seconds * 1.1 + person.id);
    figure.parts.cape?.transform([1, f(sway), f(-sway * figure.parts.capeTop), 0, 1, 0, 0, 0, 1]);
    if (figure.parts.face && figure.parts.look) {
      // The face lives: it wears the mood, blinks on its own rhythm and glances aside now and then.
      const beat = (person.id * 0.618 + (person.look % 97) * 0.013) % 1,
        every = 3.1 + beat * 2.7,
        since = (seconds + beat * 9) % every,
        blink = s.sceneView || since > 0.14 ? 1 : Math.abs(since / 0.07 - 1),
        gaze = (seconds * 0.5 + beat * 20) % 9,
        glance = s.sceneView || striding || gaze > 1.3 ? 0 : (beat > 0.5 ? 1 : -1) * 0.035;
      poseFace(
        figure.parts.face,
        (figure.lying ?? 0) > 0.5
          ? { lids: 0, brow: -0.7, browShown: true }
          : expressionOf(figure.parts.look, moodOf(person)),
        blink,
        glance,
      );
    }
    figure.parts.shadow?.transform([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    figure.striding = striding;
    figure.paint.opacity(
      !s.sceneView && !inSight(s, foot) ? 0 : rising ? 255 : lround(f(255 * person.visibility())),
    );
    registerPick(figure.paint, {
      ref: { kind: 'person', id: person.id },
      body: figure.parts.body ? [figure.parts.body] : [],
      foot: { ...foot },
      ellipse: { rx: 6, ry: 2.6 },
      // Up to the health bar, or the bleed-out ring over a downed body.
      stand: { above: person.downedAt >= 0 ? 26 : 31, below: 2.6, half: 6 },
    });
    figure.parts.alert?.opacity(
      !person.stressRecovery && (person.stress > f(0.7) || person.food < f(0.15)) ? 255 : 0,
    );
    figure.parts.stressRecovery?.opacity(person.stressRecovery ? 255 : 0);
    figure.parts.affiliation?.opacity(person.faction > 0 ? 255 : 0);
    const hammering =
      working && (person.activity === Activity.Building || person.activity === Activity.Roadwork);
    const fittingFrame = buildSite && buildSite.progress >= 1 / 3 && buildSite.progress < 2 / 3;
    const farming = working && workplace?.kind === Structure.Farm && person.workField >= 0,
      watering = farming && farmWorkPhase(person, town.clock(), town.fields()) === 1,
      processing =
        working &&
        workplace &&
        workplace.productionProgress > 0 &&
        (workplace.kind === Structure.Sawmill || workplace.kind === Structure.Stoneworks),
      // A smith hammers at the forge; other workplaces keep the hands busy in their own way.
      forging =
        working &&
        !fighting &&
        (workplace?.kind === Structure.Weaponsmith || workplace?.kind === Structure.Armorer),
      trade =
        working && workplace && !fighting && !farming && !processing && !forging
          ? tradeOf(workplace.kind)
          : null;
    const order =
        working && !fighting && station && person.activity === Activity.Crafting && person.craftItem
          ? craftOrder(person.craftItem)
          : null,
      made = person.refining && order ? productItem(person.refining) : order && order.kind !== 'station' ? order.item : null,
      improving = order?.kind === 'station',
      orderDuration = order && made ? orderSeconds(order, null) : 0,
      atBench = station?.kind === Structure.Workbench,
      refining = made?.workshop === Structure.Foundry,
      craftHammer = made && !refining && made.visual !== 'basket' ? workItem(person, 'crafting') : null,
      // The smith inspects a finished weapon. At the workbench the hands stay on the stock until the order ends.
      finished = !atBench && made?.visual && made.visual !== 'basket' ? made : null,
      craftLift =
        finished
          ? clamp(
              (person.craftProgress - orderDuration) / Math.min(craftLiftSeconds, orderDuration * 0.35) + 1,
              0,
              1,
            )
          : 0;
    clearWorkProps(figure.parts);
    const workKind: WorkKind | undefined =
      chopping || workContact?.kind === TreeWorkKind.Chop
        ? 'woodcutting'
        : miningNow || workContact?.kind === TreeWorkKind.Mine
          ? 'mining'
          : hammering || (clearing && clearing.kind !== 'field')
            ? 'construction'
            : farming
              ? watering
                ? 'watering'
                : 'farming'
              : processing
                ? workplace.kind === Structure.Sawmill
                  ? 'sawing'
                  : 'crafting'
                : forging || improving
                  ? 'crafting'
                  : undefined;
    const jobTool =
        workKind === 'farming'
          ? toolFor(person, fieldWork(town, person))
          : workKind
            ? workItem(person, workKind)
            : null,
      hauling =
        striding &&
        !crossing &&
        person.carrying > 0 &&
        (person.activity === Activity.Hauling || person.activity === Activity.DeliveringMaterials);
    const casting =
        working && town.clock() < person.castUntil && person.castUntil > person.castAt ? person.cast : null,
      drilling =
        working && (person.activity === Activity.Training || workplace?.kind === Structure.TrainingYard),
      occupied = isRanchHarvest(person.activity) || !!workKind || !!order || !!clearing || dining || passing || hauling || praying,
      tending = person.activity === Activity.Tending,
      handsFree = !occupied && !trade && !tending && person.activity !== Activity.Collecting,
      // The walk to a gate is still in town. Only those already across it keep their weapons drawn.
      realmReady = handsFree && inArea(town.realmArea, person.position),
      weaponReady =
        outdoors && !tending && !passing && !praying && (fighting || !!casting || drilling || realmReady),
      weapon = weaponReady ? (fighting ? combatItem(person) : equippedItem(person, 'weapon')) : null,
      workTool = made ? (craftLift > 0 ? finished : craftHammer) : jobTool,
      item = passing || praying ? null : weaponReady ? weapon : workTool,
      tool = item?.visual === 'basket' ? null : (item?.visual ?? null),
      // A bard plays a phrase standing or strolling, whenever the hands are free.
      strumming =
        outdoors && handsFree && !weaponReady && !!figure.parts.luteHeld && playing(person, town.clock());
    showEquipment(figure.parts, tool, materialOf(item), weaponReady && (weapon?.hands ?? 1) === 1);
    stridePose(figure.parts, figure.stride, striding);
    if (!striding)
      animateGesture(
        figure.parts.arms,
        outdoors && handsFree && !weaponReady && canIdleGesture(person)
          ? idleGesture((person.look ^ Math.imul(person.id, 7919)) >>> 0, moodOf(person), seconds)
          : { kind: IdleGesture.None, phase: 0, mirrored: false },
      );
    figure.parts.lute?.opacity(weaponReady || occupied || strumming ? 0 : 255);
    figure.parts.luteHeld?.opacity(strumming ? 255 : 0);
    if (tool === 'bow') poseBow(figure.parts, 0);
    figure.parts.arrow?.opacity(0);
    if (!s.sceneView) {
      // A skill has its own pose for as long as its cast runs.
      if (casting)
        animateCast(
          figure.parts,
          casting,
          tool,
          (town.clock() - person.castAt) / (person.castUntil - person.castAt),
        );
      else if (fighting && !striding && person.ready > town.clock()) {
        // The cycle runs from the last blow's contact to the next one.
        const pause = person.swingAt >= 0 ? Math.max(0.2, person.ready - person.swingAt) : 1;
        animateAction(
          figure.parts,
          tool,
          person.swingAt >= 0
            ? town.clock() - person.swingAt + strikePhase * pause
            : town.clock() - person.ready + 1 + strikePhase,
          pause,
        );
      } else if (praying)
        animatePrayer(
          figure.parts,
          Math.max(0, ceremonySeconds - (person.until - town.clock())),
          ceremonySeconds,
        );
      else if (improving || fittingFrame || (buildSite?.built() && buildSite.health < 1))
        animateStationWork(figure.parts, tool, workElapsed(town.clock(), person.id));
      else if (refining)
        animateFoundry(
          figure.parts,
          made.product === Product.BoundFrostwood,
          workElapsed(town.clock(), person.id),
        );
      else if (made && (atBench || (station?.kind === Structure.Weaponsmith && craftLift === 0)))
        animateBenchCraft(
          figure.parts,
          made.visual === 'basket' ? 'wicker' : materialOf(made),
          craftHammer ? materialOf(craftHammer) : null,
          workElapsed(town.clock(), person.id),
          station.angle,
          station.kind === Structure.Weaponsmith,
        );
      else if (made)
        animateCraft(
          figure.parts,
          tool,
          craftHammer !== null,
          workElapsed(town.clock(), person.id),
          craftLift,
        );
      else if (clearing)
        animateClearing(figure.parts, clearing.kind, tool, workElapsed(town.clock(), person.id));
      else if (dining) animateSip(figure.parts, sinceServed, person.activity === Activity.Drinking);
      else if (passing && transfer) passLoad(figure.parts, transfer.taking, transferAge / transferSeconds);
      else if (hauling) braceLoad(figure.parts, figure.stride);
      else if (farming) animateFieldWork(figure.parts, watering, town.clock() + person.id * 0.31, tool);
      else if (processing)
        animateProcessingWork(
          figure.parts,
          workplace.kind === Structure.Sawmill,
          town.clock() + person.id * 0.31,
          !!tool,
        );
      else if (chopping || miningNow || workContact) {
        const duration = harvestDuration(person, miningNow || workContact?.kind === TreeWorkKind.Mine);
        animateWork(
          figure.parts,
          tool,
          workContact
            ? harvestTiming.impact + town.clock() - workContact.at
            : town.clock() - (person.until - duration),
          harvestSwingPeriod(duration),
          harvestTiming.impact,
        );
      } else if (hammering && person.activity === Activity.Roadwork)
        animateRoadwork(figure.parts, tool, workElapsed(town.clock(), person.id));
      else if (hammering || forging)
        animateWork(
          figure.parts,
          tool,
          workElapsed(town.clock(), person.id),
          hammerTiming.period,
          hammerTiming.impact,
        );
      // Drilling in the training yard: the same blows as a fight, unhurried, at the dummies.
      else if (drilling)
        animateAction(figure.parts, tool, (town.clock() + person.id * 0.4) / 1.5, 1);
      else if (trade) animateTrade(figure.parts, trade, town.clock() + person.id * 0.31);
      else if (person.activity === Activity.Tending) animateTend(figure.parts, town.clock() + person.id);
      // What the last blow brought down is stooped for and taken up.
      else if (collecting > 0) animateGather(figure.parts, collecting);
      else if (!striding && !person.inside && !crossing) {
        if (person.activity === Activity.Brooding) animateBrood(figure.parts, town.clock() + person.id);
        else if (person.activity === Activity.Guarding) {
          if (tool) animateBrace(figure.parts, tool, town.clock() + person.id);
          else animateTrade(figure.parts, 'watch', town.clock() + person.id);
        } else if (person.holding && tool) animateBrace(figure.parts, tool, town.clock() + person.id * 0.37);
      }
    }
    if (strumming) {
      // Only the arms and the head play, so the walk under them goes on.
      const clip = humanoidClips.play,
        frame = ((town.clock() - person.phraseAt) * 30) % clip.frames,
        turn = (bone: string) => clipTurn(clip, bone, frame);
      poseArm(figure.parts.arms[1], turn('arm.r.1'), turn('arm.r.2'), turn('hand.r'));
      poseArm(figure.parts.arms[0], turn('arm.l.1'), turn('arm.l.2'), turn('hand.l'));
      figure.parts.nod = turn('head');
    }
    const job =
        person.activity === Activity.Hauling && person.carrying === 0 ? town.building(person.job) : null,
      carried = job ? job.kind : Structure.Count,
      carrying = person.carrying > 0 && person.activity !== Activity.Collecting;
    // A loaded back bends the head forward a little.
    if (carrying && striding) figure.parts.nod = 0.06;
    figure.parts.logs?.opacity(carrying && [Product.Wood, Product.Frostwood].includes(person.carriedProduct) ? 255 : 0);
    figure.parts.stone?.opacity(carrying && [Product.Stone, Product.IronOre, Product.CinderOre].includes(person.carriedProduct) ? 255 : 0);
    figure.parts.planks?.opacity(carrying && person.carriedProduct === Product.Planks ? 255 : 0);
    figure.parts.cutStone?.opacity(carrying && person.carriedProduct === Product.CutStone ? 255 : 0);
    // A downed resident drops onto their back and lies there; revived, they get up as quickly.
    // So does anyone sleeping in the open, only more gently.
    const down = !s.sceneView && (person.downedAt ?? -1) >= 0,
      asleep =
        !s.sceneView &&
        person.activity === Activity.Sleeping &&
        !person.inside &&
        !person.moving() &&
        !crossing,
      flat = down || asleep,
      lying = clamp((figure.lying ?? (flat ? 1 : 0)) + (flat ? 1 : -1) * elapsed * (down ? 2.6 : 1.5), 0, 1);
    figure.lying = lying;
    if (lying > 0) {
      clearWorkProps(figure.parts);
      showEquipment(figure.parts, null);
      layDown(figure.parts, down ? lying * lying : lying * lying * (3 - 2 * lying));
    }
    // Every motion above has set the body; now the head takes its place on the neck.
    seatHead(figure.parts);
    figure.parts.sack?.opacity(
      (job && carried !== Structure.Lumberyard && carried !== Structure.Quarry) ||
        (carrying &&
          ![Product.Wood, Product.Frostwood, Product.Stone, Product.IronOre, Product.CinderOre, Product.Planks, Product.CutStone].includes(person.carriedProduct))
        ? 255
        : 0,
    );
  }
  for (const [id, figure] of s.figures) {
    if (figure.seen) continue;
    // The dead lie where they fell for a breath, then fade from the field.
    const record = town.fallen?.find((fallen) => fallen.id === id),
      age = record ? town.clock() - record.at : -1;
    if (age >= 0 && age < 2.4) {
      clearWorkProps(figure.parts);
      figure.lying = Math.max(figure.lying ?? 0, clamp(age / 0.4, 0, 1));
      showEquipment(figure.parts, null);
      layDown(figure.parts, figure.lying * figure.lying);
      seatHead(figure.parts);
      figure.paint.opacity(lround(f(255 * clamp((2.4 - age) / 0.9, 0, 1))));
      continue;
    }
    if (figure.row >= 0) s.rows[figure.row].remove(figure.paint);
    s.figures.delete(id);
  }
  for (const sprite of s.beasts.values()) sprite.seen = false;
  // A horde is posed on fewer frames a second, so its size never sets the frame rate.
  const horde = town.monsters().length,
    crowdHold = horde > 90 ? 3 : horde > 40 ? 2 : 1;
  for (const group of [town.monsters(), town.wildlife()])
    for (const beast of group) {
      if (beast.insideLair) continue;
      let sprite = s.beasts.get(beast.id);
      if (!sprite) {
        const look = new Agent(beast.id, AgentKind.Monster);
        sprite = {
          paint:
            beast.animal !== null && beast.animal !== undefined
              ? animalSprite(beast.animal)
              : agentSprite(look, town.map().dungeons()[beast.lair].kind, beast.rank),
          row: -1,
          seen: false,
        };
        s.beasts.set(beast.id, sprite);
      }
      sprite.seen = true;
      registerDepth(sprite.paint, beast.position, `beast:${beast.id}`);
      const row = standingRow(town, beast.position, count);
      if (row !== sprite.row) {
        if (sprite.row >= 0) s.rows[sprite.row].remove(sprite.paint);
        s.rows[row].add(sprite.paint);
        sprite.row = row;
      }
      const screen = project(beast.position.x, beast.position.y),
        rig = monsterParts(sprite.paint);
      if (!s.sceneView && !inSight(s, beast.position)) {
        // Out of sight: it keeps its place for when it steps into view and costs no pose.
        sprite.paint.translate(screen.x, screen.y);
        sprite.paint.opacity(0);
        if (rig) rig.last = { ...beast.position };
        continue;
      }
      let facing = rig?.facing ?? (sprite.paint.matrix[0] < 0 ? -1 : 1);
      const moved = rig && rig.last.x >= 0 ? sub(beast.position, rig.last) : point(),
        walking = beast.path.length > 0 || Math.hypot(moved.x, moved.y) > 0.0001;
      let ahead = beast.path.length ? sub(beast.path[0], beast.position) : moved;
      let facingThreshold = 0.0001;
      if (rig) {
        let blow = -1;
        rig.body.transform([1, 0, 0, 0, 1, 0, 0, 0, 1]);
        const period = breedOf(town.map().dungeons()[beast.lair].kind).pause;
        // The engine stamps each blow or spit; the cycle runs from that contact to the next.
        if (!s.sceneView && beast.swingAt >= 0 && town.clock() - beast.swingAt < period) {
          blow = (town.clock() - beast.swingAt) / period;
          if (beast.swingHeading) {
            ahead = beast.swingHeading;
            facingThreshold = 2 / tileHalfWidth;
          }
        } else if (!walking && !s.sceneView) {
          const hitAt = beast.ready - period;
          // A ready timestamp can also schedule roaming. Require its actual damage event.
          const hit = town
            .hits()
            .find(
              (hit) =>
                hit.onPerson && Math.abs(hit.at - hitAt) < 0.002 && distance(hit.from, beast.position) < 0.03,
            );
          if (hit && town.clock() >= hit.at && town.clock() < beast.ready) {
            ahead = sub(hit.to, beast.position);
            blow = (town.clock() - hit.at) / period;
          }
        }
        poseMonster(rig.body, {
          walking,
          moved: Math.hypot(moved.x, moved.y),
          blow,
          windup: s.sceneView ? null : windupOf(town, beast),
          emerged: s.sceneView || beast.bornAt < 0 ? -1 : town.clock() - beast.bornAt,
          clock: town.clock(),
          hold: crowdHold,
        });
        rig.last = { ...beast.position };
      }
      if (Math.abs(ahead.x - ahead.y) > facingThreshold) facing = ahead.x - ahead.y < 0 ? -1 : 1;
      if (rig) rig.facing = facing;
      // A sleeping animal breathes from the ground up in its lying pose.
      const asleep = town.animalAsleep(beast),
        lying = asleep ? f(1 + 0.03 * Math.sin(town.clock() * 1.6 + beast.id)) : 1;
      poseAnimal(sprite.paint, asleep, walking, town.clock(), beast.id, facing);
      // Rank size, a blow's recoil and a wind-up's rear, over the pose above.
      const rank = s.sceneView
        ? { sx: 1, sy: 1, dx: 0, dy: 0 }
        : poseRank(town, beast, sprite.paint, rig?.body);
      sprite.paint.transform([
        facing * rank.sx,
        0,
        screen.x + rank.dx,
        0,
        lying * rank.sy,
        screen.y + rank.dy,
        0,
        0,
        1,
      ]);
      sprite.paint.opacity(inSight(s, beast.position) ? 255 : 0);
      registerPick(sprite.paint, {
        ref: { kind: beast.animal == null ? 'monster' : 'animal', id: beast.id },
        body: rig ? [rig.body] : animalBody(sprite.paint),
        foot: { ...beast.position },
        ellipse: { rx: (beast.giant() ? 14 : 9) * rank.sx, ry: (beast.giant() ? 6 : 3.5) * rank.sy },
        stand: {
          above: beast.animal == null ? monsterHeight(town, beast, s) + 8 : animalSpec(beast.animal).height,
          below: beast.giant() ? 6 : 3.5,
          half: beast.giant() ? 14 : 9,
        },
      });
    }
  for (const [id, sprite] of s.beasts) {
    if (sprite.seen) continue;
    // A slain monster crumples where it stood; a guardian breaks apart instead. Either way the body is
    // kept in its row until it is done.
    if (!fellMonster(s, town, id, sprite) && !releaseBeast(s, town, id, sprite) && sprite.row >= 0)
      s.rows[sprite.row].remove(sprite.paint);
    s.beasts.delete(id);
  }
  poseFallen(s, town);
  if (arrivals) for (const arrival of arrivals.values()) arrival.update(s, arrivalTime);
}
interface FallenBeast {
  paint: SceneNode;
  body: SceneNode;
  row: number;
  at: number;
}
const fallen = new WeakMap<WorldRendererState, FallenBeast[]>();
/** Keeps a slain monster's sprite to play its fall; false when it simply left or does not fall. */
function fellMonster(
  s: WorldRendererState,
  town: Town,
  id: number,
  sprite: { paint: SceneNode; row: number },
): boolean {
  const rig = monsterParts(sprite.paint);
  if (s.sceneView || !rig || sprite.row < 0 || !sprite.paint.alpha) return false;
  const now = town.clock(),
    kill = town.combatEvents().find((e) => e.cue === CombatCue.Kill && e.creature === id && now - e.at < 1);
  if (!kill || !poseFallenMonster(rig.body, 0)) return false;
  let list = fallen.get(s);
  if (!list) fallen.set(s, (list = []));
  list.push({ paint: sprite.paint, body: rig.body, row: sprite.row, at: kill.at });
  return true;
}
/** Plays every kept fall, fades the body out as it settles and lets it go. */
function poseFallen(s: WorldRendererState, town: Town): void {
  const list = fallen.get(s);
  if (!list?.length) return;
  const now = town.clock();
  fallen.set(
    s,
    list.filter((beast) => {
      const age = now - beast.at;
      if (age >= 0 && poseFallenMonster(beast.body, age)) {
        beast.paint.opacity(lround(f(255 * clamp((fallSeconds - age) / 0.2, 0, 1))));
        return true;
      }
      s.rows[beast.row]?.remove(beast.paint);
      return false;
    }),
  );
}
export function markDamage(s: WorldRendererState, town: Town): void {
  updateBuildingDamage(s, town);
  if (!s.damageBack) {
    s.damageBack = new ShapeNode();
    s.damageLeft = new ShapeNode();
    s.combat.add(s.damageBack).add(s.damageLeft);
  }
  s.damageBack.reset();
  s.damageLeft!.reset();
  for (const item of town.buildings()) {
    if (!item.built() || item.health >= 1 || !inSight(s, item.center)) continue;
    const top = project(item.center.x, item.center.y),
      width = f(22 + f(8 * structureSpec(item.kind).size)),
      y = f(f(top.y - 34) - f(10 * structureSpec(item.kind).size));
    s.damageBack.appendRect(f(f(top.x - f(width / 2)) - 1), f(y - 1), f(width + 2), 5, f(1.5), f(1.5));
    s.damageLeft!.appendRect(f(top.x - f(width / 2)), y, f(width * Math.max(0, item.health)), 3, 1, 1);
  }
  s.damageBack.fill(34, 28, 36, 215);
  s.damageLeft!.fill(191, 91, 50);
}
/** Legacy hit burst, no longer drawn by the world renderer (see combat-presentation.ts); kept for older tests. */
export function tread(s: WorldRendererState, town: Town, seconds: number): void {
  const sky = town.climate(),
    lasting = sky.weather === Weather.Snow ? 40 : 240;
  if (sky.snow < f(0.15)) s.footprints = [];
  s.footprints = s.footprints.filter((print) => seconds - print.made <= lasting);
  let changed = false;
  for (const p of town.people()) {
    const last = s.lastStep.get(p.id) ?? point();
    if (p.visibility() <= 0 || sky.snow < f(0.2)) {
      s.lastStep.set(p.id, { ...p.position });
      continue;
    }
    if (distance(last, p.position) < f(0.28)) continue;
    const along = normalized(sub(p.position, last));
    s.leftFoot = !s.leftFoot;
    const side = point(f(-along.y * f(0.06)), f(along.x * f(0.06)));
    s.footprints.push({ at: add(p.position, s.leftFoot ? side : mul(side, -1)), made: seconds });
    s.lastStep.set(p.id, { ...p.position });
    changed = true;
  }
  if (s.footprints.length > 900) s.footprints.splice(0, s.footprints.length - 900);
  if (!changed && seconds - s.printsAt < 1) return;
  s.printsAt = seconds;
  s.prints.remove();
  if (!s.footprints.length) return;
  const marks = new ShapeNode();
  for (const print of s.footprints) marks.appendCircle(print.at.x, print.at.y, f(0.045), f(0.045));
  marks.fill(96, 106, 124, 150);
  s.prints.add(marks);
}
