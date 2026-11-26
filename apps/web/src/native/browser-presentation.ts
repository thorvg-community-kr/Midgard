/** Keep HUD geometry in CSS pixels and limit the area shaded by each full-screen WebGL pass. */
export function renderPixelRatio(width: number, height: number, deviceRatio: number, touch: boolean): number {
  const density = 1 + ((deviceRatio || 1) - 1) * 0.75;
  if (!touch) return density;
  return Math.min(density, 1.75, Math.max(1, Math.sqrt(1_200_000 / (width * height))));
}

/** Presents on a display refresh. Long idle intervals sleep, and input can bring a frame forward. */
export class BrowserFrameLoop {
  private frame = 0;
  private timer = 0;
  private last = -Infinity;
  private due = 0;
  private readonly started = performance.now();
  private hiddenAt = document.hidden ? this.started : undefined;
  private hiddenTime = 0;
  running = false;

  constructor(
    private readonly draw: (seconds: number) => void,
    private readonly delay: () => number,
    private readonly minimumMs: number,
  ) {}

  seconds(): number {
    return ((this.hiddenAt ?? performance.now()) - this.started - this.hiddenTime) / 1000;
  }
  start(): void {
    if (this.running) return;
    this.running = true;
    this.wake();
  }
  stop(): void {
    this.running = false;
    this.cancel();
  }
  visibilityChanged(): void {
    if (document.hidden) {
      this.hiddenAt ??= performance.now();
      this.cancel();
    } else {
      if (this.hiddenAt !== undefined) this.hiddenTime += performance.now() - this.hiddenAt;
      this.hiddenAt = undefined;
      this.wake();
    }
  }
  wake(): void {
    if (!this.running || this.hiddenAt !== undefined) return;
    if (this.due > 0) this.due = Math.min(this.due, this.last + this.minimumMs);
    if (this.timer) clearTimeout(this.timer);
    this.timer = 0;
    this.schedule();
  }
  private cancel(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.timer) clearTimeout(this.timer);
    this.frame = this.timer = this.due = 0;
    this.last = -Infinity;
  }
  private schedule(): void {
    if (!this.running || this.hiddenAt !== undefined || this.frame || this.timer) return;
    const remaining = this.due - performance.now();
    if (remaining > 50) {
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.schedule();
      }, remaining - 12);
    } else this.frame = requestAnimationFrame(this.onFrame);
  }
  private readonly onFrame = (now: number) => {
    this.frame = 0;
    if (!this.running || this.hiddenAt !== undefined) return;
    if (now + 1 >= this.due) {
      const due = this.due;
      this.last = now;
      this.draw(this.seconds());
      if (!this.running || this.hiddenAt !== undefined) return;
      const interval = Math.max(this.minimumMs, this.delay() * 1000);
      // Keep the phase on 60/90/120 Hz screens. A late frame never causes catch-up draws.
      this.due = (due > 0 && now - due < interval ? due : now) + interval;
    }
    this.schedule();
  };
}
