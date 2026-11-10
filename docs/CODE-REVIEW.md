# 全量 Code Review（v0.3，2026-11-11）

> 范围：`src/**`、`tests/**`、本轮黑盒问题修复涉及的所有路径。
> 目标：找出与「标题 UUID / 树与左侧不一致 / 命令调用失败」同类的潜在问题。

## 一、本轮已定位并修复的问题

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| 1 | 切英文仍中文 | `LocaleSnapshot` 字段是 `active`，代码读 `id/locale/language` | 读 `active`；`inject: ['locale']` |
| 2 | 归档对话仍显示 | baseline 的 `archivedSessionIds` 未参与过滤 | 过滤归档，开关切换重载 |
| 3 | 树显示 UUID 标题 | `SessionSummary` 无顶层 title；迁移会话投影缺失；命令通道依赖不可用 agent | Host catalog 事件兜底；UI 优先 `exec list` 标题 |
| 4 | 树与左侧不一致 | 用 `workspace.sessionIds`（索引过滤）而非会话 cwd | 按 `session.list` 的 cwd 归组 + 未分组；`session.list` 空时回退 |
| 5 | `reading 'size'` | `loadTitlesFromCommand` 提前返回缺 `sizes` | 补字段 + 可选链 |
| 6 | 命令调用失败（选路径后） | 所有操作依赖 `agentId` 命令通道 | ADR-0011：`POST /api/mover/exec` |
| 7 | 重复 id 导致 DSH 启动失败 | 导入未做已有会话检测 | `scanExistingSessionIds` + policy |
| 8 | new-id 会话 corrupt | 只改 header，事件投递标记未改 | 服务重建（create+append+补 seq） |
| 9 | 导入后侧边栏不显示 | 新会话未激活、索引未更新 | 导入后 `resolveAgent` 激活 + attach + 广播 |
| 10 | 附件 EPERM 整单失败 | 单条附件写失败抛错 | 逐条 try/catch |

## 二、审查发现的其他潜在问题（按风险排序）

| 风险 | 位置 | 说明 | 状态 |
|---|---|---|---|
| 中 | `catalog.js` 标题兜底 | 对每个缺标题会话读**整个**会话文件并解码全部事件；大工作区（几十个会话、GB 级）会让 `exec list` 变慢 | 建议后续加「只读首帧 + 缓存」 |
| 中 | `exec-route.js` | 请求体无大小上限；`action` 白名单已校验，但 JSON body 未限制 | 建议加 64 KiB 上限 |
| 中 | `importPack` 激活会话 | `resolveAgent` 失败的会话仅打日志，用户不知道哪个会话未激活 | 结果文本可附「未激活 N 个」 |
| 低 | `loadTitlesFromCommand` | 仍保留命令通道回退；失败时静默返回空标题 | 可加 `console.warn` |
| 低 | `pickPack`/`previewPack` | `JSON.parse` 在 try 内，但错误信息直接展示给用户（可能英文） | 可映射为本地化提示 |
| 低 | `runAction` | 404 才回退命令通道；500 会直接抛错（预期） | 可区分网络错误与业务错误 |
| 低 | 路径归一 | `normalizePath` 只转小写 + 统一斜杠，未处理 `..`/符号链接 | 跨平台场景建议 `realpath` |
| 低 | `groupFromWorkspaces` | 会话 cwd 缺失时归入「未分组」（与 DSH 侧边栏行为可能不同） | 已与用户确认「未分组」可接受 |
| 低 | `titleFromEvents` | 只取首条 `user/message` 文本前 24 字符；rename 事件优先 | 语义可接受 |

## 三、测试覆盖

- `tests/unit/**`：176+ 项（zip、会话头、导入导出、冲突策略、附件恢复、catalog、命令）。
- `tests/e2e/client-render.test.mjs`：4 项（注册、中英文标题、cwd 归组 + 回退）。
- 未覆盖：真实浏览器（headless 不可用，需人工验证）；DSH 真机 exec 路由（本轮部署后人工验证）。

## 四、结论

- 三个用户可见问题（标题、树不一致、命令失败）均指向「依赖命令通道/会话上下文」这一架构问题，已通过 ADR-0011 的 exec 路由 + 导入激活 + 事件标题兜底统一解决。
- 剩余风险均为性能/体验优化，不影响功能正确性；列入后续 TASKS（T5.x）。
