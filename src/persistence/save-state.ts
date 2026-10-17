import { isExternalContent } from "./serialization";

export type SaveStartDecision = "skip" | "defer-input" | "defer-saving" | "start";
export type ExternalContentDecision = "ignore" | "reload" | "conflict";

export interface SaveStateSnapshot {
  dirty: boolean;
  revision: number;
  saving: boolean;
  resaveRequested: boolean;
  lastSavedContent: string;
  pendingWriteContent: string;
  conflictDetected: boolean;
}

/** Pure save/Sync state machine. Scheduling and Vault I/O stay in the view adapter. */
export class BoardSaveState {
  private state: SaveStateSnapshot = {
    dirty: false,
    revision: 0,
    saving: false,
    resaveRequested: false,
    lastSavedContent: "",
    pendingWriteContent: "",
    conflictDetected: false
  };

  snapshot(): Readonly<SaveStateSnapshot> {
    return { ...this.state };
  }

  get dirty(): boolean { return this.state.dirty; }
  get revision(): number { return this.state.revision; }
  get saving(): boolean { return this.state.saving; }
  get lastSavedContent(): string { return this.state.lastSavedContent; }
  get conflictDetected(): boolean { return this.state.conflictDetected; }

  initialize(content: string): void {
    this.state = { ...this.state, dirty: false, saving: false, resaveRequested: false, lastSavedContent: content, pendingWriteContent: "", conflictDetected: false };
  }

  markDirty(enabled: boolean): boolean {
    if (!enabled || this.state.conflictDetected) return false;
    this.state.dirty = true;
    this.state.revision += 1;
    return true;
  }

  decideSave(enabled: boolean, inputActive: boolean): SaveStartDecision {
    if (!enabled || this.state.conflictDetected || !this.state.dirty) return "skip";
    if (inputActive) {
      this.state.resaveRequested = true;
      return "defer-input";
    }
    if (this.state.saving) {
      this.state.resaveRequested = true;
      return "defer-saving";
    }
    this.state.saving = true;
    this.state.resaveRequested = false;
    return "start";
  }

  requestResave(): void {
    this.state.resaveRequested = true;
  }

  beginWrite(content: string): void {
    this.state.pendingWriteContent = content;
  }

  completeWrite(content: string, revisionAtStart: number): void {
    this.state.lastSavedContent = content;
    this.state.pendingWriteContent = "";
    this.state.dirty = this.state.revision !== revisionAtStart;
  }

  failWrite(): void {
    this.state.pendingWriteContent = "";
    this.state.dirty = true;
  }

  finishSave(): boolean {
    this.state.saving = false;
    const shouldResave = !this.state.conflictDetected && (this.state.resaveRequested || this.state.dirty);
    if (shouldResave) this.state.resaveRequested = false;
    return shouldResave;
  }

  classifyExternal(content: string): ExternalContentDecision {
    if (!isExternalContent(content, this.state.lastSavedContent, this.state.pendingWriteContent)) return "ignore";
    return this.state.dirty || this.state.saving ? "conflict" : "reload";
  }

  acceptExternal(content: string): void {
    this.state.lastSavedContent = content;
  }

  detectConflict(): void {
    this.state.conflictDetected = true;
  }
}
