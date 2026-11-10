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

**导入**：读包 → 校验 manifest/版本 → 平台预检与转换 → 冲突处理 → 写会话（含 cwd 改写）→ 复制附件 → 恢复工作区文件 → 登记工作区 → 完成。

## 4. 关键接口（已用 `cordis_inspect_query` 核实，2026-11-10，DSH 0.2.2-rc.1）

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

### 进度协议（T2.3）

Host 通过流式 Remote 推送单帧 JSON：

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

## 5. 包格式

见 SPEC §8（`.dshpack` v2）。实现时需要补充：

- zip 容器的写入/读取方案（不新增依赖）；
- 校验和策略（包级默认；逐文件为可选“严格模式”）；
- 大文件与大量小文件的流式读写与内存上限。

## 6. 风险与缓解

见 SPEC §9 风险表。实现时在 DEVLOG 记录每次实测结果。

## 7. 未决

- CLI 入口阶段与命名（ADR-0004）。
- UI 进度协议细节（帧结构、节流频率）。
- zstd 帧扫描在损坏帧上的错误恢复边界。
