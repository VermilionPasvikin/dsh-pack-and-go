# 发布手册（0.2.2）

> 目标：用户一条命令安装（GitHub / npm），并在 [dsh-market](https://github.com/dsh-market/dsh-market) 里一键安装。

## 0. 前置条件

- Node.js ≥ 22.15；DSH `>=0.2.0 <0.3.0`（当前验证：DSH 0.2.2-rc.2 / Electron runtime 24）
- npm 已登录且能发布 `dsh-pack-and-go`（当前未占用）：`npm whoami`
- GitHub 已登录（提 dsh-market 收录 PR 用）：`gh auth status`
- 版本号在 `package.json`：`0.2.2`；`engines.dsh` 已声明

## 1. 本地校验

```bash
npm run check
node --test "tests/unit/**/*.test.mjs" "tests/e2e/**/*.test.mjs"
npm pack --dry-run          # 确认 files 列表：README / screenshots / src / manifest
```

`npm pack` 产物只用于本地验证，`*.tgz` 已在 `.gitignore` 中。

## 2. 发布 npm

```bash
npm publish --access public
npm view dsh-pack-and-go version repository
```

- `repository` 必须指回 GitHub 仓库，dsh-market 才会把 npm 包和收录条目关联起来（下载量统计依赖它）。
- 失败回滚：72 小时内可 `npm unpublish dsh-pack-and-go@0.2.2 --force`；超过则用 `npm deprecate dsh-pack-and-go@0.2.2 "..."`。
- npm 可能先创建 `0.0.0-stage` 占位版本（staged publishing），正式版本通常在半分钟内上线；若 `npm view` 仍只看到占位，稍等重查，**不要重复 publish**（会报 `cannot publish over the previously published versions`）。

## 3. 一条命令安装验证

用一次性 `DSH_HOME`，不要动真实 `~/.dsh`：

```bash
TMP=$(mktemp -d /tmp/dsh-pack-and-go-release-XXXXXX)

# GitHub 渠道（无需 npm）
DSH_HOME=$TMP dsh plugin --profile verify add github:VermilionPasvikin/dsh-pack-and-go
DSH_HOME=$TMP dsh --profile verify --dump-config | grep -q dsh-pack-and-go && echo OK-github

# npm 渠道（发布后）
DSH_HOME=$TMP dsh plugin --profile verify-npm add dsh-pack-and-go
DSH_HOME=$TMP dsh --profile verify-npm --dump-config | grep -q dsh-pack-and-go && echo OK-npm

# 启动 Web，确认侧边栏出现「迁移对话或工作区」
DSH_HOME=$TMP dsh --profile verify --no-open --port 0 --host 127.0.0.1
```

2026-11-12 本机实测：GitHub 渠道安装 3.6s，日志出现
`[dsh-pack-and-go] command registered: mover` 与 `exec route registered: /api/mover/exec`；
浏览器（CDP）确认侧边栏按钮存在。

## 4. 打 tag 与推送

```bash
git tag -a v0.2.2 -m "dsh-pack-and-go 0.2.1"
git push origin main
git push origin v0.2.2
```

## 5. 提交 dsh-market 收录

dsh-market 的目录数据来自 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)：
在对方的 fork 里新增 **一个文件**，然后提 PR。本仓库已备好内容：
`docs/market/awesome-dsh-plugin.yml`。

```bash
# 在 awesome-dsh-plugin 的 fork 中
cp docs/market/awesome-dsh-plugin.yml \
   data/plugins/VermilionPasvikin__dsh-pack-and-go.yml
git checkout -b add-dsh-pack-and-go
git add data/plugins/VermilionPasvikin__dsh-pack-and-go.yml
git commit -m "Add dsh-pack-and-go"
git push
gh pr create --title "Add dsh-pack-and-go" --body-file pr-body.md
```

收录要求自查：

- [x] `package.json` 声明 `dsh.bundle.patch`（不是只有 `dsh.client`）
- [x] 仓库真实可运行（含单元/E2E/CDP 证据）
- [x] 仓库创建满 1 天
- [x] 说明使用引号包裹（含 `.dshpack` 等符号，避免 YAML 解析问题）
- [x] category 取 `session`（对话与工作区迁移）
- [x] icon 为 GitHub 托管的位图：`docs/icon-180.png`
- [x] `screenshots.json` + `docs/screenshots/*.png`（1–8 张，详情页展示）

合并后目录会随 awesome-dsh-plugin 重建并进入 dsh-market；npm 下载量按 `repository` 自动关联。审核期间用户可以先用 GitHub 渠道安装。

## 6. 发布后验收

```bash
# 在装好 dshmarket 的 DSH 里（一次性 home）
dsh plugin --profile web add dshmarket
# 重启，插件市场搜索 "Pack and Go"，安装，确认侧边栏入口

# 或直接验证目录索引里的条目
curl -fsSL https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json | grep -o '"dsh-pack-and-go"' | head
```

## 7. 已知注意

- 桌面 App 的 `desktop` profile 由 Electron 管理；CLI 安装后需要重启 DSH，且不要同时让 App 与 CLI 写同一 profile。
- 市场安装与 CLI 安装走同一个 `pluginManager.installBundle`，兼容性只认 `engines.dsh`（范围 `>=0.2.0 <0.3.0`）。
- 仅当仓库没有 npm 包或源码不可直接安装时，才需要在收录 YAML 里加 `tarball`；本项目不需要。
