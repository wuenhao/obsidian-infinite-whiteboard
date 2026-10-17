import {
  App,
  FileView,
  Modal,
  Notice,
  Platform,
  Plugin,
  TFile,
  TFolder,
  WorkspaceLeaf,
  normalizePath,
  setIcon
} from "obsidian";
import { cloneBoard, emptyBoard, makeId, parseBoard } from "./src/model/board";
import { normalizedBoardName } from "./src/model/board-file-name";
import { advanceBoardRevision, createBoardRevision } from "./src/model/revision";
import {
  BoardData,
  BoardElement,
  BoardImage,
  BrushConfig,
  BrushKind,
  DEFAULT_SETTINGS,
  PluginSettings,
  Point,
  ScreenPoint,
  Stroke,
  Tool
} from "./src/model/types";
import { mergeSettings } from "./src/plugin/settings";
import { pressureOutline, pressureScale, smoothCenterline } from "./src/rendering/stroke-geometry";
import { strokeCompositeOperation } from "./src/rendering/stroke-paint";
import { SceneRenderer } from "./src/rendering/scene-renderer";
import { BoardHistory } from "./src/history/board-history";
import { findStylusTouch, findTouch, IosInputMode, isStylusOnlyTouchList, isStylusPointer, shouldRecoverMissingStylus, shouldRecoverPenPointerMove, shouldStartStylusTouchFallback, usesCanvasPointerCapture, usesNativeStylusTouch } from "./src/platform/stylus";
import { serializeBoard } from "./src/persistence/serialization";
import { BoardSaveState } from "./src/persistence/save-state";
import { ConflictRecoveryState } from "./src/persistence/conflict-recovery";
import { externalBoardUpdateDecision } from "./src/persistence/external-update";
import { BoardSaveFlights, BoardSession, BoardSessionToken } from "./src/persistence/board-session";
import { Bounds, handlePoints, imageCorners, imageCropHandlePoints, imageRotationHandlePoint, translateElement } from "./src/selection/geometry";
import { Alignment, Distribution, alignElements, distributeElements } from "./src/selection/operations";
import { ImageEditMode, SelectionController } from "./src/selection/controller";
import { DeleteElementsCommand, InsertElementsCommand, UpdateElementsCommand } from "./src/history/element-commands";
import { planToolTransition, ToolControllerRegistry, ToolInput } from "./src/tools/registry";
import { LaserController } from "./src/tools/laser-controller";
import { eraseStrokeAt, eraseWholeStrokeAt, sampleEraserPath } from "./src/tools/stroke-eraser";
import { ElementSpatialIndex } from "./src/rendering/spatial-index";
import { InputFlightRecorder } from "./src/platform/input-flight-recorder";
import { BUILD_FINGERPRINT, RUNTIME_VERSION, runtimeMatchesManifest } from "./src/platform/runtime-integrity";
import { InputToolMetrics, TrackedInputTool } from "./src/platform/input-tool-metrics";
import { diagnosticCounterSnapshot } from "./src/platform/diagnostic-snapshot";
import { persistedCameraResizeDelta } from "./src/platform/canvas-resize";
import { acceptsFileTransfer, extensionForImageMime, imageFilesFromTransfer, looksLikeImage, readImageUrlDimensions } from "./src/assets/image-assets";
import { BoardAssetCoordinator } from "./src/assets/board-asset-coordinator";
import { boardHealthSnapshot, BoardHealthSnapshot } from "./src/assets/board-health";
import { ImageImportService } from "./src/assets/image-import-service";
import { ImageImportTask } from "./src/assets/image-import-task";
import { ColorSource, inferredColorSource, isColorTool } from "./src/ui/creative-toolbar";
import { createCreativeToolbar, CreativeToolbarView } from "./src/ui/creative-toolbar-view";
import { BrushSettingsPanel, isConfigurableTool } from "./src/ui/brush-settings-panel";
import { bindPhoneGestures, supportsPhoneFingerDrawing } from "./src/ui/touch-controls";
import { pasteMenuPointFromClient, pasteMenuPosition, useSystemPasteTarget } from "./src/ui/canvas-paste-position";
import { RapidTapSequence } from "./src/ui/rapid-tap-sequence";

const VIEW_TYPE = "infinite-board-view";
const BOARD_EXTENSION = "board";
type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";

class DiagnosticReportModal extends Modal {
  constructor(app: App, private readonly report: string) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "输入诊断日志" });
    this.contentEl.createDiv({ text: "长按下面的文本并全选复制，然后直接发给我。" });
    const text = this.contentEl.createEl("textarea", {
      cls: "infinite-board-diagnostic-report",
      attr: { readonly: "", "aria-label": "输入诊断日志" }
    });
    text.value = this.report;
    const select = this.contentEl.createEl("button", { cls: "mod-cta", text: "全选日志", attr: { type: "button" } });
    select.addEventListener("click", () => {
      text.focus();
      text.select();
    });
  }
}

class RenameBoardModal extends Modal {
  private input?: HTMLInputElement;

