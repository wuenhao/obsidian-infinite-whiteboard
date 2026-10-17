import { BoardData } from "../model/types";
import { cloneBoard } from "../model/board";

export class SnapshotHistory {
  private undoStack: BoardData[] = [];
  private redoStack: BoardData[] = [];

  constructor(private readonly limit = 50) {}

  push(current: BoardData): void {
    this.undoStack.push(cloneBoard(current));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: BoardData): BoardData | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(cloneBoard(current));
    return previous;
  }

  redo(current: BoardData): BoardData | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(cloneBoard(current));
    return next;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
