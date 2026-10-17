import { Point, Tool } from "../model/types";

export interface ToolDefinition {
  id: Tool;
  icon: string;
  label: string;
  role: "selection" | "navigation" | "drawing" | "eraser" | "transient";
  configurable: boolean;
  persistentOutput: boolean;
}

export interface ToolTransitionPlan {
  finishActiveInput: boolean;
  cancelActiveSelection: boolean;
  persistFinishedInput: boolean;
  clearSelection: boolean;
  clearEraserPreview: boolean;
}

/** UI lifecycle policy only; Pencil and finger event routing stays in the view. */
export function planToolTransition(previous: Tool, next: Tool, inputActive: boolean, inputPersistent: boolean): ToolTransitionPlan {
  const previousRole = TOOL_DEFINITIONS.find((definition) => definition.id === previous)?.role;
  const nextRole = TOOL_DEFINITIONS.find((definition) => definition.id === next)?.role;
  if (!previousRole || !nextRole) throw new Error(`Unknown tool transition: ${previous} → ${next}`);
  return {
    finishActiveInput: previous !== next && inputActive,
    cancelActiveSelection: previousRole === "selection",
    persistFinishedInput: previousRole !== "selection" && inputPersistent,
    clearSelection: nextRole !== "selection",
    clearEraserPreview: nextRole !== "eraser"
  };
}

export interface ToolInput {
  pointerId: number;
  point: Point;
  source: "pointer" | "stylus-touch";
}

export interface ToolController {
  onActivate(): void;
  onDeactivate(): void;
  onInputStart(input: ToolInput): void;
  onInputMove(input: ToolInput): void;
  onInputEnd(input: ToolInput): void;
  renderOverlay(context: CanvasRenderingContext2D): void;
}

export class ToolControllerRegistry {
  private readonly controllers = new Map<Tool, ToolController>();
  private activeTool: Tool | null = null;

  register(tool: Tool, controller: ToolController): void {
    this.controllers.set(tool, controller);
  }

  activate(tool: Tool): void {
    if (this.activeTool === tool) return;
    if (this.activeTool) this.controllers.get(this.activeTool)?.onDeactivate();
    this.activeTool = tool;
    this.controllers.get(tool)?.onActivate();
  }

  deactivate(): void {
    if (this.activeTool) this.controllers.get(this.activeTool)?.onDeactivate();
    this.activeTool = null;
  }

  renderOverlays(context: CanvasRenderingContext2D): void {
    for (const controller of this.controllers.values()) controller.renderOverlay(context);
  }
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  { id: "select", icon: "mouse-pointer-2", label: "选择", role: "selection", configurable: false, persistentOutput: false },
  { id: "hand", icon: "move", label: "移动画布", role: "navigation", configurable: false, persistentOutput: false },
  { id: "ballpoint", icon: "pen-line", label: "圆珠笔", role: "drawing", configurable: true, persistentOutput: true },
  { id: "pen", icon: "pen-tool", label: "钢笔", role: "drawing", configurable: true, persistentOutput: true },
  { id: "highlighter", icon: "highlighter", label: "荧光笔", role: "drawing", configurable: true, persistentOutput: true },
  { id: "laser", icon: "sparkles", label: "激光笔", role: "transient", configurable: true, persistentOutput: false },
  { id: "eraser", icon: "eraser", label: "局部橡皮擦", role: "eraser", configurable: false, persistentOutput: true }
] as const;
