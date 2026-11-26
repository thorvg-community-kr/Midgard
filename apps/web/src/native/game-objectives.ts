import { translate } from '../../../../packages/localization/src/index';
import { Rect, Align, ButtonStyle, EventType, board, button, meter, slab } from '../../../../packages/native-ui/src';
import { lerpFloat } from '../../../../packages/native-ui/src/numeric';
import {
  settlementGoals,
  goalComplete,
  goalProgress,
  currentGoal,
  goalBranchName,
  GoalBranch,
  GoalKind,
  unsourcedMaterial,
} from '../../../../packages/engine/src/settlement-progression';
import { Tool, Order } from '../../../../packages/engine/src/game-tools';
import { compactViewport } from './mobile-layout';
import { f32, clamp } from '../../../../packages/engine/src/numeric';
import { describe, Product, Structure } from '../../../../packages/engine/src/building-catalog';
import {
  constructionProducts,
  resourceAmount,
  resourceBundle,
} from '../../../../packages/engine/src/construction-materials';
import type { Building } from '../../../../packages/engine/src/town-models';
import { sealProgress } from '../../../../packages/engine/src/gate-seals';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';
import type { GameHudApp } from './game-hud-contract';
import { questAction, boonTip, buildingTool, lockedLine } from './game-progress-hud';
import { showNotice } from './notice-toast';
import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';
import { hudGlyph } from './hud-glyphs';
import { craftBars } from './craft-station-hud';
import { orderRail } from './unit-orders-card';
/** Seconds the "Quest complete" ribbon covers the panel's head, and how long the next quest is marked as new. */
export const questRules = { ribbon: 2.6, fresh: 8 };
export function objectives(this: GameHudApp, width: number, height: number, top: number): void {
  // Work at a crafting station shows over it in the world.
  craftBars(this, width, height);
  const compact = this.touchMode && compactViewport(width, height);
  if (compact && (this.tool !== Tool.Select || this.pending !== Order.None)) return;
  const goals = settlementGoals();
  let completed = 0;
  for (const goal of goals) if (goalComplete(this.town, goal)) ++completed;
  // The founding chain is ordered; afterwards the player picks which branch to follow.
  const branches = [GoalBranch.Trade, GoalBranch.Arms, GoalBranch.Faith, GoalBranch.Saga],
    core = currentGoal(this.town, GoalBranch.Core),
    open = branches.filter((branch) => currentGoal(this.town, branch) >= 0);
  if (core < 0 && open.length && !open.includes(this.questBranch)) this.questBranch = open[0];
  const picked = core >= 0 ? core : currentGoal(this.town, this.questBranch),
    current = picked < 0 ? goals.length : picked,
    seals = sealProgress(this.town);
  const c = this.context,
    t = this.theme,
    now = c.time();
  // A quest fulfilled is said three ways at once: a ribbon over the panel, a sound, and a line in the notice feed.
  if (this.questsInitialized && completed > this.questsSeen) {
    this.questPulseAt = now;
    const before = goals[this.questShown];
    this.questDone = before && goalComplete(this.town, before) ? before.title : '';
    if (this.questDone) showNotice(this, `Quest complete: ${this.questDone}`, now);
    if (this.cues.length < 32) this.cues.push(new Sound(Cue.Complete, 0.55, 0));
  }
  if (current !== this.questShown) {
    if (this.questsInitialized) this.questNewAt = now;
    this.questShown = current;
  }
  this.questsInitialized = true;
  this.questsSeen = completed;
  const celebrating = !!this.questDone && this.questPulseAt >= 0 && now - this.questPulseAt < questRules.ribbon,
    // The quest that follows is marked as new for a while, so the change is not missed.
    fresh = !celebrating && this.questNewAt >= 0 && now - this.questNewAt < questRules.fresh,
    pulse = fresh ? (this.reducedMotion() ? 1 : f32(0.5 + 0.5 * Math.sin((now - this.questNewAt) * 5))) : 0;
  this.questsAnimating = celebrating || (fresh && !this.reducedMotion());
  if (this.questsAnimating) c.requestAnimationFrame();
  else if (fresh) c.requestFrameAt(this.questNewAt + questRules.fresh);
  const goal = goals[current],
    measured = goal ? goalProgress(this.town, goal) : null,
    missingTool = goal?.kind === GoalKind.Building && !measured?.label ? buildingTool(goal.building) : undefined,
    locked = missingTool === undefined ? '' : lockedLine(this.town, missingTool),
    unusedHintHeight = goal?.description ? 0 : 35,
    unusedStatusHeight = measured && !measured.label && !locked ? 32 : 0,
    collapsed = compact ? !this.mobileQuestsExpanded : this.objectivesCollapsed,
    header = this.touchMode ? 44 : 38,
    // Opened on a small touch screen it keeps left of the order rail.
    rail = compact ? orderRail(this, width, height) : null,
    w = Math.min(compact && collapsed ? 164 : 292, f32(width - (compact ? 76 : 24)), rail && !rail.beside ? f32(rail.bounds.x - 20) : Infinity),
    y = Math.min(top, f32(height - 60)),
    branchShift = this.touchMode && core < 0 ? 26 : 0,
    preferred = 210 + branchShift - unusedHintHeight - unusedStatusHeight,
    expanded = compact
      ? Math.min(preferred, height - y - 12)
      : clamp(f32(f32(this.dockBounds.y - y) - 24), 38, preferred),
    reveal = c.animate('quests/reveal', collapsed ? 0 : 1, 0.18),
    h = lerpFloat(header, Math.max(header, expanded), reveal),
    bounds = new Rect(compact ? 12 : f32(f32(width - 12) - w), y, w, h),
    left = f32(bounds.x + 14);
  c.control('objectives-panel', bounds, undefined, true, false);
  let border = t.border;
  if (celebrating) border = t.accent;
  else if (fresh) border = { ...t.accent, a: Math.trunc(f32(110 + f32(145 * pulse))) };
  board(c, bounds, { trim: border, trimWidth: celebrating || fresh ? 2 : 1, header: h > header + 8 ? 38 : 0 });
  button(
    c,
    'objectives-toggle',
    this.touchMode
      ? new Rect(bounds.x, y, w, header)
      : new Rect(f32(f32(bounds.x + w) - 38), f32(y + 6), 26, 26),
    this.touchMode ? '' : collapsed ? '+' : '-',
    () => {
      if (compact) {
        this.mobileQuestsExpanded = !this.mobileQuestsExpanded;
        if (height < 500 && this.mobileQuestsExpanded) this.timeExpanded = false;
      }
      else this.objectivesCollapsed = !this.objectivesCollapsed;
    },
    ButtonStyle.Quiet,
  );
  const folded = collapsed && !compact && h < header + 8;
  hudGlyph(
    c,
    'quest',
    f32(bounds.x + 22),
    f32(y + header / 2),
    fresh ? { ...t.accent, a: Math.trunc(f32(150 + 105 * pulse)) } : t.accent,
    0.9,
    t.surface,
  );
  if (celebrating) {
    // The ribbon lies over the head of the panel and names what was done.
    const ribbon = new Rect(f32(bounds.x + 36), f32(y + 6), f32(w - 36 - 44), f32(header - 12)),
      said = `Quest complete: ${this.questDone}`;
    slab(c, ribbon, t.accent, { lip: 2 });
    c.text(
      new Rect(f32(ribbon.x + 8), ribbon.y, f32(ribbon.w - 16), f32(ribbon.h - 2)),
      c.elideText(said, f32(ribbon.w - 16), 12, true),
      t.accentText,
      12,
      true,
    );
  } else if (folded && goal && measured) {
    // Folded away, the panel still says what to do and how far along it is.
    const count = measured.label && measured.need > 1 ? `${Math.min(measured.need, Math.floor(measured.have))} / ${measured.need}` : '',
      countW = count ? f32(c.textWidth(count, 10) + 8) : 0,
      room = f32(w - 38 - 44 - countW);
    c.text(
      new Rect(f32(bounds.x + 38), f32(y + 3), room, 20),
      c.elideText(goal.title, room, 12, true),
      fresh ? t.accent : t.text,
      12,
      true,
    );
    if (count)
      c.text(new Rect(f32(bounds.x + w - 44 - countW), f32(y + 4), countW, 18), count, t.muted, 10, false, Align.End);
    if (measured.label) meter(c, new Rect(f32(bounds.x + 38), f32(y + 26), f32(w - 38 - 46), 4), measured.have / Math.max(1, measured.need), t.accent);
  } else
    c.text(
      new Rect(f32(bounds.x + 38), f32(y + 7), f32(w - (compact && collapsed ? 50 : 196)), 24),
      compact && collapsed ? `Quests ${completed}/${goals.length}` : goal || !folded ? 'Quests' : 'Quests complete',
      t.text,
      13,
      true,
    );
  if (!celebrating && !folded && (!compact || !collapsed)) {
    const counter = new Rect(f32(f32(bounds.x + w) - 172), f32(y + 9), 128, 20);
    c.text(
      counter,
      (seals.total ? `Gates ${seals.sealed}/${seals.total}   ` : '') + completed + ' / ' + goals.length,
      t.muted,
      10,
      false,
      Align.End,
    );
    // Sealed worlds' boons are listed on hover or focus of the counter.
    if (seals.sealed && !this.touchMode) {
      const state = c.control('quest-boons', counter, undefined, true, true);
      if (state.hovered || state.focused) boonTip(this, counter);
    }
  }
  if (h < 76) return;
  c.clip(bounds.inset(6), () => {
    if (!goal || !measured) {
      c.text(new Rect(left, f32(y + 49), f32(w - 28), 25), 'Settlement saga complete', t.success, 14, true);
      return;
    }
    if (core >= 0 && fresh) c.text(new Rect(left, f32(y + 42), f32(w - 28), 16), 'New quest', t.accent, 9, true);
    if (core < 0) {
      const tab = f32(f32(w - 28) / branches.length);
      branches.forEach((branch, index) => {
        const done = !open.includes(branch),
          area = new Rect(f32(left + f32(tab * index)), f32(y + (this.touchMode ? 44 : 38)), tab, this.touchMode ? 44 : 20);
        c.control('quest-branch/' + branch, area, (event) => {
          if (event.type === EventType.Activate && !done) this.questBranch = branch;
        });
        c.text(
          area,
          goalBranchName(branch),
          done ? t.success : branch === this.questBranch ? t.accent : t.muted,
          10,
          branch === this.questBranch,
          Align.Center,
        );
      });
    }
    const bodyY = y + branchShift;
    c.text(new Rect(left, f32(bodyY + 61), f32(w - 28), 23), goal.title, t.text, 14, true);
    let words = '',
      row = '',
      descriptionY = f32(bodyY + 88);
    const flush = () => {
      const next = row ? row + ' ' + words : words;
      if (row && c.textWidth(next, 10) > f32(w - 28)) {
        if (descriptionY < f32(bodyY + 117))
          c.text(new Rect(left, descriptionY, f32(w - 28), 16), row, t.muted, 10);
        descriptionY = f32(descriptionY + 15);
        row = words;
      } else row = next;
      words = '';
    };
    for (const character of translate(goal.description)) {
      if (character === ' ') flush();
      else words = words.concat(character);
    }
    flush();
    if (row && descriptionY < f32(bodyY + 117))
      c.text(new Rect(left, descriptionY, f32(w - 28), 16), row, t.muted, 10);
    const action = questAction(this, goal);
    const progress = f32(measured.have / Math.max(1, measured.need));
    let status = measured.label,
      warn = false,
      waiting = false,
      site: Building | null = null;
    if (goal.kind === GoalKind.Building && measured.have < measured.need) {
      for (const b of this.town.buildings())
        if (b.kind === goal.building && !b.built() && isPlayerBuilding(b)) {
          site = b;
          break;
        }
      if (site) {
        status = `${measured.label} · ${Math.trunc(f32(progress * 100))}%`;
        if (site.materials.limit() < 1) {
          status = 'Materials: ';
          let first = true;
          for (const product of constructionProducts)
            if (resourceAmount(site.materials.required, product)) {
              if (!first) status = status.concat(', ');
              first = false;
              status = status.concat(
                resourceAmount(site.materials.delivered, product) +
                  '/' +
                  describe(resourceBundle(product, resourceAmount(site.materials.required, product))),
              );
            }
          // Builders give up quietly when nothing is in sight; say what is missing and how to get it.
          const lacking = unsourcedMaterial(this.town, site);
          if (lacking !== null) {
            warn = true;
            status = lacking === Product.Stone ? 'No rock in sight' : 'No trees in sight';
          }
        }
      }
      // A building still locked is not in the build menu: the panel says what it waits for instead.
      if (locked) {
        status = locked;
        waiting = true;
      }
    } else if (goal.kind === GoalKind.Population && measured.have < measured.need) {
      const altar = this.town.buildings().find((b) => b.kind === Structure.Shrine && b.built() && isPlayerBuilding(b));
      const reason = altar ? this.town.altarStatus(altar.id).reason : '';
      if (reason) status = `${measured.label} · ${reason}`;
    }
    if (status) {
      c.text(
        new Rect(left, f32(bodyY + 127 - unusedHintHeight), f32(w - 28), 18),
        c.elideText(status, f32(w - 28), 10),
        warn ? t.danger : waiting ? t.accent : t.text,
        10,
      );
      const displayed = c.animate('quests/progress/' + current, clamp(progress, 0, 1), 0.2);
      meter(c, new Rect(left, f32(bodyY + 149 - unusedHintHeight), f32(w - 28), 7), displayed, t.accent);
    }
    if (expanded < preferred - 10 || !action) return;
    button(
      c,
      'quest-action/' + current,
      new Rect(left, f32(bodyY + (this.touchMode ? 160 : 171) - unusedHintHeight - unusedStatusHeight), f32(w - 28), this.touchMode ? 44 : 29),
      action.label,
      action.run,
      ButtonStyle.Primary,
      reveal > f32(0.98),
    );
  });
}
