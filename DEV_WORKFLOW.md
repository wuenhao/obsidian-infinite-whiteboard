# 本地开发与社区发布

本工作区是日常开发分支 `dev`。社区正式版从 `public-release` 分支和正式版本标签发布。

## 一次性准备

开发插件安装到独立目录，插件 ID 只在安装后的 Manifest 中改为 `infinite-board-dev`：

```bash
npm run dev:install -- "/Users/wuenhao/Documents/ChatGPT/Infinite-Whiteboard-Dev-Vault/.obsidian/plugins/infinite-board-dev"
```

正式插件仍位于：

```text
/Users/wuenhao/Documents/Obsidian仓库/.obsidian/plugins/infinite-board
```

两个插件不能同时启用，因为二者注册相同的画板 View 类型。日常使用正式 Vault；开发测试使用独立开发 Vault。

## 日常开发

```bash
cd /Users/wuenhao/Documents/ChatGPT/Infinite-Whiteboard-dev
npm run dev
```

完成一轮修改后运行：

```bash
npm run dev:install -- "/Users/wuenhao/Documents/ChatGPT/Infinite-Whiteboard-Dev-Vault/.obsidian/plugins/infinite-board-dev"
```

然后重新加载开发 Vault 中的插件。日常小改动只用 Git 提交区分，不创建版本标签，也不提升正式 Manifest 版本。

## 准备正式发布

1. 在 `dev` 分支完成测试。
2. 只提升一次 `manifest.json`、`package.json`、`package-lock.json`、`versions.json` 和运行时版本。
3. 运行 `npm run check`。
4. 合并到 `public-release`。
5. 使用与 Manifest 完全一致的版本号创建标签，例如 `0.4.85`。
6. 推送标签，等待 GitHub Release。
7. 在 Obsidian Community 完成 Review 后发布。

只有正式发布才创建 `x.y.z` 标签。日常开发提交和提交哈希不是发布版本。
