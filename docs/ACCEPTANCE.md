# SPEC §11 验收走查

> 对应 `docs/SPEC.md` §11。状态：✅ 通过 / 🟨 部分通过 / ⬜ 未验证 / ❌ 未达标。
> 证据来自 `tests/unit`、`tests/e2e`、`git log` 与 `DEVLOG.md`。

| # | 验收项 | 状态 | 证据与说明 |
|---|---|---|---|
| 1 | 侧边栏入口 2 秒内打开页面；明暗主题正常；中英文案完整 | 🟨 | Client bundle 已加载（一次性 profile 首页 boot 含 `dsh-mover/client.js`）；中英文案已集中；**浏览器渲染/明暗主题未验证**（无浏览器控制，Edge headless 截图失败） |
| 2 | 选择模型验收 | 🟨 | 选择/分组/导出计划由 `plan-export`/`plan-import` 单测覆盖；UI 勾选逻辑已实现；**浏览器交互未验证** |
| 3 | 500MB 工作区导出进度完整，取消后清理 | 🟨 | 性能测试用 100MB 通过（scan 1ms / pack 368ms）；取消与清理未实现/未验证；进度为“转圈 + 阶段文案”（ADR-0008） |
| 4 | 跨平台验收 | ✅ | `tests/e2e/cross-platform.test.mjs`：Windows→POSIX cwd 改写、目录一致；POSIX→Windows 非法名重命名；预检报告可序列化 |
| 5 | 导入后工作区与对话出现在侧边栏 | ✅ | 一次性 home C 集成：`DSH-MOVER-AFTER {"workspaces":[{"title":"Proj","sessions":1}],"ungrouped":0}` |
| 6 | 同 id 会话重复导入默认不产生重复 | ✅ | `tests/unit/import-pack.test.mjs`（skip 策略）；`tests/unit/plan-import.test.mjs` |
| 7 | 截断/篡改包在导入前被拒绝 | ✅ | `tests/unit/zip-reader.test.mjs`（截断、CRC、坏 deflate）；`tests/e2e/security.test.mjs` |
| 8 | 大工作区导出内存峰值 ≤ 300MB | ❌ | 内存实现（`buildPack` 整文件读入）：100MB → rss 增量 101MB；500MB 预计 >500MB。**已知技术债：流式打包未实现** |
| 9 | 包内不含凭据/缓存/node_modules | ✅ | `tests/e2e/security.test.mjs`：导出包条目不含 `.credentials`/`cache/`/`node_modules/`/`llm-deepseek` 等 |
| 10 | 转换报告覆盖每个被重命名/跳过/解引用条目 | 🟨 | `restoreWorkspaceFiles` 记录重命名；跳过（`excluded`/`skipped`）有记录；符号链接“解引用/跳过”未实现（T1.8 只检测，未执行转换） |

## 结论

- **通过**：4、5、6、7、9；
- **部分通过**：1、2、3、10（主要受“无浏览器控制”与“流式打包未实现”限制）；
- **未达标**：8（内存峰值）；
- 未验证项已在 DEVLOG 与里程碑 DoD 中记录，未声称“已验证”。
