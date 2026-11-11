# 全量测试计划（v0.4，2026-11-11）

> 依据 `AGENTS.md` §8「测试优先」：先自动化/自测，只有人工视觉判断才留给用户。
> 用例清单与决策树覆盖矩阵见 `docs/TEST-CASES.md`（v1.2）；本文件保留分层计划与两轮执行记录。
> 测试工作区：`%TEMP%\dsh-mover-e2e-<随机>\`（含 `.dsh-e2e-marker`），存放 home、包、日志、截图。
> 证据列填写：命令输出 / JSON 断言 / 日志片段 / 截图路径；无法自动化的标「人工」并给精确步骤。

## 0. 项目现状摘要（2026-11-11）

- 功能：插件（Host + Client）已实现导出/导入（对话、工作区、附件）、选择树、高级选项、预览、落点、冲突策略、热重载尝试、exec 路由（ADR-0011）。
- 最近修复：exec 路由、导入激活（resolveAgent）、标题兜底（事件提取）、按 cwd 归组、空工作区/重名工作区、`reading 'size'`、`released v2 row lacks time`、重复 id 崩溃、new-id corrupt。
- 已知风险（`docs/CODE-REVIEW.md`）：标题兜底性能、exec body 上限、未激活会话提示、路径符号链接。
- 当前自动化：`node --test "tests/unit/**/*.test.mjs" "tests/e2e/**/*.test.mjs"`（180 项）。

## 1. 待测点清单

| 编号 | 待测点 | 自动化方式 |
|---|---|---|
| P1 | 核心库（zip/会话头/包格式/导入导出/附件） | 已有单元测试 |
| P2 | CLI export/import 往返 | CLI + 临时 home |
| P3 | exec 路由 action 全量 | Host 自检 + exec HTTP |
| P4 | Web UI 入口/树/标题/搜索/勾选 | 无头浏览器 CDP |
| P5 | 导出流程（目标/包名/高级选项/完成页） | 无头浏览器 CDP |
| P6 | 导入流程（选择/预览/落点/冲突/结果） | 无头浏览器 CDP |
| P7 | 热重载（导入后左侧即时出现） | 无头浏览器 CDP |
| P8 | 回归（重复 id/corrupt/空工作区/重名/附件/归档） | CLI + Host 自检 |
| P9 | 主题/语言 | 无头浏览器 CDP |
| P10 | 安全/边界（临时目录、路径、大文件） | CLI + 代码审查 |

## 2. 用例

### A. 核心库（自动化，`tests/unit/**`）

| ID | 上下文 | 动作 | 期望 | 验收标准 | 证据 |
|---|---|---|---|---|---|
| A1 | 任意 | `node --test "tests/unit/**/*.test.mjs"` | 全绿 | 0 fail | 命令输出 |
| A2 | 包格式 | 构造非法 manifest/zip/截断包 | 报错不崩溃 | 错误码/文本稳定 | 单测 |
| A3 | 会话头改写 | cwd/id/parentSession 改写 | 头正确、parent 映射 | 断言通过 | 单测 |

### B. CLI 往返（自动化）

| ID | 上下文 | 动作 | 期望 | 验收标准 | 证据 |
|---|---|---|---|---|---|
| B1 | 临时 home A 有会话 | `node src/cli/index.js export --home A --out X.dshpack` | 生成包 | 文件存在、>0 字节、退出码 0 | 命令输出 |
| B2 | 临时 home B 空 | `import --home B --pack X.dshpack` | 会话写入 | B 下出现会话文件；退出码 0 | 命令输出 + 目录列表 |
| B3 | B 已有同 id | 再次 import | 跳过不重复 | 退出码 0；无重复目录 | 目录列表 |
| B4 | 带 workspace.json 的 home | export/import | 工作区登记 | workspace.json 更新或明确提示 | 文件内容 |
| B5 | 损坏包（截断） | import | 明确错误 | 退出码非 0/错误文本 | 命令输出 |

### C. exec 路由（Host 自检/HTTP）

