import { BoardData, BoardElement, Camera } from "../model/types";
import { Command } from "./command-history";

function cloneElements(elements: readonly BoardElement[]): BoardElement[] {
  return elements.map((element) => structuredClone(element));
}

function estimatedBytes(value: unknown): number {
  return JSON.stringify(value).length * 2;
}

/** One undo step for replacements, removals and insertions in the same gesture. */
export class ReplaceElementsCommand implements Command<BoardData> {
  readonly estimatedBytes: number;
  private readonly before: IndexedElement[];
  private readonly after: IndexedElement[];
  private readonly changedIds: Set<string>;
  private readonly beforeCamera?: Camera;
  private readonly afterCamera?: Camera;

  constructor(
    before: readonly IndexedElement[],
    after: readonly IndexedElement[],
    readonly label = "编辑元素",
    beforeCamera?: Camera,
    afterCamera?: Camera
  ) {
    this.before = before.map((entry) => ({ index: entry.index, element: structuredClone(entry.element) }));
    this.after = after.map((entry) => ({ index: entry.index, element: structuredClone(entry.element) }));
    this.beforeCamera = beforeCamera ? { ...beforeCamera } : undefined;
    this.afterCamera = afterCamera ? { ...afterCamera } : undefined;
    this.changedIds = new Set([...this.before, ...this.after].map((entry) => entry.element.id));
    this.estimatedBytes = estimatedBytes([this.before, this.after, this.beforeCamera, this.afterCamera]);
  }

  execute(state: BoardData): BoardData {
    return this.apply(state, this.after, this.afterCamera);
  }

  undo(state: BoardData): BoardData {
    return this.apply(state, this.before, this.beforeCamera);
  }

  private apply(state: BoardData, entries: readonly IndexedElement[], camera?: Camera): BoardData {
    const elements = state.elements.filter((element) => !this.changedIds.has(element.id));
    for (const entry of entries) {
      elements.splice(Math.min(entry.index, elements.length), 0, structuredClone(entry.element));
    }
    return { ...state, elements, camera: camera ? { ...camera } : state.camera };
  }
}

export class UpdateElementsCommand implements Command<BoardData> {
  readonly label: string;
  readonly estimatedBytes: number;
  private readonly before: BoardElement[];
  private readonly after: BoardElement[];

  constructor(before: readonly BoardElement[], after: readonly BoardElement[], label = "移动或缩放元素") {
    this.label = label;
    this.before = cloneElements(before);
    this.after = cloneElements(after);
    this.estimatedBytes = estimatedBytes([this.before, this.after]);
  }

  execute(state: BoardData): BoardData {
    return this.apply(state, this.after);
  }

  undo(state: BoardData): BoardData {
    return this.apply(state, this.before);
  }

  private apply(state: BoardData, replacements: readonly BoardElement[]): BoardData {
    const byId = new Map(replacements.map((element) => [element.id, element]));
    return {
      ...state,
      elements: state.elements.map((element) => {
        const replacement = byId.get(element.id);
        return replacement ? structuredClone(replacement) : element;
      })
    };
  }
}

export interface IndexedElement {
  index: number;
  element: BoardElement;
}

export class DeleteElementsCommand implements Command<BoardData> {
  readonly label = "删除元素";
  readonly estimatedBytes: number;
  private readonly entries: IndexedElement[];

  constructor(entries: readonly IndexedElement[]) {
    this.entries = entries.map((entry) => ({ index: entry.index, element: structuredClone(entry.element) }));
    this.estimatedBytes = estimatedBytes(this.entries);
  }

  execute(state: BoardData): BoardData {
    const ids = new Set(this.entries.map((entry) => entry.element.id));
    return { ...state, elements: state.elements.filter((element) => !ids.has(element.id)) };
  }

  undo(state: BoardData): BoardData {
    const elements = [...state.elements];
    for (const entry of [...this.entries].sort((a, b) => a.index - b.index)) {
      elements.splice(Math.min(entry.index, elements.length), 0, structuredClone(entry.element));
    }
    return { ...state, elements };
  }
}

export class InsertElementsCommand implements Command<BoardData> {
  readonly label: string;
  readonly estimatedBytes: number;
  private readonly entries: IndexedElement[];

  constructor(entries: readonly IndexedElement[], label = "复制元素") {
    this.label = label;
    this.entries = entries.map((entry) => ({ index: entry.index, element: structuredClone(entry.element) }));
    this.estimatedBytes = estimatedBytes(this.entries);
  }

  execute(state: BoardData): BoardData {
    const existing = new Set(state.elements.map((element) => element.id));
    const elements = [...state.elements];
    for (const entry of [...this.entries].sort((a, b) => a.index - b.index)) {
      if (!existing.has(entry.element.id)) elements.splice(Math.min(entry.index, elements.length), 0, structuredClone(entry.element));
    }
    return { ...state, elements };
  }

  undo(state: BoardData): BoardData {
    const ids = new Set(this.entries.map((entry) => entry.element.id));
    return { ...state, elements: state.elements.filter((element) => !ids.has(element.id)) };
  }
}

export class ReorderElementsCommand implements Command<BoardData> {
  readonly label = "调整图层";
  readonly estimatedBytes: number;

  constructor(private readonly beforeIds: readonly string[], private readonly afterIds: readonly string[]) {
    this.estimatedBytes = estimatedBytes([beforeIds, afterIds]);
  }

  execute(state: BoardData): BoardData {
    return this.apply(state, this.afterIds);
  }

  undo(state: BoardData): BoardData {
    return this.apply(state, this.beforeIds);
  }

  private apply(state: BoardData, order: readonly string[]): BoardData {
    const byId = new Map(state.elements.map((element) => [element.id, element]));
    const ordered = order.map((id) => byId.get(id)).filter((element): element is BoardElement => element !== undefined);
    const included = new Set(order);
    return { ...state, elements: [...ordered, ...state.elements.filter((element) => !included.has(element.id))] };
  }
}
