// Opening saga, last beat: the two on the shore, few against everything, then a gate shut for
// good on the word that asks for it.
import { SceneNode, ShapeNode } from './paint';
import { pen } from './outline-form';
import { frostGate } from './saga-gates-panel';
import { dawnShore, founderBack } from './saga-shore';
import {
  about,
  alphaOf,
  cutTo,
  ease,
  easeOut,
  flat,
  frame,
  glide,
  lock,
  ramp,
  raven,
  scatter,
  shotAt,
  span,
  stepped,
  type SagaPanel,
  type Stop,
} from './saga-panel';

const length = 8.2;
/** Seconds of the beat the gate is cut to, and when its slab comes down: on "seal". */
const gateAt = 4,
  sealedAt = 5.1;
/** The mouth of the gate, at the middle of the board. */
const mouth: readonly [number, number] = [800, 470];
/** The camera starts on the two of them and draws back until they are small on the strand. */
const shoreStops: readonly Stop[] = [
  { at: 0, x: 1040, y: 640, zoom: 1.7 },
  { at: gateAt, x: 800, y: 452, zoom: 1.02 },
];

/** Few and precious; and the gates. */
export function chargePanel(): SagaPanel {
  const scene = new SceneNode(),
    shoreShot = new SceneNode(),
    stage = new SceneNode(),
    shore = dawnShore(430),
    askr = founderBack(0),
    embla = founderBack(1),
    bird = raven([26, 24, 40]),
    gateShot = new SceneNode(),
    gate = frostGate(),
    dust = new SceneNode(),
    puffs: ShapeNode[] = [],
    rune = new ShapeNode().appendCircle(mouth[0], mouth[1] + 4, 52).fill(214, 232, 250, 0);
  shore.ground.add(
    flat(
      [pen(880, 842).curve([1040, 800], [1240, 792], [1460, 804], [1800, 790]).line(1800, 1100).line(760, 1100).close()],
      [128, 156, 102],
    ),
  );
  // Long shadows fall toward us and to the right, away from the low sun.
  for (const [x, y] of [
    [1052, 806],
    [1150, 812],
  ])
    shore.ground.add(flat([lock(x, y, x + 210, y + 46, 34, 0.02)], [92, 100, 96], 110));
  stage.add(shore.scene).add(askr).add(embla).add(bird);
  shoreShot.add(stage);
  for (let i = 0; i < 7; i++) {
    const puff = new ShapeNode().appendCircle(0, 0, 30 + 26 * scatter(i, 411)).fill(226, 236, 248);
    puffs.push(puff);
    dust.add(puff);
  }
  gateShot.add(gate.scene).add(rune).add(dust);
  scene.add(shoreShot).add(gateShot);
  const shots = [shoreShot, gateShot];
  return {
    scene,
    // A raven over the bay, and the slab coming to rest on "seal".
    cues: [
      { at: 1.4 / length, sound: 'wildlife/raven_01', volume: 0.6 },
      { at: (sealedAt - 0.9) / length, sound: 'sfx/saga/seal', volume: 0.9 },
    ],
    pose(_beat, seconds, at) {
      const shot = shotAt([0, gateAt], at);
      cutTo(shots, shot);
      if (shot === 0) {
        const view = glide(shoreStops, at);
        frame(stage, view.x, view.y, view.zoom);
        shore.pose(seconds, 1);
        // They sway a little on new legs, drawn on twos.
        const drawn = stepped(seconds, 12);
        askr.transform([1.5, 0.02 * Math.sin(drawn * 1.1), 1052, 0, 1.5, 806, 0, 0, 1]);
        embla.transform([1.42, 0.02 * Math.sin(drawn * 1.1 + 1.7), 1150, 0, 1.42, 812, 0, 0, 1]);
        // A raven crosses the sky from the sun toward them.
        const flight = span(at, 1.2, gateAt),
          flap = 0.4 + 0.6 * Math.abs(Math.sin(drawn * 7)),
          k = 0.7 + 0.5 * flight;
        bird
          .transform([k, 0, 380 + 900 * flight, 0, k * flap, 250 - 90 * Math.sin(flight * Math.PI), 0, 0, 1])
          .opacity(flight > 0 && flight < 1 ? 255 : 0);
      } else {
        const shut = at >= sealedAt,
          after = at - sealedAt,
          // Two drawings of jolt as the slab lands.
          jolt = shut && after < 0.17 ? (stepped(after, 12) < 0.08 ? 9 : -5) : 0;
        gate.pose(seconds, shut);
        about(gateShot, mouth[0], mouth[1], 1.12 - 0.1 * ease((at - gateAt) / 2.3), 0, jolt);
        puffs.forEach((puff, i) => {
          const life = ramp(after, 0, 0.9),
            side = i % 2 ? 1 : -1,
            reach = (120 + 150 * scatter(i, 412)) * easeOut(life);
          puff
            .translate(mouth[0] + side * (70 + reach), mouth[1] + 150 - 60 * easeOut(life) + 30 * scatter(i, 413))
            .opacity(shut ? alphaOf(0.8 * (1 - life)) : 0);
        });
        // The rune takes the light for a moment, then lies cold in the stone.
        rune.fill(214, 232, 250, shut ? alphaOf(0.32 * (1 - ramp(after, 0.05, 0.6))) : 0);
      }
    },
  };
}
