var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => InfiniteBoardPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/model/types.ts
var SCHEMA_VERSION = 5;
var DEFAULT_SETTINGS = {
  activeTool: "pen",
  brushes: {
    ballpoint: { kind: "ballpoint", color: "#1c1c1e", size: 2.2, opacity: 1, pressure: "soft" },
    pen: { kind: "pen", color: "#1c1c1e", size: 3.6, opacity: 1, pressure: "strong" },
    highlighter: { kind: "highlighter", color: "#ffd60a", size: 18, opacity: 0.32, pressure: "off" }
  },
  laser: { color: "#ff3b30", opacity: 1, size: 5, holdMs: 2e3, fadeMs: 500, glow: 12 },
  eraser: { mode: "partial", size: 28 },
  selectionMode: "lasso"
};

// src/model/revision.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function newId(prefix) {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}
function uniqueIds(values) {
  if (!Array.isArray(values)) return [];
  const ids = [];
  for (const value of values) {
    if (typeof value === "string" && value && !ids.includes(value)) ids.push(value);
    if (ids.length === 32) break;
  }
  return ids;
}
function createBoardRevision() {
  return { documentId: newId("board"), revisionId: newId("revision"), parentRevisionId: null, ancestors: [], generation: 0 };
}
function advanceBoardRevision(current) {
  return {
    documentId: current.documentId,
    revisionId: newId("revision"),
    parentRevisionId: current.revisionId,
    ancestors: [current.revisionId, ...current.ancestors.filter((id) => id !== current.revisionId)].slice(0, 32),
    generation: current.generation + 1
  };
}
function normalizeBoardRevision(value) {
  if (!isRecord(value) || typeof value.documentId !== "string" || !value.documentId || typeof value.revisionId !== "string" || !value.revisionId) return null;
  const parentRevisionId = typeof value.parentRevisionId === "string" && value.parentRevisionId ? value.parentRevisionId : null;
  const ancestors = uniqueIds(value.ancestors);
  if (parentRevisionId && !ancestors.includes(parentRevisionId)) ancestors.unshift(parentRevisionId);
  return {
    documentId: value.documentId,
    revisionId: value.revisionId,
    parentRevisionId,
    ancestors: ancestors.slice(0, 32),
    generation: typeof value.generation === "number" && Number.isInteger(value.generation) && value.generation >= 0 ? value.generation : 0
  };
}
function legacyBoardRevision(board) {
  const elements = Array.isArray(board.elements) ? board.elements : [];
  const identity = `${typeof board.updatedAt === "string" ? board.updatedAt : ""}|${elements.map((element) => {
    var _a, _b;
    if (!isRecord(element)) return "?";
    return `${String((_a = element.id) != null ? _a : "")}:${String((_b = element.createdAt) != null ? _b : "")}`;
  }).join("|")}`;
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36);
  return { documentId: `legacy-board-${suffix}`, revisionId: `legacy-revision-${suffix}`, parentRevisionId: null, ancestors: [], generation: 0 };
}
function compareBoardRevisions(local, external) {
  if (local.documentId !== external.documentId) return "unrelated";
  if (local.revisionId === external.revisionId) return "same";
  if (external.ancestors.includes(local.revisionId)) return "newer";
  if (local.ancestors.includes(external.revisionId)) return "older";
  return "diverged";
}

// src/model/migrations.ts
var migrations = {
  1: (board) => ({ ...board, schemaVersion: 2 }),
  2: (board) => {
    const { strokes, images, ...rest } = board;
    if (strokes !== void 0 && !Array.isArray(strokes)) throw new Error("Schema 2 strokes must be an array");
    if (images !== void 0 && !Array.isArray(images)) throw new Error("Schema 2 images must be an array");
    const updatedAt = typeof board.updatedAt === "string" ? board.updatedAt : (/* @__PURE__ */ new Date()).toISOString();
    const prepare = (value) => typeof value === "object" && value !== null ? { createdAt: updatedAt, updatedAt, ...value } : value;
    return {
      ...rest,
      schemaVersion: 3,
      elements: [
        ...(images != null ? images : []).map(prepare),
        ...(strokes != null ? strokes : []).map(prepare)
      ]
    };
  },
  3: (board) => {
    if (!Array.isArray(board.elements)) throw new Error("Schema 3 elements must be an array");
    return {
      ...board,
      schemaVersion: 4,
      elements: board.elements.map((value) => value && typeof value === "object" && value.type === "image" ? { rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, ...value } : value)
    };
  },
  4: (board) => ({
    ...board,
    schemaVersion: 5,
    revision: legacyBoardRevision(board)
  })
};
function migrateBoard(source) {
  const rawVersion = source.schemaVersion;
  let version = typeof rawVersion === "number" && Number.isFinite(rawVersion) ? rawVersion : 1;
  if (!Number.isInteger(version) || version < 1) throw new Error(`Invalid board schema ${String(rawVersion)}`);
  if (version > SCHEMA_VERSION) throw new Error(`Unsupported board schema ${version}`);
  let board = { ...source };
  while (version < SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) throw new Error(`Missing board migration from schema ${version}`);
    board = migrate(board);
    version += 1;
  }
  return board;
}

// src/model/board.ts
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function normalizePoint(value) {
  if (!isRecord2(value)) return null;
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
function normalizeStroke(value) {
  if (!isRecord2(value) || !Array.isArray(value.points)) return null;
  const rawTool = value.tool;
  if (rawTool !== "pen" && rawTool !== "highlighter" && rawTool !== "ballpoint") return null;
  const kind = rawTool === "highlighter" ? "highlighter" : rawTool === "ballpoint" ? "ballpoint" : "pen";
  const defaults = DEFAULT_SETTINGS.brushes[kind];
  const color2 = typeof value.color === "string" ? value.color : defaults.color;
  const size = Math.max(0.1, finite(value.size, defaults.size));
  const opacity = Math.min(1, Math.max(0.01, finite(value.opacity, kind === "highlighter" ? 0.32 : 1)));
  const rawBrush = isRecord2(value.brush) ? value.brush : {};
  const pressure = rawBrush.pressure === "off" || rawBrush.pressure === "soft" || rawBrush.pressure === "standard" || rawBrush.pressure === "strong" ? rawBrush.pressure : defaults.pressure;
  const points = value.points.map(normalizePoint).filter((point) => point !== null);
  if (!points.length) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: typeof value.id === "string" && value.id ? value.id : makeId("stroke"),
    type: "stroke",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
    locked: value.locked === true || void 0,
    tool: kind,
    color: color2,
    size,
    opacity,
    brush: {
      kind,
      color: typeof rawBrush.color === "string" ? rawBrush.color : color2,
      size: Math.max(0.1, finite(rawBrush.size, size)),
      opacity: Math.min(1, Math.max(0.01, finite(rawBrush.opacity, opacity))),
      pressure
    },
    points
  };
}
function normalizeImage(value) {
  if (!isRecord2(value) || typeof value.path !== "string" || !value.path) return null;
  const width = finite(value.width, Number.NaN);
  const height = finite(value.height, Number.NaN);
  if (!(width > 0) || !(height > 0)) return null;
  const rawCrop = isRecord2(value.crop) ? value.crop : {};
  const cropX = Math.min(0.9999, Math.max(0, finite(rawCrop.x, 0)));
  const cropY = Math.min(0.9999, Math.max(0, finite(rawCrop.y, 0)));
  const cropWidth = Math.min(1 - cropX, Math.max(1e-4, finite(rawCrop.width, 1)));
  const cropHeight = Math.min(1 - cropY, Math.max(1e-4, finite(rawCrop.height, 1)));
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: typeof value.id === "string" && value.id ? value.id : makeId("image"),
    type: "image",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
    locked: value.locked === true || void 0,
    path: value.path,
    x: finite(value.x, 0),
    y: finite(value.y, 0),
    width,
    height,
    rotation: (finite(value.rotation, 0) % 360 + 360) % 360,
    crop: { x: cropX, y: cropY, width: cropWidth, height: cropHeight }
  };
}
function emptyBoard() {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    revision: createBoardRevision(),
    camera: { x: 0, y: 0, zoom: 1 },
    elements: []
  };
}
function cloneBoard(data) {
  return JSON.parse(JSON.stringify(data));
}
function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
function parseBoard(raw) {
  const source = JSON.parse(raw);
  if (!isRecord2(source)) throw new Error("Board root must be an object");
  const parsed = migrateBoard(source);
  const camera = isRecord2(parsed.camera) ? parsed.camera : {};
  if (!Array.isArray(parsed.elements)) throw new Error("Board elements must be an array");
  const elements = parsed.elements.map((value, index) => {
    if (!isRecord2(value)) throw new Error(`Invalid element at index ${index}`);
    const element = value.type === "stroke" ? normalizeStroke(value) : value.type === "image" ? normalizeImage(value) : null;
    if (!element) throw new Error(`Invalid element at index ${index}`);
    return element;
  });
  const ids = /* @__PURE__ */ new Set();
  for (const element of elements) {
    if (ids.has(element.id)) throw new Error(`Duplicate element id ${element.id}`);
    ids.add(element.id);
  }
  const revision = normalizeBoardRevision(parsed.revision);
  if (!revision) throw new Error("Invalid board revision metadata");
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : (/* @__PURE__ */ new Date()).toISOString(),
    revision,
    camera: {
      x: finite(camera.x, 0),
      y: finite(camera.y, 0),
      zoom: Math.min(8, Math.max(0.1, finite(camera.zoom, 1)))
    },
    elements
  };
}

// src/model/board-file-name.ts
function normalizedBoardName(value) {
  const name = value.trim().replace(/\.board$/i, "").trim();
  if (!name || /[\\/:*?"<>|]/.test(name)) return null;
  return name;
}

// src/plugin/settings.ts
var TOOLS = ["ballpoint", "pen", "highlighter", "laser", "eraser", "select", "hand"];
var PRESSURE_MODES = ["off", "soft", "standard", "strong"];
var ERASER_MODES = ["partial", "stroke"];
var SELECTION_MODES = ["lasso", "rectangle"];
function numberInRange(value, fallback, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}
function color(value, fallback) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
function brush(kind, loaded) {
  const defaults = DEFAULT_SETTINGS.brushes[kind];
  return {
    kind,
    color: color(loaded == null ? void 0 : loaded.color, defaults.color),
    size: numberInRange(loaded == null ? void 0 : loaded.size, defaults.size, 0.5, 64),
    opacity: numberInRange(loaded == null ? void 0 : loaded.opacity, defaults.opacity, 0.01, 1),
    pressure: (loaded == null ? void 0 : loaded.pressure) && PRESSURE_MODES.includes(loaded.pressure) ? loaded.pressure : defaults.pressure
  };
}
function laser(loaded) {
  var _a;
  const defaults = DEFAULT_SETTINGS.laser;
  return {
    color: color(loaded == null ? void 0 : loaded.color, defaults.color),
    opacity: numberInRange(loaded == null ? void 0 : loaded.opacity, (_a = defaults.opacity) != null ? _a : 1, 0.1, 1),
    size: numberInRange(loaded == null ? void 0 : loaded.size, defaults.size, 1, 64),
    holdMs: numberInRange(loaded == null ? void 0 : loaded.holdMs, defaults.holdMs, 0, 1e4),
    fadeMs: numberInRange(loaded == null ? void 0 : loaded.fadeMs, defaults.fadeMs, 50, 5e3),
    glow: numberInRange(loaded == null ? void 0 : loaded.glow, defaults.glow, 0, 64)
  };
}
function mergeSettings(loaded) {
  var _a, _b, _c, _d, _e;
  const activeTool = (loaded == null ? void 0 : loaded.activeTool) && TOOLS.includes(loaded.activeTool) ? loaded.activeTool : DEFAULT_SETTINGS.activeTool;
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...loaded,
    activeTool,
    brushes: {
      ballpoint: brush("ballpoint", (_a = loaded == null ? void 0 : loaded.brushes) == null ? void 0 : _a.ballpoint),
      pen: brush("pen", (_b = loaded == null ? void 0 : loaded.brushes) == null ? void 0 : _b.pen),
      highlighter: brush("highlighter", (_c = loaded == null ? void 0 : loaded.brushes) == null ? void 0 : _c.highlighter)
    },
    laser: laser(loaded == null ? void 0 : loaded.laser),
    eraser: {
      mode: ((_d = loaded == null ? void 0 : loaded.eraser) == null ? void 0 : _d.mode) && ERASER_MODES.includes(loaded.eraser.mode) ? loaded.eraser.mode : DEFAULT_SETTINGS.eraser.mode,
      size: numberInRange((_e = loaded == null ? void 0 : loaded.eraser) == null ? void 0 : _e.size, DEFAULT_SETTINGS.eraser.size, 12, 96)
    },
    selectionMode: (loaded == null ? void 0 : loaded.selectionMode) && SELECTION_MODES.includes(loaded.selectionMode) ? loaded.selectionMode : DEFAULT_SETTINGS.selectionMode
  };
}

// src/rendering/stroke-geometry.ts
function pressureScale(pressure, mode) {
  const normalized = Math.min(1, Math.max(0.05, pressure));
  if (mode === "off") return 1;
  if (mode === "soft") return 0.82 + 0.36 * normalized;
  if (mode === "standard") return 0.62 + 0.78 * normalized;
  return Math.min(1.67, 0.42 + 1.25 * Math.pow(normalized, 0.72));
}
function smoothCenterline(points) {
  if (points.length < 3) return points;
  const smoothed = points.map((point) => ({ ...point }));
  for (let index = 1; index < smoothed.length - 1; index++) {
    smoothed[index].x = smoothed[index - 1].x * 0.28 + points[index].x * 0.5 + points[index + 1].x * 0.22;
    smoothed[index].y = smoothed[index - 1].y * 0.28 + points[index].y * 0.5 + points[index + 1].y * 0.22;
  }
  for (let index = smoothed.length - 2; index > 0; index--) {
    smoothed[index].x = smoothed[index].x * 0.78 + smoothed[index + 1].x * 0.22;
    smoothed[index].y = smoothed[index].y * 0.78 + smoothed[index + 1].y * 0.22;
  }
  return smoothed;
}
function stabilizePressure(values, mode) {
  var _a;
  const normalized = [];
  for (const value of values) {
    normalized.push(Number.isFinite(value) && value > 0 ? Math.min(1, Math.max(0.05, value)) : (_a = normalized[normalized.length - 1]) != null ? _a : 0.35);
  }
  const result = normalized.map((_, index) => {
    let total = 0;
    let weightTotal = 0;
    for (let offset = -6; offset <= 6; offset++) {
      const sampleIndex = Math.min(normalized.length - 1, Math.max(0, index + offset));
      const weight = 7 - Math.abs(offset);
      total += normalized[sampleIndex] * weight;
      weightTotal += weight;
    }
    return total / weightTotal;
  });
  const maxDelta = mode === "soft" ? 0.012 : mode === "strong" ? 0.03 : 0.02;
  for (let index = 1; index < result.length; index++) {
    const delta = Math.max(-maxDelta, Math.min(maxDelta, result[index] - result[index - 1]));
    result[index] = result[index - 1] + delta;
  }
  return result;
}
function resampleCenterline(points, spacing) {
  const filtered = [];
  for (const point of points) {
    const previous = filtered[filtered.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.28) filtered.push(point);
  }
  const finalPoint = points[points.length - 1];
  if (finalPoint && filtered[filtered.length - 1] !== finalPoint) filtered.push(finalPoint);
  const base = smoothCenterline(filtered);
  if (base.length < 2) return base;
  const result = [];
  for (let index = 0; index < base.length - 1; index++) {
    const p0 = base[Math.max(0, index - 1)];
    const p1 = base[index];
    const p2 = base[index + 1];
    const p3 = base[Math.min(base.length - 1, index + 2)];
    const steps = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / spacing));
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        pressure: p1.pressure + (p2.pressure - p1.pressure) * t,
        time: p1.time + (p2.time - p1.time) * t
      });
    }
  }
  result.push({ ...base[base.length - 1] });
  return result;
}
function pressureOutline(points, size, mode) {
  const samples = resampleCenterline(points, 0.9);
  if (samples.length < 2) return samples;
  const pressures = stabilizePressure(samples.map((point) => point.pressure), mode);
  const left = [];
  const right = [];
  for (let index = 0; index < samples.length; index++) {
    const before = samples[Math.max(0, index - 1)];
    const after = samples[Math.min(samples.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.max(1e-4, Math.hypot(dx, dy));
    const nx = -dy / length;
    const ny = dx / length;
    const radius = size * pressureScale(pressures[index], mode) / 2;
    left.push({ ...samples[index], x: samples[index].x + nx * radius, y: samples[index].y + ny * radius });
    right.push({ ...samples[index], x: samples[index].x - nx * radius, y: samples[index].y - ny * radius });
  }
  const outline = [...left];
  const capSteps = 8;
  const end = samples[samples.length - 1];
  const endBefore = samples[samples.length - 2];
  const endAngle = Math.atan2(end.y - endBefore.y, end.x - endBefore.x);
  const endRadius = size * pressureScale(pressures[pressures.length - 1], mode) / 2;
  for (let step = 1; step <= capSteps; step++) {
    const angle = endAngle + Math.PI / 2 - Math.PI * step / capSteps;
    outline.push({ ...end, x: end.x + Math.cos(angle) * endRadius, y: end.y + Math.sin(angle) * endRadius });
  }
  for (let index = right.length - 2; index >= 0; index--) outline.push(right[index]);
  const start = samples[0];
  const startAfter = samples[1];
  const startAngle = Math.atan2(startAfter.y - start.y, startAfter.x - start.x);
  const startRadius = size * pressureScale(pressures[0], mode) / 2;
  for (let step = 1; step <= capSteps; step++) {
    const angle = startAngle - Math.PI / 2 - Math.PI * step / capSteps;
    outline.push({ ...start, x: start.x + Math.cos(angle) * startRadius, y: start.y + Math.sin(angle) * startRadius });
  }
  return outline;
}

// src/rendering/stroke-paint.ts
function strokeCompositeOperation(_kind) {
  return "source-over";
}

// src/rendering/render-metrics.ts
var RenderMetrics = class {
  constructor() {
    this.renderFrames = 0;
    this.maxRenderDurationMs = 0;
    this.sceneCacheBuilds = 0;
    this.sceneCacheHits = 0;
    this.maxSceneCacheBuildDurationMs = 0;
  }
  recordFrame(durationMs) {
    this.renderFrames += 1;
    this.maxRenderDurationMs = Math.max(this.maxRenderDurationMs, durationMs);
  }
  recordCacheBuild(durationMs) {
    this.sceneCacheBuilds += 1;
    this.maxSceneCacheBuildDurationMs = Math.max(this.maxSceneCacheBuildDurationMs, durationMs);
  }
  recordCacheHit() {
    this.sceneCacheHits += 1;
  }
  snapshot() {
    return {
      renderFrames: this.renderFrames,
      maxRenderDurationMs: this.maxRenderDurationMs,
      sceneCacheBuilds: this.sceneCacheBuilds,
      sceneCacheHits: this.sceneCacheHits,
      maxSceneCacheBuildDurationMs: this.maxSceneCacheBuildDurationMs
    };
  }
  reset() {
    this.renderFrames = 0;
    this.maxRenderDurationMs = 0;
    this.sceneCacheBuilds = 0;
    this.sceneCacheHits = 0;
    this.maxSceneCacheBuildDurationMs = 0;
  }
};

// src/rendering/scene-cache.ts
function sceneCacheKey(width, height, camera) {
  return `${width}x${height}:${camera.x}:${camera.y}:${camera.zoom}`;
}
function canReuseSceneCache(valid, cachedKey, nextKey) {
  return valid && cachedKey === nextKey;
}
var SceneCache = class {
  constructor() {
    this.canvas = null;
    this.valid = false;
    this.key = "";
  }
  resolve(source, camera, build) {
    const nextKey = sceneCacheKey(source.width, source.height, camera);
    if (!this.canvas) this.canvas = source.ownerDocument.createElement("canvas");
    if (this.canvas.width !== source.width || this.canvas.height !== source.height) {
      this.canvas.width = source.width;
      this.canvas.height = source.height;
      this.valid = false;
    }
    if (canReuseSceneCache(this.valid, this.key, nextKey)) return { canvas: this.canvas, reused: true };
    this.valid = false;
    const context = this.canvas.getContext("2d");
    if (!context) return { canvas: this.canvas, reused: false };
    build(context);
    this.valid = true;
    this.key = nextKey;
    return { canvas: this.canvas, reused: false };
  }
  invalidate() {
    this.valid = false;
  }
  release() {
    if (this.canvas) {
      this.canvas.width = 1;
      this.canvas.height = 1;
    }
    this.canvas = null;
    this.valid = false;
    this.key = "";
  }
};

// src/rendering/scene-renderer.ts
var SceneRenderer = class {
  constructor() {
    this.cache = new SceneCache();
    this.metrics = new RenderMetrics();
  }
  render(frame) {
    const frameStartedAt = performance.now();
    const rect = frame.canvas.getBoundingClientRect();
    const ratio = frame.canvas.width / Math.max(1, rect.width);
    const cacheStartedAt = performance.now();
    const scene = this.cache.resolve(frame.canvas, frame.camera, (context2) => {
      context2.setTransform(ratio, 0, 0, ratio, 0, 0);
      frame.drawBackground(context2, rect.width, rect.height);
      context2.save();
      context2.translate(frame.camera.x, frame.camera.y);
      context2.scale(frame.camera.zoom, frame.camera.zoom);
      frame.drawStaticWorld(context2);
      context2.restore();
    });
    const cacheDuration = performance.now() - cacheStartedAt;
    if (scene.reused) this.metrics.recordCacheHit();
    else this.metrics.recordCacheBuild(cacheDuration);
    const context = frame.context;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(scene.canvas, 0, 0);
    context.restore();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.save();
    context.translate(frame.camera.x, frame.camera.y);
    context.scale(frame.camera.zoom, frame.camera.zoom);
    frame.drawDynamicWorld(context);
    context.restore();
    this.metrics.recordFrame(performance.now() - frameStartedAt);
  }
  invalidate() {
    this.cache.invalidate();
  }
  release() {
    this.cache.release();
  }
  metricsSnapshot() {
    return this.metrics.snapshot();
  }
  resetMetrics() {
    this.metrics.reset();
  }
};

// src/history/command-history.ts
var CommandHistory = class {
  constructor(limit = 100, maxBytes = Number.POSITIVE_INFINITY) {
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.undoStack = [];
    this.redoStack = [];
    this.retainedBytes = 0;
  }
  get usage() {
    return { undoCount: this.undoStack.length, redoCount: this.redoStack.length, estimatedBytes: this.retainedBytes };
  }
  execute(command, state) {
    const next = command.execute(state);
    this.record(command);
    return next;
  }
  record(command) {
    var _a, _b, _c;
    for (const entry of this.redoStack) this.retainedBytes -= entry.bytes;
    this.redoStack = [];
    const bytes = Math.max(1, Math.floor((_a = command.estimatedBytes) != null ? _a : 1024));
    this.undoStack.push({ command, bytes });
    this.retainedBytes += bytes;
    while (this.undoStack.length > 1 && (this.undoStack.length > this.limit || this.retainedBytes > this.maxBytes)) {
      this.retainedBytes -= (_c = (_b = this.undoStack.shift()) == null ? void 0 : _b.bytes) != null ? _c : 0;
    }
  }
  undo(state) {
    const entry = this.undoStack.pop();
    if (!entry) return state;
    const previous = entry.command.undo(state);
    this.redoStack.push(entry);
    return previous;
  }
  redo(state) {
    const entry = this.redoStack.pop();
    if (!entry) return state;
    const next = entry.command.execute(state);
    this.undoStack.push(entry);
    return next;
  }
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.retainedBytes = 0;
  }
};

// src/history/element-commands.ts
function cloneElements(elements) {
  return elements.map((element) => structuredClone(element));
}
function estimatedBytes(value) {
  return JSON.stringify(value).length * 2;
}
var ReplaceElementsCommand = class {
  constructor(before, after, label = "\u7F16\u8F91\u5143\u7D20", beforeCamera, afterCamera) {
    this.label = label;
    this.before = before.map((entry) => ({ index: entry.index, element: structuredClone(entry.element) }));
    this.after = after.map((entry) => ({ index: entry.index, element: structuredClone(entry.element) }));
    this.beforeCamera = beforeCamera ? { ...beforeCamera } : void 0;
    this.afterCamera = afterCamera ? { ...afterCamera } : void 0;
    this.changedIds = new Set([...this.before, ...this.after].map((entry) => entry.element.id));
    this.estimatedBytes = estimatedBytes([this.before, this.after, this.beforeCamera, this.afterCamera]);
  }
  execute(state) {
    return this.apply(state, this.after, this.afterCamera);
  }
  undo(state) {
    return this.apply(state, this.before, this.beforeCamera);
  }
  apply(state, entries, camera) {
    const elements = state.elements.filter((element) => !this.changedIds.has(element.id));
    for (const entry of entries) {
      elements.splice(Math.min(entry.index, elements.length), 0, structuredClone(entry.element));
    }
    return { ...state, elements, camera: camera ? { ...camera } : state.camera };
  }
};
var UpdateElementsCommand = class {
  constructor(before, after, label = "\u79FB\u52A8\u6216\u7F29\u653E\u5143\u7D20") {
    this.label = label;
    this.before = cloneElements(before);
    this.after = cloneElements(after);
    this.estimatedBytes = estimatedBytes([this.before, this.after]);
  }
  execute(state) {
    return this.apply(state, this.after);
  }
  undo(state) {
    return this.apply(state, this.before);
  }
  apply(state, replacements) {
    const byId = new Map(replacements.map((element) => [element.id, element]));
    return {
      ...state,
      elements: state.elements.map((element) => {
        const replacement = byId.get(element.id);
        return replacement ? structuredClone(replacement) : element;
      })
    };
  }
};
var DeleteElementsCommand = class {
  constructor(entries) {
    this.label = "\u5220\u9664\u5143\u7D20";
    this.entries = entries.map((entry) => ({ index: entry.index, element: structuredClone(entry.element) }));
    this.estimatedBytes = estimatedBytes(this.entries);
  }
  execute(state) {
    const ids = new Set(this.entries.map((entry) => entry.element.id));
    return { ...state, elements: state.elements.filter((element) => !ids.has(element.id)) };
  }
  undo(state) {
    const elements = [...state.elements];
    for (const entry of [...this.entries].sort((a, b) => a.index - b.index)) {
      elements.splice(Math.min(entry.index, elements.length), 0, structuredClone(entry.element));
    }
    return { ...state, elements };
  }
};
var InsertElementsCommand = class {
  constructor(entries, label = "\u590D\u5236\u5143\u7D20") {
    this.label = label;
    this.entries = entries.map((entry) => ({ index: entry.index, element: structuredClone(entry.element) }));
    this.estimatedBytes = estimatedBytes(this.entries);
  }
  execute(state) {
    const existing = new Set(state.elements.map((element) => element.id));
    const elements = [...state.elements];
    for (const entry of [...this.entries].sort((a, b) => a.index - b.index)) {
      if (!existing.has(entry.element.id)) elements.splice(Math.min(entry.index, elements.length), 0, structuredClone(entry.element));
    }
    return { ...state, elements };
  }
  undo(state) {
    const ids = new Set(this.entries.map((entry) => entry.element.id));
    return { ...state, elements: state.elements.filter((element) => !ids.has(element.id)) };
  }
};

// src/history/board-history.ts
var ReplaceBoardCommand = class {
  constructor(label, before, after) {
    this.before = before;
    this.after = after;
    this.label = label;
    this.estimatedBytes = (JSON.stringify(before).length + JSON.stringify(after).length) * 2;
  }
  execute() {
    return cloneBoard(this.after);
  }
  undo() {
    return cloneBoard(this.before);
  }
};
var HISTORY_MEMORY_BUDGET_BYTES = 32 * 1024 * 1024;
var BoardHistory = class {
  constructor() {
    this.commands = new CommandHistory(50, HISTORY_MEMORY_BUDGET_BYTES);
    this.pending = null;
  }
  get usage() {
    return this.commands.usage;
  }
  begin(current, label = "\u7F16\u8F91\u753B\u677F") {
    if (!this.pending) this.pending = { kind: "snapshot", label, board: cloneBoard(current) };
  }
  /** For gestures that replace or append elements without mutating existing objects in place. */
  beginElements(current, label = "\u7F16\u8F91\u753B\u677F") {
    if (!this.pending) this.pending = {
      kind: "elements",
      label,
      elements: [...current.elements],
      camera: { ...current.camera }
    };
  }
  commit(current) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    if (pending.kind === "snapshot") {
      const after2 = cloneBoard(current);
      if (JSON.stringify(pending.board) !== JSON.stringify(after2)) {
        this.commands.record(new ReplaceBoardCommand(pending.label, pending.board, after2));
      }
      return;
    }
    const beforeById = new Map(pending.elements.map((element) => [element.id, element]));
    const afterById = new Map(current.elements.map((element) => [element.id, element]));
    const before = pending.elements.flatMap(
      (element, index) => afterById.get(element.id) === element ? [] : [{ index, element }]
    );
    const after = current.elements.flatMap(
      (element, index) => beforeById.get(element.id) === element ? [] : [{ index, element }]
    );
    const cameraChanged = pending.camera.x !== current.camera.x || pending.camera.y !== current.camera.y || pending.camera.zoom !== current.camera.zoom;
    if (before.length || after.length || cameraChanged) {
      this.commands.record(new ReplaceElementsCommand(
        before,
        after,
        pending.label,
        cameraChanged ? pending.camera : void 0,
        cameraChanged ? current.camera : void 0
      ));
    }
  }
  cancel() {
    this.pending = null;
  }
  recordApplied(command) {
    this.pending = null;
    this.commands.record(command);
  }
  undo(current) {
    this.commit(current);
    return this.commands.undo(current);
  }
  redo(current) {
    return this.commands.redo(current);
  }
  clear() {
    this.pending = null;
    this.commands.clear();
  }
};

// src/platform/stylus.ts
function usesNativeStylusTouch(isIosApp, mode) {
  return isIosApp && mode === "native-touch";
}
function usesCanvasPointerCapture(isIosApp, mode) {
  return isIosApp && mode === "pointer-capture";
}
function isStylusPointer(event) {
  if (event.pointerType === "pen") return true;
  if (event.pointerType !== "touch") return false;
  return event.width <= 2 && event.height <= 2 && event.pressure > 0 && Math.abs(event.pressure - 0.5) > 0.01;
}
function findStylusTouch(list, acceptConfirmedContact = false) {
  var _a;
  return (_a = Array.from(list).map((touch) => touch).find((touch) => {
    if (touch.touchType === "stylus") return true;
    if (touch.touchType !== void 0 || touch.radiusX > 2 || touch.radiusY > 2) return false;
    if (acceptConfirmedContact) return true;
    return touch.force > 0 && Math.abs(touch.force - 0.5) > 0.01;
  })) != null ? _a : null;
}
function findTouch(list, identifier) {
  var _a;
  return (_a = Array.from(list).map((touch) => touch).find((touch) => touch.identifier === identifier)) != null ? _a : null;
}
function shouldRecoverMissingStylus(touches, changedTouches, identifier) {
  return findTouch(changedTouches, identifier) === null && findTouch(touches, identifier) === null;
}
function isStylusOnlyTouchList(list) {
  const touches = Array.from(list);
  return touches.length > 0 && touches.every((touch) => touch.touchType === "stylus");
}
function shouldRecoverPenPointerMove(event, hasActivePointer, targetsCanvas) {
  return !hasActivePointer && targetsCanvas && event.pointerType === "pen" && (event.buttons & 1) === 1 && event.pressure > 0;
}
function shouldStartStylusTouchFallback(usesPointerInput, hasActivePointer, isStylusTouch) {
  return usesPointerInput && !hasActivePointer && isStylusTouch;
}

// src/persistence/serialization.ts
function persistentElement(element) {
  const base = {
    id: element.id,
    type: element.type,
    createdAt: element.createdAt,
    updatedAt: element.updatedAt,
    locked: element.locked
  };
  if (element.type === "image") {
    return {
      ...base,
      type: "image",
      path: element.path,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      crop: { ...element.crop }
    };
  }
  return {
    ...base,
    type: "stroke",
    tool: element.tool,
    color: element.color,
    size: element.size,
    opacity: element.opacity,
    brush: element.brush ? { ...element.brush } : void 0,
    points: element.points.map((point) => ({ ...point }))
  };
}
function serializeBoard(board) {
  const persistent = {
    schemaVersion: board.schemaVersion,
    updatedAt: board.updatedAt,
    revision: {
      documentId: board.revision.documentId,
      revisionId: board.revision.revisionId,
      parentRevisionId: board.revision.parentRevisionId,
      ancestors: [...board.revision.ancestors],
      generation: board.revision.generation
    },
    camera: board.camera,
    elements: board.elements.map(persistentElement)
  };
  return JSON.stringify(persistent);
}
function isExternalContent(current, lastSaved, pendingWrite) {
  return current !== lastSaved && current !== pendingWrite;
}

