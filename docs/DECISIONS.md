# 决策记录（ADR）

> 只追加，不改写历史。条目编号递增；被替代时在标题标注 `Superseded by ADR-XXXX` 并保留原文。
> 格式：背景 / 选项 / 决定 / 后果 / 关联。
> 需求变更必须先有新 ADR；包格式变更同样适用。

## ADR-0001 · 平台支持矩阵与迁移方向（2026-11-10，Accepted）

**背景**：需求方要求“所有平台上的 DSH 之间”迁移。DSH Host 可运行在 Windows / macOS / Linux，插件运行在 Host 侧，数据在 Host 文件系统上。

**选项**
- A. 只支持三大桌面平台；
- B. 三平台为一级，WSL2 / Termux 为二级（尽力支持 + 限制说明）；
- C. 追加更多平台并逐一验证。

**决定**：B。一级：Windows 10/11（x64/arm64）、macOS 12+（Intel/Apple Silicon）、Linux x64/arm64；二级：WSL2、Termux/Android。迁移方向双向：Windows↔POSIX、macOS↔Linux、同平台不同安装形态。

**后果**
- 平台差异必须显式建模：路径、文件名合法性、大小写、权限位、符号链接、路径长度；
- 二级平台的问题以“限制说明 + 转换报告”处理，不作为首发阻塞；
- 无本地 `DSH_HOME` 的纯远端托管不在支持范围。

**关联**：SPEC §4、§FR-9。

## ADR-0002 · 选择模型：工作区 → 对话树（2026-11-10，Accepted）

**背景**：早期设计用“四种模式卡片”（仅对话 / 多对话 / 对话+工作区 / 仅工作区）作为第一步。需求方提出改为更贴合 DSH 原生的多级目录选择。

**选项**
- A. 保留四模式卡片；
- B. 工作区（一级）→ 对话（二级）树 + 一个全局“含项目文件”开关；
- C. 模式卡片作为捷径 + 树。

**决定**：B。勾工作区默认全选其下未归档对话；未归入任何工作区的对话进虚拟分组；文件开关全局唯一；工作区行悬停提供「只带文件」。

**后果**
- 去掉一层抽象选择，避免“模式”与后续勾选不一致；
- 需要实现“部分选中”“仅文件”两种特殊状态；
- 四种范围能力保留，只是不再显式呈现为模式卡片。

**关联**：SPEC §FR-2、§FR-4、NFR-1.5。

## ADR-0003 · 符号链接与权限位（2026-11-10，Accepted）

**背景**：工作区跨平台打包必须决定 POSIX 符号链接与 exec 位如何表示和恢复。

**选项**
- A. 链接默认解引用；POSIX exec 位在 POSIX 目标保留、Windows 忽略；
- B. 链接默认跳过（更小、更安全）；
- C. 链接默认保留（Windows 目标可能失败）。

**决定**：A。

**后果**
- 解引用可能增大包体积，需在转换报告中记录；
- Windows 目标丢失 exec 位属预期行为，不告警；
- “跳过链接 / 保留链接”保留为高级选项，默认不暴露。

**关联**：SPEC §FR-9、NFR-1.5。

## ADR-0004 · CLI 入口（2026-11-10，Accepted，阶段待定）

**背景**：无 GUI 的 DSH（纯 CLI/TUI，或服务器环境）同样需要迁移能力；需求方确认“提供 CLI 入口”。

**选项**
- A. 第二阶段提供 `dsh mover export/import` 子命令；
- B. 只做 Web UI；
- C. 第一版 CLI + UI 双入口。

**决定**：提供 CLI 入口，与 UI 共用同一包格式与 core；实现阶段待定（推荐第二阶段，不阻塞 Web UI 首发）。

**后果**
- core 必须与入口解耦，不依赖 Cordis UI 或浏览器 API；
- 若第一阶段即做，会推迟 Web UI 首发，需在开工前确认排期。

**关联**：SPEC §13、`docs/INDEX.md` 未决项。

## ADR-0005 · 会话头 cwd 改写（2026-11-10，Accepted）

