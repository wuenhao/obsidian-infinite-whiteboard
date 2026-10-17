export interface PasteMenuPoint { x: number; y: number }
export interface PasteMenuSize { width: number; height: number }

/** Client coordinates in the isolated iPad document need the iframe offset in the parent View. */
export function pasteMenuPointFromClient(client: PasteMenuPoint, viewOrigin: PasteMenuPoint, frameOrigin?: PasteMenuPoint): PasteMenuPoint {
  return {
    x: client.x + (frameOrigin?.x ?? 0) - viewOrigin.x,
    y: client.y + (frameOrigin?.y ?? 0) - viewOrigin.y
  };
}

/** iPad uses WebKit's native editable Paste action without an extra clipboard-read prompt. */
export function useSystemPasteTarget(isIosApp: boolean, isTablet: boolean): boolean {
  return isIosApp && isTablet;
}

/** Place the contextual paste control near the press within the View, not the isolated iPad canvas. */
export function pasteMenuPosition(point: PasteMenuPoint, menu: PasteMenuSize, view: PasteMenuSize, edge = 10): PasteMenuPoint {
  const maxX = Math.max(edge, view.width - menu.width - edge);
  const maxY = Math.max(edge, view.height - menu.height - edge);
  const above = point.y - menu.height - 12;
  const y = above >= edge ? above : point.y + 12;
  return {
    x: Math.max(edge, Math.min(maxX, point.x - menu.width / 2)),
    y: Math.max(edge, Math.min(maxY, y))
  };
}
