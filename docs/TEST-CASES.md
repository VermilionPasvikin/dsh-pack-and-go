# 黑盒验收用例（v1.7，2026-11-18）

> 目的：按 **导入/导出行为决策树**（`DESIGN.md` §3.1/§3.2、`IMPORT-BEHAVIOR-TREE.md`）逐路径覆盖，供任意平台复用。
> 执行方式定义：**单测** = `node --test "tests/unit/**/*.test.mjs" "tests/e2e/**/*.test.mjs"`；**CDP** = `tests/e2e/cdp/` 脚本（无头 Chrome）；**集成** = 一次性 `DSH_HOME` 真实导入/导出；**用户人工确认** = 仅纯视觉判断（主题/语言观感）。
> 平台策略：用例默认全平台；平台相关项在「平台」列标注并给分化版本（§3）。Windows 符号链接需开发者模式/管理员，缺失时自动 skip。

## 1. 导出用例（决策树 §3.2）

| ID | 背景 | 动作 | 预期结果 | 执行方式 | 平台 | 验收结果 |
|---|---|---|---|---|---|---|
| E-01 | 对话+工作区默认模式 | 选 1 对话 + 勾「将工作区一并导出」→ 导出 | 包内含 sessions/ 与 workspaces/ 条目；结果含路径/大小 | 单测 + CDP | 全平台 | ✅ `export-pack`/`commands` 测试 |
| E-02 | 仅工作区（含文件） | 切「仅工作区」→ 选工作区 → 导出 | 包内 `workspaces/<key>/files/...` 含文件内容；结果「N 个文件」 | 单测 + CDP | 全平台 | ✅ `commands`「仅导出工作区（含文件）」 |
| E-03 | 仅工作区（空文件夹） | 选空目录工作区 → 导出 | `fileCount: 0`、仅目录骨架；导入后目录存在 | 单测 | 全平台 | ✅ `commands`「空目录」用例 |
| E-04 | 目标解析 | 分别填目录、完整文件名、已存在文件名 | 目录→自动命名；同名自动加序号；文件原样 | 单测 | 全平台 | ✅ `resolveExportTarget` 测试 |
| E-05 | 目标目录不存在 | 目标填 `Z:\nope\x.dshpack`（macOS：`<不存在目录>/x.dshpack`） | 红字「目标目录不存在」，无产物 | 单测 + CDP | 全平台 | ✅ `commands` 测试；2026-11-12 macOS CDP：红字「导出失败：目标目录不存在：/tmp/.../no-such-parent/sub」，无产物 |
| E-06 | 输入校验 | 不选内容 / 目标为空 点导出 | 按钮禁用 / 红字提示 | CDP + 单测 | 全平台 | ✅ CDP 截图（36/37） |
| E-07 | fork 链 | 导出含子代理会话 / `--no-fork` | 默认连带祖先+后代；关闭时仅所选 | 单测 | 全平台 | ✅ `commands` fork 链用例 |
| E-08 | 排除规则 | 默认 / 全量 / 额外排除 `.cache` | 默认排除 `node_modules` 等；全量不排除；额外排除生效 | 单测 | 全平台 | ✅ `scan`/`plan-export` 测试 |
| E-09 | 预检默认执行（ADR-0012） | 直接导出（不传 preflight） | 结果含「预检 N 项」 | 单测 + CDP | 全平台 | ✅ CDP「预检 0 项」（DEVLOG 127） |
| E-10 | 附件 | 导出带附件会话 / 附件缺失 | 包内 `attachments/`；缺失仅 warning 不阻断 | 单测 + 集成 | 全平台 | ✅ 附件 E2E（TEST-PLAN 第二轮） |
| E-11 | 符号链接 | 工作区含文件链接 / 目录链接 / 损坏链接 | 文件链接解引用；目录/损坏跳过并统计 | 单测 | 条件（Windows 需链接权限） | ✅ 逻辑通过；Windows 无权限时 skip；POSIX 已实测（Linux/macOS 2026-11-12，见 §3 P-04） |
| E-12 | 压缩 | 默认压缩 / CLI `--no-compress` | 不压缩包明显更大、可读 | 单测 | 全平台 | ✅ `export-pack` 测试 |
| E-13 | Windows 非法名 | 预检含 `?*:` 文件名 | 预检列出风险（导入时重命名） | 单测 | Windows | ✅ `preflight`/cross-platform 测试 |
| E-14 | 失败清理 | 连续导出两次 / 中断 | 无 `write after end`、无半截包 | E2E | 全平台 | ✅ `export-pack` sink 修复（DEVLOG 049） |
| E-15 | 结果文本 | 任意导出 | 含路径、字节、文件数、预检、解引用统计 | CDP | 全平台 | ✅ CDP 截图 |

