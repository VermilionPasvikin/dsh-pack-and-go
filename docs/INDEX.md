# 文档索引

## 当前状态（2026-11-18）

- 阶段：**SPEC v1.7**；TASKS M0–M9 全部 ✅（新增 T9.8/T9.9：deliverables 文件引用路径 + 权限预设状态归一化）；全量 **226 项通过**。
- 下一步：用户重启 DSH web 验证 `zmediakit-repair` 会话可继续输入；随后推送本地提交（当前环境无 GitHub 凭据，`git push` 需用户执行）。
- 未决项：已导入会话的 repair 已在本机执行（备份保留）；跨平台导入的权限归一化需安装/更新插件后对新导入包生效（当前 web profile 仍链接旧 clone `bcbcb11`）。dsh-market 收录 PR 仍待提交。
- 最近变更：见 `DEVLOG.md` 146。

## 文档地图

| 我想知道 | 去哪看 |
|---|---|
| 项目要做什么、范围、验收标准 | [SPEC.md](SPEC.md)（v1.7） |
| 为什么这样决策、备选方案与后果 | [DECISIONS.md](DECISIONS.md)（ADR-0001~0017 + 补充） |
| 技术怎么实现、模块划分、接口 | [DESIGN.md](DESIGN.md)（含导入/导出行为决策树） |
| 导入行为边界与决策 | [IMPORT-BEHAVIOR-TREE.md](IMPORT-BEHAVIOR-TREE.md) |
| 黑盒用例与决策树覆盖矩阵 | [TEST-CASES.md](TEST-CASES.md)（v1.7） |
| 最近改了什么、验证了什么、卡在哪 | [DEVLOG.md](DEVLOG.md) |
| 项目分解、下一个任务、任务状态 | [TASKS.md](TASKS.md) |
| 工程纪律、提交规范、目录结构 | [../AGENTS.md](../AGENTS.md) |
| 项目简介与入口 | [../README.md](../README.md) |

## 文档维护规则

- `SPEC.md`：冻结后只能经“ADR + 升版本”修改（当前 v1.7）。
- `DECISIONS.md`：只追加；被替代时标注 Superseded，不删原文。
- `DEVLOG.md`：只追加；每个提交一条，编号递增。
- `DESIGN.md`：随实现更新；重大结构变化先在 `DECISIONS.md` 记一条。
- `INDEX.md`：**唯一允许原地更新的状态位**（当前状态、下一步、未决项）。
