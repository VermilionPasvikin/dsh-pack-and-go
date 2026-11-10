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

## 016 · 2026-11-10 · feat: 实现会话头 cwd 改写（ADR-0007 方案 A）
- 变更：新增 `src/core/session-rewrite.js`（`rewriteSessionCwd(buffer, newCwd)`、`rewriteSessionCwdFile`）；`constants.js` 增加 `SESSION_FORMAT_VERSION=4`；`errors.js` 增加 `E_SESSION_HEADER_INVALID`/`E_SESSION_VERSION_UNSUPPORTED`；新增 `tests/unit/session-rewrite.test.mjs`。
- 验证：`node --test "tests/unit/**/*.test.mjs"` → 38 passed / 0 failed（帧数不变、cwd 改写、其余帧字节一致、行数不变、无 cwd 补写、跨版本拒绝、checksum 保留、文件版）。
- 下一步：T1.7（路径规则复刻）。

## 017 · 2026-11-10 · feat: 复刻 DSH 路径归一化规则
- 变更：对照源码 `packages/session/session-persistence-jsonl/src/format.ts`（clone 副本）逐字复刻 `encodeSegment`/`projectKey`，新增 `src/core/paths.js`（含 `projectDir`/`sessionDir`）；`errors.js` 增加 `E_PATH_INVALID`；新增 `tests/unit/paths.test.mjs`。
- 验证：`node --test "tests/unit/**/*.test.mjs"` → 49 passed / 0 failed；与真实目录名 `--F-PersonalProjects-python-~65B0~5EFA~6587~4EF6~5939--`、`--C-Users-15349-Desktop--` 一致；中文/emoji/超长/分隔符折叠用例通过。
- 下一步：T1.8（平台预检）。

## 018 · 2026-11-10 · feat: 实现跨平台预检
- 变更：新增 `src/core/preflight.js`（`classifyEntry`、`detectCaseCollisions`、`sanitizeWindowsName`、`preflightWorkspace`），覆盖非法文件名、保留名、结尾点/空格、路径长度、符号链接、权限位、大小写冲突；`errors.js` 增加 `E_PREFLIGHT_INVALID`；新增 `tests/unit/preflight.test.mjs`。
- 验证：`node --test "tests/unit/**/*.test.mjs"` → 60 passed / 0 failed（6 类风险 + 非 Windows 不误报 + 大小写冲突 + 集成报告可序列化 + 非法平台/目录拒绝）。
- 下一步：T1.9（工作区扫描与排除规则）。

## 019 · 2026-11-10 · feat: 实现工作区扫描与排除规则
- 变更：新增 `src/core/scan.js`（`DEFAULT_EXCLUDED_DIRS`、`resolveExclusions`、`scanWorkspace`）；默认排除 node_modules/.venv/__pycache__/dist 等，`.git` 默认保留；`errors.js` 增加 `E_SCAN_INVALID`；新增 `tests/unit/scan.test.mjs`。
- 验证：`node --test "tests/unit/**/*.test.mjs"` → 68 passed / 0 failed；含 1 万文件扫描计时（< 2s）。
- 下一步：T1.10（zip 容器写入器）。

## 020 · 2026-11-10 · feat: 实现 zip 容器写入器
- 变更：新增 `src/core/zip-writer.js`（`createZip`：local header + central directory + EOCD，deflate/store 自动选择，UTF-8 文件名，POSIX 权限位写入 external attributes，CRC32 优先用内置 `zlib.crc32` 并有兜底）；新增 `tests/unit/zip-writer.test.mjs`。
- 验证：`node --test "tests/unit/**/*.test.mjs"` → 75 passed / 0 failed（两文件、deflate/store 选择、空文件、目录条目、中文名 UTF-8 标志、EOCD、非法条目拒绝、系统 tar 列出内容）。
- 下一步：T1.11（zip 容器读取器与安全校验）。

## 021 · 2026-11-10 · docs: 更新当前状态（M1 进行中）
- 变更：`INDEX.md` 阶段更新为“M1 进行中（T1.1–T1.10 完成）”，下一步指向 T1.11。
- 验证：与 `TASKS.md` 状态一致。
- 下一步：T1.11（zip 容器读取器与安全校验）。

