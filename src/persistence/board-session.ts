export interface BoardSessionToken {
  readonly id: number;
  readonly file: { path: string };
}

/** An epoch for async work owned by one loaded board, including reopen of the same path. */
export class BoardSession {
  private nextId = 0;
  private active: BoardSessionToken | null = null;

  begin(file: { path: string }): BoardSessionToken {
    const token = { id: ++this.nextId, file };
    this.active = token;
    return token;
  }

  currentForFile(file: { path: string }): BoardSessionToken | null {
    return this.active?.file === file ? this.active : null;
  }

  currentForPath(path: string): BoardSessionToken | null {
    return this.active?.file.path === path ? this.active : null;
  }

  isCurrent(token: BoardSessionToken): boolean {
    return this.active === token;
  }

  end(token: BoardSessionToken | null): void {
    if (token && this.isCurrent(token)) this.active = null;
  }
}

/** Lets unload wait for a write already started by this board before flushing edits. */
export class BoardSaveFlights {
  private readonly active = new Map<BoardSessionToken, Promise<void>>();

  track(token: BoardSessionToken, operation: Promise<void>): Promise<void> {
    const tracked = operation.finally(() => {
      if (this.active.get(token) === tracked) this.active.delete(token);
    });
    this.active.set(token, tracked);
    return tracked;
  }

  wait(token: BoardSessionToken): Promise<void> {
    return this.active.get(token) ?? Promise.resolve();
  }
}
