import { BrushKind, Tool } from "../model/types";

export type TrackedInputTool = BrushKind | "laser";
export type InputStartSource = "pointer" | "touch";
export type InputRecoveryKind = "pointer-move" | "stylus-touch-fallback";

export interface InputToolMetric {
  starts: number;
  completions: number;
  pointerStarts: number;
  touchStarts: number;
  pointerMoveRecoveries: number;
  stylusTouchFallbacks: number;
}

const TRACKED_TOOLS: readonly TrackedInputTool[] = ["pen", "ballpoint", "highlighter", "laser"];

function emptyMetric(): InputToolMetric {
  return { starts: 0, completions: 0, pointerStarts: 0, touchStarts: 0, pointerMoveRecoveries: 0, stylusTouchFallbacks: 0 };
}

export function isTrackedInputTool(tool: Tool): tool is TrackedInputTool {
  return tool === "pen" || tool === "ballpoint" || tool === "highlighter" || tool === "laser";
}

/** Fixed-size, memory-only counters. No per-move work and no persistent state. */
export class InputToolMetrics {
  private metrics: Record<TrackedInputTool, InputToolMetric> = this.createMetrics();

  recordStart(tool: Tool, source: InputStartSource): TrackedInputTool | null {
    if (!isTrackedInputTool(tool)) return null;
    const metric = this.metrics[tool];
    metric.starts += 1;
    if (source === "pointer") metric.pointerStarts += 1;
    else metric.touchStarts += 1;
    return tool;
  }

  recordCompletion(tool: TrackedInputTool | null): void {
    if (tool) this.metrics[tool].completions += 1;
  }

  recordRecovery(tool: Tool, kind: InputRecoveryKind): void {
    if (!isTrackedInputTool(tool)) return;
    if (kind === "pointer-move") this.metrics[tool].pointerMoveRecoveries += 1;
    else this.metrics[tool].stylusTouchFallbacks += 1;
  }

  reset(): void {
    this.metrics = this.createMetrics();
  }

  snapshot(): Readonly<Record<TrackedInputTool, Readonly<InputToolMetric>>> {
    return {
      pen: { ...this.metrics.pen },
      ballpoint: { ...this.metrics.ballpoint },
      highlighter: { ...this.metrics.highlighter },
      laser: { ...this.metrics.laser }
    };
  }

  compactSummary(): string {
    const labels: Record<TrackedInputTool, string> = { pen: "钢", ballpoint: "圆", highlighter: "荧", laser: "激" };
    return TRACKED_TOOLS.map((tool) => `${labels[tool]} ${this.metrics[tool].starts}/${this.metrics[tool].completions}`).join(" · ");
  }

  reportSummary(): string {
    return TRACKED_TOOLS.map((tool) => {
      const metric = this.metrics[tool];
      return `${tool}[start=${metric.starts},complete=${metric.completions},pointer=${metric.pointerStarts},touch=${metric.touchStarts},moveRecovery=${metric.pointerMoveRecoveries},touchFallback=${metric.stylusTouchFallbacks}]`;
    }).join("; ");
  }

  private createMetrics(): Record<TrackedInputTool, InputToolMetric> {
    return { pen: emptyMetric(), ballpoint: emptyMetric(), highlighter: emptyMetric(), laser: emptyMetric() };
  }
}
