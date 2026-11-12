# SPEC §11 验收走查

> 对应 `docs/SPEC.md` §11。状态：✅ 通过 / 🟨 部分通过 / ⬜ 未验证 / ❌ 未达标。
> 证据来自 `tests/unit`、`tests/e2e`、`git log` 与 `DEVLOG.md`。

| # | 验收项 | 状态 | 证据与说明 |
|---|---|---|---|
| 1 | 侧边栏入口 2 秒内打开页面；明暗主题正常；中英文案完整 | ✅ | 用户已人工确认（2026-11-11）；CDP（无头 Chrome）已验证面板打开、导入/预览/冲突明细分项、覆盖结果、仅工作区模式 |
| 2 | 选择模型验收 | ✅ | 选择/分组/导出计划由 `plan-export`/`plan-import` 单测覆盖；CDP 已验证工作区勾选与导出/仅工作区模式 |
| 3 | 500MB 工作区导出进度完整，取消后清理 | 🟡 | 流式打包 500MB → 2.9 s；进度为“转圈 + 阶段文案”（ADR-0008）；**取消功能用户决定不做**（2026-11-11） |
| 4 | 跨平台验收 | ✅ | `tests/e2e/cross-platform.test.mjs`：Windows→POSIX cwd 改写、目录一致；POSIX→Windows 非法名重命名；预检报告可序列化 |
| 5 | 导入后工作区与对话出现在侧边栏 | ✅ | 一次性 home C 集成：`DSH-MOVER-AFTER {"workspaces":[{"title":"Proj","sessions":1}],"ungrouped":0}` |
| 6 | 同 id 会话重复导入默认不产生重复 | ✅ | `tests/unit/import-pack.test.mjs`（skip 策略）；`tests/unit/plan-import.test.mjs` |
| 7 | 截断/篡改包在导入前被拒绝 | ✅ | `tests/unit/zip-reader.test.mjs`（截断、CRC、坏 deflate）；`tests/e2e/security.test.mjs` |
| 8 | 大工作区导出内存峰值 ≤ 300MB | ✅ | 流式打包（`zip-stream`）：500MB 工作区 → 2.9 s、峰值 RSS 112.3 MB（`tests/e2e/performance.test.mjs`）；用户拍板按此实测判定通过（2026-11-11） |
| 9 | 包内不含凭据/缓存/node_modules | ✅ | `tests/e2e/security.test.mjs`：导出包条目不含 `.credentials`/`cache/`/`node_modules/`/`llm-deepseek` 等 |
| 10 | 转换报告覆盖每个被重命名/跳过/解引用条目 | ✅ | 文件符号链接默认解引用（导出文本统计「解引用 N / 跳过 N」）；目录链接/损坏链接跳过并记录；POSIX exec 位恢复（T9.1）；文件权限保真（ADR-0016 B1）——Linux 实测 P-04b/P-05a/P-05c 通过（203 项测试，2026-11-12） |

## 结论

- **通过**：1、2、4、5、6、7、8、9、10（10 随 T9.1 完成，DEVLOG 128）；
- **用户决定不做**：3 的取消功能；
- 未验证项已在 DEVLOG 与里程碑 DoD 中记录，未声称“已验证”。
