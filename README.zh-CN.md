# Meshwork

[English](README.md) · [设计文档](docs/design.zh-CN.md)

Meshwork 是一个桌面任务工作台，供人和 AI Agent 一起完成任务。选定项目工作目录后，可以使用 Codex 或 Claude Code 运行任务，也可以为项目选择可复用的本地工作流。任务卡集中记录各步骤的进度、决定和交付物。

## 运行本地桌面预览版

安装 Node.js 24.15 或更高版本、pnpm，以及你要使用的 Agent，可选支持 App Server 的近期 Codex CLI 或 Claude Code 2.1.259 及以上版本。使用原生连接时，在对应 CLI 中完成登录或凭据配置。

```sh
pnpm install
pnpm dev
```

1. 打开 **Projects**，选择 **New project**，指定一个已有工作目录并保存。工作流默认为 **Default agent**。
2. 在项目卡上选择 **Run task**，选定 Coding Agent 并输入目标。工作流结束后，任务进入 **Awaiting review**。在任务详情的 **Conversation** 里发返工意见，确认结果后点击 **Mark complete** 结束任务。
3. 需要编排时，在 **Bots → New workflow** 中用 **+** 添加任务所选 Agent、自定义 Bot 或人工决策节点。拖动节点调整布局，从输出端口拖到输入端口连线。保存后在 **Edit project** 中选择这套工作流。需要自定义角色和权限时，在 **Bots → New bot** 中定义 Bot。

在 **Settings → Coding agents** 可设置新任务的默认 Agent，并分别选择各 CLI 的可执行文件。进入 **Configure LLM**，可以填写 Base URL、模型和可选 API Key。Codex 使用 Responses API 基础地址，例如 `https://gateway.example.com/v1`。Claude Code 使用 Anthropic Messages API 基础地址，例如 `https://gateway.example.com`。Base URL 留空时使用对应 CLI 的原生连接。任务重试和返工沿用启动时记录的 Agent、模型和接口地址。自定义接口的 API Key 由系统凭据存储加密，并与对应地址绑定。

点击 **Add agent** 可以新增独立命名的 Codex 或 Claude Code 配置，也可以选择 **Custom command** 接入自己的可执行文件。命令参数每行一个，直接传给程序。程序以当前账户权限在任务工作目录运行，并负责按请求的权限访问工作区。

自定义命令从 stdin 读取一个 JSON 对象，其中包含 `version`（当前为 `1`）、`prompt`、`workspace` 和 `access`（`read-only` 或 `workspace-write`），以及可选的 `model`、`followUp`、`sessionId`。配置 Base URL 后还会收到 `endpoint.baseUrl` 和临时的 `endpoint.token`，访问该地址时把 token 作为 Bearer 凭据发送。命令向 stdout 返回一个 JSON 对象，包含 `summary`、`details` 和工作区相对路径数组 `files`。返回 `sessionId` 后，返工会把它传回命令。诊断信息写入 stderr，运行失败时返回非零退出码。

SQLite 数据库保存在 Electron 用户数据目录。步骤中断后可从任务卡发起重试。已有项目的步骤会迁移为本地工作流并自动关联原项目，任务历史会保留。

`pnpm build` 构建应用，`pnpm start` 启动已有构建，`pnpm test` 测试工作流交接与恢复。

## Bot 与本地项目

本地工作流可供多个项目选用。例如，在 Bots 页面编排代码审查 Bot 和人工验收步骤，再让两个项目选择这一工作流。任务使用各自项目的目录，并记录启动时的工作流与 Bot 版本。

依赖已满足的节点可并行执行。将多个分支连到同一个汇合节点，它会等所有上游完成，再使用各分支的结果继续处理。并行节点共用项目工作目录。此前保存的顺序工作流会在画布上显示为原顺序的连线。

## 规划中的团队项目

团队服务端可创建项目并分派给个人，集中管理仓库、文档、任务和交付物。团队项目可以拥有 Bot，工作流可以把步骤派给 Bot 或成员，并通过可配置的触发节点启动或继续任务。

例如，同一套代码审核流程可以接收 GitHub PR 或 GitLab MR 事件，触发节点可以选择多个仓库。流程派发 Codex 审核指定版本，将发现保存到项目里，也可以先交给成员确认，再由独立的步骤将报告发布回来源平台。其他流程也能通过手动触发或 Webhook 处理仓库之外的任务。

## 任务在哪里执行

桌面端在本机运行个人工作流。按团队部署设计，登记过的桌面或无界面 Linux 执行节点可以执行项目步骤，团队服务端负责协调项目任务并在账号之间同步上下文。Codex 使用执行机器上的登录态和工作区。

## 项目进度

首版聚焦本地个人工作流。团队协作、外部触发和无界面 Linux 执行节点是后续里程碑。架构和验收条件见[设计文档](docs/design.zh-CN.md)。

## 许可证

[MIT](LICENSE)
