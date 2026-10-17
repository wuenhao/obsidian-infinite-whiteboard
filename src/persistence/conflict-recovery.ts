/** Tracks the actionable recovery copy for the currently loaded board. */
export class ConflictRecoveryState {
  private path: string | null = null;

  get currentPath(): string | null {
    return this.path;
  }

  record(path: string): void {
    this.path = path;
  }

  clear(): void {
    this.path = null;
  }
}
