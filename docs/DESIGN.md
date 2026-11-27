# 技术设计

> 状态：**骨架**（规格 v1.0 已冻结；实现前补全并随代码更新）。
> 需求见 [SPEC.md](SPEC.md)，决策见 [DECISIONS.md](DECISIONS.md)。

## 1. 形态与边界

- **形态**：DSH Cordis bundle（Host + Client），安装到目标 DSH profile。
- **Host**（Node，DSH 进程内）：文件搬运、zstd 帧改写、平台预检、与 DSH 服务对接、进度流。
- **Client**（浏览器 React 组件）：选择树、导出/导入流程、进度、错误态。
- **CLI**（阶段待定，ADR-0004）：与 UI 共用 core，不依赖 Cordis / 浏览器 API。
- **不做**：云同步、网络传输、凭据搬运、自动重启 DSH。

## 2. 模块划分（规划，实现时更新）

```
src/
  core/           # 纯 Node：包格式、manifest、校验、平台预检、路径映射
  core/zstd/      # 帧扫描、首帧解码、重压缩、拼接、自校验
  core/workdir/   # 工作区扫描、排除规则、跨平台转换、报告
  host/           # Cordis 插件：服务、任务编排、Remote 进度流、DSH 服务适配
  client/         # Web UI：页面、选择树、流程状态机
  cli/            # 待定（ADR-0004）
tests/
  unit/           # core 单元测试
  e2e/            # 一次性 DSH_HOME 下的端到端
```

## 3. 数据流

**导出**：读取工作区/会话（DSH 服务）→ 用户选择 → 扫描 + 平台预检 → 流式写包 → 校验 → 完成。

**导入**：读包 → 校验 manifest/版本 → 平台预检与转换 → 冲突处理 → 写会话（含 header cwd 与 `working-directory/change` 状态事件 cwd 改写，ADR-0017）→ 复制附件 → 恢复工作区文件 → 登记工作区 → 完成。

## 3.1 导入行为决策树（强制指定目录模式，2026-11-11）

> 与 `IMPORT-BEHAVIOR-TREE.md` 保持同步；此处为技术文档版本。

