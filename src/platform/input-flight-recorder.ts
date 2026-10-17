export interface InputTraceEntry {
  sequence: number;
  at: number;
  event: string;
  details: string;
  state: string;
}

export class InputFlightRecorder {
  private entries: InputTraceEntry[] = [];
  private nextIndex = 0;
  private sequence = 0;
  private startedAt = new Date().toISOString();

  constructor(private readonly limit = 2000) {}

  record(at: number, event: string, details: string, state: string): void {
    const entry = { sequence: ++this.sequence, at, event, details, state };
    if (this.entries.length < this.limit) {
      this.entries.push(entry);
      return;
    }
    this.entries[this.nextIndex] = entry;
    this.nextIndex = (this.nextIndex + 1) % this.limit;
  }

  reset(): void {
    this.entries = [];
    this.sequence = 0;
    this.nextIndex = 0;
    this.startedAt = new Date().toISOString();
  }

  report(context: Readonly<Record<string, string | number | boolean>>): string {
    const header = Object.entries(context).map(([key, value]) => `${key}: ${value}`).join("\n");
    const ordered = this.entries.length < this.limit || this.nextIndex === 0
      ? this.entries
      : this.entries.slice(this.nextIndex).concat(this.entries.slice(0, this.nextIndex));
    const events = ordered.map((entry) =>
      `${entry.sequence.toString().padStart(4, "0")} t=${entry.at.toFixed(1)}ms ${entry.event} | ${entry.details} | ${entry.state}`
    ).join("\n");
    return ["Infinite Board input diagnostic", `startedAt: ${this.startedAt}`, header, "", events || "(no events)"].join("\n");
  }

  get size(): number {
    return this.entries.length;
  }
}
