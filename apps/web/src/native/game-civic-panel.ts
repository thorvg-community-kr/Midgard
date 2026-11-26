import { Rect, ButtonStyle, button, type Color } from '../../../../packages/native-ui/src';
import { Structure, structureSpec } from '../../../../packages/engine/src/building-catalog';
import { Activity, callingName } from '../../../../packages/engine/src/person';
import {
  isPlayerResident,
  isPlayerBuilding,
  canControl,
  buildingControlReason,
} from '../../../../packages/engine/src/faction';
import { personPortrait, moodOf } from '../../../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import type { Building } from '../../../../packages/engine/src/town-models';
import type { GameHudApp } from './game-hud-contract';
import { hudPaint } from './hud-paint';
import { altarInspector } from './game-prayer';

export function civicInspector(this: GameHudApp, building: Building, panel: Rect, draw: boolean): number {
  const c = this.context,
    t = this.theme;
  if (building.kind === Structure.Shrine) return altarInspector.call(this, building, panel, draw);
  const compact = this.viewHeight < 560;
  const h = compact ? 235 : 318;
  const village = this.town.settlementOf(building),
    inRealm = this.town.inRealm(building.center);
  const residents = this.town.people().filter(p => isPlayerResident(p) && this.town.settlementOf(p) === village &&
    this.town.inRealm(p.position) === inRealm);
  if (!residents.some((p) => p.id === this.inspectorPerson)) this.inspectorPerson = residents[0]?.id ?? -1;
  const selected = residents.findIndex((p) => p.id === this.inspectorPerson);
  const person = residents[selected];
  if (!draw) return h;
  const x = panel.x + 12,
    w = panel.w - 24,
    y = panel.y;
  const line = (at: number, text: string, color: Color = t.text, size = 12, bold = false) =>
    c.text(new Rect(x, y + at, w, 20), c.elideText(text, w, size, bold), color, size, bold);
  line(9, structureSpec(building.kind).name, t.text, 17, true);
  line(
    compact ? 30 : 34,
    `${building.trainingCount} residents trained`,
    t.muted,
    compact ? 10 : 12,
  );
  if (!isPlayerBuilding(building)) {
    line(64, `Neutral settlement #${this.town.building(building.id)!.faction}`, t.accent, 13, true);
    line(90, buildingControlReason(building), t.muted);
    return h;
  }
  const top = compact ? 52 : 66;
  const size = compact ? 44 : 60;
  if (person) {
    c.paint(
      JSON.stringify([
        'civic-portrait',
        person.id,
        person.look,
        person.race,
        String(person.lookRevision),
        person.calling,
        x,
        y + top,
        size,
      ]),
      () => {
        const paint = hudPaint(
          c,
          personPortrait(
            person,
            moodOf(person),
            size,
            size,
            portraitBackdrop(this.town.map(), person.position, this.town.climate()),
          ),
        );
        paint.translate(x, y + top);
        return paint;
      },
    );
    const navX = x + size + 8,
      nameW = w - size - 72;
    button(
      c,
      'civic-person-prev',
      new Rect(navX, y + top, 26, 26),
      '<',
      () => {
        this.inspectorPerson = residents[(selected + residents.length - 1) % residents.length].id;
      },
      ButtonStyle.Quiet,
      residents.length > 1,
    );
    c.text(
      new Rect(navX + 28, y + top, nameW, 26),
      c.elideText(person.name, nameW, 13, true),
      t.text,
      13,
      true,
    );
    button(
      c,
      'civic-person-next',
      new Rect(x + w - 26, y + top, 26, 26),
      '>',
      () => {
        this.inspectorPerson = residents[(selected + 1) % residents.length].id;
      },
      ButtonStyle.Quiet,
      residents.length > 1,
    );
    c.text(
      new Rect(navX, y + top + 26, w - size - 8, 18),
      `${callingName(person.calling)} · Level ${person.level} · ${selected + 1} / ${residents.length}`,
      t.muted,
      compact ? 10 : 11,
    );
  } else line(top, 'No residents are available.', t.muted);
  const options = person ? this.town.guildTrainingOptions(person.id, building.id) : [];
  const option = options.find((option) => option.calling === this.inspectorCalling) ?? options[0];
  if (option) this.inspectorCalling = option.calling;
  const tabsY = compact ? 103 : 139,
    tabW = (w - 8) / 3;
  for (let i = 0; i < options.length; ++i) {
    const choice = options[i];
    button(
      c,
      `guild-class-${choice.calling}`,
      new Rect(x + (i % 3) * (tabW + 4), y + tabsY + Math.floor(i / 3) * 30, tabW, 26),
      choice.name,
      () => {
        this.inspectorCalling = choice.calling;
      },
      choice === option ? ButtonStyle.Primary : ButtonStyle.Default,
      true,
    );
  }
  if (person && option) {
    line(compact ? 162 : 202, option.description, t.muted, 11);
    const training = person.task === Activity.Training && person.taskSite === building.id;
    const reason = option.reason;
    line(
      compact ? 179 : 251,
      training
        ? `New calling · ${callingName(person.trainingCalling)}`
        : reason,
      reason && person.calling !== option.calling && !training ? t.danger : t.muted,
      compact ? 9 : 11,
    );
    button(
      c,
      'guild-train',
      new Rect(x, y + h - 39, w, 28),
      training ? 'Changing calling' : `Become a ${option.name}`,
      () => {
        if (
          canControl(this.town.person(person.id)) &&
          this.town.orderTrainAtGuild(person.id, building.id, option.calling)
        )
          this.status = 'Training ordered';
        else this.status = this.town.trainingReason(person.id, building.id, option.calling);
      },
      ButtonStyle.Primary,
      !training && !reason && canControl(person),
    );
  }
  return h;
}
