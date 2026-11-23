# 文档索引

## 当前状态（2026-11-23）

- 阶段：**SPEC v1.7**；TASKS M0–M9 全部 ✅，**M10 进行中**：对 DSH 0.2.2-rc.5 的正式检出完成（**五类契约全部兼容，无需修复**，报告 [compat/reports/detect-0.2.2-rc.5.md](compat/reports/detect-0.2.2-rc.5.md)），回归 R1–R4 全过，基线已升级到 0.2.2-rc.5，发布 0.2.3 准备就绪。
- 下一步：T10.8 发布 0.2.3（`npm login && npm publish` + `git tag v0.2.3` + push，需用户凭据；手册见 `docs/RELEASE.md`）。
- 未决项：已导入会话的 repair 已在本机执行（备份保留）；dsh-market 收录 PR 仍待提交。
- 最近变更：见 `DEVLOG.md` 150。

## 文档地图

| 我想知道 | 去哪看 |
|---|---|
| 项目要做什么、范围、验收标准 | [SPEC.md](SPEC.md)（v1.7） |
| 为什么这样决策、备选方案与后果 | [DECISIONS.md](DECISIONS.md)（ADR-0001~0017 + 补充） |
| 技术怎么实现、模块划分、接口 | [DESIGN.md](DESIGN.md)（含导入/导出行为决策树） |
| 导入行为边界与决策 | [IMPORT-BEHAVIOR-TREE.md](IMPORT-BEHAVIOR-TREE.md) |
| **DSH 宿主更新后的检出-修复-回归流程** | [**UPSTREAM-COMPAT.md**](UPSTREAM-COMPAT.md)（依赖清单、runbook、维护记录模板） |
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
