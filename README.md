# dsh-mover（暂名）

DSH 跨平台迁移助手：在任意平台的 DSH 之间，把「对话 + 工作区」打包成可离线传输的 `.dshpack`，并在另一台机器或另一个 profile 中导入。

## 使用

1. 在 DSH Web UI 侧边栏点击「迁移」图标打开面板。
2. **导出**：勾选工作区/对话 → 填写保存位置（如 `D:\迁移\我的包.dshpack`）→ 开始打包；等待期间显示转圈与阶段文案，完成后显示结果。
3. **导入**：填写迁移包路径；目标目录可留空（默认 `~/dsh-mover-import`）→ 开始导入。
4. 也可以在聊天框使用命令：
   - `/mover export <目标文件> [sessionId...]`
   - `/mover import <迁移包> [目标目录]`

## 跨平台注意

- 目标路径与原路径不同时会改写会话 `cwd`（只改 header，历史消息中的路径文本不变）。
- Windows 非法文件名会自动安全重命名，并在转换报告中记录。
- 默认跳过已存在的对话、合并同路径工作区；覆盖前会备份到 `<DSH_HOME>/backups/mover/<时间戳>/`。
- 大工作区默认排除 `node_modules`、`.venv`、`dist` 等可再生目录，`.git` 默认保留。

## 安装 / 卸载

```bash
# 安装（在 DSH 的插件管理页或 CLI）
dsh plugin --profile <profile> add <本目录绝对路径>

# 卸载
dsh plugin --profile <profile> remove dsh-mover
```

插件行由 `cordis.patch.yml` 声明，安装后以 `dsh-mover` 出现在 profile 配置中。

## 文档

| 内容 | 位置 |
|---|---|
| 需求规格与验收标准 | [docs/SPEC.md](docs/SPEC.md) |
| 技术设计 | [docs/DESIGN.md](docs/DESIGN.md) |
| 决策记录（ADR） | [docs/DECISIONS.md](docs/DECISIONS.md) |
| 项目分解与任务清单 | [docs/TASKS.md](docs/TASKS.md) |
| 开发日志 | [docs/DEVLOG.md](docs/DEVLOG.md) |
| SPEC §11 验收走查 | [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) |
| 当前状态与文档地图 | [docs/INDEX.md](docs/INDEX.md) |
| 工程纪律与提交规范 | [AGENTS.md](AGENTS.md) |

## CLI（无 GUI 环境）

```bash
# 从服务器 DSH_HOME 导出
node src/cli/index.js export --home /path/to/.dsh --out /tmp/pack.dshpack

# 导入到另一台机器（默认目标 ~/dsh-mover-import）
node src/cli/index.js import --home /path/to/.dsh --pack /tmp/pack.dshpack
```

导入后会更新 `workspace.json`（写前备份），**重启 DSH 后可见**。

## 状态（v0.2.0）

功能已实现：导出/导入、跨平台路径映射、工作区登记、附件复制、备份回滚、跨版本重建、中英文案、流式打包、CLI。

验证：166 项单测 + 13 项 E2E 全绿；500 MB 流式打包 2.9 s / 峰值 RSS 112.3 MB。

仍有限制：真实浏览器渲染未验证；取消/清理未实现；符号链接/权限位转换未实现；CLI 导入需重启 DSH。

详见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)、[docs/FINAL-REPORT.md](docs/FINAL-REPORT.md) 与 [docs/DEVLOG.md](docs/DEVLOG.md)。
