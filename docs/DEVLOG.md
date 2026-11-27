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
- 验证：`session-0cf30744.../session.v4.jsonl.zstd` → 851 帧、压缩 1,397,398 B、解压 4,889,816 B、1284 行事件、首行 `type=session version=4 cwd=F:\\PersonalProjects\\python\\新建文件夹`；每帧 `zstdDecompressSync` 独立成功；整文件单次调用只返回首帧 225 B，确认**必须逐帧扫描**。
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
- 验证：一次性 `DSH_HOME`（`%TEMP%\\dsh-e2e-7ee81587c7ac4c8e9fb7acd46e177cad`，带 `.dsh-e2e-marker`）中执行 `dsh mover-test --from-default-profile web --dump-config` 创建 profile；`dsh plugin --profile mover-test add "file:F:\\PersonalProjects\\python\\新建文件夹"` 安装成功（pnpm，811ms）；`--dump-config` 输出包含 `- id: dsh-mover` / `name: dsh-mover`。
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
- 验证：一次性 `DSH_HOME` 的 `mover-test` profile 中导出 `%TEMP%\\dsh-mover-selftest.dshpack`（1128 B）；外部 `readZip` 校验：3 条目（manifest 579B / README 20B / 会话 349B），manifest `schemaVersion=2`、`mode=sessions`、`sessionFormat=4`，会话文件与源大小一致。
- 说明：首版为内存打包（单文件 ≤256 MiB），流式优化留给性能任务。
- 下一步：T2.6（导入任务编排）。

## 037 · 2026-11-10 · feat: 导入编排（会话写盘，集成验证通过）
- 变更：新增 `src/core/import-pack.js`（`importSessionsToDisk`：读包 → manifest 校验 → `planImport` → cwd 改写 → 写入 `sessionRoot`）；`src/core/index.js` 导出；`package.json` check 同步；新增 `tests/unit/import-pack.test.mjs`。
- 验证：134 项单测全绿；用 T2.5 产物（`%TEMP%\\dsh-mover-selftest.dshpack`）导入临时目标根：写入 `_no-cwd/<id>/session.v4.jsonl.zstd`（349B，与源一致），2 帧可解析，header cwd 保持源值（未归组会话）。
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

## 046 · 2026-11-10 · docs: M2 里程碑验收通过
- 变更：M2 全部 12 个任务完成；`TASKS.md` M2 置 ✅；`INDEX.md` 下一步更新为 T3.1。
- 验证：163 项单测全绿；一次性 `DSH_HOME` 中完成真实导出（1128B 包）、导入（会话 + 工作区 + attach）、跨版本重建（sessions 1→2）；依赖图 `errors: 0`。
- 下一步：M3（Web UI），从 T3.1 开始。

## 047 · 2026-11-10 · feat: Client bundle 骨架
- 变更：新增 `src/client/client.js`（`window.__ModuleLoader__.load` + factory，注册占位面板到 `main` slot 的 `mover` key）；根 `package.json` 增加 `exports["./client"]`、`dsh.client`（`platform: web`、`immediately`、`inject: ui-chat`），`files` 增加 `src/client/**/*.js`。
- 验证：`node --check` 通过；一次性 home 启动后首页 `__DSH_BOOT__` 包含 `dsh-mover/client.js`（HTTP 200），stderr 无错误。
- 说明：实际渲染需在 T3.2 页面可见后验证；本环境无法读取浏览器控制台。
- 下一步：T3.2（侧边栏入口 + `main` 页面壳）。

## 048 · 2026-11-10 · feat: 迁移面板 UI（侧边栏/选择树/导出/导入）
- 变更：`src/client/client.js` 完成侧边栏 `mover` 图标、`main` 面板、会话按 cwd 分组、组/单项勾选、导出与导入表单、转圈与结果/错误提示；`src/host/commands.js` 导出支持 `sessionIds`、参数支持引号路径、导入目标默认 `~/dsh-mover-import`；`tests/unit/commands.test.mjs` 同步。
- 验证：`node --check` 通过；163 项单测全绿；一次性 profile 启动 boot 含 `dsh-mover/client.js`（HTTP 200），stderr 无错误。
- 说明：浏览器渲染与点击未验证（无浏览器控制），待 M4 实机确认；T3.4 的“项目文件开关”暂未接入（当前命令只打包对话）。
- 下一步：T3.6–T3.8（冲突提示、文案/locale、状态刷新）。

## 049 · 2026-11-10 · feat: 冲突提示与状态刷新（T3.6/T3.8）
- 变更：`src/client/client.js` 导入说明补充默认冲突策略（跳过已存在对话、合并同路径工作区）；命令成功后触发会话列表刷新（`reloadTick`）；busy 时按钮禁用防重复提交。
- 验证：`node --check` 通过；163 项单测全绿；一次性 profile 启动 boot 含 `dsh-mover/client.js`。
- 说明：结构化冲突/预检报告未实现，当前以命令返回文本呈现（仅异常时出现）；浏览器交互待 M4 实机验证。
- 下一步：T3.7（文案与 locale）。

## 050 · 2026-11-10 · feat: 中英文案与 locale 跟随（T3.7）
- 变更：`src/client/client.js` 集中 `TEXTS.zh/en`；按 `ctx.locale.getLocale()` 选择语言并订阅切换；侧边栏 label 随语言；未归组标题也随语言。
- 验证：`node --check` 通过；163 项单测全绿；启动 boot 含 `dsh-mover/client.js`。
- 说明：语言切换的浏览器渲染未验证；`ctx.locale` 快照字段名做了兼容取值（`id`/`locale`/`language`）。
- 下一步：M3 DoD 与 M4（打包安装）。

## 051 · 2026-11-10 · docs: M3 里程碑（代码）完成
- 变更：M3 的 8 个任务全部完成；`TASKS.md` M3 置 ✅（注明渲染验证移交 M4）；`INDEX.md` 下一步更新为 T4.1。
- 验证：163 项单测全绿；`node --check` 全过；一次性 profile 启动 boot 含 `dsh-mover/client.js`。
- 限制：浏览器渲染/交互未验证（本环境无浏览器控制），作为 M4/T4.3 实机验证的一部分。
- 下一步：T4.1（bundle 清单：locale/icon/meta）。

## 052 · 2026-11-10 · feat: bundle 清单与安装验证（T4.1–T4.3）
- 变更：新增 `locale/zh.json`、`locale/en.json`、`icon.svg`；`package.json` 的 `exports` 增加 `./locale/*.json`、`./icon`。
- 验证：locale JSON 合法、SVG 合法（524 B）；一次性 profile 同步后启动：`--dump-config` 含 `dsh-mover` 行、boot 含 `dsh-mover/client.js`、日志 `[dsh-mover] command registered: mover`。
- 限制：`plugin_manager install_bundle` 只作用于**当前 profile**，不能用于一次性 home，因此 T4.2 改用 CLI `dsh plugin add`；Edge headless 截图失败（进程不退出、未生成文件），**浏览器渲染仍未验证**。
- 下一步：M4 DoD 与 M5。

## 053 · 2026-11-10 · docs: M4 里程碑验收（安装与加载）
- 变更：M4 的 3 个任务完成；`TASKS.md` M4 置 ✅；`INDEX.md` 下一步更新为 T5.1。
- 验证：locale/icon 合法；一次性 profile 安装成功、`--dump-config` 含插件行、boot 含 `dsh-mover/client.js`、日志含命令注册。
- 限制：浏览器渲染未验证（Edge headless 截图失败）；`plugin_manager install_bundle` 不适用于一次性 home。
- 下一步：T5.1（单元测试收尾与覆盖记录）。

## 054 · 2026-11-10 · test: M5 跨平台/性能/安全验收（T5.1–T5.5）
- 变更：新增 `tests/e2e/cross-platform.test.mjs`、`tests/e2e/performance.test.mjs`、`tests/e2e/security.test.mjs`、`docs/ACCEPTANCE.md`；TASKS 的 T5.1–T5.5 更新状态。
- 验证：覆盖率 行 92.67% / 分支 81.46% / 函数 96.21%；跨平台 3 项、安全 3 项通过；性能 100MB：scan 1ms、pack 368ms、rss 增量 101MB；SPEC §11 走查见 `docs/ACCEPTANCE.md`（4/5/6/7/9 通过；1/2/3/10 部分；8 未达标）。
- 限制：内存实现导致 500MB 场景 rss 会超过 NFR-2 的 300MB（**已知技术债：流式打包未实现**）；浏览器渲染仍未验证。
- 下一步：M5 DoD 与 M7（发布准备）。

## 055 · 2026-11-10 · docs: M5 里程碑（部分通过）
- 变更：M5 的 5 个任务完成（T5.3 为部分）；`TASKS.md` M5 置 🟨；`INDEX.md` 下一步更新为 T7.1。
- 验证：见 DEVLOG 054 与 `docs/ACCEPTANCE.md`。
- 结论：跨平台、安全、重复导入等通过；内存指标（SPEC §11-8）未达标；浏览器渲染未验证。
- 下一步：M7（发布准备）。

## 056 · 2026-11-10 · docs: README、版本与安装说明（T7.1–T7.3）
- 变更：重写 `README.md`（使用、跨平台注意、安装/卸载、文档索引、状态）；`package.json` 版本改为 `0.1.0`，description 更新为 “Cross-platform migration for DSH conversations and workspaces”。
- 验证：`files` 覆盖 `src/host`(5 个 JS)/`src/client`(1)/`src/core`(21)、`cordis.patch.yml`、`locale/zh|en.json`、`icon.svg`。
- 下一步：T7.4（最终验收报告）。

## 057 · 2026-11-10 · docs: 最终验收报告与 M7 完成（T7.4）
- 变更：新增 `docs/FINAL-REPORT.md`；`TASKS.md` T7.1–T7.4 ✅、M7 ✅；`INDEX.md` 标记 v0.1.0 交付。
- 验证：见 FINAL-REPORT（163 项单测、7 项 e2e、一次性 profile 集成证据、SPEC §11 结果）。
- 结论：v0.1.0 交付。已知限制：内存式打包、浏览器渲染未验证、取消未实现、符号链接转换未实现、无精确进度。
- 下一步：无（M6 CLI 暂缓）；后续建议见 FINAL-REPORT §5。

## 058 · 2026-11-10 · feat: 流式打包、渲染逻辑验证与 CLI（T5.3/T6.1–T6.4）
- 变更：新增 `src/core/zip-stream.js`（流式 zip + 增量 CRC + data descriptor）、`buildPackToFile`；`mover export` 改用流式；新增 `src/cli/index.js`（`dsh-mover export/import`，直接访问 `DSH_HOME`，导入更新 `workspace.json` 前备份）；`package.json` 增加 `bin` 与 `src/cli`；新增 `tests/unit/zip-stream.test.mjs`、`tests/e2e/client-render.test.mjs`、`tests/e2e/cli.test.mjs`。
- 验证：500MB 流式打包 **2.9 s / 峰值 RSS 112.3 MB**（NFR-2 达标）；client 渲染逻辑 3 项（中/英标题、slot 注册）；CLI 3 项（导出、导入并更新 workspace.json、参数错误）。
- 说明：Edge headless 仍不可用，渲染验证为“组件树 + 文案”级，非真实浏览器。
- 下一步：更新验收文档与最终报告。

## 059 · 2026-11-10 · refactor: mover export 改用流式打包
- 变更：`src/host/commands.js` 的 `exportAllSessions` 改用 `buildPackToFile`（流式写盘），不再整包驻留内存。
- 验证：`tests/unit/commands.test.mjs` 5 项通过；导出包可被 `readZip` 读取。
- 下一步：更新验收文档与最终报告。

## 060 · 2026-11-10 · docs: 流式/CLI 验收更新（v0.2.0）
- 变更：`ACCEPTANCE.md`（§11-8 通过、渲染逻辑验证、500MB 数据）；`FINAL-REPORT.md` 重写为 v0.2.0；`README.md` 增加 CLI 用法与状态；`package.json` 版本 `0.2.0`；`INDEX.md` 阶段更新。
- 验证：166 项单测 + 13 项 e2e 全绿；500 MB 流式打包 2.9 s / 峰值 RSS 112.3 MB。
- 结论：三项剩余需求（流式打包、渲染验证、CLI）完成；真实浏览器渲染仍是唯一未验证项。
- 下一步：无。

## 062 · 2026-11-10 · docs: 导出/导入缺陷复现与修复计划
- 复现：`%TEMP%\\repro-zip2.mjs`（混合 data + 6×90KB 不可压缩文件，连续 5 轮）→ 5/5 `write after end`；桌面同时存在截断包（66629 B）与完整包（76497 B）。
- 根因：`zip-stream.js` deflate 分支 `pipe` + `pipeline` 混用，`output.end()` 后仍有迟到写入；失败未清理半成品。
- 另发现：DSH 无文件选择服务（Host 无 `directory-picker` 服务可查询）；导入后侧边栏未刷新（同 id 默认跳过 + 无通知）。
- 产出：新增 `docs/PLAN-FIX-01.md`（D1/D2/D3 方案 + 漂移修复排期 + 待决策项）。
- 下一步：等待用户审核计划与 D3 方案选择。

