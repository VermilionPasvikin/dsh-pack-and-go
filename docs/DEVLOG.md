# 开发日志

> 只追加，不修改历史条目。每条：编号、日期、变更、验证、下一步。
> 提交信息末尾引用条目编号，例如 `(devlog 005)`。

## 001 · 2026-11-10 · chore: 初始化仓库与基础配置
- 变更：`git init -b main`；新增 `.gitignore`、`.gitattributes`、`README.md`。
- 验证：`git log --oneline` 出现提交 `094cdc1`。
- 下一步：迁入需求规格。

## 002 · 2026-11-10 · fix: 统一文本行尾规则并消除 git 提示噪音
- 变更：`.gitattributes` 明确 `.gitattributes`/`.gitignore` 为 LF；仓库级关闭 `useBuiltinFSMonitor` 弃用提示。
- 验证：`git commit` 输出不再出现 hint；提交 `280de13`。
- 下一步：冻结规格。

## 003 · 2026-11-10 · docs: 冻结需求规格为 v1.0
- 变更：`docs/迁移助手-需求规格.md` → `docs/SPEC.md`；标题/状态改为 v1.0；新增冻结说明表；§12 改为决策索引；§13 改为实现顺序。
- 验证：人工检查标题、冻结表、§12 表、§13 列表；提交 `3789681`。
- 下一步：编写决策记录。

## 004 · 2026-11-10 · docs: 新增决策记录 ADR-0001~0006
- 变更：新增 `docs/DECISIONS.md`，覆盖平台矩阵、选择模型、符号链接/权限位、CLI 入口、cwd 改写、导入默认值。
- 验证：ADR 编号与 SPEC §12 表一致；提交 `4beaa1a`。
- 下一步：建立索引、设计骨架、日志与 AGENTS.md。

## 005 · 2026-11-10 · docs: 建立文档索引、设计骨架、开发日志与 AGENTS.md
- 变更：新增 `docs/INDEX.md`、`docs/DESIGN.md`、`docs/DEVLOG.md`、`AGENTS.md`；确立“每次变更一个提交 + 提交前写日志”的追踪机制。
- 验证：互链路径存在；AGENTS.md 的文档导航覆盖 SPEC/DECISIONS/DESIGN/DEVLOG/INDEX；本提交后工作树干净。
- 下一步：等待实现指令（SPEC §13 第 2 步：无 UI 核心）。

## 006 · 2026-11-10 · docs: 新增项目分解与任务清单
- 变更：新增 `docs/TASKS.md`：8 个里程碑（M0–M7）、53 个任务（含 M0 已完成 3 项；每个含前置与验收标准），并定义 §0 任务流转规则。
- 验证：里程碑 8 个；任务 53 行；M0 三个任务标记完成。
- 下一步：在 AGENTS.md 接入“按任务清单接续”规则，更新 INDEX 导航与状态。

## 007 · 2026-11-10 · docs: 在 AGENTS.md 中加入按任务清单接续的规则
- 变更：`AGENTS.md` §2 导航加入 `TASKS.md`、§5 目录结构加入 `TASKS.md`、新增 §7“任务接续”（完成 → 标记 → 日志 → 提交 → 取下一个任务）；`INDEX.md` 更新当前状态与导航。
- 验证：§7 与 `TASKS.md` §0 规则一致；INDEX 的下一步指向 T1.1；互链可达。
- 下一步：等待用户检查；通过后按 T1.1 开始实现。

## 008 · 2026-11-10 · docs: 修正任务分解中的前置规则与计数笔误
- 变更：订正 006 的计数（8 个里程碑、53 个任务）；`TASKS.md` §0 明确前置写法（任务 ID / 里程碑 ID / 逗号列表，范围仅里程碑）；修正 T3.1 前置为 T2.1，T5.5/T7.4 改为逗号列表，验收改为可执行项。
- 验证：临时脚本解析依赖图输出 `tasks: 53`、`milestones: 8`、`errors: 0`（exit 0）；T3.1 前置为 T2.1；全部前置引用存在且无环。
- 下一步：等待用户检查；通过后按 T1.1 开始实现。

## 009 · 2026-11-10 · docs: 文档一致性核实与修正
- 变更：`TASKS.md` 中 M3 依赖由 `M1` 改为 `M1, M2`（实际前置为 T2.1/T2.11）；`README.md` 状态更新为“M0 完成、实现进行中”，文档表补 `TASKS.md`；`AGENTS.md` §0 必读顺序加入 `TASKS.md`。
- 验证：依赖图脚本重跑 `errors: 0`；README / AGENTS / INDEX / TASKS 的“当前状态”和任务来源互相一致。
- 下一步：T1.1。

