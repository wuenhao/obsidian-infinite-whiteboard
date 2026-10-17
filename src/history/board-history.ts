import { cloneBoard } from "../model/board";
import { BoardData, BoardElement, Camera } from "../model/types";
import { Command, CommandHistory } from "./command-history";
import { IndexedElement, ReplaceElementsCommand } from "./element-commands";

class ReplaceBoardCommand implements Command<BoardData> {
  readonly label: string;
  readonly estimatedBytes: number;

  constructor(label: string, private readonly before: BoardData, private readonly after: BoardData) {
    this.label = label;
    this.estimatedBytes = (JSON.stringify(before).length + JSON.stringify(after).length) * 2;
  }

  execute(): BoardData {
    return cloneBoard(this.after);
  }

  undo(): BoardData {
    return cloneBoard(this.before);
  }
}

type PendingEdit =
  | { kind: "snapshot"; label: string; board: BoardData }
  | { kind: "elements"; label: string; elements: readonly BoardElement[]; camera: Camera };

export const HISTORY_MEMORY_BUDGET_BYTES = 32 * 1024 * 1024;

export class BoardHistory {
  private readonly commands = new CommandHistory<BoardData>(50, HISTORY_MEMORY_BUDGET_BYTES);
  private pending: PendingEdit | null = null;

  get usage(): Readonly<{ undoCount: number; redoCount: number; estimatedBytes: number }> {
    return this.commands.usage;
  }

  begin(current: BoardData, label = "编辑画板"): void {
    if (!this.pending) this.pending = { kind: "snapshot", label, board: cloneBoard(current) };
  }

  /** For gestures that replace or append elements without mutating existing objects in place. */
  beginElements(current: BoardData, label = "编辑画板"): void {
    if (!this.pending) this.pending = {
      kind: "elements", label, elements: [...current.elements], camera: { ...current.camera }
    };
  }

  commit(current: BoardData): void {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    if (pending.kind === "snapshot") {
      const after = cloneBoard(current);
      if (JSON.stringify(pending.board) !== JSON.stringify(after)) {
        this.commands.record(new ReplaceBoardCommand(pending.label, pending.board, after));
      }
      return;
    }
    const beforeById = new Map(pending.elements.map((element) => [element.id, element]));
    const afterById = new Map(current.elements.map((element) => [element.id, element]));
    const before: IndexedElement[] = pending.elements.flatMap((element, index) =>
      afterById.get(element.id) === element ? [] : [{ index, element }]
    );
    const after: IndexedElement[] = current.elements.flatMap((element, index) =>
      beforeById.get(element.id) === element ? [] : [{ index, element }]
    );
    const cameraChanged = pending.camera.x !== current.camera.x || pending.camera.y !== current.camera.y || pending.camera.zoom !== current.camera.zoom;
    if (before.length || after.length || cameraChanged) {
      this.commands.record(new ReplaceElementsCommand(
        before, after, pending.label,
        cameraChanged ? pending.camera : undefined,
        cameraChanged ? current.camera : undefined
      ));
    }
  }

  cancel(): void {
    this.pending = null;
  }

  recordApplied(command: Command<BoardData>): void {
    this.pending = null;
    this.commands.record(command);
  }

  undo(current: BoardData): BoardData {
    this.commit(current);
    return this.commands.undo(current);
  }

  redo(current: BoardData): BoardData {
    return this.commands.redo(current);
  }

  clear(): void {
    this.pending = null;
    this.commands.clear();
  }
}
