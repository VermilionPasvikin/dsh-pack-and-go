# DSH 宿主跨版本维护手册（UPSTREAM-COMPAT）

> 目标读者：**执行维护任务的 agent**（以及维护者本人）。
> 本文档把「DSH 宿主更新 → 检出破坏 → 修复 → 回归」拆成可逐条执行的步骤；
> 每一步都给出：要运行什么、预期看到什么、不满足时下一步去哪。
> 需求与决策依据见 [DECISIONS.md](DECISIONS.md) ADR-0018；维护记录模板见 §7。

---

## 1. 本文档是什么、什么时候用

**背景**：dsh-pack-and-go 运行在 DSH（宿主）进程内，依赖一批**跨版本不承诺稳定**的
契约（Cordis 服务、会话文件格式、数据目录布局、Client 运行时、插件加载方言）。
DSH 升级（尤其 nightly 渠道自动更新）可能破坏这些契约，且破坏不一定立刻报错
（可能表现为导入/导出静默出错或会话打不开）。

**触发条件**（满足任一，就按 §4 跑一次检出）：

- 本机 DSH 升级后第一次使用本插件前；
- npm registry 上 `@deepseek-ai/dsh` 的 `latest/next` 变化（可由 §4 步骤 D1 检查）；
- 用户报告插件在「升级 DSH 之后」出现异常；
- 定期巡检（建议每次 DSH 版本号变化时至少一次）。

**术语**（全文一致）：

| 词 | 含义 |
|---|---|
| 基线 | 已完整验证过插件的 DSH 版本及其契约签名快照（`docs/compat/baseline/*.json`） |
| 目标版本 | 检出的对象：registry dist-tags 的新版本，或本机 `dsh --version` 的值 |
| 契约包 | `scripts/compat/config.mjs` 的 `WATCH_PACKAGES`：承载插件依赖契约的 npm 包 |
| 检出 | 发现「目标版本相对基线的契约变化」并分类为是否破坏的过程（§4） |
| 探针 | 在真实 DSH 进程里验证服务/命令可用的运行时测试（§4 D4） |

**红线**：

- 检出与回归**绝不读写真实 `~/.dsh` 数据**；验证一律用一次性 `DSH_HOME`（`%TEMP%` 下带
  `.dsh-e2e-marker` 的目录），遵循全局 AGENTS §3。
- 本手册所有脚本零 npm 依赖、零外部子进程（纯 Node 内置 API），可在受限沙箱内运行
  （沙箱内 `node --test` 需加 `--experimental-test-isolation=none`）。

---

## 2. 依赖清单（契约面）

> 这是「宿主更新会破坏什么」的总表。**每加一条新依赖（代码里用了新的 DSH 服务/字段/
> 格式），必须同步更新本表、`scripts/compat/config.mjs` 的 `WATCH_PACKAGES`，并重新冻结基线。**

### 2.1 类别 A：Cordis 服务与 API（Host 侧）

使用位置：`src/host/index.js`、`src/host/catalog.js`、`src/host/commands.js`、`src/host/exec-route.js`。

| 依赖点 | 破坏方式（宿主更新的何种变化会破坏） | 检出 | 修复 | 回归 |
|---|---|---|---|---|
| `inject = ['workspaceRegistry','sessionPersistence','commands']` | 服务改名/删除 → 插件不激活或启动失败 | D3 类 A-1；探针日志缺 `host plugin loaded` | 改 `inject` 与服务名 | 单测 + D4 探针 |
| `ctx.get('sessionQuery'\|'workspaceController'\|'sessionController'\|'sessions'\|'connection')` | 服务改名/删除 → 运行时 undefined（代码有 `typeof ctx.get==='function'` 防护，会**静默降级**，需探针确认） | D3 类 A-2 | 改服务名；确认降级路径可接受或移除该功能 | 单测 + D4 探针 |
| `ctx.commands.register/execute/find` | Cordis 命令 API 签名变化 | D3 类 A-3；探针 `DSH-PACK-AND-GO-CMD-*` 日志 | 适配新签名（对照 cordis 包 `lib/index.js` 类型） | D4 CMD 探针 |
| `ctx.effect`、`ctx.logger` | Cordis 内核 API 变化（cordis 大版本） | 契约包 `@deepseek-ai/cordis` 版本与文件 diff | 按 cordis 迁移说明适配 | 单测 + D4 |
| `connection.fetch.register({path,methods,requestBody,fetch})` | 路由注册签名/行为变化 → `/api/mover/exec` 失效，UI 回落命令通道 | D3 类 A-4 | 适配注册参数（对照 dsh-web-app 源码） | D4 EXEC 探针 |

