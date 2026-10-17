export interface Command<State> {
  readonly label: string;
  readonly estimatedBytes?: number;
  execute(state: State): State;
  undo(state: State): State;
}

interface HistoryEntry<State> {
  command: Command<State>;
  bytes: number;
}

export class CommandHistory<State> {
  private undoStack: HistoryEntry<State>[] = [];
  private redoStack: HistoryEntry<State>[] = [];
  private retainedBytes = 0;

  constructor(private readonly limit = 100, private readonly maxBytes = Number.POSITIVE_INFINITY) {}

  get usage(): Readonly<{ undoCount: number; redoCount: number; estimatedBytes: number }> {
    return { undoCount: this.undoStack.length, redoCount: this.redoStack.length, estimatedBytes: this.retainedBytes };
  }

  execute(command: Command<State>, state: State): State {
    const next = command.execute(state);
    this.record(command);
    return next;
  }

  record(command: Command<State>): void {
    for (const entry of this.redoStack) this.retainedBytes -= entry.bytes;
    this.redoStack = [];
    const bytes = Math.max(1, Math.floor(command.estimatedBytes ?? 1024));
    this.undoStack.push({ command, bytes });
    this.retainedBytes += bytes;
    // Keep the newest operation undoable even if it alone exceeds the budget.
    while (this.undoStack.length > 1 && (this.undoStack.length > this.limit || this.retainedBytes > this.maxBytes)) {
      this.retainedBytes -= this.undoStack.shift()?.bytes ?? 0;
    }
  }

  undo(state: State): State {
    const entry = this.undoStack.pop();
    if (!entry) return state;
    const previous = entry.command.undo(state);
    this.redoStack.push(entry);
    return previous;
  }

  redo(state: State): State {
    const entry = this.redoStack.pop();
    if (!entry) return state;
    const next = entry.command.execute(state);
    this.undoStack.push(entry);
    return next;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.retainedBytes = 0;
  }
}
