# Obsidian Community 提交清单

本仓库是面向 Obsidian Community 的干净公开发布历史，不包含内部交接记录、本机路径或测试画板信息。

## 已自动完成

- 官方显示名：`Infinite Whiteboard`
- Manifest 作者：`贤思齐`
- 稳定插件 ID：`infinite-board`
- 发布版本：`0.4.84`
- MIT 许可证
- 面向用户的 README、功能说明和界面预览
- GitHub Release 自动构建工作流
- 命令 ID 与插件 ID 重复问题
- 单元测试、竞态测试、TypeScript、生产构建和发布契约检查

## 需要仓库所有者完成

1. 创建公开 GitHub 仓库。
2. 将本分支推送到仓库默认分支：

   ```bash
   git remote add origin https://github.com/<GitHub 用户名>/<仓库名>.git
   git push -u origin public-release:main
   ```

3. 确认 GitHub Actions 可用，并允许工作流写入 Release。
4. 推送与 Manifest 完全一致的版本标签：

   ```bash
   git tag -a 0.4.84 -m "0.4.84"
   git push origin 0.4.84
   ```

5. 等待 `Release Obsidian plugin` 工作流完成，检查 Draft Release 中包含：
   - `main.js`
   - `manifest.json`
   - `styles.css`
6. 发布该 GitHub Release。
7. 登录 [Obsidian Community](https://community.obsidian.md)，绑定 GitHub 账号。
8. 在 **Plugins → New plugin** 中填写公开仓库 URL 并提交审核。
9. 根据自动审核结果修复问题；任何修复都需要提升版本并发布新的 GitHub Release。