### 2.2 类别 B：服务方法契约

已核实签名记录在 [DESIGN.md](DESIGN.md) §4（以 `cordis_inspect_query` 为准，实现时仍须运行时校验）。

| 服务 / 方法 | 破坏方式 | 检出 | 修复 | 回归 |
|---|---|---|---|---|
| `sessionPersistence.list() → Snapshot[]`；`Snapshot.{header,sizeBytes,eventCount,formatStatus,location.path}` | 返回字段改名/删除（如 `location.path` 移动）→ 目录读取失败或路径为空 | D3 类 B-1；探针 `DSH-PACK-AND-GO-LIST` 日志 | 改字段访问；标题兜底逻辑（`catalog.js`）同步改 | 单测 `catalog.test.mjs` + D4 |
| `sessionPersistence.create/open`、`SessionHandle.read/append/flush/close` | 签名/行为变化（ADR-0007 方案 C 依赖） | D3 类 B-2；探针 `DSH-PACK-AND-GO-REBUILD` | 适配 handle API | 单测 `rebuild.test.mjs` + D4 |
| `workspaceRegistry.create(path,title)/list()`；`Workspace.{id,path,title,sessionIds,attachSession,detachSession}` | 方法改名/语义变化 → 登记/归组失败 | D3 类 B-3；探针 `DSH-PACK-AND-GO-WS` 日志 | 适配（对照 `@deepseek-ai/dsh-workspace` 包） | 单测 `register.test.mjs` + D4 |
| `sessionQuery.readTitleSnapshots(ids)` | 返回结构变化 → 标题失败（有兜底，非致命） | D3 类 B-4 | 适配或维持兜底 | 单测 + D4 |
| `sessionController.list/resolveAgent`、`workspaceController.follow`、`sessions` 服务 | 仅自检/修复分组使用；变化影响自检与启动修复 | D3 类 B-5 | 适配或降级 | D4 探针 |

### 2.3 类别 C：数据文件格式（**最高风险**）

插件**直接读写**这些文件/目录，宿主更新改格式不会在插件加载时报错，而是
导出/导入后会话损坏或 DSH 拒读。

| 数据 | 插件中的位置 | 破坏方式 | 检出 | 修复 | 回归 |
|---|---|---|---|---|---|
| 会话目录 `sessions/<--projectKey(cwd)-->/<id>/session.v4.jsonl.zstd`（zstd 多帧：首帧 header JSON `{type:'session',version:4,...}` + 事件帧） | `src/core/paths.js`（复刻 `projectKey/encodeSegment`）、`session-rewrite.js`、`zstd-frames.js`、`constants.js`（`SESSION_FORMAT_VERSION=4`） | 格式版本升 v5/文件名变/header 字段变化/帧结构变化（如不再按行分帧） | D3 类 C-1：契约包 `dsh-session-format*`、`dsh-session-persistence-jsonl` diff；探针 REBUILD | 优先走 ADR-0007 方案 C（服务重建）；若文件名/目录规则变，更新 `paths.js` 复刻算法与测试向量 | 单测 `paths/session-rewrite/zstd-frames` + 导入导出 E2E |
| `storages/workspace.json`（`unit.version:2`、`tables.workspaces`、`global.workspaceIds/archivedSessionIds/pinnedSessionIds`） | 存储版本升 3 / 结构变化 → CLI 直接读写后 DSH 不识别 | D3 类 C-2：契约包 `dsh-workspace` diff | 改 CLI 读写逻辑；无法兼容时标注仅 CLI 受限 | `tests/e2e/cli.test.mjs` + D4 |
| `attachments/v1/{objects,file-objects,files}/<hex2>/<sha256>` | 布局变化（目录名/寻址方式） | D3 类 C-3：契约包 `dsh-attachment-local` diff | 更新 `src/core/attachments.js` 路径常量 | 单测 `attachments.test.mjs` + E2E |
| 事件 schema：`working-directory/change.data.cwd`、`deliverables/presented`、`tool.meta.cwd`、`permission/preset` 等（ADR-0017 系列） | 事件类型/字段变化 → 改写失效或改写错字段 | D3 类 C-4：`dsh-session-format-catalog` diff + 真实会话样本 | 更新改写规则；旧包兼容策略走 ADR | 单测 + 真实会话导入回归 |