## 2. 导入用例（决策树 §3.1）

| ID | 背景 | 动作 | 预期结果 | 执行方式 | 平台 | 验收结果 |
|---|---|---|---|---|---|---|
| I-01 | 输入校验 | 空包路径 / 空目标 / 不存在包 / 非 zip / manifest 非法 | 各自红字，不启动导入 | 单测 | 全平台 | ✅ `commands`/`import-pack` 测试 |
| I-02 | 已移除能力 | 传 `sessionPolicy: new-id` | 红字「另存为新对话已移除」 | 单测 | 全平台 | ✅ `commands` 测试 |
| I-03 | 目标不存在 | 导入到新目录 | 自动创建目录并写入 | 单测 + CDP | 全平台 | ✅ 回归（DEVLOG 119） |
| I-04 | 目标=现有工作区路径 | 目标指向已登记工作区父目录 | 复用工作区、原地覆盖（不迁移） | 单测 + CDP | 全平台 | ✅ `plan-import` + CDP 回归 |
| I-05 | 工作区落点 | 新目录 / 已存在登记目录 / 标题重名 | 新建 / 复用 / 加「（导入 N）」 | 单测 + CDP | 全平台 | ✅ `register` 测试（TEST-PLAN E4） |
| I-06 | 空目录复用（D3） | 目标下同名目录存在且为空、未登记 | 直接复用（不加序号） | 单测 | 全平台 | ✅ `plan-import`/`commands` 用例 |
| I-07 | 非空未登记目录 | 目标下同名目录存在且有内容、未登记 | 新建 `标题 (1)`，不覆盖用户目录 | 单测 | 全平台 | ✅ `commands` 测试 |
| I-08 | 空工作区登记（E） | 包内工作区无会话 | 登记工作区 + 还原文件；结果标「暂无对话」 | 单测 | 全平台 | ✅ `commands`「空目录」用例 |
| I-09 | 文件还原/覆盖统计 | 目标已有同名文件 | 覆盖写；结果「覆盖 N 个文件」 | 单测 | 全平台 | ✅ `workspaces` 测试 |
| I-10 | 会话跳过/覆盖 | 同 id 存在，选跳过 / 覆盖（同 cwd） | 跳过不写 / 原地覆盖恢复 | 单测 + CDP | 全平台 | ✅ `commands`/CDP 覆盖回归 |
| I-11 | 迁移覆盖 | 同 id 存在，覆盖且目标 cwd 不同 | 旧目录备份移除、写目标；结果「迁移覆盖：<工作区>/<会话>（原→新）」 | 单测 + CDP | 全平台 | ✅ `commands` + CDP（DEVLOG 119） |
| I-12 | 覆盖但 cwd 未知 | 现有会话无 cwd 信息 | 拒绝覆盖并红字提示 | 单测 | 全平台 | ✅ `commands` 测试 |
| I-13 | 纯对话包 | 会话无 workspaceKey | 保留源 cwd；结果「未归组」提示 | 单测 | 全平台 | ✅ `commands` 测试 |
| I-14 | fork 链父子 | 父会话被跳过 | 子会话强制跳过；结果提示 | 单测 | 全平台 | ✅ `plan-import` 测试 |
| I-15 | 附件跟随 | 会话被跳过 | 其引用的附件不恢复 | 单测 | 全平台 | ✅ `commands` 测试 |
| I-16 | 附件恢复 | 正常附件 / 同名已存在 / EPERM / 缺失 | 恢复；覆盖；warning 不阻断 | 单测 + 集成 | 全平台 | ✅ 附件 E2E |
| I-17 | 归组 | 导入后会话 attach / 迁移时 detach 旧归属 | 左侧归入新工作区 | 单测 + 集成 | 全平台 | ✅ 启动修复日志（DEVLOG 123/125） |
| I-18 | 双记账修复 | 同一会话被两个工作区记账 | 启动时只保留 cwd 匹配者，其余 detach | 集成 | 全平台 | ✅ 启动日志 `grouping detached`（DEVLOG 125） |
| I-19 | 结果提示 | 迁移/覆盖文件/未归组/旧格式/重启 | 文本逐项提示（含「已打开需重启」） | 单测 + CDP | 全平台 | ✅ CDP 结果文本 |
| I-20 | 旧格式包（<4） | 导入 sessionFormat<4 的包 | 直接写 v3 会话文件；结果提示「旧格式，打开时自动迁移」 | 单测 | 全平台 | ✅ `import-pack`「旧格式包（sessionFormat 3）」 |
| I-21 | 包版本过新 | schemaVersion > 2 | 红字「请升级插件」 | 单测 | 全平台 | ✅ `manifest-io` 测试 |
| I-22 | 导入后激活/广播 | 导入后左侧即时出现 | resolveAgent + attach + 广播 | 集成 | 全平台 | ✅（DEVLOG 90/109） |
| I-23 | 预览冲突明细 | 预览含冲突包 | 按类型列出「对话「X」：覆盖将迁移 / 原地恢复」 | CDP | 全平台 | ✅ CDP（DEVLOG 119） |
| I-24 | 交付文件路径 | 跨平台/换目录导入含 `deliverables/presented` 的会话 | 文件路径改写为工作区相对 POSIX 路径；`meta.cwd` 映射到目标 cwd；按钮可打开 | 单测 + 集成 | 全平台 | ✅ 单测/导入集成（DEVLOG 145） |
| I-25 | 权限预设状态 | 跨平台导入含 `permission/preset=auto` 的会话 | auto → workspace-write、danger-full-access → workspace-write、never → ask；目标 profile 可恢复会话 | 单测 + 集成 | 全平台 | ✅ 单测/导入集成（DEVLOG 146） |
| R-01 | repair 已导入会话 | 对含失效绝对路径的会话执行 `repair` | 按最长后缀恢复相对路径、meta.cwd 置为会话 cwd，写前备份 | 单测 + CLI | 全平台 | ✅ 单测 + zmediakit-repair（DEVLOG 145） |
| R-02 | repair 权限预设 | 对含 `auto` 预设的会话执行 `repair` | auto/danger-full-access 归一化为 workspace-write；会话可恢复 | 单测 + CLI | 全平台 | ✅ CLI repair + debug 重启验证（DEVLOG 146） |

