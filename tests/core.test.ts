import assert from "node:assert/strict";
import { cloneBoard, emptyBoard, parseBoard } from "../src/model/board";
import { SCHEMA_VERSION } from "../src/model/types";
import { mergeSettings } from "../src/plugin/settings";
import { pressureScale, smoothCenterline, stabilizePressure } from "../src/rendering/stroke-geometry";
import { strokeCompositeOperation } from "../src/rendering/stroke-paint";
import { appendLaserPoint, createLaserStroke, isLaserExpired, laserAlpha } from "../src/tools/laser-state";
import { SnapshotHistory } from "../src/history/snapshot-history";
import { Command, CommandHistory } from "../src/history/command-history";
import { BoardHistory, HISTORY_MEMORY_BUDGET_BYTES } from "../src/history/board-history";
import { isExternalContent, serializeBoard } from "../src/persistence/serialization";
import { boundsIntersect, elementBounds, elementIntersectsBounds, elementIntersectsLasso, hitTestElement, imageCropHandlePoints, imageRotationHandlePoint, resizeImageFromHandle, scaleElementFromAnchor, translateElement } from "../src/selection/geometry";
import { BoardImage, Stroke } from "../src/model/types";
import { alignElements, cropImage, cropImageFromHandle, distributeElements, reorderElements, resetImageCrop, rotateImage, rotateImageToPoint } from "../src/selection/operations";
import { findStylusTouch, isStylusOnlyTouchList, isStylusPointer, shouldRecoverMissingStylus, shouldRecoverPenPointerMove, shouldStartStylusTouchFallback, usesCanvasPointerCapture, usesNativeStylusTouch } from "../src/platform/stylus";
import { SelectionController } from "../src/selection/controller";
import { DeleteElementsCommand, InsertElementsCommand, ReorderElementsCommand, UpdateElementsCommand } from "../src/history/element-commands";
import { ElementSpatialIndex } from "../src/rendering/spatial-index";
import { LaserController } from "../src/tools/laser-controller";
import { planToolTransition, ToolController, ToolControllerRegistry } from "../src/tools/registry";
import { eraseStrokeAt, eraseWholeStrokeAt, sampleEraserPath } from "../src/tools/stroke-eraser";
import { InputFlightRecorder } from "../src/platform/input-flight-recorder";
import { BUILD_FINGERPRINT, RUNTIME_VERSION, runtimeMatchesManifest } from "../src/platform/runtime-integrity";
import { InputToolMetrics } from "../src/platform/input-tool-metrics";
import { canReuseSceneCache, sceneCacheKey } from "../src/rendering/scene-cache";
import { SceneCache } from "../src/rendering/scene-cache";
import { RenderMetrics } from "../src/rendering/render-metrics";
import { SceneRenderer } from "../src/rendering/scene-renderer";
import { BoardSaveState } from "../src/persistence/save-state";
import { ConflictRecoveryState } from "../src/persistence/conflict-recovery";
import { BoardSaveFlights, BoardSession } from "../src/persistence/board-session";
import { externalBoardUpdateDecision } from "../src/persistence/external-update";
import { acceptsFileTransfer, acceptsImageTransfer, extensionForImageMime, imageFilesFromTransfer, ImageAssetCache, looksLikeImage, referencesImagePath, unreferencedImagePaths } from "../src/assets/image-assets";
import { ImageImportService } from "../src/assets/image-import-service";
import { ImageImportTask } from "../src/assets/image-import-task";
import { BoardAssetCoordinator } from "../src/assets/board-asset-coordinator";
import { boardHealthSnapshot } from "../src/assets/board-health";
import { persistedCameraResizeDelta } from "../src/platform/canvas-resize";
import { diagnosticCounterSnapshot } from "../src/platform/diagnostic-snapshot";
import { normalizedBoardName } from "../src/model/board-file-name";
import { advanceBoardRevision, compareBoardRevisions, createBoardRevision } from "../src/model/revision";
import { supportsPhoneFingerDrawing } from "../src/ui/touch-controls";
import { bindPhoneToolbarSwipe, PhoneRailSwipe } from "../src/ui/phone-rail-swipe";
import { pasteMenuPointFromClient, pasteMenuPosition, useSystemPasteTarget } from "../src/ui/canvas-paste-position";
import { RapidTapSequence } from "../src/ui/rapid-tap-sequence";
import { inferredColorSource, isColorTool, MORE_COLORS, TOOLBAR_PRESET_COLORS } from "../src/ui/creative-toolbar";
import { test } from "./test-harness";

test("iPad clipboard fallback uses a system-editable target; other platforms keep the clipboard action", () => {
  assert.equal(useSystemPasteTarget(true, true), true);
  assert.equal(useSystemPasteTarget(true, false), false);
  assert.equal(useSystemPasteTarget(false, true), false);
});

test("rapid status tap sequence triggers on the fifth tap and resets after a pause", () => {
  const taps = new RapidTapSequence(5, 1500);
  for (let index = 0; index < 4; index += 1) assert.equal(taps.register(index * 180), false);
  assert.equal(taps.register(720), true);
  assert.equal(taps.register(900), false);
  assert.equal(taps.register(2600), false);
});

test("paste control stays in the View and prefers space above the touch", () => {
  assert.deepEqual(pasteMenuPointFromClient({ x: 300, y: 220 }, { x: 100, y: 50 }), { x: 200, y: 170 });
  assert.deepEqual(pasteMenuPointFromClient({ x: 200, y: 100 }, { x: 100, y: 50 }, { x: 130, y: 90 }), { x: 230, y: 140 });
  assert.deepEqual(pasteMenuPosition({ x: 200, y: 220 }, { width: 180, height: 52 }, { width: 400, height: 300 }), { x: 110, y: 156 });
  assert.deepEqual(pasteMenuPosition({ x: 390, y: 8 }, { width: 180, height: 52 }, { width: 400, height: 300 }), { x: 210, y: 20 });
  assert.deepEqual(pasteMenuPosition({ x: 0, y: 290 }, { width: 180, height: 52 }, { width: 220, height: 300 }), { x: 10, y: 226 });
});

test("save state tracks revisions and only clears the completed revision", () => {
  const state = new BoardSaveState();
  state.initialize("base");
  assert.equal(state.markDirty(true), true);
  assert.equal(state.snapshot().revision, 1);
  assert.equal(state.decideSave(true, false), "start");
  const revisionAtStart = state.snapshot().revision;
  state.beginWrite("first");
  state.markDirty(true);
  state.completeWrite("first", revisionAtStart);
  assert.equal(state.snapshot().dirty, true);
  assert.equal(state.finishSave(), true);
});

test("save state defers active input and requests another save while saving", () => {
  const state = new BoardSaveState();
  state.initialize("base");
  state.markDirty(true);
  assert.equal(state.decideSave(true, true), "defer-input");
  assert.equal(state.decideSave(true, false), "start");
  assert.equal(state.decideSave(true, false), "defer-saving");
  assert.equal(state.snapshot().resaveRequested, true);
});

test("save state ignores its own pending write and protects overlapping Sync updates", () => {
  const state = new BoardSaveState();
  state.initialize("base");
  state.markDirty(true);
  assert.equal(state.decideSave(true, false), "start");
  state.beginWrite("pending");
  assert.equal(state.classifyExternal("pending"), "ignore");
  assert.equal(state.classifyExternal("remote"), "conflict");
  state.detectConflict();
  assert.equal(state.markDirty(true), false);
});

test("clean save state accepts an external Sync reload", () => {
  const state = new BoardSaveState();
  state.initialize("base");
  assert.equal(state.classifyExternal("remote"), "reload");
  state.acceptExternal("remote");
  assert.equal(state.classifyExternal("remote"), "ignore");
});

test("board revision ancestry accepts newer Sync content and protects old or parallel branches", () => {
  const base = createBoardRevision();
  const newer = advanceBoardRevision(base);
  const newest = advanceBoardRevision(newer);
  const sibling = advanceBoardRevision(base);
  assert.equal(compareBoardRevisions(base, newer), "newer");
  assert.equal(compareBoardRevisions(newest, newer), "older");
  assert.equal(compareBoardRevisions(newer, sibling), "diverged");
  assert.equal(compareBoardRevisions(newer, createBoardRevision()), "unrelated");
});

test("external board updates reload only a causal successor", () => {
  const base = createBoardRevision();
  const newer = advanceBoardRevision(base);
  const sibling = advanceBoardRevision(base);
  assert.equal(externalBoardUpdateDecision(base, newer), "reload");
  assert.equal(externalBoardUpdateDecision(newer, base), "protect-older");
  assert.equal(externalBoardUpdateDecision(newer, sibling), "protect-diverged");
  assert.equal(externalBoardUpdateDecision(newer, createBoardRevision()), "protect-diverged");
  assert.equal(externalBoardUpdateDecision(newer, newer), "protect-inconsistent");
});

test("schema v4 boards migrate to a stable schema-v5 revision and preserve it through serialization", () => {
  const migrated = parseBoard(JSON.stringify({
    schemaVersion: 4,
    updatedAt: "2026-09-23T00:00:00.000Z",
    camera: { x: 0, y: 0, zoom: 1 },
    elements: []
  }));
  assert.equal(migrated.schemaVersion, 5);
  assert.ok(migrated.revision.documentId.startsWith("legacy-board-"));
  const roundTrip = parseBoard(serializeBoard(migrated));
  assert.deepEqual(roundTrip.revision, migrated.revision);
});

test("failed writes remain dirty and a conflict blocks all later save starts", () => {
  const state = new BoardSaveState();
  state.initialize("base");
  state.markDirty(true);
  assert.equal(state.decideSave(true, false), "start");
  state.beginWrite("pending");
  state.failWrite();
  assert.equal(state.snapshot().pendingWriteContent, "");
  assert.equal(state.snapshot().dirty, true);
  assert.equal(state.finishSave(), true);
  state.detectConflict();
  assert.equal(state.decideSave(true, false), "skip");
});

test("conflict recovery exposes only the copy recorded for the current board", () => {
  const recovery = new ConflictRecoveryState();
  assert.equal(recovery.currentPath, null);
  recovery.record("Infinite Boards/demo 本地冲突 2026-09-24.board");
  assert.equal(recovery.currentPath, "Infinite Boards/demo 本地冲突 2026-09-24.board");
  recovery.clear();
  assert.equal(recovery.currentPath, null);
});

test("stale board work cannot become current after a switch or a same-path reopen", async () => {
  const sessions = new BoardSession();
  const firstFile = { path: "Boards/one.board" };
  const first = sessions.begin(firstFile);
  let finishRead: (() => void) | undefined;
  const oldRead = new Promise<void>((resolve) => { finishRead = resolve; });
  const secondFile = { path: "Boards/two.board" };
  const second = sessions.begin(secondFile);
  finishRead?.();
  await oldRead;
  assert.equal(sessions.isCurrent(first), false);
  assert.equal(sessions.currentForPath("Boards/one.board"), null);
  sessions.end(first);
  assert.equal(sessions.isCurrent(second), true);
  const reopened = sessions.begin({ path: "Boards/two.board" });
  assert.equal(sessions.isCurrent(second), false);
  assert.equal(sessions.isCurrent(reopened), true);
  reopened.file.path = "Boards/renamed.board";
  assert.equal(sessions.currentForPath("Boards/two.board"), null);
  assert.equal(sessions.currentForPath("Boards/renamed.board"), reopened);
  assert.equal(sessions.currentForFile(reopened.file), reopened);
  sessions.end(reopened);
  assert.equal(sessions.currentForPath("Boards/renamed.board"), null);
});

