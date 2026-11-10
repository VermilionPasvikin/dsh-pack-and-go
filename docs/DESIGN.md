# 技术设计

> 状态：**骨架**（规格 v1.0 已冻结；实现前补全并随代码更新）。
> 需求见 [SPEC.md](SPEC.md)，决策见 [DECISIONS.md](DECISIONS.md)。

## 1. 形态与边界

- **形态**：DSH Cordis bundle（Host + Client），安装到目标 DSH profile。
- **Host**（Node，DSH 进程内）：文件搬运、zstd 帧改写、平台预检、与 DSH 服务对接、进度流。
- **Client**（浏览器 React 组件）：选择树、导出/导入流程、进度、错误态。
- **CLI**（阶段待定，ADR-0004）：与 UI 共用 core，不依赖 Cordis / 浏览器 API。
- **不做**：云同步、网络传输、凭据搬运、自动重启 DSH。

## 2. 模块划分（规划，实现时更新）

```
src/
  core/           # 纯 Node：包格式、manifest、校验、平台预检、路径映射
  core/zstd/      # 帧扫描、首帧解码、重压缩、拼接、自校验
  core/workdir/   # 工作区扫描、排除规则、跨平台转换、报告
  host/           # Cordis 插件：服务、任务编排、Remote 进度流、DSH 服务适配
  client/         # Web UI：页面、选择树、流程状态机
  cli/            # 待定（ADR-0004）
tests/
  unit/           # core 单元测试
  e2e/            # 一次性 DSH_HOME 下的端到端
```

## 3. 数据流

**导出**：读取工作区/会话（DSH 服务）→ 用户选择 → 扫描 + 平台预检 → 流式写包 → 校验 → 完成。

**导入**：读包 → 校验 manifest/版本 → 平台预检与转换 → 冲突处理 → 写会话（含 cwd 改写）→ 复制附件 → 恢复工作区文件 → 登记工作区 → 完成。

## 4. 关键接口（实现前用 `cordis_inspect_query` 复核）

- `sessionPersistence.list()/stat()` → `location.path`、`header`、`sizeBytes`（不要硬编码会话根）。
- `workspaceRegistry.list()/create()`；Client 侧 `ctx.workspaces.create({ path })`、`insertSessionBefore`。
- `attachment` 服务 / `<DSH_HOME>/attachments/v1`：被引用对象的复制。
- Host Remote：`@Remote({ mode: 'stream' })` 推送进度帧。
- Client UI 落点：`sidebar.panellist` + `main`（key `mover`）+ `settings.section` 兜底。

## 5. 包格式

见 SPEC §8（`.dshpack` v2）。实现时需要补充：

- zip 容器的写入/读取方案（不新增依赖）；
- 校验和策略（包级默认；逐文件为可选“严格模式”）；
- 大文件与大量小文件的流式读写与内存上限。

## 6. 风险与缓解

见 SPEC §9 风险表。实现时在 DEVLOG 记录每次实测结果。

## 7. 未决

- CLI 入口阶段与命名（ADR-0004）。
- UI 进度协议细节（帧结构、节流频率）。
- zstd 帧扫描在损坏帧上的错误恢复边界。
