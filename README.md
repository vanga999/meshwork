# Meshwork

[简体中文](README.zh-CN.md) · [Design](docs/design.md)

Meshwork is a desktop task workspace for people and AI agents. Choose a working directory for a project and run tasks with default Codex or a reusable local workflow. Follow steps, decisions, and deliverables from the task card.

## Run the local desktop preview

Install Node.js 24.15 or newer, pnpm, and a recent Codex CLI with App Server support. Sign in with `codex login` if needed. Meshwork runs the installed CLI with your existing sign-in. In Settings you can choose the executable if automatic detection misses it.

```sh
pnpm install
pnpm dev
```

1. Open **Projects**, choose **New project**, and save it with an existing workspace folder. The workflow defaults to **Default Codex**.
2. Select **Run task** on the project and enter the objective. Results appear on the task card.
3. To arrange steps, open **Bots → New workflow** and use **+** to add default Codex, a custom bot, or a human decision. Save the workflow and select it in **Edit project**. Use **Bots → New bot** to define a custom role and access.

SQLite stores local data in the Electron user data directory. An interrupted step can be retried from its task card. Meshwork migrates existing project steps to local workflows, selects them in their original projects, and retains task history.

Use `pnpm build` to build the app, `pnpm start` to launch an existing build, and `pnpm test` to test workflow handoffs and recovery.

## Bots and local projects

Several projects can select the same local workflow. For example, combine a code reviewer and a human acceptance step on the Bots page, then select that workflow in two projects. Each task uses its project's directory and records the workflow and bot versions it starts with.

## Planned team projects

The team server can create projects and assign them to individual teammates. It manages repositories, documents, tasks, and deliverables. A team project can own bots and assign workflow steps to a bot or a teammate. Configurable trigger nodes can start or resume work.

For example, one code review workflow can be triggered by a GitHub pull request or a GitLab merge request across the repositories selected for its trigger. It dispatches a Codex review of the specific revision, saves findings in the project, and can pass the report to a teammate before a separate step publishes it to the source platform. Other workflows can use manual triggers or webhooks for work outside a repository.

## Where work runs

The desktop app runs personal workflows locally. In the planned team deployment, an enrolled desktop or headless Linux runner can execute project steps, and the team server coordinates project work and shares context across accounts. Codex uses the credentials and workspace on the machine that executes the step.

## Status

The initial release focuses on local personal workflows. Team collaboration, external triggers, and the headless Linux runner are later milestones. See the [design document](docs/design.md) for the architecture and release criteria.

## License

[MIT](LICENSE)
