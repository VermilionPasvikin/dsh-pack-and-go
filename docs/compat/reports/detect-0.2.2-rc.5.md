# 检出报告：DSH 0.2.2-rc.5（基线 0.2.2-rc.2）

- 日期 / 执行者：2026-11-23 / lead（agent）
- 触发原因：本机宿主已由 nightly 渠道自动升级到 0.2.2-rc.5；发布插件新版本前按
  [UPSTREAM-COMPAT.md](../UPSTREAM-COMPAT.md) §4 执行正式检出（TASKS T10.4）
- 本机宿主版本：`{"ok":true,"found":true,"path":"F:\\dsh\\resources\\runtime\\cli\\bin\\dsh.cmd","version":"0.2.2-rc.5"}`
  （`node scripts/compat/probe-host.mjs`）
- dist-tags 快照：`{"next":"0.2.2-rc.5","latest":"0.2.2-rc.5","alpha":"0.2.3-alpha.2"}`

## 差异摘要（D1）

`check-upstream`（基线 0.2.2-rc.2 → 目标 0.2.2-rc.5）：

- 11 个契约包版本变化、24 个契约文件 hash 变化、0 新增、0 删除；
- 版本未变：`@deepseek-ai/cordis@4.1.0`、`cordis-plugin-loader@1.1.0`、`cordis-plugin-include@1.1.0`。

## 源码对照（D2/D3）

方法：npm tarball 对比 + GitHub `deepseek-ai/deepseek-harness` compare
（`dsh-v0.2.2-rc.2...dsh-v0.2.2-rc.5`，19 commits / 300 files）。

| 契约包（hash 变化） | 源码结论 |
|---|---|
| `dsh-session-format` / `-catalog` / `-v3-to-v4` / `dsh-session-persistence-jsonl` | GitHub compare 中 `packages/session/**` 的 src **零变化**；npm bundle hash 差异 = 重新构建产物差异 |
| `dsh-workspace` | `packages/workspace/**` src 零变化（仅 attachment-local 的 package.json 版本号 bump） |
| `dsh-attachment-local` / `dsh-home-paths` / `dsh-session-query-sqlite` | src 零变化 |
| `dsh-client-ui-cordis` / `dsh-client-ui-chat` | 我们依赖的 `sidebar.footer.action` slot 契约**未变**；`ui-sidebar` 仅新增 `sidebar.session.action`（hoc）；`ui-directory-picker-*` 新增第三个 hole `workspace.picker.directoryFlow`；`ui-workspace` 新增 `workspace.picker` Component Factory——均为**新增能力，向后兼容** |
| `dsh`（聚合包 lib） | 依赖版本图仅随 rc 号递增；新增 `dsh-deepseek-chat-import` 实验包（不在默认组合） |
| base `cordis.patch.yml` | 变化为 web search provider 配置调整（与本插件无关） |

## 分类结论（对照 UPSTREAM-COMPAT §2）

| 类别 | 判定 | 依据 |
|---|---|---|
| A Cordis 服务/API | **兼容** | cordis 4.1.0 未变；D4 实测服务注入/命令/exec 路由全部就绪 |
| B 服务方法契约 | **兼容** | 相关包源码零变化；D4 实测 list 类方法返回正常 |
| C 数据文件格式 | **兼容** | session/workspace/attachment/home-paths 源码零变化；CLI 导入导出往返成功、workspace.json（unit v2）读写成功 |
| D Client 运行时 | **兼容** | 依赖的 slots/remote 契约未变，变化均为新增 |
| E 打包/分发 | **兼容** | loader/include 版本未变；patch 方言未变 |

## 运行时探针（D4，一次性 DSH_HOME，rc.5 实测）

> 环境：`%TEMP%\dsh-compat-e2e-probe`（带 `.dsh-e2e-marker`），`--from-default-profile web`
> 模板 + `plugin add file:` 安装插件，未触碰真实 `~/.dsh`。

- 插件激活：boot 无 `pending`/`did not activate`（`workspaceRegistry`/`sessionPersistence`/
  `commands` 三个 inject 服务全部就绪）；
- `[dsh-pack-and-go] command registered: mover`；`exec route registered: /api/mover/exec`；
- `DSH-PACK-AND-GO-SELFTEST {"workspaces":0,"ungrouped":1,"totals":{"sessions":1,"bytes":355}}`
  —— CLI 导入的会话被 `sessionPersistence.list()` 正确读出；
- CLI 往返：export 987 字节包 → import `已导入 1 个对话…workspace.json 已更新`；
- `DSH-PACK-AND-GO-CMD-FIND true`（命令查找通过）；`resolveAgent` 返回 error 为「会话无
  agent 上下文」的预期路径（探针脚本未防御，与 DSH 契约无关）；
- REBUILD 探针：构造的会话事件缺 v4 必填字段（`producer-owned source kind`），
  `open(read)` 校验拒绝——**用 DSH 0.2.2-rc.2 CLI 对同一 home/同一数据跑同一探针，报完全相同的
  错误**，两版本行为一致；REBUILD 成功路径受探针数据限制未覆盖（rc.2→rc.5 相关包源码零变化，风险低）。

### rc.2 CLI 黄金对照（附加证据）

- 用 npm 安装的 `@deepseek-ai/dsh@0.2.2-rc.2` CLI boot 同一一次性 home（rc.5 流程安装的
  插件与数据）：SELFTEST 输出与 rc.5 **完全一致**（`ungrouped:1, sessions:1, bytes:355`）；
- rc.2 boot 自动创建的 `storages/workspace.json` 结构 = `{unit:{name:'workspace',version:2},
  global:{initialized,workspaceIds,archivedSessionIds,pinnedSessionIds},tables:{workspaces:{}}}`，
  与插件 CLI 期望完全一致；CLI 在其上 import 输出 `workspace.json 已更新`。

## 结论

**无需修复**：0.2.2-rc.2 → 0.2.2-rc.5 无契约破坏（五类全部判定「兼容」）。
后续动作：回归收尾（T10.5）→ 基线升级 0.2.2-rc.5（T10.6）→ 发布 0.2.3。

未覆盖项：REBUILD 成功路径（探针数据限制）；R5 CDP 冒烟（类 D 判定兼容，按手册为可选项，
建议发布后由用户浏览器自然验证）。