### 2.4 类别 D：Client UI 运行时

使用位置：`src/client/client.js`、`package.json` 的 `dsh.client`。

| 依赖点 | 破坏方式 | 检出 | 修复 | 回归 |
|---|---|---|---|---|
| `window.__ModuleLoader__.load({id,factory})` | 模块加载器改名/移除 → client 不加载 | D3 类 D-1 | 对照 `dsh-client-ui-cordis` 包改入口 | CDP 冒烟 |
| `ctx.remote.workspace.follow`、`ctx.remote.session.list`、`ctx.remote.commands.execute` 及返回结构 `RemoteResult/CommandExecution` | 远端方法/结构变化 | D3 类 D-2 | 适配调用与结果解析 | CDP 冒烟 |
| `ctx.slots.inject/register`（`sidebar.footer.action`、`shell.overlay`、`settings.section`） | slot 名变化 → 入口消失 | D3 类 D-3 | 更新 slot 名 | CDP 冒烟 |
| CSS 主题变量 `--dsw-alias-*` | token 改名 → 界面样式异常（非致命） | D3 类 D-4 | 更新 token 表 | 视觉检查 |
| `dsh.client.inject = ['@deepseek-ai/dsh-client-ui-chat']` | 注入包改名 → UI 运行时缺失 | D3 类 D-5 | 改 package.json | CDP 冒烟 |

### 2.5 类别 E：打包 / 分发 / 安装契约

| 依赖点 | 破坏方式 | 检出 | 修复 | 回归 |
|---|---|---|---|---|
| `cordis.patch.yml` 方言（`insert: [{id,name,config}]`） | loader patch 方言变化 → 安装后不加载 | D3 类 E-1：契约包 `cordis-plugin-loader/include` diff | 按新方言改 patch 文件 | 一次性 profile 安装验证 |
| `package.json`：`dsh.bundle.patch`、`dsh.client.*`、`engines.dsh`、`exports` | 清单语义变化 | D3 类 E-2 | 更新清单字段 | `npm pack --dry-run` + 安装验证 |
| `dsh plugin add` 安装链路、`DSH_HOME`/`DSH_VERSION` 环境变量 | 安装方式/环境变量变化 | D3 类 E-3 | 更新文档与 README | 安装验证 |
| Node/Electron 运行时（`engines.node >=22.15`；zstd/`node:zlib` 能力） | 运行时降级/能力移除 | D3 类 E-4 | 更新 engines 或替换实现 | 单测 + E2E |

### 2.6 契约包 → 依赖类别对照

`WATCH_PACKAGES`（`scripts/compat/config.mjs`）与上表的对应关系：

| 契约包 | 覆盖的依赖类别 |
|---|---|
| `@deepseek-ai/dsh` | 版本图基线、CLI、全类别的聚合版本号 |
| `@deepseek-ai/cordis` | A（内核 API） |
| `@deepseek-ai/cordis-plugin-loader`、`@deepseek-ai/cordis-plugin-include` | E-1（patch 方言） |
| `@deepseek-ai/dsh-session-format`、`-catalog`、`-v3-to-v4` | C-1、C-4（会话格式与事件 schema） |
| `@deepseek-ai/dsh-session-persistence-jsonl` | C-1（sessions 目录、帧写入、projectKey 来源） |
| `@deepseek-ai/dsh-workspace` | B-3、C-2（workspace 服务与存储） |
| `@deepseek-ai/dsh-attachment-local` | C-3（附件布局） |
| `@deepseek-ai/dsh-home-paths` | C 全部（DSH_HOME 顶层布局） |
| `@deepseek-ai/dsh-session-query-sqlite` | B-4（标题查询） |
| `@deepseek-ai/dsh-client-ui-cordis`、`@deepseek-ai/dsh-client-ui-chat` | D 全部 |