test("board unload waits only for its own in-flight save", async () => {
  const sessions = new BoardSession();
  const first = sessions.begin({ path: "Boards/one.board" });
  const second = sessions.begin({ path: "Boards/two.board" });
  const flights = new BoardSaveFlights();
  let finishWrite: (() => void) | undefined;
  const write = new Promise<void>((resolve) => { finishWrite = resolve; });
  const tracked = flights.track(first, write);
  let completed = false;
  const waiting = flights.wait(first).then(() => { completed = true; });
  await flights.wait(second);
  assert.equal(completed, false);
  finishWrite?.();
  await Promise.all([tracked, waiting]);
  assert.equal(completed, true);
  await flights.wait(first);
});

test("image helpers normalize MIME types and recognize supported file names", () => {
  assert.equal(extensionForImageMime("IMAGE/JPEG"), "jpg");
  assert.equal(extensionForImageMime("image/heic"), "heic");
  assert.equal(extensionForImageMime("application/octet-stream"), "png");
  assert.equal(looksLikeImage("Screenshot.JPEG"), true);
  assert.equal(looksLikeImage("notes.pdf"), false);
  assert.equal(referencesImagePath([{ type: "stroke" }, { type: "image", path: "board.assets/a.png" }], "board.assets/a.png"), true);
  assert.equal(referencesImagePath([{ type: "image", path: "board.assets/a.png" }], "board.assets/b.png"), false);
  assert.deepEqual(unreferencedImagePaths(
    [{ type: "image", path: "board.assets/a.png" }],
    ["board.assets/a.png", "board.assets/b.jpg", "board.assets/readme.txt"]
  ), ["board.assets/b.jpg"]);
});

test("image import service writes attachments and leaves board mutation to its caller", async () => {
  const folders: string[] = [];
  const writes: Array<{ path: string; contents: ArrayBuffer }> = [];
  const service = new ImageImportService({
    ensureFolder: async (path) => { folders.push(path); },
    writeBinary: async (path, contents) => { writes.push({ path, contents }); }
  }, async () => ({ width: 1440, height: 900 }));
  const file = { name: "Screenshot.PNG", type: "image/png", arrayBuffer: async () => new ArrayBuffer(4) };
  const rejected = { name: "notes.txt", type: "text/plain", arrayBuffer: async () => new ArrayBuffer(1) };
  let id = 0;
  const result = await service.import({
    files: [file, rejected], folderPath: "Boards/demo.assets", placement: { x: 100, y: 200 },
    createId: (prefix) => `${prefix}-${++id}`, now: () => "2026-09-23T00:00:00.000Z"
  });
  assert.deepEqual(folders, ["Boards/demo.assets"]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "Boards/demo.assets/image-1.png");
  assert.equal(result.failures.length, 1);
  assert.equal(result.cancelled, false);
  assert.deepEqual(result.writtenPaths, ["Boards/demo.assets/image-1.png"]);
  assert.deepEqual(result.images, [{
    id: "image-2", type: "image", createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
    path: "Boards/demo.assets/image-1.png", x: -260, y: -25, width: 720, height: 450, rotation: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 }
  }]);
});

test("image import stops after an in-flight attachment write and keeps it recoverable", async () => {
  const writes: string[] = [];
  let finishWrite: (() => void) | undefined;
  let writeStarted: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { finishWrite = resolve; });
  const started = new Promise<void>((resolve) => { writeStarted = resolve; });
  const service = new ImageImportService({
    ensureFolder: async () => {},
    writeBinary: async (path) => {
      writes.push(path);
      writeStarted?.();
      await gate;
    }
  }, async () => ({ width: 800, height: 600 }));
  const sessions = new BoardSession();
  const file = { path: "Boards/demo.board", basename: "demo", parent: { path: "Boards" } };
  const session = sessions.begin(file);
  const task = new ImageImportTask(sessions, session, file, "Boards/demo.assets", { x: 50, y: 60 });
  const files = ["one.png", "two.png", "three.png"].map((name) => ({
    name, type: "image/png", arrayBuffer: async () => new ArrayBuffer(4)
  }));
  let id = 0;
  const importing = service.import({
    files, folderPath: task.folderPath, placement: task.placement,
    createId: () => `image-${++id}`, now: () => "2026-09-23T00:00:00.000Z",
    shouldContinue: () => task.active
  });
  await started;
  task.cancel();
  finishWrite?.();
  const result = await importing;
  assert.equal(result.cancelled, true);
  assert.equal(result.images.length, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(writes.length, 1);
  assert.deepEqual(result.writtenPaths, writes);
  assert.equal(task.active, false);
});

test("image import cancelled before starting does not create an attachment folder", async () => {
  let folders = 0;
  const service = new ImageImportService({
    ensureFolder: async () => { folders += 1; },
    writeBinary: async () => { throw new Error("unexpected write"); }
  }, async () => ({ width: 1, height: 1 }));
  const result = await service.import({
    files: [{ name: "photo.png", type: "image/png", arrayBuffer: async () => new ArrayBuffer(1) }],
    folderPath: "Boards/demo.assets", placement: { x: 0, y: 0 },
    createId: () => "id", now: () => "2026-09-23T00:00:00.000Z", shouldContinue: () => false
  });
  assert.equal(folders, 0);
  assert.deepEqual(result.images, []);
  assert.deepEqual(result.writtenPaths, []);
  assert.equal(result.cancelled, true);
});

test("failed attachment writes never produce a board image reference", async () => {
  const service = new ImageImportService({
    ensureFolder: async () => {},
    writeBinary: async () => { throw new Error("disk full"); }
  }, async () => ({ width: 800, height: 600 }));
  const result = await service.import({
    files: [{ name: "photo.png", type: "image/png", arrayBuffer: async () => new ArrayBuffer(2) }],
    folderPath: "Boards/demo.assets", placement: { x: 0, y: 0 },
    createId: () => "image-id", now: () => "2026-09-23T00:00:00.000Z"
  });
  assert.equal(result.cancelled, false);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.images, []);
  assert.deepEqual(result.writtenPaths, []);
});

test("board asset coordinator reports health and refreshes a referenced Sync attachment", () => {
  const retries: Array<() => void> = [];
  const coordinator = new BoardAssetCoordinator({
    resourceUrl: () => null,
    onImageReady: () => undefined,
    scheduler: { schedule: (callback) => { retries.push(callback); return retries.length; }, cancel: () => undefined }
  });
  const health = coordinator.inspect(
    [{ type: "image", path: "Boards/demo.assets/a.png" }, { type: "stroke" }],
    ["Boards/demo.assets/a.png", "Boards/demo.assets/b.jpg", "Boards/demo.assets/readme.txt"],
    (path) => path === "Boards/demo.assets/a.png"
  );
  assert.deepEqual(health, {
    referencedPaths: ["Boards/demo.assets/a.png"], missing: 0, unlinkedPaths: ["Boards/demo.assets/b.jpg"]
  });
  assert.equal(coordinator.onVaultFile("Boards/demo.assets/a.png", [{ type: "image", path: "Boards/demo.assets/a.png" }]), true);
  assert.equal(retries.length, 1);
  assert.equal(coordinator.onVaultFile("Boards/demo.assets/other.png", [{ type: "image", path: "Boards/demo.assets/a.png" }]), false);
  coordinator.release();
});

