import { Camera } from "../model/types";
import { RenderMetrics, RenderMetricsSnapshot } from "./render-metrics";
import { SceneCache } from "./scene-cache";

export interface SceneRenderFrame {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  camera: Camera;
  drawBackground: (context: CanvasRenderingContext2D, width: number, height: number) => void;
  drawStaticWorld: (context: CanvasRenderingContext2D) => void;
  drawDynamicWorld: (context: CanvasRenderingContext2D) => void;
}

export class SceneRenderer {
  private readonly cache = new SceneCache();
  private readonly metrics = new RenderMetrics();

  render(frame: SceneRenderFrame): void {
    const frameStartedAt = performance.now();
    const rect = frame.canvas.getBoundingClientRect();
    const ratio = frame.canvas.width / Math.max(1, rect.width);
    const cacheStartedAt = performance.now();
    const scene = this.cache.resolve(frame.canvas, frame.camera, (context) => {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      frame.drawBackground(context, rect.width, rect.height);
      context.save();
      context.translate(frame.camera.x, frame.camera.y);
      context.scale(frame.camera.zoom, frame.camera.zoom);
      frame.drawStaticWorld(context);
      context.restore();
    });
    const cacheDuration = performance.now() - cacheStartedAt;
    if (scene.reused) this.metrics.recordCacheHit();
    else this.metrics.recordCacheBuild(cacheDuration);

    const context = frame.context;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(scene.canvas, 0, 0);
    context.restore();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.save();
    context.translate(frame.camera.x, frame.camera.y);
    context.scale(frame.camera.zoom, frame.camera.zoom);
    frame.drawDynamicWorld(context);
    context.restore();
    this.metrics.recordFrame(performance.now() - frameStartedAt);
  }

  invalidate(): void {
    this.cache.invalidate();
  }

  release(): void {
    this.cache.release();
  }

  metricsSnapshot(): RenderMetricsSnapshot {
    return this.metrics.snapshot();
  }

  resetMetrics(): void {
    this.metrics.reset();
  }
}
