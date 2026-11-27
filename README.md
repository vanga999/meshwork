# Meshwork

[简体中文](README.zh-CN.md) · [Design](docs/design.md)

Meshwork is a desktop task workspace for people and AI agents. Define reusable bots, choose a working directory for each project, and arrange bots and people into a project workflow. Start a task in a project and follow the steps, decisions, and deliverables from its task card.

## Run the local desktop preview

Install Node.js 24.15 or newer, pnpm, and a recent Codex CLI with App Server support. Sign in with `codex login` if needed. Meshwork runs the installed CLI with your existing sign-in. In Settings you can choose the executable if automatic detection misses it.

```sh
pnpm install
pnpm dev
```

1. Open **Bots** and select **New bot** to define the bot's role, instructions, and Codex access.
2. Open **Projects** and select **New project** to choose an existing workspace folder. Add bot and human decision steps in the order you want them to run.
3. Select **Run task** on the project and enter the objective. Codex results and human decisions appear on its task card.

SQLite stores local data in the Electron user data directory. An interrupted step can be retried from its task card. Meshwork converts older directory-bound bots into projects with reusable bot steps and retains the previous task history.

Use `pnpm build` to build the app, `pnpm start` to launch an existing build, and `pnpm test` to test workflow handoffs and recovery.

## Bots and local projects

One bot can work in several projects. For example, define a code reviewer once, use it in two projects with different folders and review instructions, and add a human acceptance step to either workflow. Each task uses the directory and workflow selected by its project.

## Planned team projects

Create a project for your team, invite people with their own accounts, and manage your repositories, documents, tasks, and deliverables in one place. A team project can own bots and assign workflow steps to a bot or a real teammate. Configurable trigger nodes can start or resume work.

For example, one code review workflow can be triggered by a GitHub pull request or a GitLab merge request across the repositories selected for its trigger. It dispatches a Codex review of the specific revision, saves findings in the project, and can pass the report to a teammate before a separate step publishes it to the source platform. Other workflows can use manual triggers or webhooks for work outside a repository.

## Where work runs

The desktop app runs personal workflows locally. In the planned team deployment, an enrolled desktop or headless Linux runner can execute project steps, and the team server coordinates project work and shares context across accounts. Codex uses the credentials and workspace on the machine that executes the step.

## Status

The initial release focuses on local personal workflows. Team collaboration, external triggers, and the headless Linux runner are later milestones. See the [design document](docs/design.md) for the architecture and release criteria.

## License

[MIT](LICENSE)
