import { BrushConfig, BrushKind, DEFAULT_SETTINGS, EraserMode, LaserConfig, PluginSettings, PressureMode, SelectionMode, Tool } from "../model/types";

const TOOLS: Tool[] = ["ballpoint", "pen", "highlighter", "laser", "eraser", "select", "hand"];
const PRESSURE_MODES: PressureMode[] = ["off", "soft", "standard", "strong"];
const ERASER_MODES: EraserMode[] = ["partial", "stroke"];
const SELECTION_MODES: SelectionMode[] = ["lasso", "rectangle"];

function numberInRange(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function brush(kind: BrushKind, loaded: Partial<BrushConfig> | undefined): BrushConfig {
  const defaults = DEFAULT_SETTINGS.brushes[kind];
  return {
    kind,
    color: color(loaded?.color, defaults.color),
    size: numberInRange(loaded?.size, defaults.size, 0.5, 64),
    opacity: numberInRange(loaded?.opacity, defaults.opacity, 0.01, 1),
    pressure: loaded?.pressure && PRESSURE_MODES.includes(loaded.pressure) ? loaded.pressure : defaults.pressure
  };
}

function laser(loaded: Partial<LaserConfig> | undefined): LaserConfig {
  const defaults = DEFAULT_SETTINGS.laser;
  return {
    color: color(loaded?.color, defaults.color),
    opacity: numberInRange(loaded?.opacity, defaults.opacity ?? 1, 0.1, 1),
    size: numberInRange(loaded?.size, defaults.size, 1, 64),
    holdMs: numberInRange(loaded?.holdMs, defaults.holdMs, 0, 10000),
    fadeMs: numberInRange(loaded?.fadeMs, defaults.fadeMs, 50, 5000),
    glow: numberInRange(loaded?.glow, defaults.glow, 0, 64)
  };
}

export function mergeSettings(loaded: Partial<PluginSettings> | null): PluginSettings {
  const activeTool = loaded?.activeTool && TOOLS.includes(loaded.activeTool) ? loaded.activeTool : DEFAULT_SETTINGS.activeTool;
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...loaded,
    activeTool,
    brushes: {
      ballpoint: brush("ballpoint", loaded?.brushes?.ballpoint),
      pen: brush("pen", loaded?.brushes?.pen),
      highlighter: brush("highlighter", loaded?.brushes?.highlighter)
    },
    laser: laser(loaded?.laser),
    eraser: {
      mode: loaded?.eraser?.mode && ERASER_MODES.includes(loaded.eraser.mode) ? loaded.eraser.mode : DEFAULT_SETTINGS.eraser.mode,
      size: numberInRange(loaded?.eraser?.size, DEFAULT_SETTINGS.eraser.size, 12, 96)
    },
    selectionMode: loaded?.selectionMode && SELECTION_MODES.includes(loaded.selectionMode) ? loaded.selectionMode : DEFAULT_SETTINGS.selectionMode
  };
}
