import { BoardElement, BoardImage } from "../model/types";
import { elementBounds, ImageCropHandle, translateElement } from "./geometry";

export type LayerDirection = "front" | "back" | "forward" | "backward";
export type Alignment = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";
export type Distribution = "horizontal" | "vertical";
export interface CropMargins { left: number; right: number; top: number; bottom: number }

export function reorderElements(elements: BoardElement[], selectedIds: ReadonlySet<string>, direction: LayerDirection): BoardElement[] {
  const selected = (element: BoardElement): boolean => selectedIds.has(element.id);
  const result = [...elements];
  if (direction === "front") return [...result.filter((element) => !selected(element)), ...result.filter(selected)];
  if (direction === "back") return [...result.filter(selected), ...result.filter((element) => !selected(element))];
  if (direction === "forward") {
    for (let index = result.length - 2; index >= 0; index--) {
      if (selected(result[index]) && !selected(result[index + 1])) [result[index], result[index + 1]] = [result[index + 1], result[index]];
    }
  } else {
    for (let index = 1; index < result.length; index++) {
      if (selected(result[index]) && !selected(result[index - 1])) [result[index], result[index - 1]] = [result[index - 1], result[index]];
    }
  }
  return result;
}

function selectedEditable(elements: BoardElement[], selectedIds: ReadonlySet<string>): BoardElement[] {
  return elements.filter((element) => selectedIds.has(element.id) && !element.locked);
}

export function alignElements(elements: BoardElement[], selectedIds: ReadonlySet<string>, alignment: Alignment): BoardElement[] {
  const result = elements.map((element) => selectedIds.has(element.id) && !element.locked ? structuredClone(element) : element);
  const selected = selectedEditable(result, selectedIds);
  if (selected.length < 2) return result;
  const bounds = selected.map(elementBounds);
  const target = alignment === "left" ? Math.min(...bounds.map((value) => value.minX))
    : alignment === "right" ? Math.max(...bounds.map((value) => value.maxX))
      : alignment === "top" ? Math.min(...bounds.map((value) => value.minY))
        : alignment === "bottom" ? Math.max(...bounds.map((value) => value.maxY))
          : alignment === "center-x" ? (Math.min(...bounds.map((value) => value.minX)) + Math.max(...bounds.map((value) => value.maxX))) / 2
            : (Math.min(...bounds.map((value) => value.minY)) + Math.max(...bounds.map((value) => value.maxY))) / 2;
  selected.forEach((element, index) => {
    const bound = bounds[index];
    const current = alignment === "left" ? bound.minX
      : alignment === "right" ? bound.maxX
        : alignment === "top" ? bound.minY
          : alignment === "bottom" ? bound.maxY
            : alignment === "center-x" ? (bound.minX + bound.maxX) / 2
              : (bound.minY + bound.maxY) / 2;
    const horizontal = alignment === "left" || alignment === "right" || alignment === "center-x";
    const delta = target - current;
    if (Math.abs(delta) > 1e-9) translateElement(element, structuredClone(element), horizontal ? delta : 0, horizontal ? 0 : delta);
  });
  return result;
}

export function distributeElements(elements: BoardElement[], selectedIds: ReadonlySet<string>, direction: Distribution): BoardElement[] {
  const result = elements.map((element) => selectedIds.has(element.id) && !element.locked ? structuredClone(element) : element);
  const selected = selectedEditable(result, selectedIds);
  if (selected.length < 3) return result;
  const entries = selected.map((element) => ({ element, bounds: elementBounds(element) })).sort((left, right) =>
    direction === "horizontal" ? left.bounds.minX - right.bounds.minX : left.bounds.minY - right.bounds.minY);
  const first = entries[0].bounds;
  const last = entries[entries.length - 1].bounds;
  const totalSize = entries.reduce((sum, entry) => sum + (direction === "horizontal" ? entry.bounds.maxX - entry.bounds.minX : entry.bounds.maxY - entry.bounds.minY), 0);
  const span = direction === "horizontal" ? last.maxX - first.minX : last.maxY - first.minY;
  const gap = (span - totalSize) / (entries.length - 1);
  let cursor = direction === "horizontal" ? first.minX : first.minY;
  for (const entry of entries) {
    const current = direction === "horizontal" ? entry.bounds.minX : entry.bounds.minY;
    const delta = cursor - current;
    if (Math.abs(delta) > 1e-9) translateElement(entry.element, structuredClone(entry.element), direction === "horizontal" ? delta : 0, direction === "vertical" ? delta : 0);
    cursor += (direction === "horizontal" ? entry.bounds.maxX - entry.bounds.minX : entry.bounds.maxY - entry.bounds.minY) + gap;
  }
  return result;
}