---

## 3. 工具与产物

| 产物 | 位置 | 说明 |
|---|---|---|
| 冻结脚本 | `scripts/compat/freeze-baseline.mjs` | 生成某 DSH 版本的基线快照 |
| 检出脚本 | `scripts/compat/check-upstream.mjs` | 基线 vs 目标版本 diff |
| 宿主探测 | `scripts/compat/probe-host.mjs` | 定位本机 dsh CLI 并输出版本 |
| 共享配置 | `scripts/compat/config.mjs` | `WATCH_PACKAGES`、契约文件过滤 |
| 库 | `scripts/compat/lib/tar.mjs`、`lib/registry.mjs` | ustar 解析、registry 访问与 semver |
| 基线快照 | `docs/compat/baseline/<dshVersion>.json` | 契约签名（每包 version+integrity+文件 sha256） |
| 测试 | `tests/compat/*.test.mjs` | 纯函数 + CLI smoke（网络用例用 `DSH_COMPAT_NETWORK=1` 门控） |
| 检出报告 | `docs/compat/reports/*.md` | 每次检出的记录（模板见 §7） |

**退出码约定**（agent 判断依据）：

| 脚本 | 0 | 1 | 2 |
|---|---|---|---|
| `check-upstream` | 无变化 | 检出到变化 | 错误（基线缺失/网络失败等） |
| `freeze-baseline` | 成功 | — | 错误 |
| `probe-host` | 找到 dsh CLI | — | 未找到/运行失败 |

**前置条件**：Node ≥ 22.15；网络可达 `registry.npmjs.org`；本机有 dsh CLI（用于 D4 探针，
可选，Windows 桌面版自带 `F:\dsh\resources\runtime\cli\bin\dsh.cmd`，或 `npm i -g @deepseek-ai/dsh@<版本>`）。

---

## 4. 检出流程（runbook）

> 按 D0 → D1 → … 顺序执行。每步给「命令 / 预期 / 判据 / 失败下一步」。
> 全部命令在仓库根目录执行。

### D0 · 确认需要检出

- 命令：`node scripts/compat/probe-host.mjs`
- 预期：`{"ok":true,"found":true,"path":"…","version":"0.2.2-rc.5"}`（版本号以实际为准）
- 判据：本机 DSH 版本 ≠ 基线版本（`docs/compat/baseline/` 下最大的版本号）→ 继续 D1。
- 失败下一步：未找到 CLI → 安装 dsh CLI（§3 前置条件），或直接以 registry 版本为目标跑 D2。

### D1 · 记录上游版本状态

- 命令：`node scripts/compat/check-upstream.mjs --target auto`（输出前几行是 dist-tags 快照）
- 预期：`dist-tags: {"latest":"…","next":"…","alpha":"…"}`，随后是逐包对比日志，最后一行 JSON 报告。
- 判据：若 `"changed":false` → 上游与基线一致，**结束**（无破坏风险，记录到 DEVLOG 即可）。
  若 `"changed":true` → 把 JSON 报告存为检出报告草稿（§7 模板），继续 D2。
- 失败下一步：网络失败（退出码 2）→ 检查网络后重试；仍失败则改日再检，不要基于猜测修复。

### D2 · 解读 diff 报告

- 动作：逐条阅读报告里的 `packageDiffs[]`。
- 分类规则（对照 §2）：
  - `changed` 里出现 `package/package.json` → 依赖版本图变化，先看 `dependencies` 字段；
  - 出现会话/工作区/附件相关包文件 → 类 C（**最高风险**，必须走 D4 探针 + E2E）；
  - 出现 cordis 包文件 → 类 A；
  - 出现 client-ui 包文件 → 类 D；
  - `added`/`removed` 非空 → 文件级增删（可能是打包结构调整，也可能是契约文件迁移），需打开对应包源码确认。
- 判据：产出一份「受影响类别清单」（如：C-1、D-2），填入报告草稿。空清单 → 结束（无需修复）。
- 失败下一步：看不懂 diff → 用 §5.2 的「源码对照」方法打开两个版本的 tarball 源码对比。

