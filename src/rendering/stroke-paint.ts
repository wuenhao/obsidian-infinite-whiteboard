import { BrushKind } from "../model/types";

export type StrokeCompositeOperation = "source-over";

/**
 * Persistent ink uses the browser's baseline source-over compositor.
 * Safari/WKWebView can produce incomplete-looking translucent strokes when
 * `multiply` is repeatedly redrawn on an accelerated canvas.
 */
export function strokeCompositeOperation(_kind: BrushKind): StrokeCompositeOperation {
  return "source-over";
}
