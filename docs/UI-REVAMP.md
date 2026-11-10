# UI 调整与缺陷修复方案（待审核）

> 状态：**提案，未实施**。审核通过后按本方案实现。
> 背景：真实浏览器验证暴露的 5 个问题（2 个显示细节、2 个交互/布局、1 个真实缺陷）。

## 问题 1：对话标题显示为「对话 session-」

**现状**：`ctx.remote.session.list` 在此 profile 返回空（无登录用户/授权过滤），标题回退到
`对话 ${sessionId.slice(0,8)}`；`sessionId` 形如 `session-77b08b13-…`，于是显示「对话 session-」。

**候选**
- **A（推荐）**：Host 新增 `mover list` 命令，返回 JSON（工作区 + 每个会话的真实标题，来自
  `loadCatalog` 的 `projections.values.title`）。Client 加载时调用，agent 参数取列表中第一个会话 id；
  失败时回退 C。
- **B**：Client 用 `ctx.sessions.retainInfo(id)` 读投影标题。快照结构未文档化，需先验证。
- **C（兜底）**：显示 `对话 ${id 去掉 "session-" 前缀后的前 8 位}`，完整 id 放 tooltip。

**推荐**：A + C 兜底；影响 `src/host/commands.js`、`src/client/client.js`、`tests/unit/commands.test.mjs`。

## 问题 2：默认工作区显示英文 `default-workspace`

**现状**：DSH 对默认工作区按语言显示「默认工作区」，我们直接显示原始 title。

**方案**：显示时若 `title === 'default-workspace'` → 按 locale 显示「默认工作区 / Default Workspace」；
其他工作区保留原名。影响 `client.js` 的 `groupFromWorkspaces` / `titleOf`。

## 问题 3：导出路径改为目录选择器

**现状**：必须手输完整文件路径，易错。

**方案**：
- 用 Client Service `uiWorkspace.pickDirectory(): Promise<string | null>` 弹目录选择器（需 inject
  `uiWorkspace`）；
- 选目录后，文件名用输入框（默认 `dsh-mover-<YYYYMMDD-HHmmss>.dshpack`）；
- 导出目标 = `join(dir, filename)`；
- 选择器取消/不可用（返回 null 或抛错）时回退现有「完整路径」输入框；
- 需把路径拼接逻辑放 Host 侧（跨平台 `join`），Client 只传目录 + 文件名。

**待确认**：`pickDirectory` 在 Web 端是原生目录选择还是浏览器目录选择（需实测）。

## 问题 4：页面留白过大、布局松散

**现状**：`maxWidth: 980` + 大 padding；空树时整页几乎空白。

**方案 A（推荐，紧凑工具卡）**：
- `maxWidth: 640`，居中卡片；标题行 + 副标题一行；
- 导出/导入 Tab；
- 树区域固定高度（如 `min(360px, 42vh)`），内部滚动，带边框；
- 底部操作栏（目录选择 + 文件名 + 开始按钮）常驻；
- 空状态：一行提示 + 「刷新」按钮，不留大片空白。

**方案 B（双栏宽屏）**：左侧树 320px，右侧操作区；适合大屏，但小屏需折叠。

**推荐**：A；B 作为后续可选。

## 问题 5（真实缺陷）：提示「打包完成」但桌面无产物

**根因（已定位，两处叠加）**
1. **Client 误报成功**：`runCommand` 中 `commands.execute` 返回 `undefined` 时，代码用默认文案
   `t.exportDone`（“打包完成”）显示绿色——命令实际可能未执行。
2. **Host 未处理“目标路径是目录”**：用户输入 `C:\Users\15349\Desktop`（目录），
   `buildPackToFile` 会尝试把目录当文件写，失败；但 UI 因根因 1 仍显示成功。

**修复**
- Client：`result == null` → 显示错误「命令未执行（未找到命令或会话上下文不可用）」；
- Host：`mover export` 对目标路径做 `stat`：存在且是目录 → 自动拼接
  `dsh-mover-<时间戳>.dshpack`；不存在 → 视为文件名；父目录不存在 → 明确报错；
- 单测覆盖：目录目标、文件目标、父目录不存在、命令结果为空时 UI 分支（fake React 测试）。

## 实施顺序与验证

1. 修复问题 5（缺陷优先）+ 单测；
2. 问题 1/2（标题与默认工作区本地化）；
3. 问题 3（目录选择器 + 回退）；
4. 问题 4（布局）；
5. 每步：`node --check`、单测、同步一次性 profile、请用户浏览器验证后再提交下一条。

## 待你决定

1. 布局选 **A（紧凑卡）** 还是 **B（双栏）**？
2. 标题方案：**A（Host 命令返回真实标题）** 是否需要？还是先用 C（短 id）？
3. 目录选择器不可用时，回退到文本输入是否可接受（推荐）？