### D3 · 契约源码对照（语义级确认）

- 动作：对 D2 标记的每个变化文件，下载 tarball 解包对比（见 §5.2 的命令），确认：
  1. 变化是否触及插件使用的字段/方法（对照 §2 表）；
  2. 是否有向后兼容路径（DSH 常见做法：保留旧字段 + 迁移层）。
- 判据：把每个变化标记为 `破坏` / `兼容` / `未知`，写入报告草稿。
- 失败下一步：无法从源码判断 → 用 D4 运行时探针实测。

### D4 · 运行时探针（真实 DSH 进程）

> 用一次性 `DSH_HOME` 起独立 DSH 实例（**绝不使用真实 `~/.dsh`**），加载本插件并执行自检。
> 探针需要插件已通过 `dsh plugin add` 安装到该一次性 home 的 profile（见项目 README/RELEASE.md
> 的安装验证步骤；也可用 `dsh --profile verify` 模板）。

- 命令（Windows 桌面版 CLI 为例，路径按 `probe-host` 输出调整）：

  ```bash
  export DSH_HOME="<临时目录，带 .dsh-e2e-marker>"
  export DSH_PACK_AND_GO_SELFTEST=1            # apply() 自检
  export DSH_PACK_AND_GO_SELFTEST_LIST=1       # 列表自检（类 A/B 服务契约）
  export DSH_PACK_AND_GO_SELFTEST_REBUILD=1    # 会话重建自检（类 C-1）
  export DSH_PACK_AND_GO_SELFTEST_CMD=1        # 命令链路自检（类 A-3）
  "F:\dsh\resources\runtime\cli\bin\dsh.cmd" --profile verify --no-open --port 0 --host 127.0.0.1
  ```

- 预期与判据（对照日志行）：
  - `host plugin loaded` + `command registered: mover` → 类 A 基础通过；
  - `DSH-PACK-AND-GO-SELFTEST {…}`（workspaces/sessions 计数）→ 类 B 目录读取通过；
  - `DSH-PACK-AND-GO-LIST …`、`DSH-PACK-AND-GO-REBUILD …`、`DSH-PACK-AND-GO-CMD-EXEC …` → 对应探针通过；
  - 出现 `DSH-PACK-AND-GO-SELFTEST-FAILED` 或 `*FAILED` 行 → 记入报告，对应类别判为破坏。
- 失败下一步：单探针失败 → 打开 `src/host/index.js` 对应自检函数与 DSH 服务源码定位签名差异（§5.2）。

### D5 · 产出检出报告

- 动作：按 §7 模板写 `docs/compat/reports/detect-<目标版本>.md`，包含 D1 报告原文、D2 分类、
  D3 结论、D4 日志关键行、以及「是否进入修复流程」的结论。
- 判据：报告能被另一个人（或另一次会话的 agent）不读代码就复现全部判断。
- 失败下一步：证据不足的条目标注「未验证」，不要写成结论。

---

## 5. 修复流程（决策树 + 分类指引）

### 5.1 决策树

```
检出发现破坏
├─ 破坏仅来自「行为细节变化」，且目标版本仍在 engines.dsh 范围内（0.2.x）
│   └─ 直接适配修复：按 §5.2 对照源码改插件 → §6 回归 → 更新基线（见下）
├─ 破坏来自「大版本/格式版本变化」（如 DSH 0.3、会话格式 v5）
│   ├─ 先写 ADR（DECISIONS.md），确定兼容策略：
│   │   ① 双版本兼容（成本高） / ② 升 engines 上限并放弃旧版 / ③ 冻结维护
│   ├─ ADR 批准后实施修复 → §6 回归 → 更新基线
├─ 破坏不可修复（上游移除能力且无替代）
│   └─ 在 SPEC/README 标注功能降级，写 ADR 记录
└─ 修复完成后：重跑 freeze-baseline 把基线升到新版本（见下）
```

**升级基线的标准动作**（旧基线文件保留在 `docs/compat/baseline/`，不删除）：

```bash
node scripts/compat/freeze-baseline.mjs --version <新DSH版本>
```

并同步：`package.json` 的 `engines.dsh` 上限（如需）→ `docs/RELEASE.md` 验证版本 → 发布新插件版本。

