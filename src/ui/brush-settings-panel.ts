import { setIcon } from "obsidian";
import { BrushKind, EraserMode, PluginSettings, PressureMode, SelectionMode, Tool } from "../model/types";
import { ColorSource, isColorTool, MORE_COLORS } from "./creative-toolbar";
import { bindRangeDrag } from "./touch-controls";

export type ConfigurableTool = BrushKind | "laser" | "eraser" | "select";

export function isConfigurableTool(tool: Tool): tool is ConfigurableTool {
  return tool === "ballpoint" || tool === "pen" || tool === "highlighter" || tool === "laser" || tool === "eraser" || tool === "select";
}

export interface BrushPanelActions {
  close(): void;
  updateButtons(): void;
  saveSettings(): void;
  scheduleRender(): void;
  colorSource(tool: BrushKind | "laser", color: string): ColorSource;
  setMoreColor(tool: BrushKind | "laser"): void;
}

/** Owns the settings DOM and disposes listeners from every previous render. */
export class BrushSettingsPanel {
  private listeners: AbortController | null = null;
  private readonly rangeCleanups: Array<() => void> = [];

  constructor(
    private readonly panel: HTMLElement,
    private readonly settings: PluginSettings,
    private readonly actions: BrushPanelActions
  ) {}

  dispose(): void {
    this.listeners?.abort();
    this.listeners = null;
    for (const cleanup of this.rangeCleanups.splice(0)) cleanup();
  }