## 022 · 2026-11-10 · feat: 实现 zip 容器读取器与安全校验
- 变更：新增 `src/core/zip-reader.js`（`readZip`/`listZip`/`assertSafeEntryName`：EOCD 定位、central directory 遍历、local data 读取、inflate/CRC 校验、安全名称拒绝）；`errors.js` 增加 `E_PACK_INVALID`；新增 `tests/unit/zip-reader.test.mjs`。
- 验证：`node --test "tests/unit/**/*.test.mjs"` → 84 passed / 0 failed（正常、目录、截断、`../`、反斜杠、盘符、CRC、坏 deflate、关闭校验、非 zip）。
- 下一步：T1.12（路径映射）。

## 023 · 2026-11-10 · feat: 实现路径映射
- 变更：新增 `src/core/path-map.js`（`buildPathMap`、`safeDirName`、`mapCwdForWorkspace`）；支持 `auto`（同平台保留、跨平台放根目录）、`original`、`under-root`；标题去重加后缀；非法/保留名安全化；冲突报告。
- 验证：`node --test "tests/unit/**/*.test.mjs"` → 92 passed / 0 failed（跨平台、同平台、POSIX→Windows、标题冲突、安全化、original 冲突、缺根目录、mapCwd）。
- 下一步：T1.13（导出计划）。

## 024 · 2026-11-10 · feat: 实现导出计划
- 变更：新增 `src/core/plan-export.js`（`inferMode`、`planExport`：包内文件清单、附件、体积预估、模式推断；仅工作区模式无文件时报错）；`errors.js` 增加 `E_PLAN_INVALID`；新增 `tests/unit/plan-export.test.mjs`。
- 验证：`node --test "tests/unit/**/*.test.mjs"` → 99 passed / 0 failed（仅对话、仅工作区、对话+工作区、includeFiles 开关、附件、空选择）。
- 下一步：T1.14（导入计划）。

## 025 · 2026-11-10 · feat: 实现导入计划
- 变更：新增 `src/core/plan-import.js`（`planImport`、`DEFAULT_IMPORT_POLICY`、`SESSION_ACTIONS`/`WORKSPACE_ACTIONS`：目标 cwd 映射、会话冲突、工作区合并、转换项透传、摘要）；新增 `tests/unit/plan-import.test.mjs`。
- 验证：`node --test "tests/unit/**/*.test.mjs"` → 107 passed / 0 failed（无冲突、跳过、覆盖、合并、缺映射、转换透传、非法策略）。
- 下一步：T1.15（错误码与中文消息表）。

## 026 · 2026-11-10 · feat: 统一错误码与中文消息表
- 变更：`src/core/errors.js` 新增 `ERROR_MESSAGES`（11 个错误码的中文标题与下一步）与 `describeError()`；新增 `tests/unit/errors.test.mjs`；确认 `src/core` 无裸 `throw new Error`，导入仅 `node:` 内置与相对模块。
- 验证：`node --test "tests/unit/**/*.test.mjs"` → 112 passed / 0 failed（每个错误码有说明、无多余 key、已知/未知/非 Error 输入、core 依赖检查）。
- 下一步：M1 DoD 验收。

## 027 · 2026-11-10 · docs: M1 里程碑验收通过
- 变更：M1 全部 15 个任务完成；**补记 T1.6 状态**（提交 016 时漏标，已更正）；`TASKS.md` 里程碑 M1 置 ✅；`INDEX.md` 下一步更新为 T2.1。
- 验证：`node --test "tests/unit/**/*.test.mjs"` → 112 passed / 0 failed；依赖图 `errors: 0`；`src/core` 导入仅 `node:` 内置与相对模块；无裸 `throw new Error`。
- 下一步：T2.1（Host 插件骨架）。

## 028 · 2026-11-10 · feat: 建立 Host 插件骨架并在一次性 profile 中验证加载
- 变更：新增 `src/host/index.js`（`name` + `apply` 骨架）、`cordis.patch.yml`（insert 行）；根 `package.json` 增加 `exports`/`files`/`dsh.bundle.patch`。
- 验证：一次性 `DSH_HOME`（`%TEMP%\dsh-e2e-7ee81587c7ac4c8e9fb7acd46e177cad`，带 `.dsh-e2e-marker`）中执行 `dsh mover-test --from-default-profile web --dump-config` 创建 profile；`dsh plugin --profile mover-test add "file:F:\PersonalProjects\python\新建文件夹"` 安装成功（pnpm，811ms）；`--dump-config` 输出包含 `- id: dsh-mover` / `name: dsh-mover`。
- 下一步：T2.2（确认 DSH 服务实际签名并更新 DESIGN）。