**背景**：会话 header 的 `cwd` 由宿主平台的 `node:path.isAbsolute` 校验；Windows 路径在 POSIX 上不是绝对路径，会话会被判为非法 header。DSH 已提交的 generation 不可改写。

**选项**
- A. 只改写 header 的 `cwd`（写新 generation 文件）；
- B. 同时改写事件中出现的旧路径（风险高）；
- C. 不改，要求目标平台保持相同路径。

**决定**：A。

**后果**
- 跨平台会话可以打开并正确归组；
- 历史消息中的旧路径文本保持原样（只影响显示，不影响继续对话）；
- 需要实现 zstd 帧级编辑，并在写回后自校验（解回校验 header 与行数）。

**关联**：SPEC §FR-8、§9 风险表。

## ADR-0006 · 导入冲突与默认值（2026-11-10，Accepted）

**背景**：导入需要一组默认策略，避免让 0 技术背景用户做选择题。

**决定**
- 会话同 id 默认“跳过”；覆盖需显式选择，且先备份到 `<DSH_HOME>/backups/mover/<时间戳>/`；
- 工作区同路径默认“合并”；
- 附件按会话事件引用复制，不复制无关对象；
- 工作区默认保留 `.git`，排除 `node_modules`、`.venv`、`__pycache__`、`dist`、`build` 等可再生目录；
- 包为单文件 `.dshpack`（zip 容器，可被普通解压工具打开）；
- Agent 工具接口作为可选项，不阻塞首发。

**后果**
- 导入默认零参数可完成；
- 覆盖路径必须实现备份与回滚；
- 排除规则必须在导出前可见（估算体积），但默认值不暴露为参数。

**关联**：SPEC §FR-9、§FR-10、§FR-13、NFR-1.5。

## ADR-0007 · 会话日志改写策略（2026-11-10，Accepted，用户拍板）

**背景**：跨平台导入必须改写会话 header 的 `cwd`；DSH 日志是**多帧 zstd**（实测真实文件 851 帧、解压 4.89 MB），而 Node 单次解码只返回首帧，必须自行扫描帧边界。

**选项**
- A. 只重写首帧：扫描帧边界 → 解首帧 → 改 `cwd` → 重压首帧 → 其余帧原字节拼接；
- B. 全量解压后整体重压缩；
- C. `sessionPersistence.open(id, 'read')` 读逻辑事件 + `create(header)`/`append(events)` 由官方后端重建。

**决定**（2026-11-10 用户确认）：**A 作为主路径**（同版本迁移，快且保真）；**C 作为跨版本兜底**（在 M2 用 Host 服务实现）；**B 不采用**。

**后果**
- 同版本（v4→v4）：core 纯 Node 完成首帧改写，不依赖 DSH 服务；其余帧字节级保真。
- 跨版本（如源 v3）：core 拒绝改写，由 Host 走 C（`open` 触发历史格式迁移 + `create`/`append`）。
- 需要实现帧扫描与首帧校验；T1.5/T1.6 按 A 实现。
- 新增任务 T2.12（跨版本导入走服务重建），列入 M2。

**关联**：SPEC §FR-8、§9；TASKS T1.5/T1.6/T2.12；DEVLOG 013/014。

## ADR-0008 · UI→Host 通信方式（2026-11-10，Accepted，用户拍板）

**背景**：`@Remote` 是 Typert 装饰器，Client 契约由构建生成；纯 JS 插件无法直接通过 `ctx.remote` 暴露方法。T2.11 原计划因此不成立。

**选项**
- A. 自定义 HTTP 路由（`WebResourceRoute`）+ Client `fetch`，支持流式进度与取消；
- B. session command（`ctx.commands.register`），复用已有的 `commands` Remote；UI 等待期间显示“转圈 + 阶段文案”；
- C. 引入 Typert TS 构建链，使用原生 `ctx.remote`。

**决定**：**B 变体**。用 `ctx.commands.register` 注册 `mover` 命令；UI 在等待期间显示不确定进度（转圈）与阶段文案，完成后显示文本结果。保留纯 JS，不引入构建链。