// src/persistence/save-state.ts
var BoardSaveState = class {
  constructor() {
    this.state = {
      dirty: false,
      revision: 0,
      saving: false,
      resaveRequested: false,
      lastSavedContent: "",
      pendingWriteContent: "",
      conflictDetected: false
    };
  }
  snapshot() {
    return { ...this.state };
  }
  get dirty() {
    return this.state.dirty;
  }
  get revision() {
    return this.state.revision;
  }
  get saving() {
    return this.state.saving;
  }
  get lastSavedContent() {
    return this.state.lastSavedContent;
  }
  get conflictDetected() {
    return this.state.conflictDetected;
  }
  initialize(content) {
    this.state = { ...this.state, dirty: false, saving: false, resaveRequested: false, lastSavedContent: content, pendingWriteContent: "", conflictDetected: false };
  }
  markDirty(enabled) {
    if (!enabled || this.state.conflictDetected) return false;
    this.state.dirty = true;
    this.state.revision += 1;
    return true;
  }
  decideSave(enabled, inputActive) {
    if (!enabled || this.state.conflictDetected || !this.state.dirty) return "skip";
    if (inputActive) {
      this.state.resaveRequested = true;
      return "defer-input";
    }
    if (this.state.saving) {
      this.state.resaveRequested = true;
      return "defer-saving";
    }
    this.state.saving = true;
    this.state.resaveRequested = false;
    return "start";
  }
  requestResave() {
    this.state.resaveRequested = true;
  }
  beginWrite(content) {
    this.state.pendingWriteContent = content;
  }
  completeWrite(content, revisionAtStart) {
    this.state.lastSavedContent = content;
    this.state.pendingWriteContent = "";
    this.state.dirty = this.state.revision !== revisionAtStart;
  }
  failWrite() {
    this.state.pendingWriteContent = "";
    this.state.dirty = true;
  }
  finishSave() {
    this.state.saving = false;
    const shouldResave = !this.state.conflictDetected && (this.state.resaveRequested || this.state.dirty);
    if (shouldResave) this.state.resaveRequested = false;
    return shouldResave;
  }
  classifyExternal(content) {
    if (!isExternalContent(content, this.state.lastSavedContent, this.state.pendingWriteContent)) return "ignore";
    return this.state.dirty || this.state.saving ? "conflict" : "reload";
  }
  acceptExternal(content) {
    this.state.lastSavedContent = content;
  }
  detectConflict() {
    this.state.conflictDetected = true;
  }
};

// src/persistence/conflict-recovery.ts
var ConflictRecoveryState = class {
  constructor() {
    this.path = null;
  }
  get currentPath() {
    return this.path;
  }
  record(path) {
    this.path = path;
  }
  clear() {
    this.path = null;
  }
};

// src/persistence/external-update.ts
function externalBoardUpdateDecision(local, external) {
  const relation = compareBoardRevisions(local, external);
  if (relation === "newer") return "reload";
  if (relation === "older") return "protect-older";
  if (relation === "same") return "protect-inconsistent";
  return "protect-diverged";
}

// src/persistence/board-session.ts
var BoardSession = class {
  constructor() {
    this.nextId = 0;
    this.active = null;
  }
  begin(file) {
    const token = { id: ++this.nextId, file };
    this.active = token;
    return token;
  }
  currentForFile(file) {
    var _a;
    return ((_a = this.active) == null ? void 0 : _a.file) === file ? this.active : null;
  }
  currentForPath(path) {
    var _a;
    return ((_a = this.active) == null ? void 0 : _a.file.path) === path ? this.active : null;
  }
  isCurrent(token) {
    return this.active === token;
  }
  end(token) {
    if (token && this.isCurrent(token)) this.active = null;
  }
};
var BoardSaveFlights = class {
  constructor() {
    this.active = /* @__PURE__ */ new Map();
  }
  track(token, operation) {
    const tracked = operation.finally(() => {
      if (this.active.get(token) === tracked) this.active.delete(token);
    });
    this.active.set(token, tracked);
    return tracked;
  }
  wait(token) {
    var _a;
    return (_a = this.active.get(token)) != null ? _a : Promise.resolve();
  }
};

// src/selection/geometry.ts
function imageLocalToWorld(image, point) {
  const centerX = image.x + image.width / 2;
  const centerY = image.y + image.height / 2;
  const radians = image.rotation * Math.PI / 180;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  return { x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians), y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians) };
}
function imageCorners(image) {
  const centerX = image.x + image.width / 2;
  const centerY = image.y + image.height / 2;
  const radians = image.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    { x: image.x, y: image.y },
    { x: image.x + image.width, y: image.y },
    { x: image.x + image.width, y: image.y + image.height },
    { x: image.x, y: image.y + image.height }
  ].map((point) => {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    return { x: centerX + dx * cosine - dy * sine, y: centerY + dx * sine + dy * cosine };
  });
}
function imageCropHandlePoints(image) {
  const left = image.x;
  const right = image.x + image.width;
  const top = image.y;
  const bottom = image.y + image.height;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  return {
    nw: imageLocalToWorld(image, { x: left, y: top }),
    n: imageLocalToWorld(image, { x: centerX, y: top }),
    ne: imageLocalToWorld(image, { x: right, y: top }),
    e: imageLocalToWorld(image, { x: right, y: centerY }),
    se: imageLocalToWorld(image, { x: right, y: bottom }),
    s: imageLocalToWorld(image, { x: centerX, y: bottom }),
    sw: imageLocalToWorld(image, { x: left, y: bottom }),
    w: imageLocalToWorld(image, { x: left, y: centerY })
  };
}
function imageRotationHandlePoint(image, distance) {
  return imageLocalToWorld(image, { x: image.x + image.width / 2, y: image.y - distance });
}
function elementBounds(element) {
  var _a, _b;
  if (element.type === "image") {
    const corners = imageCorners(element);
    return {
      minX: Math.min(...corners.map((point) => point.x)),
      minY: Math.min(...corners.map((point) => point.y)),
      maxX: Math.max(...corners.map((point) => point.x)),
      maxY: Math.max(...corners.map((point) => point.y))
    };
  }
  const radius = ((_b = (_a = element.brush) == null ? void 0 : _a.size) != null ? _b : element.size) / 2;
  const xs = element.points.map((point) => point.x);
  const ys = element.points.map((point) => point.y);
  return {
    minX: Math.min(...xs) - radius,
    minY: Math.min(...ys) - radius,
    maxX: Math.max(...xs) + radius,
    maxY: Math.max(...ys) + radius
  };
}
function unionBounds(elements) {
  if (!elements.length) return null;
  const bounds = elements.map(elementBounds);
  return {
    minX: Math.min(...bounds.map((value) => value.minX)),
    minY: Math.min(...bounds.map((value) => value.minY)),
    maxX: Math.max(...bounds.map((value) => value.maxX)),
    maxY: Math.max(...bounds.map((value) => value.maxY))
  };
}
function boundsIntersect(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
function pointInBounds(point, bounds, tolerance = 0) {
  return point.x >= bounds.minX - tolerance && point.x <= bounds.maxX + tolerance && point.y >= bounds.minY - tolerance && point.y <= bounds.maxY + tolerance;
}
function pointInPolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = a.y > point.y !== b.y > point.y && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}
function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function pointOnSegment(point, start, end) {
  return Math.abs(orientation(start, end, point)) <= 1e-9 && point.x >= Math.min(start.x, end.x) - 1e-9 && point.x <= Math.max(start.x, end.x) + 1e-9 && point.y >= Math.min(start.y, end.y) - 1e-9 && point.y <= Math.max(start.y, end.y) + 1e-9;
}
function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if ((abC > 0 && abD < 0 || abC < 0 && abD > 0) && (cdA > 0 && cdB < 0 || cdA < 0 && cdB > 0)) return true;
  return pointOnSegment(c, a, b) || pointOnSegment(d, a, b) || pointOnSegment(a, c, d) || pointOnSegment(b, c, d);
}
function polylineIntersectsPolygon(points, polygon) {
  for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex++) {
    for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex++) {
      if (segmentsIntersect(points[pointIndex], points[pointIndex + 1], polygon[edgeIndex], polygon[(edgeIndex + 1) % polygon.length])) return true;
    }
  }
  return false;
}
function elementIntersectsLasso(element, polygon) {
  if (polygon.length < 3) return false;
  if (element.type === "stroke") {
    return element.points.some((point) => pointInPolygon(point, polygon)) || polylineIntersectsPolygon(element.points, polygon);
  }
  const corners = imageCorners(element);
  return corners.some((point) => pointInPolygon(point, polygon)) || polygon.some((point) => pointInPolygon(point, corners)) || polylineIntersectsPolygon([...corners, corners[0]], polygon);
}
function elementIntersectsBounds(element, bounds) {
  var _a, _b;
  if (!boundsIntersect(elementBounds(element), bounds)) return false;
  const rectangle = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY }
  ];
  if (element.type === "image") {
    const corners = imageCorners(element);
    return corners.some((point) => pointInBounds(point, bounds)) || rectangle.some((point) => pointInPolygon(point, corners)) || polylineIntersectsPolygon([...corners, corners[0]], rectangle);
  }
  const radius = ((_b = (_a = element.brush) == null ? void 0 : _a.size) != null ? _b : element.size) / 2;
  const expanded = { minX: bounds.minX - radius, minY: bounds.minY - radius, maxX: bounds.maxX + radius, maxY: bounds.maxY + radius };
  if (element.points.some((point) => pointInBounds(point, expanded))) return true;
  for (let index = 0; index < element.points.length - 1; index++) {
    const start = element.points[index];
    const end = element.points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let minimum = 0;
    let maximum = 1;
    const clips = [
      [-dx, start.x - expanded.minX],
      [dx, expanded.maxX - start.x],
      [-dy, start.y - expanded.minY],
      [dy, expanded.maxY - start.y]
    ];
    let intersects = true;
    for (const [direction, distance] of clips) {
      if (direction === 0) {
        if (distance < 0) intersects = false;
        continue;
      }
      const ratio = distance / direction;
      if (direction < 0) minimum = Math.max(minimum, ratio);
      else maximum = Math.min(maximum, ratio);
      if (minimum > maximum) intersects = false;
    }
    if (intersects) return true;
  }
  return false;
}
function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}
function hitTestElement(element, point, tolerance) {
  var _a, _b;
  if (!pointInBounds(point, elementBounds(element), tolerance)) return false;
  if (element.type === "image") {
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const radians = -element.rotation * Math.PI / 180;
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const local = {
      x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians)
    };
    return pointInBounds(local, { minX: element.x, minY: element.y, maxX: element.x + element.width, maxY: element.y + element.height }, tolerance);
  }
  const radius = ((_b = (_a = element.brush) == null ? void 0 : _a.size) != null ? _b : element.size) / 2 + tolerance;
  if (element.points.length === 1) return Math.hypot(point.x - element.points[0].x, point.y - element.points[0].y) <= radius;
  for (let index = 0; index < element.points.length - 1; index++) {
    if (distanceToSegment(point, element.points[index], element.points[index + 1]) <= radius) return true;
  }
  return false;
}
function scaleElementFromAnchor(element, source, anchor, scale) {
  element.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (element.type === "image" && source.type === "image") {
    const sourceCenterX = source.x + source.width / 2;
    const sourceCenterY = source.y + source.height / 2;
    const centerX = anchor.x + (sourceCenterX - anchor.x) * scale;
    const centerY = anchor.y + (sourceCenterY - anchor.y) * scale;
    element.width = source.width * scale;
    element.height = source.height * scale;
    element.x = centerX - element.width / 2;
    element.y = centerY - element.height / 2;
  } else if (element.type === "stroke" && source.type === "stroke") {
    element.size = source.size * scale;
    if (source.brush) element.brush = { ...source.brush, size: source.brush.size * scale };
    element.points = source.points.map((point) => ({
      ...point,
      x: anchor.x + (point.x - anchor.x) * scale,
      y: anchor.y + (point.y - anchor.y) * scale
    }));
  }
}
function translateElement(element, source, dx, dy) {
  element.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (element.type === "image" && source.type === "image") {
    element.x = source.x + dx;
    element.y = source.y + dy;
  } else if (element.type === "stroke" && source.type === "stroke") {
    element.points = source.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }));
  }
}
function handlePoints(bounds) {
  return {
    nw: { x: bounds.minX, y: bounds.minY },
    ne: { x: bounds.maxX, y: bounds.minY },
    se: { x: bounds.maxX, y: bounds.maxY },
    sw: { x: bounds.minX, y: bounds.maxY }
  };
}

// src/selection/operations.ts
function selectedEditable(elements, selectedIds) {
  return elements.filter((element) => selectedIds.has(element.id) && !element.locked);
}
function alignElements(elements, selectedIds, alignment) {
  const result = elements.map((element) => selectedIds.has(element.id) && !element.locked ? structuredClone(element) : element);
  const selected = selectedEditable(result, selectedIds);
  if (selected.length < 2) return result;
  const bounds = selected.map(elementBounds);
  const target = alignment === "left" ? Math.min(...bounds.map((value) => value.minX)) : alignment === "right" ? Math.max(...bounds.map((value) => value.maxX)) : alignment === "top" ? Math.min(...bounds.map((value) => value.minY)) : alignment === "bottom" ? Math.max(...bounds.map((value) => value.maxY)) : alignment === "center-x" ? (Math.min(...bounds.map((value) => value.minX)) + Math.max(...bounds.map((value) => value.maxX))) / 2 : (Math.min(...bounds.map((value) => value.minY)) + Math.max(...bounds.map((value) => value.maxY))) / 2;
  selected.forEach((element, index) => {
    const bound = bounds[index];
    const current = alignment === "left" ? bound.minX : alignment === "right" ? bound.maxX : alignment === "top" ? bound.minY : alignment === "bottom" ? bound.maxY : alignment === "center-x" ? (bound.minX + bound.maxX) / 2 : (bound.minY + bound.maxY) / 2;
    const horizontal = alignment === "left" || alignment === "right" || alignment === "center-x";
    const delta = target - current;
    if (Math.abs(delta) > 1e-9) translateElement(element, structuredClone(element), horizontal ? delta : 0, horizontal ? 0 : delta);
  });
  return result;
}
function distributeElements(elements, selectedIds, direction) {
  const result = elements.map((element) => selectedIds.has(element.id) && !element.locked ? structuredClone(element) : element);
  const selected = selectedEditable(result, selectedIds);
  if (selected.length < 3) return result;
  const entries = selected.map((element) => ({ element, bounds: elementBounds(element) })).sort((left, right) => direction === "horizontal" ? left.bounds.minX - right.bounds.minX : left.bounds.minY - right.bounds.minY);
  const first = entries[0].bounds;
  const last = entries[entries.length - 1].bounds;
  const totalSize = entries.reduce((sum, entry) => sum + (direction === "horizontal" ? entry.bounds.maxX - entry.bounds.minX : entry.bounds.maxY - entry.bounds.minY), 0);
  const span = direction === "horizontal" ? last.maxX - first.minX : last.maxY - first.minY;
  const gap = (span - totalSize) / (entries.length - 1);
  let cursor = direction === "horizontal" ? first.minX : first.minY;
  for (const entry of entries) {
    const current = direction === "horizontal" ? entry.bounds.minX : entry.bounds.minY;
    const delta = cursor - current;
    if (Math.abs(delta) > 1e-9) translateElement(entry.element, structuredClone(entry.element), direction === "horizontal" ? delta : 0, direction === "vertical" ? delta : 0);
    cursor += (direction === "horizontal" ? entry.bounds.maxX - entry.bounds.minX : entry.bounds.maxY - entry.bounds.minY) + gap;
  }
  return result;
}
function rotateImageToPoint(image, point) {
  const centerX = image.x + image.width / 2;
  const centerY = image.y + image.height / 2;
  const degrees = Math.atan2(point.y - centerY, point.x - centerX) * 180 / Math.PI + 90;
  const result = structuredClone(image);
  result.rotation = (degrees % 360 + 360) % 360;
  result.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  return result;
}
function cropImageFromHandle(image, handle, point, minimumSize) {
  const centerX = image.x + image.width / 2;
  const centerY = image.y + image.height / 2;
  const radians = -image.rotation * Math.PI / 180;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
  const left = -image.width / 2;
  const right = image.width / 2;
  const top = -image.height / 2;
  const bottom = image.height / 2;
  let nextLeft = left;
  let nextRight = right;
  let nextTop = top;
  let nextBottom = bottom;
  if (handle.includes("w")) nextLeft = Math.min(right - minimumSize, Math.max(left, localX));
  if (handle.includes("e")) nextRight = Math.max(left + minimumSize, Math.min(right, localX));
  if (handle.includes("n")) nextTop = Math.min(bottom - minimumSize, Math.max(top, localY));
  if (handle.includes("s")) nextBottom = Math.max(top + minimumSize, Math.min(bottom, localY));
  return cropImage(image, {
    left: (nextLeft - left) / image.width,
    right: (right - nextRight) / image.width,
    top: (nextTop - top) / image.height,
    bottom: (bottom - nextBottom) / image.height
  });
}
function cropImage(image, margins) {
  const left = Math.min(0.9, Math.max(0, margins.left));
  const right = Math.min(0.9 - left, Math.max(0, margins.right));
  const top = Math.min(0.9, Math.max(0, margins.top));
  const bottom = Math.min(0.9 - top, Math.max(0, margins.bottom));
  if (left + right + top + bottom <= 1e-9) return structuredClone(image);
  const widthScale = 1 - left - right;
  const heightScale = 1 - top - bottom;
  const centerX = image.x + image.width / 2;
  const centerY = image.y + image.height / 2;
  const localShiftX = image.width * (left - right) / 2;
  const localShiftY = image.height * (top - bottom) / 2;
  const radians = image.rotation * Math.PI / 180;
  const shiftedCenterX = centerX + localShiftX * Math.cos(radians) - localShiftY * Math.sin(radians);
  const shiftedCenterY = centerY + localShiftX * Math.sin(radians) + localShiftY * Math.cos(radians);
  const result = structuredClone(image);
  result.width = image.width * widthScale;
  result.height = image.height * heightScale;
  result.x = shiftedCenterX - result.width / 2;
  result.y = shiftedCenterY - result.height / 2;
  result.crop = {
    x: image.crop.x + image.crop.width * left,
    y: image.crop.y + image.crop.height * top,
    width: image.crop.width * widthScale,
    height: image.crop.height * heightScale
  };
  result.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  return result;
}

// src/selection/controller.ts
var SelectionController = class {
  constructor() {
    this.ids = /* @__PURE__ */ new Set();
    this.drag = null;
    this.imageEditMode = null;
  }
  get selectedIds() {
    return this.ids;
  }
  get activePointerId() {
    var _a, _b;
    return (_b = (_a = this.drag) == null ? void 0 : _a.pointerId) != null ? _b : null;
  }
  get dragView() {
    return this.drag ? { kind: this.drag.kind, lasso: this.drag.lasso } : null;
  }
  get editMode() {
    return this.imageEditMode;
  }
  setImageEditMode(mode) {
    this.imageEditMode = mode;
    this.drag = null;
  }
  toggleImageEditMode(mode) {
    this.setImageEditMode(this.imageEditMode === mode ? null : mode);
  }
  setSelected(ids) {
    const next = new Set(ids);
    const changed = next.size !== this.ids.size || [...next].some((id) => !this.ids.has(id));
    this.ids = next;
    if (changed || this.ids.size !== 1) this.imageEditMode = null;
  }
  clear() {
    this.ids.clear();
    this.drag = null;
    this.imageEditMode = null;
  }
  selected(elements) {
    return elements.filter((element) => this.ids.has(element.id));
  }
  bounds(elements) {
    return unionBounds(this.selected(elements));
  }
  transferPointer(pointerId) {
    if (this.drag) this.drag.pointerId = pointerId;
  }
  start(elements, hitCandidates, pointerId, world, zoom, additive, mode = "lasso") {
    const selectedImage = this.singleEditableImage(elements);
    const imageHandle = selectedImage && this.imageEditMode === "crop" ? this.imageCropHandleAt(selectedImage, world, zoom) : null;
    const rotationHandle = selectedImage && this.imageEditMode === "rotate" && this.imageRotationHandleAt(selectedImage, world, zoom);
    const handle = imageHandle || rotationHandle ? null : this.resizeHandleAt(elements, world, zoom);
    const hit = imageHandle || rotationHandle ? selectedImage : handle ? this.selected(elements)[0] : this.hitElement(hitCandidates, world, zoom);
    if (hit && !this.ids.has(hit.id)) {
      if (!additive) this.ids.clear();
      this.ids.add(hit.id);
    } else if (hit && additive) {
      this.ids.delete(hit.id);
      this.drag = null;
      this.imageEditMode = null;
      return;
    }
    if (this.ids.size !== 1 || hit && selectedImage && hit.id !== selectedImage.id) this.imageEditMode = null;
    const originals = /* @__PURE__ */ new Map();
    for (const element of this.selected(elements)) originals.set(element.id, structuredClone(element));
    this.drag = {
      pointerId,
      kind: imageHandle ? "crop" : rotationHandle ? "rotate" : handle ? "resize" : hit ? "move" : mode === "rectangle" ? "marquee" : "lasso",
      start: world,
      current: world,
      handle: handle != null ? handle : void 0,
      imageHandle: imageHandle != null ? imageHandle : void 0,
      originals,
      baseSelection: additive ? new Set(this.ids) : /* @__PURE__ */ new Set(),
      lasso: [world],
      changed: false
    };
    if (!hit && !additive) this.ids.clear();
  }
  update(elements, point, zoom, selectionCandidates = elements) {
    const drag = this.drag;
    if (!drag) return false;
    drag.current = point;
    if (drag.kind === "lasso" || drag.kind === "marquee") {
      const previous = drag.lasso[drag.lasso.length - 1];
      if (drag.kind === "marquee") drag.lasso = [drag.start, point];
      else if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 2 / zoom) drag.lasso.push(point);
      const selected = new Set(drag.baseSelection);
      const bounds = {
        minX: Math.min(drag.start.x, point.x),
        minY: Math.min(drag.start.y, point.y),
        maxX: Math.max(drag.start.x, point.x),
        maxY: Math.max(drag.start.y, point.y)
      };
      for (const element of selectionCandidates) {
        if (drag.kind === "marquee" ? elementIntersectsBounds(element, bounds) : elementIntersectsLasso(element, drag.lasso)) selected.add(element.id);
      }
      this.ids = selected;
      return false;
    }
    if (!drag.changed && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 0.4 / zoom) return false;
    const editable = this.selected(elements).filter((element) => !element.locked);
    if (!editable.length) return false;
    drag.changed = true;
    if ((drag.kind === "crop" || drag.kind === "rotate") && editable.length === 1 && editable[0].type === "image") {
      const source = drag.originals.get(editable[0].id);
      if (!source || source.type !== "image") return false;
      const next = drag.kind === "crop" && drag.imageHandle ? cropImageFromHandle(source, drag.imageHandle, point, 24 / zoom) : rotateImageToPoint(source, point);
      Object.assign(editable[0], next);
    } else if (drag.kind === "resize" && drag.handle) {
      const originals = [...drag.originals.values()].filter((element) => !element.locked);
      const sourceBounds = unionBounds(originals);
      if (!sourceBounds) return false;
      const anchor = {
        x: drag.handle.includes("w") ? sourceBounds.maxX : sourceBounds.minX,
        y: drag.handle.includes("n") ? sourceBounds.maxY : sourceBounds.minY
      };
      const width = Math.max(1 / zoom, sourceBounds.maxX - sourceBounds.minX);
      const height = Math.max(1 / zoom, sourceBounds.maxY - sourceBounds.minY);
      const scale = Math.max(32 / zoom / Math.max(width, height), Math.hypot(point.x - anchor.x, point.y - anchor.y) / Math.hypot(width, height));
      for (const element of editable) {
        const source = drag.originals.get(element.id);
        if (source) scaleElementFromAnchor(element, source, anchor, scale);
      }
    } else {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      for (const element of editable) {
        const source = drag.originals.get(element.id);
        if (source) translateElement(element, source, dx, dy);
      }
    }
    return true;
  }
  finish(elements, point, zoom, selectionCandidates = elements) {
    if (!this.drag) return null;
    this.update(elements, point, zoom, selectionCandidates);
    const drag = this.drag;
    this.drag = null;
    if (!drag.changed) return null;
    return {
      before: [...drag.originals.values()].map((element) => structuredClone(element)),
      after: this.selected(elements).map((element) => structuredClone(element))
    };
  }
  cancel(elements) {
    if (!this.drag) return false;
    const drag = this.drag;
    this.drag = null;
    if (!drag.changed) return false;
    for (const element of elements) {
      const original = drag.originals.get(element.id);
      if (original) Object.assign(element, structuredClone(original));
    }
    return true;
  }
  resizeHandleAt(elements, point, zoom) {
    const selected = this.selected(elements);
    if (!selected.length || selected.some((element) => element.locked)) return null;
    const bounds = unionBounds(selected);
    if (!bounds) return null;
    const tolerance = 14 / zoom;
    for (const [handle, position] of Object.entries(handlePoints(bounds))) {
      if (Math.hypot(point.x - position.x, point.y - position.y) <= tolerance) return handle;
    }
    return null;
  }
  singleEditableImage(elements) {
    const selected = this.selected(elements);
    return selected.length === 1 && selected[0].type === "image" && !selected[0].locked ? selected[0] : null;
  }
  imageCropHandleAt(image, point, zoom) {
    const tolerance = 14 / zoom;
    for (const [handle, position] of Object.entries(imageCropHandlePoints(image))) {
      if (Math.hypot(point.x - position.x, point.y - position.y) <= tolerance) return handle;
    }
    return null;
  }
  imageRotationHandleAt(image, point, zoom) {
    const position = imageRotationHandlePoint(image, 34 / zoom);
    return Math.hypot(point.x - position.x, point.y - position.y) <= 14 / zoom;
  }
  hitElement(elements, point, zoom) {
    const tolerance = 8 / zoom;
    for (let index = elements.length - 1; index >= 0; index--) {
      const element = elements[index];
      if (hitTestElement(element, point, tolerance)) return element;
    }
    return null;
  }
};

// src/tools/registry.ts
function planToolTransition(previous, next, inputActive, inputPersistent) {
  var _a, _b;
  const previousRole = (_a = TOOL_DEFINITIONS.find((definition) => definition.id === previous)) == null ? void 0 : _a.role;
  const nextRole = (_b = TOOL_DEFINITIONS.find((definition) => definition.id === next)) == null ? void 0 : _b.role;
  if (!previousRole || !nextRole) throw new Error(`Unknown tool transition: ${previous} \u2192 ${next}`);
  return {
    finishActiveInput: previous !== next && inputActive,
    cancelActiveSelection: previousRole === "selection",
    persistFinishedInput: previousRole !== "selection" && inputPersistent,
    clearSelection: nextRole !== "selection",
    clearEraserPreview: nextRole !== "eraser"
  };
}
var ToolControllerRegistry = class {
  constructor() {
    this.controllers = /* @__PURE__ */ new Map();
    this.activeTool = null;
  }
  register(tool, controller) {
    this.controllers.set(tool, controller);
  }
  activate(tool) {
    var _a, _b;
    if (this.activeTool === tool) return;
    if (this.activeTool) (_a = this.controllers.get(this.activeTool)) == null ? void 0 : _a.onDeactivate();
    this.activeTool = tool;
    (_b = this.controllers.get(tool)) == null ? void 0 : _b.onActivate();
  }
  deactivate() {
    var _a;
    if (this.activeTool) (_a = this.controllers.get(this.activeTool)) == null ? void 0 : _a.onDeactivate();
    this.activeTool = null;
  }
  renderOverlays(context) {
    for (const controller of this.controllers.values()) controller.renderOverlay(context);
  }
};
var TOOL_DEFINITIONS = [
  { id: "select", icon: "mouse-pointer-2", label: "\u9009\u62E9", role: "selection", configurable: false, persistentOutput: false },
  { id: "hand", icon: "move", label: "\u79FB\u52A8\u753B\u5E03", role: "navigation", configurable: false, persistentOutput: false },
  { id: "ballpoint", icon: "pen-line", label: "\u5706\u73E0\u7B14", role: "drawing", configurable: true, persistentOutput: true },
  { id: "pen", icon: "pen-tool", label: "\u94A2\u7B14", role: "drawing", configurable: true, persistentOutput: true },
  { id: "highlighter", icon: "highlighter", label: "\u8367\u5149\u7B14", role: "drawing", configurable: true, persistentOutput: true },
  { id: "laser", icon: "sparkles", label: "\u6FC0\u5149\u7B14", role: "transient", configurable: true, persistentOutput: false },
  { id: "eraser", icon: "eraser", label: "\u5C40\u90E8\u6A61\u76AE\u64E6", role: "eraser", configurable: false, persistentOutput: true }
];

// src/tools/laser-state.ts
function createLaserStroke(point, config) {
  return { id: makeId("laser"), points: [point], config: structuredClone(config), completedAt: null };
}
function appendLaserPoint(stroke, point, minimumDistance = 0.18) {
  const previous = stroke.points[stroke.points.length - 1];
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) <= minimumDistance) return false;
  stroke.points.push(point);
  return true;
}
function laserAlpha(stroke, now) {
  if (stroke.completedAt === null) return 1;
  const fadeStart = stroke.completedAt + stroke.config.holdMs;
  if (now <= fadeStart) return 1;
  return Math.max(0, 1 - (now - fadeStart) / Math.max(1, stroke.config.fadeMs));
}
function isLaserExpired(stroke, now) {
  return stroke.completedAt !== null && laserAlpha(stroke, now) <= 0;
}

// src/tools/laser-controller.ts
var LaserController = class {
  constructor(getConfig, now = () => performance.now(), onDeactivateEffect = () => {
  }) {
    this.getConfig = getConfig;
    this.now = now;
    this.onDeactivateEffect = onDeactivateEffect;
    this.strokes = [];
    this.current = null;
  }
  get hasStrokes() {
    return this.strokes.length > 0;
  }
  get isDrawing() {
    return this.current !== null;
  }
  get visibleStrokes() {
    return this.strokes;
  }
  onActivate() {
  }
  onDeactivate() {
    this.onDeactivateEffect();
    this.clear();
  }
  onInputStart(input) {
    const stroke = createLaserStroke(input.point, this.getConfig());
    this.current = stroke;
    this.strokes.push(stroke);
  }
  onInputMove(input) {
    if (this.current) appendLaserPoint(this.current, input.point);
  }
  onInputEnd(input) {
    if (!this.current) return;
    appendLaserPoint(this.current, input.point);
    this.complete();
  }
  complete() {
    if (!this.current) return;
    this.current.completedAt = this.now();
    this.current = null;
  }
  pruneExpired(at = this.now()) {
    this.strokes = this.strokes.filter((stroke) => !isLaserExpired(stroke, at));
  }
  clear() {
    this.current = null;
    this.strokes = [];
  }
  renderOverlay(context) {
    const at = this.now();
    for (const stroke of this.strokes) this.drawStroke(context, stroke, at);
  }
  drawStroke(context, stroke, at) {
    var _a, _b, _c;
    if (!stroke.points.length) return;
    const alpha = laserAlpha(stroke, at);
    const path = this.centerlinePath(smoothCenterline(stroke.points));
    context.save();
    context.globalCompositeOperation = "source-over";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = stroke.config.color;
    context.shadowColor = stroke.config.color;
    context.shadowBlur = stroke.config.glow;
    if (stroke.points.length === 1) {
      context.globalAlpha = alpha * ((_a = stroke.config.opacity) != null ? _a : 1);
      context.fillStyle = stroke.config.color;
      context.beginPath();
      context.arc(stroke.points[0].x, stroke.points[0].y, stroke.config.size / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.globalAlpha = alpha * ((_b = stroke.config.opacity) != null ? _b : 1) * 0.24;
      context.lineWidth = stroke.config.size * 2.4;
      context.stroke(path);
      context.globalAlpha = alpha * ((_c = stroke.config.opacity) != null ? _c : 1);
      context.lineWidth = stroke.config.size;
      context.stroke(path);
    }
    context.restore();
  }
  centerlinePath(points) {
    const path = new Path2D();
    if (!points.length) return path;
    path.moveTo(points[0].x, points[0].y);
    if (points.length === 2) {
      path.lineTo(points[1].x, points[1].y);
      return path;
    }
    for (let index = 0; index < points.length - 1; index++) {
      const before = points[Math.max(0, index - 1)];
      const current = points[index];
      const next = points[index + 1];
      const after = points[Math.min(points.length - 1, index + 2)];
      path.bezierCurveTo(
        current.x + (next.x - before.x) / 6,
        current.y + (next.y - before.y) / 6,
        next.x - (after.x - current.x) / 6,
        next.y - (after.y - current.y) / 6,
        next.x,
        next.y
      );
    }
    return path;
  }
};

// src/tools/stroke-eraser.ts
function sampleEraserPath(previous, current, spacing) {
  if (!previous) return [current];
  const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
  const steps = Math.min(512, Math.max(1, Math.ceil(distance / Math.max(0.1, spacing))));
  const points = [];
  for (let step = 1; step <= steps; step++) {
    const amount = step / steps;
    points.push({
      x: previous.x + (current.x - previous.x) * amount,
      y: previous.y + (current.y - previous.y) * amount
    });
  }
  return points;
}
function interpolate(start, end, amount) {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
    pressure: start.pressure + (end.pressure - start.pressure) * amount,
    time: start.time + (end.time - start.time) * amount
  };
}
function distanceSquared(point, center) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return dx * dx + dy * dy;
}
function segmentCircleIntersections(start, end, center, radius) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fx = start.x - center.x;
  const fy = start.y - center.y;
  const a = dx * dx + dy * dy;
  if (a <= Number.EPSILON) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((amount) => amount > 0 && amount < 1).sort((left, right) => left - right);
}
function pushDistinct(points, point) {
  const previous = points[points.length - 1];
  if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-6) points.push(point);
}
function eraseStrokeAt(stroke, center, eraserRadius, makeFragmentId) {
  var _a, _b;
  const strokeRadius = ((_b = (_a = stroke.brush) == null ? void 0 : _a.size) != null ? _b : stroke.size) / 2;
  const radius = Math.max(0, eraserRadius) + strokeRadius;
  const radiusSquared = radius * radius;
  if (stroke.points.length === 1) {
    if (distanceSquared(stroke.points[0], center) > radiusSquared) return { changed: false, fragments: [stroke] };
    return { changed: true, fragments: [] };
  }
  const pointFragments = [];
  let current = null;
  let removed = false;
  const finishCurrent = () => {
    if (current == null ? void 0 : current.length) pointFragments.push(current);
    current = null;
  };
  for (let index = 0; index < stroke.points.length - 1; index++) {
    const start = stroke.points[index];
    const end = stroke.points[index + 1];
    const amounts = [0, ...segmentCircleIntersections(start, end, center, radius), 1];
    for (let interval = 0; interval < amounts.length - 1; interval++) {
      const from = amounts[interval];
      const to = amounts[interval + 1];
      if (to - from <= Number.EPSILON) continue;
      const midpoint = interpolate(start, end, (from + to) / 2);
      const outside = distanceSquared(midpoint, center) > radiusSquared;
      if (outside) {
        if (!current) current = [];
        pushDistinct(current, interpolate(start, end, from));
        pushDistinct(current, interpolate(start, end, to));
      } else {
        removed = true;
        finishCurrent();
      }
    }
  }
  finishCurrent();
  if (!removed) return { changed: false, fragments: [stroke] };
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  return {
    changed: true,
    fragments: pointFragments.map((points, index) => ({
      ...structuredClone(stroke),
      id: index === 0 ? stroke.id : makeFragmentId(),
      updatedAt,
      points
    }))
  };
}
function eraseWholeStrokeAt(stroke, center, eraserRadius) {
  return hitTestElement(stroke, center, Math.max(0, eraserRadius)) ? { changed: true, fragments: [] } : { changed: false, fragments: [stroke] };
}

