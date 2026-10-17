import { BoardElement, BoardImage, ScreenPoint } from "../model/types";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type ResizeHandle = "nw" | "ne" | "se" | "sw";
export type ImageCropHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

function imageLocalToWorld(image: BoardImage, point: ScreenPoint): ScreenPoint {
  const centerX = image.x + image.width / 2;
  const centerY = image.y + image.height / 2;
  const radians = image.rotation * Math.PI / 180;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  return { x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians), y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians) };
}

export function imageCorners(image: BoardImage): ScreenPoint[] {
  const centerX = image.x + image.width / 2;
  const centerY = image.y + image.height / 2;
  const radians = image.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    { x: image.x, y: image.y },
    { x: image.x + image.width, y: image.y },
    { x: image.x + image.width, y: image.y + image.height },
    { x: image.x, y: image.y + image.height }
  ].map((point) => {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    return { x: centerX + dx * cosine - dy * sine, y: centerY + dx * sine + dy * cosine };
  });
}

export function imageCropHandlePoints(image: BoardImage): Record<ImageCropHandle, ScreenPoint> {
  const left = image.x;
  const right = image.x + image.width;
  const top = image.y;
  const bottom = image.y + image.height;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  return {
    nw: imageLocalToWorld(image, { x: left, y: top }), n: imageLocalToWorld(image, { x: centerX, y: top }),
    ne: imageLocalToWorld(image, { x: right, y: top }), e: imageLocalToWorld(image, { x: right, y: centerY }),
    se: imageLocalToWorld(image, { x: right, y: bottom }), s: imageLocalToWorld(image, { x: centerX, y: bottom }),
    sw: imageLocalToWorld(image, { x: left, y: bottom }), w: imageLocalToWorld(image, { x: left, y: centerY })
  };
}

export function imageRotationHandlePoint(image: BoardImage, distance: number): ScreenPoint {
  return imageLocalToWorld(image, { x: image.x + image.width / 2, y: image.y - distance });
}

export function elementBounds(element: BoardElement): Bounds {
  if (element.type === "image") {
    const corners = imageCorners(element);
    return {
      minX: Math.min(...corners.map((point) => point.x)),
      minY: Math.min(...corners.map((point) => point.y)),
      maxX: Math.max(...corners.map((point) => point.x)),
      maxY: Math.max(...corners.map((point) => point.y))
    };
  }
  const radius = (element.brush?.size ?? element.size) / 2;
  const xs = element.points.map((point) => point.x);
  const ys = element.points.map((point) => point.y);
  return {
    minX: Math.min(...xs) - radius,
    minY: Math.min(...ys) - radius,
    maxX: Math.max(...xs) + radius,
    maxY: Math.max(...ys) + radius
  };
}

export function unionBounds(elements: BoardElement[]): Bounds | null {
  if (!elements.length) return null;
  const bounds = elements.map(elementBounds);
  return {
    minX: Math.min(...bounds.map((value) => value.minX)),
    minY: Math.min(...bounds.map((value) => value.minY)),
    maxX: Math.max(...bounds.map((value) => value.maxX)),
    maxY: Math.max(...bounds.map((value) => value.maxY))
  };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function pointInBounds(point: ScreenPoint, bounds: Bounds, tolerance = 0): boolean {
  return point.x >= bounds.minX - tolerance && point.x <= bounds.maxX + tolerance
    && point.y >= bounds.minY - tolerance && point.y <= bounds.maxY + tolerance;
}

export function pointInPolygon(point: ScreenPoint, polygon: ScreenPoint[]): boolean {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function orientation(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point: ScreenPoint, start: ScreenPoint, end: ScreenPoint): boolean {
  return Math.abs(orientation(start, end, point)) <= 1e-9
    && point.x >= Math.min(start.x, end.x) - 1e-9 && point.x <= Math.max(start.x, end.x) + 1e-9
    && point.y >= Math.min(start.y, end.y) - 1e-9 && point.y <= Math.max(start.y, end.y) + 1e-9;
}

function segmentsIntersect(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint, d: ScreenPoint): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return pointOnSegment(c, a, b) || pointOnSegment(d, a, b) || pointOnSegment(a, c, d) || pointOnSegment(b, c, d);
}

function polylineIntersectsPolygon(points: readonly ScreenPoint[], polygon: readonly ScreenPoint[]): boolean {
  for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex++) {
    for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex++) {
      if (segmentsIntersect(points[pointIndex], points[pointIndex + 1], polygon[edgeIndex], polygon[(edgeIndex + 1) % polygon.length])) return true;
    }
  }
  return false;
}

export function elementIntersectsLasso(element: BoardElement, polygon: ScreenPoint[]): boolean {
  if (polygon.length < 3) return false;
  if (element.type === "stroke") {
    return element.points.some((point) => pointInPolygon(point, polygon)) || polylineIntersectsPolygon(element.points, polygon);
  }
  const corners = imageCorners(element);
  return corners.some((point) => pointInPolygon(point, polygon))
    || polygon.some((point) => pointInPolygon(point, corners))
    || polylineIntersectsPolygon([...corners, corners[0]], polygon);
}

