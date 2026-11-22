// The opening saga shown before a new game: seven narrated beats cut together like a short film.
import type { Paint, ThorVGNamespace } from '@thorvg/webcanvas';
import { PictureNode, SceneNode, ShapeNode } from '../../../../packages/native-renderer/src/paint';
import { WebCanvasAdapter } from '../../../../packages/native-renderer/src/webcanvas-adapter';
import { sharedAudioContext } from '../../../../packages/native-audio/src/browser-audio';
import {
  sagaHeight,
  sagaWidth,
  type SagaArt,
  type SagaPanel,
} from '../../../../packages/native-renderer/src/saga-panel';
import {
  shapingPanel,
  slayingPanel,
  voidPanel,
} from '../../../../packages/native-renderer/src/saga-creation-panels';
import { treePanel } from '../../../../packages/native-renderer/src/saga-tree-panel';
import { gatesPanel } from '../../../../packages/native-renderer/src/saga-gates-panel';
import { breathPanel } from '../../../../packages/native-renderer/src/saga-breath-panel';
import { chargePanel } from '../../../../packages/native-renderer/src/saga-charge-panel';

/** One caption phrase and the seconds of its beat it is on screen. */
export interface SagaLine {
  text: string;
  from: number;
  to: number;
}
export interface SagaBeat {
  panel: (art: SagaArt) => SagaPanel;
  lines: SagaLine[];
  /** Narration takes under `assets/audio/narration/en`, and the second of the beat each starts. */
  takes: { clip: string; at: number }[];
  /** Seconds the beat holds the screen; the next one is cut to, never faded. */
  length: number;
}
const line = (text: string, from: number, to: number): SagaLine => ({ text, from, to });
/**
 * Caption times follow the pauses measured in each take, so a phrase appears as it is spoken and
 * the panels can cut on the same words.
 */
export const sagaBeats: SagaBeat[] = [
  {
    panel: voidPanel,
    lines: [
      line('Before the world, there was only the void...', 1, 4.4),
      line('and in the void, Ymir, the first giant.', 4.65, 8.6),
    ],
    takes: [{ clip: 'intro_1', at: 0.7 }],
    length: 9,
  },
  {
    panel: slayingPanel,
    lines: [line('Odin and his brothers rose against him...', 1.05, 3.95), line('and the giant fell.', 4.1, 6.4)],
    takes: [{ clip: 'intro_2', at: 0.7 }],
    length: 7.2,
  },
  {
    panel: shapingPanel,
    lines: [
      line('From his body, they shaped the land.', 1.2, 3.75),
      line('His flesh became the earth. His blood, the sea.', 3.95, 7.9),
      line('His bones, the mountains.', 8.05, 10.4),
      line('They named it... Midgard.', 10.6, 13.5),
    ],
    takes: [{ clip: 'intro_3', at: 0.7 }],
    length: 13.9,
  },
  {
    panel: treePanel,
    lines: [line('But Midgard is only one of nine worlds.', 0.55, 3.7)],
    takes: [{ clip: 'saga_worlds', at: 0.3 }],
    length: 4.4,
  },
  {
    panel: gatesPanel,
    lines: [
      line('From each, a gate opens into Midgard...', 0.55, 3.15),
      line('and through them pour the hungry things', 3.25, 5.1),
      line('of frost, of fire, and of the grave.', 5.1, 9),
    ],
    takes: [
      { clip: 'saga_gate', at: 0.3 },
      { clip: 'saga_gates_b', at: 3 },
    ],
    length: 9.9,
  },
  {
    panel: breathPanel,
    lines: [
      line('So Odin walked the shore,', 0.85, 2.75),
      line('and to an ash and an elm, he gave breath.', 2.85, 6.3),
      line('Askr and Embla.', 7.15, 9.35),
    ],
    takes: [
      { clip: 'saga_people_a', at: 0.6 },
      { clip: 'saga_names', at: 6.9 },
    ],
    length: 9.6,
  },
  {
    panel: chargePanel,
    lines: [line('They are few. Guard every one.', 0.75, 3.7), line('And seal the gates.', 4.5, 7.1)],
    takes: [
      { clip: 'saga_charge_a', at: 0.5 },
      { clip: 'saga_charge_c', at: 4.3 },
    ],
    length: 8.2,
  },
];
const fadeIn = 0.9;
const fadeOut = 1.2;
const bedVolume = 0.3;
const bedPath = 'music/dawn/saga_world_tree';
/** Seconds over which the music leaves at the end. */
const bedLeaves = 3;

