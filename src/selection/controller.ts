import { BoardElement, ScreenPoint, SelectionMode } from "../model/types";
import {
  Bounds,
  ImageCropHandle,
  ResizeHandle,
  elementIntersectsLasso,
  elementIntersectsBounds,
  handlePoints,
  hitTestElement,
  imageCropHandlePoints,
  imageRotationHandlePoint,
  scaleElementFromAnchor,
  translateElement,
  unionBounds
} from "./geometry";
import { cropImageFromHandle, rotateImageToPoint } from "./operations";

export type ImageEditMode = "crop" | "rotate" | null;

export interface SelectionDragView {
  kind: "move" | "resize" | "crop" | "rotate" | "lasso" | "marquee";
  lasso: readonly ScreenPoint[];
}

export interface SelectionEdit {
  before: BoardElement[];
  after: BoardElement[];
}

type SelectionDrag = {
  pointerId: number;
  kind: "move" | "resize" | "crop" | "rotate" | "lasso" | "marquee";
  start: ScreenPoint;
  current: ScreenPoint;
  handle?: ResizeHandle;
  imageHandle?: ImageCropHandle;
  originals: Map<string, BoardElement>;
  baseSelection: Set<string>;
  lasso: ScreenPoint[];
  changed: boolean;
};

export class SelectionController {
  private ids = new Set<string>();
  private drag: SelectionDrag | null = null;
  private imageEditMode: ImageEditMode = null;

  get selectedIds(): ReadonlySet<string> {
    return this.ids;
  }

  get activePointerId(): number | null {
    return this.drag?.pointerId ?? null;
  }

  get dragView(): SelectionDragView | null {
    return this.drag ? { kind: this.drag.kind, lasso: this.drag.lasso } : null;
  }

  get editMode(): ImageEditMode {
    return this.imageEditMode;
  }

  setImageEditMode(mode: ImageEditMode): void {
    this.imageEditMode = mode;
    this.drag = null;
  }

  toggleImageEditMode(mode: Exclude<ImageEditMode, null>): void {
    this.setImageEditMode(this.imageEditMode === mode ? null : mode);
  }

  setSelected(ids: Iterable<string>): void {
    const next = new Set(ids);
    const changed = next.size !== this.ids.size || [...next].some((id) => !this.ids.has(id));
    this.ids = next;
    if (changed || this.ids.size !== 1) this.imageEditMode = null;
  }

  clear(): void {
    this.ids.clear();
    this.drag = null;
    this.imageEditMode = null;
  }

  selected(elements: BoardElement[]): BoardElement[] {
    return elements.filter((element) => this.ids.has(element.id));
  }

  bounds(elements: BoardElement[]): Bounds | null {
    return unionBounds(this.selected(elements));
  }

  transferPointer(pointerId: number): void {
    if (this.drag) this.drag.pointerId = pointerId;
  }

  start(elements: BoardElement[], hitCandidates: readonly BoardElement[], pointerId: number, world: ScreenPoint, zoom: number, additive: boolean, mode: SelectionMode = "lasso"): void {
    const selectedImage = this.singleEditableImage(elements);
    const imageHandle = selectedImage && this.imageEditMode === "crop" ? this.imageCropHandleAt(selectedImage, world, zoom) : null;
    const rotationHandle = selectedImage && this.imageEditMode === "rotate" && this.imageRotationHandleAt(selectedImage, world, zoom);
    const handle = imageHandle || rotationHandle ? null : this.resizeHandleAt(elements, world, zoom);
    const hit = imageHandle || rotationHandle ? selectedImage : handle ? this.selected(elements)[0] : this.hitElement(hitCandidates, world, zoom);
    if (hit && !this.ids.has(hit.id)) {
      if (!additive) this.ids.clear();
      this.ids.add(hit.id);
    } else if (hit && additive) {
      this.ids.delete(hit.id);
      this.drag = null;
      this.imageEditMode = null;
      return;
    }
    if (this.ids.size !== 1 || (hit && selectedImage && hit.id !== selectedImage.id)) this.imageEditMode = null;
    const originals = new Map<string, BoardElement>();
    for (const element of this.selected(elements)) originals.set(element.id, structuredClone(element));
    this.drag = {
      pointerId,
      kind: imageHandle ? "crop" : rotationHandle ? "rotate" : handle ? "resize" : hit ? "move" : mode === "rectangle" ? "marquee" : "lasso",
      start: world,
      current: world,
      handle: handle ?? undefined,
      imageHandle: imageHandle ?? undefined,
      originals,
      baseSelection: additive ? new Set(this.ids) : new Set<string>(),
      lasso: [world],
      changed: false
    };
    if (!hit && !additive) this.ids.clear();
  }

