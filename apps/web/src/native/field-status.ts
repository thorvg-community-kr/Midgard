import { CropStage, cropStage, cropWater } from '../../../../packages/engine/src/farm-work';
import { Season, type Field } from '../../../../packages/engine/src/town-models';
import type { Town } from '../../../../packages/engine/src/town';

const stageNames = ['Tilling', 'Sowing seeds', 'Watering', 'Tending crops', 'Harvesting'];

export function fieldStatus(town: Town, field: Field): string {
  if (town.calendar().season === Season.Winter) return 'Fallow until spring';
  const stage = cropStage(field);
  if (field.cropProgress === CropStage.Watering && town.stock(field.village).water < cropWater(field))
    return `Watering · Needs ${cropWater(field)} water`;
  return `${stageNames[stage]} · ${Math.floor((field.cropProgress - stage) * 100)}%`;
}