test("board assets decode only visible references and defer offscreen Sync attachments", () => {
  const images: Array<{ src: string; naturalWidth: number; naturalHeight: number; onload: (() => void) | null; onerror: (() => void) | null }> = [];
  const coordinator = new BoardAssetCoordinator({
    resourceUrl: (path) => `resource:${path}`,
    onImageReady: () => undefined,
    createImage: () => {
      const image = { src: "", naturalWidth: 1920, naturalHeight: 1080, onload: null, onerror: null };
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
    scheduler: { schedule: () => 1, cancel: () => undefined },
    cacheLimits: { maxImages: 1, maxDecodedBytes: 64 * 1024 * 1024 }
  });
  const references = [
    { type: "image", path: "Boards/demo.assets/a.png" },
    { type: "image", path: "Boards/demo.assets/b.png" }
  ];
  coordinator.updateVisible([references[0]]);
  assert.equal(images.length, 1);
  assert.equal(coordinator.onVaultFile(references[1].path, references), true);
  assert.equal(images.length, 1);
  coordinator.updateVisible([references[1]]);
  assert.equal(images.length, 2);
  assert.equal(coordinator.get(references[0].path), undefined);
  assert.equal(coordinator.get(references[1].path)?.naturalWidth, 1920);
  coordinator.release();
});

test("offscreen attachment updates discard stale decoded content before the next viewport", () => {
  const images: Array<{ src: string; naturalWidth: number; naturalHeight: number; onload: (() => void) | null; onerror: (() => void) | null }> = [];
  const path = "Boards/demo.assets/updated.png";
  const elements = [{ type: "image", path }];
  const coordinator = new BoardAssetCoordinator({
    resourceUrl: () => "resource:updated.png",
    onImageReady: () => undefined,
    createImage: () => {
      const image = { src: "", naturalWidth: images.length === 0 ? 100 : 200, naturalHeight: 100, onload: null, onerror: null };
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
    scheduler: { schedule: () => 1, cancel: () => undefined }
  });
  coordinator.updateVisible(elements);
  images[0].onload?.();
  coordinator.updateVisible([]);
  assert.equal(coordinator.onVaultFile(path, elements), true);
  assert.equal(images[0].src, "");
  assert.equal(coordinator.get(path), undefined);
  assert.equal(images.length, 1, "an offscreen update must not decode immediately");
  coordinator.updateVisible(elements);
  assert.equal(images.length, 2);
  assert.equal(coordinator.get(path)?.naturalWidth, 200);
  coordinator.release();
});

test("a visible Sync attachment arriving later retries its original image without downscaling", () => {
  let available = false;
  let ready = 0;
  const cancelled: number[] = [];
  const images: Array<{ src: string; naturalWidth: number; naturalHeight: number; onload: (() => void) | null; onerror: (() => void) | null }> = [];
  const path = "Boards/demo.assets/late.png";
  const coordinator = new BoardAssetCoordinator({
    resourceUrl: () => available ? "resource:late.png" : null,
    onImageReady: () => { ready += 1; },
    createImage: () => {
      const image = { src: "", naturalWidth: 4096, naturalHeight: 2048, onload: null, onerror: null };
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
    scheduler: { schedule: () => 7, cancel: (timer) => { cancelled.push(timer); } }
  });
  const elements = [{ type: "image", path }];
  coordinator.updateVisible(elements);
  assert.equal(coordinator.cacheStats.pendingRetries, 1);
  available = true;
  assert.equal(coordinator.onVaultFile(path, elements), true);
  assert.deepEqual(cancelled, [7]);
  assert.equal(images.length, 1);
  images[0].onload?.();
  assert.equal(coordinator.get(path)?.naturalWidth, 4096);
  assert.equal(ready, 1);
  coordinator.release();
});

test("board health snapshot centralizes attachment diagnostics without retaining mutable arrays", () => {
  const paths = ["Boards/demo.assets/orphan.png"];
  const snapshot = boardHealthSnapshot(123.9, { referencedPaths: ["Boards/demo.assets/a.png"], missing: 1, unlinkedPaths: paths });
  paths.push("Boards/demo.assets/later.png");
  assert.deepEqual(snapshot, { boardBytes: 123, referencedImages: 1, missingImages: 1, unlinkedPaths: ["Boards/demo.assets/orphan.png"] });
});

test("startup canvas resizes do not create persisted camera edits", () => {
  assert.equal(persistedCameraResizeDelta({ width: 400, height: 300 }, { width: 600, height: 500 }, false), null);
  assert.deepEqual(persistedCameraResizeDelta({ width: 400, height: 300 }, { width: 600, height: 500 }, true), { x: 100, y: 100 });
  assert.equal(persistedCameraResizeDelta({ width: 400, height: 300 }, { width: 400, height: 300 }, true), null);
});

test("image transfer accepts iOS image drags before their File becomes available", () => {
  const image = { name: "photo.heic", size: 42, type: "image/heic" } as File;
  assert.equal(acceptsImageTransfer({ items: [{ kind: "file", type: "image/heic", getAsFile: () => null }] }), true);
  assert.equal(acceptsImageTransfer({ items: [{ kind: "file", type: "text/plain", getAsFile: () => null }] }), false);
  assert.deepEqual(imageFilesFromTransfer({
    files: [image],
    items: [{ kind: "file", type: "image/heic", getAsFile: () => image }]
  }), [image]);
});

test("file transfer accepts iPad split-view drags before the image MIME is available", () => {
  assert.equal(acceptsFileTransfer({ types: ["Files"], items: [] }), true);
  assert.equal(acceptsFileTransfer({ items: [{ kind: "file", type: "", getAsFile: () => null }] }), true);
  assert.equal(acceptsFileTransfer({ types: ["text/plain"], items: [] }), false);
});

test("image cache reuses decoded resources and releases handlers", () => {
  let created = 0;
  let ready = 0;
  const images: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null }> = [];
  const cache = new ImageAssetCache(
    { resourceUrl: (path) => path === "missing" ? null : `resource:${path}`, onReady: () => { ready += 1; } },
    () => {
      created += 1;
      const image = { src: "", onload: null, onerror: null };
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
    { schedule: () => 1, cancel: () => undefined }
  );
  cache.load("a.png");
  cache.load("a.png");
  cache.load("missing");
  assert.equal(created, 1);
  assert.equal(cache.get("a.png"), images[0] as unknown as HTMLImageElement);
  images[0].onload?.();
  assert.equal(ready, 1);
  cache.release();
  assert.equal(cache.get("a.png"), undefined);
  assert.equal(images[0].onload, null);
  assert.equal(images[0].onerror, null);
  assert.equal(images[0].src, "");
});

test("image cache retains visible full-resolution images and evicts offscreen entries by decoded budget", () => {
  const images: Array<{ src: string; naturalWidth: number; naturalHeight: number; onload: (() => void) | null; onerror: (() => void) | null }> = [];
  const cache = new ImageAssetCache(
    { resourceUrl: (path) => `resource:${path}`, onReady: () => undefined },
    () => {
      const image = { src: "", naturalWidth: 4, naturalHeight: 4, onload: null, onerror: null };
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
    { schedule: () => 1, cancel: () => undefined },
    { maxImages: 2, maxDecodedBytes: 64 }
  );
  cache.retainVisible(["visible.png"]);
  images[0].onload?.();
  cache.load("offscreen.png");
  images[1].onload?.();
  assert.equal(cache.get("visible.png"), images[0] as unknown as HTMLImageElement);
  assert.equal(cache.get("offscreen.png"), undefined);
  assert.equal(images[1].src, "");
  assert.deepEqual(cache.stats, { entries: 1, estimatedBytes: 64, visibleEntries: 1, pendingRetries: 0 });

  cache.retainVisible(["next.png"]);
  assert.equal(images.length, 3);
  images[2].onload?.();
  assert.equal(cache.get("visible.png"), undefined);
  assert.equal(cache.get("next.png"), images[2] as unknown as HTMLImageElement);
  assert.equal(images[2].naturalWidth, 4);
  assert.deepEqual(cache.stats, { entries: 1, estimatedBytes: 64, visibleEntries: 1, pendingRetries: 0 });
});

test("image cache also bounds the count of undecoded offscreen images", () => {
  const cache = new ImageAssetCache(
    { resourceUrl: (path) => `resource:${path}`, onReady: () => undefined },
    () => ({ src: "", onload: null, onerror: null } as unknown as HTMLImageElement),
    { schedule: () => 1, cancel: () => undefined },
    { maxImages: 2, maxDecodedBytes: Number.POSITIVE_INFINITY }
  );
  cache.retainVisible(["visible.png"]);
  cache.load("old.png");
  cache.load("new.png");
  assert.equal(cache.get("visible.png") !== undefined, true);
  assert.equal(cache.get("old.png"), undefined);
  assert.equal(cache.get("new.png") !== undefined, true);
  assert.equal(cache.stats.entries, 2);
  cache.release();
});

test("all visible images retain original dimensions even when they exceed the soft cache budget", () => {
  const images: Array<{ src: string; naturalWidth: number; naturalHeight: number; onload: (() => void) | null; onerror: (() => void) | null }> = [];
  const cache = new ImageAssetCache(
    { resourceUrl: (path) => `resource:${path}`, onReady: () => undefined },
    () => {
      const image = { src: "", naturalWidth: 10, naturalHeight: 10, onload: null, onerror: null };
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
    { schedule: () => 1, cancel: () => undefined },
    { maxImages: 1, maxDecodedBytes: 100 }
  );
  cache.retainVisible(["a.png", "b.png"]);
  for (const image of images) image.onload?.();
  assert.equal(cache.get("a.png"), images[0] as unknown as HTMLImageElement);
  assert.equal(cache.get("b.png"), images[1] as unknown as HTMLImageElement);
  assert.deepEqual(cache.stats, { entries: 2, estimatedBytes: 800, visibleEntries: 2, pendingRetries: 0 });
  cache.retainVisible(["b.png"]);
  assert.equal(cache.get("a.png"), undefined);
  assert.equal(cache.get("b.png")?.naturalWidth, 10);
  assert.deepEqual(cache.stats, { entries: 1, estimatedBytes: 400, visibleEntries: 1, pendingRetries: 0 });
});

test("offscreen Sync retry is cancelled and an arriving attachment loads only when visible again", () => {
  let available = false;
  const timers: Array<() => void> = [];
  const cancelled: number[] = [];
  let created = 0;
  const cache = new ImageAssetCache(
    { resourceUrl: () => available ? "resource:late.png" : null, onReady: () => undefined },
    () => { created += 1; return { src: "", onload: null, onerror: null } as unknown as HTMLImageElement; },
    { schedule: (callback) => { timers.push(callback); return timers.length; }, cancel: (timer) => { cancelled.push(timer); } }
  );
  cache.retainVisible(["late.png"]);
  assert.equal(cache.stats.pendingRetries, 1);
  cache.retainVisible([]);
  assert.deepEqual(cancelled, [1]);
  available = true;
  timers[0](); // A callback already queued when cancellation occurred must stay offscreen.
  assert.equal(created, 0);
  cache.retainVisible(["late.png"]);
  assert.equal(created, 1);
});

test("failed image decoding releases the cache entry so a later Sync event can retry", () => {
  let created = 0;
  const images: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null }> = [];
  const retries: Array<() => void> = [];
  const cache = new ImageAssetCache(
    { resourceUrl: (path) => `resource:${path}`, onReady: () => undefined },
    () => {
      created += 1;
      const image = { src: "", onload: null, onerror: null };
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
    { schedule: (callback) => { retries.push(callback); return retries.length; }, cancel: () => undefined }
  );
  cache.load("late.png");
  images[0].onerror?.();
  assert.equal(cache.get("late.png"), undefined);
  assert.equal(retries.length, 1);
  retries[0]();
  assert.equal(created, 2);
});

test("image cache retries when the referenced Sync attachment is not in the Vault yet", () => {
  let available = false;
  let created = 0;
  const retries: Array<() => void> = [];
  const cache = new ImageAssetCache(
    { resourceUrl: () => available ? "resource:late.png" : null, onReady: () => undefined },
    () => { created += 1; return { src: "", onload: null, onerror: null } as unknown as HTMLImageElement; },
    { schedule: (callback) => { retries.push(callback); return retries.length; }, cancel: () => undefined }
  );
  cache.load("late.png");
  assert.equal(created, 0);
  assert.equal(retries.length, 1);
  available = true;
  retries[0]();
  assert.equal(created, 1);
});

test("diagnostic counter snapshots are stable, integral and non-negative", () => {
  assert.deepEqual(diagnosticCounterSnapshot({
    orphanRecoveries: 1.2, inputDocumentScrolls: -1, hostDocumentScrolls: 2,
    hostDocumentPenStarts: 3, scribbleTouchCancels: 4, recoveredPointerStarts: 5,
    stylusTouchFallbackStarts: 6, presentationRecoveryFrames: 7,
    maxEventLoopDelayMs: 8.7, lastSaveMs: 9.2, maxSaveMs: 10.8
  }), {
    orphanRecoveries: 1, inputDocumentScrolls: 0, hostDocumentScrolls: 2,
    hostDocumentPenStarts: 3, scribbleTouchCancels: 4, recoveredPointerStarts: 5,
    stylusTouchFallbackStarts: 6, presentationRecoveryFrames: 7,
    maxEventLoopDelayMs: 9, lastSaveMs: 9, maxSaveMs: 11
  });
});

test("runtime identity detects a partially synced plugin release", () => {
  assert.equal(RUNTIME_VERSION, "0.4.84");
  assert.equal(BUILD_FINGERPRINT.includes(RUNTIME_VERSION), true);
  assert.equal(runtimeMatchesManifest("0.4.84"), true);
  assert.equal(runtimeMatchesManifest("0.4.37"), false);
});

test("creative toolbar colors keep preset and more-color selection mutually exclusive", () => {
  assert.equal(isColorTool("highlighter"), true);
  assert.equal(isColorTool("eraser"), false);
  assert.equal(inferredColorSource(TOOLBAR_PRESET_COLORS[0]), "preset");
  assert.equal(inferredColorSource("#9564de"), "more");
  assert.equal(MORE_COLORS.length, 48);
  assert.equal(MORE_COLORS.some((color) => TOOLBAR_PRESET_COLORS.includes(color as typeof TOOLBAR_PRESET_COLORS[number])), false);
});

test("board rename names preserve the extension and reject cross-platform-invalid path characters", () => {
  assert.equal(normalizedBoardName("  学习笔记.board  "), "学习笔记");
  assert.equal(normalizedBoardName("新画板"), "新画板");
  assert.equal(normalizedBoardName(""), null);
  assert.equal(normalizedBoardName("章节/一"), null);
  assert.equal(normalizedBoardName("章节:一"), null);
});

test("phone finger drawing activates only persistent pens and the eraser", () => {
  assert.equal(supportsPhoneFingerDrawing("ballpoint"), true);
  assert.equal(supportsPhoneFingerDrawing("pen"), true);
  assert.equal(supportsPhoneFingerDrawing("highlighter"), true);
  assert.equal(supportsPhoneFingerDrawing("eraser"), true);
  assert.equal(supportsPhoneFingerDrawing("select"), true);
  assert.equal(supportsPhoneFingerDrawing("laser"), true);
  assert.equal(supportsPhoneFingerDrawing("hand"), false);
});

test("phone stationery rail computes scaled scrolling and distinguishes a swipe from a tap", () => {
  const swipe = new PhoneRailSwipe();
  const contact = (x: number, y = 200) => [{ identifier: 7, clientX: x, clientY: y }];
  swipe.start(contact(300), 50, 0.88);
  assert.deepEqual(swipe.move(contact(298)), { scrollLeft: null, preventDefault: false });
  const horizontal = swipe.move(contact(278));
  assert.equal(horizontal.preventDefault, true);
  assert.ok(Math.abs((horizontal.scrollLeft ?? 0) - 75) < 1e-6);
  assert.equal(swipe.end(), true);

  swipe.start(contact(300), 50);
  assert.equal(swipe.end(), false, "a tap must remain a normal tool click");
  swipe.start(contact(300), 50);
  assert.deepEqual(swipe.move(contact(298, 180)), { scrollLeft: null, preventDefault: true });
  assert.equal(swipe.end(), true);
  swipe.start(contact(300), 50);
  assert.deepEqual(swipe.move([{ identifier: 7, clientX: 280, clientY: 200 }, { identifier: 8, clientX: 285, clientY: 200 }]), { scrollLeft: null, preventDefault: true });
  assert.equal(swipe.end(), false);
});

test("phone toolbar touch and pointer events stop at the box while taps remain clickable", () => {
  const toolbar = new EventTarget() as unknown as HTMLElement;
  const rail = Object.assign(new EventTarget(), {
    scrollLeft: 50, clientWidth: 88, scrollWidth: 244,
    getBoundingClientRect: () => ({ width: 77.44 }),
    classList: {
      values: new Set<string>(),
      add(name: string) { this.values.add(name); },
      remove(name: string) { this.values.delete(name); },
      contains(name: string) { return this.values.has(name); }
    }
  }) as unknown as HTMLElement;
  let scrollLeft = 50;
  Object.defineProperty(rail, "scrollLeft", {
    get: () => scrollLeft,
    set: (value: number) => { scrollLeft = Math.max(0, Math.min(156, value)); }
  });
  const controller = new AbortController();
  bindPhoneToolbarSwipe(toolbar, rail, controller.signal);
  const touch = (type: string, x: number): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ identifier: 1, clientX: x, clientY: 200 }] });
    toolbar.dispatchEvent(event);
    return event;
  };
  assert.equal(touch("touchstart", 300).cancelBubble, true);
  assert.equal(touch("touchend", 300).defaultPrevented, false);
  const tapClick = new Event("click", { bubbles: true, cancelable: true });
  toolbar.dispatchEvent(tapClick);
  assert.equal(tapClick.defaultPrevented, false);

  touch("touchstart", 300);
  const moved = touch("touchmove", 278);
  assert.equal(moved.cancelBubble, true);
  assert.equal(moved.defaultPrevented, true);
  assert.ok(Math.abs(rail.scrollLeft - 75) < 1e-6);
  assert.equal(rail.classList.contains("is-dragging"), true);
  touch("touchend", 278);
  assert.equal(rail.classList.contains("is-dragging"), false);
  const swipeClick = new Event("click", { bubbles: true, cancelable: true });
  toolbar.dispatchEvent(swipeClick);
  assert.equal(swipeClick.defaultPrevented, true);

  rail.scrollLeft = 156;
  touch("touchstart", 300);
  const atEdge = touch("touchmove", 278);
  assert.equal(rail.scrollLeft, 156);
  assert.equal(atEdge.defaultPrevented, true);
  assert.equal(atEdge.cancelBubble, true);
  touch("touchend", 278);

  const touchPointer = new Event("pointermove", { bubbles: true, cancelable: true });
  Object.defineProperty(touchPointer, "pointerType", { value: "touch" });
  toolbar.dispatchEvent(touchPointer);
  assert.equal(touchPointer.cancelBubble, true);
  controller.abort();
  assert.equal(touch("touchstart", 300).cancelBubble, false);
});

