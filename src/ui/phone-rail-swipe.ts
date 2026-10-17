interface TouchContact {
  identifier: number;
  clientX: number;
  clientY: number;
}

export interface RailSwipeStep {
  scrollLeft: number | null;
  preventDefault: boolean;
}

/** Owns only a phone stationery-rail gesture, never the board canvas. */
export class PhoneRailSwipe {
  private contactId: number | null = null;
  private startX = 0;
  private startY = 0;
  private startScroll = 0;
  private scale = 1;
  private direction: "horizontal" | "vertical" | null = null;

  start(contacts: readonly TouchContact[], scrollLeft: number, scale = 1): void {
    this.reset();
    if (contacts.length !== 1) return;
    this.contactId = contacts[0].identifier;
    this.startX = contacts[0].clientX;
    this.startY = contacts[0].clientY;
    this.startScroll = scrollLeft;
    this.scale = Math.max(0.01, scale);
  }

  move(contacts: readonly TouchContact[]): RailSwipeStep {
    const contact = contacts.length === 1 ? contacts[0] : null;
    if (this.contactId === null || !contact || contact.identifier !== this.contactId) {
      this.reset();
      return { scrollLeft: null, preventDefault: true };
    }
    const dx = contact.clientX - this.startX;
    const dy = contact.clientY - this.startY;
    if (!this.direction) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 5) return { scrollLeft: null, preventDefault: false };
      this.direction = Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
    }
    return {
      scrollLeft: this.direction === "horizontal" ? this.startScroll - dx / this.scale : null,
      preventDefault: true
    };
  }

  end(): boolean {
    const swiped = this.direction !== null;
    this.reset();
    return swiped;
  }

  private reset(): void {
    this.contactId = null;
    this.direction = null;
  }
}

export function bindPhoneToolbarSwipe(toolbar: HTMLElement, rail: HTMLElement, signal: AbortSignal): void {
  const gesture = new PhoneRailSwipe();
  let suppressClick = false;
  let suppressTimer: ReturnType<typeof setTimeout> | undefined;
  const contacts = (event: TouchEvent): TouchContact[] => Array.from(event.touches);

  toolbar.addEventListener("touchstart", (event) => {
    globalThis.clearTimeout(suppressTimer);
    suppressClick = false;
    gesture.start(contacts(event), rail.scrollLeft, rail.getBoundingClientRect().width / Math.max(1, rail.clientWidth));
    event.stopPropagation();
  }, { passive: true, signal });
  toolbar.addEventListener("touchmove", (event) => {
    const step = gesture.move(contacts(event));
    if (step.scrollLeft !== null) {
      rail.classList.add("is-dragging");
      rail.scrollLeft = step.scrollLeft;
    }
    if (step.preventDefault && event.cancelable) event.preventDefault();
    event.stopPropagation();
  }, { passive: false, signal });
  const finish = (event: TouchEvent): void => {
    suppressClick = gesture.end();
    if (suppressClick) {
      globalThis.clearTimeout(suppressTimer);
      suppressTimer = globalThis.setTimeout(() => { suppressClick = false; }, 250);
    }
    rail.classList.remove("is-dragging");
    event.stopPropagation();
  };
  toolbar.addEventListener("touchend", finish, { passive: true, signal });
  toolbar.addEventListener("touchcancel", finish, { passive: true, signal });
  signal.addEventListener("abort", () => {
    globalThis.clearTimeout(suppressTimer);
    rail.classList.remove("is-dragging");
  }, { once: true });
  toolbar.addEventListener("click", (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, signal });

  // Obsidian may observe Pointer as well as Touch; leave target buttons intact
  // and stop only the touch-pointer bubble at this toolbar boundary.
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const) {
    toolbar.addEventListener(type, (event) => {
      if (event.pointerType === "touch") event.stopPropagation();
    }, { signal });
  }
}
