# Git 版本管理

本仓库使用语义化版本和 Git 标签保存可发布版本。面向 Obsidian Community 的版本标签必须与 `manifest.json` 的 `version` 完全一致，例如 `0.4.82`，不使用 `v` 前缀。

## 发布规则

1. 每项修改在独立提交中完成，并保留对应测试。
2. 运行 `npm run check`；涉及性能或输入链路时同时按项目文档完成额外回归。
3. 更新版本号、运行时版本、`versions.json` 和 README 变更说明。
4. 提交源码与发布产物，然后创建注释标签，例如 `0.4.82`。
5. 打包并安装只使用该标签对应的三份产物：`manifest.json`、`main.js`、`styles.css`。

## 回退

先检查目标版本，再按项目安全安装流程部署，不直接复制整个插件目录：

```bash
git switch --detach 0.4.82
npm ci
npm run check
npm run release:install -- <插件目录绝对路径>
```

安装流程会保留插件的 `data.json`，不会覆盖用户画笔偏好。