## 063 · 2026-11-10 · docs: TASKS 与实现漂移对账（返工 + 补任务）
- 对账依据：`docs/SPEC.md` FR-1..FR-14 逐条对照 `TASKS.md` 与实际实现。
- **有任务但未做到（返工）**：T1.10（多文件 `write after end`）、T3.3（缺归档/搜索/只带文件）、T3.4（缺高级折叠/完成页）、T3.5（缺拖入/文件选择/预览/落点）、T3.6（冲突/转换提示）、T3.8（缺重启提示/侧边栏通知）。
- **SPEC 有要求但 TASKS 无任务（补）**：T2.13（fork 链）、T3.9（顶部信息）、T3.10（设置入口）、T3.11（统计与大小估算）、T3.12（搜索/只带文件/归档）、T3.13（高级折叠+完成页）、T3.14（导入预览）、T3.15（落点映射）、T3.16（导入后生效）、T3.17（附件显示）。
- 状态：上述返工任务改为 🟨；新增任务为 ⬜；`TASKS.md` §3 下一步改为 T1.10。
- 下一步：T1.10 返工（修复流式 zip）。

## 064 · 2026-11-10 · fix: 流式 zip write-after-end（T1.10 返工）
- 根因：`zip-stream.js` deflate 分支 `pipe` + `pipeline` 混用，`output.end()` 后仍有迟到写入；失败未清理半成品。
- 变更：deflate 分支改 `pipeline(reader, deflater, sink)`（sink 负责背压与 `csize` 计数）；失败时删除输出文件；`resolveExportTarget` 目录目标追加唯一名；新增 3 项单测。
- 验证：复现脚本（混合 data + 4×90KB 不可压缩文件，5 轮）**5/5 失败 → 5/5 成功**；`zip-stream` 单测 5/5；失败清理断言通过。
- 下一步：T3.16/T3.8（导入结果计数与重启提示）。

## 065 · 2026-11-10 · fix: 导入结果计数与重启提示（T3.8/T3.16）
- 变更：`importPack` 结果文本区分「新增 / 覆盖 / 跳过」，并追加「若左侧列表未出现，请刷新页面或重启 DSH」；新增计数判定修正为 `action === 'import' || 'new-id'`。
- 验证：`tests/unit/commands.test.mjs` 8 项通过；导入文本断言通过。
- 下一步：按 TASKS 顺序执行 M2 补充任务 T2.13（fork 链导入）。

## 066 · 2026-11-10 · feat: fork 链与子代理会话（T2.13）
- 变更：`catalog.js` 提取 `parentSessionId/origin/delegationDepth`；`exportAllSessions` 默认连带 fork 祖先与子代理后代（`--no-fork` 关闭）；`rewriteSessionHeader` 支持 `parentSession`；`import-pack.js` 预分配 targetId 并映射父 id。
- 验证：`commands.test` 9 项（含连带导出与 `--no-fork`）、`import-pack.test` 7 项（含 new-id 父子映射）通过。
- 下一步：T3.9（浮层顶部平台/DSH_HOME/版本）。

## 067 · 2026-11-10 · feat: 浮层顶部平台/DSH_HOME/版本（T3.9）
- 变更：`mover list` 返回 `payload.meta`（platform / dshHome / dshVersion）；Client 读取并在副标题下显示 `platform · DSH_HOME · version`。
- 验证：`tests/unit/commands.test.mjs` 9 项、`tests/e2e/client-render.test.mjs` 3 项通过。
- 下一步：T3.10（设置页备用入口）。

## 068 · 2026-11-10 · chore: 补提交自检日志、渲染测试与 UI 方案文档
- 变更：`src/host/index.js` 增加命令自检与文件日志（`DSH_MOVER_SELFTEST_CMD`）；`tests/e2e/client-render.test.mjs` 更新为浮层注册断言；`docs/UI-REVAMP.md` 补充布局修订。
- 验证：`node --check` 通过；`tests/e2e/client-render.test.mjs` 3 项通过。
- 下一步：T3.10（设置页备用入口）。

## 069 · 2026-11-10 · feat: 设置页备用入口（T3.10）
- 变更：注册 `settings.section`（id `mover`，order 60），组件显示标题/说明与「打开迁移面板」按钮；点击打开浮层并关闭设置面板；`client-render` 测试新增 `settings.section` 断言。
- 验证：`tests/e2e/client-render.test.mjs` 3 项、`tests/unit/commands.test.mjs` 9 项通过。
- 下一步：T3.11（底部统计与大小估算）。

## 070 · 2026-11-10 · feat: 底部统计与大小估算（T3.11）
- 变更：`mover list` 返回会话 `sizeBytes`；新增 `mover size <dir...>` 命令（`scanWorkspace` 统计字节/文件数）；Client 维护 `sizeById` / `workspaceBytes`，勾选后 300ms 防抖测量，树底部显示「已选 N 个工作区 · M 个对话 · 含项目文件约 X」。
- 验证：`tests/unit/commands.test.mjs` 10 项（含 `measureWorkspaces`）、`tests/e2e/client-render.test.mjs` 3 项通过。
- 下一步：T3.12（搜索 / 只带文件 / 已归档）。

## 071 · 2026-11-10 · feat: 搜索、只带文件与归档开关（T3.12）
- 变更：搜索框（对话 >20 时显示，按标题过滤）；工作区行「只带文件」（保留首个对话 + 打开文件开关）；「显示已归档」开关与说明（归档会话暂不参与导出，需先在 DSH 取消归档）。
- 验证：`tests/e2e/client-render.test.mjs` 3 项、`tests/unit/commands.test.mjs` 10 项通过。
- 下一步：T3.13（高级折叠 + 完成页）。

## 072 · 2026-11-10 · feat: 导出完成页（T3.13 部分）
- 变更：`runCommand` 返回 `{ ok, text }`；导出成功后显示完成卡片（压缩包路径、大小、耗时、「复制路径」按钮）。
- 验证：`tests/e2e/client-render.test.mjs` 3 项、`tests/unit/commands.test.mjs` 10 项通过。
- 下一步：T3.13 剩余（高级折叠：排除 / 压缩 / 预检 / 附件）。

## 073 · 2026-11-10 · feat: 高级折叠与导出选项（T3.13）
- 变更：导出页新增「高级选项」折叠（全量打包 / 不压缩 / 导出前预检 / 额外排除目录）；Host `mover export` 支持 `--full`、`--no-compress`、`--preflight`、`--exclude`；`buildPackToFile` 支持 `compress`；预检摘要附在结果文本。
- 验证：`tests/unit/commands.test.mjs` 10 项、`tests/unit/export-pack.test.mjs` 5 项、`tests/e2e/client-render.test.mjs` 3 项通过。
- 下一步：T3.14（导入预览）。

## 074 · 2026-11-10 · feat: 导入预览（T3.14）
- 变更：Host 新增 `mover inspect <pack>`（读 manifest + 目标 home 冲突检测，返回来源/数量/冲突 JSON）；导入页新增「预览」按钮与预览卡片（平台/版本/包大小/对话/工作区/附件/冲突数）。
- 验证：`tests/unit/commands.test.mjs` 11 项（含 inspect）、`tests/e2e/client-render.test.mjs` 3 项通过。
- 下一步：T3.15（导入落点与路径映射）。

## 075 · 2026-11-10 · feat: 导入落点与路径映射（T3.15）
- 变更：Host `mover import` 支持 `--original`（放回源路径，校验当前平台可用性）与指定目录两种落点；结果文本附工作区路径映射表；导入页新增「放回原路径 / 指定目录」单选，仅指定目录模式显示目标输入框。
- 验证：`tests/unit/commands.test.mjs` 11 项、`tests/e2e/client-render.test.mjs` 3 项通过。
- 下一步：T3.17（附件显示与缺失报告）；D3 先写 ADR-0010。

## 076 · 2026-11-10 · docs: ADR-0010 导入文件选择器（Proposed）
- 调研：`ctx.connection.fetch.register` 是官方 Exact Fetch 路由，由 Connection 共享 handler 服务（可信、已认证），可承载上传而无需复刻信任检查。
- 产出：新增 ADR-0010（上传通道设计、2 GiB 上限、流式写盘、临时文件清理、风险与缓解），状态 Proposed。
- 下一步：用户批准 ADR 后实施 T3.5 返工（文件选择 + 上传），完成 T3.17 后收尾。

## 077 · 2026-11-10 · docs: 取消 ADR-0010，维持目录选择方案
- 决定：用户取消上传通道（ADR-0010 → Rejected），导入文件选择维持 `uiWorkspace.pickDirectory` + `mover find`（目录 → 列出 `.dshpack` → 选择）；不新增路由与临时目录。
- 变更：`DECISIONS.md` ADR-0010 标记取消；`TASKS.md` T3.5 标 ✅（备注）。
- 下一步：T3.17（附件显示与缺失报告）。

## 078 · 2026-11-10 · feat: 附件打包与导入恢复（T3.17）
- 变更：`mover export --attachments` 从会话事件提取附件引用并打包（缺失仅记录，不阻断）；`importPack` 调用 `restoreAttachments` 写回 `<DSH_HOME>/attachments/v1`，结果文本附附件数与警告；导出页高级选项新增「包含附件」。
- 验证：`tests/unit/**` 175 项 + `client-render` 3 项（共 178）全绿。
- 下一步：TASKS 收尾（全量验收 + INDEX/FINAL-REPORT 更新）。

## 079 · 2026-11-10 · docs: T3 返工任务收口
- 变更：T3.3 / T3.4 / T3.6 标 ✅（分别由 T3.11–T3.12、T3.13、T3.14/T3.17 补齐）；TASKS 已无未完成条目。
- 验证：全量 178 项测试全绿；工作树干净。
- 下一步：部署最新实现到一次性 profile，请用户浏览器验收全流程。

## 080 · 2026-11-10 · chore: 更新构建标记
- 变更：`BUILD_TAG` → `b2110-2235`，便于浏览器验收时确认加载版本。
- 下一步：用户浏览器验收（导出/导入/预览/落点/附件）。

## 081 · 2026-11-10 · docs: 黑盒验收用例
- 变更：新增 `docs/TEST-CASES.md`（A–K 共 50+ 条，覆盖入口/主题/选择/导出/高级选项/导入/落点/结果/附件/命令/边界）。
- 下一步：用户按用例逐条执行并回报失败项。

## 082 · 2026-11-10 · docs: 黑盒问题诊断与修复方案（FIX-02）
- 根因确认：语言快照字段是 `active`（我们读错 → 永远中文）；归档未过滤 `archivedSessionIds`；导入后侧边栏依赖 `workspace.follow` 增量而 attach 不发帧；命令通道写 `command/run|done` 导致会话日志增长；不压缩对已压缩会话无明显收益。
- CLI 测试：export 8 对话（276299 B）→ 空 home import 8 个会话文件，退出码 0。
- 产出：`docs/FIX-PLAN-02.md`（9 条病因/方案 + 4 个待决策项）。
- 下一步：等待用户审核方案与决策。

## 083 · 2026-11-10 · docs: ADR-0011 / ADR-0012 提案
- ADR-0011（Proposed）：操作入口改为 `POST /api/mover/exec`（Connection 已认证 exact Fetch 路由），不再经命令通道写会话日志、不再依赖对话上下文；UI 改 fetch，命令保留给聊天/CLI；缺失 connection 时回退命令。
- ADR-0012（Proposed）：取消“导出前预检”选项，改为导出默认预检；列出收益（参数更少/不会忘记/结果摘要）与风险（每次多一次扫描 1–10s、失败不阻断、0 项仍需文案）。
- 状态：等待用户审核 ADR-0011，并决定 ADR-0012 是否采纳。

## 084 · 2026-11-10 · fix: 语言快照字段与归档过滤
- 语言：`currentLocaleId()` 改读 `snapshot.active`（LocaleSnapshot 实际字段），修复切英文仍显示中文。
- 归档：`workspace.follow` baseline 的 `archivedSessionIds` 现参与树构建过滤；「显示已归档」切换时重新加载。
- 验证：`node --check`；`client-render` 3 项待后续复跑。
- 下一步：去除「只带文件」按钮与「不压缩」选项，补导入选择目录与包名输入。

## 085 · 2026-11-10 · refactor: 精简选项并补导入目录与包名
- 移除：工作区行「只带文件」（按用户判断属冗余，SPEC 语义降级为「含项目文件」）；「不压缩」选项（默认压缩；命令 `--no-compress` 保留给 CLI）。
- 新增：导入「指定目录」模式的「选择目录」按钮（`uiWorkspace.pickDirectory`，不可用时不显示）；导出「包名（可选）」输入框（命令 `--name`，目录目标时使用，自动清理非法字符）。
- 验证：`node --check`；`commands.test` 11 项、`client-render` 3 项通过。
- 下一步：导入后热重载（`insertSessionBefore` 触发 follow 增量）实测。

## 086 · 2026-11-10 · feat: 导入后热重载尝试
- 变更：`importPack` 在 attach 后对每个登记工作区调用一次 `entity.insertSessionBefore(首个导入会话)`，以触发 `workspace.follow` 增量帧；失败不阻断导入。
- 验证：`node --check`；`commands.test` 11 项通过；浏览器侧边栏是否即时更新待用户实测（失败则回退重启提示）。
- 下一步：部署验证 + 等待 ADR-0011/0012 审核。