## 3. 跨平台专项与平台分化

| ID | 背景 | 动作 | 预期结果 | 执行方式 | 平台 | 验收结果 |
|---|---|---|---|---|---|---|
| P-01 | cwd 跨平台改写 | Windows 导出包在 POSIX 规则下导入 | header.cwd 改写为目标路径，目录一致 | E2E | 全平台（模拟） | ✅ `cross-platform.test` |
| P-02 | 合法名转换 | POSIX→Windows 含 `?*:` 文件名 | 自动安全重命名并写转换报告 | E2E | 全平台（模拟） | ✅ `cross-platform.test` |
| P-03 | 预检报告可序列化 | 预检含风险工作区 | JSON 可读、逐项列出 | E2E | 全平台 | ✅ `cross-platform.test` |
| P-04a | 符号链接（Windows） | 创建文件/目录链接后导出 | 文件链接解引用；目录链接跳过并记录 | 单测 | Windows（需开发者模式/管理员） | ✅ 2026-11-11 本机（开发者模式已开，scan/commands 用例通过） |
| P-04b | 符号链接（POSIX） | 同上 | 同上（必跑） | 单测 | Linux/macOS | ✅ 2026-11-12 Linux（真实 POSIX 链接 + CLI 导出/导入：解引用 1、跳过 2）；✅ 2026-11-12 macOS（单测：文件链接解引用、目录链接跳过） |
| P-05a | exec 位（POSIX） | 导入含可执行位文件 | 恢复 `755` | 单测 | Linux/macOS | ✅ 2026-11-12 Linux（devlog 134 修复 mode 传递；0755→0755，含单测）；✅ 2026-11-12 macOS（POSIX 目标恢复 0755） |
| P-05c | 文件权限保真（POSIX，ADR-0016 B1） | 导入含 `0600`/`0644`/`0755` 文件；含 setuid 位；win32 源包 | 按包内 mode 恢复（剥离 setuid/setgid/sticky）；win32 源包仅恢复 exec 位；Windows 目标忽略 | 单测 + E2E | Linux/macOS | ✅ 2026-11-12 Linux（devlog 136）；✅ 2026-11-12 macOS（0600/0644/0755、setuid 剥离、win32 源包） |
| P-05d | 目录权限保真（POSIX，ADR-0016 B2） | 导入含 `0700`/`0755`/`0500` 目录（含文件）；目录 setuid；win32 源包 | 两阶段恢复（先建可写 → 写完文件 → 深→浅 chmod），剥离 setuid/setgid；win32 源包跳过；Windows 目标忽略 | 单测 | Linux/macOS | ✅ 2026-11-12（devlog 138，Windows 208 项：199 pass + 9 skip）；✅ 2026-11-12 macOS（0700/0755/0500 两阶段；测试清理修复后 220/220） |
| P-05b | exec 位（Windows） | 同上 | 忽略权限位并记录 | 单测 | Windows | ✅ 代码条件分支 |
| P-06a | Windows 保留名/长路径 | 预检 `CON`、超长路径 | 列出风险，导入时跳过/重命名 | 单测 | Windows | ✅ `preflight` 测试（部分） |
| P-06b | macOS 大小写不敏感 | 同名不同大小写文件 | 预检列出大小写冲突 | 单测 | macOS | ✅ 2026-11-12 macOS（APFS 大小写不敏感实测：A.txt/a.txt 同 inode；detectCaseCollisions 报 1 冲突） |
| P-06c | Linux 大小写敏感 | 同名不同大小写文件 | 无冲突 | 单测 | Linux | ✅ 2026-11-12 Linux（冲突 0；darwin 阳性对照 2） |
| P-07 | 中文/空格/长路径 | 导出导入中文目录、空格路径 | 正常读写 | 单测 + CDP | 全平台 | ✅ 现有测试（中文路径） |
| P-08 | 主题/语言 | 切换深/浅主题、中/英 | 文案与配色跟随 | 用户人工确认 | 全平台 | ✅ 用户已确认（2026-11-11） |
| P-09 | 状态事件 cwd（ADR-0017） | Windows 源包含 `working-directory/change`（源根内 + 源根外）→ POSIX 目标导入 | 事件 cwd 映射为目标绝对路径（源根外回落目标根）；同平台字节不变；会话在目标端可完成投影 | 单测 + 集成 | 全平台（模拟） | ✅ 2026-11-12 macOS：单测 + 一次性 DSH_HOME headless 复验（projection 通过） |

