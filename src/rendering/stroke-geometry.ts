import { Point, PressureMode } from "../model/types";

export function pressureScale(pressure: number, mode: PressureMode): number {
  const normalized = Math.min(1, Math.max(0.05, pressure));
  if (mode === "off") return 1;
  if (mode === "soft") return 0.82 + 0.36 * normalized;
  if (mode === "standard") return 0.62 + 0.78 * normalized;
  return Math.min(1.67, 0.42 + 1.25 * Math.pow(normalized, 0.72));
}

export function smoothCenterline(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const smoothed = points.map((point) => ({ ...point }));
  for (let index = 1; index < smoothed.length - 1; index++) {
    smoothed[index].x = smoothed[index - 1].x * 0.28 + points[index].x * 0.5 + points[index + 1].x * 0.22;
    smoothed[index].y = smoothed[index - 1].y * 0.28 + points[index].y * 0.5 + points[index + 1].y * 0.22;
  }
  for (let index = smoothed.length - 2; index > 0; index--) {
    smoothed[index].x = smoothed[index].x * 0.78 + smoothed[index + 1].x * 0.22;
    smoothed[index].y = smoothed[index].y * 0.78 + smoothed[index + 1].y * 0.22;
  }
  return smoothed;
}

export function stabilizePressure(values: number[], mode: PressureMode): number[] {
  const normalized: number[] = [];
  for (const value of values) {
    normalized.push(Number.isFinite(value) && value > 0
      ? Math.min(1, Math.max(0.05, value))
      : (normalized[normalized.length - 1] ?? 0.35));
  }
  const result = normalized.map((_, index) => {
    let total = 0;
    let weightTotal = 0;
    for (let offset = -6; offset <= 6; offset++) {
      const sampleIndex = Math.min(normalized.length - 1, Math.max(0, index + offset));
      const weight = 7 - Math.abs(offset);
      total += normalized[sampleIndex] * weight;
      weightTotal += weight;
    }
    return total / weightTotal;
  });
  const maxDelta = mode === "soft" ? 0.012 : mode === "strong" ? 0.03 : 0.02;
  for (let index = 1; index < result.length; index++) {
    const delta = Math.max(-maxDelta, Math.min(maxDelta, result[index] - result[index - 1]));
    result[index] = result[index - 1] + delta;
  }
  return result;
}

export function resampleCenterline(points: Point[], spacing: number): Point[] {
  const filtered: Point[] = [];
  for (const point of points) {
    const previous = filtered[filtered.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.28) filtered.push(point);
  }
  const finalPoint = points[points.length - 1];
  if (finalPoint && filtered[filtered.length - 1] !== finalPoint) filtered.push(finalPoint);
  const base = smoothCenterline(filtered);
  if (base.length < 2) return base;
  const result: Point[] = [];
  for (let index = 0; index < base.length - 1; index++) {
    const p0 = base[Math.max(0, index - 1)];
    const p1 = base[index];
    const p2 = base[index + 1];
    const p3 = base[Math.min(base.length - 1, index + 2)];
    const steps = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / spacing));
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        pressure: p1.pressure + (p2.pressure - p1.pressure) * t,
        time: p1.time + (p2.time - p1.time) * t
      });
    }
  }
  result.push({ ...base[base.length - 1] });
  return result;
}

export function pressureOutline(points: Point[], size: number, mode: PressureMode): Point[] {
  const samples = resampleCenterline(points, 0.9);
  if (samples.length < 2) return samples;
  const pressures = stabilizePressure(samples.map((point) => point.pressure), mode);
  const left: Point[] = [];
  const right: Point[] = [];
  for (let index = 0; index < samples.length; index++) {
    const before = samples[Math.max(0, index - 1)];
    const after = samples[Math.min(samples.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.max(0.0001, Math.hypot(dx, dy));
    const nx = -dy / length;
    const ny = dx / length;
    const radius = size * pressureScale(pressures[index], mode) / 2;
    left.push({ ...samples[index], x: samples[index].x + nx * radius, y: samples[index].y + ny * radius });
    right.push({ ...samples[index], x: samples[index].x - nx * radius, y: samples[index].y - ny * radius });
  }
  const outline: Point[] = [...left];
  const capSteps = 8;
  const end = samples[samples.length - 1];
  const endBefore = samples[samples.length - 2];
  const endAngle = Math.atan2(end.y - endBefore.y, end.x - endBefore.x);
  const endRadius = size * pressureScale(pressures[pressures.length - 1], mode) / 2;
  for (let step = 1; step <= capSteps; step++) {
    const angle = endAngle + Math.PI / 2 - Math.PI * step / capSteps;
    outline.push({ ...end, x: end.x + Math.cos(angle) * endRadius, y: end.y + Math.sin(angle) * endRadius });
  }
  for (let index = right.length - 2; index >= 0; index--) outline.push(right[index]);
  const start = samples[0];
  const startAfter = samples[1];
  const startAngle = Math.atan2(startAfter.y - start.y, startAfter.x - start.x);
  const startRadius = size * pressureScale(pressures[0], mode) / 2;
  for (let step = 1; step <= capSteps; step++) {
    const angle = startAngle - Math.PI / 2 - Math.PI * step / capSteps;
    outline.push({ ...start, x: start.x + Math.cos(angle) * startRadius, y: start.y + Math.sin(angle) * startRadius });
  }
  return outline;
}
