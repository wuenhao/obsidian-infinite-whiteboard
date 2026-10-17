# Infinite Board Architecture

## Stability rules

1. Persistent document state lives in schema v5 `BoardData` and is serialized by an explicit whitelist in `serializeBoard`. Array order is paint/layer order. A bounded revision ancestry records causal Sync order without relying on device clocks; concurrent branches are preserved as conflict copies, never auto-merged. Serialization is compact JSON to reduce whole-file Sync payload; whitespace is not part of the format contract.
2. View state such as selection, diagnostics and laser strokes must never be added to `BoardData`.
3. Every `.board` document has a schema version. Format changes require a sequential migration in `src/model/migrations.ts`.
4. A future schema or malformed persistent element is opened in recovery mode and must never overwrite the source file.
5. Brush settings live in Obsidian plugin data; each persistent stroke stores its own immutable brush snapshot.
6. iPad owns its canvas in a same-origin blank child document so Obsidian host-document tap/gesture recognizers cannot compete with Pencil contacts. Desktop and Android keep the host-document canvas.
   iPad default Pencil input is canvas-targeted Pointer Events with `setPointerCapture()` on every canvas `pointerdown`.
   Pointer start, move, up, cancel and lost-capture processing stays at the canvas boundary; it must not be moved back to a window-level interception path without iPad evidence.
   The legacy native Stylus Touch route remains a session-scoped diagnostic fallback only. Pointer and Touch routes are mutually exclusive for any one view session.
   Pencil Pointer Events do not call `preventDefault()` in the high-frequency path. On iPad, the parallel Safari-only Stylus Touch stream is deliberately cancelled at the plugin boundary to prevent iPadOS Scribble from swallowing later Pointer strokes; ordinary finger and mixed touches remain untouched. Canvas `touch-action: none` owns normal gesture suppression.
   Input flight-recorder entries are bounded, memory-only diagnostics and must never enter settings, board serialization, history or Sync. Pointer traces include event phase and canvas capture state.
   The runtime version is compiled into `main.js` independently of `manifest.json`. Release diagnostics must report both values so a partially synced installation cannot masquerade as the new runtime. Copy release files in `main.js`, `styles.css`, then `manifest.json` order.
   On iPad the bounded input recorder remains active while its panel is closed. Diagnostic UI has a non-scrolling action region and updates existing text nodes only; it must not require a visible overlay during Pencil reproduction.
   iPad may recover a missing pen `pointerdown` only from a primary-button, positive-pressure pen `pointermove` whose composed path contains the canvas and only while no pointer session is active. The bounded recorder uses O(1) ring replacement and must not retain every high-frequency Stylus Touch move.
   In Pointer mode, an isolated-document Stylus Touch may start one fallback stroke only when no Pointer session is active. It must not change the global input mode, accept direct/mixed touches or duplicate a Pointer-started stroke.
7. Rendering reads state and may cache derived paths, but does not modify persistent state.
8. User-visible mutations must be undoable. New 0.3+ editing features, including ordinary image import, use element-level commands; the snapshot adapter remains only for backward-compatible pen and eraser behavior.
9. Selection previews are transient. Pointer cancellation, backgrounding and tool changes must restore the pre-edit elements without saving or adding an undo entry.

## iPad input stability freeze (0.4.20)

Version 0.4.19 passed sustained Apple Pencil testing on a physical iPad and is the input behavior baseline for 0.5 development. The following mechanisms form one verified system and must not be reordered, removed or independently “simplified” without a reproducible physical-device failure and a full regression run:

- same-origin iframe ownership of the iPad canvas;
- canvas-targeted Pointer Events and Pointer Capture as the default route;
- cancellation of Safari's parallel all-stylus Touch stream for Scribble protection;
- one-stroke Stylus Touch fallback only when Pointer start is absent;
- guarded recovery from a pressing pen move;
- 650ms post-stroke presentation loop;
- no per-event logging allocation on high-frequency Stylus Touch moves;
- O(1), bounded, memory-only flight recording.

The 650ms presentation window is a measured compatibility budget, not a general animation duration. It remains fixed for the frozen baseline. Any future adaptive strategy must retain 650ms as the safe fallback, prove that it cannot interrupt active or immediately subsequent strokes, and be tested for frame cost on a physical iPad.

Per-tool diagnostic counters are maintained in `src/platform/input-tool-metrics.ts`. They execute only at start, finish or recovery boundaries, have a fixed four-tool footprint, and must never be serialized or updated for every move sample.

## Rendering performance baseline (0.4.30)

Version 0.4.30 was verified by the user on a physical iPad after the intermittent Pencil failure resurfaced on large boards. The input ownership chain remained byte-for-byte equivalent to the 0.4.20 production baseline; the regression was instead associated with repeated full-scene drawing and mobile compositing cost.

The screen-space scene cache is therefore part of the stability baseline:

- paper, grid, completed strokes and images are rendered into a reusable in-memory canvas;
- active Pencil frames composite the cached scene and draw only the current stroke plus transient overlays;
- persistent content edits, camera movement, resize, image load and external Sync reload invalidate the cache;
- cache identity includes physical canvas size and camera state;
- the cache is never serialized and its backing canvas is released when the view unloads;
- render diagnostics report total frames, slowest frame, cache builds, cache hits and slowest build.

Do not replace this with unconditional full-scene rendering on every input sample. Cache changes must preserve paint order, image loading, selection overlays and the 0.4.20 input freeze, and require physical-iPad testing on both small and large boards. See `PENCIL_INPUT_STABILITY.md` for the incident history and decision tree.

## Modules