  update(elements: BoardElement[], point: ScreenPoint, zoom: number, selectionCandidates: readonly BoardElement[] = elements): boolean {
    const drag = this.drag;
    if (!drag) return false;
    drag.current = point;
    if (drag.kind === "lasso" || drag.kind === "marquee") {
      const previous = drag.lasso[drag.lasso.length - 1];
      if (drag.kind === "marquee") drag.lasso = [drag.start, point];
      else if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 2 / zoom) drag.lasso.push(point);
      const selected = new Set(drag.baseSelection);
      const bounds = {
        minX: Math.min(drag.start.x, point.x),
        minY: Math.min(drag.start.y, point.y),
        maxX: Math.max(drag.start.x, point.x),
        maxY: Math.max(drag.start.y, point.y)
      };
      for (const element of selectionCandidates) {
        if (drag.kind === "marquee" ? elementIntersectsBounds(element, bounds) : elementIntersectsLasso(element, drag.lasso)) selected.add(element.id);
      }
      this.ids = selected;
      return false;
    }
    if (!drag.changed && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 0.4 / zoom) return false;
    const editable = this.selected(elements).filter((element) => !element.locked);
    if (!editable.length) return false;
    drag.changed = true;
    if ((drag.kind === "crop" || drag.kind === "rotate") && editable.length === 1 && editable[0].type === "image") {
      const source = drag.originals.get(editable[0].id);
      if (!source || source.type !== "image") return false;
      const next = drag.kind === "crop" && drag.imageHandle
        ? cropImageFromHandle(source, drag.imageHandle, point, 24 / zoom)
        : rotateImageToPoint(source, point);
      Object.assign(editable[0], next);
    } else if (drag.kind === "resize" && drag.handle) {
      const originals = [...drag.originals.values()].filter((element) => !element.locked);
      const sourceBounds = unionBounds(originals);
      if (!sourceBounds) return false;
      const anchor = {
        x: drag.handle.includes("w") ? sourceBounds.maxX : sourceBounds.minX,
        y: drag.handle.includes("n") ? sourceBounds.maxY : sourceBounds.minY
      };
      const width = Math.max(1 / zoom, sourceBounds.maxX - sourceBounds.minX);
      const height = Math.max(1 / zoom, sourceBounds.maxY - sourceBounds.minY);
      const scale = Math.max(32 / zoom / Math.max(width, height), Math.hypot(point.x - anchor.x, point.y - anchor.y) / Math.hypot(width, height));
      for (const element of editable) {
        const source = drag.originals.get(element.id);
        if (source) scaleElementFromAnchor(element, source, anchor, scale);
      }
    } else {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      for (const element of editable) {
        const source = drag.originals.get(element.id);
        if (source) translateElement(element, source, dx, dy);
      }
    }
    return true;
  }

  finish(elements: BoardElement[], point: ScreenPoint, zoom: number, selectionCandidates: readonly BoardElement[] = elements): SelectionEdit | null {
    if (!this.drag) return null;
    this.update(elements, point, zoom, selectionCandidates);
    const drag = this.drag;
    this.drag = null;
    if (!drag.changed) return null;
    return {
      before: [...drag.originals.values()].map((element) => structuredClone(element)),
      after: this.selected(elements).map((element) => structuredClone(element))
    };
  }

  cancel(elements: BoardElement[]): boolean {
    if (!this.drag) return false;
    const drag = this.drag;
    this.drag = null;
    if (!drag.changed) return false;
    for (const element of elements) {
      const original = drag.originals.get(element.id);
      if (original) Object.assign(element, structuredClone(original));
    }
    return true;
  }

  private resizeHandleAt(elements: BoardElement[], point: ScreenPoint, zoom: number): ResizeHandle | null {
    const selected = this.selected(elements);
    if (!selected.length || selected.some((element) => element.locked)) return null;
    const bounds = unionBounds(selected);
    if (!bounds) return null;
    const tolerance = 14 / zoom;
    for (const [handle, position] of Object.entries(handlePoints(bounds)) as Array<[ResizeHandle, ScreenPoint]>) {
      if (Math.hypot(point.x - position.x, point.y - position.y) <= tolerance) return handle;
    }
    return null;
  }

  private singleEditableImage(elements: BoardElement[]) {
    const selected = this.selected(elements);
    return selected.length === 1 && selected[0].type === "image" && !selected[0].locked ? selected[0] : null;
  }

  private imageCropHandleAt(image: Extract<BoardElement, { type: "image" }>, point: ScreenPoint, zoom: number): ImageCropHandle | null {
    const tolerance = 14 / zoom;
    for (const [handle, position] of Object.entries(imageCropHandlePoints(image)) as Array<[ImageCropHandle, ScreenPoint]>) {
      if (Math.hypot(point.x - position.x, point.y - position.y) <= tolerance) return handle;
    }
    return null;
  }

  private imageRotationHandleAt(image: Extract<BoardElement, { type: "image" }>, point: ScreenPoint, zoom: number): boolean {
    const position = imageRotationHandlePoint(image, 34 / zoom);
    return Math.hypot(point.x - position.x, point.y - position.y) <= 14 / zoom;
  }

  private hitElement(elements: readonly BoardElement[], point: ScreenPoint, zoom: number): BoardElement | null {
    const tolerance = 8 / zoom;
    for (let index = elements.length - 1; index >= 0; index--) {
      const element = elements[index];
      if (hitTestElement(element, point, tolerance)) return element;
    }
    return null;
  }
}
