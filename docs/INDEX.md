# 文档索引

## 当前状态（2026-11-10）

- 阶段：需求规格 **v1.0 已冻结**；M0/M1/M2 完成；**M3（Web UI）未开始**。
- 下一步：**T3.1**（按 `TASKS.md` §0 规则接续）——Client bundle 骨架。
- 未决项：CLI 入口阶段（ADR-0004）。
- 最近变更：见 `DEVLOG.md` 最后一条。

## 文档地图

| 我想知道 | 去哪看 |
|---|---|
| 项目要做什么、范围、验收标准 | [SPEC.md](SPEC.md) |
| 为什么这样决策、备选方案与后果 | [DECISIONS.md](DECISIONS.md) |
| 技术怎么实现、模块划分、接口 | [DESIGN.md](DESIGN.md) |
| 最近改了什么、验证了什么、卡在哪 | [DEVLOG.md](DEVLOG.md) |
| 项目分解、下一个任务、任务状态 | [TASKS.md](TASKS.md) |
| 工程纪律、提交规范、目录结构 | [../AGENTS.md](../AGENTS.md) |
| 项目简介与入口 | [../README.md](../README.md) |

## 文档维护规则

- `SPEC.md`：冻结后只能经“ADR + 升版本”修改；不再追加讨论性内容。
- `DECISIONS.md`：只追加；被替代时标注 Superseded，不删原文。
- `DEVLOG.md`：只追加；每个提交一条，编号递增。
- `DESIGN.md`：随实现更新；重大结构变化先在 `DECISIONS.md` 记一条。
- `INDEX.md`：**唯一允许原地更新的状态位**（当前状态、下一步、未决项）。