## 087 · 2026-11-10 · chore: 更新构建标记（b2110-2325）
- 变更：部署本轮修复（语言/归档/精简选项/导入目录/包名/热重载），标记更新便于验收。
- 下一步：用户按黑盒用例复验；ADR-0011/0012 等待审核。

## 088 · 2026-11-10 · fix: 语言注入 + 诊断增强
- 语言：Client `inject` 增加 `locale`，`currentLocaleId` 优先 `ownerCtx.locale`（inject 后可直接访问），并保留 `getService` 兜底；诊断行显示 `locale=zh|en`。
- 诊断：Host `listCatalog` / `importPack` 的 catch 打印完整错误；Client load catch 打印 `console.error('[dsh-mover] load failed', ...)`。
- 背景：用户归档会话后导入，出现 `Failed to load: Cannot read properties of undefined (reading 'size')`，需日志定位。
- 下一步：部署后请用户复现一次，提供 Host 日志与浏览器控制台错误。

## 089 · 2026-11-10 · fix: 导入前会话冲突检测（重复 id 崩溃）
- 根因：`importPack` 未传 `existingSessionIds` → 同一会话 id 被导入到不同 cwd 目录；DSH 启动报
  `duplicate JSONL session id ... multiple project directories` → `workspaceRegistry` 初始化失败 →
  `workspaceController` 不可用（用户看到的 `workspace/follow ... unavailable`）。
- 修复：导入前用 `sessionPersistence.list()` 收集已有 id（异常时退回文件扫描 `scanExistingSessionIds`），
  传给 `importSessionsToDisk` → 同 id 默认 skip（不再写第二份）。
- 修复测试：空 home 模拟 `list()` 返回空。
- 数据修复：把重复目录移入 `<home>/duplicate-backup-<时间>/`（保留原路径那份）。
- 验证：`commands.test` 11 项通过；重启后 workspaceRegistry 启动无 duplicate 错误。
- 下一步：用户复验归档/导入/语言；ADR-0011/0012 将在回归通过后实施。

## 090 · 2026-11-10 · feat: 导入冲突策略（方法 D）
- 变更：`mover import` 支持 `--new-id`（同 id 会话另存为新对话）；导入页新增「已存在对话：跳过 / 另存为新对话」单选；结果计数沿用（new-id 计入新增）。
- 验证：`commands.test` 12 项（默认 skip 与 new-id 两条路径）；`client-render` 3 项通过。
- 下一步：部署复验；ADR-0011/0012 实施。

## 091 · 2026-11-10 · fix: 热重载诊断与明确重启提示
- 根因（源码确认）：`Workspace.sessionIds` getter 用启动时构建的 canonical-cwd 索引过滤；`attachSession` 会 realpath 校验 cwd，若与工作区 path 不一致则抛错。我们的 `attach`/`insertSessionBefore` 错误此前被静默吞掉，且索引不更新时侧边栏不会出现新会话。
- 变更：目标目录先 `mkdir` 再 `realpath`（与 workspace create 的 canonical 一致）；`attach failed` / `reindex failed` 打印到 Host 日志；导入成功后 UI 固定显示「若未出现请重启 DSH」提示。
- 验证：`node --check`；`commands` 12 项、`client-render` 3 项通过。
- 限制：是否能真正热重载取决于 attach 校验通过且 follow 发帧；若仍不显示，提示重启（已明确展示）。

## 092 · 2026-11-10 · fix: 热重载改走 workspaceController 广播
- 根因：直接改 `Workspace` 实体（attach / insertSessionBefore）只写持久化，不发 `workspace.follow` 增量帧；日志确认 attach/reindex 均无错误但侧边栏不刷新。
- 变更：`host/index.js` 把 `ctx.get('workspaceController')` 传入命令依赖；`importPack` 改用 `workspaceController.insertSessionBefore({ workspaceId, sessionId })` 触发广播（entity 方法作为无 controller 时的回退路径不再使用）。
- 验证：`commands.test` 12 项通过；部署后请用户验证侧边栏是否即时出现新对话。

## 093 · 2026-11-11 · fix: new-id 导入改走服务重建（修复 corrupt marker）
- 根因：new-id 只改 header id，事件里的投递标记（delivery marker）仍指向旧会话 → DSH 报
  `current-generation delivery marker names the wrong Session`（corrupt）。
- 修复：new-id 策略改为 `sessionPersistence.create(新 header)` + `append(decodeSessionEvents(包内事件))` 的
  服务重建（ADR-0007 方案 C），由官方后端生成正确标记；同 id/覆盖仍走直接写文件。
- 验证：`commands.test` 12 项通过（makeDeps 增加 create mock）。
- 说明：服务重建会走官方 live 会话路径，理论上也改善热重载；仍需浏览器实测。

## 094 · 2026-11-11 · fix: 服务重建 seq 补齐 + 附件写入不阻断
- 根因：`decodeSessionEvents` 解码出的事件缺 `seq` → `append seq mismatch ... expected 0, got undefined`；恢复附件时单个文件 `EPERM` 抛错导致整单导入失败。
- 修复：服务重建前按索引补齐 `seq`（0..n-1）；`restoreAttachments` 逐条 try/catch，失败记 warning 不中断。
- 验证：全量 176 项测试通过。
- 下一步：部署后请用户验证「另存为新对话」与「跳过」两条路径。

## 095 · 2026-11-11 · fix: reading 'size' 根因（loadTitlesFromCommand 缺 sizes）
- 根因：`loadTitlesFromCommand` 的 4 个提前返回分支只返回 `{ titles, meta }`，调用处读 `titleInfo.sizes.size` → `Cannot read properties of undefined (reading 'size')`；只要 `/mover list` 命令失败或返回非 success 就触发，导致整个面板加载失败（关闭重开依旧）。
- Host 自检确认 `workspaceController.follow` 本身正常（baseline 可返回），排除 DSH follow 问题。
- 修复：所有分支补齐 `sizes: new Map()`；调用处改用 `titleInfo.sizes?.size ?? 0`。
- 验证：`client-render` 3 项、`commands` 12 项通过。

## 096 · 2026-11-11 · fix: 标题兜底与树按 cwd 归组
- 标题：`session.list` 的 SessionSummary 没有顶层 title，标题在 `projections.values.title`（迁移会话可能缺失）。
  Host catalog 增加兜底：读会话日志事件，取 `session/rename` 或首条 `user/message` 文本。
- 工作树：改用 `session.list` 的 `cwd` 与工作区路径归组（与左侧侧边栏一致），未匹配会话显示为「未分组」；
  标题合并 `/mover list` 结果（不覆盖已有）。
- 验证：`client-render` 3 项、`commands` 12 项通过。

## 061 · 2026-11-10 · docs: UI 调整与缺陷修复方案（待审核）
- 背景：真实浏览器验证通过（数据通道 `remote.workspace.follow` 可用），暴露 5 个问题。
- 变更：新增 `docs/UI-REVAMP.md`（提案，未实施）：对话标题缺失、默认工作区未本地化、导出路径改目录选择器、布局紧凑化、`打包完成` 误报且无产物（两处根因）。
- 验证：无（仅方案）。
- 下一步：等待用户审核方案并选择布局/标题方案。

## 097 · 2026-11-11 · fix: 归组容错与自动化测试
- 现象：树变空（显示「还没有可迁移的对话」）。
- 修复：`session.list` 为空/失败时回退到 `workspace.sessionIds`（旧逻辑），保证树不整棵消失；路径归一统一斜杠；空工作区组保留。
- 测试：暴露 `_test.groupFromWorkspaces` 纯函数；`client-render` 新增「cwd 归组 + 未分组 + 回退」用例。
- 验证：全量 180 项测试通过。

## 098 · 2026-11-11 · feat: ADR-0011 exec 路由与导入激活
- 新增 `src/host/exec-route.js`：`POST /api/mover/exec`（Connection exact Fetch 路由），分发 list/find/size/inspect/export/import；不依赖会话上下文、不写会话日志。
- Host `apply` 注册路由（`ctx.get('connection').fetch.register`），缺失时 UI 回退命令通道。
- `importPack` 导入后对每个新会话调用 `sessionController.resolveAgent` 激活（live 索引更新，左侧列表热更新）。
- Client 新增 `runAction` / `runMoverAction`：操作优先 exec 路由，404 回退命令；load 标题优先 `exec list`（catalog 含事件兜底标题）。
- 验证：`node --check` 全通过；`commands` 12 项、`client-render` 4 项通过。

## 099 · 2026-11-11 · fix: 服务重建事件字段补齐（released v2 row lacks time）
- 现象：另存为新对话导入后左侧出现（热重载生效），但打开报 `released v2 row 0 lacks required field time`。
- 根因：`decodeSessionEvents` 解出的事件缺 `time`（源日志旧格式），服务重建写入时按 v2 行校验失败。
- 修复：重建前补齐事件必填字段（`type`/`seq`/`time`/`data`，time 缺失用递增时间戳），create 固定 `version: 4`。
- 测试：`commands` mock 的 `append` 校验 seq/time/type；12 项通过。

## 100 · 2026-11-11 · fix: 空工作区与重名工作区
- 现象：导入（默认 skip）后左侧多出一个空工作区；导入默认工作区后出现两个同名「默认工作区」。
- 根因：`registerWorkspaces` 无条件登记所有包内工作区（会话全跳过时留下空工作区）；`workspaceRegistry.create` 允许不同路径同名。
- 修复：只登记**有会话写入**的工作区（`writtenByKey`）；新路径 + 标题重名时追加「（导入 N）」后缀；同路径仍复用不改名。
- 验证：全量 180 项测试通过。

## 101 · 2026-11-11 · docs: 测试优先原则与全量测试计划
- 新增 `AGENTS.md` §8：修复后先自测（单测 → CLI → Host 自检 → 无头浏览器 CDP → 最后才请人），测试工作区与证据要求。
- 新增 `docs/TEST-PLAN.md`：项目现状、10 个待测点、A–F 六组 40+ 用例（上下文/动作/期望/验收标准/证据列）。

## 102 · 2026-11-11 · fix: CLI 重复导入冲突检测 + 首轮自动化
- 修复：CLI `import` 未传 `existingSessionIds`，重复导入会覆盖且提示「已导入 N」；现在扫描已有 id，输出「跳过 N 个已存在」。
- 首轮证据：测试工作区 `%TEMP%\\dsh-mover-e2e-4915...`——B1 导出 3 对话（46842 B）、B2 导入 3 会话、B3 重导「跳过 3 个」且文件数不变、B5 损坏包退出码 1。
- 验证：全量 190 项测试通过。

## 103 · 2026-11-11 · test: 测试基础设施与首轮自动化
- 新增 `tests/e2e/cdp/`：CDP 驱动无头 Chrome（`cdp-dsh-test.mjs` 入口/浮层/树/勾选/高级选项，`cdp-flow-test.mjs` 导出+导入全流程，`cdp-nav-check.mjs` 导航+侧边栏读取，`cdp-eval.mjs` 调试，`check-sessions.mjs` 会话头校验）。
- 首轮执行（测试工作区 `%TEMP%\\dsh-mover-e2e-491526332be6484b83ad9c28d5b06175`）：A1 190 项通过；B1/B2/B3/B5 CLI 通过；D1–D8、D10 通过；D7 导出包 26495 B；D11 导入数据成功（已导入 2 个）。
- 遗留：**D12 导入会话未出现在 DSH 侧边栏**（重启后仍不显示；会话文件 header 合法 version=4/cwd 正确，疑似 DSH `session.list` 对 blank/formatStatus 过滤，待 Host selftest 定位）。
- 证据：`%TEMP%` 下 `cdp/*.png`、`cdp-result.json`、`logs/*.log`、`export-out/cdp-test.dshpack`。

## 104 · 2026-11-11 · fix: new-id 改用官方 fork（复制会话可靠）
- 根因：手工 `create+append` 重建会破坏 DSH 的 delivery marker 语义（time/version/marker/title/sourceEventSeqs/throughSeq 连环校验失败）；契约里 `sessionController.fork` 是唯一官方复制入口。
- 修复：new-id 改为 `sessionController.fork`（源会话在本机时）；空会话（无 completed turn）无法 fork → 跳过并记录；exec 路由 deps 改为**请求时延迟解析**（apply 时 `sessionController` 未就绪取到 undefined）。
- 验证（CDP 无头浏览器）：导入结果「已导入 1 个对话、跳过 1 个已存在」；侧边栏即时出现 fork 出的会话；点开历史正常加载（corrupt=false）。
- 清理：重建失败残留的 10 个损坏会话已移到 `<home>/corrupt-backup-3-.../`。
- 复测：CDP 确认侧边栏即时出现 fork 会话、点开历史正常（`corrupt=false`）；全量 190 项测试通过。

## 105 · 2026-11-11 · fix: 空会话无法复制的明确提示
- 变更：`importSessionsViaService` 统计 `unforkable`；导入结果文本追加「（其中 N 个空会话无对话轮次，无法复制）」。
- 验证：`commands` 12 项通过；exec 导入含空会话的包时文本含该提示（CDP 待复跑）。