test("scene cache identity changes with canvas size and camera movement", () => {
  const camera = { x: 10, y: 20, zoom: 1 };
  assert.equal(sceneCacheKey(2048, 1536, camera), sceneCacheKey(2048, 1536, { ...camera }));
  assert.notEqual(sceneCacheKey(2048, 1536, camera), sceneCacheKey(2048, 1536, { ...camera, x: 11 }));
  assert.notEqual(sceneCacheKey(2048, 1536, camera), sceneCacheKey(2049, 1536, camera));
});

test("scene cache reuse requires both valid content and an unchanged camera key", () => {
  const key = sceneCacheKey(2048, 1536, { x: 10, y: 20, zoom: 1 });
  assert.equal(canReuseSceneCache(true, key, key), true);
  assert.equal(canReuseSceneCache(false, key, key), false);
  assert.equal(canReuseSceneCache(true, key, sceneCacheKey(2048, 1536, { x: 11, y: 20, zoom: 1 })), false);
});

test("scene cache builds once, reuses, invalidates and releases its backing canvas", () => {
  let builds = 0;
  let created = 0;
  const context = {} as CanvasRenderingContext2D;
  const cacheCanvas = { width: 300, height: 150, getContext: () => context } as unknown as HTMLCanvasElement;
  const source = {
    width: 2048,
    height: 1536,
    ownerDocument: { createElement: () => { created += 1; return cacheCanvas; } }
  } as unknown as HTMLCanvasElement;
  const camera = { x: 10, y: 20, zoom: 1 };
  const cache = new SceneCache();
  const first = cache.resolve(source, camera, () => { builds += 1; });
  const second = cache.resolve(source, camera, () => { builds += 1; });
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(builds, 1);
  assert.equal(created, 1);
  cache.invalidate();
  assert.equal(cache.resolve(source, camera, () => { builds += 1; }).reused, false);
  cache.release();
  assert.equal(cacheCanvas.width, 1);
  assert.equal(cacheCanvas.height, 1);
  cache.resolve(source, camera, () => { builds += 1; });
  assert.equal(created, 2);
  assert.equal(builds, 3);
});

test("render metrics remain bounded aggregates and reset without retaining frames", () => {
  const metrics = new RenderMetrics();
  metrics.recordFrame(4);
  metrics.recordFrame(18);
  metrics.recordCacheBuild(11);
  metrics.recordCacheBuild(7);
  metrics.recordCacheHit();
  assert.deepEqual(metrics.snapshot(), {
    renderFrames: 2,
    maxRenderDurationMs: 18,
    sceneCacheBuilds: 2,
    sceneCacheHits: 1,
    maxSceneCacheBuildDurationMs: 11
  });
  metrics.reset();
  assert.deepEqual(metrics.snapshot(), {
    renderFrames: 0,
    maxRenderDurationMs: 0,
    sceneCacheBuilds: 0,
    sceneCacheHits: 0,
    maxSceneCacheBuildDurationMs: 0
  });
});

test("scene renderer preserves static-before-dynamic paint order and reuses the scene", () => {
  const calls: string[] = [];
  const context = {
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    setTransform: () => calls.push("transform"),
    translate: () => calls.push("translate"),
    scale: () => calls.push("scale"),
    drawImage: () => calls.push("composite"),
    globalAlpha: 1,
    globalCompositeOperation: "source-over"
  } as unknown as CanvasRenderingContext2D;
  const cacheContext = {
    save: () => calls.push("cache-save"),
    restore: () => calls.push("cache-restore"),
    setTransform: () => calls.push("cache-transform"),
    translate: () => calls.push("cache-translate"),
    scale: () => calls.push("cache-scale")
  } as unknown as CanvasRenderingContext2D;
  const cachedCanvas = { width: 0, height: 0, getContext: () => cacheContext } as unknown as HTMLCanvasElement;
  const canvas = {
    width: 200,
    height: 100,
    ownerDocument: { createElement: () => cachedCanvas },
    getBoundingClientRect: () => ({ width: 100, height: 50 })
  } as unknown as HTMLCanvasElement;
  const renderer = new SceneRenderer();
  const render = (): void => renderer.render({
    canvas,
    context,
    camera: { x: 4, y: 5, zoom: 1.5 },
    drawBackground: () => calls.push("background"),
    drawStaticWorld: () => calls.push("static"),
    drawDynamicWorld: () => calls.push("dynamic")
  });
  render();
  render();
  assert.equal(calls.filter((call) => call === "background").length, 1);
  assert.equal(calls.filter((call) => call === "static").length, 1);
  assert.equal(calls.filter((call) => call === "composite").length, 2);
  assert.equal(calls.filter((call) => call === "dynamic").length, 2);
  assert.ok(calls.indexOf("static") < calls.indexOf("composite"));
  assert.ok(calls.indexOf("composite") < calls.indexOf("dynamic"));
  const metrics = renderer.metricsSnapshot();
  assert.equal(metrics.renderFrames, 2);
  assert.equal(metrics.sceneCacheBuilds, 1);
  assert.equal(metrics.sceneCacheHits, 1);
});

test("Stylus Touch fallback starts only when Pointer input missed the contact", () => {
  assert.equal(shouldStartStylusTouchFallback(true, false, true), true);
  assert.equal(shouldStartStylusTouchFallback(true, true, true), false);
  assert.equal(shouldStartStylusTouchFallback(false, false, true), false);
  assert.equal(shouldStartStylusTouchFallback(true, false, false), false);
});

test("iPad recovers a missing pen down only from a pressing move on the canvas", () => {
  const move = (pointerType: string, buttons: number, pressure: number) => ({ pointerType, buttons, pressure });
  assert.equal(shouldRecoverPenPointerMove(move("pen", 1, 0.2), false, true), true);
  assert.equal(shouldRecoverPenPointerMove(move("pen", 1, 0.2), true, true), false);
  assert.equal(shouldRecoverPenPointerMove(move("pen", 0, 0), false, true), false);
  assert.equal(shouldRecoverPenPointerMove(move("touch", 1, 0.5), false, true), false);
  assert.equal(shouldRecoverPenPointerMove(move("pen", 1, 0.2), false, false), false);
});