  constructor(app: App, private readonly currentName: string, private readonly rename: (name: string) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("重命名画板");
    const form = this.contentEl.createEl("form", { cls: "infinite-board-rename-form" });
    form.createEl("label", { text: "画板名称", attr: { for: "infinite-board-rename-input" } });
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
    const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: "完成", attr: { type: "submit" } });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = this.input?.value ?? "";
      void this.submit(name);
    });
    window.setTimeout(() => {
      this.input?.focus();
      this.input?.select();
    }, 0);
  }

  private async submit(name: string): Promise<void> {
    try {
      await this.rename(name);
      this.close();
    } catch (error) {
      console.error("Infinite Board: rename failed", error);
      new Notice(error instanceof Error ? error.message : "画板重命名失败，请稍后重试。", 5000);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class SaveRecoveryModal extends Modal {
  constructor(
    app: App,
    private readonly canRetry: boolean,
    private readonly retry: () => void,
    private readonly saveRecoveryCopy: () => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("保存失败，当前内容仍在");
    this.contentEl.createDiv({ text: "画板还保留在当前页面。你可以重试保存；若担心同步或存储异常，也可以先另存一份恢复副本。" });
    const actions = this.contentEl.createDiv({ cls: "infinite-board-crop-actions" });
    const close = actions.createEl("button", { text: "稍后处理", attr: { type: "button" } });
    close.addEventListener("click", () => this.close());
    const backup = actions.createEl("button", { text: "另存恢复副本", attr: { type: "button" } });
    backup.addEventListener("click", () => void this.saveCopy(backup));
    if (this.canRetry) {
      const retry = actions.createEl("button", { cls: "mod-cta", text: "立即重试", attr: { type: "button" } });
      retry.addEventListener("click", () => {
        this.retry();
        this.close();
      });
    }
  }

  private async saveCopy(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      await this.saveRecoveryCopy();
      this.close();
    } catch (error) {
      console.error("Infinite Board: recovery copy failed", error);
      button.disabled = false;
      new Notice("恢复副本创建失败。请保持当前画板打开并检查存储空间或 Sync 状态。", 6000);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class ConflictRecoveryModal extends Modal {
  constructor(
    app: App,
    private readonly conflictPath: string,
    private readonly openConflictCopy: () => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("同步冲突已保护");
    this.contentEl.createDiv({ text: "当前画板没有被同步内容覆盖。本地内容已另存为独立冲突副本，原画板保持停止保存。" });
    this.contentEl.createDiv({ cls: "infinite-board-recovery-path", text: `冲突副本：${this.conflictPath}` });
    const actions = this.contentEl.createDiv({ cls: "infinite-board-crop-actions" });
    const close = actions.createEl("button", { text: "关闭", attr: { type: "button" } });
    close.addEventListener("click", () => this.close());
    const open = actions.createEl("button", { cls: "mod-cta", text: "打开冲突副本", attr: { type: "button" } });
    open.addEventListener("click", () => void this.openCopy(open));
  }

  private async openCopy(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      await this.openConflictCopy();
      this.close();
    } catch (error) {
      console.error("Infinite Board: open conflict copy failed", error);
      button.disabled = false;
      new Notice("无法打开冲突副本，请在文件列表中按上方路径查找。", 6000);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class ImageRecoveryModal extends Modal {
  constructor(
    app: App,
    private readonly health: BoardHealthSnapshot,
    private readonly recover: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "画板图片与同步检查" });
    this.contentEl.createDiv({ text: `画板文件：${(this.health.boardBytes / 1024 / 1024).toFixed(2)} MB` });
    this.contentEl.createDiv({ text: `已引用图片：${this.health.referencedImages} 张；缺失附件：${this.health.missingImages} 张；未关联附件：${this.health.unlinkedPaths.length} 张` });
    if (this.health.missingImages > 0) this.contentEl.createDiv({ text: "缺失附件仍需等待 Obsidian Sync 下载完成。插件会在后台进行有界重试。" });
    if (this.health.unlinkedPaths.length > 0) {
      this.contentEl.createDiv({ text: "未关联附件存在于当前画板的 .assets 文件夹，但画板 JSON 没有记录其位置。恢复后会按网格放到当前视口，可撤销；附件不会被移动或删除。" });
      const list = this.contentEl.createEl("ul");
      for (const path of this.health.unlinkedPaths.slice(0, 12)) list.createEl("li", { text: path.split("/").pop() ?? path });
      if (this.health.unlinkedPaths.length > 12) list.createEl("li", { text: `另有 ${this.health.unlinkedPaths.length - 12} 张……` });
    }
    const actions = this.contentEl.createDiv({ cls: "infinite-board-crop-actions" });
    const close = actions.createEl("button", { text: "关闭", attr: { type: "button" } });
    close.addEventListener("click", () => this.close());
    if (this.health.unlinkedPaths.length > 0) {
      const apply = actions.createEl("button", { cls: "mod-cta", text: `恢复 ${this.health.unlinkedPaths.length} 张图片`, attr: { type: "button" } });
      apply.addEventListener("click", () => {
        this.close();
        this.recover();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export default class InfiniteBoardPlugin extends Plugin {
  settings: PluginSettings = structuredClone(DEFAULT_SETTINGS);

  async onload(): Promise<void> {
    if (!runtimeMatchesManifest(this.manifest.version)) {
      new Notice(`Infinite Board 文件尚未同步完整：运行时代码 ${RUNTIME_VERSION}，清单 ${this.manifest.version}。请等待 Obsidian Sync 完成后彻底退出并重新打开 Obsidian。`, 12000);
    }
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new InfiniteBoardView(leaf, this));
    this.registerExtensions([BOARD_EXTENSION], VIEW_TYPE);
    const syncMobileFocus = (leaf: WorkspaceLeaf | null): void => {
      const active = Platform.isPhone && leaf?.view.getViewType() === VIEW_TYPE;
      document.body.classList.toggle("infinite-board-mobile-focus", active);
    };
    this.registerEvent(this.app.workspace.on("active-leaf-change", syncMobileFocus));
    this.app.workspace.onLayoutReady(() => syncMobileFocus(this.app.workspace.activeLeaf));

    this.addRibbonIcon("pen-tool", "新建无限画布", () => void this.createBoard());
    this.addCommand({
      id: "create-board",
      name: "新建无限画布",
      callback: () => void this.createBoard()
    });
    this.addCommand({
      id: "recover-unlinked-board-images",
      name: "检查并恢复当前画板图片",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(InfiniteBoardView);
        if (!view) return false;
        if (!checking) void view.inspectAndRecoverImages();
        return true;
      }
    });
  }

  onunload(): void {
    document.body.classList.remove("infinite-board-mobile-focus");
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = mergeSettings(loaded);
  }

  private async createBoard(): Promise<void> {
    const folder = "Infinite Boards";
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }

    const stamp = window.moment().format("YYYY-MM-DD HH-mm-ss");
    const path = normalizePath(`${folder}/无限画布 ${stamp}.${BOARD_EXTENSION}`);
    const file = await this.app.vault.create(path, serializeBoard(emptyBoard()));
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }
}

class InfiniteBoardView extends FileView {
  private plugin: InfiniteBoardPlugin;
  private data: BoardData = emptyBoard();
  private canSave = true;
  private readonly saveState = new BoardSaveState();
  private get dirty(): boolean { return this.saveState.dirty; }
  private get revision(): number { return this.saveState.revision; }
  private get isSaving(): boolean { return this.saveState.saving; }
  private get lastSavedContent(): string { return this.saveState.lastSavedContent; }
  private get conflictDetected(): boolean { return this.saveState.conflictDetected; }
  private readonly conflictRecovery = new ConflictRecoveryState();
  private readonly boardSession = new BoardSession();
  private readonly saveFlights = new BoardSaveFlights();
  private readonly imageImportTasks = new Set<ImageImportTask>();
  private externalCheckTimer = 0;
  private inputFrame: HTMLIFrameElement | null = null;
  private canvas!: HTMLCanvasElement;
  private context!: CanvasRenderingContext2D;
  private toolbar!: HTMLElement;
  private palette!: HTMLElement;
  private toolbarUi: CreativeToolbarView | null = null;
  private canvasPasteMenu!: HTMLElement;
  private canvasPasteActions!: HTMLElement;
  private canvasPasteTarget!: HTMLElement;
  private canvasPasteProxy: HTMLElement | null = null;
  private canvasPasteProxyTimer = 0;
  private canvasPastePoint: ScreenPoint = { x: 0, y: 0 };
  private brushPanel!: HTMLElement;
  private brushPanelView: BrushSettingsPanel | null = null;
  private brushPanelColorOnly = false;
  private readonly colorSources = new Map<BrushKind | "laser", ColorSource>();
  private selectionToolbar!: HTMLElement;
  private readonly selectionActionButtons = new Map<string, HTMLButtonElement>();
  private imageInput!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private diagnosticsEl!: HTMLElement;
  private diagnosticsBodyEl!: HTMLElement;
  private diagnosticsEventsEl!: HTMLElement;
  private diagnosticsInputModeButton!: HTMLButtonElement;
  private readonly diagnosticValueEls = new Map<string, HTMLElement>();
  private readonly headerActionEls: HTMLElement[] = [];
  private readonly diagnosticsStatusTaps = new RapidTapSequence(5, 1500);
  private diagnosticsVisible = false;
  private diagnosticTimer = 0;
  private lastDiagnosticUpdate = 0;
  private lastInputType = "尚未检测";
  private pencilDetected = false;
  private lastPressure = 0;
  private sampleRate = 0;
  private lastSampleTime = 0;
  private coalescedSamples = 0;
  private lastOutlinePointCount = 0;
  private recentPointerEvents: string[] = [];
  private penPointerStarts = 0;
  private stylusTouchStarts = 0;
  private stylusHandoffs = 0;
  private pointerFallbackStrokes = 0;
  private orphanedStylusRecoveries = 0;
  private maxEventLoopDelay = 0;
  private lastSaveDuration = 0;
  private maxSaveDuration = 0;
  private inputDocumentScrolls = 0;
  private hostDocumentScrolls = 0;
  private hostDocumentPenStarts = 0;
  private scribbleTouchCancels = 0;
  private recoveredPointerStarts = 0;
  private stylusTouchFallbackStarts = 0;
  private presentationRecoveryFrames = 0;
  private penButtonPress: { pointerId: number; button: HTMLButtonElement } | null = null;
  private lastPenActivatedButton: HTMLButtonElement | null = null;
  private suppressPenClickUntil = 0;
  private dispatchingPenButtonClick = false;
  private lastHitTarget = "--";
  private readonly inputTrace = new InputFlightRecorder();
  private readonly inputToolMetrics = new InputToolMetrics();
  private activeDiagnosticTool: TrackedInputTool | null = null;
  private lastTracedMoveAt = 0;
  private lastCanvasCssWidth = 0;
  private lastCanvasCssHeight = 0;
  private resizeObserver?: ResizeObserver;
  private resizeCameraPersistenceReady = false;
  private resizePersistenceFrame = 0;
  private frame = 0;
  private presentationFrame = 0;
  private presentationUntil = 0;
  private tool: Tool;
  private currentStroke: Stroke | null = null;
  private readonly useIosTouchEvents = Platform.isIosApp;
  // The default follows the same ownership boundary used by mature canvas
  // applications: Pointer Events reach the canvas first, which captures the
  // active pointer for the rest of the gesture. Legacy Stylus Touch remains
  // available only as an in-memory diagnostic fallback.
  private iosInputMode: IosInputMode = "pointer-capture";
  private iosStylusTouchConfirmed = false;
  private activeInputSource: "pointer" | "touch" | null = null;
  private stylusTouchId: number | null = null;
  private drawingPointer: number | null = null;
  private activePointerStartedAt = 0;
  private penPointer: number | null = null;
  private stylusPointerIds = new Set<number>();
  private touchPointers = new Map<number, ScreenPoint>();
  private lastTouchCenter: ScreenPoint | null = null;
  private lastPinchDistance = 0;
  private history = new BoardHistory();
  private saveTimer = 0;
  private readonly boardAssets: BoardAssetCoordinator;
  private strokePathCache = new Map<string, { pointCount: number; path: Path2D }>();
  private readonly sceneRenderer = new SceneRenderer();
  private readonly laserController: LaserController;
  private readonly toolControllers = new ToolControllerRegistry();
  private laserFrame = 0;
  private activeInputPersistent = true;
  private lastEraserPoint: ScreenPoint | null = null;
  private eraserPreview: ScreenPoint | null = null;
  private elementClipboard: BoardElement[] = [];
  private pasteSequence = 0;
  private canvasLongPress: { pointerId: number; x: number; y: number; clientX: number; clientY: number; timer: number; ready: boolean } | null = null;
  private ignoreCanvasContextMenuUntil = 0;
  private phoneFingerInput: { pointerId: number; down: PointerEvent; started: boolean } | null = null;
  private phoneFingerDrawingPointer: number | null = null;
  private boardTitleEl: HTMLElement | null = null;
  private visibleSaveState: SaveState = "saved";
  private selection = new SelectionController();
  private spatialIndex = new ElementSpatialIndex();

  constructor(leaf: WorkspaceLeaf, plugin: InfiniteBoardPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.tool = plugin.settings.activeTool;
    this.boardAssets = new BoardAssetCoordinator({
      resourceUrl: (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
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

  async onOpen(): Promise<void> {
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
      if (file instanceof TFile) {
        void this.onExternalModify(file);
        this.onReferencedImageAvailable(file);
      }
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile) this.onReferencedImageAvailable(file);
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf !== this.leaf) this.cancelImageImports();
    }));
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "无限画布";
  }

  private registerBoardTitleRename(): void {
    const leaf = this.containerEl.closest(".workspace-leaf");
    const title = leaf?.querySelector<HTMLElement>(".view-header-title") ?? null;
    if (!title || title === this.boardTitleEl) return;
    this.boardTitleEl = title;
    title.addClass("infinite-board-title-rename-target");
    title.setAttribute("role", "button");
    title.setAttribute("tabindex", "0");
    title.setAttribute("aria-label", "重命名画板");
    title.setAttribute("title", "点击重命名画板");
    const open = (): void => this.openRenameBoardModal();
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

  private openRenameBoardModal(): void {
    if (!this.file) return;
    new RenameBoardModal(this.app, this.file.basename, async (rawName) => {
      const name = normalizedBoardName(rawName);
      if (!name) throw new Error("请输入名称，且不要使用 / \\ : * ? \" < > | 等字符。");
      if (!this.file) throw new Error("当前画板已关闭，请重新打开后再重命名。");
      const parent = this.file.parent?.path ?? "";
      const path = normalizePath(`${parent}/${name}.${BOARD_EXTENSION}`);
      if (path === this.file.path) return;
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing && existing !== this.file) throw new Error("已有同名文件，请换一个名称。");
      await this.app.fileManager.renameFile(this.file, path);
      new Notice("画板已重命名。", 2000);
    }).open();
  }

  getIcon(): string {
    return "pen-tool";
  }

  async onLoadFile(file: TFile): Promise<void> {
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

  async onUnloadFile(file: TFile): Promise<void> {
    const session = this.boardSession.currentForFile(file);
    if (session) this.cancelImageImports(session);
    this.toolbarUi?.dispose();
    this.toolbarUi = null;
    this.brushPanelView?.dispose();
    this.brushPanelView = null;
    window.clearTimeout(this.saveTimer);
    window.clearTimeout(this.externalCheckTimer);
    this.resizeObserver?.disconnect();
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

  private async loadDataFromFile(file: TFile, session: BoardSessionToken): Promise<void> {
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
      new Notice("画布数据无法读取，已打开一个空白恢复视图。原文件未被覆盖。", 6000);
    }
  }

  private buildUi(): void {
    this.clearHeaderActions();
    this.toolbarUi?.dispose();
    this.brushPanelView?.dispose();
    this.contentEl.empty();
    this.contentEl.addClass("infinite-board-view");
    this.contentEl.toggleClass("is-desktop", Platform.isDesktop);
    this.contentEl.toggleClass("is-phone", Platform.isPhone);
    this.contentEl.toggleClass("is-tablet", Platform.isTablet);

    // Obsidian places newer ItemView actions to the visual left. Register in
    // reverse order so the title bar reads left-to-right as requested.
    // Diagnostics is hidden from the title bar; five rapid taps on the save
    // status open it without consuming another header action slot.
    this.addHeaderAction("maximize", "适合内容", () => this.fitContent());
    this.addHeaderAction("image-plus", "插入图片", () => this.openImagePicker());
    this.addHeaderAction("redo-2", "重做", () => this.redo());
    this.addHeaderAction("undo-2", "撤销", () => this.undo());

    this.toolbarUi = createCreativeToolbar(this.contentEl, {
      selectTool: (tool) => {
        if (this.tool === tool && isConfigurableTool(tool)) this.toggleBrushPanel(false);
        else this.setTool(tool);
      },
      selectColor: (color) => this.applyToolbarColor(color, "preset"),
      openMoreColors: () => {
        if (!isColorTool(this.tool)) return;
        this.brushPanelColorOnly = true;
        this.brushPanel.hidden = false;
        this.renderBrushPanel();
        this.updateToolButtons();
      },
      collapse: () => {
        this.brushPanel.hidden = true;
        this.brushPanelView?.dispose();
        this.updateToolButtons();
      }
    });
    this.toolbar = this.toolbarUi.toolbar;
    this.palette = this.toolbarUi.palette;

    this.statusEl = this.contentEl.createDiv({ cls: "infinite-board-save-status" });
    this.statusEl.setAttribute("role", "button");
    this.statusEl.setAttribute("tabindex", "0");
    this.statusEl.setAttribute("aria-label", "保存状态；连续快速点击五次打开输入诊断");
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
        this.brushPanel.hidden = true;
        this.brushPanelColorOnly = false;
        this.brushPanelView?.dispose();
        this.updateToolButtons();
      },
      updateButtons: () => this.updateToolButtons(),
      saveSettings: () => { void this.plugin.saveSettings(); },
      scheduleRender: () => this.scheduleRender(),
      colorSource: (tool, color) => this.colorSource(tool, color),
      setMoreColor: (tool) => { this.colorSources.set(tool, "more"); }
    });
    this.buildSelectionToolbar();

    this.imageInput = this.contentEl.createEl("input", {
      cls: "infinite-board-file-input",
      attr: { type: "file", accept: "image/*", multiple: "", "aria-label": "选择图片" }
    });
    this.registerDomEvent(this.imageInput, "change", () => {
      const files = Array.from(this.imageInput.files ?? []);
      this.imageInput.value = "";
      if (files.length) void this.importImages(files);
    });

    this.buildCanvasPasteMenu();
    this.registerHostScribbleGuard();

    this.canvas = this.createDrawingCanvas();
    const dismissSettings = (): void => {
      // The iPad canvas lives in a child document, so its pointerdown cannot
      // reach the outside-click listener on the parent View.
      if (!this.canvasPasteMenu.hidden) this.hideCanvasPasteMenu();
      if (this.brushPanel.hidden) return;
      this.brushPanel.hidden = true;
      this.brushPanelColorOnly = false;
      this.brushPanelView?.dispose();
      this.updateToolButtons();
    };
    this.registerDomEvent(this.canvas, "pointerdown", dismissSettings, { capture: true, passive: true });
    this.registerDomEvent(this.canvas, "touchstart", dismissSettings, { passive: true });
    if (Platform.isPhone) {
      this.register(bindPhoneGestures(this.canvas, (points, moving) => {
        if (points.length >= 2) this.cancelCanvasLongPress();
        if (this.penPointer !== null) return;
        if (this.phoneFingerDrawingPointer !== null) {
          if (points.length < 2) return;
          this.cancelPhoneFingerInput();
        }
        const sameContacts = points.length === this.touchPointers.size && points.every(point => this.touchPointers.has(point.id));
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
      // iOS Canvas is deliberately isolated in a child document for Pencil
      // stability. In split view, Photos may target either document and only
      // identify its payload as a generic file until the final drop.
      this.registerInputDocumentDropTarget(this.canvas.ownerDocument);
      this.registerImageDropTarget(this.contentEl);
    } else {
      this.registerImageDropTarget(this.canvas);
    }
    this.registerDomEvent(this.canvas, "contextmenu", (event) => {
      event.preventDefault();
      if (event.pointerType === "pen") return;
      if (useSystemPasteTarget(Platform.isIosApp, Platform.isTablet)) {
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
      if (Platform.isIosApp && !this.canvasPasteMenu.hidden) return;
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
    this.setSaveState(this.canSave ? (this.dirty ? "unsaved" : "saved") : "error");
    this.updateDiagnostics();
  }

  private phoneFingerUsesActiveTool(): boolean {
    return supportsPhoneFingerDrawing(this.tool);
  }

  private onPhoneFingerPointer(event: PointerEvent): void {
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
      // Do not begin a pen or eraser operation until the finger moves. This
      // lets a second finger turn the gesture into pan/zoom without leaving a
      // stray dot or erasing beneath the first finger.
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
      // A single tap remains a valid dot/stamp for the active drawing tool.
      this.phoneFingerDrawingPointer = active.pointerId;
      this.startPhoneFingerDrawing(active.down);
      active.started = true;
    }
    if (active.started) this.finishPhoneFingerDrawing(event, event.type === "pointercancel" ? "cancel" : "up");
    this.phoneFingerInput = null;
    this.phoneFingerDrawingPointer = null;
  }

  private startPhoneFingerDrawing(event: PointerEvent): void {
    const screen = this.eventPoint(event);
    window.clearTimeout(this.saveTimer);
    this.drawingPointer = event.pointerId;
    this.activeInputSource = "pointer";
    this.activePointerStartedAt = event.timeStamp;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Phone WebViews can reject capture for a short-lived direct touch.
    }
    if (this.tool === "eraser") {
      this.eraserPreview = this.screenToWorld(screen);
      this.activeInputPersistent = false;
      this.lastEraserPoint = null;
      this.pushHistory();
      this.eraseAlongPath(this.screenToWorld(screen));
    } else if (this.tool === "select") {
      this.activeInputPersistent = false;
      this.startSelection(event.pointerId, screen, false);
    } else if (this.tool === "laser") {
      this.activeDiagnosticTool = this.inputToolMetrics.recordStart(this.tool, "pointer");
      this.createLaserStroke(this.makePoint(this.screenToWorld(screen), event, 0.5));
    } else {
      this.activeDiagnosticTool = this.inputToolMetrics.recordStart(this.tool, "pointer");
      this.activeInputPersistent = true;
      this.markDirty(false);
      this.currentStroke = this.createPersistentStroke(this.makePoint(this.screenToWorld(screen), event));
      this.data.elements.push(this.currentStroke);
      this.spatialIndex.upsert(this.currentStroke);
    }
    event.preventDefault();
    this.scheduleRender();
  }

  private movePhoneFingerDrawing(event: PointerEvent): void {
    if (this.drawingPointer !== event.pointerId) return;
    const screen = this.eventPoint(event);
    if (this.tool === "eraser") {
      this.eraserPreview = this.screenToWorld(screen);
      for (const sample of this.pointerSamples(event)) this.eraseAlongPath(this.screenToWorld(this.eventPoint(sample)));
    } else if (this.tool === "select" && this.selection.activePointerId !== null) {
      this.updateSelection(this.screenToWorld(screen));
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

  private finishPhoneFingerDrawing(event: PointerEvent, kind: "up" | "cancel"): void {
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

  private cancelPhoneFingerInput(): void {
    const active = this.phoneFingerInput;
    this.cancelCanvasLongPress(active?.pointerId);
    if (active?.started && this.phoneFingerDrawingPointer === active.pointerId && this.drawingPointer === active.pointerId) {
      if (this.currentStroke) {
        const index = this.data.elements.findIndex((element) => element.id === this.currentStroke?.id);
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
        // A delayed second finger after erasing has begun cannot safely put
        // fragments back without a dedicated transaction. The normal pinch
        // path never starts erasing because drawing waits for the first move.
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

  private createDrawingCanvas(): HTMLCanvasElement {
    if (!this.useIosTouchEvents) {
      return this.contentEl.createEl("canvas", {
        cls: "infinite-board-canvas",
        attr: { tabindex: "0", "aria-label": "无限画布" }
      });
    }

    // Obsidian's mobile gesture recognizers live in the host document. A
    // same-origin blank child document gives Pencil an independent event
    // boundary while the plugin continues to own and render the canvas.
    const frame = this.contentEl.createEl("iframe", {
      cls: "infinite-board-input-frame",
      attr: { title: "无限画布输入层", tabindex: "-1" }
    });
    const document = frame.contentDocument;
    if (!document) throw new Error("iPad input document is unavailable");
    const styles = document.createElement("style");
    styles.textContent = `
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #f7f7f5;
        -webkit-touch-callout: none;
      }
      body {
        user-select: none;
        -webkit-user-select: none;
        overscroll-behavior: none;
      }
      .infinite-board-canvas {
        display: block;
        width: 100%;
        height: 100%;
        touch-action: none;
        outline: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }
    `;
    document.head.appendChild(styles);
    const canvas = document.createElement("canvas");
    canvas.className = "infinite-board-canvas";
    canvas.setAttribute("aria-label", "无限画布");
    document.body.appendChild(canvas);
    this.inputFrame = frame;
    return canvas;
  }

  private registerInputWindowEvents(): void {
    const inputWindow = this.canvas.ownerDocument.defaultView;
    if (!inputWindow) throw new Error("Drawing input window is unavailable");
    const inputDocument = this.canvas.ownerDocument;
    this.registerScribbleGuard(inputDocument, "input");
    // WebKit can enter text-selection/callout handling after repeated Pencil
    // contacts even though the canvas itself has no selectable text. Keep
    // that state machine out of the isolated drawing document.
    this.registerDomEvent(inputDocument, "selectstart", (event) => {
      if (this.canvasPasteProxy?.contains(event.target as Node)) return;
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
    // Legacy Stylus Touch keeps a capture route in the isolated input window.
    // The default Pointer Capture route remains attached to the canvas itself.
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

  private registerHostScribbleGuard(): void {
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
      // Cancelling the parallel stylus Touch stream prevents iPadOS Scribble,
      // but it also suppresses WebKit's synthesized click. Activate pen-tapped
      // buttons from pointerup while leaving finger, mouse, keyboard and
      // assistive-technology clicks on their existing path.
      this.lastPenActivatedButton = press.button;
      this.suppressPenClickUntil = performance.now() + 700;
      this.dispatchingPenButtonClick = true;
      press.button.click();
      this.dispatchingPenButtonClick = false;
      this.traceInput("pen-button-activated", this.traceTarget(press.button));
    }, { capture: true, passive: true });
    this.registerDomEvent(this.contentEl, "pointercancel", (event) => {
      if (this.penButtonPress?.pointerId === event.pointerId) this.penButtonPress = null;
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

  private registerScribbleGuard(target: Document | HTMLElement, scope: "input" | "host"): void {
    if (!this.useIosTouchEvents) return;
    const guard = (event: TouchEvent): void => {
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
    for (const type of ["touchstart", "touchmove", "touchend"] as const) {
      if (target.nodeType === Node.DOCUMENT_NODE) {
        this.registerDomEvent(target as Document, type, guard, { capture: true, passive: false });
      } else {
        this.registerDomEvent(target as HTMLElement, type, guard, { capture: true, passive: false });
      }
    }
  }

  private closestButton(target: EventTarget | null): HTMLButtonElement | null {
    if (!target || typeof (target as Element).closest !== "function") return null;
    const button = (target as Element).closest("button");
    return button instanceof HTMLButtonElement && this.contentEl.contains(button) ? button : null;
  }

  private pointInsideView(clientX: number, clientY: number): boolean {
    const rect = this.contentEl.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  private activeColorConfig(): BrushConfig | PluginSettings["laser"] | null {
    if (!isColorTool(this.tool)) return null;
    return this.tool === "laser" ? this.plugin.settings.laser : this.plugin.settings.brushes[this.tool];
  }

  private colorSource(tool: BrushKind | "laser", color: string): ColorSource {
    const saved = this.colorSources.get(tool);
    if (saved) return saved;
    const inferred = inferredColorSource(color);
    this.colorSources.set(tool, inferred);
    return inferred;
  }

  private applyToolbarColor(color: string, source: ColorSource): void {
    if (!isColorTool(this.tool)) return;
    const config = this.activeColorConfig();
    if (!config) return;
    config.color = color;
    this.colorSources.set(this.tool, source);
    this.brushPanel.hidden = true;
    this.brushPanelColorOnly = false;
    this.brushPanelView?.dispose();
    void this.plugin.saveSettings();
    this.updateToolButtons();
    this.scheduleRender();
  }

  private addHeaderAction(icon: Parameters<FileView["addAction"]>[0], label: string, action: (event: MouseEvent) => void): void {
    const element = this.addAction(icon, label, action);
    element.addClass("infinite-board-header-action");
    this.headerActionEls.push(element);
  }

  private clearHeaderActions(): void {
    for (const action of this.headerActionEls) action.remove();
    this.headerActionEls.length = 0;
  }

  private buildSelectionToolbar(): void {
    this.selectionToolbar = this.contentEl.createDiv({ cls: "infinite-board-selection-toolbar" });
    this.selectionToolbar.hidden = true;
    const actions: Array<[string, string, string, () => void]> = [
      ["duplicate", "copy-plus", "建立副本", () => this.duplicateSelection()],
      ["crop", "crop", "裁剪", () => this.toggleSelectedImageEditMode("crop")],
      ["rotate", "rotate-cw", "旋转", () => this.toggleSelectedImageEditMode("rotate")],
      ["lock", "lock-keyhole", "锁定", () => this.toggleSelectionLock()],
      ["open", "image", "打开图片查看", () => void this.openSelectedImage()],
      ["delete", "trash-2", "删除", () => this.deleteSelection()],
      ["align-left", "align-start-vertical", "左对齐", () => this.alignSelection("left")],
      ["align-center-x", "align-center-vertical", "水平居中", () => this.alignSelection("center-x")],
      ["align-right", "align-end-vertical", "右对齐", () => this.alignSelection("right")],
      ["align-top", "align-start-horizontal", "顶对齐", () => this.alignSelection("top")],
      ["align-center-y", "align-center-horizontal", "垂直居中", () => this.alignSelection("center-y")],
      ["align-bottom", "align-end-horizontal", "底对齐", () => this.alignSelection("bottom")],
      ["distribute-horizontal", "columns-3", "水平等距分布", () => this.distributeSelection("horizontal")],
      ["distribute-vertical", "rows-3", "垂直等距分布", () => this.distributeSelection("vertical")]
    ];
    for (const [key, icon, label, action] of actions) {
      const button = this.selectionToolbar.createEl("button", {
        cls: "infinite-board-selection-action",
        attr: { type: "button", "aria-label": label, title: label, "data-action": key }
      });
      setIcon(button, icon);
      this.registerDomEvent(button, "click", action);
      this.selectionActionButtons.set(key, button);
    }
  }

  private buildCanvasPasteMenu(): void {
    this.canvasPasteMenu = this.contentEl.createDiv({ cls: "infinite-board-canvas-paste-menu", attr: { "aria-label": "画布粘贴" } });
    this.canvasPasteMenu.hidden = true;
    this.canvasPasteActions = this.canvasPasteMenu.createDiv({ cls: "infinite-board-canvas-paste-actions", attr: { role: "group", "aria-label": "画布粘贴操作" } });
    const paste = this.canvasPasteActions.createEl("button", {
      cls: "infinite-board-canvas-paste-action",
      attr: { type: "button" }
    });
    setIcon(paste.createSpan({ cls: "infinite-board-canvas-paste-icon" }), "clipboard-paste");
    paste.createSpan({ text: "粘贴图片" });
    this.canvasPasteTarget = this.canvasPasteActions.createDiv({
      cls: "infinite-board-canvas-paste-target",
      attr: { contenteditable: "true", role: "textbox", "aria-label": "粘贴图片；长按可打开系统粘贴", "data-placeholder": "粘贴图片", tabindex: "0", inputmode: "none" }
    });
    this.canvasPasteTarget.hidden = true;
    const cancel = this.canvasPasteActions.createEl("button", {
      cls: "infinite-board-canvas-paste-dismiss",
      attr: { type: "button", "aria-label": "关闭粘贴浮条", title: "关闭" }
    });
    setIcon(cancel, "x");
    this.registerDomEvent(this.canvasPasteTarget, "paste", (event) => void this.onPaste(event));
    this.registerDomEvent(this.canvasPasteTarget, "input", () => {
      if (this.canvasPasteTarget.textContent) this.canvasPasteTarget.setText("");
    });
    this.registerDomEvent(this.canvasPasteTarget, "click", () => {
      if (useSystemPasteTarget(Platform.isIosApp, Platform.isTablet)) this.requestSystemPasteFromToolbarGesture();
    });
    this.registerDomEvent(this.canvasPasteMenu, "touchstart", (event) => event.stopPropagation(), { passive: true });
    this.registerDomEvent(paste, "click", () => {
      if (useSystemPasteTarget(Platform.isIosApp, Platform.isTablet)) {
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

  private beginCanvasLongPress(event: PointerEvent): void {
    if (event.pointerType !== "touch" || isStylusPointer(event) || this.penPointer !== null) return;
    if (useSystemPasteTarget(Platform.isIosApp, Platform.isTablet) && this.touchPointers.size > 0) {
      this.cancelCanvasLongPress();
      return;
    }
    this.cancelCanvasLongPress();
    const point = this.eventPoint(event);
    const directSystemPaste = useSystemPasteTarget(Platform.isIosApp, Platform.isTablet);
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

  private updateCanvasLongPress(event: PointerEvent): void {
    const press = this.canvasLongPress;
    if (!press || press.pointerId !== event.pointerId) return;
    const point = this.eventPoint(event);
    if (Math.hypot(point.x - press.x, point.y - press.y) > 10) this.cancelCanvasLongPress(event.pointerId);
  }

  private cancelCanvasLongPress(pointerId?: number): void {
    const press = this.canvasLongPress;
    if (!press || (pointerId !== undefined && press.pointerId !== pointerId)) return;
    window.clearTimeout(press.timer);
    this.canvasLongPress = null;
  }

  private finishCanvasLongPress(event: PointerEvent): void {
    const press = this.canvasLongPress;
    if (!press || press.pointerId !== event.pointerId) return;
    const requestSystemPaste = press.ready && useSystemPasteTarget(Platform.isIosApp, Platform.isTablet);
    this.cancelCanvasLongPress(event.pointerId);
    if (!requestSystemPaste) return;
    this.requestCanvasSystemPaste(press.clientX, press.clientY);
  }

  private requestCanvasSystemPaste(clientX: number, clientY: number): void {
    // WebKit's programmatic paste uses the system callout when invoked inside
    // this trusted gesture. The editable receiver is in the input document so
    // the isolated iPad canvas retains its event boundary.
    this.canvasPastePoint = this.pastePointFromClient(clientX, clientY);
    this.ignoreCanvasContextMenuUntil = performance.now() + 750;
    const document = this.canvas.ownerDocument;
    this.releaseCanvasPasteProxy();
    const proxy = document.createElement("div");
    proxy.contentEditable = "true";
    proxy.setAttribute("inputmode", "none");
    const left = Math.max(0, Math.min(this.canvas.clientWidth - 44, clientX - 22));
    const top = Math.max(0, Math.min(this.canvas.clientHeight - 44, clientY - 22));
    proxy.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:44px;height:44px;overflow:hidden;opacity:0.01;pointer-events:none;user-select:text;-webkit-user-select:text;-webkit-touch-callout:default;caret-color:transparent`;
    document.body.appendChild(proxy);
    this.canvasPasteProxy = proxy;
    let pasteReceived = false;
    proxy.addEventListener("paste", (event) => {
      pasteReceived = true;
      void this.onPaste(event);
    });
    proxy.focus({ preventScroll: true });
    let accepted = false;
    try {
      accepted = document.execCommand("paste");
    } catch (error) {
      this.traceInput("paste-command-error", error instanceof Error ? error.name : "unknown");
    }
    this.traceInput("paste-command", accepted ? "accepted" : "rejected");
    if (!accepted && !pasteReceived) {
      this.releaseCanvasPasteProxy();
      this.showNativePasteTarget();
      return;
    }
    // The native confirmation may stay open while the user decides. A pending
    // receiver has no hit area and is discarded when pasted or on timeout.
    if (this.canvasPasteProxy === proxy) this.canvasPasteProxyTimer = window.setTimeout(() => {
      if (this.canvasPasteProxy === proxy) this.traceInput("paste-command-timeout", "no-paste-event-after-15s");
      this.releaseCanvasPasteProxy();
    }, 15000);
  }

  private releaseCanvasPasteProxy(): void {
    window.clearTimeout(this.canvasPasteProxyTimer);
    this.canvasPasteProxyTimer = 0;
    this.canvasPasteProxy?.remove();
    this.canvasPasteProxy = null;
  }

  private pastePointFromClient(clientX: number, clientY: number): ScreenPoint {
    const rect = this.contentEl.getBoundingClientRect();
    const frame = this.inputFrame?.getBoundingClientRect();
    return pasteMenuPointFromClient(
      { x: clientX, y: clientY }, { x: rect.left, y: rect.top },
      frame ? { x: frame.left, y: frame.top } : undefined);
  }

  private showCanvasPasteMenu(clientX: number, clientY: number): void {
    this.showCanvasPasteMenuAt(this.pastePointFromClient(clientX, clientY));
  }

  private showCanvasPasteMenuAt(point: ScreenPoint): void {
    this.canvasPastePoint = point;
    this.canvasPasteActions.hidden = false;
    this.canvasPasteActions.querySelector(".infinite-board-canvas-paste-action")?.removeAttribute("hidden");
    this.canvasPasteTarget.hidden = true;
    this.canvasPasteMenu.hidden = false;
    this.positionCanvasPasteMenu();
  }

  private positionCanvasPasteMenu(): void {
    const position = pasteMenuPosition(this.canvasPastePoint,
      { width: this.canvasPasteMenu.offsetWidth, height: this.canvasPasteMenu.offsetHeight },
      { width: this.contentEl.clientWidth, height: this.contentEl.clientHeight });
    this.canvasPasteMenu.style.left = `${position.x}px`;
    this.canvasPasteMenu.style.top = `${position.y}px`;
  }

  private hideCanvasPasteMenu(): void {
    this.canvasPasteMenu.hidden = true;
  }

  private requestSystemPasteFromToolbarGesture(): void {
    this.showNativePasteTarget();
    this.canvasPasteTarget.focus({ preventScroll: true });
    let accepted = false;
    try {
      // Run in the visible Paste control's trusted click, not in the delayed
      // canvas long-press callback where iPadOS rejects clipboard activation.
      accepted = this.contentEl.ownerDocument.execCommand("paste");
    } catch (error) {
      this.traceInput("paste-command-error", error instanceof Error ? error.name : "unknown");
    }
    this.traceInput("paste-command", `toolbar-click-${accepted ? "accepted" : "rejected"}`);
  }

  private showNativePasteTarget(): void {
    this.canvasPasteActions.hidden = false;
    this.canvasPasteActions.querySelector(".infinite-board-canvas-paste-action")?.setAttribute("hidden", "");
    this.canvasPasteTarget.hidden = false;
    this.canvasPasteMenu.hidden = false;
    this.positionCanvasPasteMenu();
    if (!this.useIosTouchEvents) this.canvasPasteTarget.focus({ preventScroll: true });
  }

  private setSaveState(state: SaveState, detail?: string): void {
    if (!this.statusEl) return;
    const labels: Record<SaveState, string> = {
      saved: "已保存",
      unsaved: "未保存",
      saving: "正在保存…",
      error: "保存失败",
      conflict: "检测到同步冲突"
    };
    this.visibleSaveState = state;
    this.statusEl.className = `infinite-board-save-status is-${state}`;
    this.statusEl.setText(detail ? `${labels[state]} · ${detail}` : labels[state]);
    const actionable = state === "error" || state === "conflict";
    this.statusEl.toggleClass("is-actionable", actionable);
    this.statusEl.setAttribute("aria-disabled", "false");
    this.statusEl.setAttribute("title", actionable ? "点击查看恢复选项" : labels[state]);
    this.statusEl.setAttribute("aria-label", actionable ? `${labels[state]}，点击查看恢复选项` : `${labels[state]}，1500毫秒内快速点击五次打开输入诊断`);
  }

  private openSaveRecovery(): void {
    if (this.visibleSaveState === "conflict") {
      if (!this.conflictRecovery.currentPath) {
        new Notice("本地内容已另存为冲突副本，请在文件列表中查找“本地冲突”文件。", 5000);
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
      async () => { await this.createRecoveryCopy("保存失败恢复"); }
    ).open();
  }

  private async openConflictCopy(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Conflict copy is unavailable: ${path}`);
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  private toggleDiagnostics(): void {
    this.setDiagnosticsVisible(!this.diagnosticsVisible);
  }

  private handleSaveStatusClick(): void {
    if (this.visibleSaveState === "error" || this.visibleSaveState === "conflict") {
      this.diagnosticsStatusTaps.reset();
      this.openSaveRecovery();
      return;
    }
    if (this.diagnosticsStatusTaps.register(performance.now())) this.toggleDiagnostics();
  }

  private setDiagnosticsVisible(visible: boolean): void {
    this.diagnosticsVisible = visible;
    this.diagnosticsEl.hidden = !visible;
    if (visible) this.traceInput("diagnostics-open", "user");
    this.updateDiagnostics();
  }

  private hideDiagnostics(): void {
    this.setDiagnosticsVisible(false);
  }

  private scheduleDiagnostics(): void {
    if (!this.diagnosticsVisible || this.diagnosticTimer) return;
    const delay = Math.max(0, 250 - (performance.now() - this.lastDiagnosticUpdate));
    this.diagnosticTimer = window.setTimeout(() => {
      this.diagnosticTimer = 0;
      this.lastDiagnosticUpdate = performance.now();
      this.updateDiagnostics();
    }, delay);
  }

  private buildDiagnosticsPanel(): void {
    this.diagnosticsEl.empty();
    const header = this.diagnosticsEl.createDiv({ cls: "infinite-board-diagnostics-header" });
    header.createDiv({ cls: "infinite-board-diagnostics-title", text: "iPad 输入诊断" });
    const close = header.createEl("button", {
      cls: "infinite-board-panel-close infinite-board-diagnostics-close",
      attr: { type: "button", "aria-label": "隐藏输入诊断", title: "隐藏输入诊断" }
    });
    setIcon(close, "x");
    this.registerDomEvent(close, "click", () => this.hideDiagnostics());
    this.diagnosticsBodyEl = this.diagnosticsEl.createDiv({ cls: "infinite-board-diagnostics-body" });
    const labels = [
      "Apple Pencil", "iOS输入通道", "最近输入", "压感", "采样率", "合并采样", "原始点", "平滑轮廓",
      "触摸点", "Pencil 双通道", "Touch 接管", "Pointer 后备完成", "触笔状态自动回收", "当前输入状态",
      "主线程最大停顿", "最近/最长保存", "飞行记录", "输入隔离", "运行/清单版本", "滚动（输入/宿主）",
      "宿主起笔", "Scribble 防护", "Move 恢复起笔", "Touch 后备起笔", "画笔起笔/完成", "呈现恢复帧",
      "渲染帧/最慢帧", "场景缓存构建/命中", "最慢缓存构建", "最近命中", "画布尺寸", "像素倍率"
    ];
    for (const label of labels) {
      const row = this.diagnosticsBodyEl.createDiv({ cls: "infinite-board-diagnostics-row" });
      row.createSpan({ text: label });
      this.diagnosticValueEls.set(label, row.createSpan({ text: "--" }));
    }
    this.diagnosticsEventsEl = this.diagnosticsBodyEl.createDiv({ cls: "infinite-board-diagnostics-events" });
    const actions = this.diagnosticsEl.createDiv({ cls: "infinite-board-diagnostics-actions" });
    const copy = actions.createEl("button", { cls: "mod-cta infinite-board-diagnostics-copy", text: "复制诊断日志", attr: { type: "button" } });
    const reset = actions.createEl("button", { text: "开始新记录", attr: { type: "button" } });
    const hide = actions.createEl("button", { text: "关闭诊断", attr: { type: "button", "aria-label": "关闭输入诊断" } });
    this.diagnosticsInputModeButton = actions.createEl("button", { attr: { type: "button" } });
    copy.addEventListener("click", () => void this.copyInputDiagnostics());
    reset.addEventListener("click", () => this.resetInputDiagnostics());
    hide.addEventListener("click", () => this.hideDiagnostics());
    this.diagnosticsInputModeButton.addEventListener("click", () => this.toggleIosInputMode());
  }

  private updateDiagnostics(): void {
    if (!this.diagnosticsEl) return;
    // Rebuilding a floating DOM panel while Pencil owns the input lifecycle
    // can make WebKit redo hit testing. Defer it until the stroke is complete.
    if (this.activeInputSource !== null) return;
    const pencil = this.pencilDetected ? "已检测到" : "尚未检测到";
    const rect = this.canvas?.getBoundingClientRect();
    const viewport = rect ? `${Math.round(rect.width)} × ${Math.round(rect.height)}` : "--";
    const renderMetrics = this.sceneRenderer.metricsSnapshot();
    const rows: Array<[string, string]> = [
      ["Apple Pencil", pencil],
      ["iOS输入通道", this.useIosTouchEvents ? (this.iosInputMode === "pointer-capture" ? "Canvas Pointer Capture" : (this.iosStylusTouchConfirmed ? "原生 Stylus Touch（旧）" : "原生 Touch（旧）")) : "Pointer Events"],
      ["最近输入", this.lastInputType],
      ["压感", this.lastPressure.toFixed(3)],
      ["采样率", `${this.sampleRate} 点/秒`],
      ["合并采样", `${this.coalescedSamples} 点`],
      ["原始点", `${this.currentStroke?.points.length ?? 0}`],
      ["平滑轮廓", `${this.lastOutlinePointCount} 点`],
      ["触摸点", `${this.touchPointers.size}`],
      ["Pencil 双通道", `P ${this.penPointerStarts} / T ${this.stylusTouchStarts}`],
      ["Touch 接管", `${this.stylusHandoffs} 次`],
      ["Pointer 后备完成", `${this.pointerFallbackStrokes} 笔`],
      ["触笔状态自动回收", `${this.orphanedStylusRecoveries} 次`],
      ["当前输入状态", `${this.activeInputSource ?? "空闲"} / ${this.stylusTouchId ?? "-"}`],
      ["主线程最大停顿", `${Math.round(this.maxEventLoopDelay)} ms`],
      ["最近/最长保存", `${Math.round(this.lastSaveDuration)} / ${Math.round(this.maxSaveDuration)} ms`],
      ["飞行记录", `${this.inputTrace.size} 条`],
      ["输入隔离", this.inputFrame ? "iPad 子文档" : "主文档"],
      ["运行/清单版本", `${RUNTIME_VERSION} / ${this.plugin.manifest.version}`],
      ["滚动（输入/宿主）", `${this.inputDocumentScrolls} / ${this.hostDocumentScrolls}`],
      ["宿主起笔", `${this.hostDocumentPenStarts} 次`],
      ["Scribble 防护", `${this.scribbleTouchCancels} 个 Touch 阶段`],
      ["Move 恢复起笔", `${this.recoveredPointerStarts} 次`],
      ["Touch 后备起笔", `${this.stylusTouchFallbackStarts} 次`],
      ["画笔起笔/完成", this.inputToolMetrics.compactSummary()],
      ["呈现恢复帧", `${this.presentationRecoveryFrames} 帧`],
      ["渲染帧/最慢帧", `${renderMetrics.renderFrames} / ${renderMetrics.maxRenderDurationMs.toFixed(1)} ms`],
      ["场景缓存构建/命中", `${renderMetrics.sceneCacheBuilds} / ${renderMetrics.sceneCacheHits}`],
      ["最慢缓存构建", `${renderMetrics.maxSceneCacheBuildDurationMs.toFixed(1)} ms`],
      ["最近命中", this.lastHitTarget],
      ["画布尺寸", viewport],
      ["像素倍率", `${Math.min(window.devicePixelRatio || 1, 3).toFixed(2)}×`]
    ];
    for (const [label, value] of rows) {
      this.diagnosticValueEls.get(label)?.setText(value);
    }
    this.diagnosticsEventsEl.setText(this.recentPointerEvents.slice(-4).join("\n") || "尚无输入事件");
    this.diagnosticsInputModeButton.setText(this.iosInputMode === "pointer-capture" ? "切换到原生 Touch（旧）" : "切换到新 Pointer");
  }

  private traceInput(event: string, details: string): void {
    // iPad keeps a bounded flight recorder even while the panel is closed.
    // This avoids covering the canvas or mutating diagnostic DOM during the
    // failure window; users can open the panel only when they need to copy.
    if (!this.useIosTouchEvents && !this.diagnosticsVisible) return;
    const state = [
      `src=${this.activeInputSource ?? "idle"}`,
      `touch=${this.stylusTouchId ?? "-"}`,
      `draw=${this.drawingPointer ?? "-"}`,
      `pen=${this.penPointer ?? "-"}`,
      `stroke=${this.currentStroke?.points.length ?? 0}`,
      `tool=${this.tool}`,
      `dirty=${this.dirty ? 1 : 0}`,
      `saving=${this.isSaving ? 1 : 0}`
    ].join(" ");
    this.inputTrace.record(performance.now(), event, details, state);
    this.scheduleDiagnostics();
  }

  private nativeStylusTouchEnabled(): boolean {
    return usesNativeStylusTouch(this.useIosTouchEvents, this.iosInputMode);
  }

  private usesCanvasPointerInput(): boolean {
    return !this.useIosTouchEvents || usesCanvasPointerCapture(this.useIosTouchEvents, this.iosInputMode);
  }

  private toggleIosInputMode(): void {
    if (!this.useIosTouchEvents) return;
    this.finishActiveInput(this.activeInputPersistent);
    this.iosInputMode = this.iosInputMode === "pointer-capture" ? "native-touch" : "pointer-capture";
    this.traceInput("input-mode", this.iosInputMode);
    this.updateDiagnostics();
    new Notice(`iPad 输入已切换为 ${this.iosInputMode === "pointer-capture" ? "Canvas Pointer Capture" : "原生 Touch（旧）"}。`, 3000);
  }

  private traceMove(event: string, details: string): void {
    const now = performance.now();
    if (now - this.lastTracedMoveAt < 200) return;
    this.lastTracedMoveAt = now;
    this.traceInput(event, details);
  }

  private pointerDetails(event: PointerEvent): string {
    const phase = event.eventPhase === Event.CAPTURING_PHASE ? "capture" : event.eventPhase === Event.AT_TARGET ? "target" : event.eventPhase === Event.BUBBLING_PHASE ? "bubble" : "none";
    const captured = this.canvas?.hasPointerCapture(event.pointerId) ? 1 : 0;
    this.lastHitTarget = this.traceHitTarget(event.clientX, event.clientY);
    return `id=${event.pointerId} type=${event.pointerType || "unknown"} pressure=${this.traceNumber(event.pressure, 3)} buttons=${event.buttons} phase=${phase} captured=${captured} target=${this.traceTarget(event.target)} hit=${this.lastHitTarget} ts=${this.traceNumber(event.timeStamp, 1)}`;
  }

  private isCanvasInputEvent(event: Event): boolean {
    if (!this.canvas?.isConnected) return false;
    return event.composedPath().includes(this.canvas);
  }

  private touchDetails(event: TouchEvent): string {
    const describe = (list: TouchList): string => Array.from(list).slice(0, 5).map((item) => {
      const touch = item as Touch & { touchType?: string };
      return `${touch.identifier}:${touch.touchType ?? "?"}:r${this.traceNumber(touch.radiusX, 1)}/${this.traceNumber(touch.radiusY, 1)}:f${this.traceNumber(touch.force, 3)}`;
    }).join(",") || "-";
    return `touches=[${describe(event.touches)}] changed=[${describe(event.changedTouches)}] target=${this.traceTarget(event.target)} ts=${this.traceNumber(event.timeStamp, 1)}`;
  }

  private traceTarget(target: EventTarget | null): string {
    if (!target || typeof (target as Element).tagName !== "string") return "?";
    const element = target as Element;
    const classes = Array.from(element.classList).slice(0, 2).join(".");
    return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`;
  }

  private traceHitTarget(clientX: number, clientY: number): string {
    return this.traceTarget(this.canvas?.ownerDocument.elementFromPoint(clientX, clientY) ?? null);
  }

  private traceNumber(value: number | undefined, digits: number): string {
    return Number.isFinite(value) ? Number(value).toFixed(digits) : "?";
  }

  private resetInputDiagnostics(): void {
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

  private async copyInputDiagnostics(): Promise<void> {
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
      platform: diagnosticPlatformSummary(),
      viewport: `${this.canvas.clientWidth}x${this.canvas.clientHeight}`,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 3),
      visibility: document.visibilityState,
      orientation: screen.orientation?.type ?? "unknown",
      elements: this.data.elements.length,
      points: totalPoints,
      historyUndoCount: historyUsage.undoCount,
      historyRedoCount: historyUsage.redoCount,
      historyEstimatedBytes: historyUsage.estimatedBytes,
      imageCacheEntries: imageCache.entries,
      imageCacheEstimatedBytes: imageCache.estimatedBytes,
      imageCacheVisibleEntries: imageCache.visibleEntries,
      imagePendingRetries: imageCache.pendingRetries,
      boardBytes: health?.boardBytes ?? 0,
      referencedImages: health?.referencedImages ?? 0,
      missingImages: health?.missingImages ?? 0,
      unlinkedImages: health?.unlinkedPaths.length ?? 0,
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
      new Notice("输入诊断日志已复制，请直接粘贴发给我。", 3500);
    } catch (error) {
      console.error("Infinite Board: diagnostic copy failed", error);
      new DiagnosticReportModal(this.app, report).open();
      new Notice("自动复制失败，已打开可手动复制的日志。", 4500);
    }
  }

  private recordPointerEvent(kind: string, event: PointerEvent): void {
    this.recentPointerEvents.push(`${kind} · ${event.pointerType || "unknown"} #${event.pointerId}`);
    if (this.recentPointerEvents.length > 8) this.recentPointerEvents.shift();
    this.scheduleDiagnostics();
  }

  private recordInput(event: PointerEvent, sampleCount = 1, inputType?: string): void {
    this.lastInputType = inputType ?? event.pointerType ?? "unknown";
    if (this.lastInputType.startsWith("pen")) this.pencilDetected = true;
    this.lastPressure = event.pressure;
    this.coalescedSamples = sampleCount;
    const now = performance.now();
    if (this.lastSampleTime > 0) {
      const elapsed = now - this.lastSampleTime;
      if (elapsed > 0) {
        const instantaneous = Math.min(1000, Math.round(sampleCount * 1000 / elapsed));
        this.sampleRate = this.sampleRate === 0 ? instantaneous : Math.round(this.sampleRate * 0.75 + instantaneous * 0.25);
      }
    }
    this.lastSampleTime = now;
    this.scheduleDiagnostics();
  }

  private setTool(tool: Tool, persist = true): void {
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
      this.brushPanelView?.dispose();
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

  private updateToolButtons(): void {
    this.toolbar.querySelectorAll<HTMLElement>("[data-tool]").forEach((element) => {
      const buttonTool = element.dataset.tool as Tool;
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
    this.palette.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((button) => {
      const active = source === "preset" && button.dataset.color?.toLowerCase() === colorConfig?.color.toLowerCase();
      button.toggleClass("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.disabled = !colorConfig;
    });
    const more = this.palette.querySelector<HTMLButtonElement>(".infinite-board-more-colors");
    if (more) {
      const active = source === "more";
      more.toggleClass("is-active", active);
      more.setAttribute("aria-pressed", active ? "true" : "false");
      more.setAttribute("aria-expanded", !this.brushPanel.hidden && this.brushPanelColorOnly ? "true" : "false");
      more.disabled = !colorConfig;
      more.style.setProperty("--infinite-board-custom-color", colorConfig?.color ?? "#202022");
    }
  }

  private toggleBrushPanel(colorOnly = false): void {
    if (!isConfigurableTool(this.tool)) {
      this.setTool("pen");
    }
    const closeExisting = !this.brushPanel.hidden && this.brushPanelColorOnly === colorOnly;
    this.brushPanelColorOnly = colorOnly;
    this.brushPanel.hidden = closeExisting;
    if (this.brushPanel.hidden) this.brushPanelView?.dispose();
    else this.renderBrushPanel();
    this.updateToolButtons();
  }

  private renderBrushPanel(): void {
    this.brushPanelView?.render(this.tool, this.brushPanelColorOnly);
  }

  private resizeCanvas(): void {
    if (!this.canvas?.isConnected) return;
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      const delta = persistedCameraResizeDelta(
        this.lastCanvasCssWidth > 0 && this.lastCanvasCssHeight > 0
          ? { width: this.lastCanvasCssWidth, height: this.lastCanvasCssHeight }
          : null,
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

  private scheduleRender(): void {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    this.sceneRenderer.render({
      canvas: this.canvas,
      context: this.context,
      camera: this.data.camera,
      drawBackground: (context, width, height) => {
        // Keep the paper color stable across devices so a black ink stroke
        // never disappears when another device uses Obsidian's dark theme.
        context.fillStyle = "#f7f7f5";
        context.fillRect(0, 0, width, height);
        this.drawGrid(context, width, height);
      },
      drawStaticWorld: (context) => {
        for (const element of this.visibleElements()) {
          if (element.id === this.currentStroke?.id) continue;
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

  private invalidateSceneCache(): void {
    this.sceneRenderer.invalidate();
  }

  private viewportBounds(padding = 80): Bounds {
    const camera = this.data.camera;
    return {
      minX: (-camera.x - padding) / camera.zoom,
      minY: (-camera.y - padding) / camera.zoom,
      maxX: (this.canvas.clientWidth - camera.x + padding) / camera.zoom,
      maxY: (this.canvas.clientHeight - camera.y + padding) / camera.zoom
    };
  }

  private visibleElements(): BoardElement[] {
    const includeIds = new Set(this.selection.selectedIds);
    if (this.currentStroke) includeIds.add(this.currentStroke.id);
    const visible = this.spatialIndex.query(this.data.elements, this.viewportBounds(), includeIds);
    this.boardAssets.updateVisible(visible);
    return visible;
  }

  private rebuildSpatialIndex(): void {
    this.spatialIndex.rebuild(this.data.elements);
  }

  private drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const camera = this.data.camera;
    const base = 32 * camera.zoom;
    if (base < 9) return;
    const offsetX = ((camera.x % base) + base) % base;
    const offsetY = ((camera.y % base) + base) % base;
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

  private drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    if (stroke.points.length === 0) return;
    const brush = this.brushForStroke(stroke);
    const isComplete = this.currentStroke?.id !== stroke.id;
    const cached = this.strokePathCache.get(stroke.id);
    let path: Path2D;
    if (isComplete && cached?.pointCount === stroke.points.length) {
      path = cached.path;
    } else {
      if (brush.kind !== "highlighter" && brush.pressure !== "off" && stroke.points.length > 1) {
        const outline = pressureOutline(stroke.points, brush.size, brush.pressure);
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
    ctx.globalAlpha = brush.opacity;
    ctx.globalCompositeOperation = strokeCompositeOperation(brush.kind);
    if (brush.kind !== "highlighter" && brush.pressure !== "off" && stroke.points.length > 1) {
      ctx.fillStyle = brush.color;
      ctx.fill(path);
    } else if (stroke.points.length > 1) {
      ctx.strokeStyle = brush.color;
      ctx.lineWidth = brush.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(path);
    } else {
      ctx.fillStyle = brush.color;
      const pointScale = brush.pressure === "off" ? 1 : pressureScale(stroke.points[0].pressure, brush.pressure);
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y, brush.size * pointScale / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private brushForStroke(stroke: Stroke): BrushConfig {
    if (stroke.brush) return stroke.brush;
    const kind: BrushKind = stroke.tool === "highlighter" ? "highlighter" : stroke.tool === "ballpoint" ? "ballpoint" : "pen";
    return {
      ...this.plugin.settings.brushes[kind],
      kind,
      color: stroke.color,
      size: stroke.size,
      opacity: stroke.opacity ?? (kind === "highlighter" ? 0.32 : 1)
    };
  }

  private centerlineToPath(points: Point[]): Path2D {
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

  private outlineToPath(points: Point[]): Path2D {
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

  private drawImage(ctx: CanvasRenderingContext2D, item: BoardImage): void {
    const image = this.boardAssets.get(item.path);
    const centerX = item.x + item.width / 2;
    const centerY = item.y + item.height / 2;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(item.rotation * Math.PI / 180);
    if (image?.complete && image.naturalWidth) {
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

  private drawEraserPreview(ctx: CanvasRenderingContext2D): void {
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

  private loadImage(path: string): void {
    this.boardAssets.load(path);
  }

  private onReferencedImageAvailable(file: TFile): void {
    this.boardAssets.onVaultFile(file.path, this.data.elements);
  }

  private createPersistentStroke(point: Point): Stroke {
    const kind: BrushKind = this.tool === "ballpoint" || this.tool === "highlighter" ? this.tool : "pen";
    const brush = structuredClone(this.plugin.settings.brushes[kind]);
    return {
      id: makeId("stroke"),
      type: "stroke",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tool: kind,
      color: brush.color,
      size: brush.size,
      opacity: brush.opacity,
      brush,
      points: [point]
    };
  }

  private createLaserStroke(point: Point): void {
    this.laserController.onInputStart(this.laserInput(point));
    this.activeInputPersistent = false;
    this.ensureLaserAnimation();
  }

  private appendLaserPoint(point: Point): void {
    this.laserController.onInputMove(this.laserInput(point));
  }

  private completeLaserStroke(): void {
    if (!this.laserController.isDrawing) return;
    this.laserController.complete();
    this.ensureLaserAnimation();
  }

  private finishLaserStroke(point: Point): void {
    this.laserController.onInputEnd(this.laserInput(point));
    this.ensureLaserAnimation();
  }

  private laserInput(point: Point): ToolInput {
    return {
      pointerId: this.drawingPointer ?? -1,
      point,
      source: this.activeInputSource === "touch" ? "stylus-touch" : "pointer"
    };
  }

  private ensureLaserAnimation(): void {
    if (this.laserFrame || !this.laserController.hasStrokes) return;
    const animate = () => {
      this.laserFrame = 0;
      this.laserController.pruneExpired();
      this.scheduleRender();
      if (this.laserController.hasStrokes) this.laserFrame = window.requestAnimationFrame(animate);
    };
    this.laserFrame = window.requestAnimationFrame(animate);
  }

  private clearLaserStrokes(): void {
    if (this.laserFrame) window.cancelAnimationFrame(this.laserFrame);
    this.laserFrame = 0;
    this.laserController.clear();
    this.scheduleRender();
  }

  private selectedElements(): BoardElement[] {
    return this.selection.selected(this.data.elements);
  }

  private drawSelection(ctx: CanvasRenderingContext2D): void {
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
        const points = editableImage && imageEditMode === "crop"
          ? Object.values(imageCropHandlePoints(editableImage))
          : imageEditMode === "rotate" ? [] : Object.values(handlePoints(bounds));
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
    if (drag?.kind === "lasso" && drag.lasso.length > 1) {
      ctx.fillStyle = "rgba(10, 132, 255, 0.10)";
      ctx.strokeStyle = "rgba(10, 132, 255, 0.9)";
      ctx.beginPath();
      ctx.moveTo(drag.lasso[0].x, drag.lasso[0].y);
      for (const point of drag.lasso.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (drag?.kind === "marquee" && drag.lasso.length === 2) {
      const start = drag.lasso[0];
      const end = drag.lasso[1];
      ctx.fillStyle = "rgba(10, 132, 255, 0.08)";
      ctx.strokeStyle = "rgba(10, 132, 255, 0.9)";
      ctx.fillRect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      ctx.strokeRect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y));
    }
    ctx.restore();
  }

  private updateSelectionToolbar(): void {
    if (!this.selectionToolbar) return;
    const selected = this.tool === "select" ? this.selectedElements() : [];
    const allImages = selected.length > 0 && selected.every((element) => element.type === "image");
    const single = allImages && selected.length === 1;
    const multiple = allImages && selected.length > 1;
    const deleteOnly = selected.length > 0 && !allImages;
    if (!single && this.selection.editMode) this.selection.setImageEditMode(null);
    this.selectionToolbar.hidden = !single && !multiple && !deleteOnly;
    if (!single && !multiple && !deleteOnly) return;
    const singleActions = new Set(["duplicate", "crop", "rotate", "lock", "open", "delete"]);
    const multiActions = new Set(["align-left", "align-center-x", "align-right", "align-top", "align-center-y", "align-bottom", "distribute-horizontal", "distribute-vertical"]);
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
        const label = locked ? "解锁" : "锁定";
        lockButton.setAttribute("aria-label", label);
        lockButton.setAttribute("title", label);
        setIcon(lockButton, locked ? "lock-open" : "lock-keyhole");
      }
      for (const mode of ["crop", "rotate"] as const) {
        const button = this.selectionActionButtons.get(mode);
        const active = !locked && this.selection.editMode === mode;
        button?.classList.toggle("is-active", active);
        button?.setAttribute("aria-pressed", active ? "true" : "false");
      }
      if (locked && this.selection.editMode) this.selection.setImageEditMode(null);
    } else if (multiple) {
      const disabled = selected.some((element) => element.locked);
      for (const button of multiActions) {
        const element = this.selectionActionButtons.get(button);
        if (element) element.disabled = disabled || (button.startsWith("distribute-") && selected.length < 3);
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
    const bottomReserve = Platform.isMobile && window.matchMedia("(max-width: 700px)").matches ? 124 : 64;
    // Leave a fixed screen-space clearance above the selection. Besides making
    // multi-image actions easier to read, this keeps the toolbar clear of the
    // single-image rotation handle, which extends beyond the top edge.
    const selectionToolbarOffset = 100;
    this.selectionToolbar.style.top = `${Math.max(12, Math.min(this.canvas.clientHeight - bottomReserve, screenY - selectionToolbarOffset))}px`;
  }

  private startSelection(pointerId: number, screen: ScreenPoint, additive: boolean): void {
    const world = this.screenToWorld(screen);
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

  private updateSelection(point: ScreenPoint): void {
    const candidates = this.selectionCandidates(point);
    if (this.selection.update(this.data.elements, point, this.data.camera.zoom, candidates)) {
      for (const element of this.selection.selected(this.data.elements)) this.spatialIndex.upsert(element);
      this.strokePathCache.clear();
      this.invalidateSceneCache();
    }
    this.scheduleRender();
  }

  private finishSelection(point: ScreenPoint): boolean {
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

  private selectionCandidates(point: ScreenPoint): readonly BoardElement[] {
    const drag = this.selection.dragView;
    if (!drag || (drag.kind !== "lasso" && drag.kind !== "marquee")) return this.data.elements;
    const points = [...drag.lasso, point];
    const padding = 8 / this.data.camera.zoom;
    return this.spatialIndex.query(this.data.elements, {
      minX: Math.min(...points.map((value) => value.x)) - padding,
      minY: Math.min(...points.map((value) => value.y)) - padding,
      maxX: Math.max(...points.map((value) => value.x)) + padding,
      maxY: Math.max(...points.map((value) => value.y)) + padding
    });
  }

  private cancelSelection(): void {
    if (this.selection.cancel(this.data.elements)) {
      this.strokePathCache.clear();
      this.rebuildSpatialIndex();
    }
    this.scheduleRender();
  }

  private deleteSelection(): void {
    if (!this.selection.selectedIds.size) return;
    const entries = this.data.elements
      .map((element, index) => ({ element, index }))
      .filter((entry) => this.selection.selectedIds.has(entry.element.id) && !entry.element.locked);
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

  private duplicateSelection(): void {
    const selected = this.selectedElements();
    if (!selected.length) return;
    const now = new Date().toISOString();
    const offset = 20 / this.data.camera.zoom;
    const duplicates = selected.map((source): BoardElement => {
      const element = structuredClone(source);
      element.id = makeId(element.type);
      element.createdAt = now;
      element.updatedAt = now;
      element.locked = undefined;
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

  private copySelection(): void {
    const selected = this.selectedElements();
    if (!selected.length) return;
    this.elementClipboard = selected.map((element) => structuredClone(element));
    this.pasteSequence = 0;
    new Notice(`已复制 ${selected.length} 个元素。`, 1800);
  }

  private pasteCopiedElements(): void {
    if (!this.elementClipboard.length) {
      new Notice("当前没有已复制的画布元素。", 2200);
      return;
    }
    this.pasteSequence += 1;
    const offset = 20 * this.pasteSequence / this.data.camera.zoom;
    const now = new Date().toISOString();
    const duplicates = this.elementClipboard.map((source): BoardElement => {
      const element = structuredClone(source);
      element.id = makeId(element.type);
      element.createdAt = now;
      element.updatedAt = now;
      element.locked = undefined;
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

  private recordSelectionUpdate(before: readonly BoardElement[], after: readonly BoardElement[], label: string): void {
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

  private toggleSelectedImageEditMode(mode: Exclude<ImageEditMode, null>): void {
    const selected = this.selectedElements();
    if (selected.length !== 1 || selected[0].type !== "image" || selected[0].locked) return;
    this.selection.toggleImageEditMode(mode);
    this.scheduleRender();
  }

  private async openSelectedImage(): Promise<void> {
    const selected = this.selectedElements();
    if (selected.length !== 1 || selected[0].type !== "image") return;
    const file = this.app.vault.getAbstractFileByPath(selected[0].path);
    if (!(file instanceof TFile)) {
      new Notice("找不到图片附件。", 2400);
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  private toggleSelectionLock(): void {
    const before = this.selectedElements();
    if (!before.length) return;
    const lock = before.some((element) => !element.locked);
    const after = before.map((element) => ({ ...structuredClone(element), locked: lock || undefined, updatedAt: new Date().toISOString() }));
    this.recordSelectionUpdate(before, after, lock ? "锁定元素" : "解锁元素");
  }

  private alignSelection(alignment: Alignment): void {
    const before = this.selectedElements();
    const next = alignElements(this.data.elements, this.selection.selectedIds, alignment);
    const after = next.filter((element) => this.selection.selectedIds.has(element.id));
    this.recordSelectionUpdate(before, after, "对齐元素");
  }

  private distributeSelection(direction: Distribution): void {
    const before = this.selectedElements();
    const next = distributeElements(this.data.elements, this.selection.selectedIds, direction);
    const after = next.filter((element) => this.selection.selectedIds.has(element.id));
    this.recordSelectionUpdate(before, after, "等距分布元素");
  }

  private onCanvasPointerDown(event: PointerEvent): void {
    // Capture at the drawing surface, after the event has reached its target.
    // This keeps the contact lifecycle local to the canvas and prevents a
    // later move/up retarget from turning into an orphaned stroke.
    if (!isStylusPointer(event)) event.preventDefault();
    try {
      this.canvas.setPointerCapture(event.pointerId);
      this.traceInput("pointercapture-set", `id=${event.pointerId} type=${event.pointerType || "unknown"}`);
    } catch (error) {
      // Older WebViews can reject capture for a transient touch pointer. The
      // normal target event path remains a safe fallback in that case.
      this.traceInput("pointercapture-unavailable", `id=${event.pointerId} ${error instanceof Error ? error.name : "unknown"}`);
    }
    this.onPointerDown(event);
  }

  private onCanvasPointerUp(event: PointerEvent, kind: "up" | "cancel"): void {
    if (event.pointerType !== "pen" && !this.stylusPointerIds.has(event.pointerId)) event.preventDefault();
    this.onPointerUp(event, kind);
  }

  private onCanvasPointerMove(event: PointerEvent): void {
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

  private onLostPointerCapture(event: PointerEvent): void {
    this.traceInput("pointercapture-lost", this.pointerDetails(event));
    if (this.drawingPointer !== event.pointerId) return;
    // A capture loss without pointerup/cancel is a real lifecycle break. Do
    // not leave it to the next Pencil contact to clean up the prior stroke.
    this.finishActiveInput(this.activeInputPersistent);
  }

  private onPointerDown(event: PointerEvent): void {
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
    // Excalidraw also leaves its mobile canvas unfocused. Desktop keeps focus
    // for keyboard shortcuts and clipboard paste.
    if (!this.useIosTouchEvents) this.canvas.focus({ preventScroll: true });
    const screen = this.eventPoint(event);
    if (this.tool === "eraser") this.eraserPreview = this.screenToWorld(screen);
    const stylus = isStylusPointer(event);

    if (event.pointerType === "touch" && !stylus) {
      // iPadOS normally rejects the palm for us, but WKWebView may still emit
      // touch pointers. Never let those move the camera while Pencil is down.
      if (this.penPointer !== null) return;
      this.recordPointerEvent("down", event);
      this.recordInput(event);
      this.touchPointers.set(event.pointerId, screen);
      this.resetTouchGesture();
      event.preventDefault();
      return;
    }

    if (event.button !== 0 && !stylus) return;
    window.clearTimeout(this.saveTimer);
    if (this.drawingPointer !== null) this.finishActiveInput(false);
    if (stylus) this.stylusPointerIds.add(event.pointerId);
    this.recordPointerEvent("down", event);
    this.recordInput(event, 1, stylus && event.pointerType !== "pen" ? "pen (touch兼容)" : undefined);
    if (stylus) {
      this.penPointer = event.pointerId;
      this.touchPointers.clear();
      this.resetTouchGesture();
    }
    if (this.tool === "hand" || event.button === 1 || event.button === 2) {
      this.activeInputSource = "pointer";
      this.drawingPointer = event.pointerId;
      this.activePointerStartedAt = event.timeStamp;
      this.lastTouchCenter = screen;
      return;
    }

    this.activeInputSource = "pointer";
    this.drawingPointer = event.pointerId;
    this.activePointerStartedAt = event.timeStamp;
    if (this.tool === "select") {
      this.startSelection(event.pointerId, screen, event.shiftKey || event.ctrlKey || event.metaKey);
      if (!stylus) event.preventDefault();
      return;
    } else if (this.tool === "eraser") {
      this.activeInputPersistent = false;
      this.lastEraserPoint = null;
      this.pushHistory();
      this.eraseAlongPath(this.screenToWorld(screen));
    } else if (this.tool === "laser") {
      this.activeDiagnosticTool = this.inputToolMetrics.recordStart(this.tool, "pointer");
      const world = this.screenToWorld(screen);
      this.createLaserStroke(this.makePoint(world, event));
    } else {
      this.activeDiagnosticTool = this.inputToolMetrics.recordStart(this.tool, "pointer");
      this.activeInputPersistent = true;
      this.markDirty(false);
      const world = this.screenToWorld(screen);
      this.currentStroke = this.createPersistentStroke(this.makePoint(world, event));
      this.data.elements.push(this.currentStroke);
      this.spatialIndex.upsert(this.currentStroke);
    }
    if (!stylus) event.preventDefault();
    this.scheduleRender();
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.nativeStylusTouchEnabled() && this.iosStylusTouchConfirmed && event.pointerType === "pen") {
      this.traceMove("pointermove-ignored", this.pointerDetails(event));
      return;
    }
    if (this.useIosTouchEvents && event.pointerType === "pen") this.traceMove("pointermove", this.pointerDetails(event));
    const screen = this.eventPoint(event);
    if (this.tool === "eraser") {
      this.eraserPreview = this.screenToWorld(screen);
      this.scheduleRender();
    }
    const stylus = event.pointerType === "pen" || this.stylusPointerIds.has(event.pointerId);
    if (event.pointerType === "touch" && !stylus) {
      if (this.penPointer !== null) return;
      if (!this.touchPointers.has(event.pointerId)) return;
      this.recordInput(event);
      this.touchPointers.set(event.pointerId, screen);
      this.updateTouchGesture();
      event.preventDefault();
      return;
    }

    if (this.drawingPointer !== event.pointerId) return;
    if (this.tool === "hand") {
      this.recordInput(event);
      if (this.lastTouchCenter) {
        this.data.camera.x += screen.x - this.lastTouchCenter.x;
        this.data.camera.y += screen.y - this.lastTouchCenter.y;
      }
      this.lastTouchCenter = screen;
      this.markDirty();
      this.scheduleRender();
      return;
    }

    if (this.tool === "eraser") {
      for (const sample of this.pointerSamples(event)) this.eraseAlongPath(this.screenToWorld(this.eventPoint(sample)));
    } else if (this.tool === "select" && this.selection.activePointerId !== null) {
      this.updateSelection(this.screenToWorld(screen));
    } else if (this.tool === "laser" && this.laserController.isDrawing) {
      const samples = this.pointerSamples(event);
      this.recordInput(event, samples.length, stylus && event.pointerType !== "pen" ? "pen (touch兼容)" : undefined);
      for (const sample of samples) {
        this.appendLaserPoint(this.makePoint(this.screenToWorld(this.eventPoint(sample)), sample, 0.5));
      }
    } else if (this.currentStroke) {
      const samples = this.pointerSamples(event);
      this.recordInput(event, samples.length, stylus && event.pointerType !== "pen" ? "pen (touch兼容)" : undefined);
      this.appendStrokeSamples(samples);
    }
    if (!stylus) event.preventDefault();
    this.scheduleRender();
  }

  private onPointerUp(event: PointerEvent, kind = "up"): void {
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

  private finishActiveInput(scheduleSave: boolean): void {
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
        this.history.recordApplied(new InsertElementsCommand([{ index, element: completedStroke }], "书写笔迹"));
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
    // iPad can spend noticeable main-thread time serializing and handing a
    // growing board to the Vault. Require a real writing pause so that save
    // work cannot repeatedly start between handwritten characters.
    if (scheduleSave) this.scheduleSave(this.useIosTouchEvents ? 3000 : 900);
    this.activeInputPersistent = true;
    this.traceInput("input-finished", `source=${completedSource ?? "none"} savedLater=${scheduleSave ? 1 : 0}`);
  }

  private keepPresentationActive(durationMs: number): void {
    this.presentationUntil = Math.max(this.presentationUntil, performance.now() + durationMs);
    if (this.presentationFrame) return;
    const tick = (): void => {
      this.presentationFrame = 0;
      if (performance.now() >= this.presentationUntil || document.visibilityState !== "visible") return;
      this.presentationRecoveryFrames += 1;
      this.scheduleRender();
      this.presentationFrame = window.requestAnimationFrame(tick);
    };
    this.presentationFrame = window.requestAnimationFrame(tick);
  }

  private onTouchStart(event: TouchEvent, allowPointerFallback = false): void {
    if (!this.nativeStylusTouchEnabled() && !allowPointerFallback) return;
    this.traceInput("touchstart-raw", this.touchDetails(event));
    // After WebKit has positively identified Pencil once, accept its narrow
    // contact even when a new stroke's touchstart arrives before force does.
    // Pointer events are already suppressed in this mode, so rejecting that
    // zero-force start would otherwise drop the whole stroke.
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
        const world = this.screenToWorld(this.touchPoint(touch));
        const previous = this.currentStroke.points[this.currentStroke.points.length - 1];
        if (Math.hypot(world.x - previous.x, world.y - previous.y) > 0.05) {
          this.currentStroke.points.push({ x: world.x, y: world.y, pressure: touch.force || previous.pressure, time: event.timeStamp });
        }
      } else if (this.laserController.isDrawing) {
        const world = this.screenToWorld(this.touchPoint(touch));
        this.appendLaserPoint({ x: world.x, y: world.y, pressure: touch.force || 0.5, time: event.timeStamp });
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
    this.recentPointerEvents.push(`down · stylus #${touch.identifier}`);
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

  private onTouchMove(event: TouchEvent, allowPointerFallback = false): void {
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
    const screen = this.touchPoint(touch);
    if (this.tool === "eraser") this.eraserPreview = this.screenToWorld(screen);
    this.updateTouchSampleRate(touch, event.timeStamp);
    if (this.tool === "hand") {
      if (this.lastTouchCenter) {
        this.data.camera.x += screen.x - this.lastTouchCenter.x;
        this.data.camera.y += screen.y - this.lastTouchCenter.y;
      }
      this.lastTouchCenter = screen;
      this.markDirty();
    } else if (this.tool === "select" && this.selection.activePointerId !== null) {
      this.updateSelection(this.screenToWorld(screen));
    } else if (this.tool === "eraser") {
      this.eraseAlongPath(this.screenToWorld(screen));
    } else if (this.tool === "laser" && this.laserController.isDrawing) {
      const world = this.screenToWorld(screen);
      this.appendLaserPoint({
        x: world.x,
        y: world.y,
        pressure: touch.force > 0 ? touch.force : 0.5,
        time: event.timeStamp
      });
    } else if (this.currentStroke) {
      const world = this.screenToWorld(screen);
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

  private onTouchEnd(event: TouchEvent, kind: string, allowPointerFallback = false): void {
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
      this.recentPointerEvents.push(`${kind} · stylus #${touch.identifier}`);
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
    this.recentPointerEvents.push(`${kind} · stylus #${touch.identifier}`);
    if (this.recentPointerEvents.length > 8) this.recentPointerEvents.shift();
    this.stylusTouchId = null;
    this.eraserPreview = null;
    this.finishActiveInput(this.activeInputPersistent);
  }

  private touchPoint(touch: Touch): ScreenPoint {
    const rect = this.canvas.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }

  private updateTouchSampleRate(touch: Touch, timeStamp: number): void {
    const now = timeStamp;
    if (this.lastSampleTime > 0) {
      const elapsed = now - this.lastSampleTime;
      if (elapsed > 0) {
        const instantaneous = Math.min(1000, Math.round(1000 / elapsed));
        this.sampleRate = this.sampleRate === 0 ? instantaneous : Math.round(this.sampleRate * 0.75 + instantaneous * 0.25);
      }
    }
    this.lastSampleTime = now;
    this.lastPressure = touch.force;
    this.coalescedSamples = 1;
  }

  private pointerSamples(event: PointerEvent): PointerEvent[] {
    let samples: PointerEvent[] = [];
    if (typeof event.getCoalescedEvents === "function") {
      try {
        samples = event.getCoalescedEvents();
      } catch {
        // Fall back to the current event when coalesced samples are unavailable.
      }
    }
    const last = samples[samples.length - 1];
    if (!last || last.timeStamp !== event.timeStamp || last.clientX !== event.clientX || last.clientY !== event.clientY) {
      samples.push(event);
    }
    return samples.sort((a, b) => a.timeStamp - b.timeStamp);
  }

  private appendStrokeSamples(samples: PointerEvent[]): void {
    if (!this.currentStroke) return;
    for (const sample of samples) {
      const world = this.screenToWorld(this.eventPoint(sample));
      const previous = this.currentStroke.points[this.currentStroke.points.length - 1];
      if (!previous || Math.hypot(world.x - previous.x, world.y - previous.y) > 0.18) {
        this.currentStroke.points.push(this.makePoint(world, sample, previous?.pressure ?? 0.25));
      }
    }
  }

  private resetTouchGesture(): void {
    const values = [...this.touchPointers.values()];
    this.lastTouchCenter = values.length ? this.center(values) : null;
    this.lastPinchDistance = values.length >= 2 ? this.distance(values[0], values[1]) : 0;
  }

  private updateTouchGesture(): void {
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

  private onWheel(event: WheelEvent): void {
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

  private zoomAt(screen: ScreenPoint, factor: number): void {
    const camera = this.data.camera;
    const oldZoom = camera.zoom;
    const newZoom = Math.min(8, Math.max(0.1, oldZoom * factor));
    const worldX = (screen.x - camera.x) / oldZoom;
    const worldY = (screen.y - camera.y) / oldZoom;
    camera.zoom = newZoom;
    camera.x = screen.x - worldX * newZoom;
    camera.y = screen.y - worldY * newZoom;
  }

  private eraseAt(point: ScreenPoint): void {
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
    const elements: BoardElement[] = [];
    for (const element of this.data.elements) {
      if (element.type !== "stroke" || !candidateIds.has(element.id)) {
        elements.push(element);
        continue;
      }
      const result = this.plugin.settings.eraser.mode === "stroke"
        ? eraseWholeStrokeAt(element, point, radius)
        : eraseStrokeAt(element, point, radius, () => makeId("stroke"));
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

  private eraseAlongPath(point: ScreenPoint): void {
    const radius = this.plugin.settings.eraser.size / 2 / this.data.camera.zoom;
    for (const sample of sampleEraserPath(this.lastEraserPoint, point, radius * 0.7)) this.eraseAt(sample);
    this.lastEraserPoint = point;
  }

  private pushHistory(): void {
    this.history.beginElements(this.data);
  }

  private undo(): void {
    const previous = this.history.undo(this.data);
    if (previous === this.data) return;
    this.data = previous;
    this.selection.clear();
    this.strokePathCache.clear();
    this.rebuildSpatialIndex();
    this.queueSave();
    this.scheduleRender();
  }

  private redo(): void {
    const next = this.history.redo(this.data);
    if (next === this.data) return;
    this.data = next;
    this.selection.clear();
    this.strokePathCache.clear();
    this.rebuildSpatialIndex();
    this.queueSave();
    this.scheduleRender();
  }

  private onKeyDown(event: KeyboardEvent): void {
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

  private openImagePicker(): void {
    this.imageInput.value = "";
    try {
      if (typeof this.imageInput.showPicker === "function") this.imageInput.showPicker();
      else this.imageInput.click();
    } catch {
      this.imageInput.click();
    }
  }

  private async importFromClipboard(): Promise<void> {
    const clipboard = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> };
    if (!clipboard?.read) {
      this.showNativePasteTarget();
      return;
    }
    try {
      const items = await clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        for (const type of item.types.filter((value) => value.startsWith("image/"))) {
          const blob = await item.getType(type);
          files.push(new File([blob], `clipboard-${Date.now()}.${extensionForImageMime(type)}`, { type }));
        }
      }
      if (!files.length) {
        new Notice("剪贴板中没有可用的图片。", 3500);
        return;
      }
      await this.importImages(files);
    } catch (error) {
      this.traceInput("clipboard-read-denied", error instanceof Error ? error.name : "unknown");
      this.showNativePasteTarget();
    }
  }

  private async onPaste(event: ClipboardEvent): Promise<void> {
    const pastedIntoToolbar = event.target === this.canvasPasteTarget;
    if (pastedIntoToolbar) {
      // Close the floating control as soon as WebKit delivers the confirmed
      // system paste; import/storage work continues after the UI is dismissed.
      event.preventDefault();
      this.hideCanvasPasteMenu();
      this.canvasPasteTarget.blur();
    }
    const data = event.clipboardData;
    const candidates = [
      ...Array.from(data?.files ?? []),
      ...Array.from(data?.items ?? []).map((item) => item.kind === "file" ? item.getAsFile() : null).filter((file): file is File => file !== null)
    ];
    const unique = new Map<string, File>();
    for (const file of candidates) {
      if (file.type.startsWith("image/")) unique.set(`${file.name}:${file.size}:${file.type}`, file);
    }
    const files = [...unique.values()];
    if (event.target === this.canvasPasteProxy) this.traceInput("paste-event", `images=${files.length}`);
    if (!files.length) {
      if (pastedIntoToolbar || event.target === this.canvasPasteProxy) {
        event.preventDefault();
        new Notice("剪贴板中没有可粘贴的图片。", 3500);
      }
      if (event.target === this.canvasPasteProxy) this.releaseCanvasPasteProxy();
      return;
    }
    event.preventDefault();
    if (event.target === this.canvasPasteProxy) this.releaseCanvasPasteProxy();
    await this.importImages(files);
    this.hideCanvasPasteMenu();
  }

  private registerImageDropTarget(target: HTMLElement): void {
    this.registerDomEvent(target, "dragover", (event) => {
      this.acceptImageDrop(event);
    });
    this.registerDomEvent(target, "drop", (event) => {
      this.receiveImageDrop(event);
    });
  }

  private registerInputDocumentDropTarget(target: Document): void {
    this.registerDomEvent(target, "dragover", (event) => {
      this.acceptImageDrop(event);
    }, { capture: true });
    this.registerDomEvent(target, "drop", (event) => {
      this.receiveImageDrop(event);
      if (event.defaultPrevented) event.stopPropagation();
    }, { capture: true });
  }

  private acceptImageDrop(event: DragEvent): void {
    if (!acceptsFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  private receiveImageDrop(event: DragEvent): void {
    if (!acceptsFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    const files = imageFilesFromTransfer(event.dataTransfer);
    if (!files.length) {
      new Notice("已收到外部文件，但系统未提供可导入的图片数据。请使用“插入图片”或长按粘贴。", 5000);
      return;
    }
    void this.importImages(files, this.screenToWorld(this.eventPoint(event)));
  }

  private async importImages(files: File[], placement?: ScreenPoint): Promise<void> {
    if (!this.file || files.length === 0) return;
    const file = this.file;
    const session = this.boardSession.currentForFile(file);
    if (!session) return;
    const parent = file.parent?.path ?? "";
    const folder = normalizePath(`${parent}/${file.basename}.assets`);
    const importer = new ImageImportService({
      ensureFolder: async (path) => {
        if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path);
      },
      writeBinary: async (path, contents) => { await this.app.vault.createBinary(path, contents); }
    });
    const center = placement ?? this.screenToWorld({ x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 });
    const task = new ImageImportTask(this.boardSession, session, file, folder, center);
    this.imageImportTasks.add(task);
    let result;
    try {
      result = await importer.import({
        files, folderPath: task.folderPath, placement: task.placement,
        createId: makeId, now: () => new Date().toISOString(), shouldContinue: () => task.active
      });
    } catch (error) {
      if (!task.active) {
        this.notifyInterruptedImageImport(task, 0);
        return;
      }
      console.error("Infinite Board: failed to create attachment folder", error);
      new Notice("无法创建画布附件目录，图片未导入。", 5000);
      return;
    } finally {
      this.imageImportTasks.delete(task);
    }
    if (!task.active || result.cancelled) {
      this.notifyInterruptedImageImport(task, result.writtenPaths.length);
      return;
    }
    if (files.length > 1) new Notice(`正在导入 ${files.length} 张图片…`, 2500);
    for (const failure of result.failures) console.error("Infinite Board: image import failed", failure.file.name, failure.error);
    if (result.images.length > 0) {
      const startIndex = this.data.elements.length;
      const command = new InsertElementsCommand(
        result.images.map((element, index) => ({ index: startIndex + index, element })),
        "导入图片"
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
      new Notice(`已插入 ${result.images.length} 张图片${result.failures.length ? `，${result.failures.length} 张失败` : ""}。`, 4000);
    } else {
      new Notice("图片导入失败，请换用 PNG 或 JPEG 后重试。", 5000);
    }
  }

  private cancelImageImports(session?: BoardSessionToken): void {
    for (const task of this.imageImportTasks) {
      if (!session || task.session === session) task.cancel();
    }
  }

  private notifyInterruptedImageImport(task: ImageImportTask, writtenCount: number): void {
    if (writtenCount === 0) {
      new Notice(`画板 ${task.file.path} 的图片导入已停止，未写入附件。`, 6000);
      return;
    }
    const currentFolder = normalizePath(`${task.file.parent?.path ?? ""}/${task.file.basename}.assets`);
    const recovery = currentFolder === task.folderPath
      ? "可在原画板使用“检查并恢复当前画板图片”。"
      : "画板可能已重命名，请保留旧附件目录并按路径查找。";
    new Notice(`画板 ${task.file.path} 的导入已停止；${writtenCount} 个附件保留在 ${task.folderPath}。${recovery}`, 10000);
  }

  async inspectAndRecoverImages(): Promise<void> {
    const health = this.currentBoardHealth();
    if (!health) return;
    new ImageRecoveryModal(this.app, health, () => void this.recoverImagePaths(health.unlinkedPaths)).open();
  }

  private currentBoardHealth(): BoardHealthSnapshot | null {
    if (!this.file) return null;
    const folderPath = normalizePath(`${this.file.parent?.path ?? ""}/${this.file.basename}.assets`);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    const candidates = folder instanceof TFolder
      ? folder.children.filter((child): child is TFile => child instanceof TFile && looksLikeImage(child.name)).map((child) => child.path)
      : [];
    const health = this.boardAssets.inspect(this.data.elements, candidates, (path) => this.app.vault.getAbstractFileByPath(path) instanceof TFile);
    return boardHealthSnapshot(this.file.stat.size, health);
  }

  private async recoverImagePaths(paths: readonly string[]): Promise<void> {
    if (!paths.length) return;
    const center = this.screenToWorld({ x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 });
    const columns = Math.max(1, Math.ceil(Math.sqrt(paths.length)));
    const cellWidth = 520;
    const cellHeight = 380;
    const recovered: BoardImage[] = [];
    for (let index = 0; index < paths.length; index += 1) {
      const file = this.app.vault.getAbstractFileByPath(paths[index]);
      if (!(file instanceof TFile)) continue;
      const dimensions = await readImageUrlDimensions(this.app.vault.getResourcePath(file));
      const scale = Math.min(1, 480 / Math.max(1, dimensions.width), 340 / Math.max(1, dimensions.height));
      const width = dimensions.width * scale;
      const height = dimensions.height * scale;
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = center.x + (column - (columns - 1) / 2) * cellWidth - width / 2;
      const y = center.y + row * cellHeight - height / 2;
      const now = new Date().toISOString();
      recovered.push({
        id: makeId("image"), type: "image", createdAt: now, updatedAt: now, path: file.path,
        x, y, width, height, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }
      });
    }
    if (!recovered.length) {
      new Notice("未找到可恢复的图片附件。", 3500);
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
    new Notice(`已恢复 ${recovered.length} 张图片，并保存到当前画板。`, 5000);
  }

  private fitContent(): void {
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

  private contentBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const xs: number[] = [];
    const ys: number[] = [];
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

  private queueSave(): void {
    this.history.commit(this.data);
    this.markDirty();
    this.scheduleSave();
  }

  private scheduleSave(delay = 1200): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow(), delay);
  }

  private markDirty(invalidateScene = true): void {
    if (!this.saveState.markDirty(this.canSave)) return;
    if (invalidateScene) this.invalidateSceneCache();
    this.setSaveState("unsaved");
  }

  private async saveNow(): Promise<void> {
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
    const operation = (async (): Promise<void> => {
      try {
        const currentContent = await this.app.vault.read(file);
        if (!this.boardSession.isCurrent(session)) return;
        if (this.lastSavedContent && currentContent !== this.lastSavedContent) {
          await this.protectConflict("保存前检测到其他设备的修改", session);
          return;
        }
        if (this.drawingPointer !== null || this.penPointer !== null) {
          this.saveState.requestResave();
          this.setSaveState("unsaved");
          return;
        }

        const savedAt = new Date().toISOString();
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
        new Notice("无限画布保存失败，内容仍保留在当前视图中。", 5000);
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

  private async onExternalModify(file: TFile): Promise<void> {
    const session = this.boardSession.currentForPath(file.path);
    if (!session || !this.file || file.path !== this.file.path || this.conflictDetected) return;
    window.clearTimeout(this.externalCheckTimer);
    this.externalCheckTimer = window.setTimeout(() => void this.checkExternalModify(file, session), 120);
  }

  private async checkExternalModify(file: TFile, session: BoardSessionToken): Promise<void> {
    if (!this.boardSession.isCurrent(session) || !this.file || file.path !== this.file.path || this.conflictDetected) return;
    try {
      const raw = await this.app.vault.read(file);
      if (!this.boardSession.isCurrent(session) || !this.file || file.path !== this.file.path || this.conflictDetected) return;
      const decision = this.saveState.classifyExternal(raw);
      if (decision === "ignore") return;
      if (decision === "conflict") {
        await this.protectConflict("Obsidian Sync 更新与本地未保存内容重叠", session);
        return;
      }
      const external = parseBoard(raw);
      const updateDecision = externalBoardUpdateDecision(this.data.revision, external.revision);
      if (updateDecision === "protect-older") {
        await this.protectConflict("检测到较旧的同步版本，当前画板未被覆盖", session);
        return;
      }
      if (updateDecision === "protect-diverged") {
        await this.protectConflict("检测到并行修改的同步版本，当前画板未被覆盖", session);
        return;
      }
      if (updateDecision === "protect-inconsistent") {
        await this.protectConflict("同步版本内容与版本标识不一致，当前画板未被覆盖", session);
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
      this.setSaveState("saved", "已载入同步更新");
      this.scheduleRender();
    } catch (error) {
      if (!this.boardSession.isCurrent(session)) return;
      console.error("Infinite Board: external update failed", error);
      this.setSaveState("error", "无法读取同步更新");
    }
  }

  private async protectConflict(reason: string, session: BoardSessionToken): Promise<void> {
    if (!this.boardSession.isCurrent(session) || !this.file || this.conflictDetected) return;
    this.saveState.detectConflict();
    this.canSave = false;
    window.clearTimeout(this.saveTimer);
    const parent = this.file.parent?.path ?? "";
    const stamp = window.moment().format("YYYY-MM-DD HH-mm-ss");
    const conflictPath = normalizePath(`${parent}/${this.file.basename} (本地冲突 ${stamp}).${BOARD_EXTENSION}`);
    const snapshot = cloneBoard(this.data);
    snapshot.updatedAt = new Date().toISOString();
    snapshot.revision = createBoardRevision();
    try {
      await this.app.vault.create(conflictPath, serializeBoard(snapshot));
      if (!this.boardSession.isCurrent(session)) return;
      this.conflictRecovery.record(conflictPath);
      this.setSaveState("conflict", "本地内容已另存");
      new Notice(`${reason}。本地内容已保存为：${conflictPath}`, 9000);
    } catch (error) {
      if (!this.boardSession.isCurrent(session)) return;
      this.conflictRecovery.clear();
      console.error("Infinite Board: conflict backup failed", error);
      this.setSaveState("error", "冲突副本创建失败");
      new Notice("检测到同步冲突，但冲突副本创建失败。请勿关闭当前画布。", 9000);
    }
  }

  private async createRecoveryCopy(label: string): Promise<string> {
    if (!this.file) throw new Error("当前画板已关闭，无法创建恢复副本。");
    const parent = this.file.parent?.path ?? "";
    const stamp = window.moment().format("YYYY-MM-DD HH-mm-ss");
    let path = normalizePath(`${parent}/${this.file.basename} (${label} ${stamp}).${BOARD_EXTENSION}`);
    if (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${parent}/${this.file.basename} (${label} ${stamp} ${makeId("copy")}).${BOARD_EXTENSION}`);
    }
    const snapshot = cloneBoard(this.data);
    snapshot.revision = createBoardRevision();
    await this.app.vault.create(path, serializeBoard(snapshot));
    new Notice(`恢复副本已保存为：${path}`, 7000);
    return path;
  }

  private eventPoint(event: MouseEvent | PointerEvent | WheelEvent): ScreenPoint {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private screenToWorld(point: ScreenPoint): ScreenPoint {
    const camera = this.data.camera;
    return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
  }

  private makePoint(point: ScreenPoint, event: PointerEvent, fallbackPressure = 0.25): Point {
    return {
      x: point.x,
      y: point.y,
      pressure: event.pressure > 0 ? event.pressure : fallbackPressure,
      time: event.timeStamp
    };
  }

  private center(points: ScreenPoint[]): ScreenPoint {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length
    };
  }

  private distance(a: ScreenPoint, b: ScreenPoint): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}

function diagnosticPlatformSummary(): string {
  const mode = Platform.isDesktopApp
    ? "desktop-app"
    : Platform.isMobileApp
      ? "mobile-app"
      : Platform.isDesktop
        ? "desktop"
        : "mobile";
  const os = Platform.isIosApp
    ? "ios"
    : Platform.isAndroidApp
      ? "android"
      : Platform.isMacOS
        ? "macos"
        : Platform.isWin
          ? "windows"
          : Platform.isLinux
            ? "linux"
            : "unknown";
  const screen = Platform.isTablet ? "tablet" : Platform.isPhone ? "phone" : "screen";
  return `${mode}/${os}/${screen}${Platform.isSafari ? "/safari" : ""}`;
}
