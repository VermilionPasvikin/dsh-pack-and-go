# 最终验收报告（v0.2.0）

> 日期：2026-11-10　版本：`dsh-mover@0.2.0`（暂名）
> 对应 `docs/SPEC.md` v1.0、`docs/TASKS.md` M0–M7。

## 1. 交付物

| 类别 | 内容 |
|---|---|
| Host 插件 | `src/host/`（catalog、commands、register、rebuild） |
| Client 面板 | `src/client/client.js`（侧边栏入口、选择树、导出/导入、中英文案） |
| CLI | `src/cli/index.js`（`dsh-mover export/import`，直接访问 `DSH_HOME`） |
| 核心库 | `src/core/`（22 个模块：包格式、zstd 帧、路径、预检、扫描、zip、流式 zip、计划、附件、工作区、备份、进度） |
| Bundle 元数据 | `cordis.patch.yml`、`locale/zh.json`、`locale/en.json`、`icon.svg` |
| 测试 | `tests/unit/`（16 个文件）、`tests/e2e/`（5 个文件） |
| 文档 | SPEC / DESIGN / DECISIONS（9 条 ADR）/ TASKS / DEVLOG / ACCEPTANCE / INDEX / README / AGENTS |

## 2. 验证汇总

| 项 | 结果 |
|---|---|
| 单元测试 | **166 passed / 0 failed** |
| 跨平台 E2E | 3 passed（Windows→POSIX cwd、POSIX→Windows 非法名、预检报告） |
| 安全 E2E | 3 passed（包内无凭据/缓存/依赖、路径穿越拒绝、敏感名断言） |
| 性能 E2E | **500 MB 流式打包：2.9 s，峰值 RSS 112.3 MB**（NFR-2 达标） |
| CLI E2E | 3 passed（导出、导入并更新 `workspace.json`、参数错误） |
| 渲染逻辑 | 3 passed（slot 注册、中/英文标题与加载态） |
| 覆盖率（v0.1.0 时） | 行 92.67% / 分支 81.46% / 函数 96.21% |
| 一次性 profile 集成 | 插件行加载、命令注册、导包、导入（会话 + 工作区 + attach）、跨版本重建 |
| SPEC §11 | 6 项通过、4 项部分（见 `ACCEPTANCE.md`） |

## 3. 已知限制与技术债

1. **真实浏览器渲染未验证**：Edge headless 在本环境不可用；已用 fake React 验证组件树与文案，但样式/主题/点击未在真实浏览器确认。
2. **取消与清理未实现**：命令执行无法中断，没有“取消后删除临时包”的逻辑。
3. **符号链接/权限位转换未实现**：预检能检测，`restoreWorkspaceFiles` 只做文件名转换。
4. **精确进度未实现**：按 ADR-0008 使用“转圈 + 阶段文案”。
5. **CLI 导入需要重启 DSH**：直接更新 `workspace.json`，运行中的 DSH 不会热加载。
6. **UI 命令复用 agent 上下文**：用第一个会话的 `agentId` 调用命令；无会话时提示不可用。

## 4. 未验证清单

- 侧边栏图标点击 → 页面打开（真实浏览器）；
- 明暗主题、语言切换的实际渲染；
- 勾选/半选/按钮禁用的交互；
- 导入冲突提示的界面呈现；
- “取消后清理”场景。

## 5. 后续建议（按优先级）

1. 用真实浏览器（或可用的 headless 浏览器）完成 M3/M4 的渲染验收；
2. 为命令增加 AbortSignal 与临时文件清理；
3. 补符号链接/权限位转换与转换报告；
4. 如确需精确进度，按 ADR 升级为 HTTP 路由 + NDJSON 流（方案 A）；
5. CLI 增加 `--dry-run`、`--list` 等诊断子命令。