export interface SagaSound {
  /** Under `assets/audio`, without the extension. */
  path: string;
  /** Seconds from the start of the saga. */
  at: number;
  volume: number;
  /** The music bed: it loops under everything and fades out at the end. */
  bed?: boolean;
}
export const sagaSeconds = (): number => sagaBeats.reduce((sum, beat) => sum + beat.length, 0);
/** Every sound the saga plays and when: the game follows it live, the presentation video mixes it offline. */
export function sagaSounds(): SagaSound[] {
  const sounds: SagaSound[] = [{ path: bedPath, at: 0, volume: bedVolume, bed: true }],
    art: SagaArt = { world: new PictureNode(new Uint8Array(4), 1, 1) };
  let start = 0;
  for (const beat of sagaBeats) {
    for (const take of beat.takes)
      sounds.push({ path: `narration/en/${take.clip}`, at: start + take.at, volume: 1 });
    for (const cue of beat.panel(art).cues ?? [])
      sounds.push({ path: cue.sound, at: start + cue.at * beat.length, volume: cue.volume });
    start += beat.length;
  }
  return sounds;
}

/** One narration take, effect or the music bed, played on the game's own audio context. */
class SagaClip {
  private buffer: AudioBuffer | undefined;
  private source: AudioBufferSourceNode | undefined;
  private gain: GainNode | undefined;
  private wanted = false;
  private stopped = false;
  constructor(
    private readonly context: AudioContext,
    path: string,
    private volume: number,
    private readonly loop = false,
  ) {
    void fetch(`${import.meta.env?.BASE_URL ?? '/'}assets/audio/${path}.ogg`)
      .then((response) => response.arrayBuffer())
      .then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => {
        this.buffer = buffer;
        if (this.wanted) this.play();
      })
      // The captions carry the story if a take cannot be loaded.
      .catch(() => {});
  }
  play(): void {
    this.wanted = true;
    if (!this.buffer || this.source || this.stopped) return;
    void this.context.resume().catch(() => {});
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.context.destination);
    this.source = this.context.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = this.loop;
    this.source.connect(this.gain);
    this.source.start();
  }
  level(volume: number): void {
    this.volume = volume;
    if (this.gain) this.gain.gain.value = volume;
  }
  stop(): void {
    this.stopped = true;
    try {
      this.source?.stop();
    } catch {
      // Already ended.
    }
    this.gain?.disconnect();
  }
}
const clip = (path: string, volume: number, loop = false): SagaClip | undefined => {
  const context = sharedAudioContext();
  return context && typeof fetch === 'function' ? new SagaClip(context, path, volume, loop) : undefined;
};

/** Decodes an image under `assets/` into a picture node; the node stays 1 x 1 if that fails. */
async function loadPicture(path: string, into: PictureNode): Promise<void> {
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return;
  try {
    const response = await fetch(`${import.meta.env?.BASE_URL ?? '/'}assets/${path}`),
      bitmap = await createImageBitmap(await response.blob()),
      context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    if (!context) return;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    into.load(new Uint8Array(pixels.data.buffer), bitmap.width, bitmap.height);
  } catch {
    // The drawn map remains.
  }
}

export class IntroSaga {
  private readonly adapter: WebCanvasAdapter;
  private readonly root = new SceneNode();
  private readonly ground = new ShapeNode();
  private readonly frame = new SceneNode();
  private readonly window = new SceneNode();
  private readonly border = new ShapeNode();
  private readonly takes: (SagaClip | undefined)[][];
  private readonly bed: SagaClip | undefined;
  private panel: SagaPanel | undefined;
  private index = -1;
  private time = 0;
  private clock = 0;
  private spoken = 0;
  private effects: SagaClip[] = [];
  private fired = 0;
  private ringing: SagaClip[] = [];
  private readonly art: SagaArt = { world: new PictureNode(new Uint8Array(4), 1, 1) };
  private done = false;
  private width = -1;
  private height = -1;
  private posed = false;
  private posedArt = -1;
  private collectPending = true;
  readonly paint: Paint;