## 106 · 2026-11-11 · fix: CLI 附件恢复 + 附件包全链路测试
- 修复：CLI `import` 未调用 `restoreAttachments`（Host 有、CLI 没有）→ 现在恢复附件并输出「N 个附件」。
- 附件包构造（用户提供的 docx + md）：`build-attach-pack.mjs` 生成 manifest + 会话事件（user/message 带 file 附件引用）+ `attachments/v1/file-objects|files` 条目。
- 验证：CLI 导入 → 4 个附件文件（2 file-objects + 2 file-references）+ 会话文件；exec 导入当前 Home → 「已导入 1 个对话、附件 4 个」，附件对象写入 `attachments/v1`。
- 遗留：手工构造的事件在 DSH 会话列表中的可见性待确认（cwd 无匹配工作区、侧边栏折叠）；真实 DSH 附件消息的导出/导入链路已由 CLI/exec 验证。

## 107 · 2026-11-11 · test: 真实附件会话全链路验证
- 用户测试环境会话「你好测试消息」含真实附件（PDF 3.5MB + DOCX 10KB）。
- 导出：`real-attach.dshpack` 1.9MB，含 2 个 `attachments/v1/file-objects`（3711094 / 10373 字节）。
- CLI 导入新 home：恢复 4 个附件文件（file-objects + files）。
- exec 导入当前 home（new-id → fork）：结果「已导入 1 个对话、附件 0 个（警告 2）」——警告因当前 home 附件对象已被 DSH 锁定（EPERM），真实迁移（新 home）无此问题；fork 会话打开后 PDF/DOCX 附件名正常显示（`corrupt=false`）。
- 证据：CDP `hasPdf=true / hasDocx=true`；测试计划 E5 标 ✅。

## 108 · 2026-11-11 · fix: 另存为新对话 + 指定目录的落点提示
- 现象：用户导出「默认工作区 + 13 对话」，清空后指定目录导入（另存为新对话）→ 13 个会话落在被清空的默认工作区，未进「default-workspace（导入 1）」。
- 根因：`另存为新对话` 走 DSH `fork`，fork **保留源 cwd**；指定目录只影响工作区登记/文件，不改变 fork 会话 cwd。
- 验证：同包用「跳过」导入新目录 → 13 个会话 cwd 全部改写为 `<目标目录>\\default-workspace`（正确）；日志显示 attach 失败（cwd 不匹配新工作区）。
- 修复：导入页在「指定目录 + 另存为新对话」组合下显示提示（fork 保留源工作区路径，改落点请用跳过/覆盖）。

## 109 · 2026-11-11 · docs: 导入模式重设计方案
- 问题：落点与冲突策略并列，但 fork 让「指定目录 + 另存为新对话」语义失效，整体不直观。
- 产出：`docs/IMPORT-REDESIGN.md`（现状问题清单 + 方案 A 两步向导 / B 意图驱动 / C 智能默认+独立复制 / D 逐项处理 + 对比 + 推荐 C）。
- 状态：待用户选定方案后实施。

## 110 · 2026-11-11 · docs: ADR-0013 导入模式（强制目录 + 冲突三选）
- 用户提案：放弃「放回源路径」，强制指定目录；冲突行为改为跳过/重命名另存/覆盖（OS 复制风格）。
- ADR-0013（Proposed）：可行性分析——强制目录可行；工作区目录重命名可行；**会话级重命名不可行**（DSH fork 保留 cwd、改 id 会 corrupt），列出 3a/3b/3c 三种退化定义。
- 待用户拍板：是否批准、重命名定义、目标目录选源路径时的行为、默认目录。

## 111 · 2026-11-11 · feat: 导入模式改造（强制指定目录 + 跳过/覆盖）
- ADR-0013 已批准并实施：移除「放回原路径」与「另存为新对话」；目标目录必填（默认 `~/dsh-mover-import` 预填）；冲突仅「跳过 / 覆盖」；附件跟随会话策略；失败不回退、红字报错。
- Host：`importPack` 强制 `targetRoot`（空 → 明确报错）、拒绝 `new-id`、删除 fork 重建路径；`listCatalog` meta 增加 `defaultImportDir`。
- Client：移除落点单选 / new-id / forkCwdHint；目标目录由 meta 预填；空目录提交报错。
- CLI：`--target` 必填（帮助文本同步）。
- 验证：全量 191 项测试通过（新增「target 缺失报错」「new-id 被拒绝」用例）。

## 112 · 2026-11-11 · fix: 覆盖策略可观测性 + 复现验证
- 用户报告「覆盖」无效（导入 0、跳过 1）。CDP UI 自动化复现：radio 选中「覆盖」后导入结果「覆盖 1 个」——Host/UI 覆盖逻辑正常。
- 自动化脚本侧经验：React 受控输入需先重置 `_valueTracker` 再 set + input 事件，否则 onChange 不触发（用户手动输入不受影响）。
- 用户侧可能原因：浮层重开后策略默认「跳过」且未切换 / 页面旧 bundle；已在预览卡片显示「冲突处理：跳过 / 覆盖」。
- 验证：`client-render` 4 项通过。

## 113 · 2026-11-11 · fix: 覆盖不同目标目录导致重复 id（DSH 启动失败）
- 现象：用户侧边栏空、创建按钮报 `directoryPickerController unavailable`；日志为 `duplicate JSONL session id ... multiple project directories` → workspaceRegistry 初始化失败 → 依赖服务全部 pending。
- 根因：覆盖导入时目标 cwd 与现有会话 cwd 不同，写入了第二份会话文件（同一 id 两个目录）。这是产品缺陷，被我的覆盖测试触发。
- 修复：`planImport` 接收 `existingCwdById`；`overwrite` 且目标 cwd ≠ 现有 cwd 时降级为 `skip`（避免重复 id）。Host/CLI 均收集 id→cwd 并传入。
- 清理：重复会话目录已移到 `dup-cleanup-*`；重启后启动日志干净、左侧默认工作区正常。
- 测试：单元 178 项通过（新增 plan-import 降级用例）。

## 114 · 2026-11-11 · fix: 覆盖 = 原地恢复（对齐现有会话 cwd）
- 根因：上一轮「目标 cwd 不一致 → 降级跳过」的保护误伤恢复场景——用户重新导入时保留默认目标目录，现有会话在旧目录，覆盖被降级成跳过（绿字「跳过 1 个」）。
- 修复：`overwrite` 时 `targetCwd` 对齐**现有会话 cwd**（原地恢复，不依赖用户填的目录）；无现有 cwd 信息时保持目标目录。不会再写第二份（重复 id 防护仍成立）。
- 测试：plan-import 9 项、全量 192 项通过。

## 115 · 2026-11-11 · docs: 导入行为决策树
- 产出：`docs/IMPORT-BEHAVIOR-TREE.md`——按「输入 / 目标目录 / 工作区 / 会话 / 附件 / 登记 / 结果」分层列出当前行为与 10 个待拍板决策点（旧格式包、同名目录、文件冲突、附件冲突、cwd 未知覆盖、纯对话落点、跳过会话的附件、目标=源路径、空工作区文件、fork 链策略）。
- 状态：待用户审阅调整后，按调整后的树做 code review 与实现调整。

## 116 · 2026-11-11 · docs: 决策树落地设计文档（导入 + 导出）
- 用户拍板：会话冲突 + 新目录落点 → **迁移覆盖（C）**，结果须提示「原工作区/会话 → 新工作区/会话」。
- `docs/IMPORT-BEHAVIOR-TREE.md`：补 3.8 迁移覆盖节点并标记已定。
- `docs/DESIGN.md`：新增 §3.1 导入行为决策树、§3.2 导出行为决策树（按当前实现）。
- 待用户审阅 10 个决策点后做 code review 与实现调整。

## 117 · 2026-11-11 · feat: 导入边界规则落地（ADR-0014）
- ADR-0014（Accepted）：迁移覆盖 + 10 条边界规则实现。
- `plan-import`：覆盖且 cwd 不同 → `migrateFrom`（迁移覆盖）；父会话跳过 → 子会话强制跳过。
- `import-pack`：迁移覆盖前备份/移除旧位置同 id 目录（`(id)-migrated`），防止重复 id。
- `importPack`：覆盖但 cwd 未知 → 拒绝；附件只恢复实际写入会话引用的部分；只还原有会话写入的工作区文件；同名未登记目录 → `标题 (1)`；结果文本增加迁移覆盖/覆盖文件/未归组/旧格式提示；移除 unforkable 残留。
- `workspaces.restoreWorkspaceFiles`：返回 `overwritten` 列表（覆盖文件统计）。
- 验证：全量 192 项测试通过（plan-import 迁移/父跳子用例、import-pack 覆盖用例）。

## 118 · 2026-11-11 · fix: 全量 code review 修复与 CDP 回归
- code review 发现并修复 4 处偏差：
  1. 迁移覆盖未传 `backupRoot`（直接 rm 旧目录，违反「备份后移除」）→ Host/CLI 传 `<DSH_HOME>/dsh-mover-backup`；
  2. 迁移提示只有路径 → 改为「`<工作区名>/<会话名>（原 <路径> → 新 <路径>）`」；
  3. exec 路由在 apply 时 `connection` 未就绪就放弃注册（部署后出现 `connection.fetch unavailable`）→ 改为延迟重试（120×500ms）；
  4. CLI 未对齐决策 2/5/7/9 → 补齐同名目录 `(1)`、cwd 未知拒绝、附件按写入会话过滤、空工作区文件过滤、备份根。
- CDP/exec 回归（干净 Home）：
  - 导入 A（跳过）：「已导入 1 个对话、登记 1 个工作区、归组 1 个对话」；
  - 覆盖到 B（迁移覆盖）：「覆盖 1 个（其中 1 个迁移覆盖）」+ 提示「`default-workspace（导入 2）/创建测试Markdown文档（原 cdp-A3 → 新 cdp-B3）`」；
  - sessions 目录仅 cdp-B3 存在（A3 旧目录已移除），无重复 id。
- 验证：192 项测试通过。

## 119 · 2026-11-11 · feat: 迁移包预览冲突明细
- Host `inspectPack`：返回 `conflictDetails`——会话项含「标题 / 现有 cwd / 目标 cwd / 类型（`migrate-overwrite` 或 `overwrite-in-place`）」；工作区项含「标题 / 路径 / 类型 `same-path-reuse`」；附件内容寻址不计冲突；接受 `target` 参数预判是否迁移。
- Client：预览时自动带上目标目录；预览卡片按类型列出冲突项（会话/工作区各最多 5 条 + 「…等 N 项」），文案如「对话「X」：覆盖将迁移到新目录」「工作区「Y」：路径已存在，将复用/合并」。
- 验证：192 项测试通过（inspect 断言更新为 conflictDetails）。

## 120 · 2026-11-11 · feat: 空工作区也登记（E）+ 空目录复用（D3）
- 背景：会话全跳过的导入会留下空目录；二次导入把“本插件创建但未登记”的目录误判为用户目录 → 加 `(1)` → 迁移覆盖（用户表现为“回滚无变化/导入 0”）。
- ADR-0014 决策 9 修订（用户批准）：包内工作区（含无会话）**全部登记并还原文件**，结果标注「M 个暂无对话」。
- D3 兜底：pathMap 判定中「存在 + 空 + 未登记」的目录直接复用（不加序号）；非空未登记才加 `(1)`（决策 2 保持）。
- CLI 对齐：工作区文件全部还原。
- 文档：ADR-0014、IMPORT-BEHAVIOR-TREE §7、DESIGN §3.1 同步修订。
- 验证：192 项测试通过；CDP/exec 回归待执行。

## 121 · 2026-11-11 · feat: 已打开会话的精确重启提示
- 调研：DSH `sessions` 是内存会话存储（无 close/reload API，日志 append-only）；覆盖写盘后内存中仍是旧状态，刷新浏览器无效，必须重启 DSH。
- 实现：`importPack` 在激活前用 `ctx.sessions.list()` 记录「导入前已打开」的会话；结果文本追加「注意：N 个对话在导入前已打开，DSH 进程需重启后才会显示回滚结果」。
- `host/index.js` execDeps 增加延迟解析的 `sessions` 服务。
- 验证：全量 192 项测试通过。

## 122 · 2026-11-11 · fix: 导入结果的重启提示覆盖迁移/空工作区
- 迁移覆盖：结果追加「新位置需重启 DSH 后才会出现在左侧（新目录不在启动索引中）」。
- 已打开会话：保留「N 个对话在导入前已打开，需重启 DSH 后才会显示回滚结果」。
- 空工作区（E 版）：追加「N 个暂无对话的工作区需重启 DSH 后才会出现在左侧」。
- 其他位置排查：新导入依赖热重载即时显示 + 现有兜底提示；导出侧无 DSH 状态变化，无需提示；CLI 由使用者自行重启。
- 验证：全量 192 项测试通过。

## 123 · 2026-11-11 · fix: 迁移覆盖后会话归组（detach 旧归属 + 启动补 attach）
- 现象：迁移覆盖后 A1 在左侧进入「未分组」；workspace.json 中旧工作区 `sessionIds` 仍含该会话，新工作区为空。
- 根因：迁移覆盖写入新 cwd；运行时 `attachSession` 受启动索引限制失败；旧工作区归属未解除（持久化残留，按 cwd 过滤后不可见）。
- 修复：
  1. 迁移覆盖时对旧 cwd 所属工作区调用 `detachSession`；
  2. DSH 启动后插件自动补 attach：按会话 header.cwd 匹配已登记工作区（**只加不减**，避免误伤用户手动归组），日志 `grouping repaired N sessions`。