// src/rendering/spatial-index.ts
function cellsFor(bounds, cellSize) {
  const keys = [];
  const minX = Math.floor(bounds.minX / cellSize);
  const minY = Math.floor(bounds.minY / cellSize);
  const maxX = Math.floor(bounds.maxX / cellSize);
  const maxY = Math.floor(bounds.maxY / cellSize);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) keys.push(`${x}:${y}`);
  }
  return keys;
}
var ElementSpatialIndex = class {
  constructor(cellSize = 512) {
    this.cellSize = cellSize;
    this.cells = /* @__PURE__ */ new Map();
    this.elementCells = /* @__PURE__ */ new Map();
    this.globalIds = /* @__PURE__ */ new Set();
    this.records = /* @__PURE__ */ new Map();
    this.orderIds = [];
    this.orderById = /* @__PURE__ */ new Map();
  }
  rebuild(elements) {
    this.clear();
    for (const element of elements) this.upsert(element);
  }
  upsert(element) {
    if (!this.orderById.has(element.id)) {
      this.orderById.set(element.id, this.orderIds.length);
      this.orderIds.push(element.id);
    }
    this.removeCells(element.id);
    const bounds = elementBounds(element);
    this.records.set(element.id, { element, bounds });
    const horizontalCells = Math.floor(bounds.maxX / this.cellSize) - Math.floor(bounds.minX / this.cellSize) + 1;
    const verticalCells = Math.floor(bounds.maxY / this.cellSize) - Math.floor(bounds.minY / this.cellSize) + 1;
    if (horizontalCells * verticalCells > 4096) {
      this.globalIds.add(element.id);
      this.elementCells.set(element.id, []);
      return;
    }
    const keys = cellsFor(bounds, this.cellSize);
    this.elementCells.set(element.id, keys);
    for (const key of keys) {
      let ids = this.cells.get(key);
      if (!ids) {
        ids = /* @__PURE__ */ new Set();
        this.cells.set(key, ids);
      }
      ids.add(element.id);
    }
  }
  remove(id) {
    this.removeCells(id);
    const index = this.orderById.get(id);
    if (index === void 0) return;
    this.orderIds.splice(index, 1);
    this.orderById.delete(id);
    this.reindexFrom(index);
  }
  /** Replaces an erased stroke in its layer position, including split fragments. */
  replace(id, fragments) {
    var _a;
    const index = (_a = this.orderById.get(id)) != null ? _a : this.orderIds.length;
    this.remove(id);
    this.orderIds.splice(index, 0, ...fragments.map((fragment) => fragment.id));
    this.reindexFrom(index);
    for (const fragment of fragments) this.upsert(fragment);
  }
  removeCells(id) {
    this.globalIds.delete(id);
    this.records.delete(id);
    const keys = this.elementCells.get(id);
    if (!keys) return;
    for (const key of keys) {
      const ids = this.cells.get(key);
      ids == null ? void 0 : ids.delete(id);
      if ((ids == null ? void 0 : ids.size) === 0) this.cells.delete(key);
    }
    this.elementCells.delete(id);
  }
  reindexFrom(index) {
    for (let position = index; position < this.orderIds.length; position += 1) {
      this.orderById.set(this.orderIds[position], position);
    }
  }
  query(_elements, bounds, includeIds = /* @__PURE__ */ new Set()) {
    var _a;
    const horizontalCells = Math.floor(bounds.maxX / this.cellSize) - Math.floor(bounds.minX / this.cellSize) + 1;
    const verticalCells = Math.floor(bounds.maxY / this.cellSize) - Math.floor(bounds.minY / this.cellSize) + 1;
    const ids = new Set(this.globalIds);
    if (horizontalCells * verticalCells > 4096) {
      for (const id of this.records.keys()) ids.add(id);
    } else {
      for (const key of cellsFor(bounds, this.cellSize)) {
        for (const id of (_a = this.cells.get(key)) != null ? _a : []) ids.add(id);
      }
    }
    for (const id of includeIds) ids.add(id);
    const matches = [];
    for (const id of ids) {
      const record = this.records.get(id);
      if (record && (includeIds.has(id) || boundsIntersect(record.bounds, bounds))) matches.push({ id, element: record.element });
    }
    matches.sort((left, right) => {
      var _a2, _b;
      return ((_a2 = this.orderById.get(left.id)) != null ? _a2 : 0) - ((_b = this.orderById.get(right.id)) != null ? _b : 0);
    });
    return matches.map(({ element }) => element);
  }
  clear() {
    this.cells.clear();
    this.elementCells.clear();
    this.globalIds.clear();
    this.records.clear();
    this.orderIds.length = 0;
    this.orderById.clear();
  }
};

// src/platform/input-flight-recorder.ts
var InputFlightRecorder = class {
  constructor(limit = 2e3) {
    this.limit = limit;
    this.entries = [];
    this.nextIndex = 0;
    this.sequence = 0;
    this.startedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  record(at, event, details, state) {
    const entry = { sequence: ++this.sequence, at, event, details, state };
    if (this.entries.length < this.limit) {
      this.entries.push(entry);
      return;
    }
    this.entries[this.nextIndex] = entry;
    this.nextIndex = (this.nextIndex + 1) % this.limit;
  }
  reset() {
    this.entries = [];
    this.sequence = 0;
    this.nextIndex = 0;
    this.startedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  report(context) {
    const header = Object.entries(context).map(([key, value]) => `${key}: ${value}`).join("\n");
    const ordered = this.entries.length < this.limit || this.nextIndex === 0 ? this.entries : this.entries.slice(this.nextIndex).concat(this.entries.slice(0, this.nextIndex));
    const events = ordered.map(
      (entry) => `${entry.sequence.toString().padStart(4, "0")} t=${entry.at.toFixed(1)}ms ${entry.event} | ${entry.details} | ${entry.state}`
    ).join("\n");
    return ["Infinite Board input diagnostic", `startedAt: ${this.startedAt}`, header, "", events || "(no events)"].join("\n");
  }
  get size() {
    return this.entries.length;
  }
};

// src/platform/runtime-integrity.ts
var RUNTIME_VERSION = "0.4.82";
var BUILD_FINGERPRINT = "0.4.82-community-release-r1";
function runtimeMatchesManifest(manifestVersion) {
  return manifestVersion === RUNTIME_VERSION;
}

// src/platform/input-tool-metrics.ts
var TRACKED_TOOLS = ["pen", "ballpoint", "highlighter", "laser"];
function emptyMetric() {
  return { starts: 0, completions: 0, pointerStarts: 0, touchStarts: 0, pointerMoveRecoveries: 0, stylusTouchFallbacks: 0 };
}
function isTrackedInputTool(tool) {
  return tool === "pen" || tool === "ballpoint" || tool === "highlighter" || tool === "laser";
}
var InputToolMetrics = class {
  constructor() {
    this.metrics = this.createMetrics();
  }
  recordStart(tool, source) {
    if (!isTrackedInputTool(tool)) return null;
    const metric = this.metrics[tool];
    metric.starts += 1;
    if (source === "pointer") metric.pointerStarts += 1;
    else metric.touchStarts += 1;
    return tool;
  }
  recordCompletion(tool) {
    if (tool) this.metrics[tool].completions += 1;
  }
  recordRecovery(tool, kind) {
    if (!isTrackedInputTool(tool)) return;
    if (kind === "pointer-move") this.metrics[tool].pointerMoveRecoveries += 1;
    else this.metrics[tool].stylusTouchFallbacks += 1;
  }
  reset() {
    this.metrics = this.createMetrics();
  }
  snapshot() {
    return {
      pen: { ...this.metrics.pen },
      ballpoint: { ...this.metrics.ballpoint },
      highlighter: { ...this.metrics.highlighter },
      laser: { ...this.metrics.laser }
    };
  }
  compactSummary() {
    const labels = { pen: "\u94A2", ballpoint: "\u5706", highlighter: "\u8367", laser: "\u6FC0" };
    return TRACKED_TOOLS.map((tool) => `${labels[tool]} ${this.metrics[tool].starts}/${this.metrics[tool].completions}`).join(" \xB7 ");
  }
  reportSummary() {
    return TRACKED_TOOLS.map((tool) => {
      const metric = this.metrics[tool];
      return `${tool}[start=${metric.starts},complete=${metric.completions},pointer=${metric.pointerStarts},touch=${metric.touchStarts},moveRecovery=${metric.pointerMoveRecoveries},touchFallback=${metric.stylusTouchFallbacks}]`;
    }).join("; ");
  }
  createMetrics() {
    return { pen: emptyMetric(), ballpoint: emptyMetric(), highlighter: emptyMetric(), laser: emptyMetric() };
  }
};

// src/platform/diagnostic-snapshot.ts
function diagnosticCounterSnapshot(counters) {
  return {
    orphanRecoveries: Math.max(0, Math.round(counters.orphanRecoveries)),
    inputDocumentScrolls: Math.max(0, Math.round(counters.inputDocumentScrolls)),
    hostDocumentScrolls: Math.max(0, Math.round(counters.hostDocumentScrolls)),
    hostDocumentPenStarts: Math.max(0, Math.round(counters.hostDocumentPenStarts)),
    scribbleTouchCancels: Math.max(0, Math.round(counters.scribbleTouchCancels)),
    recoveredPointerStarts: Math.max(0, Math.round(counters.recoveredPointerStarts)),
    stylusTouchFallbackStarts: Math.max(0, Math.round(counters.stylusTouchFallbackStarts)),
    presentationRecoveryFrames: Math.max(0, Math.round(counters.presentationRecoveryFrames)),
    maxEventLoopDelayMs: Math.max(0, Math.round(counters.maxEventLoopDelayMs)),
    lastSaveMs: Math.max(0, Math.round(counters.lastSaveMs)),
    maxSaveMs: Math.max(0, Math.round(counters.maxSaveMs))
  };
}

// src/platform/canvas-resize.ts
function persistedCameraResizeDelta(previous, next, persistenceReady) {
  if (!previous || !persistenceReady) return null;
  const x = (next.width - previous.width) / 2;
  const y = (next.height - previous.height) / 2;
  return x === 0 && y === 0 ? null : { x, y };
}

// src/assets/image-assets.ts
var DEFAULT_IMAGE_CACHE_LIMITS = {
  maxImages: 24,
  maxDecodedBytes: 96 * 1024 * 1024
};
var RETRY_DELAYS_MS = [250, 1e3, 3e3, 1e4, 3e4, 6e4];
function referencesImagePath(elements, path) {
  return elements.some((element) => element.type === "image" && element.path === path);
}
function unreferencedImagePaths(elements, candidates) {
  const referenced = new Set(elements.filter((element) => element.type === "image" && element.path).map((element) => element.path));
  return candidates.filter((path) => looksLikeImage(path) && !referenced.has(path));
}
function extensionForImageMime(mime) {
  var _a;
  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif"
  };
  return (_a = extensions[mime.toLowerCase()]) != null ? _a : "png";
}
function looksLikeImage(name) {
  return /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name);
}
function imageFilesFromTransfer(transfer) {
  var _a, _b;
  if (!transfer) return [];
  const candidates = [
    ...Array.from((_a = transfer.files) != null ? _a : []),
    ...Array.from((_b = transfer.items) != null ? _b : []).map((item) => item.kind === "file" ? item.getAsFile() : null).filter((file) => file !== null)
  ];
  const unique = /* @__PURE__ */ new Map();
  for (const file of candidates) {
    if (file.type.startsWith("image/") || looksLikeImage(file.name)) unique.set(`${file.name}:${file.size}:${file.type}`, file);
  }
  return [...unique.values()];
}
function acceptsFileTransfer(transfer) {
  var _a, _b, _c, _d;
  if (!transfer) return false;
  if (Array.from((_a = transfer.types) != null ? _a : []).includes("Files")) return true;
  if (((_c = (_b = transfer.files) == null ? void 0 : _b.length) != null ? _c : 0) > 0) return true;
  return Array.from((_d = transfer.items) != null ? _d : []).some((item) => item.kind === "file");
}
function readImageDimensions(file, fallback = { width: 800, height: 600 }) {
  return new Promise((resolve) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    const finish = (dimensions) => {
      URL.revokeObjectURL(url);
      resolve(dimensions);
    };
    image.onload = () => finish({ width: image.naturalWidth || fallback.width, height: image.naturalHeight || fallback.height });
    image.onerror = () => finish(fallback);
    image.src = url;
  });
}
function readImageUrlDimensions(url, fallback = { width: 800, height: 600 }) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || fallback.width, height: image.naturalHeight || fallback.height });
    image.onerror = () => resolve(fallback);
    image.src = url;
  });
}
var ImageAssetCache = class {
  constructor(adapter, createImage = () => new Image(), scheduler = {
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancel: (timer) => window.clearTimeout(timer)
  }, limits = DEFAULT_IMAGE_CACHE_LIMITS) {
    this.adapter = adapter;
    this.createImage = createImage;
    this.scheduler = scheduler;
    this.limits = limits;
    this.images = /* @__PURE__ */ new Map();
    this.estimatedBytes = /* @__PURE__ */ new Map();
    this.retryAttempts = /* @__PURE__ */ new Map();
    this.retryTimers = /* @__PURE__ */ new Map();
    this.visible = /* @__PURE__ */ new Set();
    this.visibilityManaged = false;
    this.decodedBytes = 0;
  }
  get stats() {
    return {
      entries: this.images.size,
      estimatedBytes: this.decodedBytes,
      visibleEntries: [...this.visible].filter((path) => this.images.has(path)).length,
      pendingRetries: this.retryTimers.size
    };
  }
  isVisible(path) {
    return !this.visibilityManaged || this.visible.has(path);
  }
  retainVisible(paths) {
    this.visibilityManaged = true;
    this.visible = new Set(paths);
    for (const path of this.retryTimers.keys()) {
      if (!this.visible.has(path)) this.clearRetry(path);
    }
    for (const path of this.visible) this.load(path);
    this.enforceBudget();
  }
  get(path) {
    const image = this.images.get(path);
    if (image) {
      this.images.delete(path);
      this.images.set(path, image);
    }
    return image;
  }
  load(path) {
    if (this.images.has(path) || this.retryTimers.has(path)) return;
    const resourceUrl = this.adapter.resourceUrl(path);
    if (!resourceUrl) {
      this.scheduleRetry(path);
      return;
    }
    const image = this.createImage();
    image.onload = () => {
      var _a;
      if (this.images.get(path) !== image) return;
      const size = image.naturalWidth * image.naturalHeight * 4;
      const bytes = Number.isFinite(size) ? Math.max(0, size) : 0;
      this.decodedBytes += bytes - ((_a = this.estimatedBytes.get(path)) != null ? _a : 0);
      this.estimatedBytes.set(path, bytes);
      this.clearRetry(path);
      this.enforceBudget();
      this.adapter.onReady();
    };
    image.onerror = () => {
      var _a;
      if (this.images.get(path) !== image) return;
      image.onload = null;
      image.onerror = null;
      this.images.delete(path);
      this.decodedBytes -= (_a = this.estimatedBytes.get(path)) != null ? _a : 0;
      this.estimatedBytes.delete(path);
      this.scheduleRetry(path);
    };
    this.images.set(path, image);
    image.src = resourceUrl;
    this.enforceBudget();
  }
  delete(path) {
    var _a;
    const image = this.images.get(path);
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.src = "";
    }
    this.images.delete(path);
    this.decodedBytes -= (_a = this.estimatedBytes.get(path)) != null ? _a : 0;
    this.estimatedBytes.delete(path);
    this.clearRetry(path);
  }
  release() {
    for (const path of [...this.images.keys()]) this.delete(path);
    for (const timer of this.retryTimers.values()) this.scheduler.cancel(timer);
    this.retryTimers.clear();
    this.retryAttempts.clear();
    this.visible.clear();
    this.visibilityManaged = false;
    this.decodedBytes = 0;
  }
  clearRetry(path) {
    const timer = this.retryTimers.get(path);
    if (timer !== void 0) this.scheduler.cancel(timer);
    this.retryTimers.delete(path);
    this.retryAttempts.delete(path);
  }
  scheduleRetry(path) {
    var _a;
    if (this.visibilityManaged && !this.visible.has(path)) return;
    if (this.retryTimers.has(path)) return;
    const attempt = (_a = this.retryAttempts.get(path)) != null ? _a : 0;
    if (attempt >= RETRY_DELAYS_MS.length) return;
    this.retryAttempts.set(path, attempt + 1);
    const timer = this.scheduler.schedule(() => {
      this.retryTimers.delete(path);
      if (this.isVisible(path)) this.load(path);
    }, RETRY_DELAYS_MS[attempt]);
    this.retryTimers.set(path, timer);
  }
  enforceBudget() {
    while (this.images.size > this.limits.maxImages || this.decodedBytes > this.limits.maxDecodedBytes) {
      const offscreen = [...this.images.keys()].find((path) => !this.visible.has(path));
      if (!offscreen) break;
      this.delete(offscreen);
    }
  }
};

// src/assets/board-asset-coordinator.ts
var BoardAssetCoordinator = class {
  constructor(options) {
    this.cache = new ImageAssetCache(
      { resourceUrl: options.resourceUrl, onReady: options.onImageReady },
      options.createImage,
      options.scheduler,
      options.cacheLimits
    );
  }
  get(path) {
    return this.cache.get(path);
  }
  load(path) {
    this.cache.load(path);
  }
  updateVisible(elements) {
    this.cache.retainVisible(elements.filter((element) => element.type === "image" && element.path).map((element) => element.path));
  }
  refresh(path) {
    this.cache.delete(path);
    if (this.cache.isVisible(path)) this.cache.load(path);
  }
  /** Returns whether an arriving Vault file is relevant to the open board. */
  onVaultFile(path, elements) {
    if (!referencesImagePath(elements, path)) return false;
    if (this.cache.isVisible(path)) this.refresh(path);
    else this.cache.delete(path);
    return true;
  }
  get cacheStats() {
    return this.cache.stats;
  }
  inspect(elements, candidates, exists) {
    const referencedPaths = elements.filter((element) => element.type === "image" && typeof element.path === "string").map((element) => element.path);
    return {
      referencedPaths,
      missing: referencedPaths.filter((path) => !exists(path)).length,
      unlinkedPaths: unreferencedImagePaths(elements, candidates)
    };
  }
  release() {
    this.cache.release();
  }
};

// src/assets/board-health.ts
function boardHealthSnapshot(boardBytes, assets) {
  return {
    boardBytes: Math.max(0, Math.floor(boardBytes)),
    referencedImages: assets.referencedPaths.length,
    missingImages: assets.missing,
    unlinkedPaths: [...assets.unlinkedPaths]
  };
}

// src/assets/image-import-service.ts
var ImageImportService = class {
  constructor(storage, dimensions = readImageDimensions) {
    this.storage = storage;
    this.dimensions = dimensions;
  }
  async import(request) {
    var _a;
    const images = [];
    const failures = [];
    const writtenPaths = [];
    const active = () => {
      var _a2;
      return ((_a2 = request.shouldContinue) == null ? void 0 : _a2.call(request)) !== false;
    };
    if (!active()) return { images, failures, writtenPaths, cancelled: true };
    await this.storage.ensureFolder(request.folderPath);
    for (const file of request.files) {
      if (!active()) break;
      try {
        if (!file.type.startsWith("image/") && !looksLikeImage(file.name)) throw new Error(`Unsupported image type: ${file.type}`);
        const extensionFromName = file.name.includes(".") ? (_a = file.name.split(".").pop()) == null ? void 0 : _a.toLowerCase() : "";
        const extension = (extensionFromName || extensionForImageMime(file.type)).replace(/[^a-z0-9]/g, "") || "png";
        const path = `${request.folderPath}/${request.createId("image")}.${extension}`;
        const dimensions = await this.dimensions(file);
        await this.storage.writeBinary(path, await file.arrayBuffer());
        writtenPaths.push(path);
        const scale = Math.min(1, 720 / Math.max(1, dimensions.width));
        const offset = images.length * 28;
        const now = request.now();
        images.push({
          id: request.createId("image"),
          type: "image",
          createdAt: now,
          updatedAt: now,
          path,
          x: request.placement.x - dimensions.width * scale / 2 + offset,
          y: request.placement.y - dimensions.height * scale / 2 + offset,
          width: dimensions.width * scale,
          height: dimensions.height * scale,
          rotation: 0,
          crop: { x: 0, y: 0, width: 1, height: 1 }
        });
      } catch (error) {
        failures.push({ file, error });
      }
    }
    return { images, failures, writtenPaths, cancelled: !active() };
  }
};

// src/assets/image-import-task.ts
var ImageImportTask = class {
  constructor(sessions, session, file, folderPath, placement) {
    this.sessions = sessions;
    this.session = session;
    this.file = file;
    this.folderPath = folderPath;
    this.cancelled = false;
    this.placement = { ...placement };
  }
  get active() {
    return !this.cancelled && this.sessions.isCurrent(this.session);
  }
  cancel() {
    this.cancelled = true;
  }
};

// src/ui/creative-toolbar.ts
var TOOLBAR_PRESET_COLORS = ["#1c1c1e", "#007aff", "#34c759", "#ffd60a", "#ff3b30"];
var MORE_COLORS = [
  "#ffffff",
  "#eeeeef",
  "#d7d7da",
  "#b4b4ba",
  "#898991",
  "#62626b",
  "#3d3d45",
  "#202022",
  "#ffdddd",
  "#ffe8d1",
  "#fff2bd",
  "#e0f2ce",
  "#cff1e9",
  "#d5eaff",
  "#e4dcff",
  "#f5dcf6",
  "#ffabab",
  "#ffd096",
  "#ffe47a",
  "#bee596",
  "#9ae0ca",
  "#9dccfc",
  "#c5aff1",
  "#e7aee9",
  "#ff6268",
  "#ffac43",
  "#ffd03b",
  "#79cd54",
  "#45c49c",
  "#2184ff",
  "#9564de",
  "#d969d1",
  "#d93348",
  "#db7c1e",
  "#c6a310",
  "#3d9d48",
  "#148c77",
  "#2264b4",
  "#7043ae",
  "#a83f9c",
  "#822631",
  "#925324",
  "#7a671f",
  "#2c6235",
  "#215b51",
  "#254970",
  "#493267",
  "#6d305f"
];
function isColorTool(tool) {
  return tool === "ballpoint" || tool === "pen" || tool === "highlighter" || tool === "laser";
}
function inferredColorSource(color2) {
  return TOOLBAR_PRESET_COLORS.some((preset) => preset.toLowerCase() === color2.toLowerCase()) ? "preset" : "more";
}

// src/ui/creative-toolbar-view.ts
var import_obsidian2 = require("obsidian");

// src/ui/brush-settings-panel.ts
var import_obsidian = require("obsidian");