test("iPad Scribble guard cancels only an all-stylus Touch stream", () => {
  assert.equal(isStylusOnlyTouchList([{ touchType: "stylus" }]), true);
  assert.equal(isStylusOnlyTouchList([{ touchType: "stylus" }, { touchType: "stylus" }]), true);
  assert.equal(isStylusOnlyTouchList([{ touchType: "direct" }]), false);
  assert.equal(isStylusOnlyTouchList([{ touchType: "stylus" }, { touchType: "direct" }]), false);
  assert.equal(isStylusOnlyTouchList([{}]), false);
  assert.equal(isStylusOnlyTouchList([]), false);
});

test("v1 board migrates and legacy stroke receives an immutable brush snapshot", () => {
  const board = parseBoard(JSON.stringify({
    schemaVersion: 1,
    camera: { x: 2, y: 3, zoom: 1 },
    strokes: [{ id: "s", type: "stroke", tool: "pen", color: "#123456", size: 4, points: [{ x: 1, y: 2, pressure: 0.5, time: 1 }] }],
    images: []
  }));
  assert.equal(board.schemaVersion, SCHEMA_VERSION);
  const stroke = board.elements[0];
  assert.equal(stroke.type, "stroke");
  if (stroke.type !== "stroke") throw new Error("Expected a stroke");
  assert.equal(stroke.brush?.color, "#123456");
  assert.equal(stroke.brush?.size, 4);
});

test("schema v3 images migrate through v5 without changing their visual rectangle", () => {
  const board = parseBoard(JSON.stringify({
    schemaVersion: 3,
    camera: { x: 0, y: 0, zoom: 1 },
    elements: [{ id: "image", type: "image", createdAt: "a", updatedAt: "a", path: "image.png", x: 10, y: 20, width: 300, height: 200 }]
  }));
  const image = board.elements[0] as BoardImage;
  assert.equal(board.schemaVersion, 5);
  assert.equal(image.rotation, 0);
  assert.deepEqual(image.crop, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual({ x: image.x, y: image.y, width: image.width, height: image.height }, { x: 10, y: 20, width: 300, height: 200 });
});

test("future schemas and malformed persistent elements are rejected", () => {
  assert.throws(() => parseBoard(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 })));
  assert.throws(() => parseBoard(JSON.stringify({ schemaVersion: 2, strokes: [{}], images: [] })));
  assert.throws(() => parseBoard(JSON.stringify({ schemaVersion: 2, strokes: {}, images: [] })));
  assert.throws(() => parseBoard(JSON.stringify({ schemaVersion: 3, elements: [
    { id: "same", type: "image", path: "a.png", x: 0, y: 0, width: 1, height: 1 },
    { id: "same", type: "image", path: "b.png", x: 0, y: 0, width: 1, height: 1 }
  ] })));
  assert.throws(() => parseBoard(JSON.stringify({ schemaVersion: 5, updatedAt: "2026-09-23T00:00:00.000Z", camera: {}, elements: [], revision: {} })));
});

test("cloneBoard is isolated from the source", () => {
  const source = emptyBoard();
  const clone = cloneBoard(source);
  clone.camera.x = 99;
  assert.equal(source.camera.x, 0);
});

test("settings merge preserves defaults and validates active tool", () => {
  const settings = mergeSettings({ activeTool: "invalid" as never, brushes: { pen: { color: "#ffffff", size: "huge" } } as never });
  assert.equal(settings.activeTool, "pen");
  assert.equal(settings.brushes.pen.color, "#ffffff");
  assert.equal(settings.brushes.pen.size, 3.6);
  assert.equal(settings.brushes.pen.pressure, "strong");
  assert.equal(settings.eraser.mode, "partial");
  assert.equal(settings.eraser.size, 28);
  assert.equal(mergeSettings({ eraser: { mode: "stroke", size: 44 }, selectionMode: "rectangle" }).eraser.mode, "stroke");
  assert.equal(mergeSettings({ eraser: { mode: "stroke", size: 44 }, selectionMode: "rectangle" }).selectionMode, "rectangle");
});

test("strong pressure remains smooth and more expressive than soft pressure", () => {
  assert.ok(pressureScale(1, "strong") - pressureScale(0.1, "strong") > pressureScale(1, "soft") - pressureScale(0.1, "soft"));
  const values = stabilizePressure([0.1, 1, 0.1, 1], "strong");
  for (let index = 1; index < values.length; index++) assert.ok(Math.abs(values[index] - values[index - 1]) <= 0.030001);
});

test("centerline smoothing keeps samples, bounds displacement and softens jitter", () => {
  const jitter = [
    { x: 0, y: 0, pressure: 0.2, time: 0 },
    { x: 10, y: 1, pressure: 0.4, time: 10 },
    { x: 20, y: -1, pressure: 0.6, time: 20 },
    { x: 30, y: 0, pressure: 0.8, time: 30 }
  ];
  const jitterBefore = structuredClone(jitter);
  const smoothedJitter = smoothCenterline(jitter);
  assert.deepEqual(jitter, jitterBefore, "smoothing must not mutate persistent samples");
  assert.equal(smoothedJitter.length, jitter.length, "smoothing must not change the sample count");
  assert.deepEqual(
    smoothedJitter.map(({ pressure, time }) => ({ pressure, time })),
    jitter.map(({ pressure, time }) => ({ pressure, time })),
    "smoothing may only move x and y; pressure and time stay as captured"
  );
  assert.equal(smoothedJitter[0].x, jitter[0].x);
  assert.equal(smoothedJitter[0].y, jitter[0].y);
  assert.equal(smoothedJitter[smoothedJitter.length - 1].x, jitter[jitter.length - 1].x);
  assert.equal(smoothedJitter[smoothedJitter.length - 1].y, jitter[jitter.length - 1].y);
  const deviationBefore = Math.abs(jitter[1].y) + Math.abs(jitter[2].y);
  const deviationAfter = Math.abs(smoothedJitter[1].y) + Math.abs(smoothedJitter[2].y);
  assert.ok(deviationAfter < deviationBefore, `small straight-line jitter should soften: ${deviationAfter} vs ${deviationBefore}`);

  const capturedMinY = Math.min(...jitter.map((point) => point.y));
  const capturedMaxY = Math.max(...jitter.map((point) => point.y));
  for (const point of smoothedJitter) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), "smoothed samples must stay finite");
    assert.ok(point.y >= capturedMinY && point.y <= capturedMaxY, "smoothed samples must stay inside the captured stroke bounds");
  }

  const repeat = smoothCenterline(jitter);
  assert.deepEqual(
    repeat.map(({ x, y }) => ({ x, y })),
    smoothedJitter.map(({ x, y }) => ({ x, y })),
    "smoothed output must be deterministic for the same captured samples"
  );
  assert.deepEqual(
    smoothCenterline([{ x: 4, y: 7, pressure: 0.5, time: 0 }]),
    [{ x: 4, y: 7, pressure: 0.5, time: 0 }],
    "strokes below the smoothing threshold stay exactly as captured"
  );
});

test("highlighter uses stable source-over compositing instead of Safari multiply", () => {
  assert.equal(strokeCompositeOperation("highlighter"), "source-over");
  assert.equal(strokeCompositeOperation("pen"), "source-over");
  assert.equal(strokeCompositeOperation("ballpoint"), "source-over");
});

test("laser lifecycle fades and never enters serialized board data", () => {
  const stroke = createLaserStroke({ x: 0, y: 0, pressure: 0.5, time: 0 }, { color: "#f00", size: 5, holdMs: 100, fadeMs: 50, glow: 8 });
  appendLaserPoint(stroke, { x: 1, y: 0, pressure: 0.5, time: 1 });
  stroke.completedAt = 10;
  assert.equal(laserAlpha(stroke, 110), 1);
  assert.equal(laserAlpha(stroke, 135), 0.5);
  assert.equal(isLaserExpired(stroke, 160), true);
  const board = emptyBoard() as ReturnType<typeof emptyBoard> & { laserStrokes?: unknown[] };
  board.laserStrokes = [stroke];
  assert.equal(serializeBoard(board).includes("laser"), false);
});

test("laser controller owns transient input lifecycle and clears on deactivation", () => {
  let now = 100;
  let animationStops = 0;
  const config = { color: "#f00", size: 5, holdMs: 100, fadeMs: 50, glow: 8 };
  const controller = new LaserController(() => config, () => now, () => { animationStops += 1; });
  const input = (x: number) => ({
    pointerId: 7,
    point: { x, y: 0, pressure: 0.5, time: now },
    source: "stylus-touch" as const
  });

  controller.onInputStart(input(0));
  config.color = "#0f0";
  controller.onInputMove(input(10));
  controller.onInputEnd(input(20));
  assert.equal(controller.isDrawing, false);
  assert.equal(controller.visibleStrokes[0].points.length, 3);
  assert.equal(controller.visibleStrokes[0].config.color, "#f00");
  now = 251;
  controller.pruneExpired();
  assert.equal(controller.hasStrokes, false);

  controller.onInputStart(input(30));
  controller.onDeactivate();
  assert.equal(controller.hasStrokes, false);
  assert.equal(controller.isDrawing, false);
  assert.equal(animationStops, 1);
});

test("tool controller registry deactivates before activating the next tool", () => {
  const events: string[] = [];
  const controller = (name: string): ToolController => ({
    onActivate: () => events.push(`${name}:activate`),
    onDeactivate: () => events.push(`${name}:deactivate`),
    onInputStart: () => {},
    onInputMove: () => {},
    onInputEnd: () => {},
    renderOverlay: () => {}
  });
  const registry = new ToolControllerRegistry();
  registry.register("laser", controller("laser"));
  registry.register("pen", controller("pen"));
  registry.activate("laser");
  registry.activate("pen");
  registry.activate("pen");
  registry.deactivate();
  registry.activate("pen");
  assert.deepEqual(events, ["laser:activate", "laser:deactivate", "pen:activate", "pen:deactivate", "pen:activate"]);
});

test("tool transitions keep selection and eraser cleanup out of the input router", () => {
  assert.deepEqual(planToolTransition("select", "hand", true, true), {
    finishActiveInput: true, cancelActiveSelection: true, persistFinishedInput: false,
    clearSelection: true, clearEraserPreview: true
  });
  assert.deepEqual(planToolTransition("pen", "select", true, true), {
    finishActiveInput: true, cancelActiveSelection: false, persistFinishedInput: true,
    clearSelection: false, clearEraserPreview: true
  });
  assert.deepEqual(planToolTransition("eraser", "eraser", true, true), {
    finishActiveInput: false, cancelActiveSelection: false, persistFinishedInput: true,
    clearSelection: true, clearEraserPreview: false
  });
  assert.equal(planToolTransition("laser", "pen", true, false).persistFinishedInput, false);
});

test("snapshot history remains backward compatible", () => {
  const history = new SnapshotHistory();
  const board = emptyBoard();
  history.push(board);
  board.camera.x = 20;
  const previous = history.undo(board);
  assert.equal(previous?.camera.x, 0);
  assert.equal(history.redo(previous ?? board)?.camera.x, 20);
});

