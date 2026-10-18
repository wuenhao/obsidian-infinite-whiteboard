# 无限白板 · Infinite Whiteboard

**一张画板，所有设备继续。**

无限白板是一款支持 **iPad、Mac、Windows、iPhone（iOS）和 Android** 的跨平台无限画布插件。在 iPad 上手写批注，在 Mac 或 Windows 上整理截图与资料，在 iPhone 或 Android 上随时查看并继续编辑；通过你已有的 Obsidian 同步方式，在不同设备间打开同一个 `.board` 文件。

<p align="center">
  <img src="https://raw.githubusercontent.com/wuenhao/obsidian-infinite-whiteboard/HEAD/docs/screenshots/ipad-multiplatform.png" alt="无限白板在 iPad 上使用" width="72%">
  <img src="https://raw.githubusercontent.com/wuenhao/obsidian-infinite-whiteboard/HEAD/docs/screenshots/mobile-multiplatform.jpg" alt="无限白板在手机上使用" width="23%">
</p>

**多端支持：iPadOS · macOS · Windows · iOS · Android**

Infinite Whiteboard is a cross-platform infinite canvas plugin for **iPad, Mac, Windows, iPhone, and Android**. Sketch with Apple Pencil or touch on iPad, organize screenshots and references on desktop, and continue on your phone whenever inspiration strikes.

## Features

- Infinite canvas with pan, zoom, and fit-to-content controls.
- Drag, select, or paste screenshots and photos, then crop, rotate, or lock them.
- Apple Pencil writing with ballpoint, fountain pen, highlighter, and laser tools.
- Pressure-sensitive strokes with original samples and immutable brush snapshots.
- Partial or whole-stroke erasing with one-step undo per gesture.
- Rectangle selection, freehand lasso, multi-select transforms, alignment, and distribution.
- Local-first storage with no telemetry, online service, or automatic board upload.

## Installation

1. Open **Settings → Community plugins** in Obsidian.
2. Turn off Restricted Mode.
3. Select **Browse** and search for **Infinite Whiteboard**.
4. Install and enable the plugin.

## Usage

1. Select the pen icon in the left ribbon, or run **Create new infinite whiteboard** from the command palette.
2. Write on the canvas, drag in images, or paste screenshots.
3. Use the stationery toolbar to switch brushes, laser, and eraser tools.
4. Use the top toolbar to undo, redo, insert images, or fit the board to its contents.
5. Boards are saved as `.board` files inside the vault and can be viewed across devices with Obsidian Sync.

## Compatibility and data

- Minimum Obsidian version: `1.5.0`.
- Supported platforms: iPadOS, macOS, Windows, iOS, and Android.
- `.board` files currently use schema v5 with continuous migration from older formats.
- Images use vault-relative paths and are stored in an `.assets` folder beside the board.
- The plugin sends no network requests and collects no telemetry.
- Concurrent editing of one board is not supported; parallel changes across devices are preserved as conflict copies instead of being silently overwritten.

## 中文说明

无限白板用于在 Obsidian 中整理截图、照片和 Apple Pencil 手写批注。它提供无限画布、图片导入与裁剪、压感手写、局部或整笔橡皮擦、框选与套索、多选变换、图层排序和撤销重做。

插件采用本地优先设计：画板、附件和画笔偏好保存在用户自己的 Vault 中，不上传画板数据，也不包含遥测或在线服务。跨设备并行修改会保留冲突副本，避免静默覆盖。

## 开发

```bash
npm ci
npm run check
npm run dev
```

生产构建会生成 `manifest.json`、`main.js` 和 `styles.css`。官方发布使用与 Manifest `version` 完全一致的 Git 标签，并将这三个文件附加到 GitHub Release。

架构说明见 [ARCHITECTURE.md](./ARCHITECTURE.md)，完整版本记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 作者

贤思齐

## 许可证

[MIT](./LICENSE)