```
开始导入
├─ 输入校验（v1.8）
│  ├─ 包路径为空 / 目标目录为空 → 红字报错，不启动
│  ├─ 包不存在 / 非 zip / manifest 非法 → 红字报错
│  └─ 结构校验通过
├─ 只读预检（不解压条目内容）
│  ├─ listZip 读中央目录 → 条目清单、压缩/解压大小、格式版本
│  ├─ 解压总大小 > 4 GiB → E_PACK_TOO_LARGE（中止，不写盘）
│  └─ schemaVersion / 会话格式 / 源平台 校验失败 → 中文报错
├─ 目标目录（v1.8）
│  ├─ 不存在 → 自动创建（递归）
│  ├─ 不可写 / 是文件 → 写入失败 → 红字（不回退）
│  └─ = 包内工作区源路径 → 工作区按路径复用（原地）
├─ 导入规划（planImportTargets，纯函数无 I/O；ADR-0019 §2）
│  ├─ 工作区落点四步判据
│  │  ├─ ① 包内路径已在目标端登记 → 复用（不重复登记、不合并文件）
│  │  ├─ ② 同一导入内已分配过该路径 → <标题> (n)
│  │  ├─ ③ 存在 + 空 + 未登记 → 复用（ADR-0014 决策 9 D3 兜底）
│  │  └─ ④ 存在 + 非空 + 未登记 → <标题> (n)
│  ├─ 会话冲突：同 id 已存在 → 跳过 / 覆盖（含迁移覆盖，ADR-0013）
│  ├─ 转换（ADR-0020）：逐段净化、大小写冲突、长路径、越界链接 → conversions[]
│  └─ 全部 fatal 预检通过后才允许写盘
├─ 文件系统转换（ADR-0020）
│  ├─ sanitizeRelativePath：路径每一段净化（含目录段）
│  ├─ 大小写冲突：同目录 Map<小写名, 实际名>，后续加 (n)，记 case-collision
│  ├─ 路径过长（Windows > 240 字符）→ 跳过 + path-too-long（报告）
│  ├─ 符号链接：导出侧越界记 symlink-outside 不打包；导入侧按 ADR-0013 解引用
│  └─ 覆盖前备份工作区文件到 <DSH_HOME>/dsh-pack-and-go-backup/<时间戳>/workspaces/
├─ 会话恢复（按规划）
│  ├─ 无同 id → 写入暂存目录
│  ├─ 同 id + 跳过 → 不写（旧会话保留）
│  └─ 同 id + 覆盖
│     ├─ 目标目录 = 现有 cwd → 原地覆盖（先备份）
│     └─ 目标目录 ≠ 现有 cwd → 迁移覆盖（备份旧位置 → 写新位置 → 提示）
├─ 附件（跟随会话策略）
│  ├─ 正常 → 写回 <DSH_HOME>/attachments/v1
│  ├─ 已存在 → 覆盖写；EPERM → warning 不阻断
│  └─ 会话引用但包内缺失 → warning
├─ 文件/目录权限（ADR-0016 B1+B2，不变）
│  ├─ POSIX 目标 + POSIX 源 → 文件按 mode 恢复；目录两阶段（先建后收紧，深→浅）
│  ├─ win32 源包 → 文件仅恢复 exec 位；目录跳过（Windows mode 是 libuv 合成值）
│  └─ Windows 目标 → 忽略（ADR-0003）
├─ 原子提交（v1.8，ADR-0019 §3）
│  ├─ 会话：<home>/sessions/<projKey>/.staging-<uuid>/<id>/ → rename 为 <id>/
│  ├─ 工作区：<target>.import-tmp-<uuid>/ → rename 为 <target>/
│  └─ 任一失败 → 删除全部暂存 + 回滚已覆盖文件 → 报错（无半成品）
├─ 登记与归组
│  ├─ 登记成功 → attach 会话
│  ├─ cwd 与工作区 path 不匹配 → attach 失败（日志），会话可能进未分组
│  └─ 激活失败（resolveAgent）→ 日志，不阻断
└─ 结果
   ├─ 全部成功 → 绿字（已导入/覆盖/迁移/跳过、附件数、工作区映射、转换数）
   ├─ 部分警告 → 绿字 + 警告数（含 skippedWorkspaces）
   └─ 失败 → 红字（原因 + 影响 + 下一步；已无半成品）
```

## 3.2 导出行为决策树（当前实现，2026-11-11）

```
开始导出
├─ 导出模式（ADR-0015）
│  ├─ 对话 + 工作区（默认）：以会话为入口，工作区文件随所选会话附带
│  └─ 仅工作区：`mode='workspaces'`、`sessions=[]`，写文件内容 + 目录结构（空文件夹保留骨架，`fileCount: 0`）
├─ 输入校验
│  ├─ 未选择任何对话/工作区 → 按钮禁用 + 提示
│  ├─ 目标路径为空 → 红字「请填写保存位置」
│  └─ 通过
├─ 会话集合
│  ├─ 指定了会话 id → 只导出这些
│  ├─ 未指定 → 导出全部可见会话
│  └─ 默认连带 fork 链（祖先 + 子代理后代）；--no-fork 关闭
├─ 目标解析
│  ├─ 目标是目录 → <目录>/<包名或 dsh-pack-and-go-时间戳>.dshpack；同名已存在 → 自动加序号
│  ├─ 目标是文件 → 原样使用
│  └─ 父目录不存在 → 红字报错
├─ 工作区文件（勾选「将工作区一并导出」）
│  ├─ 按会话 cwd 去重扫描
│  ├─ 默认排除 node_modules/.git 等；「全量打包」不排除；额外排除目录叠加
│  ├─ 预检（默认执行，ADR-0012）→ 跨平台风险统计，附在结果文本
│  └─ 扫描失败/不可读 → 跳过该工作区并记录
├─ 附件（勾选「包含附件」）
│  ├─ 从会话事件提取附件引用（去重）
│  ├─ 缺失附件 → 日志跳过，不阻断
│  └─ 写入包内 attachments/v1（file-objects + files）
├─ 打包
│  ├─ 内存/流式由大小决定；默认压缩（deflate），--no-compress 仅 CLI
│  ├─ manifest 校验（sessions/workspaces/attachments/fork 链）
│  └─ 写包失败 → 清理半成品文件 + 红字
└─ 结果
   └─ 绿字：「已导出 N 个对话[，含 M 个工作区（K 个文件）]到 <路径>（B 字节）[；预检 R 项]」
```