## 029 · 2026-11-10 · docs: 核实 DSH 服务签名并更新设计
- 变更：`docs/DESIGN.md` §4 更新为经 `cordis_inspect_query Service.listService` 核实的方法签名（`sessionPersistence`、`workspaceRegistry`、`attachments`）与路径来源约定（`location.path`、`Workspace.path`、附件根）。
- 验证：签名与 Host 返回一致；明确“实现时仍以运行时 `ctx.get()` 校验”。
- 下一步：T2.3（进度协议）。

## 030 · 2026-11-10 · feat: 定义进度协议
- 变更：新增 `src/core/progress.js`（`createProgressEvent`/`progressPercent`/`serializeProgress`/`parseProgress`、阶段与状态常量）；`errors.js` 增加 `E_PROGRESS_INVALID` 与中文消息；`DESIGN.md` 增补进度协议章节；新增 `tests/unit/progress.test.mjs`。
- 验证：`node --test "tests/unit/**/*.test.mjs"` → 120 passed / 0 failed（合法帧、全部阶段、非法字段、百分比、往返、错误帧）。
- 下一步：T2.4（列出工作区与会话）。

## 031 · 2026-11-10 · feat: 读取工作区与会话目录
- 变更：新增 `src/host/catalog.js`（`assembleCatalog`/`loadCatalog`/`fallbackTitle`）；`src/host/index.js` 增加 `inject` 与 `DSH_MOVER_SELFTEST` 自检开关；`errors.js` 增加 `E_CATALOG_INVALID` 与中文消息；新增 `tests/unit/catalog.test.mjs`。
- 验证：126 项单测全绿；一次性 `DSH_HOME` 的 `mover-test` profile 启动（web 3080）后输出 `DSH-MOVER-SELFTEST {"workspaces":1,"ungrouped":0,"totals":{"workspaces":1,"sessions":1,"bytes":349},"firstWorkspace":"default-workspace","firstSession":"default-workspace"}`。
- 下一步：T2.5（导出任务编排）。

## 032 · 2026-11-10 · chore: check 脚本纳入 catalog 模块
- 变更：`package.json` 的 `check` 脚本加入 `src/host/catalog.js` 与 `tests/unit/catalog.test.mjs`。
- 验证：逐文件 `node --check` 通过（含新增文件）。
- 说明：本条目为补录（提交时漏写日志）。
- 下一步：T2.5（导出任务编排）。

## 033 · 2026-11-10 · feat: 实现导出打包核心
- 变更：新增 `src/core/export-pack.js`（`buildManifest`、`buildPack`：manifest + README + 计划条目 → zip；内存实现，单文件默认上限 256 MiB）；`src/core/index.js` 导出；新增 `tests/unit/export-pack.test.mjs`。
- 验证：首次提交（`fd6fc04`）时导入路径错误（`validateManifest` 从 `manifest-io.js` 导入），测试未通过即被提交；修复见 034/035。
- 说明：本条目为补录（提交时漏写日志）。
- 下一步：T2.5 集成验证。

## 034 · 2026-11-10 · fix: 修正 export-pack 导入路径与测试期望
- 变更：`validateManifest` 改从 `./manifest.js` 导入；测试对非法 manifest 期望 `E_MANIFEST_INVALID`。
- 验证：`node --test "tests/unit/**/*.test.mjs"` → 131 passed / 0 failed。
- 说明：提交 `0fc8deb` 含源码修复与 catalog 的 locationPath，但漏提交测试修改与日志。
- 下一步：T2.5 集成验证。

## 035 · 2026-11-10 · fix: 提交 export-pack 测试修改并补录 033/034
- 变更：提交 `tests/unit/export-pack.test.mjs` 的期望修正；补录 `DEVLOG` 033/034。
- 验证：131 passed / 0 failed；工作树干净。
- 下一步：T2.5 集成验证（一次性 `DSH_HOME` 生成 `.dshpack`）。

