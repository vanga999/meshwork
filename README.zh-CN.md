# Meshwork

[English](README.md) · [设计文档](docs/design.zh-CN.md)

Meshwork 是一个桌面任务工作台，供人和 AI Agent 一起完成任务。选定项目工作目录后即可用默认 Codex 运行任务，也可以为项目选择可复用的本地工作流。任务卡集中记录各步骤的进度、决定和交付物。

## 运行本地桌面预览版

安装 Node.js 24.15 或更高版本、pnpm，以及支持 App Server 的近期版本 Codex CLI。需要登录时执行 `codex login`。Meshwork 使用已安装的 CLI 和已有登录态。自动检测找不到 Codex 时，可以在 Settings 中选择可执行文件。

```sh
pnpm install
pnpm dev
```

1. 打开 **Projects**，选择 **New project**，指定一个已有工作目录并保存。工作流默认为 **Default Codex**。
2. 在项目卡上选择 **Run task** 并输入目标。工作流结束后，任务进入 **Awaiting review**。在任务详情的 **Conversation** 里发返工意见，确认结果后点击 **Mark complete** 结束任务。
3. 需要编排时，在 **Bots → New workflow** 中用 **+** 添加默认 Codex、自定义 Bot 或人工决策步骤。保存后在 **Edit project** 中选择这套工作流。需要自定义角色和权限时，在 **Bots → New bot** 中定义 Bot。

SQLite 数据库保存在 Electron 用户数据目录。步骤中断后可从任务卡发起重试。已有项目的步骤会迁移为本地工作流并自动关联原项目，任务历史会保留。

`pnpm build` 构建应用，`pnpm start` 启动已有构建，`pnpm test` 测试工作流交接与恢复。

## Bot 与本地项目

本地工作流可供多个项目选用。例如，在 Bots 页面编排代码审查 Bot 和人工验收步骤，再让两个项目选择这一工作流。任务使用各自项目的目录，并记录启动时的工作流与 Bot 版本。

## 规划中的团队项目

团队服务端可创建项目并分派给个人，集中管理仓库、文档、任务和交付物。团队项目可以拥有 Bot，工作流可以把步骤派给 Bot 或成员，并通过可配置的触发节点启动或继续任务。

例如，同一套代码审核流程可以接收 GitHub PR 或 GitLab MR 事件，触发节点可以选择多个仓库。流程派发 Codex 审核指定版本，将发现保存到项目里，也可以先交给成员确认，再由独立的步骤将报告发布回来源平台。其他流程也能通过手动触发或 Webhook 处理仓库之外的任务。

## 任务在哪里执行

桌面端在本机运行个人工作流。按团队部署设计，登记过的桌面或无界面 Linux 执行节点可以执行项目步骤，团队服务端负责协调项目任务并在账号之间同步上下文。Codex 使用执行机器上的登录态和工作区。

## 项目进度

首版聚焦本地个人工作流。团队协作、外部触发和无界面 Linux 执行节点是后续里程碑。架构和验收条件见[设计文档](docs/design.zh-CN.md)。

## 许可证

[MIT](LICENSE)