## 010 · 2026-11-10 · feat: 建立 core 模块与单元测试骨架
- 变更：新增 `package.json`（`type: module`、`engines`、`test`/`check` 脚本）、`src/core/constants.js`、`src/core/index.js`、`tests/unit/smoke.test.mjs`；测试命令定为 `node --test "tests/unit/**/*.test.mjs"`（Node 24 不再递归目录参数）。
- 验证：`node --check` 三个文件均 exit 0；`node --test "tests/unit/**/*.test.mjs"` → 2 passed / 0 failed。
- 下一步：T1.2（包格式类型与常量）。

## 011 · 2026-11-10 · feat: 定义包格式 v2 字段与 manifest 校验
- 变更：新增 `src/core/errors.js`（`MoverError`/`ManifestError` + 3 个错误码）与 `src/core/manifest.js`（顶层与子项字段清单、`MODES`/`PLATFORMS`/`MAPPING_TYPES`/`CONVERSION_ACTIONS`、`validateManifest()`、`validateMappingEntry()`）；`src/core/index.js` 统一导出；新增 `tests/unit/manifest.test.mjs`。
- 验证：`node --check` 4 个文件 exit 0；`node --test "tests/unit/**/*.test.mjs"` → 12 passed / 0 failed（覆盖合法、未知字段、缺字段、版本过高/过低、非法 mode、workspaceKey 缺失、路径穿越、mapping 条目）。
- 下一步：T1.3（manifest 读写与版本校验）。

## 012 · 2026-11-10 · feat: manifest 读写与版本校验
- 变更：新增 `src/core/manifest-io.js`（`parseManifest`/`serializeManifest`/`readManifestFile`/`writeManifestFile`），`src/core/index.js` 统一导出；新增 `tests/unit/manifest-io.test.mjs`。
- 验证：`node --check` 3 个文件 exit 0；`node --test "tests/unit/**/*.test.mjs"` → 17 passed / 0 failed（覆盖往返一致、未知字段保留、版本过高、非法 JSON、临时目录文件读写）。
- 下一步：T1.4（zstd 多帧技术验证；完成后需 ADR-0007 拍板，不擅自决定）。

## 013 · 2026-11-10 · docs: T1.4 技术验证（zstd 多帧）
- 变更：临时脚本（`%TEMP%`，未入库）对真实会话文件做帧扫描与逐帧解码，未修改任何源文件。
- 验证：`session-0cf30744.../session.v4.jsonl.zstd` → 851 帧、压缩 1,397,398 B、解压 4,889,816 B、1284 行事件、首行 `type=session version=4 cwd=F:\PersonalProjects\python\新建文件夹`；每帧 `zstdDecompressSync` 独立成功；整文件单次调用只返回首帧 225 B，确认**必须逐帧扫描**。
- 阻塞：ADR-0007（改写策略：只重写首帧 / 全量重压缩 / DSH 服务重建会话）需用户拍板；T1.4 保持 🟨。

## 014 · 2026-11-10 · docs: ADR-0007 会话改写策略（A 主 + C 兜底）
- 变更：`DECISIONS.md` 新增 ADR-0007（用户拍板：A 主路径、C 跨版本兜底、B 不采用）；`TASKS.md` T1.4 标记完成、M2 新增 T2.12（跨版本服务重建）；`INDEX.md` 移除该未决项。
- 验证：ADR-0007 与 TASKS 引用一致；T1.5/T1.6 前置已满足。
- 下一步：T1.5（zstd 帧扫描）。

## 015 · 2026-11-10 · feat: 实现 zstd 帧扫描
- 变更：新增 `src/core/zstd-frames.js`（`scanFrames`、`frameChecksumFlag`、`ZSTD_FRAME_MAGIC`，解析 frame header + block 链 + 可选 checksum）；`errors.js` 增加 `E_SESSION_FRAME_INVALID`；`index.js` 导出；新增 `tests/unit/zstd-frames.test.mjs`。
- 验证：`node --check` 3 个文件 exit 0；`node --test "tests/unit/**/*.test.mjs"` → 28 passed / 0 failed（覆盖单帧、多帧、checksum、截断、坏 magic、空输入、raw 块、保留块类型）。
- 下一步：T1.6（`rewriteSessionCwd`）。
