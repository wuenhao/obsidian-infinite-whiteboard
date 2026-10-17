import { Platform, setIcon } from "obsidian";
import { BrushKind, Tool } from "../model/types";
import { TOOL_DEFINITIONS } from "../tools/registry";
import { isConfigurableTool } from "./brush-settings-panel";
import { TOOLBAR_PRESET_COLORS } from "./creative-toolbar";
import { bindPhoneToolbarSwipe } from "./phone-rail-swipe";

export interface CreativeToolbarView {
  toolbar: HTMLElement;
  palette: HTMLElement;
  dispose(): void;
}

export interface CreativeToolbarActions {
  selectTool(tool: Tool): void;
  selectColor(color: string): void;
  openMoreColors(): void;
  collapse(): void;
}

/** Builds the agreed toolbar DOM and owns all of its event listeners. */
export function createCreativeToolbar(parent: HTMLElement, actions: CreativeToolbarActions): CreativeToolbarView {
  const controller = new AbortController();
  const signal = controller.signal;
  const toolbar = parent.createDiv({ cls: "infinite-board-toolbar", attr: { role: "toolbar", "aria-label": "创作工具" } });
  const navigation = toolbar.createDiv({ cls: "infinite-board-toolbar-navigation" });
  for (const tool of ["select", "hand"] as const) addToolButton(navigation, tool);
  toolbar.createDiv({ cls: "infinite-board-toolbar-divider", attr: { role: "separator" } });
  const rail = toolbar.createDiv({ cls: "infinite-board-instrument-rail", attr: { "aria-label": "画笔与橡皮" } });
  for (const tool of ["ballpoint", "pen", "highlighter", "laser", "eraser"] as const) addToolButton(rail, tool);
  if (Platform.isPhone) bindPhoneToolbarSwipe(toolbar, rail, signal);
  const palette = toolbar.createDiv({ cls: "infinite-board-toolbar-palette", attr: { "aria-label": "画笔颜色" } });
  for (const color of TOOLBAR_PRESET_COLORS) {
    const button = palette.createEl("button", {
      cls: "infinite-board-toolbar-swatch",
      attr: { type: "button", "aria-label": `选择颜色 ${color}`, "data-color": color }
    });
    button.style.setProperty("--infinite-board-swatch-color", color);
    button.createSpan({ cls: "infinite-board-swatch-fill", attr: { "aria-hidden": "true" } });
    button.addEventListener("click", () => actions.selectColor(color), { signal });
  }
  const more = palette.createEl("button", {
    cls: "infinite-board-toolbar-swatch infinite-board-more-colors",
    attr: { type: "button", "aria-label": "更多颜色", title: "更多颜色" }
  });
  const rainbow = more.createSpan({ cls: "infinite-board-swatch-fill", attr: { "aria-hidden": "true" } });
  rainbow.createSpan({ cls: "infinite-board-more-colors-core" });
  more.addEventListener("click", actions.openMoreColors, { signal });

  let drag: { pointerId: number; startX: number; startScroll: number; moved: boolean } | null = null;
  let suppressClick = false;
  let clickTimer = 0;
  rail.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || rail.scrollWidth <= rail.clientWidth) return;
    drag = { pointerId: event.pointerId, startX: event.clientX, startScroll: rail.scrollLeft, moved: false };
  }, { signal });
  rail.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(distance) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      rail.setPointerCapture(event.pointerId);
      rail.addClass("is-dragging");
    }
    rail.scrollLeft = drag.startScroll - distance;
  }, { signal });
  const finish = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.moved) {
      suppressClick = true;
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => { suppressClick = false; }, 80);
    }
    drag = null;
    rail.removeClass("is-dragging");
  };
  rail.addEventListener("pointerup", finish, { signal });
  rail.addEventListener("pointercancel", finish, { signal });
  rail.addEventListener("lostpointercapture", finish, { signal });
  rail.addEventListener("click", (event) => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, signal });
  rail.addEventListener("wheel", (event) => {
    if (rail.scrollWidth <= rail.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const previous = rail.scrollLeft;
    rail.scrollLeft += event.deltaY;
    if (rail.scrollLeft !== previous) event.preventDefault();
  }, { passive: false, signal });

  const collapseLabel = "收起创作工具栏";
  const toggle = toolbar.createEl("button", {
    cls: "infinite-board-tool infinite-board-action infinite-board-toolbar-toggle",
    attr: { type: "button", "aria-label": collapseLabel, title: collapseLabel, "aria-expanded": "true" }
  });
  setIcon(toggle, "chevron-down");
  toggle.addEventListener("click", () => {
    const collapsed = toolbar.classList.toggle("is-collapsed");
    setIcon(toggle, collapsed ? "pen-line" : "chevron-down");
    const label = collapsed ? "展开工具栏" : collapseLabel;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    if (collapsed) actions.collapse();
  }, { signal });

  return {
    toolbar,
    palette,
    dispose: () => {
      controller.abort();
      window.clearTimeout(clickTimer);
      drag = null;
    }
  };

  function addToolButton(container: HTMLElement, tool: Tool): void {
    const definition = TOOL_DEFINITIONS.find((candidate) => candidate.id === tool);
    if (!definition) return;
    const stationery = tool === "ballpoint" || tool === "pen" || tool === "highlighter" || tool === "laser" || tool === "eraser";
    const button = container.createEl("button", {
      cls: stationery ? `infinite-board-tool infinite-board-stationery infinite-board-stationery-${tool}` : "infinite-board-tool infinite-board-navigation-tool",
      attr: { type: "button", "aria-label": definition.label, title: isConfigurableTool(tool) ? `${definition.label} · 再次点击打开设置` : definition.label, "data-tool": tool }
    });
    if (stationery) buildStationery(button, tool);
    else setIcon(button, definition.icon);
    button.createSpan({ cls: "infinite-board-tool-label", text: definition.label });
    button.addEventListener("click", () => actions.selectTool(tool), { signal });
  }
}

function buildStationery(button: HTMLButtonElement, tool: BrushKind | "laser" | "eraser"): void {
  const object = button.createSpan({ cls: "infinite-board-stationery-object", attr: { "aria-hidden": "true" } });
  if (tool === "ballpoint") {
    object.createSpan({ cls: "infinite-board-stationery-tip" });
    object.createSpan({ cls: "infinite-board-stationery-cone" });
  } else if (tool === "pen") {
    const nib = object.createSpan({ cls: "infinite-board-stationery-nib" });
    nib.createSpan({ cls: "infinite-board-stationery-nib-slit" });
    nib.createSpan({ cls: "infinite-board-stationery-nib-hole" });
    object.createSpan({ cls: "infinite-board-stationery-neck" });
  } else if (tool === "highlighter") {
    object.createSpan({ cls: "infinite-board-stationery-chisel" });
    object.createSpan({ cls: "infinite-board-stationery-shoulder" });
  } else if (tool === "laser") {
    const lens = object.createSpan({ cls: "infinite-board-stationery-lens" });
    lens.createSpan({ cls: "infinite-board-stationery-lens-core" });
    object.createSpan({ cls: "infinite-board-stationery-switch" });
  } else {
    object.createSpan({ cls: "infinite-board-stationery-rubber" });
    object.createSpan({ cls: "infinite-board-stationery-ferrule" });
  }
  object.createSpan({ cls: "infinite-board-stationery-body" });
}