## 4. 关键接口（已用 `cordis_inspect_query` 核实，2026-11-10，DSH 0.2.2-rc.1；2026-11-23 在 DSH 0.2.2-rc.5 上复验通过，见 `docs/compat/reports/detect-0.2.2-rc.5.md`）

> 来源：当前 Host 的 `Service.listService`（host）。实现时仍须在目标 Host 上以运行时
> `ctx.get()` 校验；不同 DSH 版本可能有差异，不使用未在本文列出的方法。

### sessionPersistence（会话持久化）

- `create(header, options?)` → `SessionHandle`（取得写所有权；id 已存在抛 `SessionAlreadyExistsError`）
- `open(id, 'read'|'write', options?)` → `SessionHandle`（写被占用抛 `SessionAlreadyOwnedError`）
- `stat(id, options?)` → `{ header, formatStatus?, revision, eventCount?, sizeBytes?, location? } | undefined`
- `list(options?)` → `SessionPersistenceSnapshot[]`
- `SessionHandle`：`read(offset?, length?)` → `{ events, eventState }`；`append(events)`；`flush()`；`close()`

### workspaceRegistry（工作区）

- `create(path, title?)` → `Workspace`（path 必须存在，经 `fs.realpath` 规范化；重复创建返回已有且不改标题）
- `list()` → `Workspace[]`（durable 顺序；`sessionIds` 已按 canonical cwd 过滤）
- `get(id)`、`resolveByPath(path)`、`delete(id)`
- `Workspace`：`{ id, path, title, createdAt, updatedAt, sessionIds, setTitle, attachSession, insertSessionBefore, detachSession, status }`
- 归档/置顶：`archiveSession` / `unarchiveSession` / `pinSession` / `unpinSession`

### attachments（附件）

- `saveFile(input)`、`saveFileStream(input)`、`readFileStream(ref)`、`fileHostPath(ref)`
- `readImage(ref)`、`imageHostPath(ref)`
- 对象位于 `<DSH_HOME>/attachments/v1`（内容寻址，同内容只存一份）

### 路径来源约定

- 会话文件绝对路径：`snapshot.location.path`（**不要**硬编码 `DSH_HOME/sessions`）
- 会话 cwd：`snapshot.header.cwd`
- 工作区路径：`Workspace.path`（canonical）
- 附件根：attachment 服务 / `DSH_HOME` 配置

### UI→Host 通信（ADR-0008）

- 纯 JS 插件不使用 Typert `@Remote`（它需要 TS 源码分析与 Client 契约生成）。
- Host 用 `ctx.commands.register` 注册 `mover` 命令（导出/导入）。
- Client 通过已有的 `ctx.remote.commands.execute()` 调用；等待期显示“转圈 + 阶段文案”。
- `src/core/progress.js` 的帧协议保留给未来的流式方案 A；当前命令返回一次性文本结果。

### Client UI 落点

- `sidebar.panellist` + `main`（key `mover`）+ `settings.section` 兜底

### 进度协议（T2.3；v1.9 改为任务注册表 + 轮询，ADR-0021）

帧结构不变（`src/core/progress.js` 构造与校验）；v1.9 起由 Host 任务注册表持有帧序列，
客户端通过 `task.poll` 增量读取（500 ms 轮询，首帧 ≤300 ms）。帧 JSON：

```json
{
  "taskId": "export-<uuid>",
  "stage": "scan|preflight|pack-sessions|pack-workspaces|verify|restore-sessions|restore-attachments|restore-workspaces|register|done",
  "status": "running|success|error|cancelled",
  "done": 3,
  "total": 10,
  "bytesDone": 1024,
  "bytesTotal": 4096,
  "message": "正在扫描",
  "error": { "code": "E_PACK_INVALID", "title": "…", "next": "…", "message": "…" }
}
```

- 校验与构造：`src/core/progress.js` 的 `createProgressEvent()`；百分比用 `progressPercent()`（`success` 恒为 100）。
- 错误帧携带 `describeError()` 的结果，Client 直接展示中文，不再二次翻译。

### 导入规划与提交（ADR-0019 / ADR-0020，v1.8）

