# 最终验收报告（v1.3）

> 日期：2026-11-12　版本：`dsh-pack-and-go@0.2.0`（暂名）
> 对应 `docs/SPEC.md` v1.3、`docs/TASKS.md` M0–M9。

## 1. 交付物

| 类别 | 内容 |
|---|---|
| Host 插件 | `src/host/`（catalog、commands、register、exec-route、selftest） |
| Client 面板 | `src/client/client.js`（侧边栏入口、选择树、导出/导入、仅工作区模式、冲突明细预览、中英文案） |
| CLI | `src/cli/index.js`（`export/import`，`--target` 必填、`--workspace`、`--overwrite`） |
| 核心库 | `src/core/`（包格式、zstd 帧、路径、预检、扫描、zip、流式 zip、计划、附件、工作区、备份、进度） |
| Bundle 元数据 | `cordis.patch.yml`、`locale/zh.json`、`locale/en.json`、`icon.svg` |
| 测试 | `tests/unit/`、`tests/e2e/`（**203 项**） |
| 文档 | SPEC v1.3 / DESIGN / DECISIONS（ADR-0001~0016）/ TASKS / DEVLOG / ACCEPTANCE / INDEX / README / AGENTS / IMPORT-BEHAVIOR-TREE / TEST-CASES v1.3 |

## 2. 验证汇总（截至 2026-11-12）

| 项 | 结果 |
|---|---|
| 单元 + E2E 测试 | **203 项**：Linux 全通过；Windows 198 通过 + 5 个 POSIX 权限用例预期跳过 |
| Linux 专项 | P-04b 符号链接 ✅、P-05a exec 位 ✅（修复后）、P-06c 大小写 ✅、P-05c 权限保真 ✅（ADR-0016 B1） |
| 跨平台规则 E2E | 3 passed（Windows→POSIX cwd、POSIX→Windows 非法名、预检报告） |
| 安全 E2E | 3 passed（包内无凭据/缓存/依赖、路径穿越拒绝、敏感名断言） |
| 性能 E2E | 500 MB 流式打包：2.9 s，峰值 RSS 112.3 MB（NFR-2 达标）；1 GB 实测 6.5 s / RSS 110 MB |
| CLI E2E | 通过（导出、导入、参数错误、权限位端到端） |
| 真实浏览器（CDP） | 通过：面板打开、导入/预览/冲突明细分项、覆盖后结果、迁移覆盖提示、仅工作区模式、隐藏无关选项 |
| 导入行为 | 跳过/覆盖/迁移覆盖、空工作区登记、附件恢复、重启提示、归组/双记账修复均验证 |
| SPEC §11 | 1/2/4/5/6/7/8/9/10 通过；#3 取消功能用户决定不做 |

## 3. 已知限制与技术债（按用户决定更新）

1. **取消功能：不做**（用户决定）。
2. **符号链接/权限位：已完成**（T9.1 解引用 + ADR-0016 B1 文件权限保真）；**目录权限（B2）待另立 ADR**。
3. **精确进度：不做**（用户决定；1 GB 实测 6.5 s 供参考）。
4. **CLI 导入需要重启 DSH**：直接更新 `workspace.json`，运行中的 DSH 不热加载。
5. **已打开会话的覆盖回滚需重启 DSH**（DSH 内存会话无 reload API）；结果文本已精确提示。
6. **迁移覆盖的新位置需重启 DSH 后出现在左侧**（启动索引）；已按场景提示。
7. **macOS 平台验证待 CI**（符号链接/权限位/大小写分支）。

## 4. 未验证清单

- macOS 平台专项（P-04b/P-05a/P-05b/P-06b）；
- 明暗主题切换、语言切换的实际视觉效果（用户已确认）；
- 勾选/半选/按钮禁用的交互细节（CDP 已覆盖主要路径）。

## 5. 后续建议（按优先级）

1. 决定 ADR-0016 B2（目录权限保真）是否立项；
2. macOS CI 跑平台专项；
3. DSH 若开放 session reload API，接入真正的热重载；
4. 低风险项：exec 请求体大小上限、标题兜底缓存、激活失败提示。
