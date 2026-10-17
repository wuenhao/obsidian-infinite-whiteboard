import { Point, ScreenPoint, Stroke } from "../model/types";
import { hitTestElement } from "../selection/geometry";

export interface StrokeEraseResult {
  changed: boolean;
  fragments: Stroke[];
}

export function sampleEraserPath(previous: ScreenPoint | null, current: ScreenPoint, spacing: number): ScreenPoint[] {
  if (!previous) return [current];
  const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
  const steps = Math.min(512, Math.max(1, Math.ceil(distance / Math.max(0.1, spacing))));
  const points: ScreenPoint[] = [];
  for (let step = 1; step <= steps; step++) {
    const amount = step / steps;
    points.push({
      x: previous.x + (current.x - previous.x) * amount,
      y: previous.y + (current.y - previous.y) * amount
    });
  }
  return points;
}

function interpolate(start: Point, end: Point, amount: number): Point {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
    pressure: start.pressure + (end.pressure - start.pressure) * amount,
    time: start.time + (end.time - start.time) * amount
  };
}

function distanceSquared(point: Point, center: ScreenPoint): number {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return dx * dx + dy * dy;
}

function segmentCircleIntersections(start: Point, end: Point, center: ScreenPoint, radius: number): number[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fx = start.x - center.x;
  const fy = start.y - center.y;
  const a = dx * dx + dy * dy;
  if (a <= Number.EPSILON) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)]
    .filter((amount) => amount > 0 && amount < 1)
    .sort((left, right) => left - right);
}

function pushDistinct(points: Point[], point: Point): void {
  const previous = points[points.length - 1];
  if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-6) points.push(point);
}

export function eraseStrokeAt(
  stroke: Stroke,
  center: ScreenPoint,
  eraserRadius: number,
  makeFragmentId: () => string
): StrokeEraseResult {
  const strokeRadius = (stroke.brush?.size ?? stroke.size) / 2;
  const radius = Math.max(0, eraserRadius) + strokeRadius;
  const radiusSquared = radius * radius;
  if (stroke.points.length === 1) {
    if (distanceSquared(stroke.points[0], center) > radiusSquared) return { changed: false, fragments: [stroke] };
    return { changed: true, fragments: [] };
  }

  const pointFragments: Point[][] = [];
  let current: Point[] | null = null;
  let removed = false;
  const finishCurrent = (): void => {
    if (current?.length) pointFragments.push(current);
    current = null;
  };

  for (let index = 0; index < stroke.points.length - 1; index++) {
    const start = stroke.points[index];
    const end = stroke.points[index + 1];
    const amounts = [0, ...segmentCircleIntersections(start, end, center, radius), 1];
    for (let interval = 0; interval < amounts.length - 1; interval++) {
      const from = amounts[interval];
      const to = amounts[interval + 1];
      if (to - from <= Number.EPSILON) continue;
      const midpoint = interpolate(start, end, (from + to) / 2);
      const outside = distanceSquared(midpoint, center) > radiusSquared;
      if (outside) {
        if (!current) current = [];
        pushDistinct(current, interpolate(start, end, from));
        pushDistinct(current, interpolate(start, end, to));
      } else {
        removed = true;
        finishCurrent();
      }
    }
  }
  finishCurrent();

  if (!removed) return { changed: false, fragments: [stroke] };
  const updatedAt = new Date().toISOString();
  return {
    changed: true,
    fragments: pointFragments.map((points, index) => ({
      ...structuredClone(stroke),
      id: index === 0 ? stroke.id : makeFragmentId(),
      updatedAt,
      points
    }))
  };
}

export function eraseWholeStrokeAt(stroke: Stroke, center: ScreenPoint, eraserRadius: number): StrokeEraseResult {
  return hitTestElement(stroke, center, Math.max(0, eraserRadius))
    ? { changed: true, fragments: [] }
    : { changed: false, fragments: [stroke] };
}