### 3.1 跨平台 CI（0.3.2 起的发布闸门）

自动化位置：`.github/workflows/cross-platform.yml`（push main / PR / 手动触发）。

| Job | 平台 | 内容 | 判据 |
|---|---|---|---|
| `test` | ubuntu-latest、macos-latest、windows-latest（Node 22.15.0） | `npm run check` + `node --test "tests/unit/**/*.test.mjs"` + `node --test "tests/e2e/**/*.test.mjs"` | 三平台 0 失败（POSIX-only 用例在 Windows 上按既有逻辑 skip 属预期） |
| `host-boot` | ubuntu-latest（Node 24） | `npm i -g pnpm@11 @deepseek-ai/dsh@0.2.2-rc.5` → 一次性 `DSH_HOME`（带 `.dsh-e2e-marker`）→ `dsh ci-web --from-default-profile web` → `dsh plugin --profile ci-web add "file:\$GITHUB_WORKSPACE"` → `SELFTEST` 探针启动 | 日志含 `command registered: mover`、`exec route registered: /api/mover/exec`、`DSH-PACK-AND-GO-SELFTEST`；且不含 `pending (waiting for service` |

**执行方式**

1. 推送后打开仓库 Actions 页，等待 `cross-platform` 运行结束；
2. 失败时下载 `host-boot-logs` 工件（含 `boot.log`、`dump.log`），按失败 job 的命令逐条本地复跑；
3. 三平台全绿 + `host-boot` 通过后，才允许 `npm publish`（见 `docs/RELEASE.md` §2）。