| ID | 上下文 | 动作 | 期望 | 验收标准 | 证据 |
|---|---|---|---|---|---|
| C1 | web 启动 | 启动日志 | `exec route registered` | 日志含该行 | web 日志 |
| C2 | 0 会话 home | `POST /api/mover/exec {action:list}` | 返回 catalog | HTTP 200、`ok:true` | curl/脚本输出 |
| C3 | 有会话 | `find/size/inspect` | 返回结果 | `ok:true`、结构正确 | 脚本输出 |
| C4 | 有会话 | `export` 到临时目录 | 生成包 | `ok:true`、文件存在 | 脚本输出 |
| C5 | 空 home | `import` 包 | 导入成功 | `ok:true`、会话出现 | 脚本输出 |
| C6 | 未登录/错误 body | `POST` 非法 JSON | 4xx/5xx JSON 错误 | 不崩溃 | 脚本输出 |

### D. Web UI（无头浏览器 CDP；不可用时标「人工」）

| ID | 上下文 | 动作 | 期望 | 验收标准 | 证据 |
|---|---|---|---|---|---|
| D1 | web 已启动 | 打开页面 | 侧边栏底部按钮存在 | DOM 文本匹配「迁移对话或工作区」 | 截图 + DOM |
| D2 | 同上 | 点击按钮 | 浮层出现 | DOM 含标题「对话与工作区迁移」 | 截图 |
| D3 | 浮层打开 | 读取树 | 工作区 + 会话标题（非 UUID） | 标题不含 `session-` | 截图 + DOM |
| D4 | 浮层打开 | 诊断行 | `workspaces≥1`、`locale=zh` | DOM 文本 | 截图 |
| D5 | 导出 Tab | 勾选对话/工作区 | 统计更新 | 文本「已选 N」 | 截图 |
| D6 | 导出 Tab | 搜索框（>20 对话） | 过滤生效 | 列表条数变化 | 截图 |
| D7 | 导出 Tab | 填目录 + 开始打包 | 完成卡片出现 | 卡片含路径/大小 | 截图 + 磁盘文件 |
| D8 | 导出 Tab | 高级选项 | 可见项 | 文本匹配 | 截图 |
| D9 | 导入 Tab | 选择文件（目录） | 包列表/填入 | 输入框非空 | 截图 |
| D10 | 导入 Tab | 预览 | 预览卡片 | 文本含「对话 N」 | 截图 |
| D11 | 导入 Tab | 另存为新对话导入 | 左侧出现新对话 | 侧边栏 DOM 出现新条目 | 截图 |
| D12 | 点开新对话 | 加载历史 | 正常显示 | 无 corrupt 文案 | 截图 |
| D13 | 主题切换 | 深/浅 | 浮层配色正常 | 无白底/黑底异常 | 截图 |
| D14 | 语言切换 | 中文→英文 | 文案英文 | 按钮文本英文 | 截图 |

### E. 回归（CLI + Host 自检）

| ID | 上下文 | 动作 | 期望 | 验收标准 | 证据 |
|---|---|---|---|---|---|
| E1 | 同 id 导入两次 | CLI import ×2 | 第二次跳过 | 无重复目录 | 目录列表 |
| E2 | 包内会话旧格式 | new-id 导入 | 不报 corrupt | 打开正常/服务重建成功 | 日志 |
| E3 | 会话全跳过 | 导入 | 不产生空工作区 | 工作区数量不变 | 日志 |
| E4 | 同名工作区 | 指定目录导入 | 名称去重 | 名称含「（导入 1）」 | 日志 |
| E5 | 带附件包 | 导入 | 附件恢复 | 附件目录文件数 >0 | 目录列表 |
| E6 | 归档会话 | 导出页 | 默认不可见 | 树中无归档 id | 截图 |

### F. 安全/边界（代码审查 + CLI）

| ID | 上下文 | 动作 | 期望 | 验收标准 | 证据 |
|---|---|---|---|---|---|
| F1 | 测试工作区 | 检查路径 | 在 %TEMP% 且带 marker | 路径断言 | 路径输出 |
| F2 | 导出目标不存在父目录 | export | 明确报错 | 错误文本 | 命令输出 |
| F3 | 含空格/中文路径 | export/import | 正常 | 文件生成 | 命令输出 |
| F4 | 大工作区 | export --files | 流式写盘 | 完成、内存不爆 | 耗时/日志 |

## 3. 执行记录（每轮回填）

> 执行后填写：日期、结果（✅/❌）、证据路径、备注。

### 第一轮（2026-11-11，自动化）

