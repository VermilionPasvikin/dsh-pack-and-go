# 黑盒问题诊断与修复方案（FIX-02，待审核）

> 基于最新部署（`b2110-2235`）与源码/契约核查。每条给出：现象、病因、方案、待决策。

## 1. 归档对话仍显示（问题 1）

**病因**：`workspace.follow` 的 baseline 里有 `archivedSessionIds`，但 `groupFromWorkspaces`
只用了 `workspace.sessionIds`，从未过滤归档；DSH 侧边栏的归档过滤是它自己做的。

**方案**：保存 baseline 的 `archivedSessionIds`，树构建时排除；「显示已归档」勾选时再附加
（标题从 `mover list` 的 ungrouped 取，取不到用短 id）。成本低。

## 2. 切英文后仍中文（问题 2）

**病因（已确认）**：`LocaleSnapshot` 的字段是 **`active`**（`{ active, locales, revision }`），
而 `currentLocaleId()` 读的是 `snapshot.id ?? snapshot.locale ?? snapshot.language` → 永远 undefined
→ 永远回退 `zh`。

**方案**：改读 `snapshot.active`（保留旧字段兜底）；`subscribe` 回调已正确接线。
这是纯 bug，修复后英文即生效。

## 3. 「只带文件」按钮冗余（问题 3）

**病因**：当前实现 = 取消该组其余对话 + 自动勾「含项目文件」；没有真正“只带文件”的语义。
导出命令必须以至少一个会话作为工作区上下文，所以无法纯粹“只带文件”。

**方案二选一**
- **A（推荐，简单）**：**去除该按钮**，SPEC 的“只带文件”降级为“勾工作区 + 含项目文件”；
- **B（实现真正语义）**：新增 `mover export --files-only "<workspacePath>"`（导出该工作区文件、
  无会话），UI 按钮调用；需要包格式 `mode='workspaces'` 且 manifest 允许 sessions 为空——
  需要改 `validateManifest`/`buildManifest`（中等成本）。

## 4. 导入「指定目录」缺选择按钮（问题 4）

**方案**：指定目录模式显示「选择目录」按钮，复用 `uiWorkspace.pickDirectory`；
不可用时（`canPickDirectory=false`）不显示。低成本。

## 5. 导入后左侧列表不显示（问题 5）

**病因**：导入写盘 + `Workspace.attachSession` 只改持久化记录；DSH 侧边栏靠 `workspace.follow`
增量帧刷新，导入没有触发任何 follow 增量（attach 不发帧）→ 必须刷新/重启才可见。

**方案（先热重载，失败再提示）**：
1. 导入后调用 `workspaceController.insertSessionBefore(workspaceId, sessionId)`（或
   `insertSessionBefore` 的实体方法）——它改顺序并触发 upsert 帧，侧边栏应即时更新；
2. 实施时实测：若侧边栏刷新 → 热重载完成；若不触发 → 回退为“重启提示”（已有）。
需要 Host 拿到 `workspaceController`（`ctx.get('workspaceController')`）并对每个登记工作区
执行一次 order 变更。

## 6. 包名输入框（问题 6）

**方案**：导出页目标行旁增加「包名（可选）」输入框；命令 `mover export` 新增 `--name <名字>`：
- 目标路径是目录时，使用 `dsh-mover-<时间戳>.dshpack` → 改为 `<包名>.dshpack`（自动补后缀）；
- 目标路径是文件时忽略 `--name`（以完整路径为准）。

## 7. 「不压缩」包没明显更大（问题 7）

**病因（已确认）**：会话日志本身是 zstd 压缩过的，再“不压缩”只是从“几乎无压缩”变成“无压缩”，
体积差异很小；只有含**工作区未压缩文件**的包才会明显变大。

**方案**：保留选项 + 文案说明（“仅对未压缩的工作区文件有效”）；或移除该选项。建议保留 + 文案。

## 8. 每次操作写入会话日志（问题 8）

**病因（已确认）**：ADR-0008 用 `ctx.commands.execute`，官方实现会在会话中追加
`command/run` + `command/done` 两条直接日志事件 → 会话文件随每次导出/导入增长。

**方案（需 ADR-0011）**：新增 **exact Fetch 路由**（Connection 已认证通道）：
```
POST /api/mover/exec
body: { action: 'export'|'import'|'list'|'inspect'|..., args: {...} }
→ { ok, result }
```
- UI 改为 `fetch('/api/mover/exec', ...)`（带 cookie），**不经过 any session/agent**，
  不写会话日志；
- 命令通道保留给聊天命令行与 CLI（或一并移除命令注册）；
- 与 ADR-0010（已取消的上传通道）不同：这里只是**操作入口**，不接收文件、不落临时目录。

**待你拍板**：是否引入 `POST /api/mover/exec`（ADR-0011）。

## 9. 预检永远 0 项（问题 9）

**病因（已确认）**：`preflightWorkspace` 检查的是**跨平台风险**（Windows 非法文件名、大小写冲突、
路径过长、符号链接）。同平台导出（Windows→Windows）通常没有这些风险 → 0 项是正确结果，
但 UI 没解释。

**方案**：文案说明（“0 项 = 当前平台无需转换”）；可选增加通用检查（文件不可读、符号链接统计）
使预检更有信息量。建议先做文案 + 符号链接统计。

## 10. CLI 测试（你要求）

**已执行并记录**：
- `node src/cli/index.js export --home <e2e> --out %TEMP%\dsh-mover-cli-test.dshpack` → 8 个对话、276299 字节；
- `node src/cli/index.js import --home <空 home> --pack ...` → 8 个会话文件写入，退出码 0；
- 结论：CLI 导出/导入往返正常（workspace.json 不存在时提示“未更新”，符合预期）。

## 待你拍板

1. 问题 3：去按钮（A）还是实现 `--files-only`（B）？
2. 问题 8：是否引入 `POST /api/mover/exec`（ADR-0011）？
3. 问题 9：仅文案，还是增加通用检查？
4. 问题 7：保留选项 + 文案，还是移除？