**本地等价命令（Linux）**

```bash
npm run check
node --test "tests/unit/**/*.test.mjs"
node --test "tests/e2e/**/*.test.mjs"
export DSH_HOME="$(mktemp -d)" && printf 'dsh-e2e' > "$DSH_HOME/.dsh-e2e-marker"
dsh ci-web --from-default-profile web --dump-config
dsh plugin --profile ci-web add "file:$PWD"
DSH_PACK_AND_GO_SELFTEST=1 timeout 90 dsh ci-web --no-open --port 0
```

**已知限制**：CI 只覆盖 headless 行为（命令注册、exec 路由、目录读取、CLI 往返），
界面观感（进度条、估算 loading、覆盖二次确认）仍需在真机点开确认。

## 4. 覆盖矩阵（决策树节点 → 用例）

| 决策树节点 | 用例 |
|---|---|
| 导出：模式（对话+工作区 / 仅工作区） | E-01、E-02、E-03 |
| 导出：目标解析/校验/清理 | E-04、E-05、E-06、E-14 |
| 导出：会话集合/fork | E-07 |
| 导出：排除/预检/附件/符号链接/压缩 | E-08、E-09、E-10、E-11、E-12 |
| 导出：结果与平台差异 | E-13、E-15、P-01、P-02 |
| 导入：输入/包格式 | I-01、I-02、I-20、I-21 |
| 导入：目标目录 | I-03、I-04 |
| 导入：工作区落点（新建/复用/序号/空目录/空工作区/文件） | I-05、I-06、I-07、I-08、I-09 |
| 导入：会话冲突（跳过/覆盖/迁移/未知 cwd/纯对话/父子） | I-10、I-11、I-12、I-13、I-14 |
| 导入：附件 | I-15、I-16 |
| 导入：登记/归组/激活/双记账 | I-17、I-18、I-22 |
| 导入：结果提示/预览 | I-19、I-23 |
| 导入：文件引用路径/repair | I-24、R-01 |
| 导入：权限预设/repair | I-25、R-02 |
| 跨平台与平台分化 | P-01、P-02、P-03、P-04a/b、P-05a/b、P-06a/b/c、P-07、P-08、P-09 |

## 5. 未决/待补用例（供排期）

| 用例 | 缺口 | 建议 |
|---|---|---|
| P-04b 符号链接（POSIX） | ✅ Linux 2026-11-12；✅ macOS 2026-11-12（单测） | 关闭 |
| P-05a exec 位 | ✅ Linux 2026-11-12（修复后）；✅ macOS 2026-11-12 | 关闭 |
| P-06b/c 大小写 | ✅ P-06c Linux 2026-11-12；✅ P-06b macOS 2026-11-12（APFS 实测） | 关闭 |
| P-05c 文件权限保真（B1） | ✅ Linux 2026-11-12；✅ macOS 2026-11-12 | 关闭 |
| P-05d 目录权限保真（B2） | ✅ 已实现（devlog 138）；✅ macOS 2026-11-12（B2 用例清理修复后） | 关闭 |
| P-09 状态事件 cwd（ADR-0017） | ✅ 2026-11-12 macOS 修复验证（单测 + headless）；✅ 全量执行复核 | 关闭 |