**后果**
- 不提供精确百分比（用户已明确接受）；命令参数为文本形式；
- 不引入 HTTP 路由的信任模型风险，也不改变工程结构；
- 若未来确需精确进度，可新增 ADR 升级为方案 A；
- SPEC NFR-3 的“进度条 + 阶段文字”由“不确定进度 + 阶段文案”满足。

**关联**：TASKS T2.11、T3.4/T3.5；DEVLOG 042/043。

## ADR-0009 · CLI 入口形态（2026-11-10，Accepted，用户拍板）

**背景**：ADR-0004 确认“提供 CLI 入口，阶段待定”；用户于 2026-11-10 确认启动 M6。无 GUI 的 DSH（服务器/终端）需要迁移能力。

**选项**
- A. 独立 bin `dsh-mover`（`package.json` `bin`），纯文件访问 `DSH_HOME`；
- B. 作为 `dsh` 子命令（需要侵入 dsh CLI 或 profile 注册）；
- C. 复用 Host 命令（需要 DSH 运行中，无法离线使用）。

**决定**：A。独立 `dsh-mover` bin：
- `dsh-mover export --home <DSH_HOME> --out <文件> [--sessions id...]`
- `dsh-mover import --home <DSH_HOME> --pack <文件> [--target <目录>]`
- 与 UI 共用 core 与 `.dshpack` 格式；导入后写会话/附件/工作区文件，并更新 `workspace.json`（写前备份）。

**后果**
- CLI 不依赖 DSH 进程，可用于服务器导出；
- 导入后需重启 DSH 才能看到新会话（无服务刷新）；
- 工作区登记通过直接更新 `workspace.json`，与运行中的 DSH 并发需用户避免同时操作。

**关联**：ADR-0004、TASKS M6、`src/cli/index.js`。

## ADR-0010 · 导入文件选择器：Exact Fetch 上传通道（2026-11-10，Proposed，待用户批准）

**背景**：DSH 无文件选择服务（Host 无 `directory-picker` 可查询服务；Client 只有
`uiWorkspace.pickDirectory`）。用户要求「在文件选择器里直接选 `.dshpack`」，否决“选目录 + 扫描”。

**方案**：使用官方 **Exact Fetch 路由** 注册上传端点（api-gateway 明确推荐此方式承载 RPC 信封之外的响应）：

```js
ctx.connection.fetch.register({
  path: '/api/mover/upload',
  methods: ['POST'],
  requestBody: 'streaming',
  fetch: (request) => uploadHandler(request),
})
```

- 该通道由 Connection 的共享 Fetch handler 服务，**复用 Host/Origin 检查与浏览器认证**
  （`ConnectionFetchHandler`："Fetch handler for trusted, authenticated requests"），无需复刻信任逻辑；
- 请求体流式写盘到 `<DSH_HOME>/tmp/mover-uploads/<uuid>.dshpack`（上限 2 GiB，仅接受 `.dshpack` 后缀）；
- 返回 `{ path }`；Client 用 `<input type="file" accept=".dshpack">` 选择后 `fetch` 上传，
  成功即把 `path` 填入导入框，删除上传按钮只在文件选择可用时显示；
- 导入成功/失败后删除上传的临时文件；启动时清理 24 小时前的残留。

**前提**：`ctx.get('connection')` 可用且 `fetch.register` 存在（Web profile 默认满足）；
缺失时隐藏「选择文件」按钮并保留文本输入。

**替代方案**：B 复用命令附件（`submittedAttachments` file receipt）——需要额外研究附件 upload
协议，未采用；C 保留目录扫描——用户已否决。

**风险与缓解**
- 上传文件占磁盘：上限 + 24h 清理；
- 路由暴露：仅经 Connection 认证的请求可达；路径随机 UUID；
- 大文件流式写盘，不整包进内存（与 T1.10 流式修复一致）。

**状态**：Proposed。用户批准后实施 T3.5 返工，并在实现后更新本 ADR 为 Accepted。

**关联**：TASKS T3.5；ADR-0008。
