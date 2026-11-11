# 修复计划：导出/导入缺陷与实现漂移（待审核）

> 状态：**计划，未实施**。审核通过后按优先级执行。
> 证据：本机一次性 profile（3080）+ 复现脚本。

## 1. 已复现的缺陷与根因

### D1（P0）流式 zip 报 `write after end`，同一次导出留下两个包

**现象**：第二次导出报 `write after end`；桌面出现 `dsh-pack-and-go-…214319.dshpack`（66629 B，截断）和 `…214320.dshpack`（76497 B，正常）。

**复现**：`%TEMP%\repro-zip2.mjs`（混合 `data` 条目 + 6 个 90 KB 不可压缩文件，连续 5 轮）→ 5/5 失败：
```
round=0 FAIL write after end
…
```

**根因**：`src/core/zip-stream.js` 的 deflate 分支混用 `deflater.pipe(output, { end: false })` 与
`pipeline(reader, deflater)`。`pipeline` 只等待 `deflater` 结束，但 `pipe` 到 `output` 的背压写入
（`drain` 等待）可能在该 entry 写完后仍在进行；主流程随后 `output.end()`，迟到的 `output.write`
即报 `write after end`。截断文件是失败前已写入的部分。

**修复**：
1. 用 `pipeline(reader, deflater, sink)` 替代 pipe：`sink` 是 Writable，负责 `output.write` 背压与 `csize` 计数；
2. 失败时删除本次输出文件（避免半成品）；
3. 目标文件已存在时加唯一后缀（时间戳 + 随机 4 位），避免同名覆盖/双包；
4. 单测：混合 data + 不可压缩大文件、连续多轮、失败路径（人为抛错后文件不存在）。

**验收**：复现脚本 5/5 成功；连续 3 次真实导出只产生 1 个包；失败时无残留文件。

### D2（P0）导入后侧边栏无新增

**现象**：导入成功的提示，但左侧工作区/对话列表无变化。

**证据**：`mover-debug.log` 显示 3 次 `import` 均执行成功；会话目录已有同 id 会话 → 默认冲突策略
`skip` 跳过（SPEC §11-6 期望），但提示没有说明；且写盘后 **Host 未通知 DSH 侧边栏刷新**
（DSH 侧边栏通过 `workspace.follow` 流更新，导入是直接写文件，不触发事件）。

**修复**：
1. 导入结果文本区分 `新增 N / 跳过 M（已存在）/ 覆盖 K`；
2. 导入后对目标工作区调用 Host 侧登记/通知（`workspaceRegistry` 已有实例时 `attachSession`；
   无法通知时在 UI 明确提示「重启 DSH 后可见」）；
3. UI 导入成功后刷新本插件列表（已做），并提示侧边栏可能需要刷新。

**验收**：一次性 home 中导入一个新包 → 提示含新增数量；重启后列表出现；重复导入提示「跳过 1」。

### D3（P0）导入选择文件：必须直接在文件选择器里选

**现状**：DSH 没有文件选择服务（Host Service 目录无 `directory-picker` 可查询项；Client Service 只有
`uiWorkspace.pickDirectory`）。当前「选择文件」= 选目录 + `mover find` 列出包再选。

**可选方案**：
- **A（推荐）新增一个小型上传通道**：Host 注册 `POST /api/mover/upload`（`webServer.register`），
  Client 用 `<input type="file">` 读取 `.dshpack` 并上传到临时目录，返回 Host 路径后走现有 import。
  - 需要 ADR（新 HTTP 路由 + 信任检查）；工作量中等；真正实现「文件选择器直接选文件」。
- **B**：保持目录选择 + 扫描（用户已否决）。
- **C**：等待 DSH 提供 `pickFile` 服务（不可控）。

**待你决定**：选 A（我做 ADR + 实现），还是接受 B。

## 2. 实现漂移修复计划（SPEC 对照）

| 优先级 | 漂移项 | 计划 | 验收 |
|---|---|---|---|
| P1 | FR-1 顶部显示平台 / `DSH_HOME` / DSH 版本 | 浮层头部加一行小字（Host 命令返回） | 页面可见 |
| P1 | FR-2 底部统计「已选 N 个工作区 · M 个对话 · 含项目文件约 X MB」 | 用 catalog 的 sizeBytes + 扫描结果估算 | 勾选后实时更新 |
| P1 | FR-2「只带文件」行内操作、搜索、显示已归档 | 先做搜索（>20 对话时）与「只带文件」；归档开关后置 | 手工验证 |
| P1 | FR-6/7 导入预览（来源/平台/冲突/转换摘要） | 命令 `mover inspect <pack>` 返回 manifest 摘要，UI 导入前显示 | 预览内容与包一致 |
| P1 | FR-8 落点与路径映射（原路径/新位置） | 导入页加「放回原路径 / 指定目录」选择 | 两种落点均可用 |
| P2 | FR-9 转换报告展示 | 导入结果里展示 conversions 列表 | 重命名文件可见 |
| P2 | FR-1 设置页备用入口 | 注册 `settings.section` | 设置页可见 |
| P2 | 导出精确进度、取消 | 依赖 ADR-0008 升级（HTTP 流），先不做 | — |

## 3. 执行顺序（审核后）

1. **D1**（zip 修复 + 清理 + 单测）→ 复现脚本验证 → 提交；
2. **D2**（导入提示 + 通知/重启提示）→ 一次性 home 验证 → 提交；
3. **D3**（按选定方案实现文件选择）→ 浏览器验证 → 提交；
4. 漂移 P1 任务逐项实现，每项独立提交。

## 4. 待你决定

1. D3 选 **A（新增上传通道 + ADR）** 还是 B（保留目录扫描）？
2. 漂移修复是否按 P1 → P2 全部做完，还是先做 D1/D2 + 部分 P1？