> 2026-11-12 Linux 专项明细见 DEVLOG 134/136（一次性 `DSH_HOME`）；macOS 全量执行明细与证据见 §6（DEVLOG 140）。

## 6. 执行记录

- 每轮执行：日期、平台、执行方式、结果（通过/失败+证据）；失败汇总后修复。
- 2026-11-11（Windows），单测 195 项通过；CDP 覆盖 E-06/E-09/E-11/I-10/I-11/I-19/I-23/P-08（用户确认）。
- 2026-11-12（Linux，Ubuntu 24.04 / Node 24）：单测 + E2E **198 项通过**；Linux 专项 P-04b ✅、P-05a ✅（先失败→devlog 134 修复）、P-06c ✅；侧边栏「迁移对话或工作区」中英文与浮层经 Firefox WebDriver 实测（无 Chrome，未跑 CDP 脚本）。
- 2026-11-12（Linux，devlog 136，ADR-0016 B1）：文件权限保真上线，**203 项通过**（198 + 5 新增）；P-05c ✅（0600/0644/0755 往返、setuid 剥离、win32 源包跳过、Windows 目标忽略）；CLI 端到端同样验证。
- 2026-11-18（Linux）：I-24/R-01 上线；全量 **223 项通过**；真实 `zmediakit-repair` 会话 repair 101 处（2 个交付路径 + 100 个 meta.cwd）。
- 2026-11-18（Linux）：I-25/R-02 上线；全量 **226 项通过**；同一会话再 repair 2 处（auto→workspace-write、danger-full-access→workspace-write），debug 副本重启后「Session unavailable」消失。
- 2026-11-12（Windows，devlog 138，ADR-0016 B2）：目录权限保真上线，**208 项**（199 pass + 9 个 POSIX 用例预期 skip）；P-05d ✅（0700/0755/0500 两阶段、目录 setuid 剥离、win32 源跳过、Windows 目标忽略、导出目录条目 mode）。
- 2026-11-12（macOS，devlog 139，ADR-0017）：`working-directory/change` 状态事件 cwd 跨平台改写上线；新增 10 项测试；全量 205 项 → 204 pass + 1 项 macOS 既有环境问题（workspaces B2 用例清理只读目录 EACCES，另行修复）；P-09 ✅（真实包 CLI 导入一次性 DSH_HOME 后 headless 投影通过）。
- 2026-11-12（macOS，Apple Silicon / Node 24.14 / Chrome 156 headless CDP，devlog 140）：全量 `node --test "tests/unit/**/*.test.mjs" "tests/e2e/**/*.test.mjs"` → **220 项全部通过**（220 pass / 0 fail / 0 skip，2047 ms）；平台专项 P-04b/P-05a/P-05c/P-05d/P-06b/P-07/P-09 通过（P-06b 另以 APFS 同 inode 实测佐证）。CDP 在一次性 `DSH_HOME` + 隔离 profile 内跑通 E-01/E-02/E-05/E-06/E-15/I-02/I-11/I-19/I-23，证据见本地 `/tmp/dsh-pack-and-go-web-IjaLyr/evidence/`（截图 + JSON）。
- 2026-11-12 macOS 问题记录（非阻塞）：① E-05 文案不一致——实现提示「目标目录不存在」，原用例写「父目录不存在」，行为正确，已按实现校正用例预期；② 迁移覆盖后热归组失败——`controller reindex failed ... workspace/move-invalid: the session is not accounted`，结果「归组 0 个对话」，重启后 `grouping repaired 2 sessions` 且工作区/对话正确，符合 UI「重启 DSH 后可见」提示，属热更新限制（建议后续降噪/文档化，未改代码）；③ `tests/unit/workspaces.test.mjs` B2 用例在 POSIX 清理 0500 目录报 EACCES，测试代码修复（finally 先 chmod 0700 再 rm），全量恢复 220/220。