- `src/model`: persistent types, validation and sequential migrations.
- `src/persistence`: the serialization boundary plus `BoardSaveState`, a pure dirty/revision/save/Sync decision state machine. The view remains responsible for timers, Vault I/O, notices and conflict-copy creation.
- `src/assets`: cross-platform image MIME/name helpers, browser dimension decoding, `ImageImportService`, `BoardAssetCoordinator` and the decoded-image cache. `ImageImportService` owns attachment-folder creation, binary writes and persistent image-element construction through a minimal storage adapter; the View retains file picking, screen placement, history, selection and Notice coordination. `BoardAssetCoordinator` owns referenced-path checks, image-cache lifecycle, delayed Sync attachment refresh and recovery-scan health data; the View only adapts Vault file objects and opens the recovery UI. Failed decodes release their cache entry.
- `BoardHealthSnapshot` is an immutable display-neutral snapshot of board bytes and attachment health. Both the recovery UI and copied diagnostic report consume it; calculating it must not write, restore or delete attachments.
- `src/platform`: platform-specific input classification without event ownership, plus bounded diagnostic snapshot formatting.
- `src/rendering`: pure pressure/stroke geometry, scene-cache identity and viewport culling through `ElementSpatialIndex`.
- `SceneRenderer` owns frame composition and bounded render metrics; `SceneCache` owns only its in-memory backing canvas and validity lifecycle. The view supplies paint callbacks and invalidation signals but must not regain cache storage fields.
- `src/selection`: geometry, element operations and `SelectionController`, which owns transient selection/drag state.
- `src/tools`: extensible tool contracts, the activation/deactivation registry and tool-specific controllers. `LaserController` is the reference implementation for transient, non-persistent tools.
- `src/history`: compatibility snapshot history and element-level update, insert, delete and reorder commands.
- `src/plugin`: plugin settings normalization.
- `main.ts`: Obsidian lifecycle, view coordination and the unchanged iPad input sequence.

## HMI boundaries

- The top utility toolbar owns reversible document and viewport actions; the bottom creative toolbar owns active tools and their settings. New actions should be placed by task role rather than appended to one unbounded strip.
- Primary touch targets remain at least 44 CSS pixels on coarse-pointer devices. Tool selection exposes text alternatives, `aria-pressed` state and a non-color-only active treatment.
- Floating panels must remain outside the isolated iPad input iframe, respect safe-area insets, and avoid covering the main writing region. They must not add document-level gesture interception.
- HMI state such as open panels, visual previews and toolbar scroll positions is transient and never enters `BoardData` or Sync.
- 高级视图操作通过 Obsidian `ItemView.addAction()` 注册到画布标题行：高频撤销、重做、插入图片和适合内容与“更多”同层，低频输入诊断位于宿主原生“更多”菜单。画布粘贴菜单是临时 DOM：仅通过普通手指长按或鼠标右键显示，不能抢占 Pencil 输入、写入历史或持久化。

## Adding a persistent element

Before adding an element type, update the model, validator, serializer, migration chain and tests together. Do not persist DOM nodes, `Path2D`, object URLs, absolute file paths or transient tool state. New tools must first be registered in `TOOL_DEFINITIONS` and should implement the shared `ToolController` lifecycle as their behavior is moved out of the view coordinator.

## Adding a tool controller

Register user-visible metadata in `TOOL_DEFINITIONS`, implement `ToolController`, and register the instance with `ToolControllerRegistry`. Activation must deactivate the previous registered controller first. Transient controllers must clear unfinished and visible state in `onDeactivate`; persistent controllers must route completed mutations through `BoardHistory`. Input routing remains owned by `main.ts` so platform-specific Pencil handoff order is not changed by tool implementations.

Local erasing is implemented as pure geometry in `src/tools/stroke-eraser.ts`. It clips stroke segments against a circular eraser, interpolates boundary pressure/time values and returns stroke fragments compatible with the current schema. Whole-stroke erasing shares the same result contract. The first surviving fragment retains the source ID; additional fragments receive new IDs. A whole eraser gesture uses one undoable edit and does not clone unrelated board elements.

Schema v4 adds image `rotation` and normalized `crop` fields. Image drawing, hit testing, spatial bounds, selection transforms and serialization must use those fields together. Selection layout and image transforms live in `src/selection`; transient selection mode and eraser preferences remain in plugin settings rather than `BoardData`.

Single-image crop and rotation are transient `SelectionController` modes. Their eight crop handles and rotation handle are derived in world geometry, so mouse and Pencil reuse the existing selection start/update/finish lifecycle without adding branches to the frozen iPad input path. Every completed drag records one `UpdateElementsCommand`; cancellation restores the original snapshot. The contextual toolbar is intentionally image-only: six commands for one image and eight layout commands for multiple images.

Image attachments that exist in a board-specific `.assets` folder but are absent from `BoardData` are recoverable evidence, not disposable garbage. The recovery command must remain explicit and user-confirmed because an unreferenced file may represent either delayed Sync or an intentional image deletion. Recovery reuses Vault-relative paths, creates ordinary image elements, records one undoable history step and never deletes or moves the source files.

## Release gate

Every release must pass `npm run test`, `npm run build` and `npm run release:check`. The release check hashes the production Pencil input freeze using `scripts/release-baseline.json`; changing that block requires explicit physical-iPad review rather than silently updating the expected hash. `npm run release:package` creates an immutable archive containing only `manifest.json`, `main.js` and `styles.css`. `npm run release:install -- <plugin-directory>` accepts only an `.obsidian/plugins/infinite-board` target, copies the manifest last, verifies artifact hashes and proves `data.json` unchanged. The applicable checks in `IPAD_REGRESSION.md` must pass before new editing behavior is added. Performance/rendering changes must also run `npm run perf:baseline` and append comparable results to `PERFORMANCE_BASELINE.md`.