  constructor(
    tvg: ThorVGNamespace,
    private readonly still = false,
  ) {
    this.adapter = new WebCanvasAdapter(tvg);
    this.window.clip(new ShapeNode().appendRect(0, 0, sagaWidth, sagaHeight));
    this.border
      .appendRect(0, 0, sagaWidth, sagaHeight)
      .strokeFill(196, 176, 132, 200)
      .strokeWidth(3)
      .strokeJoin('miter');
    this.frame.add(this.window).add(this.border);
    this.root.add(this.ground).add(this.frame);
    this.takes = sagaBeats.map((beat) => beat.takes.map((take) => clip(`narration/en/${take.clip}`, 1)));
    this.bed = clip(bedPath, bedVolume, true);
    this.bed?.play();
    void loadPicture('saga/midgard.jpg', this.art.world);
    this.turnTo(0);
    this.paint = this.adapter.sync(this.root);
  }
  private length(): number {
    return sagaBeats[this.index].length;
  }
  private turnTo(index: number): void {
    for (const take of this.takes[this.index] ?? []) take?.stop();
    if (index >= sagaBeats.length) {
      this.done = true;
      return;
    }
    this.index = index;
    this.time = 0;
    this.spoken = 0;
    this.fired = 0;
    this.posed = false;
    this.collectPending = true;
    if (this.panel) this.window.remove(this.panel.scene);
    // A long sound, like the giant's fall, rings on under the next panel.
    this.ringing.push(...this.effects);
    this.panel = sagaBeats[index].panel(this.art);
    // Loaded with the panel so each is ready by its moment.
    this.effects = (this.panel.cues ?? []).flatMap((cue) => clip(cue.sound, cue.volume) ?? []);
    this.window.add(this.panel.scene);
  }
  /** Returns false once the last panel has faded out. */
  advance(dt: number, width: number, height: number): boolean {
    if (this.done) return false;
    this.time += dt;
    this.clock += dt;
    if (this.time >= this.length()) this.turnTo(this.index + 1);
    if (this.done) return false;
    const beat = sagaBeats[this.index],
      length = beat.length,
      last = this.index === sagaBeats.length - 1;
    while (this.spoken < beat.takes.length && this.time >= beat.takes[this.spoken].at)
      this.takes[this.index][this.spoken++]?.play();
    const cues = this.panel?.cues ?? [];
    while (this.fired < cues.length && this.time / length >= cues[this.fired].at)
      this.effects[this.fired++]?.play();
    // Only the first beat rises out of black and only the last sinks into it: the rest are cuts.
    const shown = Math.min(1, this.index === 0 ? this.time / fadeIn : 1, last ? (length - this.time) / fadeOut : 1),
      band = Math.max(64, Math.min(128, height * 0.17)),
      pad = Math.min(36, width * 0.03),
      k = Math.max(0.01, Math.min((width - pad * 2) / sagaWidth, (height - band - pad) / sagaHeight));
    if (this.bed && last) this.bed.level(bedVolume * Math.max(0, Math.min(1, (length - this.time) / bedLeaves)));
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.ground.reset().appendRect(0, 0, width, height).fill(8, 8, 14);
      this.frame.transform([
        k,
        0,
        (width - sagaWidth * k) / 2,
        0,
        k,
        pad + (height - band - pad - sagaHeight * k) / 2,
        0,
        0,
        1,
      ]);
    }
    const opacity = Math.round(255 * Math.max(0, shown));
    if (this.frame.alpha !== opacity) this.frame.opacity(opacity);
    if (!this.still || !this.posed || this.posedArt !== this.art.world.dataVersion) {
      // Without motion each beat shows one drawing: the moment most of its story is on screen.
      if (this.still) this.panel?.pose(0.8, 0, 0.8 * length);
      else this.panel?.pose(this.time / length, this.clock, this.time);
      this.posed = true;
      this.posedArt = this.art.world.dataVersion;
    }
    this.adapter.sync(this.root);
    if (this.collectPending) {
      this.adapter.collect([this.root]);
      this.collectPending = false;
    }
    return true;
  }
  /** The phrase being spoken and how visible it is, 0..1. */
  caption(): { text: string; shown: number } {
    if (this.done || this.index < 0) return { text: '', shown: 0 };
    for (const { text, from, to } of sagaBeats[this.index].lines)
      if (this.time >= from && this.time < to)
        return { text, shown: Math.max(0, Math.min(1, (this.time - from) / 0.35, (to - this.time) / 0.3)) };
    return { text: '', shown: 0 };
  }
  /** Where the panel sits on screen, so captions can be set under it. */
  captionTop(width: number, height: number): number {
    const band = Math.max(64, Math.min(128, height * 0.17)),
      pad = Math.min(36, width * 0.03),
      k = Math.min((width - pad * 2) / sagaWidth, (height - band - pad) / sagaHeight);
    return pad + (height - band - pad - sagaHeight * k) / 2 + sagaHeight * k;
  }
  next(): void {
    if (!this.done) this.turnTo(this.index + 1);
  }
  skip(): void {
    for (const take of this.takes[this.index] ?? []) take?.stop();
    this.done = true;
  }
  dispose(): void {
    for (const take of this.takes.flat()) take?.stop();
    this.bed?.stop();
    for (const effect of [...this.effects, ...this.ringing]) effect.stop();
    this.adapter.dispose();
  }
}
