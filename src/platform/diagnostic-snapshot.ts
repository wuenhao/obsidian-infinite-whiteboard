export interface DiagnosticCounters {
  orphanRecoveries: number;
  inputDocumentScrolls: number;
  hostDocumentScrolls: number;
  hostDocumentPenStarts: number;
  scribbleTouchCancels: number;
  recoveredPointerStarts: number;
  stylusTouchFallbackStarts: number;
  presentationRecoveryFrames: number;
  maxEventLoopDelayMs: number;
  lastSaveMs: number;
  maxSaveMs: number;
}

/** Produces stable, integer-valued report fields without retaining input events. */
export function diagnosticCounterSnapshot(counters: DiagnosticCounters): Readonly<DiagnosticCounters> {
  return {
    orphanRecoveries: Math.max(0, Math.round(counters.orphanRecoveries)),
    inputDocumentScrolls: Math.max(0, Math.round(counters.inputDocumentScrolls)),
    hostDocumentScrolls: Math.max(0, Math.round(counters.hostDocumentScrolls)),
    hostDocumentPenStarts: Math.max(0, Math.round(counters.hostDocumentPenStarts)),
    scribbleTouchCancels: Math.max(0, Math.round(counters.scribbleTouchCancels)),
    recoveredPointerStarts: Math.max(0, Math.round(counters.recoveredPointerStarts)),
    stylusTouchFallbackStarts: Math.max(0, Math.round(counters.stylusTouchFallbackStarts)),
    presentationRecoveryFrames: Math.max(0, Math.round(counters.presentationRecoveryFrames)),
    maxEventLoopDelayMs: Math.max(0, Math.round(counters.maxEventLoopDelayMs)),
    lastSaveMs: Math.max(0, Math.round(counters.lastSaveMs)),
    maxSaveMs: Math.max(0, Math.round(counters.maxSaveMs))
  };
}