  render(tool: Tool, colorOnlyRequested: boolean): void {
    this.dispose();
    this.panel.empty();
    if (!isConfigurableTool(tool)) {
      this.panel.hidden = true;
      return;
    }
    const signal = (this.listeners = new AbortController()).signal;
    const names: Record<ConfigurableTool, string> = {
      ballpoint: "圆珠笔", pen: "钢笔", highlighter: "荧光笔",
      laser: "激光笔", eraser: "橡皮擦", select: "选择"
    };
    const colorOnly = colorOnlyRequested && isColorTool(tool);
    const activeColorConfig = () => isColorTool(tool) ? tool === "laser" ? this.settings.laser : this.settings.brushes[tool] : null;
    this.panel.toggleClass("is-color-panel", colorOnly);
    this.panel.style.setProperty("--infinite-board-panel-ink", activeColorConfig()?.color ?? "#202022");
    const header = this.panel.createDiv({ cls: "infinite-board-brush-header" });
    header.createDiv({ cls: "infinite-board-brush-title", text: colorOnly ? "颜色" : names[tool] });
    const close = header.createEl("button", {
      cls: "infinite-board-panel-close",
      attr: { type: "button", "aria-label": "关闭设置", title: "关闭设置" }
    });
    setIcon(close, "x");
    close.addEventListener("click", this.actions.close, { signal });

    const addRange = (
      label: string, minimum: number, maximum: number, step: number, current: number,
      format: (value: number) => string, apply: (value: number) => void
    ): void => {
      const section = this.panel.createDiv({ cls: "infinite-board-brush-section infinite-board-range-section" });
      const heading = section.createDiv({ cls: "infinite-board-range-heading" });
      heading.createSpan({ text: label });
      const output = heading.createEl("output", { text: format(current) });
      const input = section.createEl("input", {
        cls: "infinite-board-range",
        attr: { type: "range", min: String(minimum), max: String(maximum), step: String(step), value: String(current), "aria-label": label }
      });
      if (colorOnly) input.addClass("is-opacity-range");
      this.rangeCleanups.push(bindRangeDrag(input));
      input.addEventListener("input", () => {
        const value = Number(input.value);
        apply(value);
        output.textContent = format(value);
        this.actions.updateButtons();
        const stroke = this.panel.querySelector<SVGPathElement>(".infinite-board-brush-preview-stroke");
        const config = activeColorConfig();
        if (stroke && config) {
          stroke.style.strokeWidth = `${Math.min(24, config.size)}px`;
          stroke.style.opacity = String(config.opacity ?? 1);
        }
        this.actions.scheduleRender();
      }, { signal });
      input.addEventListener("change", () => {
        this.actions.saveSettings();
        this.render(tool, colorOnlyRequested);
      }, { signal });
    };

    const addNamedOptions = <Value extends string>(
      label: string, values: readonly Value[], current: Value, labels: Record<Value, string>, apply: (value: Value) => void
    ): void => {
      const section = this.panel.createDiv({ cls: "infinite-board-brush-section" });
      section.createDiv({ cls: "infinite-board-brush-label", text: label });
      const options = section.createDiv({ cls: "infinite-board-options" });
      for (const value of values) {
        const option = options.createEl("button", {
          cls: `infinite-board-option${current === value ? " is-active" : ""}`,
          text: labels[value],
          attr: { type: "button", "aria-pressed": current === value ? "true" : "false" }
        });
        option.addEventListener("click", () => {
          apply(value);
          this.actions.saveSettings();
          this.render(tool, colorOnlyRequested);
          this.actions.scheduleRender();
        }, { signal });
      }
    };

    if (colorOnly) {
      const colorConfig = activeColorConfig();
      if (!colorConfig || !isColorTool(tool)) {
        this.panel.hidden = true;
        return;
      }
      const source = this.actions.colorSource(tool, colorConfig.color);
      const grid = this.panel.createDiv({ cls: "infinite-board-color-grid", attr: { role: "group", "aria-label": "更多颜色" } });
      for (const color of MORE_COLORS) {
        const active = source === "more" && color.toLowerCase() === colorConfig.color.toLowerCase();
        const swatch = grid.createEl("button", {
          cls: `infinite-board-color-cell${active ? " is-active" : ""}`,
          attr: { type: "button", "aria-label": `选择颜色 ${color}`, "aria-pressed": active ? "true" : "false" }
        });
        swatch.style.setProperty("--infinite-board-cell-color", color);
        swatch.addEventListener("click", () => {
          colorConfig.color = color;
          this.actions.setMoreColor(tool);
          this.actions.saveSettings();
          this.actions.updateButtons();
          this.render(tool, colorOnlyRequested);
          this.actions.scheduleRender();
        }, { signal });
      }
      const opacity = tool === "laser" ? (this.settings.laser.opacity ?? 1) : this.settings.brushes[tool].opacity;
      addRange("不透明度", 10, 100, 1, Math.round(opacity * 100), (value) => `${Math.round(value)}%`, (value) => {
        if (tool === "laser") this.settings.laser.opacity = value / 100;
        else this.settings.brushes[tool].opacity = value / 100;
      });
      const valueRow = this.panel.createDiv({ cls: "infinite-board-color-value" });
      const dot = valueRow.createSpan({ cls: "infinite-board-color-value-dot", attr: { "aria-hidden": "true" } });
      dot.style.backgroundColor = colorConfig.color;
      valueRow.createEl("output", { text: colorConfig.color.toUpperCase() });
      return;
    }

    if (tool === "eraser") {
      const eraser = this.settings.eraser;
      addNamedOptions<EraserMode>("擦除方式", ["partial", "stroke"], eraser.mode, { partial: "局部擦除", stroke: "整笔擦除" }, (value) => eraser.mode = value);
      addRange("大小", 12, 96, 1, eraser.size, (value) => `${Math.round(value)} px`, (value) => eraser.size = value);
      return;
    }
    if (tool === "select") {
      addNamedOptions<SelectionMode>("选择方式", ["lasso", "rectangle"], this.settings.selectionMode, { lasso: "自由套索", rectangle: "矩形框选" }, (value) => this.settings.selectionMode = value);
      return;
    }

    const colorConfig = activeColorConfig();
    if (!colorConfig || !isColorTool(tool)) return;
    const preview = this.panel.createDiv({ cls: "infinite-board-brush-preview", attr: { "aria-label": "笔刷效果预览" } });
    const previewSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    previewSvg.setAttribute("class", "infinite-board-brush-preview-svg");
    previewSvg.setAttribute("viewBox", "0 0 320 64");
    previewSvg.setAttribute("aria-hidden", "true");
    const previewStroke = document.createElementNS("http://www.w3.org/2000/svg", "path");
    previewStroke.setAttribute("class", `infinite-board-brush-preview-stroke is-${tool}`);
    previewStroke.setAttribute("d", "M 18 42 C 76 12, 126 14, 166 34 S 246 54, 302 20");
    previewStroke.style.stroke = colorConfig.color;
    previewStroke.style.color = colorConfig.color;
    const previewOpacity = tool === "laser" ? (this.settings.laser.opacity ?? 1) : this.settings.brushes[tool].opacity;
    previewStroke.style.opacity = String(previewOpacity);
    previewStroke.style.strokeWidth = `${Math.min(24, tool === "laser" ? this.settings.laser.size : this.settings.brushes[tool].size)}px`;
    previewSvg.appendChild(previewStroke);
    preview.appendChild(previewSvg);

    if (tool === "laser") {
      const laser = this.settings.laser;
      addRange("粗细", 1, 16, 0.5, laser.size, (value) => `${value} px`, (value) => laser.size = value);
      addRange("停留时间", 1, 10, 1, laser.holdMs / 1000, (value) => `${value} 秒`, (value) => laser.holdMs = value * 1000);
      addRange("光晕", 0, 24, 1, laser.glow, (value) => value === 0 ? "关闭" : `${value} px`, (value) => laser.glow = value);
      return;
    }

    const brush = this.settings.brushes[tool];
    const maximumSize = tool === "highlighter" ? 64 : 16;
    addRange("粗细", 1, maximumSize, 0.5, brush.size, (value) => `${value} px`, (value) => brush.size = value);
    addRange("透明度", 10, 100, 1, Math.round(brush.opacity * 100), (value) => `${Math.round(value)}%`, (value) => brush.opacity = value / 100);
    if (tool !== "highlighter") {
      const pressureValues: PressureMode[] = ["off", "soft", "standard", "strong"];
      const index = Math.max(0, pressureValues.indexOf(brush.pressure));
      addRange("压感强度", 0, 3, 1, index, (value) => `${Math.round(value / 3 * 100)}%`, (value) => {
        brush.pressure = pressureValues[Math.max(0, Math.min(3, Math.round(value)))];
      });
    }
  }
}
