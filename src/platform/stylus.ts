export type StylusTouch = Touch & { touchType?: "direct" | "stylus" };
export type IosInputMode = "pointer-capture" | "native-touch";

export function usesNativeStylusTouch(isIosApp: boolean, mode: IosInputMode): boolean {
  return isIosApp && mode === "native-touch";
}

export function usesCanvasPointerCapture(isIosApp: boolean, mode: IosInputMode): boolean {
  return isIosApp && mode === "pointer-capture";
}

export function isStylusPointer(event: Pick<PointerEvent, "pointerType" | "width" | "height" | "pressure">): boolean {
  if (event.pointerType === "pen") return true;
  if (event.pointerType !== "touch") return false;
  return event.width <= 2 && event.height <= 2 && event.pressure > 0 && Math.abs(event.pressure - 0.5) > 0.01;
}

export function findStylusTouch(list: TouchList, acceptConfirmedContact = false): StylusTouch | null {
  return Array.from(list).map((touch) => touch as StylusTouch).find((touch) => {
    if (touch.touchType === "stylus") return true;
    if (touch.touchType !== undefined || touch.radiusX > 2 || touch.radiusY > 2) return false;
    if (acceptConfirmedContact) return true;
    return touch.force > 0 && Math.abs(touch.force - 0.5) > 0.01;
  }) ?? null;
}

export function findTouch(list: TouchList, identifier: number): StylusTouch | null {
  return Array.from(list).map((touch) => touch as StylusTouch).find((touch) => touch.identifier === identifier) ?? null;
}

export function shouldRecoverMissingStylus(touches: TouchList, changedTouches: TouchList, identifier: number): boolean {
  return findTouch(changedTouches, identifier) === null && findTouch(touches, identifier) === null;
}

export function isStylusOnlyTouchList(list: ArrayLike<{ touchType?: "direct" | "stylus" }>): boolean {
  const touches = Array.from(list);
  return touches.length > 0 && touches.every((touch) => touch.touchType === "stylus");
}

export function shouldRecoverPenPointerMove(
  event: Pick<PointerEvent, "pointerType" | "buttons" | "pressure">,
  hasActivePointer: boolean,
  targetsCanvas: boolean
): boolean {
  return !hasActivePointer
    && targetsCanvas
    && event.pointerType === "pen"
    && (event.buttons & 1) === 1
    && event.pressure > 0;
}

export function shouldStartStylusTouchFallback(
  usesPointerInput: boolean,
  hasActivePointer: boolean,
  isStylusTouch: boolean
): boolean {
  return usesPointerInput && !hasActivePointer && isStylusTouch;
}
