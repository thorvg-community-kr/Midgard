import type { Canvas, Scene, ThorVGNamespace } from '@thorvg/webcanvas';

/** One WebGL target with scene coordinates measured in CSS pixels. */
export class BrowserSurface {
  readonly viewport: Scene;
  canvas?: Canvas;
  lost = false;
  scale = 1;
  private width = 0;
  private height = 0;

  constructor(readonly element: HTMLCanvasElement, private readonly tvg: ThorVGNamespace) {
    this.viewport = new tvg.Scene();
  }
  resize(width: number, height: number, scale: number): boolean {
    if (this.canvas && width === this.width && height === this.height && scale === this.scale) return false;
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    // WebCanvas writes physical sizes inline. The page owns the logical size of the input surface.
    const style = this.element.style, cssWidth = style.width || width + 'px', cssHeight = style.height || height + 'px';
    if (this.canvas) this.canvas.resize(w, h);
    else {
      this.canvas = new this.tvg.Canvas(this.element, { width: w, height: h, enableDevicePixelRatio: false });
      this.canvas.add(this.viewport);
    }
    style.width = cssWidth;
    style.height = cssHeight;
    this.viewport.transform({ e11: scale, e12: 0, e13: 0, e21: 0, e22: scale, e23: 0, e31: 0, e32: 0, e33: 1 });
    this.width = width;
    this.height = height;
    this.scale = scale;
    return true;
  }
  releaseCanvas(): void {
    this.canvas?.remove();
    this.canvas?.destroy();
    this.canvas = undefined;
  }
  detach(): void {
    this.canvas?.remove();
    this.viewport.remove();
  }
  dispose(): void {
    this.viewport.dispose();
    this.canvas?.destroy();
    this.canvas = undefined;
  }
}