test("command history supports future fine-grained edits", () => {
  const history = new CommandHistory<number>();
  const add: Command<number> = { label: "add", execute: (state) => state + 2, undo: (state) => state - 2 };
  let state = history.execute(add, 1);
  assert.equal(state, 3);
  state = history.undo(state);
  assert.equal(state, 1);
  assert.equal(history.redo(state), 3);
});

test("history memory budget evicts old commands but preserves the newest undo", () => {
  const history = new CommandHistory<number>(50, 12);
  const add = (amount: number, estimatedBytes: number): Command<number> => ({
    label: `add ${amount}`, estimatedBytes,
    execute: (value) => value + amount, undo: (value) => value - amount
  });
  let value = history.execute(add(1, 6), 0);
  value = history.execute(add(2, 6), value);
  value = history.execute(add(3, 6), value);
  assert.deepEqual(history.usage, { undoCount: 2, redoCount: 0, estimatedBytes: 12 });
  value = history.undo(value);
  assert.equal(value, 3);
  assert.deepEqual(history.usage, { undoCount: 1, redoCount: 1, estimatedBytes: 12 });
  value = history.undo(value);
  assert.equal(value, 1);
  value = history.redo(value);
  assert.equal(value, 3);
  value = history.execute(add(10, 24), value);
  assert.equal(value, 13);
  assert.deepEqual(history.usage, { undoCount: 1, redoCount: 0, estimatedBytes: 24 });
  assert.equal(history.undo(value), 3);
});

test("board history adapts existing mutations into chronological commands", () => {
  const history = new BoardHistory();
  let board = emptyBoard();
  history.begin(board, "move");
  board.camera.x = 42;
  history.commit(board);
  board = history.undo(board);
  assert.equal(board.camera.x, 0);
  board = history.redo(board);
  assert.equal(board.camera.x, 42);
  assert.equal(HISTORY_MEMORY_BUDGET_BYTES, 32 * 1024 * 1024);
});

test("external content detection ignores this view's pending write", () => {
  assert.equal(isExternalContent("next", "old", "next"), false);
  assert.equal(isExternalContent("remote", "old", "next"), true);
});

test("serialization whitelists schema-v5 image and revision fields and rejects transient element state", () => {
  const board = emptyBoard();
  const image = imageElement("image", 0) as BoardImage & { previewCache?: unknown };
  image.rotation = 90;
  image.crop = { x: 0.1, y: 0.2, width: 0.7, height: 0.6 };
  image.previewCache = { deviceOnly: true };
  board.elements = [image];
  const raw = serializeBoard(board);
  assert.equal(raw.includes("previewCache"), false);
  assert.equal(raw.includes("\n"), false);
  const parsed = parseBoard(raw);
  assert.equal((parsed.elements[0] as BoardImage).rotation, 90);
  assert.deepEqual((parsed.elements[0] as BoardImage).crop, image.crop);
});

test("v2 image and stroke migrate into one stable paint-order array", () => {
  const board = parseBoard(JSON.stringify({
    schemaVersion: 2,
    strokes: [{ id: "s", type: "stroke", tool: "pen", color: "#000000", size: 2, points: [{ x: 0, y: 0, pressure: 0.5, time: 0 }] }],
    images: [{ id: "i", type: "image", path: "assets/i.png", x: 0, y: 0, width: 100, height: 50 }]
  }));
  assert.deepEqual(board.elements.map((element) => element.id), ["i", "s"]);
});

test("selection geometry supports stroke movement and precise hit testing", () => {
  const now = new Date().toISOString();
  const source: Stroke = { id: "s", type: "stroke", createdAt: now, updatedAt: now, tool: "pen", color: "#000000", size: 2, points: [{ x: 0, y: 0, pressure: 0.5, time: 0 }, { x: 10, y: 0, pressure: 0.5, time: 1 }] };
  const moved = structuredClone(source);
  assert.equal(hitTestElement(source, { x: 5, y: 1 }, 1), true);
  assert.equal(hitTestElement(source, { x: 5, y: 20 }, 1), false);
  translateElement(moved, source, 5, 7);
  assert.deepEqual(elementBounds(moved), { minX: 4, minY: 6, maxX: 16, maxY: 8 });
});

test("image corner resizing preserves aspect ratio and opposite corner", () => {
  const now = new Date().toISOString();
  const source: BoardImage = { id: "i", type: "image", createdAt: now, updatedAt: now, path: "assets/i.png", x: 10, y: 20, width: 100, height: 50, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } };
  const resized = structuredClone(source);
  resizeImageFromHandle(resized, source, "se", { x: 210, y: 120 }, 20);
  assert.equal(resized.width / resized.height, 2);
  assert.equal(resized.x, 10);
  assert.equal(resized.y, 20);
});

test("rotated image bounds and hit testing use its transformed geometry", () => {
  const image = imageElement("rotated", 0);
  image.width = 100;
  image.height = 20;
  image.rotation = 90;
  const bounds = elementBounds(image);
  assert.ok(Math.abs(bounds.minX - 40) < 1e-6);
  assert.ok(Math.abs(bounds.maxX - 60) < 1e-6);
  assert.equal(hitTestElement(image, { x: 50, y: 45 }, 0), true);
  assert.equal(hitTestElement(image, { x: 10, y: 10 }, 0), false);
});

test("image crop and reset preserve source fractions and recover full geometry", () => {
  const image = imageElement("crop", 0);
  image.width = 100;
  image.height = 80;
  const cropped = cropImage(image, { left: 0.1, right: 0.2, top: 0.25, bottom: 0 });
  assert.deepEqual(cropped.crop, { x: 0.1, y: 0.25, width: 0.7, height: 0.75 });
  assert.equal(cropped.width, 70);
  assert.equal(cropped.height, 60);
  const reset = resetImageCrop(cropped);
  assert.deepEqual(reset.crop, { x: 0, y: 0, width: 1, height: 1 });
  assert.ok(Math.abs(reset.x - image.x) < 1e-6);
  assert.ok(Math.abs(reset.y - image.y) < 1e-6);
  assert.ok(Math.abs(reset.width - image.width) < 1e-6);
  assert.ok(Math.abs(reset.height - image.height) < 1e-6);
  assert.equal(rotateImage(image, -90).rotation, 270);
});

test("image crop and rotation handles follow the image rotation", () => {
  const image = imageElement("handles", 10);
  image.y = 20;
  image.width = 100;
  image.height = 60;
  assert.deepEqual(imageCropHandlePoints(image), {
    nw: { x: 10, y: 20 }, n: { x: 60, y: 20 }, ne: { x: 110, y: 20 }, e: { x: 110, y: 50 },
    se: { x: 110, y: 80 }, s: { x: 60, y: 80 }, sw: { x: 10, y: 80 }, w: { x: 10, y: 50 }
  });
  image.rotation = 90;
  const rotated = imageCropHandlePoints(image);
  assert.ok(Math.abs(rotated.n.x - 90) < 1e-6);
  assert.ok(Math.abs(rotated.n.y - 50) < 1e-6);
  const rotation = imageRotationHandlePoint(image, 30);
  assert.ok(Math.abs(rotation.x - 120) < 1e-6);
  assert.ok(Math.abs(rotation.y - 50) < 1e-6);
});

test("crop handles update source fractions, geometry and minimum size", () => {
  const image = imageElement("crop-handles", 0);
  image.width = 100;
  image.height = 80;
  const left = cropImageFromHandle(image, "w", { x: 20, y: 40 }, 24);
  assert.deepEqual(left.crop, { x: 0.2, y: 0, width: 0.8, height: 1 });
  assert.deepEqual({ x: left.x, y: left.y, width: left.width, height: left.height }, { x: 20, y: 0, width: 80, height: 80 });
  const corner = cropImageFromHandle(image, "se", { x: 70, y: 50 }, 24);
  assert.deepEqual(corner.crop, { x: 0, y: 0, width: 0.7, height: 0.625 });
  const clamped = cropImageFromHandle(image, "nw", { x: 99, y: 79 }, 24);
  assert.ok(Math.abs(clamped.width - 24) < 1e-6);
  assert.ok(Math.abs(clamped.height - 24) < 1e-6);
});

test("free rotation follows the pointer around the image center", () => {
  const image = imageElement("rotate-free", 0);
  image.width = 100;
  image.height = 80;
  assert.equal(rotateImageToPoint(image, { x: 50, y: -20 }).rotation, 0);
  assert.equal(rotateImageToPoint(image, { x: 120, y: 40 }).rotation, 90);
  assert.equal(rotateImageToPoint(image, { x: 50, y: 100 }).rotation, 180);
});

test("layer ordering preserves the relative order of a multi-selection", () => {
  const now = new Date().toISOString();
  const elements: BoardImage[] = ["a", "b", "c", "d"].map((id) => ({ id, type: "image", createdAt: now, updatedAt: now, path: `${id}.png`, x: 0, y: 0, width: 10, height: 10, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } }));
  assert.deepEqual(reorderElements(elements, new Set(["b", "c"]), "front").map((element) => element.id), ["a", "d", "b", "c"]);
  assert.deepEqual(reorderElements(elements, new Set(["b", "c"]), "back").map((element) => element.id), ["b", "c", "a", "d"]);
  assert.deepEqual(reorderElements(elements, new Set(["b"]), "forward").map((element) => element.id), ["a", "c", "b", "d"]);
});

test("alignment and distribution preserve relative element sizes", () => {
  const elements = [imageElement("a", 0), imageElement("b", 30), imageElement("c", 100)];
  const ids = new Set(elements.map((element) => element.id));
  const aligned = alignElements(elements, ids, "top") as BoardImage[];
  assert.deepEqual(aligned.map((element) => element.y), [0, 0, 0]);
  const distributed = distributeElements(elements, ids, "horizontal") as BoardImage[];
  assert.ok(Math.abs(distributed[1].x - 50) < 1e-6);
  assert.deepEqual(distributed.map((element) => element.width), [10, 10, 10]);
});

test("freeform lasso selects enclosed strokes and images", () => {
  const now = new Date().toISOString();
  const image: BoardImage = { id: "i", type: "image", createdAt: now, updatedAt: now, path: "i.png", x: 2, y: 2, width: 4, height: 4, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } };
  const lasso = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(elementIntersectsLasso(image, lasso), true);
  assert.equal(elementIntersectsLasso(lineStroke("crossing", -20, 20), [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }]), true);
});

test("rectangle selection intersects crossing strokes and enclosed images", () => {
  const image = imageElement("inside", 2);
  const crossing = lineStroke("crossing", -20, 20);
  const bounds = { minX: -5, minY: -5, maxX: 5, maxY: 5 };
  assert.equal(elementIntersectsBounds(image, bounds), true);
  assert.equal(elementIntersectsBounds(crossing, bounds), true);
  const rotated = imageElement("rotated-miss", 0);
  rotated.y = 45;
  rotated.width = 100;
  rotated.height = 10;
  rotated.rotation = 45;
  assert.equal(elementIntersectsBounds(rotated, { minX: 12, minY: 85, maxX: 15, maxY: 88 }), false);
});

