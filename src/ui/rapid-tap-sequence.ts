/** Detect a deliberate burst of taps without persisting gesture state. */
export class RapidTapSequence {
  private taps: number[] = [];

  constructor(private readonly requiredTaps = 5, private readonly windowMs = 1500) {}

  register(timestamp: number): boolean {
    this.taps = this.taps.filter((tap) => timestamp - tap <= this.windowMs);
    this.taps.push(timestamp);
    if (this.taps.length < this.requiredTaps) return false;
    this.reset();
    return true;
  }

  reset(): void {
    this.taps = [];
  }
}
