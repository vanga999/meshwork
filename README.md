# Meshwork

[简体中文](README.zh-CN.md) · [Design](docs/design.md)

Meshwork is a desktop task workspace for people and AI agents. Choose a working directory, then run tasks with Codex, Claude Code, or a reusable local workflow. Follow steps, decisions, and deliverables from the task card.

## Run the local desktop preview

Install Node.js 24.15 or newer and pnpm. Install the agent you want to use, either a recent Codex CLI with App Server support or Claude Code 2.1.259 or newer. Configure its credentials in its own CLI for the native connection.

```sh
pnpm install
pnpm dev
```

1. Open **Projects**, choose **New project**, and save it with an existing workspace folder. The workflow defaults to **Default agent**.
2. Select **Run task**, choose the coding agent, and enter the objective. When the workflow finishes, the task enters **Awaiting review**. Send feedback from **Conversation** and select **Mark complete** when you accept the result.
3. To arrange steps, open **Bots → New workflow** and use **+** to add a coding agent, a custom bot, or a human decision. Drag nodes to position them and drag from an output to an input to connect them. Save the workflow and select it in **Edit project**. Use **Bots → New bot** to define a custom role and access.

In **Settings → Coding agents**, set the default for new tasks and manage each executable separately. **Configure LLM** accepts a base URL, model, and optional API key. Codex uses a Responses API base URL such as `https://gateway.example.com/v1`. Claude Code uses an Anthropic Messages API base URL such as `https://gateway.example.com`. Leave the base URL blank to use the agent CLI's own connection. A task keeps its agent, model, and endpoint for retries and follow-ups. The API key for a custom endpoint is encrypted by the operating system and only used for the matching endpoint.

Use **Add agent** to create another named Codex or Claude Code profile, or select **Custom command** to run your own executable. Custom command arguments are entered one per line and passed directly to the executable. The command runs in the task workspace, under your account, and is responsible for enforcing the requested access.

A custom command receives one JSON object on stdin with `version` (currently `1`), `prompt`, `workspace`, and `access` (`read-only` or `workspace-write`). It can also receive `model`, `followUp`, and `sessionId` if available. With a custom Base URL, it receives `endpoint.baseUrl` and a temporary `endpoint.token` to send as a bearer token. Write one JSON object with `summary`, `details`, and `files` to stdout. `files` lists paths relative to the workspace. Include `sessionId` to resume your own session on a follow-up. Send diagnostics to stderr and use a nonzero exit code on failure.

SQLite stores local data in the Electron user data directory. An interrupted step can be retried from its task card. Meshwork migrates existing project steps to local workflows, selects them in their original projects, and retains task history.

Use `pnpm build` to build the app, `pnpm start` to launch an existing build, and `pnpm test` to test workflow handoffs and recovery.

## Bots and local projects

Several projects can select the same local workflow. For example, combine a code reviewer and a human acceptance step on the Bots page, then select that workflow in two projects. Each task uses its project's directory and records the workflow and bot versions it starts with.

Nodes without unmet dependencies run in parallel. To join branches, connect each branch to the same input node. It runs after all its incoming nodes complete and receives their results. Parallel nodes share the project workspace. Previously saved workflows open with their original sequential links.

## Planned team projects

The team server can create projects and assign them to individual teammates. It manages repositories, documents, tasks, and deliverables. A team project can own bots and assign workflow steps to a bot or a teammate. Configurable trigger nodes can start or resume work.

For example, one code review workflow can be triggered by a GitHub pull request or a GitLab merge request across the repositories selected for its trigger. It dispatches a Codex review of the specific revision, saves findings in the project, and can pass the report to a teammate before a separate step publishes it to the source platform. Other workflows can use manual triggers or webhooks for work outside a repository.

## Where work runs

The desktop app runs personal workflows locally. In the planned team deployment, an enrolled desktop or headless Linux runner can execute project steps, and the team server coordinates project work and shares context across accounts. Codex uses the credentials and workspace on the machine that executes the step.

## Status

The initial release focuses on local personal workflows. Team collaboration, external triggers, and the headless Linux runner are later milestones. See the [design document](docs/design.md) for the architecture and release criteria.

## License

[MIT](LICENSE)
