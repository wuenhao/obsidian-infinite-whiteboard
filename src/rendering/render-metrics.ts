export interface RenderMetricsSnapshot {
  renderFrames: number;
  maxRenderDurationMs: number;
  sceneCacheBuilds: number;
  sceneCacheHits: number;
  maxSceneCacheBuildDurationMs: number;
}

export class RenderMetrics {
  private renderFrames = 0;
  private maxRenderDurationMs = 0;
  private sceneCacheBuilds = 0;
  private sceneCacheHits = 0;
  private maxSceneCacheBuildDurationMs = 0;

  recordFrame(durationMs: number): void {
    this.renderFrames += 1;
    this.maxRenderDurationMs = Math.max(this.maxRenderDurationMs, durationMs);
  }

  recordCacheBuild(durationMs: number): void {
    this.sceneCacheBuilds += 1;
    this.maxSceneCacheBuildDurationMs = Math.max(this.maxSceneCacheBuildDurationMs, durationMs);
  }

  recordCacheHit(): void {
    this.sceneCacheHits += 1;
  }

  snapshot(): RenderMetricsSnapshot {
    return {
      renderFrames: this.renderFrames,
      maxRenderDurationMs: this.maxRenderDurationMs,
      sceneCacheBuilds: this.sceneCacheBuilds,
      sceneCacheHits: this.sceneCacheHits,
      maxSceneCacheBuildDurationMs: this.maxSceneCacheBuildDurationMs
    };
  }

  reset(): void {
    this.renderFrames = 0;
    this.maxRenderDurationMs = 0;
    this.sceneCacheBuilds = 0;
    this.sceneCacheHits = 0;
    this.maxSceneCacheBuildDurationMs = 0;
  }
}
