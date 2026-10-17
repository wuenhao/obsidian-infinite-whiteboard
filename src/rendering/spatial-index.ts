import { BoardElement } from "../model/types";
import { Bounds, boundsIntersect, elementBounds } from "../selection/geometry";

function cellsFor(bounds: Bounds, cellSize: number): string[] {
  const keys: string[] = [];
  const minX = Math.floor(bounds.minX / cellSize);
  const minY = Math.floor(bounds.minY / cellSize);
  const maxX = Math.floor(bounds.maxX / cellSize);
  const maxY = Math.floor(bounds.maxY / cellSize);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) keys.push(`${x}:${y}`);
  }
  return keys;
}

export class ElementSpatialIndex {
  private readonly cells = new Map<string, Set<string>>();
  private readonly elementCells = new Map<string, string[]>();
  private readonly globalIds = new Set<string>();
  private readonly records = new Map<string, { element: BoardElement; bounds: Bounds }>();
  private readonly orderIds: string[] = [];
  private readonly orderById = new Map<string, number>();

  constructor(private readonly cellSize = 512) {}

  rebuild(elements: readonly BoardElement[]): void {
    this.clear();
    for (const element of elements) this.upsert(element);
  }

  upsert(element: BoardElement): void {
    if (!this.orderById.has(element.id)) {
      this.orderById.set(element.id, this.orderIds.length);
      this.orderIds.push(element.id);
    }
    this.removeCells(element.id);
    const bounds = elementBounds(element);
    this.records.set(element.id, { element, bounds });
    const horizontalCells = Math.floor(bounds.maxX / this.cellSize) - Math.floor(bounds.minX / this.cellSize) + 1;
    const verticalCells = Math.floor(bounds.maxY / this.cellSize) - Math.floor(bounds.minY / this.cellSize) + 1;
    if (horizontalCells * verticalCells > 4096) {
      this.globalIds.add(element.id);
      this.elementCells.set(element.id, []);
      return;
    }
    const keys = cellsFor(bounds, this.cellSize);
    this.elementCells.set(element.id, keys);
    for (const key of keys) {
      let ids = this.cells.get(key);
      if (!ids) {
        ids = new Set<string>();
        this.cells.set(key, ids);
      }
      ids.add(element.id);
    }
  }

  remove(id: string): void {
    this.removeCells(id);
    const index = this.orderById.get(id);
    if (index === undefined) return;
    this.orderIds.splice(index, 1);
    this.orderById.delete(id);
    this.reindexFrom(index);
  }

  /** Replaces an erased stroke in its layer position, including split fragments. */
  replace(id: string, fragments: readonly BoardElement[]): void {
    const index = this.orderById.get(id) ?? this.orderIds.length;
    this.remove(id);
    this.orderIds.splice(index, 0, ...fragments.map((fragment) => fragment.id));
    this.reindexFrom(index);
    for (const fragment of fragments) this.upsert(fragment);
  }

  private removeCells(id: string): void {
    this.globalIds.delete(id);
    this.records.delete(id);
    const keys = this.elementCells.get(id);
    if (!keys) return;
    for (const key of keys) {
      const ids = this.cells.get(key);
      ids?.delete(id);
      if (ids?.size === 0) this.cells.delete(key);
    }
    this.elementCells.delete(id);
  }

  private reindexFrom(index: number): void {
    for (let position = index; position < this.orderIds.length; position += 1) {
      this.orderById.set(this.orderIds[position], position);
    }
  }

  query(_elements: readonly BoardElement[], bounds: Bounds, includeIds: ReadonlySet<string> = new Set()): BoardElement[] {
    const horizontalCells = Math.floor(bounds.maxX / this.cellSize) - Math.floor(bounds.minX / this.cellSize) + 1;
    const verticalCells = Math.floor(bounds.maxY / this.cellSize) - Math.floor(bounds.minY / this.cellSize) + 1;
    const ids = new Set<string>(this.globalIds);
    // A zoomed-out or malformed query must not allocate millions of cell keys.
    if (horizontalCells * verticalCells > 4096) {
      for (const id of this.records.keys()) ids.add(id);
    } else {
      for (const key of cellsFor(bounds, this.cellSize)) {
        for (const id of this.cells.get(key) ?? []) ids.add(id);
      }
    }
    for (const id of includeIds) ids.add(id);
    const matches: Array<{ id: string; element: BoardElement }> = [];
    for (const id of ids) {
      const record = this.records.get(id);
      if (record && (includeIds.has(id) || boundsIntersect(record.bounds, bounds))) matches.push({ id, element: record.element });
    }
    matches.sort((left, right) => (this.orderById.get(left.id) ?? 0) - (this.orderById.get(right.id) ?? 0));
    return matches.map(({ element }) => element);
  }

  clear(): void {
    this.cells.clear();
    this.elementCells.clear();
    this.globalIds.clear();
    this.records.clear();
    this.orderIds.length = 0;
    this.orderById.clear();
  }
}
