# 文档索引

## 当前状态（2026-11-12）

- 阶段：**SPEC v1.3**；TASKS M0–M9 全部 ✅（T9.2 取消 / T9.4 精确进度为「不做」）；Windows + Linux 专项验证完成。
- 下一步：ADR-0016 **B2（目录权限保真）** 待用户决定；macOS CI；发布准备（GitHub 已上传，npm 未发布）。
- 未决项：B2 是否立项；macOS 平台专项。
- 最近变更：见 `DEVLOG.md` 最后一条。

## 文档地图

| 我想知道 | 去哪看 |
|---|---|
| 项目要做什么、范围、验收标准 | [SPEC.md](SPEC.md)（v1.3） |
| 为什么这样决策、备选方案与后果 | [DECISIONS.md](DECISIONS.md)（ADR-0001~0016） |
| 技术怎么实现、模块划分、接口 | [DESIGN.md](DESIGN.md)（含导入/导出行为决策树） |
| 导入行为边界与决策 | [IMPORT-BEHAVIOR-TREE.md](IMPORT-BEHAVIOR-TREE.md) |
| 黑盒用例与决策树覆盖矩阵 | [TEST-CASES.md](TEST-CASES.md)（v1.3） |
| 最近改了什么、验证了什么、卡在哪 | [DEVLOG.md](DEVLOG.md) |
| 项目分解、下一个任务、任务状态 | [TASKS.md](TASKS.md) |
| 工程纪律、提交规范、目录结构 | [../AGENTS.md](../AGENTS.md) |
| 项目简介与入口 | [../README.md](../README.md) |

## 文档维护规则

- `SPEC.md`：冻结后只能经“ADR + 升版本”修改（当前 v1.3）。
- `DECISIONS.md`：只追加；被替代时标注 Superseded，不删原文。
- `DEVLOG.md`：只追加；每个提交一条，编号递增。
- `DESIGN.md`：随实现更新；重大结构变化先在 `DECISIONS.md` 记一条。
- `INDEX.md`：**唯一允许原地更新的状态位**（当前状态、下一步、未决项）。
