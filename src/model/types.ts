export const SCHEMA_VERSION = 5;

export type BrushKind = "ballpoint" | "pen" | "highlighter";
export type PressureMode = "off" | "soft" | "standard" | "strong";
export type EraserMode = "partial" | "stroke";
export type SelectionMode = "lasso" | "rectangle";
export type Tool = BrushKind | "laser" | "eraser" | "select" | "hand";

export interface BrushConfig {
  kind: BrushKind;
  color: string;
  size: number;
  opacity: number;
  pressure: PressureMode;
}

export interface LaserConfig {
  color: string;
  opacity?: number;
  size: number;
  holdMs: number;
  fadeMs: number;
  glow: number;
}

export interface PluginSettings {
  activeTool: Tool;
  brushes: Record<BrushKind, BrushConfig>;
  laser: LaserConfig;
  eraser: { mode: EraserMode; size: number };
  selectionMode: SelectionMode;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  activeTool: "pen",
  brushes: {
    ballpoint: { kind: "ballpoint", color: "#1c1c1e", size: 2.2, opacity: 1, pressure: "soft" },
    pen: { kind: "pen", color: "#1c1c1e", size: 3.6, opacity: 1, pressure: "strong" },
    highlighter: { kind: "highlighter", color: "#ffd60a", size: 18, opacity: 0.32, pressure: "off" }
  },
  laser: { color: "#ff3b30", opacity: 1, size: 5, holdMs: 2000, fadeMs: 500, glow: 12 },
  eraser: { mode: "partial", size: 28 },
  selectionMode: "lasso"
};

export interface Point {
  x: number;
  y: number;
  pressure: number;
  time: number;
}

export interface ElementBase {
  id: string;
  type: "stroke" | "image";
  createdAt: string;
  updatedAt: string;
  locked?: boolean;
}

export interface Stroke extends ElementBase {
  id: string;
  type: "stroke";
  tool: BrushKind;
  color: string;
  size: number;
  opacity?: number;
  brush?: BrushConfig;
  points: Point[];
}

export interface LaserStroke {
  id: string;
  points: Point[];
  config: LaserConfig;
  completedAt: number | null;
}

export interface BoardImage extends ElementBase {
  id: string;
  type: "image";
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  crop: { x: number; y: number; width: number; height: number };
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface BoardData {
  schemaVersion: number;
  updatedAt: string;
  revision: BoardRevision;
  camera: Camera;
  elements: BoardElement[];
}

export interface BoardRevision {
  documentId: string;
  revisionId: string;
  parentRevisionId: string | null;
  ancestors: string[];
  generation: number;
}

export type BoardElement = Stroke | BoardImage;

export interface ScreenPoint {
  x: number;
  y: number;
}