### 5.2 源码对照方法（每次修复必用）

1. 下载两个版本 tarball 到临时目录（缓存目录 `%TEMP%/dsh-compat-cache` 由脚本管理）：

   ```bash
   curl -L -o /tmp/pkg.tgz "https://registry.npmjs.org/@deepseek-ai/<包名>/-/<包名尾段>-<版本>.tgz"
   # 或直接读缓存：%TEMP%/dsh-compat-cache/<包名__转义>@<版本>.tgz
   ```

2. 解包（任意 tar/7z；或写一个一次性 Node 脚本用 `scripts/compat/lib/tar.mjs` 的 `parseTarGz` 导出条目）。
3. 对比基线版本与目标版本的相关文件，定位字段/签名变化。
4. **语义不清楚时**：到上游仓库按需对照——`https://github.com/deepseek-ai/deepseek-harness`
   （monorepo；如会话格式在 `packages/session/session-persistence-jsonl/src/format.ts`）：
   ```bash
   git clone --depth 1 --branch v<版本> https://github.com/deepseek-ai/deepseek-harness /tmp/dsh-src
   ```

### 5.3 分类修复指引

| 类别 | 修复步骤（最小改动） | 必改文件 | 注意 |
|---|---|---|---|
| A | 改服务名/API 调用点；删除不再存在的功能并写 ADR | `src/host/index.js` 等 | 保持 `typeof ctx.get==='function'` 防护风格；探测日志保留 |
| B | 改字段/方法访问；更新 DESIGN §4 签名记录 | `src/host/*.js`、`docs/DESIGN.md` | 标题/归组兜底逻辑要同步 |
| C | 优先走服务重建（ADR-0007 方案 C）；格式/布局变化更新 core 复刻算法与测试向量 | `src/core/*`、`tests/unit/*` | **必须**用真实会话样本做导入导出 E2E；旧包兼容策略写 ADR |
| D | 改 client 入口/slot/remote 调用；更新 CSS token | `src/client/client.js`、`package.json` | CDP 冒烟必跑 |
| E | 改 patch 方言/清单字段/文档 | `cordis.patch.yml`、`package.json`、`docs/*` | 一次性 profile 安装验证必跑 |

---

## 6. 回归测试流程（修复后必跑，顺序执行）

> 全部命令在仓库根执行。**未跑完 §6 不得宣称修复完成。**

### R1 · 单元测试（纯逻辑）

```bash
node --test "tests/unit/**/*.test.mjs" "tests/compat/**/*.test.mjs"
```

- 预期：全绿（POSIX 专属用例在 Windows 上 skip 属正常）。
- 判据：`fail 0`。
- 受限沙箱替代（spawn 被禁时）：`node --test --experimental-test-isolation=none "tests/unit/**/*.test.mjs" "tests/compat/**/*.test.mjs"`。
- 失败下一步：修代码或测试向量，重跑；不要跳过。

### R2 · 兼容脚本自测（含网络）

```bash
DSH_COMPAT_NETWORK=1 node --test --experimental-test-isolation=none "tests/compat/**/*.test.mjs"
node scripts/compat/probe-host.mjs
```

- 预期：网络用例通过；probe 返回本机 DSH 版本。
- 判据：`fail 0`。

### R3 · CLI 导入导出 E2E（数据格式回归，类 C 修复必跑）

```bash
node --test --experimental-test-isolation=none "tests/e2e/cli.test.mjs"
```

- 预期：导出/导入往返、workspace.json 更新全部通过。
- 失败下一步：按失败用例定位格式差异（对比 §2.3 契约包 diff）。

### R4 · 真实宿主自检（D4 探针全量）

按 §4 D4 的命令，对 `DSH_PACK_AND_GO_SELFTEST=1` + `LIST/REBUILD/CMD/IMPORT/EXPORT` 各跑一遍，
收集日志证据（`%TEMP%/mover-selftest.log`）。判据：无 `*FAILED` 行。

### R5 · UI/CDP 冒烟（类 D 修复必跑）

用 Chrome/Edge headless CDP 打开 DSH 页面，验证：迁移浮层可打开、会话/工作区列表有数据、
导出/导入按钮可用（截图与 DOM 文本为证据）。参考 `tests/e2e/cdp/*.mjs` 现有脚本。