export function rotateImage(image: BoardImage, degrees: number): BoardImage {
  const result = structuredClone(image);
  result.rotation = ((result.rotation + degrees) % 360 + 360) % 360;
  result.updatedAt = new Date().toISOString();
  return result;
}

export function rotateImageToPoint(image: BoardImage, point: { x: number; y: number }): BoardImage {
  const centerX = image.x + image.width / 2;
  const centerY = image.y + image.height / 2;
  const degrees = Math.atan2(point.y - centerY, point.x - centerX) * 180 / Math.PI + 90;
  const result = structuredClone(image);
  result.rotation = ((degrees % 360) + 360) % 360;
  result.updatedAt = new Date().toISOString();
  return result;
}

export function cropImageFromHandle(image: BoardImage, handle: ImageCropHandle, point: { x: number; y: number }, minimumSize: number): BoardImage {
  const centerX = image.x + image.width / 2;
  const centerY = image.y + image.height / 2;
  const radians = -image.rotation * Math.PI / 180;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
  const left = -image.width / 2;
  const right = image.width / 2;
  const top = -image.height / 2;
  const bottom = image.height / 2;
  let nextLeft = left;
  let nextRight = right;
  let nextTop = top;
  let nextBottom = bottom;
  if (handle.includes("w")) nextLeft = Math.min(right - minimumSize, Math.max(left, localX));
  if (handle.includes("e")) nextRight = Math.max(left + minimumSize, Math.min(right, localX));
  if (handle.includes("n")) nextTop = Math.min(bottom - minimumSize, Math.max(top, localY));
  if (handle.includes("s")) nextBottom = Math.max(top + minimumSize, Math.min(bottom, localY));
  return cropImage(image, {
    left: (nextLeft - left) / image.width,
    right: (right - nextRight) / image.width,
    top: (nextTop - top) / image.height,
    bottom: (bottom - nextBottom) / image.height
  });
}

export function cropImage(image: BoardImage, margins: CropMargins): BoardImage {
  const left = Math.min(0.9, Math.max(0, margins.left));
  const right = Math.min(0.9 - left, Math.max(0, margins.right));
  const top = Math.min(0.9, Math.max(0, margins.top));
  const bottom = Math.min(0.9 - top, Math.max(0, margins.bottom));
  if (left + right + top + bottom <= 1e-9) return structuredClone(image);
  const widthScale = 1 - left - right;
  const heightScale = 1 - top - bottom;
  const centerX = image.x + image.width / 2;
  const centerY = image.y + image.height / 2;
  const localShiftX = image.width * (left - right) / 2;
  const localShiftY = image.height * (top - bottom) / 2;
  const radians = image.rotation * Math.PI / 180;
  const shiftedCenterX = centerX + localShiftX * Math.cos(radians) - localShiftY * Math.sin(radians);
  const shiftedCenterY = centerY + localShiftX * Math.sin(radians) + localShiftY * Math.cos(radians);
  const result = structuredClone(image);
  result.width = image.width * widthScale;
  result.height = image.height * heightScale;
  result.x = shiftedCenterX - result.width / 2;
  result.y = shiftedCenterY - result.height / 2;
  result.crop = {
    x: image.crop.x + image.crop.width * left,
    y: image.crop.y + image.crop.height * top,
    width: image.crop.width * widthScale,
    height: image.crop.height * heightScale
  };
  result.updatedAt = new Date().toISOString();
  return result;
}

export function resetImageCrop(image: BoardImage): BoardImage {
  if (image.crop.x === 0 && image.crop.y === 0 && image.crop.width === 1 && image.crop.height === 1) return structuredClone(image);
  const fullWidth = image.width / image.crop.width;
  const fullHeight = image.height / image.crop.height;
  const visibleSourceCenterX = image.crop.x + image.crop.width / 2;
  const visibleSourceCenterY = image.crop.y + image.crop.height / 2;
  const localShiftX = (0.5 - visibleSourceCenterX) * fullWidth;
  const localShiftY = (0.5 - visibleSourceCenterY) * fullHeight;
  const radians = image.rotation * Math.PI / 180;
  const currentCenterX = image.x + image.width / 2;
  const currentCenterY = image.y + image.height / 2;
  const fullCenterX = currentCenterX + localShiftX * Math.cos(radians) - localShiftY * Math.sin(radians);
  const fullCenterY = currentCenterY + localShiftX * Math.sin(radians) + localShiftY * Math.cos(radians);
  const result = structuredClone(image);
  result.x = fullCenterX - fullWidth / 2;
  result.y = fullCenterY - fullHeight / 2;
  result.width = fullWidth;
  result.height = fullHeight;
  result.crop = { x: 0, y: 0, width: 1, height: 1 };
  result.updatedAt = new Date().toISOString();
  return result;
}