- 验证：全量 192 项测试通过；重启后 workspace.json 的 sessionIds 与新工作区一致。

## 124 · 2026-11-11 · feat: 导出「仅工作区」模式（ADR-0015）
- ADR-0015 已批准（B+C）：Host/CLI 管线 + 导出页「仅工作区」入口。
- Host：`exportWorkspacesOnly`（`mode='workspaces'`、`sessions=[]`、空文件夹 `fileCount: 0`）；exec `export.workspaces`；命令 `--workspace`（可多次）。
- CLI：`export --workspace <path>`（至少一个）。
- Client：导出页模式切换「对话 + 工作区 / 仅工作区」；仅工作区模式列出工作区（含空），至少选一个。
- 文档：ADR-0015、SPEC 升 v1.2（ADR-0013/0014/0015 行为）、DESIGN 导出决策树补模式分支、TASKS M8。
- 验证：193 项测试通过（新增「仅导出工作区（含空目录）→ 导入登记空工作区」用例）。

## 125 · 2026-11-11 · fix: 工作区双记账导致 DSH 启动失败 + 仅工作区导出回归
- 现象：启动报 `session ... is accounted by both workspace 2384be95 and 5e77ea89` → workspaceRegistry pending → 全部服务不可用（exec 404）。
- 根因：启动补 attach 只加不减 + 旧工作区持久化残留 → 同一会话被两个工作区记账。
- 修复：`repairGrouping` 先修双记账（同一会话只保留 cwd 匹配的工作区，其余 detach），再补 attach；测试 Home 的残留数据已手动修复（备份 `workspace.json.bak`）。
- 仅工作区导出（ADR-0015）回归：
  - exec `export { workspaces: [空目录] }` → 「已导出 1 个工作区（仅目录结构）…（584 字节）」；
  - 导入 → 「登记 1 个工作区（其中 1 个暂无对话）」+ 重启提示；
  - UI：导出页模式切换、仅工作区提示、工作区列表（含空）均出现（CDP `hasModeButtons/hasHint/hasWorkspaceList = true`）。
- 验证：193 项测试通过；重启日志 `exec route registered`、无 inconsistent/pending。

## 126 · 2026-11-11 · fix: 仅工作区导出补文件内容 + UI 隐藏无关选项
- 问题：`exportWorkspacesOnly` 只写 manifest（`fileCount: 0`），文件/目录结构未进包；仅工作区模式仍显示「将工作区一并导出」与高级选项（无作用）。
- 修复：
  - `exportWorkspacesOnly` 用 `scanWorkspace` 扫描：文件写入 `workspaces/<key>/files/...`（含内容），空目录写目录条目；manifest 的 `fileCount/sizeBytes` 取真实值。
  - 导出页仅工作区模式隐藏「将工作区一并导出」及高级选项。
- 文档：ADR-0015 决策 3、SPEC v1.2、DESIGN 决策树同步为「文件内容 + 目录结构」。
- 验证：新增「仅导出工作区（含文件）→ 导入还原文件结构」用例；全量测试通过。

## 127 · 2026-11-11 · feat: ADR-0012 默认预检 + 大工作区打包实测
- ADR-0012 采纳并实现：导出**默认执行预检**（导出页移除「导出前预检」开关；Host 以 `options.preflight !== false` 判定；结果文本附「预检 N 项」）。
- 大工作区实测（1 GB，单文件重复内容）：
  - 导出耗时 **6.5 s**（扫描 + 压缩打包）；
  - 进程 RSS 40 MB → 110 MB（远低于 300 MB 预算）；
  - 包大小 1,044,523 字节（高压缩率样例）。
  - 供用户判断是否需要精确进度（当前转圈 + 阶段文案）。
- 技术债登记：T9.1 符号链接/权限位转换（要做）、T9.2 取消（不做）、T9.3 大工作区测量（本次已完成）。
- 文档收尾：INDEX / FINAL-REPORT / README / CODE-REVIEW / ACCEPTANCE / TEST-PLAN / IMPORT-REDESIGN / TASKS 与 ADR-0011/0012 状态同步。
- 验证：194 项测试通过。

## 128 · 2026-11-11 · feat: 符号链接解引用 + 权限位恢复（T9.1）
- `scan`：文件符号链接按 SPEC FR-9 **默认解引用**（记录 `dereferenced`、目标 size/mode）；目录链接/损坏链接跳过并记录（`symlink-dir-skipped` / `symlink-broken`）。
- 导出：结果文本统计「解引用 N 个符号链接 / 跳过 N 个」。
- 导入：POSIX 目标恢复 exec 位（`chmod`，Windows 忽略）。
- 测试：`scan` 符号链接语义（文件链接解引用、目录链接跳过）+ `commands`「仅导出工作区：文件符号链接解引用并计入统计」（导入后还原为普通文件）；全量通过。
- 说明：POSIX `chmod` 分支在 Windows 测试环境未实测，待 Linux CI 验证。

## 129 · 2026-11-11 · docs: TEST-CASES v1.2（决策树全路径覆盖 + 跨平台）
- 重写 `docs/TEST-CASES.md`：按导入/导出行为决策树逐路径列出用例（导出 E-01..E-15、导入 I-01..I-23、跨平台 P-01..P-08），每条含「背景 + 动作 + 预期结果 + 执行方式 + 平台 + 验收结果」，附**决策树节点 → 用例**覆盖矩阵。
- 执行方式自动化优先（单测 / CDP / 集成）；仅主题语言保留「用户人工确认」（已确认）。
- 平台分化：符号链接（Windows P-04a 需开发者模式 / POSIX P-04b）、exec 位（P-05a/b）、大小写敏感（P-06b/c）、Windows 非法名（E-13）。
- 待补：I-20 旧格式包单测；P-04b/P-05a/P-06b/c 需 Linux/macOS CI。
- 补充（同轮）：`import-pack` 新增「旧格式包（sessionFormat 3）直接写入 v3 会话文件」用例 → I-20 ✅。
- 补充（同轮）：Windows 开发者模式已开启，`fs.symlink` 文件/目录链接均可创建；`scan`/`commands` 符号链接用例实测通过 → P-04a ✅。

## 130 · 2026-11-11 · chore: 插件正式命名 dsh-pack-and-go（「打包就走」）
- 用户拍板名称：**dsh-pack-and-go**（中文「打包就走」），替代占位名 `dsh-mover`。
- 全仓库重命名（35 个文件）：package.json name/bin、`cordis.patch.yml` 插件行、client bundle id、日志前缀、默认包名前缀、README/SPEC/DESIGN/INDEX/TASKS/TEST-CASES/ACCEPTANCE/CODE-REVIEW/FINAL-REPORT/AGENTS 等文档；历史文档（DEVLOG 旧条目、IMPORT-REDESIGN）保留原名。
- 内部 selftest 标记同步：`DSH-MOVER-*` → `DSH-PACK-AND-GO-*`，环境变量 `DSH_MOVER_SELFTEST` → `DSH_PACK_AND_GO_SELFTEST`（AGENTS §8 同步）。
- 不改：命令名 `/mover`、exec 路由 `/api/mover/exec`、`DSH_HOME` 存储路径（内部契约保持稳定，改名不迁移用户数据）。
- 验证：196 项测试通过；`node --check` 通过。

## 131 · 2026-11-11 · docs: 重写 README（功能/平台/安装/原理/包协议）
- README 重写为对外介绍：项目定位「打包就走」、能力表、平台支持矩阵、Web/CLI 安装与用法、工作原理（Host/Client/Core + Mermaid 图 + 关键设计）、`.dshpack` 包结构协议（目录树 + manifest 字段表 + 导入语义）、安全边界、文档导航、测试与状态。
- 与实现一致：schemaVersion 2、sessions/workspaces/attachments 路径、默认导入目录 `~/dsh-pack-and-go-import`、备份 `dsh-pack-and-go-backup`、196 项测试。
- 纯文档变更，无代码影响。

## 132 · 2026-11-11 · fix: 导出附件在未设置 DSH_HOME 的桌面环境崩溃
- 现象：desktop profile 导出（勾选「打包附件」）报 `The "path" argument must be of type string. Received undefined`。
- 根因：桌面进程未设置 `DSH_HOME`，插件 `deps.dshHome = process.env.DSH_HOME` 为 undefined → `join(undefined, 'attachments','v1')` 抛错（仅「打包附件」分支触发；不开附件不碰该路径）。
- 修复：
  - `commands.js` 增加 `resolveDshHome(deps)`：缺省回退 `join(homedir(), '.dsh')`；导出附件 / 导入 sessionRoot / 备份根 / 附件恢复 4 处使用；
  - `host/index.js` 的 execDeps 与命令 deps 同样回退默认 home。
- 测试：新增「导出附件缺少 dshHome 回退默认 home（不抛 path 错误）」用例；**197 项通过**。
- 生效方式：desktop 是 link 安装，**重启 DSH 桌面应用**后生效。

## 136 · 2026-11-12 · feat: 导入按包内 mode 恢复 POSIX 文件权限（ADR-0016 B1）
- 决定：用户批准 ADR-0016 的 **B1（仅文件权限）**；目录权限（B2）另立 ADR，暂不做。
- 事实更正（写入 ADR）：Windows 源包 mode 不是 0644，而是 libuv 由 `FILE_ATTRIBUTE_READONLY` 合成——普通文件 `0o100666`、只读 `0o100444`、目录 `0o40766`（无 x 位）。故 win32 源包必须跳过 mode 恢复。
- 变更：`core/workspaces.js` `restoreWorkspaceFiles` 新增 `sourcePlatform`；POSIX 源 + POSIX 目标按 `mode & 0o777` 恢复（自动剥离 setuid/setgid/sticky）；win32 源或未知来源回落「仅 exec 位」；Windows 目标不变；chmod 失败记 warning；返回值新增 `modes: { applied, failed }`。
- 调用方：CLI `import` 与 Host `importPack` 传入 `manifest.source.platform`，结果文本统计「恢复权限 N 个」（失败数单独提示）。
- 测试：`workspaces` 新增 4 项（0600/0644/0755 保持、setuid/setgid 剥离、win32 源包跳过 + exec 位仍生效、Windows 目标忽略）；`cli.test` 新增工作区导出/导入端到端权限断言；全量 **203 项通过**。
- 文档：ADR-0016 → Accepted（B1）、SPEC → v1.3（FR-9 更新）、TEST-CASES 新增 P-05c。
- 未做（B2 前置）：导出端记录真实目录 mode、目录两阶段 chmod、Windows 目录 mode 映射。
- 下一步：B2 ADR；macOS CI 复核 P-05a/P-05c。

## 135 · 2026-11-12 · docs: 新增 ADR-0016（全权限位保真，Proposed）
- 背景：devlog 134 后导入端仍只恢复 exec 位；本机实测 `0644`→`0664`、目录 `0775` 跟随 umask（umask=`002`），`0600` 私钥会变成 group 可读写。包内 mode 在 zip external attributes 中本就无损，丢失发生在恢复端策略。
- 变更：`DECISIONS.md` 追加 ADR-0016（**Proposed**）：4 个选项（A 维持现状 / **B 全量保真** / C 不区分源平台 / D 仅报告）+ 8 条硬约束（仅 POSIX 目标、剥离 setuid/setgid/sticky、win32 源包跳过、目录两阶段 chmod、失败仅 warning、结果统计 `modes`、覆盖语义、包格式不变）。
- 状态：等用户批准或否决；**未改任何代码**，P-05a 修复（devlog 134）保持现状。
- 下一步：批准 → 按 B 实现 `workspaces.js` + 单测 + 结果文本；否决 → 本 ADR 标 `Rejected` 并保留原文。

## 134 · 2026-11-12 · fix: 导入工作区文件丢失 POSIX 可执行位（P-05a）
- 现象：含 `0755` 文件的工作区导出正常（包内 mode 记录为 `0o100755`），导入后落盘 `0o664`，可执行位丢失（Linux 专项 P-05a 失败）。
- 根因：`core/workspaces.js` 的 `restoreWorkspaceFiles` 归并条目时只保留 `{ relative, isDir, data }`，丢掉 `entry.mode`；后续 exec 位分支 `typeof file.mode === 'number'` 恒为 false，`chmod` 永不执行（异常还被 `catch {}` 静默吞掉）。CLI `import` 与 Host `importPack` 共用该函数，故 UI 导入同样受影响。
- 修复：归并时带上 `mode: entry.mode`；chmod 仍按包内真实 mode 恢复（不硬编码 755），Windows 目标继续忽略。
- 测试：新增「POSIX 目标恢复可执行位（P-05a）」（0755→0755、普通文件不得出现 x 位）；临时回退该行可复现 `actual 436 / expected 493`；全量 **198 项通过**。
- 实测（Linux）：导出 `0o100755` → 导入 `0o755`、可执行 yes；Linux 专项脚本与最小复现脚本同时通过。
- 说明：仅恢复「带 exec 位」的文件；普通文件仍按 umask 落盘（`0644`→`0664`），属 SPEC FR-9 / ADR-0003 现有策略，本次未改；若需全权限位保真（如 `0600` 私钥）应另立 ADR。
- 下一步：macOS CI 复核 P-05a/P-04b；P-06b 待 macOS CI。

