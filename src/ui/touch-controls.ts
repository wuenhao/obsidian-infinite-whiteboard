import { Tool } from "../model/types";

/** Tools that accept a single finger as direct canvas input on phones. */
export function supportsPhoneFingerDrawing(tool: Tool): boolean {
  return tool === "ballpoint" || tool === "pen" || tool === "highlighter" || tool === "laser" || tool === "eraser" || tool === "select";
}

/** Explicit pointer dragging also works when iPad Scribble cancels native
 * range-control touch behavior. Mouse and keyboard retain native handling. */
export function bindRangeDrag(input: HTMLInputElement): () => void {
  let pointer: number | null = null;
  const apply = (event: PointerEvent): void => {
    const rect = input.getBoundingClientRect();
    const min = Number(input.min), max = Number(input.max), step = Number(input.step) || 1;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - 12) / Math.max(1, rect.width - 24)));
    input.value = String(Math.max(min, Math.min(max, min + Math.round(ratio * (max - min) / step) * step)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const down = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" || pointer !== null) return;
    pointer = event.pointerId;
    event.preventDefault();
    input.setPointerCapture(pointer);
    apply(event);
  };
  const move = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) return;
    event.preventDefault();
    apply(event);
  };
  const end = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) return;
    if (event.type === "pointerup") apply(event);
    const id = pointer;
    pointer = null;
    if (input.hasPointerCapture(id)) input.releasePointerCapture(id);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  input.addEventListener("pointerdown", down);
  input.addEventListener("pointermove", move);
  input.addEventListener("pointerup", end);
  input.addEventListener("pointercancel", end);
  input.addEventListener("lostpointercapture", end);
  return () => {
    input.removeEventListener("pointerdown", down);
    input.removeEventListener("pointermove", move);
    input.removeEventListener("pointerup", end);
    input.removeEventListener("pointercancel", end);
    input.removeEventListener("lostpointercapture", end);
  };
}

export interface FingerPoint { id: number; x: number; y: number }

/** Phone-only direct-touch camera input. It does not classify fingers by
 * pressure/contact size, nor run alongside the touch-pointer camera path. */
export function bindPhoneGestures(canvas: HTMLCanvasElement, update: (points: FingerPoint[], moving: boolean) => void, onPointer: (event: PointerEvent) => void): () => void {
  const touch = (event: TouchEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const points = Array.from(event.touches)
      .filter(t => t.target === canvas && (t as Touch & { touchType?: string }).touchType !== "stylus")
      .map(t => ({ id: t.identifier, x: t.clientX - rect.left, y: t.clientY - rect.top }));
    if (event.cancelable && Array.from(event.changedTouches).some(t => t.target === canvas && (t as Touch & { touchType?: string }).touchType !== "stylus")) event.preventDefault();
    update(points, event.type === "touchmove");
  };
  const pointer = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      onPointer(event);
      event.stopImmediatePropagation();
    }
  };
  const touchTypes = ["touchstart", "touchmove", "touchend", "touchcancel"] as const;
  const pointerTypes = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
  for (const type of touchTypes) canvas.addEventListener(type, touch, { passive: false });
  for (const type of pointerTypes) canvas.addEventListener(type, pointer, true);
  return () => {
    for (const type of touchTypes) canvas.removeEventListener(type, touch);
    for (const type of pointerTypes) canvas.removeEventListener(type, pointer, true);
  };
}
