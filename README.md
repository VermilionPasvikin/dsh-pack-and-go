# dsh-mover（暂名）

DSH 跨平台迁移助手：在任意平台的 DSH 之间，把「对话 + 工作区」打包成可离线传输的 `.dshpack`，并在另一台机器或另一个 profile 中导入。

## 使用

1. 在 DSH Web UI 侧边栏点击「迁移」图标打开面板。
2. **导出**：
   - 「对话 + 工作区」：勾选工作区/对话 → 填写保存位置 → 开始打包；
   - 「仅工作区」：只选工作区，导出其文件与目录结构（空文件夹保留骨架），不含任何对话。
3. **导入**：填写迁移包路径 + **目标目录（必填，默认预填 `~/dsh-mover-import`）** → 选择冲突策略（跳过 / 覆盖）→ 开始导入。
   - 覆盖 = 用包内版本恢复该对话；目标目录与现有位置不同时执行“迁移覆盖”，结果提示原/新工作区与会话名；
   - 导入失败会直接报错，**不会自动回退**到默认目录。
4. 也可以在聊天框使用命令：
   - `/mover export <目标文件> [sessionIds...]`
   - `/mover import <迁移包> <目标目录>`

## 跨平台注意

- 目标路径与原路径不同时会改写会话 `cwd`（只改 header，历史消息中的路径文本不变）。
- Windows 非法文件名会自动安全重命名，并在转换报告中记录。
- 冲突策略仅「跳过 / 覆盖」；覆盖前备份到 `<DSH_HOME>/dsh-mover-backup/<时间戳>/`。
- 大工作区默认排除 `node_modules`、`.venv`、`dist` 等可再生目录，`.git` 默认保留。

## 生效与重启

- 新导入的对话/工作区需要 DSH 启动索引更新：未打开的会话刷新页面可见；**已打开的会话、迁移覆盖的新位置、空工作区**需重启 DSH 后生效（结果文本会逐项提示）。

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
| 需求规格与验收标准 | [docs/SPEC.md](docs/SPEC.md)（v1.2） |
| 技术设计（含行为决策树） | [docs/DESIGN.md](docs/DESIGN.md) |
| 决策记录（ADR） | [docs/DECISIONS.md](docs/DECISIONS.md) |
| 项目分解与任务清单 | [docs/TASKS.md](docs/TASKS.md) |
| 开发日志 | [docs/DEVLOG.md](docs/DEVLOG.md) |
| SPEC §11 验收走查 | [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) |
| 当前状态与文档地图 | [docs/INDEX.md](docs/INDEX.md) |
| 工程纪律与提交规范 | [AGENTS.md](AGENTS.md) |

## CLI（无 GUI 环境）

```bash
# 从服务器 DSH_HOME 导出（对话）
node src/cli/index.js export --home /path/to/.dsh --out /tmp/pack.dshpack

# 仅导出工作区（可多次 --workspace）
node src/cli/index.js export --home /path/to/.dsh --out /tmp/ws.dshpack --workspace /path/to/workspace

# 导入（--target 必填；--overwrite 覆盖已存在对话）
node src/cli/index.js import --home /path/to/.dsh --pack /tmp/pack.dshpack --target /path/to/import-dir [--overwrite]
```

导入后会更新 `workspace.json`（写前备份），**重启 DSH 后可见**。

## 状态（v1.2）

功能：导出/导入（对话、工作区、仅工作区）、跨平台路径映射、工作区登记与归组修复、附件复制、迁移覆盖、空工作区登记、中英文案、流式打包、CLI。

验证：**194 项测试全绿**；500 MB 流式打包 2.9 s / 峰值 RSS 112.3 MB；CDP 真实浏览器验证关键 UI 路径。

仍有限制：取消功能不做；符号链接/权限位转换待排期；精确进度待评估；已打开会话的覆盖回滚需重启 DSH。

详见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)、[docs/FINAL-REPORT.md](docs/FINAL-REPORT.md) 与 [docs/DEVLOG.md](docs/DEVLOG.md)。