test("iPad stylus classification keeps pen authoritative and rejects ordinary touch", () => {
  assert.equal(isStylusPointer({ pointerType: "pen", width: 20, height: 20, pressure: 0.5 }), true);
  assert.equal(isStylusPointer({ pointerType: "touch", width: 1, height: 1, pressure: 0.3 }), true);
  assert.equal(isStylusPointer({ pointerType: "touch", width: 12, height: 12, pressure: 0.5 }), false);
});

test("confirmed iPad Pencil accepts delayed or fixed pressure without accepting a palm", () => {
  const touch = (radius: number, force: number) => ({
    identifier: 9,
    radiusX: radius,
    radiusY: radius,
    force
  }) as Touch;
  const list = (items: Touch[]) => ({
    length: items.length,
    item: (index: number) => items[index] ?? null,
    [Symbol.iterator]: function* () { yield* items; }
  }) as unknown as TouchList;

  assert.equal(findStylusTouch(list([touch(1, 0)])), null);
  assert.equal(findStylusTouch(list([touch(1, 0)]), true)?.identifier, 9);
  assert.equal(findStylusTouch(list([touch(1, 0.5)]), true)?.identifier, 9);
  assert.equal(findStylusTouch(list([touch(12, 0)]), true), null);
});

test("iPad recovers an orphaned Stylus Touch only after its identifier leaves all touch lists", () => {
  const touch = (identifier: number) => ({ identifier }) as Touch;
  const list = (items: Touch[]) => ({
    length: items.length,
    item: (index: number) => items[index] ?? null,
    [Symbol.iterator]: function* () { yield* items; }
  }) as unknown as TouchList;

  assert.equal(shouldRecoverMissingStylus(list([]), list([]), 9), true);
  assert.equal(shouldRecoverMissingStylus(list([touch(9)]), list([touch(3)]), 9), false);
  assert.equal(shouldRecoverMissingStylus(list([]), list([touch(9)]), 9), false);
});

test("iPad input modes are mutually exclusive instead of mixing Pointer and Touch", () => {
  assert.equal(usesNativeStylusTouch(true, "native-touch"), true);
  assert.equal(usesNativeStylusTouch(true, "pointer-capture"), false);
  assert.equal(usesNativeStylusTouch(false, "native-touch"), false);
  assert.equal(usesCanvasPointerCapture(true, "pointer-capture"), true);
  assert.equal(usesCanvasPointerCapture(true, "native-touch"), false);
  assert.equal(usesCanvasPointerCapture(false, "pointer-capture"), false);
});

test("input flight recorder is bounded, resettable and exports state transitions", () => {
  const recorder = new InputFlightRecorder(2);
  recorder.record(1, "first", "a", "idle");
  recorder.record(2, "second", "b", "touch=9");
  recorder.record(3, "third", "c", "idle");
  const report = recorder.report({ version: "test", iosApp: true });
  assert.equal(recorder.size, 2);
  assert.equal(report.includes("first"), false);
  assert.equal(report.includes("second"), true);
  assert.equal(report.includes("touch=9"), true);
  recorder.reset();
  assert.equal(recorder.size, 0);
});

test("input flight recorder preserves chronological order after repeated ring rollover", () => {
  const recorder = new InputFlightRecorder(3);
  for (let sequence = 1; sequence <= 8; sequence += 1) {
    recorder.record(sequence, `event-${sequence}`, "details", "idle");
  }
  const report = recorder.report({ version: "test" });
  assert.equal(report.includes("event-5"), false);
  assert.ok(report.indexOf("event-6") < report.indexOf("event-7"));
  assert.ok(report.indexOf("event-7") < report.indexOf("event-8"));
});

test("tool input metrics aggregate starts, completions and recoveries without tracking moves", () => {
  const metrics = new InputToolMetrics();
  const pen = metrics.recordStart("pen", "pointer");
  metrics.recordCompletion(pen);
  metrics.recordRecovery("pen", "pointer-move");
  metrics.recordRecovery("ballpoint", "stylus-touch-fallback");
  const ballpoint = metrics.recordStart("ballpoint", "touch");
  metrics.recordCompletion(ballpoint);
  assert.equal(metrics.recordStart("eraser", "pointer"), null);

  const snapshot = metrics.snapshot();
  assert.deepEqual(snapshot.pen, {
    starts: 1,
    completions: 1,
    pointerStarts: 1,
    touchStarts: 0,
    pointerMoveRecoveries: 1,
    stylusTouchFallbacks: 0
  });
  assert.equal(snapshot.ballpoint.touchStarts, 1);
  assert.equal(snapshot.ballpoint.stylusTouchFallbacks, 1);
  assert.equal(metrics.reportSummary().includes("ballpoint[start=1,complete=1,pointer=0,touch=1"), true);

  metrics.reset();
  assert.equal(metrics.snapshot().pen.starts, 0);
  assert.equal(metrics.compactSummary(), "钢 0/0 · 圆 0/0 · 荧 0/0 · 激 0/0");
});

function imageElement(id: string, x: number): BoardImage {
  const now = new Date().toISOString();
  return { id, type: "image", createdAt: now, updatedAt: now, path: `${id}.png`, x, y: 0, width: 10, height: 10, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } };
}

function lineStroke(id: string, startX: number, endX: number): Stroke {
  const now = new Date().toISOString();
  return {
    id,
    type: "stroke",
    createdAt: now,
    updatedAt: now,
    tool: "pen",
    color: "#000000",
    size: 2,
    points: [
      { x: startX, y: 0, pressure: 0.2, time: 0 },
      { x: endX, y: 0, pressure: 0.8, time: 100 }
    ]
  };
}

test("local eraser splits a sparse stroke at exact circle intersections", () => {
  const stroke = lineStroke("source", 0, 100);
  let fragmentNumber = 0;
  const result = eraseStrokeAt(stroke, { x: 50, y: 0 }, 9, () => `fragment-${++fragmentNumber}`);
  assert.equal(result.changed, true);
  assert.equal(result.fragments.length, 2);
  assert.equal(result.fragments[0].id, "source");
  assert.equal(result.fragments[1].id, "fragment-1");
  const firstEnd = result.fragments[0].points[result.fragments[0].points.length - 1];
  assert.ok(Math.abs(firstEnd.x - 40) < 1e-6);
  assert.ok(Math.abs(result.fragments[1].points[0].x - 60) < 1e-6);
  assert.ok(Math.abs(firstEnd.pressure - 0.44) < 1e-6);
  assert.ok(Math.abs(result.fragments[1].points[0].pressure - 0.56) < 1e-6);
});

test("local eraser preserves misses and removes a covered dot", () => {
  const stroke = lineStroke("source", 0, 10);
  const miss = eraseStrokeAt(stroke, { x: 100, y: 100 }, 10, () => "unused");
  assert.equal(miss.changed, false);
  assert.equal(miss.fragments[0], stroke);
  const dot = { ...structuredClone(stroke), points: [stroke.points[0]] };
  assert.deepEqual(eraseStrokeAt(dot, { x: 0, y: 0 }, 2, () => "unused").fragments, []);
});

test("whole-stroke eraser switches between hit removal and miss preservation", () => {
  const stroke = lineStroke("source", 0, 100);
  assert.equal(eraseWholeStrokeAt(stroke, { x: 50, y: 1 }, 2).fragments.length, 0);
  const miss = eraseWholeStrokeAt(stroke, { x: 50, y: 50 }, 2);
  assert.equal(miss.changed, false);
  assert.equal(miss.fragments[0], stroke);
});

test("group scaling moves images and strokes around one shared anchor", () => {
  const image = imageElement("image", 10);
  const stroke = lineStroke("stroke", 30, 40);
  const scaledImage = structuredClone(image);
  const scaledStroke = structuredClone(stroke);
  scaleElementFromAnchor(scaledImage, image, { x: 0, y: 0 }, 2);
  scaleElementFromAnchor(scaledStroke, stroke, { x: 0, y: 0 }, 2);
  assert.deepEqual({ x: scaledImage.x, width: scaledImage.width }, { x: 20, width: 20 });
  assert.deepEqual(scaledStroke.points.map((point) => point.x), [60, 80]);
  assert.equal(scaledStroke.size, 4);
});

test("eraser path sampling fills gaps between sparse input events", () => {
  const samples = sampleEraserPath({ x: 0, y: 0 }, { x: 30, y: 0 }, 7);
  assert.deepEqual(samples[samples.length - 1], { x: 30, y: 0 });
  let previous = { x: 0, y: 0 };
  for (const sample of samples) {
    assert.ok(Math.hypot(sample.x - previous.x, sample.y - previous.y) <= 7);
    previous = sample;
  }
});

test("one local eraser gesture is restored by one board-history undo", () => {
  const history = new BoardHistory();
  let board = emptyBoard();
  const unrelated = imageElement("unrelated", 300);
  board.elements = [lineStroke("source", 0, 100), unrelated];
  history.beginElements(board, "local erase");
  const erased = eraseStrokeAt(board.elements[0] as Stroke, { x: 50, y: 0 }, 9, () => "fragment");
  board.elements = [...erased.fragments, unrelated];
  history.commit(board);
  assert.equal(board.elements.length, 3);
  assert.equal(history.usage.undoCount, 1);
  board = history.undo(board);
  assert.equal(board.elements.length, 2);
  assert.deepEqual((board.elements[0] as Stroke).points.map((point) => point.x), [0, 100]);
  assert.equal(board.elements[1], unrelated);
  board = history.redo(board);
  assert.deepEqual(board.elements.map((element) => element.id), ["source", "fragment", "unrelated"]);
  assert.equal(board.elements[2], unrelated);
});

test("recovering images records only inserted elements as one undo step", () => {
  const history = new BoardHistory();
  let board = emptyBoard();
  const existing = lineStroke("existing", 0, 20);
  const recovered = [imageElement("recovered-a", 10), imageElement("recovered-b", 30)];
  board.elements = [existing];
  history.beginElements(board, "recover images");
  board.elements.push(...recovered);
  history.commit(board);
  assert.equal(history.usage.undoCount, 1);
  board = history.undo(board);
  assert.deepEqual(board.elements.map((element) => element.id), ["existing"]);
  assert.equal(board.elements[0], existing);
  board = history.redo(board);
  assert.deepEqual(board.elements.map((element) => element.id), ["existing", "recovered-a", "recovered-b"]);
});

test("a no-op element gesture consumes no history memory", () => {
  const history = new BoardHistory();
  const board = emptyBoard();
  board.elements.push(lineStroke("untouched", 0, 10));
  history.beginElements(board);
  history.commit(board);
  assert.deepEqual(history.usage, { undoCount: 0, redoCount: 0, estimatedBytes: 0 });
});

