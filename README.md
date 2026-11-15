# Backlog.md Browser — DeepSeek Harness 插件

把 [Backlog.md](https://kuwork.github.io/Backlog.md/) 的 Web 看板嵌进 Harness：在「对话 / 轨迹」旁边多一个 **Backlog.md** 标签页，并按工作区独立启停 `backlog browser` 服务。

## 它做了什么

| 位置 | 内容 |
|---|---|
| 侧边栏 `Backlog.md` 面板 | 列表只占一行：工作区选择器（自绘下拉，每项两行——工作区名 + 服务地址 `127.0.0.1:6486`，左侧状态点）+ 当前工作区状态与按钮（启动 / 关闭 / 在新窗口打开 / 初始化），下方整块显示所选看板。**不依赖会话**，冷启动空状态就能用 |
| 对话区第三个标签页 | 未启动时居中显示「启动 Backlog.md Browser」按钮；启动后整页 iframe 显示看板，**不占顶部空间**（状态与操作都在会话头菜单里） |
| 会话头右侧 `Backlog.md` 按钮 | 状态下拉菜单：服务状态与端口（被占用换端口时会标出 `A → B`）、启动 / 关闭、在新窗口打开、初始化、刷新状态 |
| 初始化弹窗 | 收集 `backlog init` 的参数（项目名、backlog 目录、配置位置、任务前缀、AI 集成方式、写入的指令文件、Git 开关），提交后在**当前工作区**执行 |

工作区还没有 `backlog/config.yml`（或 `.backlog/config.yml`、`backlog.config.yml`）时，标签页与菜单显示的是「初始化」而不是「启动」。

> 面板是全局入口：会话头菜单和看板标签页都只存在于会话里，未发第一条消息的空状态没有这两处插槽，所以「先启动 browser」走侧边栏面板。

## 前置条件

```sh
npm i -g @kuwork/backlog.md@1.53.12-CN
backlog --version        # 期望 1.53.12-CN
```

> 已知坑：`@kuwork/backlog.md` 通过平台专属 optionalDependency 分发原生二进制。若版本自报与二进制不一致（表现为 `backlog browser` 启动后立刻退出、无输出），用 `npm i -g @kuwork/backlog.md@1.53.12-CN --force` 重装，并确认
> `%APPDATA%\npm\node_modules\@kuwork\backlog.md-windows-x64\package.json` 的 version 与 CLI 一致。
> 插件找不到 `backlog` 时会在结果里明确报错，不会静默失败。

## 安装

三选一，装完都要刷新页面。

**A. 从 GitHub（推荐，别人也能装）**

```sh
yyzt plugin --profile web add github:<你的 GitHub 用户名>/dsh-backlog-browser
```

git 源会在安装时由 pnpm 打包；本包没有构建步骤，所以不需要 `prepare`，也不会触发 pnpm 的构建脚本审批。如果装完后 `yyzt --profile web --dump-config` 里没有 `# == @local/dsh-backlog-browser` 这一层，基本就是网络或仓库路径写错。

> 上游 DSH 版本的 CLI 名为 `dsh`，把 `yyzt` 换成 `dsh` 即可；`--profile web` 换成你实际用的 profile。

**B. 本地路径（开发时用）**

```sh
yyzt plugin --profile web add <绝对路径>/backlog-plugin
```

**C. 对话里让 agent 装（创造模式 / cordis 预设）**

```
用 plugin_manager 的 install_bundle 安装 <绝对路径>/backlog-plugin
```

装完刷新页面：侧边栏多一个 `Backlog.md` 面板，对话区多一个 `Backlog.md` 标签页，会话头出现 `Backlog.md` 按钮。

## 安全提示

插件以**你的本机权限**运行：它会 `spawn` `backlog` 子进程、在 loopback 上起 HTTP 服务、并读写工作区里的 `backlog/` 目录。它不联网、不上传任何内容，也没有凭据。从别人仓库安装前请先读一遍 `index.js` 与 `client.js`——这就是仓库里全部可执行代码。

## 配置（可选）

在 profile 的 `cordis.patch.yml` 里覆盖该行的 `config`（**整行替换**，四个键要一起给）：

```yaml
- id: backlog-browser
  name: '@local/dsh-backlog-browser'
  config:
    executablePath: 'C:\Users\you\AppData\Roaming\npm\node_modules\@kuwork\backlog.md\cli.js'
    basePort: 6420
    portTries: 20
    readyTimeoutMs: 90000
```

| 键 | 默认 | 说明 |
|---|---|---|
| `executablePath` | 自动解析 | `backlog` 可执行文件或 `cli.js` 的绝对路径；不填时从 PATH 解析，并把 `.cmd` shim 还原成 `node <cli.js>` |
| `basePort` | `6420` | 端口窗基址 |
| `portTries` | `20` | 依次尝试的端口数，全占用后改用系统临时端口 |
| `readyTimeoutMs` | `90000` | 单次启动的就绪等待预算（首次冷启动要扫全仓库，较慢） |

## 多工作区端口策略

每个工作区一个独立进程、一个独立端口：

1. 起始端口 = `basePort + hash(工作区绝对路径) % 100`，不同工作区自然错开（实测两个工作区分别拿到 6487 / 6488）；
2. 被占用就顺延试下一个，最多 `portTries` 次；
3. 仍失败则交给系统分配临时端口；
4. **CLI 自己也可能换端口**：`backlog browser` 发现目标端口被占时会说「Using temporary port 6500」并真的绑到 6500。插件因此**读它的 stdout**，从 `Backlog.md browser interface running at http://localhost:<port>` 这行取实际端口，就绪轮询也改为跟着这个端口走，不再死等自己请求的那个；返回里带 `requestedPort` / `shiftedPort`，页面上标出「端口被占用，已改用 A → B」。
   （播报 URL 里的 `localhost` 换写成 `127.0.0.1`：进程只绑 loopback，而 `localhost` 可能解析到 `::1`。）

同一个工作区重复点「启动」不会起第二个进程（幂等）；「关闭」只终止该工作区的进程；插件卸载 / Harness 退出时统一回收（Windows 上用 Job Object 杀整棵进程树）。

## 实现要点

- **Host**（`index.js`）：`ctx.subprocess` 起 `backlog browser --port <n> --no-open`，用 `ctx.webServer.register({ kind: 'prefix', path: '/backlog', … })` **自己挂一条前缀路由**，暴露 `inspect|status|start|stop|init` 五个端点（同源 JSON，`POST /backlog/<endpoint>`）。
  两条路都试过并记录在案：`connection.rpc.intercept('/api', …)` 会被 Gateway 的既有拦截器顶掉（`shared RPC channel "/api" already has an interceptor`）；`connection.rpc.handle('/backlog', …)` 则因为它用 **connection 服务自己的 ctx** 去访问 `webServer`（而该行只 `inject: [webStartup]`）而抛 `cannot get property "webServer" without inject`。鉴权不自己做：入口调用 `ctx.connection.admit(req)`，复用 Connection 的 Host/Origin 校验与签名会话 cookie。
  就绪判定是轮询 HTTP 根路径（不解析动画状态行），但**端口从 CLI 的播报里取**，见上一节。
- **Client**（`client.js`）：`conversation.view`（`order: 20`，排在 chat=0、trajectory=10 之后）、`conversation.session.header.utilities`、`shell.overlay` 三处注册；视图根元素带 `data-conversation-composer-overlay`，才能拿到确定高度放满屏 iframe。
- 未修改 Harness 本体任何代码。

## 初始化检测规则

`backlog` 自己按这个顺序找项目：根目录 `backlog.config.yml` → `<数据目录>/config.yml` → 内置默认值。插件按同一顺序判断「当前工作区是否已初始化」：

1. 根目录存在 `backlog.config.yml` / `backlog.config.yaml`；
2. `backlog/` 或 `.backlog/` 下有 `config.yml` / `config.yaml`（含 `.yaml` 变体）；
3. 没有配置文件、但 `backlog/` 或 `.backlog/` 里已经有看板内容（`tasks/`、`completed/`、`archive/`、`drafts/`、`decisions/`、`docs/`、`milestones/` 之一）——目录本身就是证据，不再要求固定文件名。

只有目录存在且完全为空时才算「未初始化」。初始化完成后 Host 会再自检一次：`backlog init` 退出码为 0 却没找到配置时，会明确报错并附上 CLI 输出，而不是回到「未初始化」界面。

## 主题

菜单、弹窗、输入框与按钮用 Harness 的 `--dsw-alias-*` 设计 token 上色（`label-primary/secondary`、`bg-layer-1/2/3`、`border-l2/l3`、`interactive-bg-hover`、`state-error-primary`），亮色/暗色主题与主题切换都自动跟随；插件只注入一个 `bk-*` 类名的样式表，不改动本体的 CSS。

## 已知限制

- **工作区行菜单（重命名 / 删除附近）没有扩展插槽**：`WorkspaceBrowser` 里那两项是硬编码的。因此「初始化 / 关闭」放在了**会话头菜单和标签页内**（已确认的替代方案）。要真正放进工作区菜单，需给本体新增 `sidebar.workspaces.workspace.menu.item` 插槽。
- **iframe 依赖目标页可被嵌套**：`backlog browser` 未发 `X-Frame-Options`，可直接嵌入；若将来加上限制，需要改成同源反代（`ctx.connection.fetch.register`）。
- **Harness 若以 https 提供页面**，`http://127.0.0.1:<port>` 会被 mixed-content 拦截（当前默认 http://127.0.0.1:3080 无此问题）。
- 插件只管理**自己启动的**进程；你手动在终端跑的 `backlog browser` 不会被它接管或关闭。

## 卸载

```sh
yyzt plugin --profile web remove @local/dsh-backlog-browser
```

## 维护者：发布与发版

仓库本身就是可安装的 npm 包（无构建步骤），改完直接发版：

```sh
npm version patch          # 或 minor / major，自动改 package.json 并打 tag
git push --follow-tags
```

别人从 GitHub 装时按 tag 也行：`github:<user>/dsh-backlog-browser#v0.1.9`。

若还想发布到 npm（这样最省事：`yyzt plugin --profile web add dsh-backlog-browser@0.1.9`）：

```sh
npm publish --access public     # 首版之后记得改 version
```

两点注意：

- `@local/` 这个 scope 只适合本地开发。要公开发布，把 `package.json` 的 `name` 和 `cordis.patch.yml` 里那行的 `name` **同时**改掉（比如 `dsh-backlog-browser` 或 `@<你的 scope>/dsh-backlog-browser`），然后重装一次——旧 profile 里的 `link:` 记录指向旧名字，不会自动迁移。
- `private: true` 会挡住 `npm publish`（git 安装不受影响）；本仓库已去掉该字段。
