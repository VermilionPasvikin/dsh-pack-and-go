# 最终验收报告（v0.1.0）

> 日期：2026-11-10　版本：`dsh-mover@0.1.0`（暂名）
> 对应 `docs/SPEC.md` v1.0、`docs/TASKS.md` M0–M7。

## 1. 交付物

| 类别 | 内容 |
|---|---|
| Host 插件 | `src/host/`（catalog、commands、register、rebuild） |
| Client 面板 | `src/client/client.js`（侧边栏入口、选择树、导出/导入、中英文案） |
| 核心库 | `src/core/`（21 个模块：包格式、zstd 帧、路径、预检、扫描、zip、计划、附件、工作区、备份、进度） |
| Bundle 元数据 | `cordis.patch.yml`、`locale/zh.json`、`locale/en.json`、`icon.svg` |
| 测试 | `tests/unit/`（15 个文件）、`tests/e2e/`（3 个文件） |
| 文档 | SPEC / DESIGN / DECISIONS（8 条 ADR）/ TASKS / DEVLOG / ACCEPTANCE / INDEX / README / AGENTS |

## 2. 验证汇总

| 项 | 结果 |
|---|---|
| 单元测试 | **163 passed / 0 failed** |
| 跨平台 E2E | 3 passed（Windows→POSIX cwd、POSIX→Windows 非法名、预检报告） |
| 安全 E2E | 3 passed（包内无凭据/缓存/依赖、路径穿越拒绝、敏感名断言） |
| 性能 E2E | 100 MB：扫描 1 ms、打包 368 ms、rss 增量 101 MB |
| 覆盖率 | 行 92.67% / 分支 81.46% / 函数 96.21% |
| 一次性 profile 集成 | 插件行加载、命令注册、导包（1128 B）、导入（会话 + 工作区 + attach）、跨版本重建（sessions 1→2） |
| SPEC §11 | 4/5/6/7/9 通过；1/2/3/10 部分；8 未达标（见 `ACCEPTANCE.md`） |

## 3. 已知限制与技术债

1. **内存式打包**：`buildPack` 将文件整体读入内存；100 MB 文件 rss 增量约 101 MB，500 MB 场景会超过 NFR-2 的 300 MB。需要流式 zip/deflate 实现。
2. **浏览器渲染未验证**：本环境无浏览器控制；Edge headless 截图失败。仅验证了脚本加载（boot 含 `client.js`）与命令注册。
3. **取消与清理未实现**：命令执行无法中断；没有“取消后删除临时包”的逻辑。
4. **符号链接/权限位转换未实现**：预检能检测，`restoreWorkspaceFiles` 只做文件名转换。
5. **精确进度未实现**：按 ADR-0008 使用“转圈 + 阶段文案”，无百分比。
6. **`mover` 命令复用 agent 上下文**：UI 用第一个会话的 `agentId` 调用命令；无会话时提示不可用。

## 4. 未验证清单

- 侧边栏图标点击 → 页面打开（真实浏览器）；
- 明暗主题、语言切换的实际渲染；
- 勾选/半选/按钮禁用的交互；
- 导入冲突提示的界面呈现；
- 500 MB 工作区与“取消”场景。

## 5. 后续建议（按优先级）

1. 用真实浏览器（或可用的 headless 浏览器）完成 M3/M4 的渲染验收；
2. 实现流式打包（zip writer 增量写盘 + CRC 流式累加），再跑 500 MB 验收；
3. 为命令增加 AbortSignal 与临时文件清理；
4. 补符号链接/权限位转换与转换报告；
5. 如确需精确进度，按 ADR 升级为 HTTP 路由 + NDJSON 流（方案 A）。
