# 文档索引

## 当前状态（2026-11-27）

- 阶段：**SPEC v1.8**；TASKS **M0–M11 全部 ✅**。
  - 宿主跨版本维护闭环：0.2.2-rc.5 五类契约全部兼容（[报告](compat/reports/detect-0.2.2-rc.5.md)），npm 0.2.3 已发布验证（DEVLOG 151）。
  - 代码审查修复（M11，ADR-0019/ADR-0020）：可信导入、原子提交、路径安全、导出跳过可见、D 组杂项全部完成（DEVLOG 152–158）。
- 下一步：**0.3.0 待发布**（用户执行 `npm publish` + `git tag v0.3.0` + push，命令见 `docs/RELEASE.md`）。宿主更新时按 `docs/UPSTREAM-COMPAT.md` 触发检出-修复-回归流程。
- 未决项：B 组（真实进度/取消）与 T9.2/T9.4「用户决定不做」冲突，待用户明确解除；dsh-market 收录 PR 待提交；origin 缺 v0.2.2 tag（本地有）。
- 最近变更：见 `DEVLOG.md` 159。

## 文档地图

| 我想知道 | 去哪看 |
|---|---|
| 项目要做什么、范围、验收标准 | [SPEC.md](SPEC.md)（v1.8） |
| 为什么这样决策、备选方案与后果 | [DECISIONS.md](DECISIONS.md)（ADR-0001~0017 + 补充 + ADR-0018~0020） |
| 技术怎么实现、模块划分、接口 | [DESIGN.md](DESIGN.md)（含导入/导出行为决策树） |
| 导入行为边界与决策 | [IMPORT-BEHAVIOR-TREE.md](IMPORT-BEHAVIOR-TREE.md) |
| **DSH 宿主更新后的检出-修复-回归流程** | [**UPSTREAM-COMPAT.md**](UPSTREAM-COMPAT.md)（依赖清单、runbook、维护记录模板） |
| 黑盒用例与决策树覆盖矩阵 | [TEST-CASES.md](TEST-CASES.md)（v1.7） |
| 最近改了什么、验证了什么、卡在哪 | [DEVLOG.md](DEVLOG.md) |
| 项目分解、下一个任务、任务状态 | [TASKS.md](TASKS.md) |
| 工程纪律、提交规范、目录结构 | [../AGENTS.md](../AGENTS.md) |
| 项目简介与入口 | [../README.md](../README.md) |

## 文档维护规则

- `SPEC.md`：冻结后只能经“ADR + 升版本”修改（当前 v1.8）。
- `DECISIONS.md`：只追加；被替代时标注 Superseded，不删原文。
- `DEVLOG.md`：只追加；每个提交一条，编号递增。
- `DESIGN.md`：随实现更新；重大结构变化先在 `DECISIONS.md` 记一条。
- `INDEX.md`：**唯一允许原地更新的状态位**（当前状态、下一步、未决项）。
