import {
  BoardData,
  BoardElement,
  BoardImage,
  BrushKind,
  DEFAULT_SETTINGS,
  Point,
  SCHEMA_VERSION,
  Stroke
} from "./types";
import { migrateBoard } from "./migrations";
import { createBoardRevision, normalizeBoardRevision } from "./revision";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizePoint(value: unknown): Point | null {
  if (!isRecord(value)) return null;
  const x = finite(value.x, Number.NaN);
  const y = finite(value.y, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    pressure: Math.min(1, Math.max(0, finite(value.pressure, 0.25))),
    time: finite(value.time, 0)
  };
}

function normalizeStroke(value: unknown): Stroke | null {
  if (!isRecord(value) || !Array.isArray(value.points)) return null;
  const rawTool = value.tool;
  if (rawTool !== "pen" && rawTool !== "highlighter" && rawTool !== "ballpoint") return null;
  const kind: BrushKind = rawTool === "highlighter" ? "highlighter" : rawTool === "ballpoint" ? "ballpoint" : "pen";
  const defaults = DEFAULT_SETTINGS.brushes[kind];
  const color = typeof value.color === "string" ? value.color : defaults.color;
  const size = Math.max(0.1, finite(value.size, defaults.size));
  const opacity = Math.min(1, Math.max(0.01, finite(value.opacity, kind === "highlighter" ? 0.32 : 1)));
  const rawBrush = isRecord(value.brush) ? value.brush : {};
  const pressure = rawBrush.pressure === "off" || rawBrush.pressure === "soft" || rawBrush.pressure === "standard" || rawBrush.pressure === "strong"
    ? rawBrush.pressure
    : defaults.pressure;
  const points = value.points.map(normalizePoint).filter((point): point is Point => point !== null);
  if (!points.length) return null;
  const now = new Date().toISOString();
  return {
    id: typeof value.id === "string" && value.id ? value.id : makeId("stroke"),
    type: "stroke",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
    locked: value.locked === true || undefined,
    tool: kind,
    color,
    size,
    opacity,
    brush: {
      kind,
      color: typeof rawBrush.color === "string" ? rawBrush.color : color,
      size: Math.max(0.1, finite(rawBrush.size, size)),
      opacity: Math.min(1, Math.max(0.01, finite(rawBrush.opacity, opacity))),
      pressure
    },
    points
  };
}

function normalizeImage(value: unknown): BoardImage | null {
  if (!isRecord(value) || typeof value.path !== "string" || !value.path) return null;
  const width = finite(value.width, Number.NaN);
  const height = finite(value.height, Number.NaN);
  if (!(width > 0) || !(height > 0)) return null;
  const rawCrop = isRecord(value.crop) ? value.crop : {};
  const cropX = Math.min(0.9999, Math.max(0, finite(rawCrop.x, 0)));
  const cropY = Math.min(0.9999, Math.max(0, finite(rawCrop.y, 0)));
  const cropWidth = Math.min(1 - cropX, Math.max(0.0001, finite(rawCrop.width, 1)));
  const cropHeight = Math.min(1 - cropY, Math.max(0.0001, finite(rawCrop.height, 1)));
  const now = new Date().toISOString();
  return {
    id: typeof value.id === "string" && value.id ? value.id : makeId("image"),
    type: "image",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
    locked: value.locked === true || undefined,
    path: value.path,
    x: finite(value.x, 0),
    y: finite(value.y, 0),
    width,
    height,
    rotation: ((finite(value.rotation, 0) % 360) + 360) % 360,
    crop: { x: cropX, y: cropY, width: cropWidth, height: cropHeight }
  };
}

export function emptyBoard(): BoardData {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    revision: createBoardRevision(),
    camera: { x: 0, y: 0, zoom: 1 },
    elements: []
  };
}

export function cloneBoard(data: BoardData): BoardData {
  return JSON.parse(JSON.stringify(data)) as BoardData;
}

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function parseBoard(raw: string): BoardData {
  const source: unknown = JSON.parse(raw);
  if (!isRecord(source)) throw new Error("Board root must be an object");
  const parsed = migrateBoard(source);
  const camera = isRecord(parsed.camera) ? parsed.camera : {};
  if (!Array.isArray(parsed.elements)) throw new Error("Board elements must be an array");
  const elements = parsed.elements.map((value, index): BoardElement => {
    if (!isRecord(value)) throw new Error(`Invalid element at index ${index}`);
    const element = value.type === "stroke" ? normalizeStroke(value) : value.type === "image" ? normalizeImage(value) : null;
    if (!element) throw new Error(`Invalid element at index ${index}`);
    return element;
  });
  const ids = new Set<string>();
  for (const element of elements) {
    if (ids.has(element.id)) throw new Error(`Duplicate element id ${element.id}`);
    ids.add(element.id);
  }
  const revision = normalizeBoardRevision(parsed.revision);
  if (!revision) throw new Error("Invalid board revision metadata");
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    revision,
    camera: {
      x: finite(camera.x, 0),
      y: finite(camera.y, 0),
      zoom: Math.min(8, Math.max(0.1, finite(camera.zoom, 1)))
    },
    elements
  };
}