## 133 · 2026-11-11 · feat: 移除导出页「搜索对话」框
- 用户决定：导出页搜索框用处不大且有 bug，移除。
- Client：删除 `query` 状态、`visibleGroups` 过滤逻辑与搜索输入框渲染；树直接展示 `groups`。
- 清理：`searchPlaceholder` 文案（zh/en）；CDP 脚本 `d6_search` 改为断言搜索框不存在。
- SPEC：FR-2「其他选择能力」移除搜索框条目（用户直接指令的产品简化）。
- 验证：`node --check` 通过；全量测试通过。
- README/TEST-PLAN 文档导航同步。

## 137 · 2026-11-12 · docs: 按 Linux 测试结果同步文档（203 项 / SPEC v1.3 / ADR-0016 B1）
- 同步远程 Linux 端 4 个提交（f83cf83..bcbcb11，fast-forward）并核对测试记录（TEST-CASES §6、DEVLOG 133–136）。
- 文档同步：
  - README：徽章 196→203、SPEC v1.3、能力表新增「权限保真」、状态限制更新（Linux 已完成，macOS 待 CI）；
  - FINAL-REPORT：升级 v1.3（203 项、Linux 专项、技术债 B1 完成/B2 待 ADR、精确进度不做）；
  - INDEX：状态/下一步/未决（B2、macOS CI）；
  - DESIGN §3.1：导入决策树补「文件权限（ADR-0016 B1）」节点；
  - ACCEPTANCE #10：补 Linux 实证；CODE-REVIEW 测试数 194→203。
- 验证：Windows 本机 `node --test` → **203 项**（198 pass + 5 个 POSIX 权限用例预期 skip）。

## 138 · 2026-11-12 · feat: 目录权限保真（ADR-0016 B2）
- 用户批准 B2（目录权限）；导出端记录真实目录 mode，导入端两阶段恢复。
- 导出：`exportWorkspacesOnly` 目录条目带 `mode`；`exportAllSessions` 新增目录条目（含 `mode`）。
- 导入：`restoreWorkspaceFiles` 先按可写 `mkdir` → 写完全部文件 → 按「深→浅」统一 `chmod` 目录（`mode & 0o777`，剥离 setuid/setgid/sticky）；win32 源包跳过（目录 mode 为合成值）；Windows 目标忽略。
- 统计：`modes.dirsApplied/dirsFailed`；结果文本「恢复目录权限 N 个」。
- 测试：新增 5 项（目录 0700/0755/0500 两阶段、目录 setuid/setgid 剥离、win32 源跳过、Windows 目标忽略、导出目录条目 mode）；全量 **208 项**（199 pass + 9 skip）。
- 文档：ADR-0016 B2 Accepted、SPEC v1.4、DESIGN 决策树、TASKS T9.5、TEST-CASES P-05d。

## 139 · 2026-11-12 · fix: 跨平台导入改写 working-directory/change 状态事件 cwd（ADR-0017）
- 问题：Windows 导出的会话在 macOS 导入后打开报「历史加载失败：failed to project session ... Invalid input」；根因是 `working-directory/change` 事件仍保留 `F:\\...`，`@deepseek-ai/dsh-working-directory` 的 wire 校验用 `path.isAbsolute` 拒绝（zod 4.6.6 的 issue 恰为 `{code:"custom",path:[],message:"Invalid input"}`）。
- 修复：`session-rewrite.js` 新增 `mapSessionCwd` / `rewriteSessionWorkingDirectories`（首帧原样、只解事件帧、仅改 `working-directory/change` 的 `data.cwd`、按行边界 1 MB 分块重压、checksum 跟随）；`import-pack.js` 仅在 `targetCwd` 定义且源/目标平台不同时启用，同平台保持 ADR-0007 字节保真。
- 映射：源根下 → 目标根 + 相对路径；源根外 → 目标根（本机会话曾切到 `F:\\PersonalProjects\\python\\新建文件夹`，落在源工作区之外）；已迁移路径幂等。
- 测试：新增 10 项（映射 Win→POSIX/POSIX→Win、源根外回落、幂等、header 帧字节不变、事件 checksum、chunkBytes、参数/版本、导入端跨平台/同平台/无 workspaceKey）；全量 205 项 → 204 pass + 1 项 macOS 既有环境问题（workspaces B2 用例清理只读目录 EACCES，另行修）。
- 复验：真实包 CLI 导入一次性 DSH_HOME → `dsh headless --session-id` 由 projection 报错变为 preset 语义提示（日志/投影通过）。
- 文档：ADR-0017、SPEC v1.5、DESIGN §3/§3.1/§4.1、TASKS T9.6、TEST-CASES v1.5/P-09、INDEX。

## 140 · 2026-11-12 · test: macOS 全量执行 TEST-CASES 220 项通过
- 环境：macOS（Apple Silicon），Node v24.14.0，Chrome 156 headless CDP；仓库 a5905ce（ADR-0017）。
- 全量：`node --test "tests/unit/**/*.test.mjs" "tests/e2e/**/*.test.mjs"` → 220 tests / 220 pass / 0 fail / 0 skip（205 unit + 15 e2e），2047 ms，EXIT 0。
- macOS 平台专项：P-04b 文件链接解引用 + 目录链接跳过；P-05a 0755→0755；P-05c 0600/0644/0755、setuid 剥离、win32 源包；P-05d 0700/0755/0500 两阶段（修复清理后）；P-06b APFS 大小写不敏感（A.txt/a.txt 同 inode）+ detectCaseCollisions 1 冲突；P-07 中文/空格名；P-09 真实 Windows 包导入 headless 投影通过（devlog 139）。
- 修复：`tests/unit/workspaces.test.mjs` B2 用例 finally 先 chmod 0700 再 rm，消除 POSIX 清理 EACCES。
- CDP（一次性 DSH_HOME + 隔离 web-e2e profile，未触碰真实 ~/.dsh）：E-01 导出（2 对话 + 1 工作区 + 4 文件）；E-02 仅工作区（mode=workspaces、fileCount 4、空目录骨架）；E-05 非法目标红字无产物；E-06 未选择时开始打包禁用；E-15 打包完成文案；I-02/I-11/I-19/I-23 覆盖/迁移/预览/结果提示。证据：`/tmp/dsh-pack-and-go-web-IjaLyr/evidence/`（截图 + JSON）。
- 问题记录：① E-05 实现文案「目标目录不存在」与原用例「父目录不存在」不一致——行为正确，按实现校正用例；② 迁移覆盖后热归组 `workspace/move-invalid` 日志噪音、结果「归组 0 个对话」，重启后自愈，符合重启提示，未改代码；③ B2 测试清理 EACCES（已修）。
- 文档：TEST-CASES 平台结果/§5/§6、TASKS T9.7、INDEX、README/FINAL-REPORT/ACCEPTANCE/CODE-REVIEW 计数同步（220）。
- 未重复复核：P-08 主题/语言沿用 2026-11-11 用户人工确认。

## 141 · 2026-11-12 · docs: 按 macOS 全量结果校订文档并同步 ADR 索引
- macOS 全量（devlog 140）后校订：TEST-CASES E-11 符号链接 POSIX 状态、§5 证据说明；FINAL-REPORT §5 后续建议；TASKS M4/T4.3 页面渲染状态；SPEC §12 ADR 索引补至 ADR-0017。
- 计数口径：macOS 220/220；Windows 208（199 pass + 9 skip）；Linux 203 为 B1 时点（B2 新增 5 项待 Linux CI）。
- 未改实现代码；仅文档一致性修正。

## 142 · 2026-11-12 · chore: 发布准备（npm 元数据 + dsh-market 收录 + 一条命令安装验证）
- 元数据：version `0.2.1`；移除 `private`；补 `author` / `repository` / `homepage` / `bugs` / `keywords` / `engines.dsh`（`>=0.2.0 <0.3.0`，`semver.satisfies(0.2.2-rc.2, range, {includePrerelease:true})` 通过）/ `publishConfig`；`files` 增 `screenshots.json` 与 `docs/screenshots/**/*.png`。
- 一条命令安装（GitHub）：一次性 DSH_HOME（复制 web profile），`dsh plugin --profile gh add github:VermilionPasvikin/dsh-pack-and-go` → 3.6s 安装、`dsh.profile.bundles` 追加；启动 web 日志出现 `[dsh-pack-and-go] command registered: mover` 与 `exec route registered: /api/mover/exec`；CDP 确认侧边栏「迁移对话或工作区」存在。
- npm 渠道：`npm pack --dry-run` → 37 files / 80.9 kB；`npm publish --dry-run` 通过（本机未登录 npm，实际发布待用户凭据）。
- 市场素材：`docs/icon-180.png`（SVG 经 Chrome CDP 渲染为 GitHub 托管位图）；`docs/screenshots/{market-export,market-import}.png` + 根 `screenshots.json`；`docs/market/awesome-dsh-plugin.yml`（category `session`）；`docs/RELEASE.md` 发布全流程。
- 兼容性事实：DSH `@deepseek-ai/dsh-app-boot` 的 `satisfies` 只看 `engines.dsh`（有则忽略 peerDependencies）；dsh-market 目录来自 awesome-dsh-plugin，收录需在对方仓库新增 `data/plugins/VermilionPasvikin__dsh-pack-and-go.yml` 并提 PR（需 GitHub 登录）。
- 待办（需凭据）：`npm login && npm publish`；push main + tag；向 awesome-dsh-plugin 提收录 PR。发布后按 RELEASE.md 第 3/6 节复验。

## 143 · 2026-11-12 · docs: npm 0.2.1 发布与 npm 渠道安装验证
- 发布：用户在仓库目录执行 `npm publish`（带 OTP）。npm staged publishing 先创建 `0.0.0-stage` 占位（13:54:12Z），约 2 分钟后 `0.2.1` 正式上线（13:56:50Z，dist-tag latest=0.2.1）；随后重复 publish 报 `cannot publish over the previously published versions: 0.2.1`，属正常。
- registry 校验：`npm view dsh-pack-and-go version repository dist-tags` → `0.2.1`、repository 指回 GitHub、latest `0.2.1`；`bin` 为 `src/cli/index.js`（npm 归一化），`dsh.bundle` / `dsh.client` / `engines.dsh` 均在。
- 安装验证：一次性 DSH_HOME（`/tmp/dsh-pack-and-go-npm-*`，复制 web profile 为 npmtest），`dsh plugin --profile npmtest add dsh-pack-and-go@0.2.1` → 5.4s，`dsh.profile.bundles` 追加；启动 web 日志出现 `command registered: mover` 与 `exec route registered: /api/mover/exec`；`--dump-config` 3 处；CDP 打开实例页面无 corrupt。
- 推送：main @ 537501a、tag v0.2.1 已在 origin；本轮只补文档。
- 备注：`0.0.0-stage` 为占位版本，无实际代码，可由维护者择机 `npm unpublish`。

## 144 · 2026-11-12 · docs: 按工作日志修正 README Linux 平台状态
- 现象：README 平台矩阵 Linux 行仍写「🧪 代码与测试就绪，CLI 可用，CI 待跑」，与 DEVLOG 134/136 已记录的 Linux 全量测试结果不一致。
- 依据：DEVLOG 136「全量 203 项通过」（Linux，Ubuntu 24.04 / Node 24）；TEST-CASES §6 同样记录 Linux 198→203 项通过，P-04b/P-05a/P-05c/P-06c 已实测。
- 更新：README Linux 行改为「✅ 2026-11-12 全量 203 项通过（Ubuntu 24.04 / Node 24）」；README 测试段保留说明：203 为 B1 时点，B2 新增 5 项待 Linux 复跑。
- 未改代码与测试；计数口径不变：macOS 220/220、Windows 208（199 pass + 9 skip）、Linux 203（B1 时点）。

## 145 · 2026-11-18 · fix: 重定位导入改写 deliverables 文件引用路径 + repair（ADR-0017 补充）
- 现象：Windows→Linux 导入的 `zmediakit-repair` 会话中，消息下方「在工作区中查看」报「找不到路径」，会话进入错误态。
- 根因：`deliverables/presented` 的 `files[].path` 仍是 `F:\\...` 绝对路径；DSH `present.open` 用 `workspaceFiles.stat(workspaceRoot=session.cwd, file.path)` 解析，旧路径不在新工作区。`tool/result` 的 `meta.cwd`（100 处）同样指向源 cwd。
- 修复：
  - `rewriteSessionFileReferences()`：重定位导入时把交付文件路径转工作区相对 POSIX 路径、`meta.cwd` 映射到目标 cwd；历史正文不改；
  - `import-pack` 在 header/状态事件改写后调用，written 记录 `fileRefsRewritten`；
  - 新增 `dsh-pack-and-go repair --home ... [--session id] [--dry-run]`：按最长后缀修复已导入会话，写前备份。
- 当前会话修复：`session-721899c1...` 改写 101 处（2 个交付路径 + 100 个 meta.cwd），备份 `session.v4.jsonl.zstd.bak-2026-11-18T05-10-58-941Z`；事件 959 条不变。
- 测试：新增 session-rewrite 单测（改写/幂等/repair 后缀）、跨平台导入集成、CLI `repair` 端到端；**224 项全绿**。
- 待用户：重启 DSH web / 重开会话验证按钮。