## 036 · 2026-11-10 · feat: 导出任务编排（集成验证通过）
- 变更：`src/host/catalog.js` 增加 `locationPath`（来自 `snapshot.location.path`）；`src/host/index.js` 增加 `DSH_MOVER_SELFTEST_EXPORT` 自检导出（catalog → `planExport` → `buildManifest` → `buildPack` → 写包）。
- 验证：一次性 `DSH_HOME` 的 `mover-test` profile 中导出 `%TEMP%\dsh-mover-selftest.dshpack`（1128 B）；外部 `readZip` 校验：3 条目（manifest 579B / README 20B / 会话 349B），manifest `schemaVersion=2`、`mode=sessions`、`sessionFormat=4`，会话文件与源大小一致。
- 说明：首版为内存打包（单文件 ≤256 MiB），流式优化留给性能任务。
- 下一步：T2.6（导入任务编排）。

## 037 · 2026-11-10 · feat: 导入编排（会话写盘，集成验证通过）
- 变更：新增 `src/core/import-pack.js`（`importSessionsToDisk`：读包 → manifest 校验 → `planImport` → cwd 改写 → 写入 `sessionRoot`）；`src/core/index.js` 导出；`package.json` check 同步；新增 `tests/unit/import-pack.test.mjs`。
- 验证：134 项单测全绿；用 T2.5 产物（`%TEMP%\dsh-mover-selftest.dshpack`）导入临时目标根：写入 `_no-cwd/<id>/session.v4.jsonl.zstd`（349B，与源一致），2 帧可解析，header cwd 保持源值（未归组会话）。
- 说明：附件（T2.8）与工作区文件/登记（T2.9）尚未纳入导入编排。
- 下一步：T2.7（会话写入细节：覆盖备份/new-id、Host 内可列出）。

## 038 · 2026-11-10 · feat: 会话写入细节（覆盖备份 / new-id / 身份一致）
- 变更：`session-rewrite.js` 抽出 `rewriteSessionHeader(buffer, { cwd, id })`；`import-pack.js` 支持 overwrite 备份（`backupRoot/<时间戳>/`）、new-id（`session-<uuid>` + 改写 `header.id`），并按 `effectiveCwd = targetCwd ?? source.cwd` 计算目录。
- 发现：DSH 的 `assertStoredIdentity` 要求**会话文件目录与 header.cwd 一致**；首次集成把未映射会话放进 `_no-cwd`，启动时报 `corrupt session log` 且 `workspaceRegistry` 不激活。
- 验证：137 项单测全绿；home B（新一次性 `DSH_HOME`）导入后启动，输出 `DSH-MOVER-SELFTEST {"workspaces":1,"ungrouped":0,"totals":{"sessions":1,"bytes":349}}`，stderr 无 corrupt 错误。
- 下一步：T2.8（附件解析与复制）。

## 039 · 2026-11-10 · feat: 附件解析与复制
- 变更：新增 `src/core/attachments.js`（`parseAttachmentId`、图片/文件/引用路径、`packAttachmentPath`、`decodeSessionEvents`、`extractAttachmentRefs`、`stageAttachments`、`restoreAttachments`）；`src/core/index.js` 导出；`package.json` check 同步；新增 `tests/unit/attachments.test.mjs`。
- 验证：142 项单测全绿（id 校验、分桶路径、引用去重、stage/restore 往返、缺失 warning 不抛错）。
- 依据：`@deepseek-ai/dsh-attachment-local` README（`objects/`、`file-objects/`、`files/`，id 形如 `sha256:<digest>`）。
- 下一步：T2.9（工作区文件写盘与登记）。

## 040 · 2026-11-10 · feat: 工作区文件写盘与登记（集成验证通过）
- 变更：新增 `src/core/workspaces.js`（`restoreWorkspaceFiles`：按 `workspaces/<key>/files/...` 写盘、Windows 名安全重命名、空目录、缺映射报错）；新增 `src/host/register.js`（`registerWorkspaces`：调用 `workspaceRegistry.create`，返回实体供 attach）；`index.js` 导出；`host/index.js` 增加 `DSH_MOVER_SELFTEST_IMPORT` 导入自检（会话 + 文件 + 登记 + attach）；`package.json` check 同步 `register.js`。
- 发现：启动后导入不会触发 registry 的启动索引，会话不会自动归组；需调用 `Workspace.attachSession(sessionId)`。
- 验证：149 项单测全绿；home C（全新一次性 `DSH_HOME`）导入后：`DSH-MOVER-IMPORT {"sessions":1,"files":1,"registered":1,"warnings":[]}`、`DSH-MOVER-ATTACH {"attached":1}`、`DSH-MOVER-AFTER` 显示 `Proj` 工作区有 1 个会话、ungrouped 0。
- 下一步：T2.10（备份与回滚）。

