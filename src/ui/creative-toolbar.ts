import { BrushKind, Tool } from "../model/types";

export type ColorTool = BrushKind | "laser";
export type ColorSource = "preset" | "more";

export const TOOLBAR_PRESET_COLORS = ["#1c1c1e", "#007aff", "#34c759", "#ffd60a", "#ff3b30"] as const;

export const MORE_COLORS = [
  "#ffffff", "#eeeeef", "#d7d7da", "#b4b4ba", "#898991", "#62626b", "#3d3d45", "#202022",
  "#ffdddd", "#ffe8d1", "#fff2bd", "#e0f2ce", "#cff1e9", "#d5eaff", "#e4dcff", "#f5dcf6",
  "#ffabab", "#ffd096", "#ffe47a", "#bee596", "#9ae0ca", "#9dccfc", "#c5aff1", "#e7aee9",
  "#ff6268", "#ffac43", "#ffd03b", "#79cd54", "#45c49c", "#2184ff", "#9564de", "#d969d1",
  "#d93348", "#db7c1e", "#c6a310", "#3d9d48", "#148c77", "#2264b4", "#7043ae", "#a83f9c",
  "#822631", "#925324", "#7a671f", "#2c6235", "#215b51", "#254970", "#493267", "#6d305f"
] as const;

export function isColorTool(tool: Tool): tool is ColorTool {
  return tool === "ballpoint" || tool === "pen" || tool === "highlighter" || tool === "laser";
}

export function inferredColorSource(color: string): ColorSource {
  return TOOLBAR_PRESET_COLORS.some((preset) => preset.toLowerCase() === color.toLowerCase()) ? "preset" : "more";
}
