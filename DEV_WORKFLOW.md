# 本地开发与社区发布

本工作区是日常开发分支 `dev`。社区正式版从 `public-release` 分支和正式版本标签发布。

## 当前使用方式

日常使用的 Obsidian 仓库是：

```text
/Users/wuenhao/Documents/Obsidian仓库
```

这个仓库同时保留两个独立安装：

```text
# 日常开发版
/Users/wuenhao/Documents/Obsidian仓库/.obsidian/plugins/infinite-board-dev

# 社区正式版
/Users/wuenhao/Documents/Obsidian仓库/.obsidian/plugins/infinite-board
```

开发版的插件 ID 是 `infinite-board-dev`；正式版的插件 ID 是 `infinite-board`。安装脚本只修改开发目录中的 Manifest，不会覆盖正式版。

两个插件不能同时启用，因为二者注册相同的画板 View 类型。日常默认启用开发版。

### 临时查看正式版

1. 打开 Obsidian 设置 → 第三方插件。
2. 关闭 `Infinite Whiteboard Dev`，启用 `Infinite Whiteboard`。
3. 看完后关闭 `Infinite Whiteboard`，重新启用 `Infinite Whiteboard Dev`。

切换只涉及启用状态，不会删除任一插件的 `data.json`、画板或附件。

## 日常开发

```bash
cd /Users/wuenhao/Documents/ChatGPT/Infinite-Whiteboard-dev
npm run dev
```

完成一轮修改后运行：

```bash
npm run dev:install -- \
  "/Users/wuenhao/Documents/Obsidian仓库/.obsidian/plugins/infinite-board-dev"
```

然后在 Obsidian 的第三方插件中重新加载开发版，或停用后再启用。安装脚本保留开发版现有的 `data.json`。

日常小改动只提交到 `dev` 分支，不提升正式发布版本，也不创建版本标签。需要连续调试时，可以让 `npm run dev` 保持运行；结束监听后执行一次 `dev:install`，把最新构建同步到当前仓库。

## 准备正式发布

1. 在 `dev` 分支完成测试。
2. 只提升一次 `manifest.json`、`package.json`、`package-lock.json`、`versions.json` 和运行时版本。
3. 运行 `npm run check`。
4. 合并到 `public-release`。
5. 使用与 Manifest 完全一致的版本号创建标签，例如 `0.4.85`。
6. 推送标签，等待 GitHub Release。
7. 在 Obsidian Community 完成 Review 后发布。

只有正式发布才创建 `x.y.z` 标签。日常开发提交和提交哈希不是发布版本。