// src/ui/touch-controls.ts
function supportsPhoneFingerDrawing(tool) {
  return tool === "ballpoint" || tool === "pen" || tool === "highlighter" || tool === "laser" || tool === "eraser" || tool === "select";
}
function bindRangeDrag(input) {
  let pointer = null;
  const apply = (event) => {
    const rect = input.getBoundingClientRect();
    const min = Number(input.min), max = Number(input.max), step = Number(input.step) || 1;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - 12) / Math.max(1, rect.width - 24)));
    input.value = String(Math.max(min, Math.min(max, min + Math.round(ratio * (max - min) / step) * step)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const down = (event) => {
    if (event.pointerType === "mouse" || pointer !== null) return;
    pointer = event.pointerId;
    event.preventDefault();
    input.setPointerCapture(pointer);
    apply(event);
  };
  const move = (event) => {
    if (event.pointerId !== pointer) return;
    event.preventDefault();
    apply(event);
  };
  const end = (event) => {
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
function bindPhoneGestures(canvas, update, onPointer) {
  const touch = (event) => {
    const rect = canvas.getBoundingClientRect();
    const points = Array.from(event.touches).filter((t) => t.target === canvas && t.touchType !== "stylus").map((t) => ({ id: t.identifier, x: t.clientX - rect.left, y: t.clientY - rect.top }));
    if (event.cancelable && Array.from(event.changedTouches).some((t) => t.target === canvas && t.touchType !== "stylus")) event.preventDefault();
    update(points, event.type === "touchmove");
  };
  const pointer = (event) => {
    if (event.pointerType === "touch") {
      onPointer(event);
      event.stopImmediatePropagation();
    }
  };
  const touchTypes = ["touchstart", "touchmove", "touchend", "touchcancel"];
  const pointerTypes = ["pointerdown", "pointermove", "pointerup", "pointercancel"];
  for (const type of touchTypes) canvas.addEventListener(type, touch, { passive: false });
  for (const type of pointerTypes) canvas.addEventListener(type, pointer, true);
  return () => {
    for (const type of touchTypes) canvas.removeEventListener(type, touch);
    for (const type of pointerTypes) canvas.removeEventListener(type, pointer, true);
  };
}

// src/ui/brush-settings-panel.ts
function isConfigurableTool(tool) {
  return tool === "ballpoint" || tool === "pen" || tool === "highlighter" || tool === "laser" || tool === "eraser" || tool === "select";
}
var BrushSettingsPanel = class {
  constructor(panel, settings, actions) {
    this.panel = panel;
    this.settings = settings;
    this.actions = actions;
    this.listeners = null;
    this.rangeCleanups = [];
  }
  dispose() {
    var _a;
    (_a = this.listeners) == null ? void 0 : _a.abort();
    this.listeners = null;
    for (const cleanup of this.rangeCleanups.splice(0)) cleanup();
  }
  render(tool, colorOnlyRequested) {
    var _a, _b, _c, _d;
    this.dispose();
    this.panel.empty();
    if (!isConfigurableTool(tool)) {
      this.panel.hidden = true;
      return;
    }
    const signal = (this.listeners = new AbortController()).signal;
    const names = {
      ballpoint: "\u5706\u73E0\u7B14",
      pen: "\u94A2\u7B14",
      highlighter: "\u8367\u5149\u7B14",
      laser: "\u6FC0\u5149\u7B14",
      eraser: "\u6A61\u76AE\u64E6",
      select: "\u9009\u62E9"
    };
    const colorOnly = colorOnlyRequested && isColorTool(tool);
    const activeColorConfig = () => isColorTool(tool) ? tool === "laser" ? this.settings.laser : this.settings.brushes[tool] : null;
    this.panel.toggleClass("is-color-panel", colorOnly);
    this.panel.style.setProperty("--infinite-board-panel-ink", (_b = (_a = activeColorConfig()) == null ? void 0 : _a.color) != null ? _b : "#202022");
    const header = this.panel.createDiv({ cls: "infinite-board-brush-header" });
    header.createDiv({ cls: "infinite-board-brush-title", text: colorOnly ? "\u989C\u8272" : names[tool] });
    const close = header.createEl("button", {
      cls: "infinite-board-panel-close",
      attr: { type: "button", "aria-label": "\u5173\u95ED\u8BBE\u7F6E", title: "\u5173\u95ED\u8BBE\u7F6E" }
    });
    (0, import_obsidian.setIcon)(close, "x");
    close.addEventListener("click", this.actions.close, { signal });
    const addRange = (label, minimum, maximum, step, current, format, apply) => {
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
        var _a2;
        const value = Number(input.value);
        apply(value);
        output.textContent = format(value);
        this.actions.updateButtons();
        const stroke = this.panel.querySelector(".infinite-board-brush-preview-stroke");
        const config = activeColorConfig();
        if (stroke && config) {
          stroke.style.strokeWidth = `${Math.min(24, config.size)}px`;
          stroke.style.opacity = String((_a2 = config.opacity) != null ? _a2 : 1);
        }
        this.actions.scheduleRender();
      }, { signal });
      input.addEventListener("change", () => {
        this.actions.saveSettings();
        this.render(tool, colorOnlyRequested);
      }, { signal });
    };
    const addNamedOptions = (label, values, current, labels, apply) => {
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
      const colorConfig2 = activeColorConfig();
      if (!colorConfig2 || !isColorTool(tool)) {
        this.panel.hidden = true;
        return;
      }
      const source = this.actions.colorSource(tool, colorConfig2.color);
      const grid = this.panel.createDiv({ cls: "infinite-board-color-grid", attr: { role: "group", "aria-label": "\u66F4\u591A\u989C\u8272" } });
      for (const color2 of MORE_COLORS) {
        const active = source === "more" && color2.toLowerCase() === colorConfig2.color.toLowerCase();
        const swatch = grid.createEl("button", {
          cls: `infinite-board-color-cell${active ? " is-active" : ""}`,
          attr: { type: "button", "aria-label": `\u9009\u62E9\u989C\u8272 ${color2}`, "aria-pressed": active ? "true" : "false" }
        });
        swatch.style.setProperty("--infinite-board-cell-color", color2);
        swatch.addEventListener("click", () => {
          colorConfig2.color = color2;
          this.actions.setMoreColor(tool);
          this.actions.saveSettings();
          this.actions.updateButtons();
          this.render(tool, colorOnlyRequested);
          this.actions.scheduleRender();
        }, { signal });
      }
      const opacity = tool === "laser" ? (_c = this.settings.laser.opacity) != null ? _c : 1 : this.settings.brushes[tool].opacity;
      addRange("\u4E0D\u900F\u660E\u5EA6", 10, 100, 1, Math.round(opacity * 100), (value) => `${Math.round(value)}%`, (value) => {
        if (tool === "laser") this.settings.laser.opacity = value / 100;
        else this.settings.brushes[tool].opacity = value / 100;
      });
      const valueRow = this.panel.createDiv({ cls: "infinite-board-color-value" });
      const dot = valueRow.createSpan({ cls: "infinite-board-color-value-dot", attr: { "aria-hidden": "true" } });
      dot.style.backgroundColor = colorConfig2.color;
      valueRow.createEl("output", { text: colorConfig2.color.toUpperCase() });
      return;
    }
    if (tool === "eraser") {
      const eraser = this.settings.eraser;
      addNamedOptions("\u64E6\u9664\u65B9\u5F0F", ["partial", "stroke"], eraser.mode, { partial: "\u5C40\u90E8\u64E6\u9664", stroke: "\u6574\u7B14\u64E6\u9664" }, (value) => eraser.mode = value);
      addRange("\u5927\u5C0F", 12, 96, 1, eraser.size, (value) => `${Math.round(value)} px`, (value) => eraser.size = value);
      return;
    }
    if (tool === "select") {
      addNamedOptions("\u9009\u62E9\u65B9\u5F0F", ["lasso", "rectangle"], this.settings.selectionMode, { lasso: "\u81EA\u7531\u5957\u7D22", rectangle: "\u77E9\u5F62\u6846\u9009" }, (value) => this.settings.selectionMode = value);
      return;
    }
    const colorConfig = activeColorConfig();
    if (!colorConfig || !isColorTool(tool)) return;
    const preview = this.panel.createDiv({ cls: "infinite-board-brush-preview", attr: { "aria-label": "\u7B14\u5237\u6548\u679C\u9884\u89C8" } });
    const previewSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    previewSvg.setAttribute("class", "infinite-board-brush-preview-svg");
    previewSvg.setAttribute("viewBox", "0 0 320 64");
    previewSvg.setAttribute("aria-hidden", "true");
    const previewStroke = document.createElementNS("http://www.w3.org/2000/svg", "path");
    previewStroke.setAttribute("class", `infinite-board-brush-preview-stroke is-${tool}`);
    previewStroke.setAttribute("d", "M 18 42 C 76 12, 126 14, 166 34 S 246 54, 302 20");
    previewStroke.style.stroke = colorConfig.color;
    previewStroke.style.color = colorConfig.color;
    const previewOpacity = tool === "laser" ? (_d = this.settings.laser.opacity) != null ? _d : 1 : this.settings.brushes[tool].opacity;
    previewStroke.style.opacity = String(previewOpacity);
    previewStroke.style.strokeWidth = `${Math.min(24, tool === "laser" ? this.settings.laser.size : this.settings.brushes[tool].size)}px`;
    previewSvg.appendChild(previewStroke);
    preview.appendChild(previewSvg);
    if (tool === "laser") {
      const laser2 = this.settings.laser;
      addRange("\u7C97\u7EC6", 1, 16, 0.5, laser2.size, (value) => `${value} px`, (value) => laser2.size = value);
      addRange("\u505C\u7559\u65F6\u95F4", 1, 10, 1, laser2.holdMs / 1e3, (value) => `${value} \u79D2`, (value) => laser2.holdMs = value * 1e3);
      addRange("\u5149\u6655", 0, 24, 1, laser2.glow, (value) => value === 0 ? "\u5173\u95ED" : `${value} px`, (value) => laser2.glow = value);
      return;
    }
    const brush2 = this.settings.brushes[tool];
    const maximumSize = tool === "highlighter" ? 64 : 16;
    addRange("\u7C97\u7EC6", 1, maximumSize, 0.5, brush2.size, (value) => `${value} px`, (value) => brush2.size = value);
    addRange("\u900F\u660E\u5EA6", 10, 100, 1, Math.round(brush2.opacity * 100), (value) => `${Math.round(value)}%`, (value) => brush2.opacity = value / 100);
    if (tool !== "highlighter") {
      const pressureValues = ["off", "soft", "standard", "strong"];
      const index = Math.max(0, pressureValues.indexOf(brush2.pressure));
      addRange("\u538B\u611F\u5F3A\u5EA6", 0, 3, 1, index, (value) => `${Math.round(value / 3 * 100)}%`, (value) => {
        brush2.pressure = pressureValues[Math.max(0, Math.min(3, Math.round(value)))];
      });
    }
  }
};

// src/ui/phone-rail-swipe.ts
var PhoneRailSwipe = class {
  constructor() {
    this.contactId = null;
    this.startX = 0;
    this.startY = 0;
    this.startScroll = 0;
    this.scale = 1;
    this.direction = null;
  }
  start(contacts, scrollLeft, scale = 1) {
    this.reset();
    if (contacts.length !== 1) return;
    this.contactId = contacts[0].identifier;
    this.startX = contacts[0].clientX;
    this.startY = contacts[0].clientY;
    this.startScroll = scrollLeft;
    this.scale = Math.max(0.01, scale);
  }
  move(contacts) {
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
  end() {
    const swiped = this.direction !== null;
    this.reset();
    return swiped;
  }
  reset() {
    this.contactId = null;
    this.direction = null;
  }
};
function bindPhoneToolbarSwipe(toolbar, rail, signal) {
  const gesture = new PhoneRailSwipe();
  let suppressClick = false;
  let suppressTimer;
  const contacts = (event) => Array.from(event.touches);
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
  const finish = (event) => {
    suppressClick = gesture.end();
    if (suppressClick) {
      globalThis.clearTimeout(suppressTimer);
      suppressTimer = globalThis.setTimeout(() => {
        suppressClick = false;
      }, 250);
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
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    toolbar.addEventListener(type, (event) => {
      if (event.pointerType === "touch") event.stopPropagation();
    }, { signal });
  }
}

// src/ui/creative-toolbar-view.ts
function createCreativeToolbar(parent, actions) {
  const controller = new AbortController();
  const signal = controller.signal;
  const toolbar = parent.createDiv({ cls: "infinite-board-toolbar", attr: { role: "toolbar", "aria-label": "\u521B\u4F5C\u5DE5\u5177" } });
  const navigation = toolbar.createDiv({ cls: "infinite-board-toolbar-navigation" });
  for (const tool of ["select", "hand"]) addToolButton(navigation, tool);
  toolbar.createDiv({ cls: "infinite-board-toolbar-divider", attr: { role: "separator" } });
  const rail = toolbar.createDiv({ cls: "infinite-board-instrument-rail", attr: { "aria-label": "\u753B\u7B14\u4E0E\u6A61\u76AE" } });
  for (const tool of ["ballpoint", "pen", "highlighter", "laser", "eraser"]) addToolButton(rail, tool);
  if (import_obsidian2.Platform.isPhone) bindPhoneToolbarSwipe(toolbar, rail, signal);
  const palette = toolbar.createDiv({ cls: "infinite-board-toolbar-palette", attr: { "aria-label": "\u753B\u7B14\u989C\u8272" } });
  for (const color2 of TOOLBAR_PRESET_COLORS) {
    const button = palette.createEl("button", {
      cls: "infinite-board-toolbar-swatch",
      attr: { type: "button", "aria-label": `\u9009\u62E9\u989C\u8272 ${color2}`, "data-color": color2 }
    });
    button.style.setProperty("--infinite-board-swatch-color", color2);
    button.createSpan({ cls: "infinite-board-swatch-fill", attr: { "aria-hidden": "true" } });
    button.addEventListener("click", () => actions.selectColor(color2), { signal });
  }
  const more = palette.createEl("button", {
    cls: "infinite-board-toolbar-swatch infinite-board-more-colors",
    attr: { type: "button", "aria-label": "\u66F4\u591A\u989C\u8272", title: "\u66F4\u591A\u989C\u8272" }
  });
  const rainbow = more.createSpan({ cls: "infinite-board-swatch-fill", attr: { "aria-hidden": "true" } });
  rainbow.createSpan({ cls: "infinite-board-more-colors-core" });
  more.addEventListener("click", actions.openMoreColors, { signal });
  let drag = null;
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
  const finish = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.moved) {
      suppressClick = true;
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => {
        suppressClick = false;
      }, 80);
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
  const collapseLabel = "\u6536\u8D77\u521B\u4F5C\u5DE5\u5177\u680F";
  const toggle = toolbar.createEl("button", {
    cls: "infinite-board-tool infinite-board-action infinite-board-toolbar-toggle",
    attr: { type: "button", "aria-label": collapseLabel, title: collapseLabel, "aria-expanded": "true" }
  });
  (0, import_obsidian2.setIcon)(toggle, "chevron-down");
  toggle.addEventListener("click", () => {
    const collapsed = toolbar.classList.toggle("is-collapsed");
    (0, import_obsidian2.setIcon)(toggle, collapsed ? "pen-line" : "chevron-down");
    const label = collapsed ? "\u5C55\u5F00\u5DE5\u5177\u680F" : collapseLabel;
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
  function addToolButton(container, tool) {
    const definition = TOOL_DEFINITIONS.find((candidate) => candidate.id === tool);
    if (!definition) return;
    const stationery = tool === "ballpoint" || tool === "pen" || tool === "highlighter" || tool === "laser" || tool === "eraser";
    const button = container.createEl("button", {
      cls: stationery ? `infinite-board-tool infinite-board-stationery infinite-board-stationery-${tool}` : "infinite-board-tool infinite-board-navigation-tool",
      attr: { type: "button", "aria-label": definition.label, title: isConfigurableTool(tool) ? `${definition.label} \xB7 \u518D\u6B21\u70B9\u51FB\u6253\u5F00\u8BBE\u7F6E` : definition.label, "data-tool": tool }
    });
    if (stationery) buildStationery(button, tool);
    else (0, import_obsidian2.setIcon)(button, definition.icon);
    button.createSpan({ cls: "infinite-board-tool-label", text: definition.label });
    button.addEventListener("click", () => actions.selectTool(tool), { signal });
  }
}
function buildStationery(button, tool) {
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

// src/ui/canvas-paste-position.ts
function pasteMenuPointFromClient(client, viewOrigin, frameOrigin) {
  var _a, _b;
  return {
    x: client.x + ((_a = frameOrigin == null ? void 0 : frameOrigin.x) != null ? _a : 0) - viewOrigin.x,
    y: client.y + ((_b = frameOrigin == null ? void 0 : frameOrigin.y) != null ? _b : 0) - viewOrigin.y
  };
}
function useSystemPasteTarget(isIosApp, isTablet) {
  return isIosApp && isTablet;
}
function pasteMenuPosition(point, menu, view, edge = 10) {
  const maxX = Math.max(edge, view.width - menu.width - edge);
  const maxY = Math.max(edge, view.height - menu.height - edge);
  const above = point.y - menu.height - 12;
  const y = above >= edge ? above : point.y + 12;
  return {
    x: Math.max(edge, Math.min(maxX, point.x - menu.width / 2)),
    y: Math.max(edge, Math.min(maxY, y))
  };
}

// src/ui/rapid-tap-sequence.ts
var RapidTapSequence = class {
  constructor(requiredTaps = 5, windowMs = 1500) {
    this.requiredTaps = requiredTaps;
    this.windowMs = windowMs;
    this.taps = [];
  }
  register(timestamp) {
    this.taps = this.taps.filter((tap) => timestamp - tap <= this.windowMs);
    this.taps.push(timestamp);
    if (this.taps.length < this.requiredTaps) return false;
    this.reset();
    return true;
  }
  reset() {
    this.taps = [];
  }
};

// main.ts
var VIEW_TYPE = "infinite-board-view";
var BOARD_EXTENSION = "board";
var DiagnosticReportModal = class extends import_obsidian3.Modal {
  constructor(app, report) {
    super(app);
    this.report = report;
  }
  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "\u8F93\u5165\u8BCA\u65AD\u65E5\u5FD7" });
    this.contentEl.createDiv({ text: "\u957F\u6309\u4E0B\u9762\u7684\u6587\u672C\u5E76\u5168\u9009\u590D\u5236\uFF0C\u7136\u540E\u76F4\u63A5\u53D1\u7ED9\u6211\u3002" });
    const text = this.contentEl.createEl("textarea", {
      cls: "infinite-board-diagnostic-report",
      attr: { readonly: "", "aria-label": "\u8F93\u5165\u8BCA\u65AD\u65E5\u5FD7" }
    });
    text.value = this.report;
    const select = this.contentEl.createEl("button", { cls: "mod-cta", text: "\u5168\u9009\u65E5\u5FD7", attr: { type: "button" } });
    select.addEventListener("click", () => {
      text.focus();
      text.select();
    });
  }
};
var RenameBoardModal = class extends import_obsidian3.Modal {
  constructor(app, currentName, rename) {
    super(app);
    this.currentName = currentName;
    this.rename = rename;
  }
  onOpen() {
    this.setTitle("\u91CD\u547D\u540D\u753B\u677F");
    const form = this.contentEl.createEl("form", { cls: "infinite-board-rename-form" });
    form.createEl("label", { text: "\u753B\u677F\u540D\u79F0", attr: { for: "infinite-board-rename-input" } });
    this.input = form.createEl("input", {
      attr: {
        id: "infinite-board-rename-input",
        type: "text",
        value: this.currentName,
        maxlength: "120",
        autocomplete: "off"
      }
    });
    const actions = form.createDiv({ cls: "infinite-board-crop-actions" });
    const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: "\u5B8C\u6210", attr: { type: "submit" } });
    form.addEventListener("submit", (event) => {
      var _a, _b;
      event.preventDefault();
      const name = (_b = (_a = this.input) == null ? void 0 : _a.value) != null ? _b : "";
      void this.submit(name);
    });
    window.setTimeout(() => {
      var _a, _b;
      (_a = this.input) == null ? void 0 : _a.focus();
      (_b = this.input) == null ? void 0 : _b.select();
    }, 0);
  }
  async submit(name) {
    try {
      await this.rename(name);
      this.close();
    } catch (error) {
      console.error("Infinite Board: rename failed", error);
      new import_obsidian3.Notice(error instanceof Error ? error.message : "\u753B\u677F\u91CD\u547D\u540D\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", 5e3);
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};
var SaveRecoveryModal = class extends import_obsidian3.Modal {
  constructor(app, canRetry, retry, saveRecoveryCopy) {
    super(app);
    this.canRetry = canRetry;
    this.retry = retry;
    this.saveRecoveryCopy = saveRecoveryCopy;
  }
  onOpen() {
    this.setTitle("\u4FDD\u5B58\u5931\u8D25\uFF0C\u5F53\u524D\u5185\u5BB9\u4ECD\u5728");
    this.contentEl.createDiv({ text: "\u753B\u677F\u8FD8\u4FDD\u7559\u5728\u5F53\u524D\u9875\u9762\u3002\u4F60\u53EF\u4EE5\u91CD\u8BD5\u4FDD\u5B58\uFF1B\u82E5\u62C5\u5FC3\u540C\u6B65\u6216\u5B58\u50A8\u5F02\u5E38\uFF0C\u4E5F\u53EF\u4EE5\u5148\u53E6\u5B58\u4E00\u4EFD\u6062\u590D\u526F\u672C\u3002" });
    const actions = this.contentEl.createDiv({ cls: "infinite-board-crop-actions" });
    const close = actions.createEl("button", { text: "\u7A0D\u540E\u5904\u7406", attr: { type: "button" } });
    close.addEventListener("click", () => this.close());
    const backup = actions.createEl("button", { text: "\u53E6\u5B58\u6062\u590D\u526F\u672C", attr: { type: "button" } });
    backup.addEventListener("click", () => void this.saveCopy(backup));
    if (this.canRetry) {
      const retry = actions.createEl("button", { cls: "mod-cta", text: "\u7ACB\u5373\u91CD\u8BD5", attr: { type: "button" } });
      retry.addEventListener("click", () => {
        this.retry();
        this.close();
      });
    }
  }
  async saveCopy(button) {
    button.disabled = true;
    try {
      await this.saveRecoveryCopy();
      this.close();
    } catch (error) {
      console.error("Infinite Board: recovery copy failed", error);
      button.disabled = false;
      new import_obsidian3.Notice("\u6062\u590D\u526F\u672C\u521B\u5EFA\u5931\u8D25\u3002\u8BF7\u4FDD\u6301\u5F53\u524D\u753B\u677F\u6253\u5F00\u5E76\u68C0\u67E5\u5B58\u50A8\u7A7A\u95F4\u6216 Sync \u72B6\u6001\u3002", 6e3);
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ConflictRecoveryModal = class extends import_obsidian3.Modal {
  constructor(app, conflictPath, openConflictCopy) {
    super(app);
    this.conflictPath = conflictPath;
    this.openConflictCopy = openConflictCopy;
  }
  onOpen() {
    this.setTitle("\u540C\u6B65\u51B2\u7A81\u5DF2\u4FDD\u62A4");
    this.contentEl.createDiv({ text: "\u5F53\u524D\u753B\u677F\u6CA1\u6709\u88AB\u540C\u6B65\u5185\u5BB9\u8986\u76D6\u3002\u672C\u5730\u5185\u5BB9\u5DF2\u53E6\u5B58\u4E3A\u72EC\u7ACB\u51B2\u7A81\u526F\u672C\uFF0C\u539F\u753B\u677F\u4FDD\u6301\u505C\u6B62\u4FDD\u5B58\u3002" });
    this.contentEl.createDiv({ cls: "infinite-board-recovery-path", text: `\u51B2\u7A81\u526F\u672C\uFF1A${this.conflictPath}` });
    const actions = this.contentEl.createDiv({ cls: "infinite-board-crop-actions" });
    const close = actions.createEl("button", { text: "\u5173\u95ED", attr: { type: "button" } });
    close.addEventListener("click", () => this.close());
    const open = actions.createEl("button", { cls: "mod-cta", text: "\u6253\u5F00\u51B2\u7A81\u526F\u672C", attr: { type: "button" } });
    open.addEventListener("click", () => void this.openCopy(open));
  }
  async openCopy(button) {
    button.disabled = true;
    try {
      await this.openConflictCopy();
      this.close();
    } catch (error) {
      console.error("Infinite Board: open conflict copy failed", error);
      button.disabled = false;
      new import_obsidian3.Notice("\u65E0\u6CD5\u6253\u5F00\u51B2\u7A81\u526F\u672C\uFF0C\u8BF7\u5728\u6587\u4EF6\u5217\u8868\u4E2D\u6309\u4E0A\u65B9\u8DEF\u5F84\u67E5\u627E\u3002", 6e3);
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ImageRecoveryModal = class extends import_obsidian3.Modal {
  constructor(app, health, recover) {
    super(app);
    this.health = health;
    this.recover = recover;
  }
  onOpen() {
    var _a;
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "\u753B\u677F\u56FE\u7247\u4E0E\u540C\u6B65\u68C0\u67E5" });
    this.contentEl.createDiv({ text: `\u753B\u677F\u6587\u4EF6\uFF1A${(this.health.boardBytes / 1024 / 1024).toFixed(2)} MB` });
    this.contentEl.createDiv({ text: `\u5DF2\u5F15\u7528\u56FE\u7247\uFF1A${this.health.referencedImages} \u5F20\uFF1B\u7F3A\u5931\u9644\u4EF6\uFF1A${this.health.missingImages} \u5F20\uFF1B\u672A\u5173\u8054\u9644\u4EF6\uFF1A${this.health.unlinkedPaths.length} \u5F20` });
    if (this.health.missingImages > 0) this.contentEl.createDiv({ text: "\u7F3A\u5931\u9644\u4EF6\u4ECD\u9700\u7B49\u5F85 Obsidian Sync \u4E0B\u8F7D\u5B8C\u6210\u3002\u63D2\u4EF6\u4F1A\u5728\u540E\u53F0\u8FDB\u884C\u6709\u754C\u91CD\u8BD5\u3002" });
    if (this.health.unlinkedPaths.length > 0) {
      this.contentEl.createDiv({ text: "\u672A\u5173\u8054\u9644\u4EF6\u5B58\u5728\u4E8E\u5F53\u524D\u753B\u677F\u7684 .assets \u6587\u4EF6\u5939\uFF0C\u4F46\u753B\u677F JSON \u6CA1\u6709\u8BB0\u5F55\u5176\u4F4D\u7F6E\u3002\u6062\u590D\u540E\u4F1A\u6309\u7F51\u683C\u653E\u5230\u5F53\u524D\u89C6\u53E3\uFF0C\u53EF\u64A4\u9500\uFF1B\u9644\u4EF6\u4E0D\u4F1A\u88AB\u79FB\u52A8\u6216\u5220\u9664\u3002" });
      const list = this.contentEl.createEl("ul");
      for (const path of this.health.unlinkedPaths.slice(0, 12)) list.createEl("li", { text: (_a = path.split("/").pop()) != null ? _a : path });
      if (this.health.unlinkedPaths.length > 12) list.createEl("li", { text: `\u53E6\u6709 ${this.health.unlinkedPaths.length - 12} \u5F20\u2026\u2026` });
    }
    const actions = this.contentEl.createDiv({ cls: "infinite-board-crop-actions" });
    const close = actions.createEl("button", { text: "\u5173\u95ED", attr: { type: "button" } });
    close.addEventListener("click", () => this.close());
    if (this.health.unlinkedPaths.length > 0) {
      const apply = actions.createEl("button", { cls: "mod-cta", text: `\u6062\u590D ${this.health.unlinkedPaths.length} \u5F20\u56FE\u7247`, attr: { type: "button" } });
      apply.addEventListener("click", () => {
        this.close();
        this.recover();
      });
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};
var InfiniteBoardPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = structuredClone(DEFAULT_SETTINGS);
  }
  async onload() {
    if (!runtimeMatchesManifest(this.manifest.version)) {
      new import_obsidian3.Notice(`Infinite Board \u6587\u4EF6\u5C1A\u672A\u540C\u6B65\u5B8C\u6574\uFF1A\u8FD0\u884C\u65F6\u4EE3\u7801 ${RUNTIME_VERSION}\uFF0C\u6E05\u5355 ${this.manifest.version}\u3002\u8BF7\u7B49\u5F85 Obsidian Sync \u5B8C\u6210\u540E\u5F7B\u5E95\u9000\u51FA\u5E76\u91CD\u65B0\u6253\u5F00 Obsidian\u3002`, 12e3);
    }
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new InfiniteBoardView(leaf, this));
    this.registerExtensions([BOARD_EXTENSION], VIEW_TYPE);
    const syncMobileFocus = (leaf) => {
      const active = import_obsidian3.Platform.isPhone && (leaf == null ? void 0 : leaf.view.getViewType()) === VIEW_TYPE;
      document.body.classList.toggle("infinite-board-mobile-focus", active);
    };
    this.registerEvent(this.app.workspace.on("active-leaf-change", syncMobileFocus));
    this.app.workspace.onLayoutReady(() => syncMobileFocus(this.app.workspace.activeLeaf));
    this.addRibbonIcon("pen-tool", "\u65B0\u5EFA\u65E0\u9650\u753B\u5E03", () => void this.createBoard());
    this.addCommand({
      id: "create-board",
      name: "\u65B0\u5EFA\u65E0\u9650\u753B\u5E03",
      callback: () => void this.createBoard()
    });
    this.addCommand({
      id: "recover-unlinked-board-images",
      name: "\u68C0\u67E5\u5E76\u6062\u590D\u5F53\u524D\u753B\u677F\u56FE\u7247",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(InfiniteBoardView);
        if (!view) return false;
        if (!checking) void view.inspectAndRecoverImages();
        return true;
      }
    });
  }
  onunload() {
    document.body.classList.remove("infinite-board-mobile-focus");
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = mergeSettings(loaded);
  }
  async createBoard() {
    const folder = "Infinite Boards";
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
    const stamp = window.moment().format("YYYY-MM-DD HH-mm-ss");
    const path = (0, import_obsidian3.normalizePath)(`${folder}/\u65E0\u9650\u753B\u5E03 ${stamp}.${BOARD_EXTENSION}`);
    const file = await this.app.vault.create(path, serializeBoard(emptyBoard()));
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }
};
var InfiniteBoardView = class extends import_obsidian3.FileView {
  constructor(leaf, plugin) {
    super(leaf);
    this.data = emptyBoard();
    this.canSave = true;
    this.saveState = new BoardSaveState();
    this.conflictRecovery = new ConflictRecoveryState();
    this.boardSession = new BoardSession();
    this.saveFlights = new BoardSaveFlights();
    this.imageImportTasks = /* @__PURE__ */ new Set();
    this.externalCheckTimer = 0;
    this.inputFrame = null;
    this.toolbarUi = null;
    this.canvasPasteProxy = null;
    this.canvasPasteProxyTimer = 0;
    this.canvasPastePoint = { x: 0, y: 0 };
    this.brushPanelView = null;
    this.brushPanelColorOnly = false;
    this.colorSources = /* @__PURE__ */ new Map();
    this.selectionActionButtons = /* @__PURE__ */ new Map();
    this.diagnosticValueEls = /* @__PURE__ */ new Map();
    this.headerActionEls = [];
    this.diagnosticsStatusTaps = new RapidTapSequence(5, 1500);
    this.diagnosticsVisible = false;
    this.diagnosticTimer = 0;
    this.lastDiagnosticUpdate = 0;
    this.lastInputType = "\u5C1A\u672A\u68C0\u6D4B";
    this.pencilDetected = false;
    this.lastPressure = 0;
    this.sampleRate = 0;
    this.lastSampleTime = 0;
    this.coalescedSamples = 0;
    this.lastOutlinePointCount = 0;
    this.recentPointerEvents = [];
    this.penPointerStarts = 0;
    this.stylusTouchStarts = 0;
    this.stylusHandoffs = 0;
    this.pointerFallbackStrokes = 0;
    this.orphanedStylusRecoveries = 0;
    this.maxEventLoopDelay = 0;
    this.lastSaveDuration = 0;
    this.maxSaveDuration = 0;
    this.inputDocumentScrolls = 0;
    this.hostDocumentScrolls = 0;
    this.hostDocumentPenStarts = 0;
    this.scribbleTouchCancels = 0;
    this.recoveredPointerStarts = 0;
    this.stylusTouchFallbackStarts = 0;
    this.presentationRecoveryFrames = 0;
    this.penButtonPress = null;
    this.lastPenActivatedButton = null;
    this.suppressPenClickUntil = 0;
    this.dispatchingPenButtonClick = false;
    this.lastHitTarget = "--";
    this.inputTrace = new InputFlightRecorder();
    this.inputToolMetrics = new InputToolMetrics();
    this.activeDiagnosticTool = null;
    this.lastTracedMoveAt = 0;
    this.lastCanvasCssWidth = 0;
    this.lastCanvasCssHeight = 0;
    this.resizeCameraPersistenceReady = false;
    this.resizePersistenceFrame = 0;
    this.frame = 0;
    this.presentationFrame = 0;
    this.presentationUntil = 0;
    this.currentStroke = null;
    this.useIosTouchEvents = import_obsidian3.Platform.isIosApp;
    // The default follows the same ownership boundary used by mature canvas
    // applications: Pointer Events reach the canvas first, which captures the
    // active pointer for the rest of the gesture. Legacy Stylus Touch remains
    // available only as an in-memory diagnostic fallback.
    this.iosInputMode = "pointer-capture";
    this.iosStylusTouchConfirmed = false;
    this.activeInputSource = null;
    this.stylusTouchId = null;
    this.drawingPointer = null;
    this.activePointerStartedAt = 0;
    this.penPointer = null;
    this.stylusPointerIds = /* @__PURE__ */ new Set();
    this.touchPointers = /* @__PURE__ */ new Map();
    this.lastTouchCenter = null;
    this.lastPinchDistance = 0;
    this.history = new BoardHistory();
    this.saveTimer = 0;
    this.strokePathCache = /* @__PURE__ */ new Map();
    this.sceneRenderer = new SceneRenderer();
    this.toolControllers = new ToolControllerRegistry();
    this.laserFrame = 0;
    this.activeInputPersistent = true;
    this.lastEraserPoint = null;
    this.eraserPreview = null;
    this.elementClipboard = [];
    this.pasteSequence = 0;
    this.canvasLongPress = null;
    this.ignoreCanvasContextMenuUntil = 0;
    this.phoneFingerInput = null;
    this.phoneFingerDrawingPointer = null;
    this.boardTitleEl = null;
    this.visibleSaveState = "saved";
    this.selection = new SelectionController();
    this.spatialIndex = new ElementSpatialIndex();
    this.plugin = plugin;
    this.tool = plugin.settings.activeTool;
    this.boardAssets = new BoardAssetCoordinator({
      resourceUrl: (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof import_obsidian3.TFile ? this.app.vault.getResourcePath(file) : null;
      },
      onImageReady: () => {
        this.invalidateSceneCache();
        this.scheduleRender();
      }
    });
    this.laserController = new LaserController(
      () => this.plugin.settings.laser,
      () => performance.now(),
      () => {
        if (this.laserFrame) window.cancelAnimationFrame(this.laserFrame);
        this.laserFrame = 0;
      }
    );
    this.toolControllers.register("laser", this.laserController);
  }
  get dirty() {
    return this.saveState.dirty;
  }
  get revision() {
    return this.saveState.revision;
  }
  get isSaving() {
    return this.saveState.saving;
  }
  get lastSavedContent() {
    return this.saveState.lastSavedContent;
  }
  get conflictDetected() {
    return this.saveState.conflictDetected;
  }
  async onOpen() {
    await super.onOpen();
    let expectedHeartbeat = performance.now() + 250;
    this.registerInterval(window.setInterval(() => {
      const now = performance.now();
      if (document.visibilityState === "visible") {
        const delay = Math.max(0, now - expectedHeartbeat);
        this.maxEventLoopDelay = Math.max(this.maxEventLoopDelay, delay);
        if (delay >= 120) this.traceInput("event-loop-delay", `${Math.round(delay)}ms`);
        this.scheduleDiagnostics();
      }
      expectedHeartbeat = now + 250;
    }, 250));
    this.registerDomEvent(document, "visibilitychange", () => {
      this.traceInput("visibility", document.visibilityState);
      if (document.visibilityState === "hidden") {
        this.cancelSelection();
        this.finishActiveInput(false);
        this.clearLaserStrokes();
        void this.saveNow();
      }
    });
    this.registerDomEvent(window, "pagehide", () => {
      this.traceInput("pagehide", "window");
      this.cancelSelection();
      this.finishActiveInput(false);
      this.clearLaserStrokes();
      void this.saveNow();
    });
    this.registerDomEvent(window, "resize", () => this.resizeCanvas());
    this.registerDomEvent(window, "orientationchange", () => {
      window.setTimeout(() => this.resizeCanvas(), 120);
    });
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof import_obsidian3.TFile) {
        void this.onExternalModify(file);
        this.onReferencedImageAvailable(file);
      }
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof import_obsidian3.TFile) this.onReferencedImageAvailable(file);
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf !== this.leaf) this.cancelImageImports();
    }));
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    var _a, _b;
    return (_b = (_a = this.file) == null ? void 0 : _a.basename) != null ? _b : "\u65E0\u9650\u753B\u5E03";
  }
  registerBoardTitleRename() {
    var _a;
    const leaf = this.containerEl.closest(".workspace-leaf");
    const title = (_a = leaf == null ? void 0 : leaf.querySelector(".view-header-title")) != null ? _a : null;
    if (!title || title === this.boardTitleEl) return;
    this.boardTitleEl = title;
    title.addClass("infinite-board-title-rename-target");
    title.setAttribute("role", "button");
    title.setAttribute("tabindex", "0");
    title.setAttribute("aria-label", "\u91CD\u547D\u540D\u753B\u677F");
    title.setAttribute("title", "\u70B9\u51FB\u91CD\u547D\u540D\u753B\u677F");
    const open = () => this.openRenameBoardModal();
    this.registerDomEvent(title, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      open();
    });
    this.registerDomEvent(title, "keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    });
  }
  openRenameBoardModal() {
    if (!this.file) return;
    new RenameBoardModal(this.app, this.file.basename, async (rawName) => {
      var _a, _b;
      const name = normalizedBoardName(rawName);
      if (!name) throw new Error('\u8BF7\u8F93\u5165\u540D\u79F0\uFF0C\u4E14\u4E0D\u8981\u4F7F\u7528 / \\ : * ? " < > | \u7B49\u5B57\u7B26\u3002');
      if (!this.file) throw new Error("\u5F53\u524D\u753B\u677F\u5DF2\u5173\u95ED\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u540E\u518D\u91CD\u547D\u540D\u3002");
      const parent = (_b = (_a = this.file.parent) == null ? void 0 : _a.path) != null ? _b : "";
      const path = (0, import_obsidian3.normalizePath)(`${parent}/${name}.${BOARD_EXTENSION}`);
      if (path === this.file.path) return;
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing && existing !== this.file) throw new Error("\u5DF2\u6709\u540C\u540D\u6587\u4EF6\uFF0C\u8BF7\u6362\u4E00\u4E2A\u540D\u79F0\u3002");
      await this.app.fileManager.renameFile(this.file, path);
      new import_obsidian3.Notice("\u753B\u677F\u5DF2\u91CD\u547D\u540D\u3002", 2e3);
    }).open();
  }
  getIcon() {
    return "pen-tool";
  }
  async onLoadFile(file) {
    const session = this.boardSession.begin(file);
    try {
      await super.onLoadFile(file);
      if (!this.boardSession.isCurrent(session)) return;
      this.conflictRecovery.clear();
      this.resizeCameraPersistenceReady = false;
      await this.loadDataFromFile(file, session);
      if (!this.boardSession.isCurrent(session)) return;
      this.buildUi();
      this.registerBoardTitleRename();
    } catch (error) {
      this.boardSession.end(session);
      throw error;
    }
  }
  async onUnloadFile(file) {
    var _a, _b, _c;
    const session = this.boardSession.currentForFile(file);
    if (session) this.cancelImageImports(session);
    (_a = this.toolbarUi) == null ? void 0 : _a.dispose();
    this.toolbarUi = null;
    (_b = this.brushPanelView) == null ? void 0 : _b.dispose();
    this.brushPanelView = null;
    window.clearTimeout(this.saveTimer);
    window.clearTimeout(this.externalCheckTimer);
    (_c = this.resizeObserver) == null ? void 0 : _c.disconnect();
    if (this.resizePersistenceFrame) window.cancelAnimationFrame(this.resizePersistenceFrame);
    this.resizePersistenceFrame = 0;
    this.resizeCameraPersistenceReady = false;
    if (this.frame) window.cancelAnimationFrame(this.frame);
    if (this.presentationFrame) window.cancelAnimationFrame(this.presentationFrame);
    this.sceneRenderer.release();
    this.boardAssets.release();
    window.clearTimeout(this.diagnosticTimer);
    this.cancelCanvasLongPress();
    this.releaseCanvasPasteProxy();
    this.clearHeaderActions();
    this.toolControllers.deactivate();
    try {
      if (session) await this.saveFlights.wait(session);
      if (session && this.boardSession.isCurrent(session)) await this.saveNow();
      await super.onUnloadFile(file);
    } finally {
      this.boardSession.end(session);
    }
  }
  async loadDataFromFile(file, session) {
    try {
      const raw = await this.app.vault.read(file);
      if (!this.boardSession.isCurrent(session)) return;
      this.data = parseBoard(raw);
      this.spatialIndex.rebuild(this.data.elements);
      this.invalidateSceneCache();
      this.canSave = true;
      this.saveState.initialize(raw);
      this.setSaveState("saved");
    } catch (error) {
      if (!this.boardSession.isCurrent(session)) return;
      console.error("Infinite Board: failed to read board", error);
      this.data = emptyBoard();
      this.spatialIndex.clear();
      this.invalidateSceneCache();
      this.canSave = false;
      this.setSaveState("error");
      new import_obsidian3.Notice("\u753B\u5E03\u6570\u636E\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u5DF2\u6253\u5F00\u4E00\u4E2A\u7A7A\u767D\u6062\u590D\u89C6\u56FE\u3002\u539F\u6587\u4EF6\u672A\u88AB\u8986\u76D6\u3002", 6e3);
    }
  }
  buildUi() {
    var _a, _b;
    this.clearHeaderActions();
    (_a = this.toolbarUi) == null ? void 0 : _a.dispose();
    (_b = this.brushPanelView) == null ? void 0 : _b.dispose();
    this.contentEl.empty();
    this.contentEl.addClass("infinite-board-view");
    this.contentEl.toggleClass("is-desktop", import_obsidian3.Platform.isDesktop);
    this.contentEl.toggleClass("is-phone", import_obsidian3.Platform.isPhone);
    this.contentEl.toggleClass("is-tablet", import_obsidian3.Platform.isTablet);
    this.addHeaderAction("maximize", "\u9002\u5408\u5185\u5BB9", () => this.fitContent());
    this.addHeaderAction("image-plus", "\u63D2\u5165\u56FE\u7247", () => this.openImagePicker());
    this.addHeaderAction("redo-2", "\u91CD\u505A", () => this.redo());
    this.addHeaderAction("undo-2", "\u64A4\u9500", () => this.undo());
    this.toolbarUi = createCreativeToolbar(this.contentEl, {
      selectTool: (tool) => {
        if (this.tool === tool && isConfigurableTool(tool)) this.toggleBrushPanel(false);
        else this.setTool(tool);
      },
      selectColor: (color2) => this.applyToolbarColor(color2, "preset"),
      openMoreColors: () => {
        if (!isColorTool(this.tool)) return;
        this.brushPanelColorOnly = true;
        this.brushPanel.hidden = false;
        this.renderBrushPanel();
        this.updateToolButtons();
      },
      collapse: () => {
        var _a2;
        this.brushPanel.hidden = true;
        (_a2 = this.brushPanelView) == null ? void 0 : _a2.dispose();
        this.updateToolButtons();
      }
    });
    this.toolbar = this.toolbarUi.toolbar;
    this.palette = this.toolbarUi.palette;
    this.statusEl = this.contentEl.createDiv({ cls: "infinite-board-save-status" });
    this.statusEl.setAttribute("role", "button");
    this.statusEl.setAttribute("tabindex", "0");
    this.statusEl.setAttribute("aria-label", "\u4FDD\u5B58\u72B6\u6001\uFF1B\u8FDE\u7EED\u5FEB\u901F\u70B9\u51FB\u4E94\u6B21\u6253\u5F00\u8F93\u5165\u8BCA\u65AD");
    this.registerDomEvent(this.statusEl, "click", () => this.handleSaveStatusClick());
    this.registerDomEvent(this.statusEl, "keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.openSaveRecovery();
      }
    });
    this.diagnosticsEl = this.contentEl.createDiv({ cls: "infinite-board-diagnostics" });
    this.diagnosticsEl.hidden = true;
    this.buildDiagnosticsPanel();
    this.brushPanel = this.contentEl.createDiv({ cls: "infinite-board-brush-panel" });
    this.brushPanel.hidden = true;
    this.brushPanelView = new BrushSettingsPanel(this.brushPanel, this.plugin.settings, {
      close: () => {
        var _a2;
        this.brushPanel.hidden = true;
        this.brushPanelColorOnly = false;
        (_a2 = this.brushPanelView) == null ? void 0 : _a2.dispose();
        this.updateToolButtons();
      },
      updateButtons: () => this.updateToolButtons(),
      saveSettings: () => {
        void this.plugin.saveSettings();
      },
      scheduleRender: () => this.scheduleRender(),
      colorSource: (tool, color2) => this.colorSource(tool, color2),
      setMoreColor: (tool) => {
        this.colorSources.set(tool, "more");
      }
    });
    this.buildSelectionToolbar();
    this.imageInput = this.contentEl.createEl("input", {
      cls: "infinite-board-file-input",
      attr: { type: "file", accept: "image/*", multiple: "", "aria-label": "\u9009\u62E9\u56FE\u7247" }
    });
    this.registerDomEvent(this.imageInput, "change", () => {
      var _a2;
      const files = Array.from((_a2 = this.imageInput.files) != null ? _a2 : []);
      this.imageInput.value = "";
      if (files.length) void this.importImages(files);
    });
    this.buildCanvasPasteMenu();
    this.registerHostScribbleGuard();
    this.canvas = this.createDrawingCanvas();
    const dismissSettings = () => {
      var _a2;
      if (!this.canvasPasteMenu.hidden) this.hideCanvasPasteMenu();
      if (this.brushPanel.hidden) return;
      this.brushPanel.hidden = true;
      this.brushPanelColorOnly = false;
      (_a2 = this.brushPanelView) == null ? void 0 : _a2.dispose();
      this.updateToolButtons();
    };
    this.registerDomEvent(this.canvas, "pointerdown", dismissSettings, { capture: true, passive: true });
    this.registerDomEvent(this.canvas, "touchstart", dismissSettings, { passive: true });
    if (import_obsidian3.Platform.isPhone) {
      this.register(bindPhoneGestures(this.canvas, (points, moving) => {
        if (points.length >= 2) this.cancelCanvasLongPress();
        if (this.penPointer !== null) return;
        if (this.phoneFingerDrawingPointer !== null) {
          if (points.length < 2) return;
          this.cancelPhoneFingerInput();
        }
        const sameContacts = points.length === this.touchPointers.size && points.every((point) => this.touchPointers.has(point.id));
        this.touchPointers.clear();
        for (const point of points) this.touchPointers.set(point.id, { x: point.x, y: point.y });
        if (moving && sameContacts) this.updateTouchGesture();
        else this.resetTouchGesture();
      }, (event) => {
        this.onPhoneFingerPointer(event);
      }));
    }
    const context = this.canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context;
    this.registerDomEvent(this.canvas, "pointerleave", () => {
      if (this.drawingPointer === null) {
        this.eraserPreview = null;
        this.scheduleRender();
      }
    });
    this.registerDomEvent(this.canvas, "pointerdown", (event) => {
      if (this.canvasPasteProxy) this.releaseCanvasPasteProxy();
      this.beginCanvasLongPress(event);
      if (this.usesCanvasPointerInput()) this.onCanvasPointerDown(event);
    }, { passive: false });
    this.registerDomEvent(this.canvas, "pointermove", (event) => {
      this.updateCanvasLongPress(event);
      if (this.usesCanvasPointerInput()) this.onCanvasPointerMove(event);
    }, { passive: false });
    this.registerDomEvent(this.canvas, "pointerup", (event) => {
      this.finishCanvasLongPress(event);
      if (this.usesCanvasPointerInput()) this.onCanvasPointerUp(event, "up");
    }, { passive: false });
    this.registerDomEvent(this.canvas, "pointercancel", (event) => {
      this.cancelCanvasLongPress(event.pointerId);
      if (this.usesCanvasPointerInput()) this.onCanvasPointerUp(event, "cancel");
    }, { passive: false });
    this.registerDomEvent(this.canvas, "lostpointercapture", (event) => {
      if (this.usesCanvasPointerInput()) this.onLostPointerCapture(event);
    });
    this.registerDomEvent(this.canvas, "wheel", (event) => this.onWheel(event), { passive: false });
    if (this.inputFrame) {
      this.registerInputDocumentDropTarget(this.canvas.ownerDocument);
      this.registerImageDropTarget(this.contentEl);
    } else {
      this.registerImageDropTarget(this.canvas);
    }
    this.registerDomEvent(this.canvas, "contextmenu", (event) => {
      event.preventDefault();
      if (event.pointerType === "pen") return;
      if (useSystemPasteTarget(import_obsidian3.Platform.isIosApp, import_obsidian3.Platform.isTablet)) {
        const press = this.canvasLongPress;
        if (press) {
          if (this.touchPointers.size > 1) {
            this.cancelCanvasLongPress(press.pointerId);
            return;
          }
          this.cancelCanvasLongPress(press.pointerId);
          this.requestCanvasSystemPaste(press.clientX, press.clientY);
          return;
        }
        if (performance.now() < this.ignoreCanvasContextMenuUntil) return;
      }
      this.cancelCanvasLongPress();
      if (import_obsidian3.Platform.isIosApp && !this.canvasPasteMenu.hidden) return;
      this.showCanvasPasteMenu(event.clientX, event.clientY);
    });
    this.registerDomEvent(this.canvas, "keydown", (event) => this.onKeyDown(event));
    this.registerDomEvent(this.canvas, "paste", (event) => void this.onPaste(event));
    this.registerInputWindowEvents();
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(this.contentEl);
    this.setTool(this.tool, false);
    this.resizeCanvas();
    this.resizePersistenceFrame = window.requestAnimationFrame(() => {
      this.resizePersistenceFrame = window.requestAnimationFrame(() => {
        this.resizePersistenceFrame = 0;
        this.resizeCameraPersistenceReady = true;
      });
    });
    this.setSaveState(this.canSave ? this.dirty ? "unsaved" : "saved" : "error");
    this.updateDiagnostics();
  }
  phoneFingerUsesActiveTool() {
    return supportsPhoneFingerDrawing(this.tool);
  }
  onPhoneFingerPointer(event) {
    if (!this.phoneFingerUsesActiveTool()) {
      if (event.type === "pointerdown") this.beginCanvasLongPress(event);
      else if (event.type === "pointermove") this.updateCanvasLongPress(event);
      else this.cancelCanvasLongPress(event.pointerId);
      return;
    }
    const active = this.phoneFingerInput;
    if (event.type === "pointerdown") {
      if (active && active.pointerId !== event.pointerId) this.cancelPhoneFingerInput();
      if (!this.phoneFingerInput) this.phoneFingerInput = { pointerId: event.pointerId, down: event, started: false };
      return;
    }
    if (!active || active.pointerId !== event.pointerId) return;
    if (event.type === "pointermove") {
      if (!active.started) {
        if (this.touchPointers.size > 1) {
          this.cancelPhoneFingerInput();
          return;
        }
        this.phoneFingerDrawingPointer = active.pointerId;
        this.startPhoneFingerDrawing(active.down);
        active.started = true;
      }
      this.movePhoneFingerDrawing(event);
      return;
    }
    if (event.type === "pointerup" && !active.started) {
      this.phoneFingerDrawingPointer = active.pointerId;
      this.startPhoneFingerDrawing(active.down);
      active.started = true;
    }
    if (active.started) this.finishPhoneFingerDrawing(event, event.type === "pointercancel" ? "cancel" : "up");
    this.phoneFingerInput = null;
    this.phoneFingerDrawingPointer = null;
  }
  startPhoneFingerDrawing(event) {
    const screen2 = this.eventPoint(event);
    window.clearTimeout(this.saveTimer);
    this.drawingPointer = event.pointerId;
    this.activeInputSource = "pointer";
    this.activePointerStartedAt = event.timeStamp;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch (e) {
    }
    if (this.tool === "eraser") {
      this.eraserPreview = this.screenToWorld(screen2);
      this.activeInputPersistent = false;
      this.lastEraserPoint = null;
      this.pushHistory();
      this.eraseAlongPath(this.screenToWorld(screen2));
    } else if (this.tool === "select") {
      this.activeInputPersistent = false;
      this.startSelection(event.pointerId, screen2, false);
    } else if (this.tool === "laser") {
      this.activeDiagnosticTool = this.inputToolMetrics.recordStart(this.tool, "pointer");
      this.createLaserStroke(this.makePoint(this.screenToWorld(screen2), event, 0.5));
    } else {
      this.activeDiagnosticTool = this.inputToolMetrics.recordStart(this.tool, "pointer");
      this.activeInputPersistent = true;
      this.markDirty(false);
      this.currentStroke = this.createPersistentStroke(this.makePoint(this.screenToWorld(screen2), event));
      this.data.elements.push(this.currentStroke);
      this.spatialIndex.upsert(this.currentStroke);
    }
    event.preventDefault();
    this.scheduleRender();
  }
  movePhoneFingerDrawing(event) {
    if (this.drawingPointer !== event.pointerId) return;
    const screen2 = this.eventPoint(event);
    if (this.tool === "eraser") {
      this.eraserPreview = this.screenToWorld(screen2);
      for (const sample of this.pointerSamples(event)) this.eraseAlongPath(this.screenToWorld(this.eventPoint(sample)));
    } else if (this.tool === "select" && this.selection.activePointerId !== null) {
      this.updateSelection(this.screenToWorld(screen2));
    } else if (this.tool === "laser" && this.laserController.isDrawing) {
      const samples = this.pointerSamples(event);
      this.recordInput(event, samples.length, "touch");
      for (const sample of samples) this.appendLaserPoint(this.makePoint(this.screenToWorld(this.eventPoint(sample)), sample, 0.5));
    } else if (this.currentStroke) {
      const samples = this.pointerSamples(event);
      this.recordInput(event, samples.length, "touch");
      this.appendStrokeSamples(samples);
    }
    event.preventDefault();
    this.scheduleRender();
  }
  finishPhoneFingerDrawing(event, kind) {
    if (this.drawingPointer !== event.pointerId) return;
    if (this.tool === "select" && this.selection.activePointerId !== null) {
      if (kind === "cancel") {
        this.cancelSelection();
        this.finishActiveInput(false);
      } else {
        const changed = this.finishSelection(this.screenToWorld(this.eventPoint(event)));
        this.finishActiveInput(changed);
      }
      event.preventDefault();
      return;
    }
    if (this.tool === "eraser" && kind === "up") this.eraseAlongPath(this.screenToWorld(this.eventPoint(event)));
    if (this.currentStroke) this.appendStrokeSamples([event]);
    if (this.tool === "laser" && this.laserController.isDrawing) {
      this.finishLaserStroke(this.makePoint(this.screenToWorld(this.eventPoint(event)), event, 0.5));
    }
    this.eraserPreview = null;
    this.finishActiveInput(kind === "up" && this.activeInputPersistent);
    event.preventDefault();
  }
  cancelPhoneFingerInput() {
    const active = this.phoneFingerInput;
    this.cancelCanvasLongPress(active == null ? void 0 : active.pointerId);
    if ((active == null ? void 0 : active.started) && this.phoneFingerDrawingPointer === active.pointerId && this.drawingPointer === active.pointerId) {
      if (this.currentStroke) {
        const index = this.data.elements.findIndex((element) => {
          var _a;
          return element.id === ((_a = this.currentStroke) == null ? void 0 : _a.id);
        });
        if (index >= 0) this.data.elements.splice(index, 1);
        this.spatialIndex.remove(this.currentStroke.id);
        this.strokePathCache.delete(this.currentStroke.id);
        this.currentStroke = null;
        this.activeDiagnosticTool = null;
        this.invalidateSceneCache();
      } else if (this.tool === "select") {
        this.cancelSelection();
      } else if (this.tool === "laser") {
        this.finishActiveInput(false);
      } else if (this.tool === "eraser") {
        this.history.commit(this.data);
      }
      this.drawingPointer = null;
      this.activeInputSource = null;
      this.activePointerStartedAt = 0;
      this.lastEraserPoint = null;
      this.eraserPreview = null;
      this.activeInputPersistent = true;
      this.scheduleRender();
    }
    this.phoneFingerInput = null;
    this.phoneFingerDrawingPointer = null;
  }
  createDrawingCanvas() {
    if (!this.useIosTouchEvents) {
      return this.contentEl.createEl("canvas", {
        cls: "infinite-board-canvas",
        attr: { tabindex: "0", "aria-label": "\u65E0\u9650\u753B\u5E03" }
      });
    }
    const frame = this.contentEl.createEl("iframe", {
      cls: "infinite-board-input-frame",
      attr: { title: "\u65E0\u9650\u753B\u5E03\u8F93\u5165\u5C42", tabindex: "-1" }
    });
    const document2 = frame.contentDocument;
    if (!document2) throw new Error("iPad input document is unavailable");
    document2.documentElement.style.cssText = "width:100%;height:100%;margin:0;overflow:hidden;background:#f7f7f5;-webkit-touch-callout:none";
    document2.body.style.cssText = "width:100%;height:100%;margin:0;overflow:hidden;background:#f7f7f5;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;overscroll-behavior:none";
    const canvas = document2.createElement("canvas");
    canvas.className = "infinite-board-canvas";
    canvas.setAttribute("aria-label", "\u65E0\u9650\u753B\u5E03");
    canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none";
    document2.body.appendChild(canvas);
    this.inputFrame = frame;
    return canvas;
  }
  registerInputWindowEvents() {
    const inputWindow = this.canvas.ownerDocument.defaultView;
    if (!inputWindow) throw new Error("Drawing input window is unavailable");
    const inputDocument = this.canvas.ownerDocument;
    this.registerScribbleGuard(inputDocument, "input");
    this.registerDomEvent(inputDocument, "selectstart", (event) => {
      var _a;
      if ((_a = this.canvasPasteProxy) == null ? void 0 : _a.contains(event.target)) return;
      event.preventDefault();
      this.traceInput("selectstart-blocked", `target=${this.traceTarget(event.target)}`);
    }, { capture: true, passive: false });
    this.registerDomEvent(inputDocument, "scroll", (event) => {
      this.inputDocumentScrolls += 1;
      this.traceInput("input-scroll", `target=${this.traceTarget(event.target)}`);
    }, { capture: true, passive: true });
    if (inputDocument !== document) {
      this.registerDomEvent(document, "pointerdown", (event) => {
        if (event.pointerType !== "pen" || !this.pointInsideView(event.clientX, event.clientY)) return;
        this.hostDocumentPenStarts += 1;
        this.traceInput("host-pointerdown", this.pointerDetails(event));
      }, { capture: true, passive: true });
      this.registerDomEvent(document, "scroll", (event) => {
        this.hostDocumentScrolls += 1;
        this.traceInput("host-scroll", `target=${this.traceTarget(event.target)}`);
      }, { capture: true, passive: true });
    }
    this.registerDomEvent(inputWindow, "pointerdown", (event) => {
      if (this.usesCanvasPointerInput()) return;
      if (this.isCanvasInputEvent(event)) this.onPointerDown(event);
    }, { capture: true, passive: false });
    this.registerDomEvent(inputWindow, "touchstart", (event) => {
      if (this.usesCanvasPointerInput()) return;
      if (this.isCanvasInputEvent(event)) this.onTouchStart(event);
    }, { capture: true, passive: false });
    this.registerDomEvent(inputWindow, "pointermove", (event) => {
      if (!this.usesCanvasPointerInput()) this.onPointerMove(event);
    }, { capture: true, passive: false });
    this.registerDomEvent(inputWindow, "pointerup", (event) => {
      if (!this.usesCanvasPointerInput()) this.onPointerUp(event);
    }, { capture: true, passive: false });
    this.registerDomEvent(inputWindow, "pointercancel", (event) => {
      if (!this.usesCanvasPointerInput()) this.onPointerUp(event, "cancel");
    }, { capture: true, passive: false });
    this.registerDomEvent(inputWindow, "touchmove", (event) => {
      if (!this.usesCanvasPointerInput()) this.onTouchMove(event);
    }, { capture: true, passive: false });
    this.registerDomEvent(inputWindow, "touchend", (event) => {
      if (!this.usesCanvasPointerInput()) this.onTouchEnd(event, "end");
    }, { capture: true, passive: false });
    this.registerDomEvent(inputWindow, "touchcancel", (event) => {
      if (!this.usesCanvasPointerInput()) this.onTouchEnd(event, "cancel");
    }, { capture: true, passive: false });
  }
  registerHostScribbleGuard() {
    if (!this.useIosTouchEvents) return;
    this.registerScribbleGuard(this.contentEl, "host");
    this.registerDomEvent(this.contentEl, "pointerdown", (event) => {
      if (event.pointerType !== "pen") return;
      const button = this.closestButton(event.target);
      this.penButtonPress = button ? { pointerId: event.pointerId, button } : null;
    }, { capture: true, passive: true });
    this.registerDomEvent(this.contentEl, "pointerup", (event) => {
      const press = this.penButtonPress;
      if (!press || event.pointerId !== press.pointerId) return;
      this.penButtonPress = null;
      const hit = press.button.ownerDocument.elementFromPoint(event.clientX, event.clientY);
      if (!hit || !press.button.contains(hit)) return;
      this.lastPenActivatedButton = press.button;
      this.suppressPenClickUntil = performance.now() + 700;
      this.dispatchingPenButtonClick = true;
      press.button.click();
      this.dispatchingPenButtonClick = false;
      this.traceInput("pen-button-activated", this.traceTarget(press.button));
    }, { capture: true, passive: true });
    this.registerDomEvent(this.contentEl, "pointercancel", (event) => {
      var _a;
      if (((_a = this.penButtonPress) == null ? void 0 : _a.pointerId) === event.pointerId) this.penButtonPress = null;
    }, { capture: true, passive: true });
    this.registerDomEvent(this.contentEl, "click", (event) => {
      if (this.dispatchingPenButtonClick || !event.isTrusted || performance.now() >= this.suppressPenClickUntil) return;
      const button = this.closestButton(event.target);
      if (!button || button !== this.lastPenActivatedButton) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.lastPenActivatedButton = null;
    }, { capture: true, passive: false });
  }
  registerScribbleGuard(target, scope) {
    if (!this.useIosTouchEvents) return;
    const guard = (event) => {
      if (!isStylusOnlyTouchList(event.changedTouches)) return;
      event.preventDefault();
      this.scribbleTouchCancels += 1;
      if (scope === "input" && this.usesCanvasPointerInput()) {
        if (event.type === "touchstart" && shouldStartStylusTouchFallback(true, this.drawingPointer !== null, true)) {
          this.stylusTouchFallbackStarts += 1;
          this.inputToolMetrics.recordRecovery(this.tool, "stylus-touch-fallback");
          this.traceInput("stylus-touch-fallback-start", this.touchDetails(event));
          this.onTouchStart(event, true);
        } else if (this.activeInputSource === "touch" && event.type === "touchmove") {
          this.onTouchMove(event, true);
        } else if (this.activeInputSource === "touch" && event.type === "touchend") {
          this.onTouchEnd(event, "end", true);
        }
      }
      if (event.type !== "touchmove") {
        this.traceInput("scribble-touch-cancelled", `${scope} ${event.type} ${this.touchDetails(event)}`);
      }
    };
    for (const type of ["touchstart", "touchmove", "touchend"]) {
      if (target.nodeType === Node.DOCUMENT_NODE) {
        this.registerDomEvent(target, type, guard, { capture: true, passive: false });
      } else {
        this.registerDomEvent(target, type, guard, { capture: true, passive: false });
      }
    }
  }
  closestButton(target) {
    if (!target || typeof target.closest !== "function") return null;
    const button = target.closest("button");
    return button instanceof HTMLButtonElement && this.contentEl.contains(button) ? button : null;
  }
  pointInsideView(clientX, clientY) {
    const rect = this.contentEl.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }
  activeColorConfig() {
    if (!isColorTool(this.tool)) return null;
    return this.tool === "laser" ? this.plugin.settings.laser : this.plugin.settings.brushes[this.tool];
  }
  colorSource(tool, color2) {
    const saved = this.colorSources.get(tool);
    if (saved) return saved;
    const inferred = inferredColorSource(color2);
    this.colorSources.set(tool, inferred);
    return inferred;
  }
  applyToolbarColor(color2, source) {
    var _a;
    if (!isColorTool(this.tool)) return;
    const config = this.activeColorConfig();
    if (!config) return;
    config.color = color2;
    this.colorSources.set(this.tool, source);
    this.brushPanel.hidden = true;
    this.brushPanelColorOnly = false;
    (_a = this.brushPanelView) == null ? void 0 : _a.dispose();
    void this.plugin.saveSettings();
    this.updateToolButtons();
    this.scheduleRender();
  }
  addHeaderAction(icon, label, action) {
    const element = this.addAction(icon, label, action);
    element.addClass("infinite-board-header-action");
    this.headerActionEls.push(element);
  }
  clearHeaderActions() {
    for (const action of this.headerActionEls) action.remove();
    this.headerActionEls.length = 0;
  }
  buildSelectionToolbar() {
    this.selectionToolbar = this.contentEl.createDiv({ cls: "infinite-board-selection-toolbar" });
    this.selectionToolbar.hidden = true;
    const actions = [
      ["duplicate", "copy-plus", "\u5EFA\u7ACB\u526F\u672C", () => this.duplicateSelection()],
      ["crop", "crop", "\u88C1\u526A", () => this.toggleSelectedImageEditMode("crop")],
      ["rotate", "rotate-cw", "\u65CB\u8F6C", () => this.toggleSelectedImageEditMode("rotate")],
      ["lock", "lock-keyhole", "\u9501\u5B9A", () => this.toggleSelectionLock()],
      ["open", "image", "\u6253\u5F00\u56FE\u7247\u67E5\u770B", () => void this.openSelectedImage()],
      ["delete", "trash-2", "\u5220\u9664", () => this.deleteSelection()],
      ["align-left", "align-start-vertical", "\u5DE6\u5BF9\u9F50", () => this.alignSelection("left")],
      ["align-center-x", "align-center-vertical", "\u6C34\u5E73\u5C45\u4E2D", () => this.alignSelection("center-x")],
      ["align-right", "align-end-vertical", "\u53F3\u5BF9\u9F50", () => this.alignSelection("right")],
      ["align-top", "align-start-horizontal", "\u9876\u5BF9\u9F50", () => this.alignSelection("top")],
      ["align-center-y", "align-center-horizontal", "\u5782\u76F4\u5C45\u4E2D", () => this.alignSelection("center-y")],
      ["align-bottom", "align-end-horizontal", "\u5E95\u5BF9\u9F50", () => this.alignSelection("bottom")],
      ["distribute-horizontal", "columns-3", "\u6C34\u5E73\u7B49\u8DDD\u5206\u5E03", () => this.distributeSelection("horizontal")],
      ["distribute-vertical", "rows-3", "\u5782\u76F4\u7B49\u8DDD\u5206\u5E03", () => this.distributeSelection("vertical")]
    ];
    for (const [key, icon, label, action] of actions) {
      const button = this.selectionToolbar.createEl("button", {
        cls: "infinite-board-selection-action",
        attr: { type: "button", "aria-label": label, title: label, "data-action": key }
      });
      (0, import_obsidian3.setIcon)(button, icon);
      this.registerDomEvent(button, "click", action);
      this.selectionActionButtons.set(key, button);
    }
  }
  buildCanvasPasteMenu() {
    this.canvasPasteMenu = this.contentEl.createDiv({ cls: "infinite-board-canvas-paste-menu", attr: { "aria-label": "\u753B\u5E03\u7C98\u8D34" } });
    this.canvasPasteMenu.hidden = true;
    this.canvasPasteActions = this.canvasPasteMenu.createDiv({ cls: "infinite-board-canvas-paste-actions", attr: { role: "group", "aria-label": "\u753B\u5E03\u7C98\u8D34\u64CD\u4F5C" } });
    const paste = this.canvasPasteActions.createEl("button", {
      cls: "infinite-board-canvas-paste-action",
      attr: { type: "button" }
    });
    (0, import_obsidian3.setIcon)(paste.createSpan({ cls: "infinite-board-canvas-paste-icon" }), "clipboard-paste");
    paste.createSpan({ text: "\u7C98\u8D34\u56FE\u7247" });
    this.canvasPasteTarget = this.canvasPasteActions.createDiv({
      cls: "infinite-board-canvas-paste-target",
      attr: { contenteditable: "true", role: "textbox", "aria-label": "\u7C98\u8D34\u56FE\u7247\uFF1B\u957F\u6309\u53EF\u6253\u5F00\u7CFB\u7EDF\u7C98\u8D34", "data-placeholder": "\u7C98\u8D34\u56FE\u7247", tabindex: "0", inputmode: "none" }
    });
    this.canvasPasteTarget.hidden = true;
    const cancel = this.canvasPasteActions.createEl("button", {
      cls: "infinite-board-canvas-paste-dismiss",
      attr: { type: "button", "aria-label": "\u5173\u95ED\u7C98\u8D34\u6D6E\u6761", title: "\u5173\u95ED" }
    });
    (0, import_obsidian3.setIcon)(cancel, "x");
    this.registerDomEvent(this.canvasPasteTarget, "paste", (event) => void this.onPaste(event));
    this.registerDomEvent(this.canvasPasteTarget, "input", () => {
      if (this.canvasPasteTarget.textContent) this.canvasPasteTarget.setText("");
    });
    this.registerDomEvent(this.canvasPasteTarget, "click", () => {
      if (useSystemPasteTarget(import_obsidian3.Platform.isIosApp, import_obsidian3.Platform.isTablet)) this.requestSystemPasteFromToolbarGesture();
    });
    this.registerDomEvent(this.canvasPasteMenu, "touchstart", (event) => event.stopPropagation(), { passive: true });
    this.registerDomEvent(paste, "click", () => {
      if (useSystemPasteTarget(import_obsidian3.Platform.isIosApp, import_obsidian3.Platform.isTablet)) {
        this.requestSystemPasteFromToolbarGesture();
        return;
      }
      this.hideCanvasPasteMenu();
      void this.importFromClipboard();
    });
    this.registerDomEvent(cancel, "click", () => this.hideCanvasPasteMenu());
    this.registerDomEvent(this.contentEl, "pointerdown", (event) => {
      if (!this.canvasPasteMenu.hidden && event.target instanceof Node && !this.canvasPasteMenu.contains(event.target)) this.hideCanvasPasteMenu();
    });
  }
  beginCanvasLongPress(event) {
    if (event.pointerType !== "touch" || isStylusPointer(event) || this.penPointer !== null) return;
    if (useSystemPasteTarget(import_obsidian3.Platform.isIosApp, import_obsidian3.Platform.isTablet) && this.touchPointers.size > 0) {
      this.cancelCanvasLongPress();
      return;
    }
    this.cancelCanvasLongPress();
    const point = this.eventPoint(event);
    const directSystemPaste = useSystemPasteTarget(import_obsidian3.Platform.isIosApp, import_obsidian3.Platform.isTablet);
    const timer = window.setTimeout(() => {
      const press = this.canvasLongPress;
      if (!press || press.pointerId !== event.pointerId) return;
      if (directSystemPaste) {
        if (this.touchPointers.size > 1) {
          this.cancelCanvasLongPress(event.pointerId);
          return;
        }
        press.ready = true;
        return;
      }
      this.canvasLongPress = null;
      this.showCanvasPasteMenu(event.clientX, event.clientY);
    }, 560);
    this.canvasLongPress = { pointerId: event.pointerId, x: point.x, y: point.y, clientX: event.clientX, clientY: event.clientY, timer, ready: false };
  }
  updateCanvasLongPress(event) {
    const press = this.canvasLongPress;
    if (!press || press.pointerId !== event.pointerId) return;
    const point = this.eventPoint(event);
    if (Math.hypot(point.x - press.x, point.y - press.y) > 10) this.cancelCanvasLongPress(event.pointerId);
  }
  cancelCanvasLongPress(pointerId) {
    const press = this.canvasLongPress;
    if (!press || pointerId !== void 0 && press.pointerId !== pointerId) return;
    window.clearTimeout(press.timer);
    this.canvasLongPress = null;
  }
  finishCanvasLongPress(event) {
    const press = this.canvasLongPress;
    if (!press || press.pointerId !== event.pointerId) return;
    const requestSystemPaste = press.ready && useSystemPasteTarget(import_obsidian3.Platform.isIosApp, import_obsidian3.Platform.isTablet);
    this.cancelCanvasLongPress(event.pointerId);
    if (!requestSystemPaste) return;
    this.requestCanvasSystemPaste(press.clientX, press.clientY);
  }
  requestCanvasSystemPaste(clientX, clientY) {
    this.canvasPastePoint = this.pastePointFromClient(clientX, clientY);
    this.ignoreCanvasContextMenuUntil = performance.now() + 750;
    const document2 = this.canvas.ownerDocument;
    this.releaseCanvasPasteProxy();
    const proxy = document2.createElement("div");
    proxy.contentEditable = "true";
    proxy.setAttribute("inputmode", "none");
    const left = Math.max(0, Math.min(this.canvas.clientWidth - 44, clientX - 22));
    const top = Math.max(0, Math.min(this.canvas.clientHeight - 44, clientY - 22));
    proxy.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:44px;height:44px;overflow:hidden;opacity:0.01;pointer-events:none;user-select:text;-webkit-user-select:text;-webkit-touch-callout:default;caret-color:transparent`;
    document2.body.appendChild(proxy);
    this.canvasPasteProxy = proxy;
    let pasteReceived = false;
    proxy.addEventListener("paste", (event) => {
      pasteReceived = true;
      void this.onPaste(event);
    });
    proxy.focus({ preventScroll: true });
    let accepted = false;
    try {
      accepted = document2.execCommand("paste");
    } catch (error) {
      this.traceInput("paste-command-error", error instanceof Error ? error.name : "unknown");
    }
    this.traceInput("paste-command", accepted ? "accepted" : "rejected");
    if (!accepted && !pasteReceived) {
      this.releaseCanvasPasteProxy();
      this.showNativePasteTarget();
      return;
    }
    if (this.canvasPasteProxy === proxy) this.canvasPasteProxyTimer = window.setTimeout(() => {
      if (this.canvasPasteProxy === proxy) this.traceInput("paste-command-timeout", "no-paste-event-after-15s");
      this.releaseCanvasPasteProxy();
    }, 15e3);
  }
  releaseCanvasPasteProxy() {
    var _a;
    window.clearTimeout(this.canvasPasteProxyTimer);
    this.canvasPasteProxyTimer = 0;
    (_a = this.canvasPasteProxy) == null ? void 0 : _a.remove();
    this.canvasPasteProxy = null;
  }
  pastePointFromClient(clientX, clientY) {
    var _a;
    const rect = this.contentEl.getBoundingClientRect();
    const frame = (_a = this.inputFrame) == null ? void 0 : _a.getBoundingClientRect();
    return pasteMenuPointFromClient(
      { x: clientX, y: clientY },
      { x: rect.left, y: rect.top },
      frame ? { x: frame.left, y: frame.top } : void 0
    );
  }
  showCanvasPasteMenu(clientX, clientY) {
    this.showCanvasPasteMenuAt(this.pastePointFromClient(clientX, clientY));
  }
  showCanvasPasteMenuAt(point) {
    var _a;
    this.canvasPastePoint = point;
    this.canvasPasteActions.hidden = false;
    (_a = this.canvasPasteActions.querySelector(".infinite-board-canvas-paste-action")) == null ? void 0 : _a.removeAttribute("hidden");
    this.canvasPasteTarget.hidden = true;
    this.canvasPasteMenu.hidden = false;
    this.positionCanvasPasteMenu();
  }
  positionCanvasPasteMenu() {
    const position = pasteMenuPosition(
      this.canvasPastePoint,
      { width: this.canvasPasteMenu.offsetWidth, height: this.canvasPasteMenu.offsetHeight },
      { width: this.contentEl.clientWidth, height: this.contentEl.clientHeight }
    );
    this.canvasPasteMenu.style.left = `${position.x}px`;
    this.canvasPasteMenu.style.top = `${position.y}px`;
  }
  hideCanvasPasteMenu() {
    this.canvasPasteMenu.hidden = true;
  }
  requestSystemPasteFromToolbarGesture() {
    this.showNativePasteTarget();
    this.canvasPasteTarget.focus({ preventScroll: true });
    let accepted = false;
    try {
      accepted = this.contentEl.ownerDocument.execCommand("paste");
    } catch (error) {
      this.traceInput("paste-command-error", error instanceof Error ? error.name : "unknown");
    }
    this.traceInput("paste-command", `toolbar-click-${accepted ? "accepted" : "rejected"}`);
  }
  showNativePasteTarget() {
    var _a;
    this.canvasPasteActions.hidden = false;
    (_a = this.canvasPasteActions.querySelector(".infinite-board-canvas-paste-action")) == null ? void 0 : _a.setAttribute("hidden", "");
    this.canvasPasteTarget.hidden = false;
    this.canvasPasteMenu.hidden = false;
    this.positionCanvasPasteMenu();
    if (!this.useIosTouchEvents) this.canvasPasteTarget.focus({ preventScroll: true });
  }
  setSaveState(state, detail) {
    if (!this.statusEl) return;
    const labels = {
      saved: "\u5DF2\u4FDD\u5B58",
      unsaved: "\u672A\u4FDD\u5B58",
      saving: "\u6B63\u5728\u4FDD\u5B58\u2026",
      error: "\u4FDD\u5B58\u5931\u8D25",
      conflict: "\u68C0\u6D4B\u5230\u540C\u6B65\u51B2\u7A81"
    };
    this.visibleSaveState = state;
    this.statusEl.className = `infinite-board-save-status is-${state}`;
    this.statusEl.setText(detail ? `${labels[state]} \xB7 ${detail}` : labels[state]);
    const actionable = state === "error" || state === "conflict";
    this.statusEl.toggleClass("is-actionable", actionable);
    this.statusEl.setAttribute("aria-disabled", "false");
    this.statusEl.setAttribute("title", actionable ? "\u70B9\u51FB\u67E5\u770B\u6062\u590D\u9009\u9879" : labels[state]);
    this.statusEl.setAttribute("aria-label", actionable ? `${labels[state]}\uFF0C\u70B9\u51FB\u67E5\u770B\u6062\u590D\u9009\u9879` : `${labels[state]}\uFF0C1500\u6BEB\u79D2\u5185\u5FEB\u901F\u70B9\u51FB\u4E94\u6B21\u6253\u5F00\u8F93\u5165\u8BCA\u65AD`);
  }
  openSaveRecovery() {
    if (this.visibleSaveState === "conflict") {
      if (!this.conflictRecovery.currentPath) {
        new import_obsidian3.Notice("\u672C\u5730\u5185\u5BB9\u5DF2\u53E6\u5B58\u4E3A\u51B2\u7A81\u526F\u672C\uFF0C\u8BF7\u5728\u6587\u4EF6\u5217\u8868\u4E2D\u67E5\u627E\u201C\u672C\u5730\u51B2\u7A81\u201D\u6587\u4EF6\u3002", 5e3);
        return;
      }
      const path = this.conflictRecovery.currentPath;
      new ConflictRecoveryModal(this.app, path, () => this.openConflictCopy(path)).open();
      return;
    }
    if (this.visibleSaveState !== "error") {
      return;
    }
    new SaveRecoveryModal(
      this.app,
      this.canSave && !this.conflictDetected,
      () => void this.saveNow(),
      async () => {
        await this.createRecoveryCopy("\u4FDD\u5B58\u5931\u8D25\u6062\u590D");
      }
    ).open();
  }
  async openConflictCopy(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian3.TFile)) throw new Error(`Conflict copy is unavailable: ${path}`);
    await this.app.workspace.getLeaf("tab").openFile(file);
  }
  toggleDiagnostics() {
    this.setDiagnosticsVisible(!this.diagnosticsVisible);
  }
  handleSaveStatusClick() {
    if (this.visibleSaveState === "error" || this.visibleSaveState === "conflict") {
      this.diagnosticsStatusTaps.reset();
      this.openSaveRecovery();
      return;
    }
    if (this.diagnosticsStatusTaps.register(performance.now())) this.toggleDiagnostics();
  }
  setDiagnosticsVisible(visible) {
    this.diagnosticsVisible = visible;
    this.diagnosticsEl.hidden = !visible;
    if (visible) this.traceInput("diagnostics-open", "user");
    this.updateDiagnostics();
  }
  hideDiagnostics() {
    this.setDiagnosticsVisible(false);
  }
  scheduleDiagnostics() {
    if (!this.diagnosticsVisible || this.diagnosticTimer) return;
    const delay = Math.max(0, 250 - (performance.now() - this.lastDiagnosticUpdate));
    this.diagnosticTimer = window.setTimeout(() => {
      this.diagnosticTimer = 0;
      this.lastDiagnosticUpdate = performance.now();
      this.updateDiagnostics();
    }, delay);
  }
  buildDiagnosticsPanel() {
    this.diagnosticsEl.empty();
    const header = this.diagnosticsEl.createDiv({ cls: "infinite-board-diagnostics-header" });
    header.createDiv({ cls: "infinite-board-diagnostics-title", text: "iPad \u8F93\u5165\u8BCA\u65AD" });
    const close = header.createEl("button", {
      cls: "infinite-board-panel-close infinite-board-diagnostics-close",
      attr: { type: "button", "aria-label": "\u9690\u85CF\u8F93\u5165\u8BCA\u65AD", title: "\u9690\u85CF\u8F93\u5165\u8BCA\u65AD" }
    });
    (0, import_obsidian3.setIcon)(close, "x");
    this.registerDomEvent(close, "click", () => this.hideDiagnostics());
    this.diagnosticsBodyEl = this.diagnosticsEl.createDiv({ cls: "infinite-board-diagnostics-body" });
    const labels = [
      "Apple Pencil",
      "iOS\u8F93\u5165\u901A\u9053",
      "\u6700\u8FD1\u8F93\u5165",
      "\u538B\u611F",
      "\u91C7\u6837\u7387",
      "\u5408\u5E76\u91C7\u6837",
      "\u539F\u59CB\u70B9",
      "\u5E73\u6ED1\u8F6E\u5ED3",
      "\u89E6\u6478\u70B9",
      "Pencil \u53CC\u901A\u9053",
      "Touch \u63A5\u7BA1",
      "Pointer \u540E\u5907\u5B8C\u6210",
      "\u89E6\u7B14\u72B6\u6001\u81EA\u52A8\u56DE\u6536",
      "\u5F53\u524D\u8F93\u5165\u72B6\u6001",
      "\u4E3B\u7EBF\u7A0B\u6700\u5927\u505C\u987F",
      "\u6700\u8FD1/\u6700\u957F\u4FDD\u5B58",
      "\u98DE\u884C\u8BB0\u5F55",
      "\u8F93\u5165\u9694\u79BB",
      "\u8FD0\u884C/\u6E05\u5355\u7248\u672C",
      "\u6EDA\u52A8\uFF08\u8F93\u5165/\u5BBF\u4E3B\uFF09",
      "\u5BBF\u4E3B\u8D77\u7B14",
      "Scribble \u9632\u62A4",
      "Move \u6062\u590D\u8D77\u7B14",
      "Touch \u540E\u5907\u8D77\u7B14",
      "\u753B\u7B14\u8D77\u7B14/\u5B8C\u6210",
      "\u5448\u73B0\u6062\u590D\u5E27",
      "\u6E32\u67D3\u5E27/\u6700\u6162\u5E27",
      "\u573A\u666F\u7F13\u5B58\u6784\u5EFA/\u547D\u4E2D",
      "\u6700\u6162\u7F13\u5B58\u6784\u5EFA",
      "\u6700\u8FD1\u547D\u4E2D",
      "\u753B\u5E03\u5C3A\u5BF8",
      "\u50CF\u7D20\u500D\u7387"
    ];
    for (const label of labels) {
      const row = this.diagnosticsBodyEl.createDiv({ cls: "infinite-board-diagnostics-row" });
      row.createSpan({ text: label });
      this.diagnosticValueEls.set(label, row.createSpan({ text: "--" }));
    }
    this.diagnosticsEventsEl = this.diagnosticsBodyEl.createDiv({ cls: "infinite-board-diagnostics-events" });
    const actions = this.diagnosticsEl.createDiv({ cls: "infinite-board-diagnostics-actions" });
    const copy = actions.createEl("button", { cls: "mod-cta infinite-board-diagnostics-copy", text: "\u590D\u5236\u8BCA\u65AD\u65E5\u5FD7", attr: { type: "button" } });
    const reset = actions.createEl("button", { text: "\u5F00\u59CB\u65B0\u8BB0\u5F55", attr: { type: "button" } });
    const hide = actions.createEl("button", { text: "\u5173\u95ED\u8BCA\u65AD", attr: { type: "button", "aria-label": "\u5173\u95ED\u8F93\u5165\u8BCA\u65AD" } });
    this.diagnosticsInputModeButton = actions.createEl("button", { attr: { type: "button" } });
    copy.addEventListener("click", () => void this.copyInputDiagnostics());
    reset.addEventListener("click", () => this.resetInputDiagnostics());
    hide.addEventListener("click", () => this.hideDiagnostics());
    this.diagnosticsInputModeButton.addEventListener("click", () => this.toggleIosInputMode());
  }
  updateDiagnostics() {
    var _a, _b, _c, _d, _e, _f;
    if (!this.diagnosticsEl) return;
    if (this.activeInputSource !== null) return;
    const pencil = this.pencilDetected ? "\u5DF2\u68C0\u6D4B\u5230" : "\u5C1A\u672A\u68C0\u6D4B\u5230";
    const rect = (_a = this.canvas) == null ? void 0 : _a.getBoundingClientRect();
    const viewport = rect ? `${Math.round(rect.width)} \xD7 ${Math.round(rect.height)}` : "--";
    const renderMetrics = this.sceneRenderer.metricsSnapshot();
    const rows = [
      ["Apple Pencil", pencil],
      ["iOS\u8F93\u5165\u901A\u9053", this.useIosTouchEvents ? this.iosInputMode === "pointer-capture" ? "Canvas Pointer Capture" : this.iosStylusTouchConfirmed ? "\u539F\u751F Stylus Touch\uFF08\u65E7\uFF09" : "\u539F\u751F Touch\uFF08\u65E7\uFF09" : "Pointer Events"],
      ["\u6700\u8FD1\u8F93\u5165", this.lastInputType],
      ["\u538B\u611F", this.lastPressure.toFixed(3)],
      ["\u91C7\u6837\u7387", `${this.sampleRate} \u70B9/\u79D2`],
      ["\u5408\u5E76\u91C7\u6837", `${this.coalescedSamples} \u70B9`],
      ["\u539F\u59CB\u70B9", `${(_c = (_b = this.currentStroke) == null ? void 0 : _b.points.length) != null ? _c : 0}`],
      ["\u5E73\u6ED1\u8F6E\u5ED3", `${this.lastOutlinePointCount} \u70B9`],
      ["\u89E6\u6478\u70B9", `${this.touchPointers.size}`],
      ["Pencil \u53CC\u901A\u9053", `P ${this.penPointerStarts} / T ${this.stylusTouchStarts}`],
      ["Touch \u63A5\u7BA1", `${this.stylusHandoffs} \u6B21`],
      ["Pointer \u540E\u5907\u5B8C\u6210", `${this.pointerFallbackStrokes} \u7B14`],
      ["\u89E6\u7B14\u72B6\u6001\u81EA\u52A8\u56DE\u6536", `${this.orphanedStylusRecoveries} \u6B21`],
      ["\u5F53\u524D\u8F93\u5165\u72B6\u6001", `${(_d = this.activeInputSource) != null ? _d : "\u7A7A\u95F2"} / ${(_e = this.stylusTouchId) != null ? _e : "-"}`],
      ["\u4E3B\u7EBF\u7A0B\u6700\u5927\u505C\u987F", `${Math.round(this.maxEventLoopDelay)} ms`],
      ["\u6700\u8FD1/\u6700\u957F\u4FDD\u5B58", `${Math.round(this.lastSaveDuration)} / ${Math.round(this.maxSaveDuration)} ms`],
      ["\u98DE\u884C\u8BB0\u5F55", `${this.inputTrace.size} \u6761`],
      ["\u8F93\u5165\u9694\u79BB", this.inputFrame ? "iPad \u5B50\u6587\u6863" : "\u4E3B\u6587\u6863"],
      ["\u8FD0\u884C/\u6E05\u5355\u7248\u672C", `${RUNTIME_VERSION} / ${this.plugin.manifest.version}`],
      ["\u6EDA\u52A8\uFF08\u8F93\u5165/\u5BBF\u4E3B\uFF09", `${this.inputDocumentScrolls} / ${this.hostDocumentScrolls}`],
      ["\u5BBF\u4E3B\u8D77\u7B14", `${this.hostDocumentPenStarts} \u6B21`],
      ["Scribble \u9632\u62A4", `${this.scribbleTouchCancels} \u4E2A Touch \u9636\u6BB5`],
      ["Move \u6062\u590D\u8D77\u7B14", `${this.recoveredPointerStarts} \u6B21`],
      ["Touch \u540E\u5907\u8D77\u7B14", `${this.stylusTouchFallbackStarts} \u6B21`],
      ["\u753B\u7B14\u8D77\u7B14/\u5B8C\u6210", this.inputToolMetrics.compactSummary()],
      ["\u5448\u73B0\u6062\u590D\u5E27", `${this.presentationRecoveryFrames} \u5E27`],
      ["\u6E32\u67D3\u5E27/\u6700\u6162\u5E27", `${renderMetrics.renderFrames} / ${renderMetrics.maxRenderDurationMs.toFixed(1)} ms`],
      ["\u573A\u666F\u7F13\u5B58\u6784\u5EFA/\u547D\u4E2D", `${renderMetrics.sceneCacheBuilds} / ${renderMetrics.sceneCacheHits}`],
      ["\u6700\u6162\u7F13\u5B58\u6784\u5EFA", `${renderMetrics.maxSceneCacheBuildDurationMs.toFixed(1)} ms`],
      ["\u6700\u8FD1\u547D\u4E2D", this.lastHitTarget],
      ["\u753B\u5E03\u5C3A\u5BF8", viewport],
      ["\u50CF\u7D20\u500D\u7387", `${Math.min(window.devicePixelRatio || 1, 3).toFixed(2)}\xD7`]
    ];
    for (const [label, value] of rows) {
      (_f = this.diagnosticValueEls.get(label)) == null ? void 0 : _f.setText(value);
    }
    this.diagnosticsEventsEl.setText(this.recentPointerEvents.slice(-4).join("\n") || "\u5C1A\u65E0\u8F93\u5165\u4E8B\u4EF6");
    this.diagnosticsInputModeButton.setText(this.iosInputMode === "pointer-capture" ? "\u5207\u6362\u5230\u539F\u751F Touch\uFF08\u65E7\uFF09" : "\u5207\u6362\u5230\u65B0 Pointer");
  }
  traceInput(event, details) {
    var _a, _b, _c, _d, _e, _f;
    if (!this.useIosTouchEvents && !this.diagnosticsVisible) return;
    const state = [
      `src=${(_a = this.activeInputSource) != null ? _a : "idle"}`,
      `touch=${(_b = this.stylusTouchId) != null ? _b : "-"}`,
      `draw=${(_c = this.drawingPointer) != null ? _c : "-"}`,
      `pen=${(_d = this.penPointer) != null ? _d : "-"}`,
      `stroke=${(_f = (_e = this.currentStroke) == null ? void 0 : _e.points.length) != null ? _f : 0}`,
      `tool=${this.tool}`,
      `dirty=${this.dirty ? 1 : 0}`,
      `saving=${this.isSaving ? 1 : 0}`
    ].join(" ");
    this.inputTrace.record(performance.now(), event, details, state);
    this.scheduleDiagnostics();
  }
  nativeStylusTouchEnabled() {
    return usesNativeStylusTouch(this.useIosTouchEvents, this.iosInputMode);
  }
  usesCanvasPointerInput() {
    return !this.useIosTouchEvents || usesCanvasPointerCapture(this.useIosTouchEvents, this.iosInputMode);
  }
  toggleIosInputMode() {
    if (!this.useIosTouchEvents) return;
    this.finishActiveInput(this.activeInputPersistent);
    this.iosInputMode = this.iosInputMode === "pointer-capture" ? "native-touch" : "pointer-capture";
    this.traceInput("input-mode", this.iosInputMode);
    this.updateDiagnostics();
    new import_obsidian3.Notice(`iPad \u8F93\u5165\u5DF2\u5207\u6362\u4E3A ${this.iosInputMode === "pointer-capture" ? "Canvas Pointer Capture" : "\u539F\u751F Touch\uFF08\u65E7\uFF09"}\u3002`, 3e3);
  }
  traceMove(event, details) {
    const now = performance.now();
    if (now - this.lastTracedMoveAt < 200) return;
    this.lastTracedMoveAt = now;
    this.traceInput(event, details);
  }
  pointerDetails(event) {
    var _a;
    const phase = event.eventPhase === Event.CAPTURING_PHASE ? "capture" : event.eventPhase === Event.AT_TARGET ? "target" : event.eventPhase === Event.BUBBLING_PHASE ? "bubble" : "none";
    const captured = ((_a = this.canvas) == null ? void 0 : _a.hasPointerCapture(event.pointerId)) ? 1 : 0;
    this.lastHitTarget = this.traceHitTarget(event.clientX, event.clientY);
    return `id=${event.pointerId} type=${event.pointerType || "unknown"} pressure=${this.traceNumber(event.pressure, 3)} buttons=${event.buttons} phase=${phase} captured=${captured} target=${this.traceTarget(event.target)} hit=${this.lastHitTarget} ts=${this.traceNumber(event.timeStamp, 1)}`;
  }
  isCanvasInputEvent(event) {
    var _a;
    if (!((_a = this.canvas) == null ? void 0 : _a.isConnected)) return false;
    return event.composedPath().includes(this.canvas);
  }
  touchDetails(event) {
    const describe = (list) => Array.from(list).slice(0, 5).map((item) => {
      var _a;
      const touch = item;
      return `${touch.identifier}:${(_a = touch.touchType) != null ? _a : "?"}:r${this.traceNumber(touch.radiusX, 1)}/${this.traceNumber(touch.radiusY, 1)}:f${this.traceNumber(touch.force, 3)}`;
    }).join(",") || "-";
    return `touches=[${describe(event.touches)}] changed=[${describe(event.changedTouches)}] target=${this.traceTarget(event.target)} ts=${this.traceNumber(event.timeStamp, 1)}`;
  }
  traceTarget(target) {
    if (!target || typeof target.tagName !== "string") return "?";
    const element = target;
    const classes = Array.from(element.classList).slice(0, 2).join(".");
    return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`;
  }
  traceHitTarget(clientX, clientY) {
    var _a, _b;
    return this.traceTarget((_b = (_a = this.canvas) == null ? void 0 : _a.ownerDocument.elementFromPoint(clientX, clientY)) != null ? _b : null);
  }
  traceNumber(value, digits) {
    return Number.isFinite(value) ? Number(value).toFixed(digits) : "?";
  }
  resetInputDiagnostics() {
    this.inputTrace.reset();
    this.penPointerStarts = 0;
    this.stylusTouchStarts = 0;
    this.stylusHandoffs = 0;
    this.pointerFallbackStrokes = 0;
    this.orphanedStylusRecoveries = 0;
    this.maxEventLoopDelay = 0;
    this.lastSaveDuration = 0;
    this.maxSaveDuration = 0;
    this.inputDocumentScrolls = 0;
    this.hostDocumentScrolls = 0;
    this.hostDocumentPenStarts = 0;
    this.scribbleTouchCancels = 0;
    this.recoveredPointerStarts = 0;
    this.stylusTouchFallbackStarts = 0;
    this.presentationRecoveryFrames = 0;
    this.sceneRenderer.resetMetrics();
    this.inputToolMetrics.reset();
    this.activeDiagnosticTool = null;
    this.lastHitTarget = "--";
    this.lastTracedMoveAt = 0;
    this.traceInput("diagnostics-reset", "user");
    this.updateDiagnostics();
  }
  async copyInputDiagnostics() {
    var _a, _b, _c, _d, _e, _f;
    const totalPoints = this.data.elements.reduce((sum, element) => sum + (element.type === "stroke" ? element.points.length : 0), 0);
    const renderMetrics = this.sceneRenderer.metricsSnapshot();
    const counters = diagnosticCounterSnapshot({
      orphanRecoveries: this.orphanedStylusRecoveries,
      inputDocumentScrolls: this.inputDocumentScrolls,
      hostDocumentScrolls: this.hostDocumentScrolls,
      hostDocumentPenStarts: this.hostDocumentPenStarts,
      scribbleTouchCancels: this.scribbleTouchCancels,
      recoveredPointerStarts: this.recoveredPointerStarts,
      stylusTouchFallbackStarts: this.stylusTouchFallbackStarts,
      presentationRecoveryFrames: this.presentationRecoveryFrames,
      maxEventLoopDelayMs: this.maxEventLoopDelay,
      lastSaveMs: this.lastSaveDuration,
      maxSaveMs: this.maxSaveDuration
    });
    const health = this.currentBoardHealth();
    const historyUsage = this.history.usage;
    const imageCache = this.boardAssets.cacheStats;
    const report = this.inputTrace.report({
      manifestVersion: this.plugin.manifest.version,
      runtimeVersion: RUNTIME_VERSION,
      buildFingerprint: BUILD_FINGERPRINT,
      iosApp: this.useIosTouchEvents,
      iosInputMode: this.iosInputMode,
      inputDocument: this.inputFrame ? "isolated-child" : "host",
      runtimeMatchesManifest: runtimeMatchesManifest(this.plugin.manifest.version),
      userAgent: navigator.userAgent,
      viewport: `${this.canvas.clientWidth}x${this.canvas.clientHeight}`,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 3),
      visibility: document.visibilityState,
      orientation: (_b = (_a = screen.orientation) == null ? void 0 : _a.type) != null ? _b : "unknown",
      elements: this.data.elements.length,
      points: totalPoints,
      historyUndoCount: historyUsage.undoCount,
      historyRedoCount: historyUsage.redoCount,
      historyEstimatedBytes: historyUsage.estimatedBytes,
      imageCacheEntries: imageCache.entries,
      imageCacheEstimatedBytes: imageCache.estimatedBytes,
      imageCacheVisibleEntries: imageCache.visibleEntries,
      imagePendingRetries: imageCache.pendingRetries,
      boardBytes: (_c = health == null ? void 0 : health.boardBytes) != null ? _c : 0,
      referencedImages: (_d = health == null ? void 0 : health.referencedImages) != null ? _d : 0,
      missingImages: (_e = health == null ? void 0 : health.missingImages) != null ? _e : 0,
      unlinkedImages: (_f = health == null ? void 0 : health.unlinkedPaths.length) != null ? _f : 0,
      pencilConfirmed: this.iosStylusTouchConfirmed,
      ...counters,
      renderFrames: renderMetrics.renderFrames,
      maxRenderDurationMs: Number(renderMetrics.maxRenderDurationMs.toFixed(1)),
      sceneCacheBuilds: renderMetrics.sceneCacheBuilds,
      sceneCacheHits: renderMetrics.sceneCacheHits,
      maxSceneCacheBuildDurationMs: Number(renderMetrics.maxSceneCacheBuildDurationMs.toFixed(1)),
      toolInputMetrics: this.inputToolMetrics.reportSummary(),
      lastHitTarget: this.lastHitTarget
    });
    try {
      await navigator.clipboard.writeText(report);
      new import_obsidian3.Notice("\u8F93\u5165\u8BCA\u65AD\u65E5\u5FD7\u5DF2\u590D\u5236\uFF0C\u8BF7\u76F4\u63A5\u7C98\u8D34\u53D1\u7ED9\u6211\u3002", 3500);
    } catch (error) {
      console.error("Infinite Board: diagnostic copy failed", error);
      new DiagnosticReportModal(this.app, report).open();
      new import_obsidian3.Notice("\u81EA\u52A8\u590D\u5236\u5931\u8D25\uFF0C\u5DF2\u6253\u5F00\u53EF\u624B\u52A8\u590D\u5236\u7684\u65E5\u5FD7\u3002", 4500);
    }
  }
  recordPointerEvent(kind, event) {
    this.recentPointerEvents.push(`${kind} \xB7 ${event.pointerType || "unknown"} #${event.pointerId}`);
    if (this.recentPointerEvents.length > 8) this.recentPointerEvents.shift();
    this.scheduleDiagnostics();
  }
  recordInput(event, sampleCount = 1, inputType) {
    var _a;
    this.lastInputType = (_a = inputType != null ? inputType : event.pointerType) != null ? _a : "unknown";
    if (this.lastInputType.startsWith("pen")) this.pencilDetected = true;
    this.lastPressure = event.pressure;
    this.coalescedSamples = sampleCount;
    const now = performance.now();
    if (this.lastSampleTime > 0) {
      const elapsed = now - this.lastSampleTime;
      if (elapsed > 0) {
        const instantaneous = Math.min(1e3, Math.round(sampleCount * 1e3 / elapsed));
        this.sampleRate = this.sampleRate === 0 ? instantaneous : Math.round(this.sampleRate * 0.75 + instantaneous * 0.25);
      }
    }
    this.lastSampleTime = now;
    this.scheduleDiagnostics();
  }
  setTool(tool, persist = true) {
    var _a;
    const previousTool = this.tool;
    const transition = planToolTransition(previousTool, tool, this.drawingPointer !== null, this.activeInputPersistent);
    if (transition.finishActiveInput) {
      if (transition.cancelActiveSelection) this.cancelSelection();
      this.finishActiveInput(transition.persistFinishedInput);
    }
    if (transition.clearSelection) {
      this.cancelSelection();
      this.selection.clear();
    }
    if (transition.clearEraserPreview) this.eraserPreview = null;
    this.tool = tool;
    if (previousTool !== tool) {
      this.brushPanelColorOnly = false;
      if (this.brushPanel) this.brushPanel.hidden = true;
      (_a = this.brushPanelView) == null ? void 0 : _a.dispose();
    }
    this.toolControllers.activate(tool);
    this.updateToolButtons();
    if (this.canvas) this.canvas.dataset.tool = tool;
    if (persist) {
      this.plugin.settings.activeTool = tool;
      void this.plugin.saveSettings();
    }
    if (this.brushPanel && !this.brushPanel.hidden) this.renderBrushPanel();
    this.scheduleRender();
  }
  updateToolButtons() {
    var _a;
    this.toolbar.querySelectorAll("[data-tool]").forEach((element) => {
      const buttonTool = element.dataset.tool;
      const active = buttonTool === this.tool;
      element.toggleClass("is-active", active);
      element.setAttribute("aria-pressed", active ? "true" : "false");
      if (isColorTool(buttonTool)) {
        const config = buttonTool === "laser" ? this.plugin.settings.laser : this.plugin.settings.brushes[buttonTool];
        element.style.setProperty("--infinite-board-ink", config.color);
      }
    });
    const colorConfig = this.activeColorConfig();
    const source = isColorTool(this.tool) && colorConfig ? this.colorSource(this.tool, colorConfig.color) : null;
    this.palette.toggleClass("is-disabled", !colorConfig);
    this.palette.querySelectorAll("[data-color]").forEach((button) => {
      var _a2;
      const active = source === "preset" && ((_a2 = button.dataset.color) == null ? void 0 : _a2.toLowerCase()) === (colorConfig == null ? void 0 : colorConfig.color.toLowerCase());
      button.toggleClass("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.disabled = !colorConfig;
    });
    const more = this.palette.querySelector(".infinite-board-more-colors");
    if (more) {
      const active = source === "more";
      more.toggleClass("is-active", active);
      more.setAttribute("aria-pressed", active ? "true" : "false");
      more.setAttribute("aria-expanded", !this.brushPanel.hidden && this.brushPanelColorOnly ? "true" : "false");
      more.disabled = !colorConfig;
      more.style.setProperty("--infinite-board-custom-color", (_a = colorConfig == null ? void 0 : colorConfig.color) != null ? _a : "#202022");
    }
  }
  toggleBrushPanel(colorOnly = false) {
    var _a;
    if (!isConfigurableTool(this.tool)) {
      this.setTool("pen");
    }
    const closeExisting = !this.brushPanel.hidden && this.brushPanelColorOnly === colorOnly;
    this.brushPanelColorOnly = colorOnly;
    this.brushPanel.hidden = closeExisting;
    if (this.brushPanel.hidden) (_a = this.brushPanelView) == null ? void 0 : _a.dispose();
    else this.renderBrushPanel();
    this.updateToolButtons();
  }
  renderBrushPanel() {
    var _a;
    (_a = this.brushPanelView) == null ? void 0 : _a.render(this.tool, this.brushPanelColorOnly);
  }
  resizeCanvas() {
    var _a;
    if (!((_a = this.canvas) == null ? void 0 : _a.isConnected)) return;
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      const delta = persistedCameraResizeDelta(
        this.lastCanvasCssWidth > 0 && this.lastCanvasCssHeight > 0 ? { width: this.lastCanvasCssWidth, height: this.lastCanvasCssHeight } : null,
        { width: rect.width, height: rect.height },
        this.resizeCameraPersistenceReady
      );
      if (delta) {
        this.data.camera.x += delta.x;
        this.data.camera.y += delta.y;
        this.queueSave();
      }
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.lastCanvasCssWidth = rect.width;
    this.lastCanvasCssHeight = rect.height;
    this.scheduleDiagnostics();
    this.scheduleRender();
  }
  scheduleRender() {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }
  render() {
    this.sceneRenderer.render({
      canvas: this.canvas,
      context: this.context,
      camera: this.data.camera,
      drawBackground: (context, width, height) => {
        context.fillStyle = "#f7f7f5";
        context.fillRect(0, 0, width, height);
        this.drawGrid(context, width, height);
      },
      drawStaticWorld: (context) => {
        var _a;
        for (const element of this.visibleElements()) {
          if (element.id === ((_a = this.currentStroke) == null ? void 0 : _a.id)) continue;
          if (element.type === "image") this.drawImage(context, element);
          else this.drawStroke(context, element);
        }
      },
      drawDynamicWorld: (context) => {
        if (this.currentStroke) this.drawStroke(context, this.currentStroke);
        this.toolControllers.renderOverlays(context);
        this.drawEraserPreview(context);
        this.drawSelection(context);
      }
    });
    this.updateSelectionToolbar();
  }
  invalidateSceneCache() {
    this.sceneRenderer.invalidate();
  }
  viewportBounds(padding = 80) {
    const camera = this.data.camera;
    return {
      minX: (-camera.x - padding) / camera.zoom,
      minY: (-camera.y - padding) / camera.zoom,
      maxX: (this.canvas.clientWidth - camera.x + padding) / camera.zoom,
      maxY: (this.canvas.clientHeight - camera.y + padding) / camera.zoom
    };
  }
  visibleElements() {
    const includeIds = new Set(this.selection.selectedIds);
    if (this.currentStroke) includeIds.add(this.currentStroke.id);
    const visible = this.spatialIndex.query(this.data.elements, this.viewportBounds(), includeIds);
    this.boardAssets.updateVisible(visible);
    return visible;
  }
  rebuildSpatialIndex() {
    this.spatialIndex.rebuild(this.data.elements);
  }
  drawGrid(ctx, width, height) {
    const camera = this.data.camera;
    const base = 32 * camera.zoom;
    if (base < 9) return;
    const offsetX = (camera.x % base + base) % base;
    const offsetY = (camera.y % base + base) % base;
    ctx.beginPath();
    for (let x = offsetX; x < width; x += base) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = offsetY; y < height; y += base) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.strokeStyle = "#d8d8d4";
    ctx.globalAlpha = 0.36;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  drawStroke(ctx, stroke) {
    var _a;
    if (stroke.points.length === 0) return;
    const brush2 = this.brushForStroke(stroke);
    const isComplete = ((_a = this.currentStroke) == null ? void 0 : _a.id) !== stroke.id;
    const cached = this.strokePathCache.get(stroke.id);
    let path;
    if (isComplete && (cached == null ? void 0 : cached.pointCount) === stroke.points.length) {
      path = cached.path;
    } else {
      if (brush2.kind !== "highlighter" && brush2.pressure !== "off" && stroke.points.length > 1) {
        const outline = pressureOutline(stroke.points, brush2.size, brush2.pressure);
        this.lastOutlinePointCount = outline.length;
        path = this.outlineToPath(outline);
      } else {
        const centerline = smoothCenterline(stroke.points);
        this.lastOutlinePointCount = centerline.length;
        path = this.centerlineToPath(centerline);
      }
      if (isComplete) this.strokePathCache.set(stroke.id, { pointCount: stroke.points.length, path });
    }
    ctx.save();
    ctx.globalAlpha = brush2.opacity;
    ctx.globalCompositeOperation = strokeCompositeOperation(brush2.kind);
    if (brush2.kind !== "highlighter" && brush2.pressure !== "off" && stroke.points.length > 1) {
      ctx.fillStyle = brush2.color;
      ctx.fill(path);
    } else if (stroke.points.length > 1) {
      ctx.strokeStyle = brush2.color;
      ctx.lineWidth = brush2.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(path);
    } else {
      ctx.fillStyle = brush2.color;
      const pointScale = brush2.pressure === "off" ? 1 : pressureScale(stroke.points[0].pressure, brush2.pressure);
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y, brush2.size * pointScale / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  brushForStroke(stroke) {
    var _a;
    if (stroke.brush) return stroke.brush;
    const kind = stroke.tool === "highlighter" ? "highlighter" : stroke.tool === "ballpoint" ? "ballpoint" : "pen";
    return {
      ...this.plugin.settings.brushes[kind],
      kind,
      color: stroke.color,
      size: stroke.size,
      opacity: (_a = stroke.opacity) != null ? _a : kind === "highlighter" ? 0.32 : 1
    };
  }
  centerlineToPath(points) {
    const path = new Path2D();
    if (points.length === 0) return path;
    path.moveTo(points[0].x, points[0].y);
    if (points.length === 2) {
      path.lineTo(points[1].x, points[1].y);
      return path;
    }
    for (let index = 0; index < points.length - 1; index++) {
      const before = points[Math.max(0, index - 1)];
      const current = points[index];
      const next = points[index + 1];
      const after = points[Math.min(points.length - 1, index + 2)];
      path.bezierCurveTo(
        current.x + (next.x - before.x) / 6,
        current.y + (next.y - before.y) / 6,
        next.x - (after.x - current.x) / 6,
        next.y - (after.y - current.y) / 6,
        next.x,
        next.y
      );
    }
    return path;
  }
  outlineToPath(points) {
    const path = new Path2D();
    if (!points.length) return path;
    const last = points[points.length - 1];
    path.moveTo((last.x + points[0].x) / 2, (last.y + points[0].y) / 2);
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const next = points[(index + 1) % points.length];
      path.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
    }
    path.closePath();
    return path;
  }
  drawImage(ctx, item) {
    const image = this.boardAssets.get(item.path);
    const centerX = item.x + item.width / 2;
    const centerY = item.y + item.height / 2;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(item.rotation * Math.PI / 180);
    if ((image == null ? void 0 : image.complete) && image.naturalWidth) {
      ctx.drawImage(
        image,
        image.naturalWidth * item.crop.x,
        image.naturalHeight * item.crop.y,
        image.naturalWidth * item.crop.width,
        image.naturalHeight * item.crop.height,
        -item.width / 2,
        -item.height / 2,
        item.width,
        item.height
      );
      ctx.restore();
      return;
    }
    ctx.fillStyle = "rgba(128, 128, 128, 0.12)";
    ctx.fillRect(-item.width / 2, -item.height / 2, item.width, item.height);
    ctx.restore();
  }
  drawEraserPreview(ctx) {
    if (this.tool !== "eraser" || !this.eraserPreview) return;
    const radius = this.plugin.settings.eraser.size / 2 / this.data.camera.zoom;
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.eraserPreview.x, this.eraserPreview.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.fill();
    ctx.strokeStyle = "rgba(28, 28, 30, 0.72)";
    ctx.lineWidth = 1.25 / this.data.camera.zoom;
    ctx.setLineDash([4 / this.data.camera.zoom, 3 / this.data.camera.zoom]);
    ctx.stroke();
    ctx.restore();
  }
  loadImage(path) {
    this.boardAssets.load(path);
  }
  onReferencedImageAvailable(file) {
    this.boardAssets.onVaultFile(file.path, this.data.elements);
  }
  createPersistentStroke(point) {
    const kind = this.tool === "ballpoint" || this.tool === "highlighter" ? this.tool : "pen";
    const brush2 = structuredClone(this.plugin.settings.brushes[kind]);
    return {
      id: makeId("stroke"),
      type: "stroke",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      tool: kind,
      color: brush2.color,
      size: brush2.size,
      opacity: brush2.opacity,
      brush: brush2,
      points: [point]
    };
  }
  createLaserStroke(point) {
    this.laserController.onInputStart(this.laserInput(point));
    this.activeInputPersistent = false;
    this.ensureLaserAnimation();
  }
  appendLaserPoint(point) {
    this.laserController.onInputMove(this.laserInput(point));
  }
  completeLaserStroke() {
    if (!this.laserController.isDrawing) return;
    this.laserController.complete();
    this.ensureLaserAnimation();
  }
  finishLaserStroke(point) {
    this.laserController.onInputEnd(this.laserInput(point));
    this.ensureLaserAnimation();
  }
  laserInput(point) {
    var _a;
    return {
      pointerId: (_a = this.drawingPointer) != null ? _a : -1,
      point,
      source: this.activeInputSource === "touch" ? "stylus-touch" : "pointer"
    };
  }
  ensureLaserAnimation() {
    if (this.laserFrame || !this.laserController.hasStrokes) return;
    const animate = () => {
      this.laserFrame = 0;
      this.laserController.pruneExpired();
      this.scheduleRender();
      if (this.laserController.hasStrokes) this.laserFrame = window.requestAnimationFrame(animate);
    };
    this.laserFrame = window.requestAnimationFrame(animate);
  }
  clearLaserStrokes() {
    if (this.laserFrame) window.cancelAnimationFrame(this.laserFrame);
    this.laserFrame = 0;
    this.laserController.clear();
    this.scheduleRender();
  }
  selectedElements() {
    return this.selection.selected(this.data.elements);
  }
  drawSelection(ctx) {
    if (this.tool !== "select") return;
    const zoom = this.data.camera.zoom;
    const bounds = this.selection.bounds(this.data.elements);
    ctx.save();
    ctx.strokeStyle = "#0a84ff";
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    if (bounds) {
      const selected = this.selectedElements();
      const editableImage = selected.length === 1 && selected[0].type === "image" && !selected[0].locked ? selected[0] : null;
      const imageEditMode = editableImage ? this.selection.editMode : null;
      if (editableImage && imageEditMode) {
        const corners = imageCorners(editableImage);
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (const point of corners.slice(1)) ctx.lineTo(point.x, point.y);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      }
      if (selected.length > 0 && selected.every((element) => !element.locked)) {
        ctx.setLineDash([]);
        const points = editableImage && imageEditMode === "crop" ? Object.values(imageCropHandlePoints(editableImage)) : imageEditMode === "rotate" ? [] : Object.values(handlePoints(bounds));
        for (const point of points) {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 7 / zoom, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        if (editableImage && imageEditMode === "rotate") {
          const top = imageCropHandlePoints(editableImage).n;
          const handle = imageRotationHandlePoint(editableImage, 34 / zoom);
          ctx.beginPath();
          ctx.moveTo(top.x, top.y);
          ctx.lineTo(handle.x, handle.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(handle.x, handle.y, 8 / zoom, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
    const drag = this.selection.dragView;
    if ((drag == null ? void 0 : drag.kind) === "lasso" && drag.lasso.length > 1) {
      ctx.fillStyle = "rgba(10, 132, 255, 0.10)";
      ctx.strokeStyle = "rgba(10, 132, 255, 0.9)";
      ctx.beginPath();
      ctx.moveTo(drag.lasso[0].x, drag.lasso[0].y);
      for (const point of drag.lasso.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if ((drag == null ? void 0 : drag.kind) === "marquee" && drag.lasso.length === 2) {
      const start = drag.lasso[0];
      const end = drag.lasso[1];
      ctx.fillStyle = "rgba(10, 132, 255, 0.08)";
      ctx.strokeStyle = "rgba(10, 132, 255, 0.9)";
      ctx.fillRect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      ctx.strokeRect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y));
    }
    ctx.restore();
  }
  updateSelectionToolbar() {
    if (!this.selectionToolbar) return;
    const selected = this.tool === "select" ? this.selectedElements() : [];
    const allImages = selected.length > 0 && selected.every((element) => element.type === "image");
    const single = allImages && selected.length === 1;
    const multiple = allImages && selected.length > 1;
    const deleteOnly = selected.length > 0 && !allImages;
    if (!single && this.selection.editMode) this.selection.setImageEditMode(null);
    this.selectionToolbar.hidden = !single && !multiple && !deleteOnly;
    if (!single && !multiple && !deleteOnly) return;
    const singleActions = /* @__PURE__ */ new Set(["duplicate", "crop", "rotate", "lock", "open", "delete"]);
    const multiActions = /* @__PURE__ */ new Set(["align-left", "align-center-x", "align-right", "align-top", "align-center-y", "align-bottom", "distribute-horizontal", "distribute-vertical"]);
    for (const [key, button] of this.selectionActionButtons) {
      button.hidden = !(single ? singleActions.has(key) : multiple ? multiActions.has(key) : key === "delete");
      button.disabled = false;
      button.removeAttribute("aria-pressed");
      button.classList.remove("is-active");
    }
    if (single) {
      const image = selected[0];
      const locked = Boolean(image.locked);
      for (const key of ["crop", "rotate", "delete"]) {
        const button = this.selectionActionButtons.get(key);
        if (button) button.disabled = locked;
      }
      const lockButton = this.selectionActionButtons.get("lock");
      if (lockButton) {
        const label = locked ? "\u89E3\u9501" : "\u9501\u5B9A";
        lockButton.setAttribute("aria-label", label);
        lockButton.setAttribute("title", label);
        (0, import_obsidian3.setIcon)(lockButton, locked ? "lock-open" : "lock-keyhole");
      }
      for (const mode of ["crop", "rotate"]) {
        const button = this.selectionActionButtons.get(mode);
        const active = !locked && this.selection.editMode === mode;
        button == null ? void 0 : button.classList.toggle("is-active", active);
        button == null ? void 0 : button.setAttribute("aria-pressed", active ? "true" : "false");
      }
      if (locked && this.selection.editMode) this.selection.setImageEditMode(null);
    } else if (multiple) {
      const disabled = selected.some((element) => element.locked);
      for (const button of multiActions) {
        const element = this.selectionActionButtons.get(button);
        if (element) element.disabled = disabled || button.startsWith("distribute-") && selected.length < 3;
      }
    } else {
      const deleteButton = this.selectionActionButtons.get("delete");
      if (deleteButton) deleteButton.disabled = !selected.some((element) => !element.locked);
    }
    this.selectionToolbar.classList.toggle("is-single-image", single);
    this.selectionToolbar.classList.toggle("is-multi-image", multiple);
    this.selectionToolbar.classList.toggle("is-stroke-selection", deleteOnly);
    const bounds = this.selection.bounds(this.data.elements);
    if (!bounds) return;
    const camera = this.data.camera;
    const screenX = camera.x + (bounds.minX + bounds.maxX) / 2 * camera.zoom;
    const screenY = camera.y + bounds.minY * camera.zoom;
    const halfWidth = Math.max(24, this.selectionToolbar.offsetWidth / 2);
    this.selectionToolbar.style.left = `${Math.max(halfWidth + 7, Math.min(this.canvas.clientWidth - halfWidth - 7, screenX))}px`;
    const bottomReserve = import_obsidian3.Platform.isMobile && window.matchMedia("(max-width: 700px)").matches ? 124 : 64;
    const selectionToolbarOffset = 100;
    this.selectionToolbar.style.top = `${Math.max(12, Math.min(this.canvas.clientHeight - bottomReserve, screenY - selectionToolbarOffset))}px`;
  }
  startSelection(pointerId, screen2, additive) {
    const world = this.screenToWorld(screen2);
    const tolerance = 18 / this.data.camera.zoom;
    const candidates = this.spatialIndex.query(this.data.elements, {
      minX: world.x - tolerance,
      minY: world.y - tolerance,
      maxX: world.x + tolerance,
      maxY: world.y + tolerance
    });
    this.selection.start(this.data.elements, candidates, pointerId, world, this.data.camera.zoom, additive, this.plugin.settings.selectionMode);
    this.activeInputPersistent = false;
    this.scheduleRender();
  }
  updateSelection(point) {
    const candidates = this.selectionCandidates(point);
    if (this.selection.update(this.data.elements, point, this.data.camera.zoom, candidates)) {
      for (const element of this.selection.selected(this.data.elements)) this.spatialIndex.upsert(element);
      this.strokePathCache.clear();
      this.invalidateSceneCache();
    }
    this.scheduleRender();
  }
  finishSelection(point) {
    const edit = this.selection.finish(this.data.elements, point, this.data.camera.zoom, this.selectionCandidates(point));
    if (edit) {
      this.history.recordApplied(new UpdateElementsCommand(edit.before, edit.after));
      this.markDirty();
      this.strokePathCache.clear();
      this.rebuildSpatialIndex();
    }
    this.scheduleRender();
    return edit !== null;
  }
  selectionCandidates(point) {
    const drag = this.selection.dragView;
    if (!drag || drag.kind !== "lasso" && drag.kind !== "marquee") return this.data.elements;
    const points = [...drag.lasso, point];
    const padding = 8 / this.data.camera.zoom;
    return this.spatialIndex.query(this.data.elements, {
      minX: Math.min(...points.map((value) => value.x)) - padding,
      minY: Math.min(...points.map((value) => value.y)) - padding,
      maxX: Math.max(...points.map((value) => value.x)) + padding,
      maxY: Math.max(...points.map((value) => value.y)) + padding
    });
  }
  cancelSelection() {
    if (this.selection.cancel(this.data.elements)) {
      this.strokePathCache.clear();
      this.rebuildSpatialIndex();
    }
    this.scheduleRender();
  }
  deleteSelection() {
    if (!this.selection.selectedIds.size) return;
    const entries = this.data.elements.map((element, index) => ({ element, index })).filter((entry) => this.selection.selectedIds.has(entry.element.id) && !entry.element.locked);
    if (!entries.length) return;
    const command = new DeleteElementsCommand(entries);
    this.data = command.execute(this.data);
    this.history.recordApplied(command);
    this.selection.clear();
    this.strokePathCache.clear();
    this.rebuildSpatialIndex();
    this.markDirty();
    this.scheduleSave();
    this.scheduleRender();
  }
  duplicateSelection() {
    const selected = this.selectedElements();
    if (!selected.length) return;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const offset = 20 / this.data.camera.zoom;
    const duplicates = selected.map((source) => {
      const element = structuredClone(source);
      element.id = makeId(element.type);
      element.createdAt = now;
      element.updatedAt = now;
      element.locked = void 0;
      translateElement(element, source, offset, offset);
      return element;
    });
    const startIndex = this.data.elements.length;
    const command = new InsertElementsCommand(duplicates.map((element, index) => ({ index: startIndex + index, element })));
    this.data = command.execute(this.data);
    this.history.recordApplied(command);
    this.selection.setSelected(duplicates.map((element) => element.id));
    this.rebuildSpatialIndex();
    this.markDirty();
    this.scheduleSave();
    this.scheduleRender();
  }
  copySelection() {
    const selected = this.selectedElements();
    if (!selected.length) return;
    this.elementClipboard = selected.map((element) => structuredClone(element));
    this.pasteSequence = 0;
    new import_obsidian3.Notice(`\u5DF2\u590D\u5236 ${selected.length} \u4E2A\u5143\u7D20\u3002`, 1800);
  }
  pasteCopiedElements() {
    if (!this.elementClipboard.length) {
      new import_obsidian3.Notice("\u5F53\u524D\u6CA1\u6709\u5DF2\u590D\u5236\u7684\u753B\u5E03\u5143\u7D20\u3002", 2200);
      return;
    }
    this.pasteSequence += 1;
    const offset = 20 * this.pasteSequence / this.data.camera.zoom;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const duplicates = this.elementClipboard.map((source) => {
      const element = structuredClone(source);
      element.id = makeId(element.type);
      element.createdAt = now;
      element.updatedAt = now;
      element.locked = void 0;
      translateElement(element, source, offset, offset);
      return element;
    });
    const startIndex = this.data.elements.length;
    const command = new InsertElementsCommand(duplicates.map((element, index) => ({ index: startIndex + index, element })));
    this.data = command.execute(this.data);
    this.history.recordApplied(command);
    this.selection.setSelected(duplicates.map((element) => element.id));
    this.strokePathCache.clear();
    this.rebuildSpatialIndex();
    this.markDirty();
    this.scheduleSave();
    this.scheduleRender();
  }
  recordSelectionUpdate(before, after, label) {
    if (!before.length || JSON.stringify(before) === JSON.stringify(after)) return;
    const command = new UpdateElementsCommand(before, after, label);
    this.data = command.execute(this.data);
    this.history.recordApplied(command);
    this.strokePathCache.clear();
    this.rebuildSpatialIndex();
    this.markDirty();
    this.scheduleSave();
    this.scheduleRender();
  }
  toggleSelectedImageEditMode(mode) {
    const selected = this.selectedElements();
    if (selected.length !== 1 || selected[0].type !== "image" || selected[0].locked) return;
    this.selection.toggleImageEditMode(mode);
    this.scheduleRender();
  }
  async openSelectedImage() {
    const selected = this.selectedElements();
    if (selected.length !== 1 || selected[0].type !== "image") return;
    const file = this.app.vault.getAbstractFileByPath(selected[0].path);
    if (!(file instanceof import_obsidian3.TFile)) {
      new import_obsidian3.Notice("\u627E\u4E0D\u5230\u56FE\u7247\u9644\u4EF6\u3002", 2400);
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }
  toggleSelectionLock() {
    const before = this.selectedElements();
    if (!before.length) return;
    const lock = before.some((element) => !element.locked);
    const after = before.map((element) => ({ ...structuredClone(element), locked: lock || void 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
    this.recordSelectionUpdate(before, after, lock ? "\u9501\u5B9A\u5143\u7D20" : "\u89E3\u9501\u5143\u7D20");
  }
  alignSelection(alignment) {
    const before = this.selectedElements();
    const next = alignElements(this.data.elements, this.selection.selectedIds, alignment);
    const after = next.filter((element) => this.selection.selectedIds.has(element.id));
    this.recordSelectionUpdate(before, after, "\u5BF9\u9F50\u5143\u7D20");
  }
  distributeSelection(direction) {
    const before = this.selectedElements();
    const next = distributeElements(this.data.elements, this.selection.selectedIds, direction);
    const after = next.filter((element) => this.selection.selectedIds.has(element.id));
    this.recordSelectionUpdate(before, after, "\u7B49\u8DDD\u5206\u5E03\u5143\u7D20");
  }
  onCanvasPointerDown(event) {
    if (!isStylusPointer(event)) event.preventDefault();
    try {
      this.canvas.setPointerCapture(event.pointerId);
      this.traceInput("pointercapture-set", `id=${event.pointerId} type=${event.pointerType || "unknown"}`);
    } catch (error) {
      this.traceInput("pointercapture-unavailable", `id=${event.pointerId} ${error instanceof Error ? error.name : "unknown"}`);
    }
    this.onPointerDown(event);
  }
  onCanvasPointerUp(event, kind) {
    if (event.pointerType !== "pen" && !this.stylusPointerIds.has(event.pointerId)) event.preventDefault();
    this.onPointerUp(event, kind);
  }
  onCanvasPointerMove(event) {
    if (this.useIosTouchEvents && shouldRecoverPenPointerMove(
      event,
      this.drawingPointer !== null,
      this.isCanvasInputEvent(event)
    )) {
      this.recoveredPointerStarts += 1;
      this.inputToolMetrics.recordRecovery(this.tool, "pointer-move");
      this.traceInput("pointerdown-recovered-from-move", this.pointerDetails(event));
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        this.traceInput("recovery-capture-unavailable", `id=${event.pointerId} ${error instanceof Error ? error.name : "unknown"}`);
      }
      this.onPointerDown(event);
    }
    if (event.pointerType !== "pen" && !this.stylusPointerIds.has(event.pointerId)) event.preventDefault();
    this.onPointerMove(event);
  }
  onLostPointerCapture(event) {
    this.traceInput("pointercapture-lost", this.pointerDetails(event));
    if (this.drawingPointer !== event.pointerId) return;
    this.finishActiveInput(this.activeInputPersistent);
  }
  onPointerDown(event) {
    this.traceInput("pointerdown", this.pointerDetails(event));
    if (this.activeInputSource === "touch" && this.drawingPointer === event.pointerId) {
      this.traceInput("pointerdown-late-after-touch-fallback", `id=${event.pointerId}`);
      return;
    }
    if (this.useIosTouchEvents && event.pointerType === "pen") {
      this.penPointerStarts += 1;
      if (this.nativeStylusTouchEnabled() && this.iosStylusTouchConfirmed) {
        this.traceInput("pointerdown-ignored", "native Stylus Touch is authoritative");
        this.recordPointerEvent("ignored-down", event);
        return;
      }
    }
    if (!this.useIosTouchEvents) this.canvas.focus({ preventScroll: true });
    const screen2 = this.eventPoint(event);
    if (this.tool === "eraser") this.eraserPreview = this.screenToWorld(screen2);
    const stylus = isStylusPointer(event);
    if (event.pointerType === "touch" && !stylus) {
      if (this.penPointer !== null) return;
      this.recordPointerEvent("down", event);
      this.recordInput(event);
      this.touchPointers.set(event.pointerId, screen2);
      this.resetTouchGesture();
      event.preventDefault();
      return;
    }
    if (event.button !== 0 && !stylus) return;
    window.clearTimeout(this.saveTimer);
    if (this.drawingPointer !== null) this.finishActiveInput(false);
    if (stylus) this.stylusPointerIds.add(event.pointerId);
    this.recordPointerEvent("down", event);
    this.recordInput(event, 1, stylus && event.pointerType !== "pen" ? "pen (touch\u517C\u5BB9)" : void 0);
    if (stylus) {
      this.penPointer = event.pointerId;
      this.touchPointers.clear();
      this.resetTouchGesture();
    }
    if (this.tool === "hand" || event.button === 1 || event.button === 2) {
      this.activeInputSource = "pointer";
      this.drawingPointer = event.pointerId;
      this.activePointerStartedAt = event.timeStamp;
      this.lastTouchCenter = screen2;
      return;
    }
    this.activeInputSource = "pointer";
    this.drawingPointer = event.pointerId;
    this.activePointerStartedAt = event.timeStamp;
    if (this.tool === "select") {
      this.startSelection(event.pointerId, screen2, event.shiftKey || event.ctrlKey || event.metaKey);
      if (!stylus) event.preventDefault();
      return;
    } else if (this.tool === "eraser") {
      this.activeInputPersistent = false;
      this.lastEraserPoint = null;
      this.pushHistory();
      this.eraseAlongPath(this.screenToWorld(screen2));
    } else if (this.tool === "laser") {
      this.activeDiagnosticTool = this.inputToolMetrics.recordStart(this.tool, "pointer");
      const world = this.screenToWorld(screen2);
      this.createLaserStroke(this.makePoint(world, event));
    } else {
      this.activeDiagnosticTool = this.inputToolMetrics.recordStart(this.tool, "pointer");
      this.activeInputPersistent = true;
      this.markDirty(false);
      const world = this.screenToWorld(screen2);
      this.currentStroke = this.createPersistentStroke(this.makePoint(world, event));
      this.data.elements.push(this.currentStroke);
      this.spatialIndex.upsert(this.currentStroke);
    }
    if (!stylus) event.preventDefault();
    this.scheduleRender();
  }
  onPointerMove(event) {
    if (this.nativeStylusTouchEnabled() && this.iosStylusTouchConfirmed && event.pointerType === "pen") {
      this.traceMove("pointermove-ignored", this.pointerDetails(event));
      return;
    }
    if (this.useIosTouchEvents && event.pointerType === "pen") this.traceMove("pointermove", this.pointerDetails(event));
    const screen2 = this.eventPoint(event);
    if (this.tool === "eraser") {
      this.eraserPreview = this.screenToWorld(screen2);
      this.scheduleRender();
    }
    const stylus = event.pointerType === "pen" || this.stylusPointerIds.has(event.pointerId);
    if (event.pointerType === "touch" && !stylus) {
      if (this.penPointer !== null) return;
      if (!this.touchPointers.has(event.pointerId)) return;
      this.recordInput(event);
      this.touchPointers.set(event.pointerId, screen2);
      this.updateTouchGesture();
      event.preventDefault();
      return;
    }
    if (this.drawingPointer !== event.pointerId) return;
    if (this.tool === "hand") {
      this.recordInput(event);
      if (this.lastTouchCenter) {
        this.data.camera.x += screen2.x - this.lastTouchCenter.x;
        this.data.camera.y += screen2.y - this.lastTouchCenter.y;
      }
      this.lastTouchCenter = screen2;
      this.markDirty();
      this.scheduleRender();
      return;
    }
    if (this.tool === "eraser") {
      for (const sample of this.pointerSamples(event)) this.eraseAlongPath(this.screenToWorld(this.eventPoint(sample)));
    } else if (this.tool === "select" && this.selection.activePointerId !== null) {
      this.updateSelection(this.screenToWorld(screen2));
    } else if (this.tool === "laser" && this.laserController.isDrawing) {
      const samples = this.pointerSamples(event);
      this.recordInput(event, samples.length, stylus && event.pointerType !== "pen" ? "pen (touch\u517C\u5BB9)" : void 0);
      for (const sample of samples) {
        this.appendLaserPoint(this.makePoint(this.screenToWorld(this.eventPoint(sample)), sample, 0.5));
      }
    } else if (this.currentStroke) {
      const samples = this.pointerSamples(event);
      this.recordInput(event, samples.length, stylus && event.pointerType !== "pen" ? "pen (touch\u517C\u5BB9)" : void 0);
      this.appendStrokeSamples(samples);
    }
    if (!stylus) event.preventDefault();
    this.scheduleRender();
  }
  onPointerUp(event, kind = "up") {
    this.traceInput(`pointer${kind}`, this.pointerDetails(event));
    if (this.nativeStylusTouchEnabled() && this.iosStylusTouchConfirmed && event.pointerType === "pen") {
      this.traceInput(`pointer${kind}-ignored`, "native Stylus Touch is authoritative");
      return;
    }
    this.recordPointerEvent(kind, event);
    const stylus = event.pointerType === "pen" || this.stylusPointerIds.has(event.pointerId);
    if (event.pointerType === "touch" && !stylus) {
      this.touchPointers.delete(event.pointerId);
      this.resetTouchGesture();
      this.scheduleSave(900);
      return;
    }
    this.stylusPointerIds.delete(event.pointerId);
    if (this.drawingPointer !== event.pointerId) return;
    if (event.timeStamp < this.activePointerStartedAt) return;
    if (this.tool === "select" && this.selection.activePointerId !== null) {
      if (kind === "cancel") {
        this.cancelSelection();
        this.finishActiveInput(false);
        return;
      }
      const changed = this.finishSelection(this.screenToWorld(this.eventPoint(event)));
      this.finishActiveInput(changed);
      return;
    }
    if (this.tool === "eraser" && kind !== "cancel") this.eraseAlongPath(this.screenToWorld(this.eventPoint(event)));
    if (this.currentStroke) this.appendStrokeSamples([event]);
    if (this.laserController.isDrawing) {
      this.finishLaserStroke(this.makePoint(this.screenToWorld(this.eventPoint(event)), event, 0.5));
    }
    this.finishActiveInput(this.activeInputPersistent);
  }
  finishActiveInput(scheduleSave) {
    const completedStroke = this.currentStroke;
    const completedSource = this.activeInputSource;
    const completedDiagnosticTool = this.activeDiagnosticTool;
    const completedLaser = this.laserController.isDrawing;
    if (this.selection.activePointerId !== null) this.cancelSelection();
    if (this.laserController.isDrawing) this.completeLaserStroke();
    this.drawingPointer = null;
    this.penPointer = null;
    this.stylusTouchId = null;
    this.stylusPointerIds.clear();
    this.activePointerStartedAt = 0;
    this.activeInputSource = null;
    this.currentStroke = null;
    this.activeDiagnosticTool = null;
    this.lastTouchCenter = null;
    this.lastEraserPoint = null;
    if (completedStroke) {
      const index = this.data.elements.findIndex((element) => element.id === completedStroke.id);
      if (index >= 0) {
        this.history.recordApplied(new InsertElementsCommand([{ index, element: completedStroke }], "\u4E66\u5199\u7B14\u8FF9"));
        this.spatialIndex.upsert(completedStroke);
        if (this.useIosTouchEvents && this.iosStylusTouchConfirmed && completedSource === "pointer") {
          this.pointerFallbackStrokes += 1;
        }
      }
      if (this.useIosTouchEvents) this.keepPresentationActive(650);
      this.invalidateSceneCache();
    } else {
      this.history.commit(this.data);
    }
    if (completedStroke || completedLaser) this.inputToolMetrics.recordCompletion(completedDiagnosticTool);
    this.scheduleRender();
    if (scheduleSave) this.scheduleSave(this.useIosTouchEvents ? 3e3 : 900);
    this.activeInputPersistent = true;
    this.traceInput("input-finished", `source=${completedSource != null ? completedSource : "none"} savedLater=${scheduleSave ? 1 : 0}`);
  }
  keepPresentationActive(durationMs) {
    this.presentationUntil = Math.max(this.presentationUntil, performance.now() + durationMs);
    if (this.presentationFrame) return;
    const tick = () => {
      this.presentationFrame = 0;
      if (performance.now() >= this.presentationUntil || document.visibilityState !== "visible") return;
      this.presentationRecoveryFrames += 1;
      this.scheduleRender();
      this.presentationFrame = window.requestAnimationFrame(tick);
    };
    this.presentationFrame = window.requestAnimationFrame(tick);
  }
  onTouchStart(event, allowPointerFallback = false) {
    if (!this.nativeStylusTouchEnabled() && !allowPointerFallback) return;
    this.traceInput("touchstart-raw", this.touchDetails(event));
    const touch = findStylusTouch(event.changedTouches, this.iosStylusTouchConfirmed);
    if (!touch) {
      this.traceInput("touchstart-rejected", "no stylus candidate");
      return;
    }
    this.stylusTouchStarts += 1;
    this.traceInput("touchstart-accepted", `id=${touch.identifier} force=${this.traceNumber(touch.force, 3)}`);
    this.iosStylusTouchConfirmed = true;
    window.clearTimeout(this.saveTimer);
    if (this.activeInputSource === "pointer" && this.penPointer !== null) {
      this.stylusHandoffs += 1;
      this.stylusTouchId = touch.identifier;
      this.drawingPointer = touch.identifier;
      this.penPointer = touch.identifier;
      this.activeInputSource = "touch";
      this.activePointerStartedAt = event.timeStamp;
      this.lastInputType = "stylus touch";
      this.pencilDetected = true;
      this.lastPressure = touch.force;
      this.selection.transferPointer(touch.identifier);
      if (this.currentStroke) {
        const world2 = this.screenToWorld(this.touchPoint(touch));
        const previous = this.currentStroke.points[this.currentStroke.points.length - 1];
        if (Math.hypot(world2.x - previous.x, world2.y - previous.y) > 0.05) {
          this.currentStroke.points.push({ x: world2.x, y: world2.y, pressure: touch.force || previous.pressure, time: event.timeStamp });
        }
      } else if (this.laserController.isDrawing) {
        const world2 = this.screenToWorld(this.touchPoint(touch));
        this.appendLaserPoint({ x: world2.x, y: world2.y, pressure: touch.force || 0.5, time: event.timeStamp });
      }
      this.scheduleDiagnostics();
      return;
    }
    if (this.drawingPointer !== null) this.finishActiveInput(false);
    this.stylusTouchId = touch.identifier;
    this.activeInputSource = "touch";
    this.drawingPointer = touch.identifier;
    this.penPointer = touch.identifier;
    this.activePointerStartedAt = event.timeStamp;
    this.lastInputType = "stylus touch";
    this.pencilDetected = true;
    this.lastPressure = touch.force;
    this.recentPointerEvents.push(`down \xB7 stylus #${touch.identifier}`);
    if (this.recentPointerEvents.length > 8) this.recentPointerEvents.shift();
    const world = this.screenToWorld(this.touchPoint(touch));
    if (this.tool === "eraser") this.eraserPreview = world;
    if (this.tool === "select") {
      this.startSelection(touch.identifier, this.touchPoint(touch), false);
    } else if (this.tool === "eraser") {
      this.activeInputPersistent = false;
      this.lastEraserPoint = null;
      this.pushHistory();
      this.eraseAlongPath(world);
    } else if (this.tool === "hand") {
      this.activeInputPersistent = true;
      this.lastTouchCenter = this.touchPoint(touch);
    } else if (this.tool === "laser") {
      this.activeDiagnosticTool = this.inputToolMetrics.recordStart(this.tool, "touch");
      this.createLaserStroke({ x: world.x, y: world.y, pressure: touch.force > 0 ? touch.force : 0.5, time: event.timeStamp });
    } else {
      this.activeDiagnosticTool = this.inputToolMetrics.recordStart(this.tool, "touch");
      this.activeInputPersistent = true;
      this.markDirty(false);
      this.currentStroke = this.createPersistentStroke({
        x: world.x,
        y: world.y,
        pressure: touch.force > 0 ? touch.force : 0.25,
        time: event.timeStamp
      });
      this.data.elements.push(this.currentStroke);
      this.spatialIndex.upsert(this.currentStroke);
    }
    this.scheduleDiagnostics();
    this.scheduleRender();
  }
  onTouchMove(event, allowPointerFallback = false) {
    if (!this.nativeStylusTouchEnabled() && !allowPointerFallback) return;
    if (this.stylusTouchId === null) {
      this.traceMove("touchmove-no-active", this.touchDetails(event));
      return;
    }
    const touch = findTouch(event.touches, this.stylusTouchId);
    if (!touch) {
      this.traceInput("touchmove-orphan", this.touchDetails(event));
      this.orphanedStylusRecoveries += 1;
      this.finishActiveInput(this.activeInputPersistent);
      this.scheduleDiagnostics();
      return;
    }
    this.traceMove("touchmove", this.touchDetails(event));
    const screen2 = this.touchPoint(touch);
    if (this.tool === "eraser") this.eraserPreview = this.screenToWorld(screen2);
    this.updateTouchSampleRate(touch, event.timeStamp);
    if (this.tool === "hand") {
      if (this.lastTouchCenter) {
        this.data.camera.x += screen2.x - this.lastTouchCenter.x;
        this.data.camera.y += screen2.y - this.lastTouchCenter.y;
      }
      this.lastTouchCenter = screen2;
      this.markDirty();
    } else if (this.tool === "select" && this.selection.activePointerId !== null) {
      this.updateSelection(this.screenToWorld(screen2));
    } else if (this.tool === "eraser") {
      this.eraseAlongPath(this.screenToWorld(screen2));
    } else if (this.tool === "laser" && this.laserController.isDrawing) {
      const world = this.screenToWorld(screen2);
      this.appendLaserPoint({
        x: world.x,
        y: world.y,
        pressure: touch.force > 0 ? touch.force : 0.5,
        time: event.timeStamp
      });
    } else if (this.currentStroke) {
      const world = this.screenToWorld(screen2);
      const previous = this.currentStroke.points[this.currentStroke.points.length - 1];
      if (Math.hypot(world.x - previous.x, world.y - previous.y) > 0.12) {
        this.currentStroke.points.push({
          x: world.x,
          y: world.y,
          pressure: touch.force > 0 ? touch.force : previous.pressure,
          time: event.timeStamp
        });
      }
    }
    this.scheduleDiagnostics();
    this.scheduleRender();
  }
  onTouchEnd(event, kind, allowPointerFallback = false) {
    if (!this.nativeStylusTouchEnabled() && !allowPointerFallback) return;
    if (this.stylusTouchId === null) {
      this.traceInput(`touch${kind}-no-active`, this.touchDetails(event));
      return;
    }
    this.traceInput(`touch${kind}-raw`, this.touchDetails(event));
    const touch = findTouch(event.changedTouches, this.stylusTouchId);
    if (!touch) {
      if (shouldRecoverMissingStylus(event.touches, event.changedTouches, this.stylusTouchId)) {
        this.traceInput(`touch${kind}-orphan`, "active identifier absent from all lists");
        this.orphanedStylusRecoveries += 1;
        this.finishActiveInput(this.activeInputPersistent);
        this.scheduleDiagnostics();
      }
      return;
    }
    if (event.timeStamp < this.activePointerStartedAt) {
      this.traceInput(`touch${kind}-late`, `started=${this.activePointerStartedAt.toFixed(1)}`);
      return;
    }
    if (this.tool === "select" && this.selection.activePointerId !== null) {
      if (kind === "cancel") {
        this.cancelSelection();
        this.stylusTouchId = null;
        this.finishActiveInput(false);
        return;
      }
      const changed = this.finishSelection(this.screenToWorld(this.touchPoint(touch)));
      this.recentPointerEvents.push(`${kind} \xB7 stylus #${touch.identifier}`);
      if (this.recentPointerEvents.length > 8) this.recentPointerEvents.shift();
      this.stylusTouchId = null;
      this.finishActiveInput(changed);
      return;
    } else if (this.tool === "eraser" && kind !== "cancel") {
      this.eraseAlongPath(this.screenToWorld(this.touchPoint(touch)));
    } else if (this.currentStroke) {
      const world = this.screenToWorld(this.touchPoint(touch));
      const previous = this.currentStroke.points[this.currentStroke.points.length - 1];
      if (Math.hypot(world.x - previous.x, world.y - previous.y) > 0.05) {
        this.currentStroke.points.push({ x: world.x, y: world.y, pressure: previous.pressure, time: event.timeStamp });
      }
    } else if (this.laserController.isDrawing) {
      const world = this.screenToWorld(this.touchPoint(touch));
      this.finishLaserStroke({ x: world.x, y: world.y, pressure: touch.force || 0.5, time: event.timeStamp });
    }
    this.recentPointerEvents.push(`${kind} \xB7 stylus #${touch.identifier}`);
    if (this.recentPointerEvents.length > 8) this.recentPointerEvents.shift();
    this.stylusTouchId = null;
    this.eraserPreview = null;
    this.finishActiveInput(this.activeInputPersistent);
  }
  touchPoint(touch) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }
  updateTouchSampleRate(touch, timeStamp) {
    const now = timeStamp;
    if (this.lastSampleTime > 0) {
      const elapsed = now - this.lastSampleTime;
      if (elapsed > 0) {
        const instantaneous = Math.min(1e3, Math.round(1e3 / elapsed));
        this.sampleRate = this.sampleRate === 0 ? instantaneous : Math.round(this.sampleRate * 0.75 + instantaneous * 0.25);
      }
    }
    this.lastSampleTime = now;
    this.lastPressure = touch.force;
    this.coalescedSamples = 1;
  }
  pointerSamples(event) {
    let samples = [];
    if (typeof event.getCoalescedEvents === "function") {
      try {
        samples = event.getCoalescedEvents();
      } catch (e) {
      }
    }
    const last = samples[samples.length - 1];
    if (!last || last.timeStamp !== event.timeStamp || last.clientX !== event.clientX || last.clientY !== event.clientY) {
      samples.push(event);
    }
    return samples.sort((a, b) => a.timeStamp - b.timeStamp);
  }
  appendStrokeSamples(samples) {
    var _a;
    if (!this.currentStroke) return;
    for (const sample of samples) {
      const world = this.screenToWorld(this.eventPoint(sample));
      const previous = this.currentStroke.points[this.currentStroke.points.length - 1];
      if (!previous || Math.hypot(world.x - previous.x, world.y - previous.y) > 0.18) {
        this.currentStroke.points.push(this.makePoint(world, sample, (_a = previous == null ? void 0 : previous.pressure) != null ? _a : 0.25));
      }
    }
  }
  resetTouchGesture() {
    const values = [...this.touchPointers.values()];
    this.lastTouchCenter = values.length ? this.center(values) : null;
    this.lastPinchDistance = values.length >= 2 ? this.distance(values[0], values[1]) : 0;
  }
  updateTouchGesture() {
    const values = [...this.touchPointers.values()];
    if (!values.length) return;
    const center = this.center(values);
    if (values.length >= 2 && this.lastPinchDistance > 0) {
      if (this.lastTouchCenter) {
        this.data.camera.x += center.x - this.lastTouchCenter.x;
        this.data.camera.y += center.y - this.lastTouchCenter.y;
      }
      const distance = this.distance(values[0], values[1]);
      this.zoomAt(center, distance / this.lastPinchDistance);
      this.lastPinchDistance = distance;
    } else if (this.lastTouchCenter) {
      this.data.camera.x += center.x - this.lastTouchCenter.x;
      this.data.camera.y += center.y - this.lastTouchCenter.y;
    }
    this.lastTouchCenter = center;
    this.markDirty();
    this.scheduleRender();
  }
  onWheel(event) {
    event.preventDefault();
    const point = this.eventPoint(event);
    if (event.ctrlKey || event.metaKey) {
      this.zoomAt(point, Math.exp(-event.deltaY * 0.01));
    } else {
      this.data.camera.x -= event.deltaX;
      this.data.camera.y -= event.deltaY;
    }
    this.queueSave();
    this.scheduleRender();
  }
  zoomAt(screen2, factor) {
    const camera = this.data.camera;
    const oldZoom = camera.zoom;
    const newZoom = Math.min(8, Math.max(0.1, oldZoom * factor));
    const worldX = (screen2.x - camera.x) / oldZoom;
    const worldY = (screen2.y - camera.y) / oldZoom;
    camera.zoom = newZoom;
    camera.x = screen2.x - worldX * newZoom;
    camera.y = screen2.y - worldY * newZoom;
  }
  eraseAt(point) {
    const radius = this.plugin.settings.eraser.size / 2 / this.data.camera.zoom;
    const candidates = this.spatialIndex.query(this.data.elements, {
      minX: point.x - radius,
      minY: point.y - radius,
      maxX: point.x + radius,
      maxY: point.y + radius
    });
    const candidateIds = new Set(candidates.filter((element) => element.type === "stroke" && !element.locked).map((element) => element.id));
    if (!candidateIds.size) return;
    let changed = false;
    const elements = [];
    for (const element of this.data.elements) {
      if (element.type !== "stroke" || !candidateIds.has(element.id)) {
        elements.push(element);
        continue;
      }
      const result = this.plugin.settings.eraser.mode === "stroke" ? eraseWholeStrokeAt(element, point, radius) : eraseStrokeAt(element, point, radius, () => makeId("stroke"));
      if (!result.changed) {
        elements.push(element);
        continue;
      }
      changed = true;
      this.spatialIndex.replace(element.id, result.fragments);
      this.strokePathCache.delete(element.id);
      for (const fragment of result.fragments) {
        elements.push(fragment);
      }
    }
    if (!changed) return;
    this.data.elements = elements;
    this.activeInputPersistent = true;
    this.markDirty();
    this.scheduleRender();
  }
  eraseAlongPath(point) {
    const radius = this.plugin.settings.eraser.size / 2 / this.data.camera.zoom;
    for (const sample of sampleEraserPath(this.lastEraserPoint, point, radius * 0.7)) this.eraseAt(sample);
    this.lastEraserPoint = point;
  }
  pushHistory() {
    this.history.beginElements(this.data);
  }
  undo() {
    const previous = this.history.undo(this.data);
    if (previous === this.data) return;
    this.data = previous;
    this.selection.clear();
    this.strokePathCache.clear();
    this.rebuildSpatialIndex();
    this.queueSave();
    this.scheduleRender();
  }
  redo() {
    const next = this.history.redo(this.data);
    if (next === this.data) return;
    this.data = next;
    this.selection.clear();
    this.strokePathCache.clear();
    this.rebuildSpatialIndex();
    this.queueSave();
    this.scheduleRender();
  }
  onKeyDown(event) {
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
    } else if (command && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
    } else if (command && event.key.toLowerCase() === "d" && this.selection.selectedIds.size) {
      event.preventDefault();
      this.duplicateSelection();
    } else if (command && event.key.toLowerCase() === "c" && this.selection.selectedIds.size) {
      event.preventDefault();
      this.copySelection();
    } else if (command && event.key.toLowerCase() === "v" && this.elementClipboard.length) {
      event.preventDefault();
      this.pasteCopiedElements();
    } else if ((event.key === "Delete" || event.key === "Backspace") && this.selection.selectedIds.size) {
      event.preventDefault();
      this.deleteSelection();
    } else if (event.key === "Escape") {
      this.cancelSelection();
      this.selection.clear();
      this.scheduleRender();
    } else if (event.key === "1") this.setTool("select");
    else if (event.key === "2") this.setTool("hand");
    else if (event.key === "3") this.setTool("ballpoint");
    else if (event.key === "4") this.setTool("pen");
    else if (event.key === "5") this.setTool("highlighter");
    else if (event.key === "6") this.setTool("laser");
    else if (event.key === "7") this.setTool("eraser");
  }
  openImagePicker() {
    this.imageInput.value = "";
    try {
      if (typeof this.imageInput.showPicker === "function") this.imageInput.showPicker();
      else this.imageInput.click();
    } catch (e) {
      this.imageInput.click();
    }
  }
  async importFromClipboard() {
    const clipboard = navigator.clipboard;
    if (!(clipboard == null ? void 0 : clipboard.read)) {
      this.showNativePasteTarget();
      return;
    }
    try {
      const items = await clipboard.read();
      const files = [];
      for (const item of items) {
        for (const type of item.types.filter((value) => value.startsWith("image/"))) {
          const blob = await item.getType(type);
          files.push(new File([blob], `clipboard-${Date.now()}.${extensionForImageMime(type)}`, { type }));
        }
      }
      if (!files.length) {
        new import_obsidian3.Notice("\u526A\u8D34\u677F\u4E2D\u6CA1\u6709\u53EF\u7528\u7684\u56FE\u7247\u3002", 3500);
        return;
      }
      await this.importImages(files);
    } catch (error) {
      this.traceInput("clipboard-read-denied", error instanceof Error ? error.name : "unknown");
      this.showNativePasteTarget();
    }
  }
  async onPaste(event) {
    var _a, _b;
    const pastedIntoToolbar = event.target === this.canvasPasteTarget;
    if (pastedIntoToolbar) {
      event.preventDefault();
      this.hideCanvasPasteMenu();
      this.canvasPasteTarget.blur();
    }
    const data = event.clipboardData;
    const candidates = [
      ...Array.from((_a = data == null ? void 0 : data.files) != null ? _a : []),
      ...Array.from((_b = data == null ? void 0 : data.items) != null ? _b : []).map((item) => item.kind === "file" ? item.getAsFile() : null).filter((file) => file !== null)
    ];
    const unique = /* @__PURE__ */ new Map();
    for (const file of candidates) {
      if (file.type.startsWith("image/")) unique.set(`${file.name}:${file.size}:${file.type}`, file);
    }
    const files = [...unique.values()];
    if (event.target === this.canvasPasteProxy) this.traceInput("paste-event", `images=${files.length}`);
    if (!files.length) {
      if (pastedIntoToolbar || event.target === this.canvasPasteProxy) {
        event.preventDefault();
        new import_obsidian3.Notice("\u526A\u8D34\u677F\u4E2D\u6CA1\u6709\u53EF\u7C98\u8D34\u7684\u56FE\u7247\u3002", 3500);
      }
      if (event.target === this.canvasPasteProxy) this.releaseCanvasPasteProxy();
      return;
    }
    event.preventDefault();
    if (event.target === this.canvasPasteProxy) this.releaseCanvasPasteProxy();
    await this.importImages(files);
    this.hideCanvasPasteMenu();
  }
  registerImageDropTarget(target) {
    this.registerDomEvent(target, "dragover", (event) => {
      this.acceptImageDrop(event);
    });
    this.registerDomEvent(target, "drop", (event) => {
      this.receiveImageDrop(event);
    });
  }
  registerInputDocumentDropTarget(target) {
    this.registerDomEvent(target, "dragover", (event) => {
      this.acceptImageDrop(event);
    }, { capture: true });
    this.registerDomEvent(target, "drop", (event) => {
      this.receiveImageDrop(event);
      if (event.defaultPrevented) event.stopPropagation();
    }, { capture: true });
  }
  acceptImageDrop(event) {
    if (!acceptsFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }
  receiveImageDrop(event) {
    if (!acceptsFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    const files = imageFilesFromTransfer(event.dataTransfer);
    if (!files.length) {
      new import_obsidian3.Notice("\u5DF2\u6536\u5230\u5916\u90E8\u6587\u4EF6\uFF0C\u4F46\u7CFB\u7EDF\u672A\u63D0\u4F9B\u53EF\u5BFC\u5165\u7684\u56FE\u7247\u6570\u636E\u3002\u8BF7\u4F7F\u7528\u201C\u63D2\u5165\u56FE\u7247\u201D\u6216\u957F\u6309\u7C98\u8D34\u3002", 5e3);
      return;
    }
    void this.importImages(files, this.screenToWorld(this.eventPoint(event)));
  }
  async importImages(files, placement) {
    var _a, _b;
    if (!this.file || files.length === 0) return;
    const file = this.file;
    const session = this.boardSession.currentForFile(file);
    if (!session) return;
    const parent = (_b = (_a = file.parent) == null ? void 0 : _a.path) != null ? _b : "";
    const folder = (0, import_obsidian3.normalizePath)(`${parent}/${file.basename}.assets`);
    const importer = new ImageImportService({
      ensureFolder: async (path) => {
        if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path);
      },
      writeBinary: async (path, contents) => {
        await this.app.vault.createBinary(path, contents);
      }
    });
    const center = placement != null ? placement : this.screenToWorld({ x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 });
    const task = new ImageImportTask(this.boardSession, session, file, folder, center);
    this.imageImportTasks.add(task);
    let result;
    try {
      result = await importer.import({
        files,
        folderPath: task.folderPath,
        placement: task.placement,
        createId: makeId,
        now: () => (/* @__PURE__ */ new Date()).toISOString(),
        shouldContinue: () => task.active
      });
    } catch (error) {
      if (!task.active) {
        this.notifyInterruptedImageImport(task, 0);
        return;
      }
      console.error("Infinite Board: failed to create attachment folder", error);
      new import_obsidian3.Notice("\u65E0\u6CD5\u521B\u5EFA\u753B\u5E03\u9644\u4EF6\u76EE\u5F55\uFF0C\u56FE\u7247\u672A\u5BFC\u5165\u3002", 5e3);
      return;
    } finally {
      this.imageImportTasks.delete(task);
    }
    if (!task.active || result.cancelled) {
      this.notifyInterruptedImageImport(task, result.writtenPaths.length);
      return;
    }
    if (files.length > 1) new import_obsidian3.Notice(`\u6B63\u5728\u5BFC\u5165 ${files.length} \u5F20\u56FE\u7247\u2026`, 2500);
    for (const failure of result.failures) console.error("Infinite Board: image import failed", failure.file.name, failure.error);
    if (result.images.length > 0) {
      const startIndex = this.data.elements.length;
      const command = new InsertElementsCommand(
        result.images.map((element, index) => ({ index: startIndex + index, element })),
        "\u5BFC\u5165\u56FE\u7247"
      );
      this.data = command.execute(this.data);
      this.history.recordApplied(command);
      this.selection.setSelected(result.images.map((image) => image.id));
      for (const image of result.images) {
        this.boardAssets.refresh(image.path);
      }
      this.rebuildSpatialIndex();
      this.setTool("select");
      this.queueSave();
      this.scheduleRender();
      new import_obsidian3.Notice(`\u5DF2\u63D2\u5165 ${result.images.length} \u5F20\u56FE\u7247${result.failures.length ? `\uFF0C${result.failures.length} \u5F20\u5931\u8D25` : ""}\u3002`, 4e3);
    } else {
      new import_obsidian3.Notice("\u56FE\u7247\u5BFC\u5165\u5931\u8D25\uFF0C\u8BF7\u6362\u7528 PNG \u6216 JPEG \u540E\u91CD\u8BD5\u3002", 5e3);
    }
  }
  cancelImageImports(session) {
    for (const task of this.imageImportTasks) {
      if (!session || task.session === session) task.cancel();
    }
  }
  notifyInterruptedImageImport(task, writtenCount) {
    var _a, _b;
    if (writtenCount === 0) {
      new import_obsidian3.Notice(`\u753B\u677F ${task.file.path} \u7684\u56FE\u7247\u5BFC\u5165\u5DF2\u505C\u6B62\uFF0C\u672A\u5199\u5165\u9644\u4EF6\u3002`, 6e3);
      return;
    }
    const currentFolder = (0, import_obsidian3.normalizePath)(`${(_b = (_a = task.file.parent) == null ? void 0 : _a.path) != null ? _b : ""}/${task.file.basename}.assets`);
    const recovery = currentFolder === task.folderPath ? "\u53EF\u5728\u539F\u753B\u677F\u4F7F\u7528\u201C\u68C0\u67E5\u5E76\u6062\u590D\u5F53\u524D\u753B\u677F\u56FE\u7247\u201D\u3002" : "\u753B\u677F\u53EF\u80FD\u5DF2\u91CD\u547D\u540D\uFF0C\u8BF7\u4FDD\u7559\u65E7\u9644\u4EF6\u76EE\u5F55\u5E76\u6309\u8DEF\u5F84\u67E5\u627E\u3002";
    new import_obsidian3.Notice(`\u753B\u677F ${task.file.path} \u7684\u5BFC\u5165\u5DF2\u505C\u6B62\uFF1B${writtenCount} \u4E2A\u9644\u4EF6\u4FDD\u7559\u5728 ${task.folderPath}\u3002${recovery}`, 1e4);
  }
  async inspectAndRecoverImages() {
    const health = this.currentBoardHealth();
    if (!health) return;
    new ImageRecoveryModal(this.app, health, () => void this.recoverImagePaths(health.unlinkedPaths)).open();
  }
  currentBoardHealth() {
    var _a, _b;
    if (!this.file) return null;
    const folderPath = (0, import_obsidian3.normalizePath)(`${(_b = (_a = this.file.parent) == null ? void 0 : _a.path) != null ? _b : ""}/${this.file.basename}.assets`);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    const candidates = folder instanceof import_obsidian3.TFolder ? folder.children.filter((child) => child instanceof import_obsidian3.TFile && looksLikeImage(child.name)).map((child) => child.path) : [];
    const health = this.boardAssets.inspect(this.data.elements, candidates, (path) => this.app.vault.getAbstractFileByPath(path) instanceof import_obsidian3.TFile);
    return boardHealthSnapshot(this.file.stat.size, health);
  }
  async recoverImagePaths(paths) {
    if (!paths.length) return;
    const center = this.screenToWorld({ x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 });
    const columns = Math.max(1, Math.ceil(Math.sqrt(paths.length)));
    const cellWidth = 520;
    const cellHeight = 380;
    const recovered = [];
    for (let index = 0; index < paths.length; index += 1) {
      const file = this.app.vault.getAbstractFileByPath(paths[index]);
      if (!(file instanceof import_obsidian3.TFile)) continue;
      const dimensions = await readImageUrlDimensions(this.app.vault.getResourcePath(file));
      const scale = Math.min(1, 480 / Math.max(1, dimensions.width), 340 / Math.max(1, dimensions.height));
      const width = dimensions.width * scale;
      const height = dimensions.height * scale;
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = center.x + (column - (columns - 1) / 2) * cellWidth - width / 2;
      const y = center.y + row * cellHeight - height / 2;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      recovered.push({
        id: makeId("image"),
        type: "image",
        createdAt: now,
        updatedAt: now,
        path: file.path,
        x,
        y,
        width,
        height,
        rotation: 0,
        crop: { x: 0, y: 0, width: 1, height: 1 }
      });
    }
    if (!recovered.length) {
      new import_obsidian3.Notice("\u672A\u627E\u5230\u53EF\u6062\u590D\u7684\u56FE\u7247\u9644\u4EF6\u3002", 3500);
      return;
    }
    this.pushHistory();
    this.data.elements.push(...recovered);
    this.selection.setSelected(recovered.map((image) => image.id));
    for (const image of recovered) this.loadImage(image.path);
    this.rebuildSpatialIndex();
    this.setTool("select");
    this.queueSave();
    await this.saveNow();
    this.scheduleRender();
    new import_obsidian3.Notice(`\u5DF2\u6062\u590D ${recovered.length} \u5F20\u56FE\u7247\uFF0C\u5E76\u4FDD\u5B58\u5230\u5F53\u524D\u753B\u677F\u3002`, 5e3);
  }
  fitContent() {
    const bounds = this.contentBounds();
    if (!bounds) {
      this.data.camera = { x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2, zoom: 1 };
    } else {
      const padding = 80;
      const width = Math.max(1, bounds.maxX - bounds.minX);
      const height = Math.max(1, bounds.maxY - bounds.minY);
      const zoom = Math.min(3, Math.max(0.1, Math.min((this.canvas.clientWidth - padding * 2) / width, (this.canvas.clientHeight - padding * 2) / height)));
      this.data.camera.zoom = zoom;
      this.data.camera.x = this.canvas.clientWidth / 2 - (bounds.minX + width / 2) * zoom;
      this.data.camera.y = this.canvas.clientHeight / 2 - (bounds.minY + height / 2) * zoom;
    }
    this.queueSave();
    this.scheduleRender();
  }
  contentBounds() {
    const xs = [];
    const ys = [];
    for (const element of this.data.elements) {
      if (element.type === "stroke") {
        for (const point of element.points) {
          xs.push(point.x);
          ys.push(point.y);
        }
      } else {
        xs.push(element.x, element.x + element.width);
        ys.push(element.y, element.y + element.height);
      }
    }
    if (!xs.length) return null;
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  queueSave() {
    this.history.commit(this.data);
    this.markDirty();
    this.scheduleSave();
  }
  scheduleSave(delay = 1200) {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow(), delay);
  }
  markDirty(invalidateScene = true) {
    if (!this.saveState.markDirty(this.canSave)) return;
    if (invalidateScene) this.invalidateSceneCache();
    this.setSaveState("unsaved");
  }
  async saveNow() {
    window.clearTimeout(this.saveTimer);
    if (!this.file) return;
    const file = this.file;
    const session = this.boardSession.currentForFile(file);
    if (!session) return;
    const decision = this.saveState.decideSave(this.canSave, this.drawingPointer !== null || this.penPointer !== null);
    if (decision === "skip") return;
    if (decision === "defer-input") {
      this.scheduleSave(600);
      return;
    }
    if (decision === "defer-saving") return;
    const saveStartedAt = performance.now();
    this.traceInput("save-start", `revision=${this.revision} elements=${this.data.elements.length}`);
    this.setSaveState("saving");
    const revisionAtStart = this.revision;
    const operation = (async () => {
      try {
        const currentContent = await this.app.vault.read(file);
        if (!this.boardSession.isCurrent(session)) return;
        if (this.lastSavedContent && currentContent !== this.lastSavedContent) {
          await this.protectConflict("\u4FDD\u5B58\u524D\u68C0\u6D4B\u5230\u5176\u4ED6\u8BBE\u5907\u7684\u4FEE\u6539", session);
          return;
        }
        if (this.drawingPointer !== null || this.penPointer !== null) {
          this.saveState.requestResave();
          this.setSaveState("unsaved");
          return;
        }
        const savedAt = (/* @__PURE__ */ new Date()).toISOString();
        const savedRevision = advanceBoardRevision(this.data.revision);
        const content = serializeBoard({ ...this.data, updatedAt: savedAt, revision: savedRevision });
        this.saveState.beginWrite(content);
        await this.app.vault.modify(file, content);
        if (!this.boardSession.isCurrent(session)) return;
        this.data.updatedAt = savedAt;
        this.data.revision = savedRevision;
        this.saveState.completeWrite(content, revisionAtStart);
        this.setSaveState(this.dirty ? "unsaved" : "saved");
      } catch (error) {
        if (!this.boardSession.isCurrent(session)) return;
        console.error("Infinite Board: save failed", error);
        this.saveState.failWrite();
        this.setSaveState("error");
        new import_obsidian3.Notice("\u65E0\u9650\u753B\u5E03\u4FDD\u5B58\u5931\u8D25\uFF0C\u5185\u5BB9\u4ECD\u4FDD\u7559\u5728\u5F53\u524D\u89C6\u56FE\u4E2D\u3002", 5e3);
      } finally {
        if (this.boardSession.isCurrent(session)) {
          this.lastSaveDuration = performance.now() - saveStartedAt;
          this.maxSaveDuration = Math.max(this.maxSaveDuration, this.lastSaveDuration);
          this.traceInput("save-end", `duration=${Math.round(this.lastSaveDuration)}ms dirty=${this.dirty ? 1 : 0}`);
          this.scheduleDiagnostics();
          if (this.saveState.finishSave()) this.scheduleSave(500);
        }
      }
    })();
    await this.saveFlights.track(session, operation);
  }
  async onExternalModify(file) {
    const session = this.boardSession.currentForPath(file.path);
    if (!session || !this.file || file.path !== this.file.path || this.conflictDetected) return;
    window.clearTimeout(this.externalCheckTimer);
    this.externalCheckTimer = window.setTimeout(() => void this.checkExternalModify(file, session), 120);
  }
  async checkExternalModify(file, session) {
    if (!this.boardSession.isCurrent(session) || !this.file || file.path !== this.file.path || this.conflictDetected) return;
    try {
      const raw = await this.app.vault.read(file);
      if (!this.boardSession.isCurrent(session) || !this.file || file.path !== this.file.path || this.conflictDetected) return;
      const decision = this.saveState.classifyExternal(raw);
      if (decision === "ignore") return;
      if (decision === "conflict") {
        await this.protectConflict("Obsidian Sync \u66F4\u65B0\u4E0E\u672C\u5730\u672A\u4FDD\u5B58\u5185\u5BB9\u91CD\u53E0", session);
        return;
      }
      const external = parseBoard(raw);
      const updateDecision = externalBoardUpdateDecision(this.data.revision, external.revision);
      if (updateDecision === "protect-older") {
        await this.protectConflict("\u68C0\u6D4B\u5230\u8F83\u65E7\u7684\u540C\u6B65\u7248\u672C\uFF0C\u5F53\u524D\u753B\u677F\u672A\u88AB\u8986\u76D6", session);
        return;
      }
      if (updateDecision === "protect-diverged") {
        await this.protectConflict("\u68C0\u6D4B\u5230\u5E76\u884C\u4FEE\u6539\u7684\u540C\u6B65\u7248\u672C\uFF0C\u5F53\u524D\u753B\u677F\u672A\u88AB\u8986\u76D6", session);
        return;
      }
      if (updateDecision === "protect-inconsistent") {
        await this.protectConflict("\u540C\u6B65\u7248\u672C\u5185\u5BB9\u4E0E\u7248\u672C\u6807\u8BC6\u4E0D\u4E00\u81F4\uFF0C\u5F53\u524D\u753B\u677F\u672A\u88AB\u8986\u76D6", session);
        return;
      }
      this.data = external;
      this.rebuildSpatialIndex();
      this.saveState.acceptExternal(raw);
      this.history.clear();
      this.selection.clear();
      this.strokePathCache.clear();
      this.invalidateSceneCache();
      this.boardAssets.release();
      this.setSaveState("saved", "\u5DF2\u8F7D\u5165\u540C\u6B65\u66F4\u65B0");
      this.scheduleRender();
    } catch (error) {
      if (!this.boardSession.isCurrent(session)) return;
      console.error("Infinite Board: external update failed", error);
      this.setSaveState("error", "\u65E0\u6CD5\u8BFB\u53D6\u540C\u6B65\u66F4\u65B0");
    }
  }
  async protectConflict(reason, session) {
    var _a, _b;
    if (!this.boardSession.isCurrent(session) || !this.file || this.conflictDetected) return;
    this.saveState.detectConflict();
    this.canSave = false;
    window.clearTimeout(this.saveTimer);
    const parent = (_b = (_a = this.file.parent) == null ? void 0 : _a.path) != null ? _b : "";
    const stamp = window.moment().format("YYYY-MM-DD HH-mm-ss");
    const conflictPath = (0, import_obsidian3.normalizePath)(`${parent}/${this.file.basename} (\u672C\u5730\u51B2\u7A81 ${stamp}).${BOARD_EXTENSION}`);
    const snapshot = cloneBoard(this.data);
    snapshot.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    snapshot.revision = createBoardRevision();
    try {
      await this.app.vault.create(conflictPath, serializeBoard(snapshot));
      if (!this.boardSession.isCurrent(session)) return;
      this.conflictRecovery.record(conflictPath);
      this.setSaveState("conflict", "\u672C\u5730\u5185\u5BB9\u5DF2\u53E6\u5B58");
      new import_obsidian3.Notice(`${reason}\u3002\u672C\u5730\u5185\u5BB9\u5DF2\u4FDD\u5B58\u4E3A\uFF1A${conflictPath}`, 9e3);
    } catch (error) {
      if (!this.boardSession.isCurrent(session)) return;
      this.conflictRecovery.clear();
      console.error("Infinite Board: conflict backup failed", error);
      this.setSaveState("error", "\u51B2\u7A81\u526F\u672C\u521B\u5EFA\u5931\u8D25");
      new import_obsidian3.Notice("\u68C0\u6D4B\u5230\u540C\u6B65\u51B2\u7A81\uFF0C\u4F46\u51B2\u7A81\u526F\u672C\u521B\u5EFA\u5931\u8D25\u3002\u8BF7\u52FF\u5173\u95ED\u5F53\u524D\u753B\u5E03\u3002", 9e3);
    }
  }
  async createRecoveryCopy(label) {
    var _a, _b;
    if (!this.file) throw new Error("\u5F53\u524D\u753B\u677F\u5DF2\u5173\u95ED\uFF0C\u65E0\u6CD5\u521B\u5EFA\u6062\u590D\u526F\u672C\u3002");
    const parent = (_b = (_a = this.file.parent) == null ? void 0 : _a.path) != null ? _b : "";
    const stamp = window.moment().format("YYYY-MM-DD HH-mm-ss");
    let path = (0, import_obsidian3.normalizePath)(`${parent}/${this.file.basename} (${label} ${stamp}).${BOARD_EXTENSION}`);
    if (this.app.vault.getAbstractFileByPath(path)) {
      path = (0, import_obsidian3.normalizePath)(`${parent}/${this.file.basename} (${label} ${stamp} ${makeId("copy")}).${BOARD_EXTENSION}`);
    }
    const snapshot = cloneBoard(this.data);
    snapshot.revision = createBoardRevision();
    await this.app.vault.create(path, serializeBoard(snapshot));
    new import_obsidian3.Notice(`\u6062\u590D\u526F\u672C\u5DF2\u4FDD\u5B58\u4E3A\uFF1A${path}`, 7e3);
    return path;
  }
  eventPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  screenToWorld(point) {
    const camera = this.data.camera;
    return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
  }
  makePoint(point, event, fallbackPressure = 0.25) {
    return {
      x: point.x,
      y: point.y,
      pressure: event.pressure > 0 ? event.pressure : fallbackPressure,
      time: event.timeStamp
    };
  }
  center(points) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length
    };
  }
  distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
};