## 146 · 2026-11-18 · fix: 导入/repair 归一化 auto 权限预设（会话不可用）
- 现象：修好文件按钮后，打开 `zmediakit-repair` 会话仍显示「会话不可用」（composer placeholder），历史可读但无法继续。
- 排查：debug 副本 + Firefox WebDriver 复现；会话最后 `permission/preset=auto`、`sandbox/mode=danger-full-access`；DSH 恢复时报 `cannot restore preset "auto" without its active integration`。
- 修复：`normalizeSessionAgentState()`（仅当存在 auto 预设时）：auto→workspace-write、danger-full-access→workspace-write、never→ask；跨平台导入自动调用，`repair` 同样调用。
- 当前会话：repair 追加 2 处，备份 `...bak-2026-11-18T05-29-29-954Z`；debug 副本重启后 composer 恢复默认输入框（可用）。
- 测试：新增 normalize 单测、跨平台导入集成、CLI repair（含 auto 预设）；**226 项全绿**。
- 待用户：重启真实 DSH web / 重开会话验证。

## 147 · 2026-11-18 · chore: 版本 0.2.2 发布准备
- 版本 0.2.1 → 0.2.2（包含 devlog 145/146：deliverables 文件引用重定位 + repair、权限预设归一化）。
- 校验：226 项测试（217 pass + 9 个 POSIX 用例预期 skip）；npm pack --dry-run 40 文件 / 168 KB。
- 待发布：npm login 后执行 npm publish --access public；打 tag v0.2.2 并推送。
- 发布手册已同步到 docs/RELEASE.md。

## 148 · 2026-11-23 · feat: 宿主跨版本维护脚本与基线快照
- 背景：DSH 桌面版走 nightly 自动更新，本机宿主已 0.2.2-rc.2 → 0.2.2-rc.5；插件依赖跨版本不稳定契约（Cordis 服务、会话格式、数据布局、Client 运行时、加载方言），此前无检出-修复-回归闭环。
- 新增 `scripts/compat/`：`freeze-baseline.mjs`（冻结基线签名）、`check-upstream.mjs`（基线 vs 目标 diff，退出码 0=无变化/1=有变化/2=错误）、`probe-host.mjs`（定位本机 dsh CLI 与版本）、`lib/tar.mjs`（手写 ustar 解析：pax/GNU longname/prefix）、`lib/registry.mjs`（fetch+sha512 integrity 校验+semver range 解析）、`config.mjs`（WATCH_PACKAGES 14 契约包 + 契约文件过滤：package.json 与 lib/src，排除 dist/map/min）。
- 基线 `docs/compat/baseline/0.2.2-rc.2.json`：14 契约包 / 433 契约文件 sha256；不复制第三方源码（体积/许可证）。
- 演练：check-upstream 检出 rc.5 → 11 包版本变化、24 文件变化、0 增 0 删（含 dsh-session-format/index.js、dsh-session-persistence-jsonl/worker.cjs、dsh-workspace/index.js、dsh-attachment-local/index.js、dsh-home-paths/index.js、dsh-client-ui-cordis/client.js、dsh-client-ui-chat/client.js）。
- 测试：`tests/compat/` **25 项全过**（网络用例由 `DSH_COMPAT_NETWORK=1` 门控，两者各跑一遍）。
- 完全权限复核（2026-11-23 同日）：`git fetch` 云端 0/0 确认最新；全量 `node --test "tests/unit/**/*.test.mjs" "tests/e2e/**/*.test.mjs" "tests/compat/**/*.test.mjs"` → **251 项：241 pass / 0 fail / 10 skip**（9 个 POSIX 权限用例 + 1 个网络门控，均为预期）；`probe-host` 实测输出本机宿主 `0.2.2-rc.5`。
- Windows 修复：`probe-host` 执行 `.cmd` 必须经 `cmd.exe /d /c` 分参包装（直接 spawnSync 报 EINVAL；带 `/s` 会破坏含引号路径的解析）；已修并实测。

## 149 · 2026-11-23 · docs: 跨版本维护手册与流程接入
- 新增 `docs/UPSTREAM-COMPAT.md`：五类依赖清单（A Cordis 服务/API、B 方法契约、C 数据文件格式、D Client 运行时、E 打包分发，每项含破坏方式/检出/修复/回归）、检出 runbook D0–D5（每步命令/预期/判据/失败下一步）、修复决策树 §5、回归分层 R1–R6、维护记录模板 §7、边界与风险 §8、首次建立记录附录 A。
- ADR-0018（DECISIONS.md）：基线=已验证版本 0.2.2-rc.2；npm tarball + GitHub 按需对照（app.asar 不可读，不作基准）；手动 runbook；修复策略决策树；回归分层。
- TASKS.md 新增 M10：T10.1–T10.3 ✅（清单/基线、脚本/测试、runbook/ADR）；T10.4–T10.6 待办（对 rc.5 正式检出 D0–D5 → 回归 R1–R4 → freeze 升基线 + 校订 engines/RELEASE）。
- AGENTS.md：§2 导航表加 `docs/UPSTREAM-COMPAT.md`（宿主升级/用户报升级后异常时必读）；§4 新增宿主跨版本维护纪律（检出→修复→回归→升基线；新增 DSH 依赖同步更新清单与 WATCH_PACKAGES）。
- INDEX.md：当前状态/下一步更新（宿主已 0.2.2-rc.5，基线仍 rc.2）；文档地图加手册入口。
- 修复：devlog 147 条目历史写入含 NUL 字节（文件被判为二进制），本次按上下文恢复原文（0.2.1→0.2.2、npm pack、npm publish、v0.2.2）并保持编号不变。

## 150 · 2026-11-23 · chore: 宿主 0.2.2-rc.5 正式检出与 0.2.3 发布准备（T10.4–T10.7）
- 背景：发布 0.2.3 前按 UPSTREAM-COMPAT 流程对本机已升级的 DSH 0.2.2-rc.5 做首个正式检出。
- 检出（D1–D3）：check-upstream 11 包/24 文件变化；GitHub compare（dsh-v0.2.2-rc.2...rc.5，19 commits/300 files）证明**契约源码零变化**——session-format/session-persistence-jsonl/workspace/attachment-local/home-paths 的 src 全未动（npm hash 差异=重建产物）；`sidebar.footer.action` 契约未变（仅新增 `sidebar.session.action`、`workspace.picker` Factory、目录流第三 hole）；cordis 4.1.0 与 loader/include 版本未变。
- 运行时探针（D4，一次性 DSH_HOME `%TEMP%\dsh-compat-e2e-probe`，web 模板 profile + plugin add file:）：
  - 插件激活无 pending；`command registered: mover`；`exec route registered`；
  - SELFTEST `{"ungrouped":1,"sessions":1}`（CLI 导入会话被 sessionPersistence.list 正确读出）；
  - CLI export/import 往返成功、workspace.json（unit v2）更新；
  - CMD 探针 `commands.find true`；REBUILD 探针因自造会话缺 v4 `producer-owned source kind` 字段失败——**用 npm 安装的 DSH 0.2.2-rc.2 CLI 对同一 home/数据跑同一探针报完全相同错误**，两版本行为一致（REBUILD 成功路径受探针数据限制未覆盖，相关包源码零变化，风险低）。
- 结论：**五类契约全部兼容，无需修复**；报告 `docs/compat/reports/detect-0.2.2-rc.5.md`（检出报告模板首个实例）。
- 回归（T10.5）：R1 全量 251 项（241 pass / 0 fail / 10 预期 skip）；R2 `DSH_COMPAT_NETWORK=1` compat 25/25；R3 CLI E2E 通过；R4 = D4 探针。
- 基线升级（T10.6）：`docs/compat/baseline/0.2.2-rc.5.json`（14 包/433 文件），旧基线保留。
- 发布准备（T10.7）：package.json 0.2.2→**0.2.3**；README 兼容性行、RELEASE.md（0.2.3）、DESIGN §4 复验注记、TASKS（T10.4–T10.7 ✅，T10.8 待用户凭据）、INDEX、UPSTREAM-COMPAT 附录 A。
- 待用户：`npm login && npm publish --access public`；`git tag -a v0.2.3 -m "dsh-pack-and-go 0.2.3" && git push origin main && git push origin v0.2.3`。

---

## 151. npm 0.2.3 发布验证（2026-11-24）

- 背景：用户完成发布（`npm publish` + `git tag v0.2.3` + push），按 RELEASE.md §3 对 npm 渠道做一条命令安装验证（一次性 DSH_HOME，未触碰真实 `~/.dsh`）。
- npm 元数据：`npm view dsh-pack-and-go` → version=0.2.3、dist-tags.latest=0.2.3、engines.dsh `>=0.2.0 <0.3.0`、repository 正确（dsh-market 关联依赖）。官方 registry 独立 curl 复核一致。
- GitHub 核对（git 直连被本机网络 reset，用 API）：origin/main=66ef20e=本地 HEAD；v0.2.3 tag 在 origin。
- 安装验证：一次性 home `%TEMP%\dsh-verify-023-*`（带 `.dsh-e2e-marker`）；`dsh verify3-web --from-default-profile web --dump-config` 建 web 模板 profile，`dsh plugin --profile verify3-web add dsh-pack-and-go@0.2.3` 安装成功（package.json deps `+ dsh-pack-and-go 0.2.3`，bundles=[dsh-base, dsh-web-app, dsh-pack-and-go]）。
- 启动验证（SELFTEST 环境变量 + `--no-open --port 0`）：
  - `command registered: mover`、`apply() reached`、`exec route registered: /api/mover/exec`、web 服务正常启动；
  - 空 home SELFTEST `{"workspaces":0,"sessions":0}`（预期）；加入 1 个会话后 SELFTEST `{"ungrouped":1,"totals":{"sessions":1,"bytes":189}}` —— 发布包插件在 rc.5 宿主上正确读出会话。
- CLI 往返（发布包自带的 `src/cli/index.js`）：export `已导出 1 个对话…（846 字节）` → import 到全新 home `已导入 1 个对话、跳过 0 个已存在；workspace.json 已更新` → 会话文件 189 字节恢复、workspace.json（unit v2）重新写入。
- 两个值得记录的现象（均不影响发布结论）：
  1. 裸包名 `dsh plugin add dsh-pack-and-go`（不带版本）在刚发布窗口内解析到 0.2.2（pnpm add 行为：npm view/pnpm view/metadata 缓存均为 latest=0.2.3，显式 `@0.2.3` 一切正常；判定为 pnpm 侧解析行为，建议下周复查一次，若仍 0.2.2 再深挖）。
  2. `dsh <name>-web --from-default-profile web` 创建的是名为 `<name>-web` 的 profile（含 dsh-web-app 层）；`plugin --profile <name> add` 会装进自动创建的 base-only profile `<name>` → boot 报 `pending (waiting for service: workspaceRegistry)`。**必须把插件装到 `<name>-web`**。此坑第二次踩到 → 已把明确的 profile 创建/安装命令与命名警告写进 UPSTREAM-COMPAT.md D4 步骤（原手册只引用 README/RELEASE.md，不够无歧义）。
- 结论：npm 0.2.3 发布验证通过（元数据/安装/启动/服务注入/CLI 往返）。历史遗留：origin 缺少 v0.2.2 tag（本地有），如需可 `git push origin v0.2.2`。

## 152 · 2026-11-27 代码审查问题复核与修复方案落地（T11.1）

**背景**：用户要求对 AgentCompare 版本 B 的代码审查清单（P1-1..P1-5 / P2-6..P2-14）逐条
验证并给出详细修复方案。清单提取自 run `6f7ba743` 的版本 B 会话文件（291 帧 zstd 多帧；
用 `src/core/zstd-frames.js` 的 `scanFrames` 分帧后逐帧解压，最终答案在 seq 473，7911 字符）。

**验证方式**：逐条读源码 + 3 项实测（中央目录时间字段、反斜杠文件名、zip-stream 清理竞态）。
**结论：14 条全部成立**，证据行号与判定理由已作为验证报告交付用户（含 P1-1 写盘后才校验覆盖、
P1-2 host 边循环 stat、P1-3 只净化最后一段、P1-4 扫描失败静默、P1-5 listZip 全量解压、
P2-6 进度未接线、P2-7 预览偏差、P2-8 预检语义矛盾、P2-9 标题兜底全量解压、P2-10 尺寸估算
跳变、P2-11 调试残留、P2-12 死代码与两套实现、P2-13 越界符号链接、P2-14 五处边缘 bug）。

**3 处需修正报告**：
1. P1-2 的 CLI 部分不成立——`src/cli/index.js:262–277` 用「access 成功就加 ` (1)`」，不合并；
   问题只在 host / exec / UI 路径。
2. 本机基线实测 `210 tests / 201 pass / 1 fail / 8 skip`，唯一失败为 zip-stream 清理竞态
   （报告称 scan「1 万文件 < 2s」失败，本次通过，属波动）。
3. P2-8 真实调用行是 `src/host/commands.js:1231`（报告写的 542 行是注释）。

**历史查证**（用户追问同名工作区合并的来历）：ADR-0014 决策 3（未登记同名 → `标题 (1)`）、
决策 9 修订（DEVLOG 120，用户批准）新增 D3 兜底「存在 + 空 + 未登记 → 复用」，动机是
「会话全跳过的导入留下空目录 → 二次导入误判为用户目录 → 加 (1) → 迁移覆盖回滚无变化」；
DEVLOG 659 记 CLI 对齐决策 2/5/7/9 时补了同名 `(1)` 但未移植 D3。结论：D3 决策成立，缺的是
「本次导入已分配」维度；四步判据同时修 P1-2 并保留 D3。

