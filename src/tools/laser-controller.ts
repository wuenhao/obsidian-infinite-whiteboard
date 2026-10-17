import { LaserConfig, LaserStroke, Point } from "../model/types";
import { smoothCenterline } from "../rendering/stroke-geometry";
import { appendLaserPoint, createLaserStroke, isLaserExpired, laserAlpha } from "./laser-state";
import { ToolController, ToolInput } from "./registry";

export class LaserController implements ToolController {
  private strokes: LaserStroke[] = [];
  private current: LaserStroke | null = null;

  constructor(
    private readonly getConfig: () => LaserConfig,
    private readonly now: () => number = () => performance.now(),
    private readonly onDeactivateEffect: () => void = () => {}
  ) {}

  get hasStrokes(): boolean {
    return this.strokes.length > 0;
  }

  get isDrawing(): boolean {
    return this.current !== null;
  }

  get visibleStrokes(): readonly LaserStroke[] {
    return this.strokes;
  }

  onActivate(): void {}

  onDeactivate(): void {
    this.onDeactivateEffect();
    this.clear();
  }

  onInputStart(input: ToolInput): void {
    const stroke = createLaserStroke(input.point, this.getConfig());
    this.current = stroke;
    this.strokes.push(stroke);
  }

  onInputMove(input: ToolInput): void {
    if (this.current) appendLaserPoint(this.current, input.point);
  }

  onInputEnd(input: ToolInput): void {
    if (!this.current) return;
    appendLaserPoint(this.current, input.point);
    this.complete();
  }

  complete(): void {
    if (!this.current) return;
    this.current.completedAt = this.now();
    this.current = null;
  }

  pruneExpired(at = this.now()): void {
    this.strokes = this.strokes.filter((stroke) => !isLaserExpired(stroke, at));
  }

  clear(): void {
    this.current = null;
    this.strokes = [];
  }

  renderOverlay(context: CanvasRenderingContext2D): void {
    const at = this.now();
    for (const stroke of this.strokes) this.drawStroke(context, stroke, at);
  }

  private drawStroke(context: CanvasRenderingContext2D, stroke: LaserStroke, at: number): void {
    if (!stroke.points.length) return;
    const alpha = laserAlpha(stroke, at);
    const path = this.centerlinePath(smoothCenterline(stroke.points));
    context.save();
    context.globalCompositeOperation = "source-over";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = stroke.config.color;
    context.shadowColor = stroke.config.color;
    context.shadowBlur = stroke.config.glow;
    if (stroke.points.length === 1) {
      context.globalAlpha = alpha * (stroke.config.opacity ?? 1);
      context.fillStyle = stroke.config.color;
      context.beginPath();
      context.arc(stroke.points[0].x, stroke.points[0].y, stroke.config.size / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.globalAlpha = alpha * (stroke.config.opacity ?? 1) * 0.24;
      context.lineWidth = stroke.config.size * 2.4;
      context.stroke(path);
      context.globalAlpha = alpha * (stroke.config.opacity ?? 1);
      context.lineWidth = stroke.config.size;
      context.stroke(path);
    }
    context.restore();
  }

  private centerlinePath(points: readonly Point[]): Path2D {
    const path = new Path2D();
    if (!points.length) return path;
    path.moveTo(points[0].x, points[0].y);
    if (points.length === 2) {
      path.lineTo(points[1].x, points[1].y);
      return path;
    }
    for (let index = 0; index < points.length - 1; index++) {
      const before = points[Math.max(0, index - 1)];
      const current = points[index];
      const next = points[index + 1];
      const after = points[Math.min(points.length - 1, index + 2)];
      path.bezierCurveTo(
        current.x + (next.x - before.x) / 6,
        current.y + (next.y - before.y) / 6,
        next.x - (after.x - current.x) / 6,
        next.y - (after.y - current.y) / 6,
        next.x,
        next.y
      );
    }
    return path;
  }
}
