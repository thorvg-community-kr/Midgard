import { BodyType } from './person-appearance';
export const designedWorldSeed = 5;
// After Voluspa 17-18: Odin and his brothers found two trees on the shore (an ash and an elm), without breath
// or fate, and gave them life. The statue on the founding shore and the altar are Odin's. What the player
// reads says only "two trees".
export interface Founder {
  name: string;
  past: string;
  /** What earlier saves recorded as their past: before the story was corrected, and while it named the trees. */
  formerPasts: readonly string[];
  bodyType: BodyType;
}
export const foundingPeople: readonly Founder[] = [
  {
    name: 'Askr',
    past: 'A tree on the shore, given breath by Odin',
    formerPasts: ["Born under Ymir's left arm", 'An ash on the shore, given breath by Odin'],
    bodyType: BodyType.Male,
  },
  {
    name: 'Embla',
    past: 'A tree on the shore, woken beside Askr',
    formerPasts: ["Woke under Ymir's arm beside Askr", 'An elm on the shore, woken beside Askr'],
    bodyType: BodyType.Female,
  },
];
