export interface CanvasCssSize {
  width: number;
  height: number;
}

/**
 * Startup layout can emit several ResizeObserver sizes before a board is
 * stable. Only a resize after that settle point is a user-visible camera edit.
 */
export function persistedCameraResizeDelta(
  previous: CanvasCssSize | null,
  next: CanvasCssSize,
  persistenceReady: boolean
): { x: number; y: number } | null {
  if (!previous || !persistenceReady) return null;
  const x = (next.width - previous.width) / 2;
  const y = (next.height - previous.height) / 2;
  return x === 0 && y === 0 ? null : { x, y };
}