- `planImportTargets({ manifest, targetRoot, platform, registeredPathKeys, exists, existsNonEmpty })`
  ——**纯函数，无 I/O**；返回 `{ targets: [{ workspaceKey, title, path, action, reason, conversions }], conflicts, conversions }`。
  四步判据见 ADR-0019 §2；`exists`/`existsNonEmpty` 由调用方注入（host 用 fs，单测用内存表）。
- `applyImport({ plan, pack, home, backupRoot })`——暂存写入 + 目录级 rename 提交；失败删除暂存并按
  `createBackupTransaction` 回滚已覆盖文件。**host 命令与 CLI 共用本函数**（不再各自一套实现）。
- `sanitizeRelativePath(relative, platform)`——逐段净化，返回 `{ path, conversions[] }`；
  大小写冲突在同一目录内用 `Map<小写名, 实际名>` 处理；`detectCaseCollisions` 保留用于导出预检。
- zip 读取：`readCentralDirectory(buffer)` 只解析中央目录（不解压）；`listZip` 用它给出条目清单
  与压缩/解压大小；`readZip` 复用中央目录结果再解压。`maxTotalBytes` 默认 4 GiB，超出抛
  `E_PACK_TOO_LARGE`。

### 长任务注册表（ADR-0021，v1.9）

- `src/host/task-registry.js`：`createTaskRegistry({ ttlMs = 30 * 60_000, now })()` 返回
  `{ start, poll, cancel, list, dispose }`；进程内存态，DSH 重启即丢失（客户端提示重新发起）。
- `start({ kind: 'export'|'import', title, run })` → `{ taskId }`；`run({ onProgress, signal })`
  在后台执行，`onProgress` 写的帧追加到该任务。
- `poll(taskId, cursor)` → `{ status, frames, nextCursor, result?, error? }`；游标单调，重复 poll 幂等。
- `cancel(taskId)` → `{ cancelled }`；置 `cancelled` 并 `abort()`，命令层在检查点抛
  `MoverError(ERROR_CODES.TASK_CANCELLED)`（已原子提交的单元保留）。
- exec 路由：`task.start` / `task.poll` / `task.cancel`（同一 `/api/mover/exec` 入口，ADR-0011）。
  预计 >2 s 的 `export`/`import` 走任务通道；短操作（`list/find/size/inspect`）仍同步。

## 4.1 会话日志改写策略（ADR-0007 / ADR-0017）

- **header 改写**：只解压首帧、改 `cwd`/`id`/`parentSession`，其余帧字节原样拼接；
- **状态事件改写**：仅跨平台导入且 `targetCwd` 存在时启用；首帧保持原样，只解压事件帧，仅改 `working-directory/change` 的 `data.cwd`，按行边界重压（默认 1 MB/帧，checksum 跟随原帧）；
- **触发条件**：`manifest.source.platform !== targetPlatform`；同平台保持 ADR-0007 方案 A 的字节保真；
- **映射**：源根下 → 目标根 + 相对路径（分隔符转目标平台，win32 忽略大小写）；源根外/源根缺失 → 目标根；
- **已知边界**：包内会话无 `workspaceKey`（无 `targetCwd`）时不改写，跨平台仍可能打不开（见 SPEC §9）。

## 5. 包格式

见 SPEC §8（`.dshpack` v2）。实现时需要补充：

- zip 容器的写入/读取方案（不新增依赖）；
- 校验和策略（包级默认；逐文件为可选“严格模式”）；
- 大文件与大量小文件的流式读写与内存上限。

## 6. 风险与缓解

见 SPEC §9 风险表。实现时在 DEVLOG 记录每次实测结果。

## 7. 未决

- CLI 入口阶段与命名（ADR-0004，已实现，保留作历史）。
- UI 进度协议细节（帧结构、节流频率）：v1.9 已定（ADR-0021，500 ms 轮询），保留作历史。
- zstd 帧扫描在损坏帧上的错误恢复边界。
- 流式进度与取消：~~与 T9.2/T9.4「用户决定不做」冲突，待用户解除后另立 ADR~~ → 已由 ADR-0021 落地（任务注册表 + 轮询）。
- D 组流式解压（1 GB 包峰值内存 ≤300 MB）待 0.4 评估；本版只做中央目录预检与总量上限。