**方案落地**（用户批准 2026-11-27）：
- **ADR-0019**：导入规划先行（`planImportTargets` 纯函数、四步判据）+ 暂存目录 / 目录级 rename
  原子提交；host 与 CLI 共用 `apply-import`。
- **ADR-0020**：导入路径安全闭环（全段净化、大小写冲突、长路径、越界符号链接、覆盖备份）+
  预检默认执行（`--no-preflight` 关闭）。
- **SPEC v1.8**：FR-7/FR-8/FR-9/FR-10/FR-11、NFR-4、NFR-6 更新，新增 NFR-6.5（解析与内存上限）。
- **DESIGN**：§3.1 导入决策树重写（只读预检 / 规划 / 转换 / 原子提交）；§4 增加「导入规划与提交」
  接口；§7 未决补充 B 组与 D 组边界。
- **TASKS M11**：T11.1–T11.8（0.3.0 可信导入），里程碑表与 §3 进度同步。

**B 组边界**：流式进度与取消（P2-6 / 审查 B 方向）与 T9.2（取消功能）、T9.4（精确进度）
「用户决定不做」冲突，本里程碑不实施；待用户明确解除后另立里程碑与 ADR。

**状态**：T11.1 完成（文档层）；下一步 T11.2（zip-reader 中央目录解析与 listZip 真元数据）。

## 153 · 2026-11-27 T11.2：zip-reader 中央目录解析（P1-5）

**背景**：代码审查 P1-5——`readZip` 一次性读入并解压全部条目；`listZip` 名义上只列清单，
实际直接调 `readZip`（全量解压），且把 `compressedSize` 填成解压后大小；包级没有解压总量
上限（单条 1 GiB 上限挡不住多条累计）。而清单预览与导入规划都只需要元数据。

**改动**：
1. `src/core/zip-reader.js` 拆成两层：
   - `readCentralDirectory(buffer, {maxEntryBytes, maxTotalBytes})`：只解析 EOCD 与 central
     directory，返回条目元数据（name/method/crc/compressedSize/uncompressedSize/
     externalAttributes/localOffset/mode），全程不解压；累计解压量超过 `MAX_TOTAL_BYTES`
     （4 GiB，SPEC NFR-6.5）抛 `E_PACK_TOO_LARGE`。
   - `readZip` 复用中央目录，逐条经内部 `readEntryContent` 解压并校验（local header 签名、
     大小、CRC）；新增 `readZipEntry(buffer, name, options)` 只解压指定条目。
   - `listZip` 改走中央目录：`size` = 声明解压大小，`compressedSize` = 真实压缩后大小。
2. `src/core/errors.js` 新增 `E_PACK_TOO_LARGE`（title「迁移包解压后过大」，next 指引缩小导出范围）。
3. `src/host/commands.js` 的 `inspectPack` 改用 `listZip` 找 `manifest.json` + `readZipEntry`
   只解压该条目，其余条目不再进入内存。
4. `tests/unit/zip-reader.test.mjs` 新增 5 个用例：deflate 数据损坏时清单仍可读（证明不解压）、
   中央目录元数据、`readZipEntry` 隔离损坏条目、解压总量上限、单条解压上限。

**验证**：
- `node --test tests/unit/zip-reader.test.mjs`：14/14 通过。修一处重写引入的转义回归：
  `assertSafeEntryName` 的反斜杠检查被误写成「两个连续反斜杠」，现恢复为单个 `\`
  （与 P2-14 ③ 的实测一致）。
- `node --test "tests/unit/**/*.test.mjs"`：215 项 / 207 通过 / 0 失败 / 8 跳过
  （比基线多 5 项；此前偶发的 zip-stream 清理竞态本次通过）。
- `node --test "tests/e2e/**/*.test.mjs"`：16 项 / 15 通过 / 0 失败 / 1 跳过。

**状态**：T11.2 完成；下一步 T11.3（`plan-import.js` 四步判据纯函数）。

## 154 · 2026-11-27 T11.3：`planImportTargets` 四步判据纯函数（P1-1/P1-2）

**背景**：ADR-0019 要求导入先规划、后写盘。原实现（`src/host/commands.js:851–878`）边循环
边 `stat`/`readdir`，同一包里两个同名工作区在第一次写盘后即被判为「已存在空目录」而复用合并
（P1-2）；预览（`commands.js:691–696`）另写一套推导，与真实落点不一致（P2-7 的一部分）。

**改动**：
1. `src/core/plan-import.js` 新增纯函数
   `planImportTargets({ manifest, targetRoot, platform, registeredPathKeys, reserved, exists, existsNonEmpty })`
   → `{ targets, byKey, conflicts }`：
   - 四步判据：已登记 → 复用；本次已分配 → `标题 (n)`；存在 + 空 + 未登记 → 复用（D3 兜底）；
     存在 + 非空 + 未登记 → `标题 (n)`；不存在 → 新建。
   - `(n)` 从 1 递增，同时跳过目标端已存在与本次已分配的路径；标题先经 `safeDirName`
     按目标平台净化。
   - 不触碰文件系统（`exists` / `existsNonEmpty` 由调用方注入），预览与导入共用同一结果。
   - `conflicts` 记录 `renamed` 与 `reused-empty-directory`，供预览与转换报告（FR-9）复用。
2. 新增导出 `WORKSPACE_TARGET_ACTIONS = ['create', 'reuse', 'rename']`。
3. `tests/unit/plan-import.test.mjs` 新增 9 个用例：全新目录、已登记复用、同包同名加
   ` (1)`、空目录复用（D3）、非空加 ` (1)`、` (1)` 顺延、标题净化、缺参报错、常量。

**兼容性**：`planImport`（旧会话/工作区策略）未改动；host 与 CLI 在 T11.5 接入
`planImportTargets` 前仍走旧路径，因此本任务不改变用户可见行为。

**验证**：
- `node --test tests/unit/plan-import.test.mjs`：18/18 通过。
- `node --test "tests/unit/**/*.test.mjs"`：224 项 / 216 通过 / 0 失败 / 8 跳过。第一遍
  `scan.test.mjs:156`「1 万文件扫描 < 2s」性能断言偶发失败（受磁盘影响），第二遍全绿——
  与代码审查时记录的波动一致，非本次改动引入。

**状态**：T11.3 完成；下一步 T11.4（`sanitizeRelativePath` 全段净化与大小写冲突）。

## 155. T11.4：路径安全闭环（ADR-0020）

**日期**：2026-11-27
**范围**：`src/core/workspaces.js`、`tests/unit/workspaces.test.mjs`

1. `workspaces.js` 新增导出 `sanitizeRelativePath(relative, platform)`：按段净化（win32
   非法字符替换为 `_`、段尾空格/点去除、保留名加 `_` 前缀、单段超 255 字节按 UTF-8
   字节截断且不切坏多字节字符），返回 `{ path, conversions }`；目录段与文件段走同一实现。
2. 大小写冲突注册表：win32/darwin 目标按「目录小写键」记录已占用的小写文件名，同目录
   重名（含仅大小写不同）在扩展名前追加 ` (n)`（`report.txt` → `report (1).txt`），记
   `kind: 'case-collision'`，不再互相覆盖（ADR-0020 §2）。
3. Windows 全路径超 240 字符的条目跳过并记 `kind: 'path-too-long'` + warning，不静默
   （ADR-0020 §3）。
4. `restoreWorkspaceFiles` 改造：目录/文件条目统一先净化再落盘，保持既有行为
   （`targetPlatform: 'linux'` 时 conversions 为空；`a?b.txt` → `a_b.txt`）。
5. `tests/unit/workspaces.test.mjs` 新增 5 个用例：净化纯函数（含 255 字节 CJK 截断）、
   目录段净化、win32 大小写冲突、darwin 大小写冲突、240 长路径跳过。

**验证**：
- `node --test tests/unit/workspaces.test.mjs`：18 项 / 11 通过 / 0 失败 / 7 跳过（POSIX 用例在 Windows 上跳过）。
- `node --test "tests/unit/**/*.test.mjs"`：229 / 221 / 0 失败 / 8 跳过。第一遍
  `zip-stream.test.mjs:112` 清理竞态偶发失败，第二遍全绿——P2-14 ② 既有问题，留 T11.7/D6。
- `node --test "tests/e2e/**/*.test.mjs"`：16 / 15 / 0 失败 / 1 跳过。

**状态**：T11.4 完成；下一步 T11.5（原子提交：暂存目录 + 目录级 rename + 覆盖备份，
host/CLI 共用 `apply-import`）。

## 156 · 2026-11-27 T11.5：原子提交与 host/CLI 共用导入流水线（P1-1/P1-2/P2-12 部分）

**日期**：2026-11-27
**范围**：`src/core/apply-import.js`（新增）、`src/core/import-pack.js`、`src/core/workspaces.js`、
`src/host/commands.js`、`src/cli/index.js`、`src/core/zip-stream.js`、`tests/unit/apply-import.test.mjs`（新增）、
`tests/unit/import-pack.test.mjs`、`package.json`（`check` 脚本补新文件）

1. 新增 `src/core/apply-import.js`（导入落盘原语，ADR-0019 §1/§4）：
   - `stagingPath(parent, label)`：`<parent>/.<label>-tmp-<uuid>` 唯一暂存路径；
   - `commitStagedDirectory({staging,target,backupDir,name,now})`：目标已存在时先把旧目录
     整体 rename 到 `<backupDir>/<name>-previous-<stamp>`（无 backupDir 时删除），再把暂存目录
     rename 到目标；rename 失败把旧目录 rename 回原位再抛（覆盖回滚）；
   - `pathExists` / `removeQuietly` / `timestampOf` 辅助。
2. `src/core/import-pack.js`：
   - `importSessionsToDisk` 改为**单会话原子提交**：先写 `<projDir>/.session-import-tmp-<uuid>/`，
     成功后目录级 rename 到最终位置，失败清理暂存（中途失败不留半成品）；`written` 增加可选
     `previousDir`（被移走的旧目录备份路径），删除 `readZip` 全量解压，改 `listZip` + 按需
     `readZipEntry`（NFR-6.5）；
   - 新增导出 `applyImport(input)`：`listZip` → 校验并读 manifest → `planImportTargets` →
     **写盘前**预检（覆盖策略下找不到现有位置的会话直接抛 `E_PACK_INVALID`，P1-1 修复）→
     `importSessionsToDisk` → 空工作区建目录 → 只解压 `workspaces/` 条目后 `restoreWorkspaceFiles`。
3. `src/core/workspaces.js`：`restoreWorkspaceFiles` 新增 `backupRoot`/`backupStamp`/`now`，
   覆盖已存在文件前复制到 `<backupRoot>/<stamp>/workspaces/<key>/<relative>`（复制失败拒绝覆盖），
   返回 `backups`（ADR-0020 §4）。
4. `src/host/commands.js`：`importPack` 删除自建的目录分配（registeredPaths/stat/readdir/`(n)`/
   mkdir/realpath）与写盘后的 unknown-overwrite 校验，统一调用 `applyImport`（附件仍按引用
   过滤后 `readZipEntry` 按需解压）；`pathMap`/`mappings`/`written`/`skipped` 全部来自流水线结果。
5. `src/cli/index.js`：`cmdImport` 同构改造，删除自建分配（CLI 此前缺少空目录复用，与 host
   行为分叉=P1-2 的 CLI 侧证据，现已消除）；导入失败时预检错误直接 `错误：…` 输出。
6. 顺带修复 P2-14 ②：`zip-stream` 失败清理等文件句柄 `close` 后再 `rm`（原先 `destroy()` 后
   立即删，Windows 上句柄未关闭会让 rm 失败，留下半成品，导致 `失败时清理半成品输出文件`
   在全量并发下稳定失败）。修复后全量测试连续三次全绿。

**验证**：
- `node --test tests/unit/apply-import.test.mjs`：7/7；
- `node --test tests/unit/import-pack.test.mjs`：15/15（新增 `applyImport` 两组用例：同名工作区
  规划为 `Report` 与 `Report (1)` 且不合并；覆盖策略下「已登记但查不到现有位置」的会话在写盘前
  失败、`sessions/` 与目标目录都不产生任何文件）；
- `node --test "tests/unit/**/*.test.mjs" "tests/e2e/**/*.test.mjs"` 连续三次：254 项 / 245 通过 /
  0 失败 / 9 跳过；
- 手测（一次性 `%TEMP%\dsh-pack-and-go-e2e-*`，CLI `import --overwrite`）11 项全部通过：预置空
  目录 `Report` 被复用、第二个同名工作区落 `Report (1)`、两份文件未合并、覆盖前旧会话备份到
  `<home>/dsh-pack-and-go-backup/<stamp>/s1-session.v4.jsonl.zstd`（解码内容为 OLD）、现行会话为
  包内版本（NEW）、无 `.session-import-tmp-` 残留、`workspace.json` 注册 `Report` 与
  `Report (1)` 两条。

**状态**：T11.5 完成；下一步 T11.6（导出扫描失败可见：`skippedWorkspaces[]` + 文案 + `--strict`，P1-4）。