测试工作区：`%TEMP%\dsh-mover-e2e-491526332be6484b83ad9c28d5b06175`（证据：`packs/`、`logs/`、`cdp/`）。
自动化脚本：`tests/e2e/cdp/`（CDP 驱动）、`node --test`、CLI。

| ID | 结果 | 证据 | 备注 |
|---|---|---|---|
| A1 | ✅ | 全量 `node --test` 190 项通过 | 包含新增 CLI/归组用例 |
| B1 | ✅ | `logs/b1-export.log`：3 对话 46842 B | CLI 导出 |
| B2 | ✅ | `logs/b2-import.log`：3 会话文件 | 空 home 导入 |
| B3 | ✅ | `logs/b3-reimport.log`：跳过 3 个已存在，文件数不变 | 修复 CLI 冲突检测后 |
| B5 | ✅ | `logs/b5-bad.log`：非法 zip 退出码 1 | 损坏包 |
| C1 | ✅ | web 日志：`exec route registered` | ADR-0011 |
| D1 | ✅ | `cdp/01-home.png`、`cdp-result.json` | 侧边栏入口 |
| D2 | ✅ | `cdp/02-overlay.png` | 浮层打开 |
| D3 | ✅ | `cdp-result.json`：树标题「默认工作区 / default-workspace / 在工作区创建 Markdown 文件」 | 非 UUID |
| D4 | ✅ | 诊断 `workspaces=1 sessions=2 · locale=zh` | |
| D5 | ✅ | `cdp/03-selected.png`：已选 1 工作区 2 对话 | |
| D7 | ✅ | `cdp/05-export-done.png` + `export-out/cdp-test.dshpack`（26495 B） | 导出完成卡片 |
| D8 | ✅ | `cdp-result.json`：高级选项存在 | |
| D10 | ✅ | `cdp/06-preview.png`：对话 2 · 工作区 0 · 冲突 2 项 | 预览 |
| D11 | ✅ | exec 导入结果「已导入 1 个对话、跳过 1 个已存在」；侧边栏即时出现「在工作区创建 Markdown 文件」 | fork 成功 1 个（空会话无法 fork，DSH 限制） |
| D12 | ✅ | 点开 fork 出的会话：`corrupt=false`，历史/用量正常渲染 | 修复后复测（`cdp/23-clean-state.png`） |
| E1 | ✅ | B3 | |
| E5 | ✅（第二轮） | 见第二轮表（附件打包/恢复/显示全链路） | |
| F1 | ✅ | 测试工作区路径带 marker | |

**本轮结论**：
1. 导出/预览/导入/热重载/打开历史全部通过（CDP 自动化证据）。
2. `new-id` 采用官方 `fork`：源会话有 completed turn 时可靠；空会话无法 fork（跳过并提示），这是 DSH 限制。
3. 之前多轮失败产生的损坏会话已清理到 `<home>/corrupt-backup-3-.../`。
4. 遗留：空会话的「另存为新对话」不可用（文档说明即可，不阻塞）。

### 第二轮（2026-11-11，续）

| ID | 结果 | 证据 | 备注 |
|---|---|---|---|
| E4 | ✅ | exec 导入到新目录后 `list` 标题：`["default-workspace（导入 1）", "default-workspace"]` | 新路径重名自动去重 |
| E3 | ✅ | 会话全 skip 的导入：`登记 0 个工作区`，未产生空工作区 | `writtenByKey` 过滤 |
| E2 | ✅ | `--new-id` 导入空会话 → 文本「其中 1 个空会话无对话轮次，无法复制」；有消息会话 fork 成功且可打开 | DSH fork 限制 |
| D12 | ✅ | fork 会话点开 `corrupt=false`（`cdp/23-clean-state.png`） | |
| E5 | ✅ | 真实附件会话（PDF 3.5MB + DOCX 10KB）导出包 1.9MB，含 2 个 `attachments/v1/file-objects`；CLI 导入恢复 4 个附件文件；exec 导入后 fork 会话打开显示两个附件（`hasPdf/hasDocx=true`，`corrupt=false`） | 附件打包/恢复/显示全链路 |
| D13/D14 | ⏳ | 主题/语言切换需在 DSH 设置里操作，CDP 交互成本高，留待人工 | |

**第二轮结论**：工作区重名去重、空会话提示、附件包均验证通过；空工作区语义已由 ADR-0014 修订为「也登记」（E 版，DEVLOG 120）；主题/语言切换列为人工项。