## 041 · 2026-11-10 · feat: 备份事务与回滚
- 变更：新增 `src/core/backup.js`（`createBackupTransaction`：`track` 备份并记录是否存在、`rollback` 逆序恢复/删除）；`src/core/index.js` 导出；`package.json` check 同步；新增 `tests/unit/backup.test.mjs`。
- 验证：154 项单测全绿（覆盖已有文件回滚、新文件回滚删除、混合逆序、时间戳目录、缺 backupRoot 报错）。
- 下一步：T2.11（Remote 接口：导出/导入/进度流/取消）。

## 042 · 2026-11-10 · docs: T2.11 调研（Remote 需要 Typert 构建）并标记待拍板
- 结论：`@Remote` 是 Typert 装饰器，Client 契约由构建生成（`docs/api-gateway.md`：生成器分析 Host `ts.Program`；Client 拒绝无 strict codec 的 SRC 描述符）。纯 JS 插件**无法直接**走 `ctx.remote`。
- 备选：A 自定义 HTTP 路由（`WebResourceRoute`）+ Client fetch；B session command（复用 `commands` 的已有 Remote，非流式）；C 引入 Typert TS 构建。
- 状态：T2.11 标记 🟨，等待 **ADR-0008** 拍板；本轮未改代码。
- 验证：`docs/api-gateway.md`；`Service.listService`（`webServer` / `commands`）签名。
- 下一步：等待用户拍板 ADR-0008。

## 043 · 2026-11-10 · docs: ADR-0008 UI→Host 通信（命令 + 不确定进度）
- 变更：`DECISIONS.md` 新增 ADR-0008（B 变体：`ctx.commands.register` + 转圈 + 阶段文案，保留纯 JS）；`DESIGN.md` 通信方式改为 commands；`TASKS.md` T2.11 验收更新；`INDEX.md` 未决项移除。
- 验证：与用户拍板一致（B 变体、转圈、不推翻纯 JS）。
- 下一步：实现 `mover` 命令（T2.11）。

## 044 · 2026-11-10 · feat: mover 命令（ADR-0008）
- 变更：新增 `src/host/commands.js`（`parseMoverArgs`、`exportAllSessions`、`importPack`、`handleMover`、`createMoverCommand`）；`src/host/index.js` 注册命令（`inject` 增加 `commands`）；`package.json` check 同步；新增 `tests/unit/commands.test.mjs`。
- 验证：159 项单测全绿（导出生成包、导入写回、用法错误、命令结构）；一次性 home 启动日志包含 `[dsh-mover] command registered: mover`，stderr 无插件错误。
- 说明：UI 等待期显示“转圈 + 阶段文案”（ADR-0008）；精确进度留给未来方案 A。
- 下一步：T2.12（跨版本兜底，ADR-0007 方案 C）。

## 045 · 2026-11-10 · feat: 跨版本会话重建（ADR-0007 方案 C）
- 变更：新增 `src/host/rebuild.js`（`rebuildSessionViaService`：`open(id,'read')` → `create(新 header)` → `append(events)` → `flush`）；`errors.js` 增加 `E_REBUILD_FAILED` 与中文消息；`host/index.js` 增加 `DSH_MOVER_SELFTEST_REBUILD` 自检；`package.json` check 同步；新增 `tests/unit/rebuild.test.mjs`。
- 验证：163 项单测全绿；一次性 home 中重建：`DSH-MOVER-REBUILD {"id":"session-4b2b9a81...","events":3,"cwd":"…default-workspace"}`，`DSH-MOVER-REBUILD-AFTER {"sessions":2}`。
- 说明：真实 v3 文件的迁移未单独验证（本机无 v3 样本），机制由 `open(read)` 的官方迁移链保证。
- 下一步：M2 DoD 验收。