test("element history snapshots a camera change without retaining a mutable camera reference", () => {
  const history = new BoardHistory();
  let board = emptyBoard();
  history.beginElements(board);
  board.camera.x = 42;
  history.commit(board);
  board.camera.x = 80;
  board = history.undo(board);
  assert.equal(board.camera.x, 0);
  board = history.redo(board);
  assert.equal(board.camera.x, 42);
});

test("SelectionController cancels an interrupted drag without leaving partial data", () => {
  const elements = [imageElement("a", 0)];
  const selection = new SelectionController();
  selection.start(elements, elements, 1, { x: 5, y: 5 }, 1, false);
  assert.equal(selection.update(elements, { x: 25, y: 5 }, 1), true);
  assert.equal(elements[0].x, 20);
  assert.equal(selection.cancel(elements), true);
  assert.equal(elements[0].x, 0);
});

test("SelectionController produces a compact before/after edit only on completion", () => {
  const elements = [imageElement("a", 0), imageElement("b", 100)];
  const selection = new SelectionController();
  selection.start(elements, elements, 1, { x: 5, y: 5 }, 1, false);
  const edit = selection.finish(elements, { x: 15, y: 5 }, 1);
  assert.equal(edit?.before.length, 1);
  assert.equal(edit?.after[0].type === "image" ? edit.after[0].x : -1, 10);
});

test("SelectionController supports rectangle selection and multi-element resize", () => {
  const elements = [imageElement("a", 0), imageElement("b", 30), imageElement("far", 200)];
  const selection = new SelectionController();
  selection.start(elements, [], 1, { x: -5, y: -5 }, 1, false, "rectangle");
  selection.update(elements, { x: 50, y: 20 }, 1);
  selection.finish(elements, { x: 50, y: 20 }, 1);
  assert.deepEqual([...selection.selectedIds], ["a", "b"]);

  selection.start(elements, [], 2, { x: 40, y: 10 }, 1, false, "rectangle");
  const edit = selection.finish(elements, { x: 80, y: 20 }, 1);
  assert.equal(edit?.before.length, 2);
  assert.ok((elements[0] as BoardImage).width > 10);
  assert.ok((elements[1] as BoardImage).x > 30);
});

test("SelectionController records one crop edit and restores a cancelled crop", () => {
  const image = imageElement("crop-controller", 0);
  image.width = 100;
  image.height = 80;
  const elements = [image];
  const selection = new SelectionController();
  selection.setSelected([image.id]);
  selection.setImageEditMode("crop");
  selection.start(elements, elements, 1, { x: 0, y: 40 }, 1, false);
  assert.equal(selection.dragView?.kind, "crop");
  const edit = selection.finish(elements, { x: 20, y: 40 }, 1);
  assert.equal(edit?.before.length, 1);
  assert.equal((edit?.after[0] as BoardImage).crop.x, 0.2);

  selection.setImageEditMode("crop");
  const current = elements[0] as BoardImage;
  selection.start(elements, elements, 2, imageCropHandlePoints(current).e, 1, false);
  selection.update(elements, { x: 60, y: 40 }, 1);
  assert.equal(selection.cancel(elements), true);
  assert.equal((elements[0] as BoardImage).width, 80);
});

test("SelectionController supports free rotation and blocks locked image editing", () => {
  const image = imageElement("rotate-controller", 0);
  image.width = 100;
  image.height = 80;
  const elements = [image];
  const selection = new SelectionController();
  selection.setSelected([image.id]);
  selection.setImageEditMode("rotate");
  selection.start(elements, elements, 1, imageRotationHandlePoint(image, 34), 1, false);
  assert.equal(selection.dragView?.kind, "rotate");
  const edit = selection.finish(elements, { x: 120, y: 40 }, 1);
  assert.equal((edit?.after[0] as BoardImage).rotation, 90);

  image.locked = true;
  selection.setImageEditMode("crop");
  selection.start(elements, elements, 2, imageCropHandlePoints(image).n, 1, false);
  assert.notEqual(selection.dragView?.kind, "crop");
  assert.equal(selection.update(elements, { x: 50, y: 20 }, 1), false);
});

test("element commands undo edits without cloning unrelated board elements", () => {
  let board = emptyBoard();
  board.elements = [imageElement("a", 0), imageElement("b", 100)];
  const moved = structuredClone(board.elements[0]) as BoardImage;
  moved.x = 30;
  const update = new UpdateElementsCommand([board.elements[0]], [moved]);
  board = update.execute(board);
  assert.equal((board.elements[0] as BoardImage).x, 30);
  board = update.undo(board);
  assert.equal((board.elements[0] as BoardImage).x, 0);

  const inserted = imageElement("c", 200);
  const insert = new InsertElementsCommand([{ index: 1, element: inserted }]);
  board = insert.execute(board);
  assert.deepEqual(board.elements.map((element) => element.id), ["a", "c", "b"]);
  board = insert.undo(board);
  const remove = new DeleteElementsCommand([{ index: 0, element: board.elements[0] }]);
  board = remove.execute(board);
  board = remove.undo(board);
  assert.deepEqual(board.elements.map((element) => element.id), ["a", "b"]);

  const reorder = new ReorderElementsCommand(["a", "b"], ["b", "a"]);
  board = reorder.execute(board);
  assert.deepEqual(board.elements.map((element) => element.id), ["b", "a"]);
  board = reorder.undo(board);
  assert.deepEqual(board.elements.map((element) => element.id), ["a", "b"]);
});

test("board history records an applied element edit as one undoable command", () => {
  const history = new BoardHistory();
  let board = emptyBoard();
  board.elements = [imageElement("a", 0), imageElement("b", 100)];
  const moved = structuredClone(board.elements[0]) as BoardImage;
  moved.x = 40;
  const command = new UpdateElementsCommand([board.elements[0]], [moved]);
  board = command.execute(board);
  history.recordApplied(command);

  board = history.undo(board);
  assert.equal((board.elements[0] as BoardImage).x, 0);
  assert.equal((board.elements[1] as BoardImage).x, 100);
  board = history.redo(board);
  assert.equal((board.elements[0] as BoardImage).x, 40);
  assert.equal((board.elements[1] as BoardImage).x, 100);
});

test("completed strokes use element history and preserve later unrelated content", () => {
  const history = new BoardHistory();
  const existing = imageElement("existing", 0);
  const stroke = lineStroke("new-stroke", 0, 10);
  let board = emptyBoard();
  board.elements = [existing, stroke];
  history.recordApplied(new InsertElementsCommand([{ index: 1, element: stroke }], "书写笔迹"));

  const later = imageElement("later", 20);
  board.elements.push(later);
  board = history.undo(board);
  assert.deepEqual(board.elements.map((element) => element.id), ["existing", "later"]);
  assert.equal(board.elements[1], later);
  board = history.redo(board);
  assert.deepEqual(board.elements.map((element) => element.id), ["existing", "new-stroke", "later"]);
});

test("imported images use element history and preserve later edits on undo", () => {
  const history = new BoardHistory();
  const existing = imageElement("existing", 0);
  const imported = [imageElement("import-a", 10), imageElement("import-b", 20)];
  let board = emptyBoard();
  board.elements = [existing, ...imported];
  history.recordApplied(new InsertElementsCommand(imported.map((element, index) => ({ index: index + 1, element })), "导入图片"));

  const later = imageElement("later", 30);
  board.elements.push(later);
  board = history.undo(board);
  assert.deepEqual(board.elements.map((element) => element.id), ["existing", "later"]);
  assert.equal(board.elements[1], later);
  board = history.redo(board);
  assert.deepEqual(board.elements.map((element) => element.id), ["existing", "import-a", "import-b", "later"]);
});

test("spatial index returns only elements intersecting queried cells", () => {
  const elements = [imageElement("near", 0), imageElement("far", 2000)];
  const index = new ElementSpatialIndex(100);
  index.rebuild(elements);
  assert.deepEqual(index.query(elements, { minX: -20, minY: -20, maxX: 50, maxY: 50 }).map((element) => element.id), ["near"]);
  elements[0].x = 1000;
  index.upsert(elements[0]);
  assert.deepEqual(index.query(elements, { minX: -20, minY: -20, maxX: 50, maxY: 50 }), []);
  assert.equal(index.query(elements, { minX: 990, minY: -20, maxX: 1050, maxY: 50 })[0], elements[0]);
});

test("spatial index keeps layer order through eraser splits and selected offscreen elements", () => {
  const before = [imageElement("bottom", 0), lineStroke("stroke", 0, 40), imageElement("top", 20)];
  const index = new ElementSpatialIndex(20);
  index.rebuild(before);
  const first = lineStroke("stroke", 0, 10);
  const second = lineStroke("fragment", 30, 40);
  const after = [before[0], first, second, before[2]];
  index.replace("stroke", [first, second]);
  const region = { minX: -10, minY: -10, maxX: 60, maxY: 20 };
  assert.deepEqual(index.query(after, region).map((element) => element.id), after.map((element) => element.id));
  assert.equal(index.query(after, region)[0], before[0]);

  const offscreen = { minX: 1000, minY: 1000, maxX: 1010, maxY: 1010 };
  assert.deepEqual(index.query(after, offscreen, new Set(["top", "bottom"])).map((element) => element.id), ["bottom", "top"]);
  index.replace("stroke", []);
  assert.deepEqual(index.query([before[0], second, before[2]], region).map((element) => element.id), ["bottom", "fragment", "top"]);
});

test("spatial index bounds its cell scan for enormous viewports", () => {
  const elements = [imageElement("left", -2000), imageElement("right", 2000)];
  const index = new ElementSpatialIndex(10);
  index.rebuild(elements);
  const hugeViewport = { minX: -1_000_000, minY: -1_000_000, maxX: 1_000_000, maxY: 1_000_000 };
  assert.deepEqual(index.query(elements, hugeViewport).map((element) => element.id), ["left", "right"]);
});

test("spatial index matches a full scan for rotated and globally indexed images", () => {
  const rotated = imageElement("rotated", 0);
  rotated.width = 100;
  rotated.height = 30;
  rotated.rotation = 45;
  const huge = imageElement("huge", -100000);
  huge.width = 200000;
  huge.height = 200000;
  const elements = [rotated, imageElement("far", 3000), huge];
  const index = new ElementSpatialIndex(10);
  index.rebuild(elements);
  const viewports = [
    { minX: -20, minY: -20, maxX: 100, maxY: 100 },
    { minX: 2990, minY: -10, maxX: 3020, maxY: 40 },
    { minX: 200001, minY: 200001, maxX: 200010, maxY: 200010 }
  ];
  for (const viewport of viewports) {
    const expected = elements.filter((element) => boundsIntersect(elementBounds(element), viewport));
    assert.deepEqual(index.query(elements, viewport).map((element) => element.id), expected.map((element) => element.id));
  }
});

test("spatial index safely handles an element spanning thousands of cells", () => {
  const huge = imageElement("huge", -100000);
  huge.width = 200000;
  huge.height = 200000;
  const index = new ElementSpatialIndex(10);
  index.rebuild([huge]);
  assert.equal(index.query([huge], { minX: 0, minY: 0, maxX: 10, maxY: 10 })[0]?.id, "huge");
});