### R6 · 收尾

- 更新 `docs/compat/reports/` 报告（修复结论 + R1–R5 证据行）；
- 追加 DEVLOG；按 [AGENTS.md](../AGENTS.md) 提交纪律 commit（每个逻辑变更一个 commit）。

---

## 7. 维护记录模板

### 7.1 检出报告模板（`docs/compat/reports/detect-<目标版本>.md`）

```markdown
# 检出报告：DSH <目标版本>（基线 <基线版本>）

- 日期 / 执行者：YYYY-MM-DD / <agent 或人名>
- 触发原因：<本机升级 / 用户报告 / 定期巡检>
- 本机宿主版本：<probe-host 输出>
- dist-tags 快照：<check-upstream 前几行>

## 差异摘要
<check-upstream 的 JSON 报告，粘贴或链接>

## 分类结论
| 契约包 | 类别（§2） | 判定（破坏/兼容/未知） | 依据 |
|---|---|---|---|

## 运行时探针（D4）
<关键日志行与结论>

## 结论
<需要修复 / 无需修复；若需修复指向修复计划>
```

### 7.2 修复记录模板（同目录 `fix-<目标版本>.md`）

```markdown
# 修复记录：适配 DSH <目标版本>

- 关联检出报告：<链接>
- ADR：<编号或「无需」>
- 修改文件：<清单>
- 回归证据：R1 <…> / R2 <…> / R3 <…> / R4 <…> / R5 <…>
- 基线升级：<freeze-baseline 输出行>
- 未决风险：<…或「无」>
```

### 7.3 与其他文档的联动

- 破坏分析、修复策略的重大取舍 → `docs/DECISIONS.md` 追加 ADR；
- 每轮维护的流水账 → `docs/DEVLOG.md` 一条（编号递增）；
- 状态与下一步 → `docs/INDEX.md`（唯一允许原地更新的状态位）；
- 任务拆分 → `docs/TASKS.md`（M10 跨版本维护）。

---

## 8. 已知边界与风险

- **app.asar 不可读**：桌面版 DSH 核心代码打包在 `app.asar` 内，普通文件工具无法读取；
  因此源码对照一律走 npm 包 tarball / GitHub 仓库，**不要**以本地安装目录为 diff 基准。
- **prerelease 语义**：DSH 生态大量 `-rc/-alpha` 版本；`resolveRange` 按「range 不含 prerelease
  则排除 prerelease」处理，精确版本（含 prerelease）直接命中——解析异常时先看 registry 版本表。
- **abbreviated metadata**：脚本用 `application/vnd.npm.install-v1+json`，字段比完整 packument 少；
  若未来需要完整元数据（如 readme/时间），在 `lib/registry.mjs` 调整 Accept 头。
- **探针依赖真实 dsh CLI**：无 CLI 环境跳过 R4（标注「未验证」），不得假装通过。
- **CI 未配置**：本流程是手动 runbook（ADR-0018）；如需自动化，再议 GitHub Actions 定时检出。
- **沙箱限制**：受限环境 `node --test` 需 `--experimental-test-isolation=none`；脚本本身无子进程依赖，
  但 `probe-host` 探测 dsh CLI 需要允许 spawn（受限环境会得到退出码 2 与 hint，属预期）。

---

## 附录 A · 首次建立与首个正式检出记录

- 基线：`docs/compat/baseline/0.2.2-rc.2.json`（14 契约包 / 433 契约文件签名）。
- 首次演练：check-upstream 检出 `0.2.2-rc.5` —— 11 包版本变化、24 文件变化、0 增 0 删。
- **首个正式检出（2026-11-23，T10.4）已完成**：五类契约全部判定「兼容」（GitHub compare 证明
  会话/工作区/附件等源码零变化 + 一次性 DSH_HOME 运行时探针 + 0.2.2-rc.2 CLI 黄金对照），
  无需修复；回归 R1–R4 全过；基线已升级至 `docs/compat/baseline/0.2.2-rc.5.json`。
  详见 `docs/compat/reports/detect-0.2.2-rc.5.md`（也是检出报告模板的第一个实例）。
- 依据决策：ADR-0018。
