# Meshwork

[简体中文](README.zh-CN.md) · [Design](docs/design.md)

Meshwork is a planned desktop task workspace for people and AI agents. Create a bot for a recurring kind of work, define the steps it should follow, and give it a task. The bot coordinates handoffs between people and agents, and the task card keeps the decisions, progress, and deliverables together.

## Personal bots

Create a bot on your desktop to run a workflow over your own projects and files. For example, a development bot can use Codex to inspect a requirement, implement the change, and verify it in separate steps. Meshwork runs Codex on your computer and returns the outcome, changed files, and test results to the task card.

## Project bots

Create a project for your team, invite people with their own accounts, and manage your repositories, documents, tasks, and deliverables in one place. Project bots belong to the project. Their workflows can assign steps to real teammates or agents and use configurable trigger nodes to start or resume work.

For example, one code review workflow can be triggered by a GitHub pull request or a GitLab merge request across the repositories selected for its trigger. It dispatches a Codex review of the specific revision, saves findings in the project, and can pass the report to a teammate before a separate step publishes it to the source platform. Other workflows can use manual triggers or webhooks for work outside a repository.

## Where work runs

The desktop app runs personal workflows locally and can execute project steps when its owner enables project access. A headless Meshwork runner can run the same steps on a Linux machine. The team server coordinates project work and shares task context and results across accounts. Codex uses the credentials and workspace on the machine that executes the step.

## Status

Meshwork is in the design stage. The proposed first release covers a local personal workflow and a shared code review workflow with a human handoff and configurable event sources. See the [design document](docs/design.md) for the architecture, execution model, and release criteria.

## License

[MIT](LICENSE)
