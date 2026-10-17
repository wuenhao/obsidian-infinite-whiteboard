import { LaserConfig, LaserStroke, Point } from "../model/types";
import { makeId } from "../model/board";

export function createLaserStroke(point: Point, config: LaserConfig): LaserStroke {
  return { id: makeId("laser"), points: [point], config: structuredClone(config), completedAt: null };
}

export function appendLaserPoint(stroke: LaserStroke, point: Point, minimumDistance = 0.18): boolean {
  const previous = stroke.points[stroke.points.length - 1];
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) <= minimumDistance) return false;
  stroke.points.push(point);
  return true;
}

export function laserAlpha(stroke: LaserStroke, now: number): number {
  if (stroke.completedAt === null) return 1;
  const fadeStart = stroke.completedAt + stroke.config.holdMs;
  if (now <= fadeStart) return 1;
  return Math.max(0, 1 - (now - fadeStart) / Math.max(1, stroke.config.fadeMs));
}

export function isLaserExpired(stroke: LaserStroke, now: number): boolean {
  return stroke.completedAt !== null && laserAlpha(stroke, now) <= 0;
}