export function elementIntersectsBounds(element: BoardElement, bounds: Bounds): boolean {
  if (!boundsIntersect(elementBounds(element), bounds)) return false;
  const rectangle = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY }
  ];
  if (element.type === "image") {
    const corners = imageCorners(element);
    return corners.some((point) => pointInBounds(point, bounds))
      || rectangle.some((point) => pointInPolygon(point, corners))
      || polylineIntersectsPolygon([...corners, corners[0]], rectangle);
  }
  const radius = (element.brush?.size ?? element.size) / 2;
  const expanded = { minX: bounds.minX - radius, minY: bounds.minY - radius, maxX: bounds.maxX + radius, maxY: bounds.maxY + radius };
  if (element.points.some((point) => pointInBounds(point, expanded))) return true;
  for (let index = 0; index < element.points.length - 1; index++) {
    const start = element.points[index];
    const end = element.points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let minimum = 0;
    let maximum = 1;
    const clips: Array<[number, number]> = [
      [-dx, start.x - expanded.minX],
      [dx, expanded.maxX - start.x],
      [-dy, start.y - expanded.minY],
      [dy, expanded.maxY - start.y]
    ];
    let intersects = true;
    for (const [direction, distance] of clips) {
      if (direction === 0) {
        if (distance < 0) intersects = false;
        continue;
      }
      const ratio = distance / direction;
      if (direction < 0) minimum = Math.max(minimum, ratio);
      else maximum = Math.min(maximum, ratio);
      if (minimum > maximum) intersects = false;
    }
    if (intersects) return true;
  }
  return false;
}

function distanceToSegment(point: ScreenPoint, start: ScreenPoint, end: ScreenPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function hitTestElement(element: BoardElement, point: ScreenPoint, tolerance: number): boolean {
  if (!pointInBounds(point, elementBounds(element), tolerance)) return false;
  if (element.type === "image") {
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const radians = -element.rotation * Math.PI / 180;
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const local = {
      x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians)
    };
    return pointInBounds(local, { minX: element.x, minY: element.y, maxX: element.x + element.width, maxY: element.y + element.height }, tolerance);
  }
  const radius = (element.brush?.size ?? element.size) / 2 + tolerance;
  if (element.points.length === 1) return Math.hypot(point.x - element.points[0].x, point.y - element.points[0].y) <= radius;
  for (let index = 0; index < element.points.length - 1; index++) {
    if (distanceToSegment(point, element.points[index], element.points[index + 1]) <= radius) return true;
  }
  return false;
}

export function scaleElementFromAnchor(element: BoardElement, source: BoardElement, anchor: ScreenPoint, scale: number): void {
  element.updatedAt = new Date().toISOString();
  if (element.type === "image" && source.type === "image") {
    const sourceCenterX = source.x + source.width / 2;
    const sourceCenterY = source.y + source.height / 2;
    const centerX = anchor.x + (sourceCenterX - anchor.x) * scale;
    const centerY = anchor.y + (sourceCenterY - anchor.y) * scale;
    element.width = source.width * scale;
    element.height = source.height * scale;
    element.x = centerX - element.width / 2;
    element.y = centerY - element.height / 2;
  } else if (element.type === "stroke" && source.type === "stroke") {
    element.size = source.size * scale;
    if (source.brush) element.brush = { ...source.brush, size: source.brush.size * scale };
    element.points = source.points.map((point) => ({
      ...point,
      x: anchor.x + (point.x - anchor.x) * scale,
      y: anchor.y + (point.y - anchor.y) * scale
    }));
  }
}

export function translateElement(element: BoardElement, source: BoardElement, dx: number, dy: number): void {
  element.updatedAt = new Date().toISOString();
  if (element.type === "image" && source.type === "image") {
    element.x = source.x + dx;
    element.y = source.y + dy;
  } else if (element.type === "stroke" && source.type === "stroke") {
    element.points = source.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }));
  }
}

export function resizeImageFromHandle(image: BoardImage, source: BoardImage, handle: ResizeHandle, point: ScreenPoint, minimumSize: number): void {
  const anchorX = handle.includes("w") ? source.x + source.width : source.x;
  const anchorY = handle.includes("n") ? source.y + source.height : source.y;
  const signX = handle.includes("w") ? -1 : 1;
  const signY = handle.includes("n") ? -1 : 1;
  const desiredWidth = Math.max(minimumSize, (point.x - anchorX) * signX);
  const desiredHeight = Math.max(minimumSize, (point.y - anchorY) * signY);
  const scale = Math.max(minimumSize / Math.min(source.width, source.height), Math.min(desiredWidth / source.width, desiredHeight / source.height));
  image.width = source.width * scale;
  image.height = source.height * scale;
  image.x = signX > 0 ? anchorX : anchorX - image.width;
  image.y = signY > 0 ? anchorY : anchorY - image.height;
  image.updatedAt = new Date().toISOString();
}

export function handlePoints(bounds: Bounds): Record<ResizeHandle, ScreenPoint> {
  return {
    nw: { x: bounds.minX, y: bounds.minY },
    ne: { x: bounds.maxX, y: bounds.minY },
    se: { x: bounds.maxX, y: bounds.maxY },
    sw: { x: bounds.minX, y: bounds.maxY }
  };
}
