# 文档索引

## 当前状态（2026-11-27）

- 阶段：**SPEC v1.9**；TASKS **M0–M13 全部实现完成（0.3.0 / 0.3.1 / 0.3.2 就绪，0.3.2 待发布）**。
  - 宿主跨版本维护闭环：0.2.2-rc.5 五类契约全部兼容（[报告](compat/reports/detect-0.2.2-rc.5.md)），npm 0.2.3 已发布验证（DEVLOG 151）。
  - 代码审查修复（M11，ADR-0019/ADR-0020）：可信导入、原子提交、路径安全、导出跳过可见、D 组杂项全部完成（DEVLOG 152–158）。
  - 代码审查剩余项（M12/M13，ADR-0021/ADR-0022/ADR-0023）：真实进度与取消（P2-6）、预览真实性与界面清理（P2-7/P2-9/P2-10/P2-11/P2-12）已完成（DEVLOG 160–166）。
- 下一步：**T13.6（0.3.2 回归与发布准备）**；M12（0.3.1）与 M13 实现均已完成，0.3.2 待发布。宿主更新时按 `docs/UPSTREAM-COMPAT.md` 触发检出-修复-回归流程。
- 未决项：dsh-market 收录 PR 待提交；origin 缺 v0.2.2 tag（本地有）；0.3.x 发布待用户执行。T9.2/T9.4 旧决定已由 ADR-0021 取代。
- 最近变更：见 `DEVLOG.md` 166。

## 文档地图

| 我想知道 | 去哪看 |
|---|---|
| 项目要做什么、范围、验收标准 | [SPEC.md](SPEC.md)（v1.9） |
| 为什么这样决策、备选方案与后果 | [DECISIONS.md](DECISIONS.md)（ADR-0001~0017 + 补充 + ADR-0018~0023） |
| 技术怎么实现、模块划分、接口 | [DESIGN.md](DESIGN.md)（含导入/导出行为决策树） |
| 导入行为边界与决策 | [IMPORT-BEHAVIOR-TREE.md](IMPORT-BEHAVIOR-TREE.md) |
| **DSH 宿主更新后的检出-修复-回归流程** | [**UPSTREAM-COMPAT.md**](UPSTREAM-COMPAT.md)（依赖清单、runbook、维护记录模板） |
| 黑盒用例与决策树覆盖矩阵 | [TEST-CASES.md](TEST-CASES.md)（v1.7） |
| 最近改了什么、验证了什么、卡在哪 | [DEVLOG.md](DEVLOG.md) |
| 项目分解、下一个任务、任务状态 | [TASKS.md](TASKS.md) |
| 工程纪律、提交规范、目录结构 | [../AGENTS.md](../AGENTS.md) |
| 项目简介与入口 | [../README.md](../README.md) |

## 文档维护规则

- `SPEC.md`：冻结后只能经“ADR + 升版本”修改（当前 v1.9）。
- `DECISIONS.md`：只追加；被替代时标注 Superseded，不删原文。
- `DEVLOG.md`：只追加；每个提交一条，编号递增。
- `DESIGN.md`：随实现更新；重大结构变化先在 `DECISIONS.md` 记一条。
- `INDEX.md`：**唯一允许原地更新的状态位**（当前状态、下一步、未决项）。
