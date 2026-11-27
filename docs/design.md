# Meshwork design

[简体中文](design.zh-CN.md) · [Repository README](../README.md)

This document describes the local desktop release and the planned team architecture. The first release runs on one machine. Team accounts, project bots, external event connectors, and the headless Linux runner are later milestones.

## Local release

The Bots page manages reusable bots and local workflows. The Projects page saves the working directory and workflow selection for each project, with Codex as the default. A task snapshots the project, workflow, and bot versions when it starts. A Codex step uses the project directory and hands its structured result to the next step. A human decision pauses the task until the user submits a note and a decision. The task card keeps the result and attempt history. After a restart, previously running attempts appear as interrupted and can be retried explicitly.

The renderer calls a typed workflow API through Electron IPC. The workflow engine depends on a storage interface and a step executor interface. SQLite and Codex App Server are their local implementations. The engine accepts a workflow trigger as input, and the desktop implements manual triggering. These boundaries give the planned team API and runner their integration points.

## Product model

Meshwork manages tasks that pass between people and AI agents. A user or an event starts a workflow in a project. The workflow engine assigns each step to its configured bot or person and advances the task according to the workflow rules. Each handoff records who completed the step, what they produced, and who acts next.

| Concept | Meaning |
| --- | --- |
| Project | Holds the workspace, workflow selection, tasks, and deliverables. A local project uses a directory on the desktop. A shared project can also have its own bots, team, and external resources. |
| Member | A real person with a Meshwork account and project permissions. Members can receive tasks, submit deliverables, request changes, and approve handoffs. |
| Bot | A reusable agent role with a name, responsibilities, and execution permissions. A project assigns it to workflow steps and supplies the workspace at runtime. |
| Workflow | A versioned definition of steps, responsibilities, inputs, expected outputs, and transitions. Multiple projects can select the same local workflow. Steps can include their own instructions. |
| Trigger node | A workflow node that starts a run or advances a waiting step when a configured event matches. It defines the event type, sources, filters, and input mapping. |
| Task | A unit of work with an objective, context, acceptance criteria, a timeline, and deliverables. A task can have multiple workflow runs over time. |
| Run and step attempt | A run records one execution of a specific workflow version. A step attempt records one execution or human submission within that run. |
| Executor and runner | An executor carries out an agent step. Codex is the first planned executor. A runner is the Meshwork process on the machine that starts and manages the executor. |

## Local and shared projects

| | Local project | Shared project |
| --- | --- | --- |
| Ownership | Created and managed in the user's desktop workspace. | Created by the team server, assigned to individuals, and managed by the project team. |
| Trigger | A user starts a local task from the desktop. | A manual or event trigger node starts a run. An event trigger node can also resume a waiting step. |
| Context | Local directories, user-selected files, and outputs from earlier steps. | Project resources, the triggering event, and deliverables from earlier steps. |
| Execution | The user's desktop runner uses the local Codex installation and workspace. | The team server assigns agent steps to an eligible desktop runner or headless Linux runner. Human steps go to the assigned member's inbox. |
| Results | The project task and its history stay in local storage. | The task, shared deliverables, and review history are visible to authorized project members. |

Bot roles and workflow steps use the same execution model in both project types. A local project runs independently on the desktop. For shared projects the team server owns the shared task state, including the next assignment. A desktop owner enrolls the runner for the projects they choose and controls whether it takes work automatically.

## Architecture

```mermaid
flowchart LR
    Desktop[Desktop app] --> Local[Local workflow engine]
    Local --> DesktopRunner[Desktop runner]
    subgraph Team[Team server]
        Connectors[Event connectors] -->|Verified events| Triggers[Workflow trigger nodes]
        Triggers --> ProjectWork[Project workflow engine]
    end
    Desktop <-->|Project tasks and results| ProjectWork
    Sources[Event sources] --> Connectors
    DesktopRunner <-->|Jobs and execution events| ProjectWork
    LinuxRunner[Headless Linux runner] <-->|Jobs and execution events| ProjectWork
    DesktopRunner --> DesktopCodex[Codex on desktop]
    LinuxRunner --> LinuxCodex[Codex on Linux]
    ProjectWork --> Store[Project records and deliverables]
```

**Desktop app.** Define reusable bots on the Bots page and create workspaces and workflows on the Projects page. Each task shows its current step, assignee, relevant execution events, and deliverables. The desktop runner handles local execution and can later accept approved shared project assignments.

**Team server.** Own accounts, project memberships, shared resources, bot configuration, workflow runs, human assignments, and publication records. It receives project events through connectors, evaluates trigger nodes, routes work, and broadcasts task changes. A project available in two desktop clients has one shared task state.

**Runners.** The desktop runner and headless Linux runner share the execution code. Each runner manages its own workspace, Codex process, and provider login. An enrolled runner authenticates to the team server and initiates the connection. An eligible runner must have permission to take the step and the required workspace and executor available. A runner can continue a step independently of the desktop window while its process and machine remain running.

The initial stack proposal is Electron, React, and TypeScript for the desktop, a shared Node.js runner for desktop and Linux, and a Node.js team service. SQLite can store personal workflows, tasks, and execution state. PostgreSQL is proposed for shared project records, with a separate file store for uploaded deliverables. Use HTTPS for requests and webhooks and a persistent connection for dispatch, progress, and status updates.

## Workflow trigger nodes

A trigger node configures when a workflow should run and which event data it should receive. An entry trigger creates a run. A trigger inside a run waits for a matching event before advancing. For example, a code review workflow can start when a new revision is submitted, then wait for the CI result for that revision before handing off to a human reviewer.

| Configuration | What it controls |
| --- | --- |
| Source | A manual action, a webhook, or one or more configured connections and resources. A project may connect several repositories across GitHub and GitLab. Workflows for documents and other tasks can use triggers without a repository. |
| Event and filters | The event to match and conditions such as selected repositories, a target branch, or a CI result tied to the current run. |
| Input mapping | The event fields that become workflow inputs. A code review step receives repository and change identifiers, the revision to review, and a reference to fetch the relevant diff. |
| Activation | Whether the node starts a new run or advances a waiting step. A waiting step matches the event to its run or resource revision. |

Connectors validate incoming webhook deliveries and map provider events to common Meshwork event types. The team server resolves the connection and resource to the project, then evaluates the node's filters. Event records include the source connection and resource identifiers so that matching, deduplication, and result routing work across hosts and repositories. The same code review workflow can be used with either connector by configuring its trigger sources.

Publishing a result is a separate workflow step with its own connector, destination, and permission. It can use the originating change from the event context as its destination. A workflow can also finish with a report stored in Meshwork.

## Workflows and handoffs

The Bots page editor arranges default Codex, custom bot, and human decision steps. A single add button opens the step picker. A bot step uses the bot's responsibilities and access along with its step instructions. A local project can select a workflow or run a task directly with default Codex. Success advances the workflow, and a failure or a stop with feedback leaves the step available for an explicit retry. A future workflow editor can add conditional transitions and a bounded return path to an earlier step.

The workflow engine uses structured step results to choose a transition. An agent can return an outcome, a short summary, and evidence. The runner validates the result against the step definition and gathers the referenced deliverables. Meshwork advances the workflow after it has persisted the result and the required deliverables. A human submits an equivalent outcome from the task card. If a prerequisite is missing, the step records what it needs and stays available for follow-up.

A handoff provides the next actor with the objective, the acceptance criteria for their step, the previous result, and references to the relevant inputs. Project handoffs use artifacts accessible to the next actor, such as a stored document revision, a test report, or a Git commit available from the configured repository. The event and artifact records retain the version used by the run. Local files can be attached to a project task as explicit deliverables.

Meshwork records the initiating account or automation, bot, assignee, runner, attempt, and any approval. Project members see the workflow-relevant summary and shared outputs. Provider credentials and raw local sessions stay on the execution machine. The runner stores the provider session and turn identifiers it needs to inspect or resume an attempt.

## Codex integration

The first executor adapter launches Codex App Server and communicates over its standard input and output. Each local attempt starts a thread and a turn using the step's working directory, context, and output schema. The runner translates Codex notifications into Meshwork progress, command and file approval requests, and final outcomes. A task can show relevant command or file activity alongside the final result. A Codex permission request controls the underlying operation. A workflow approval controls the next step or publication. Both appear in the task record with their own decisions. The stored thread and turn identifiers provide a reference for future session recovery. [Codex App Server](https://developers.openai.com/codex/app-server)

Meshwork keeps its own task, run, and step identifiers and correlates them with the Codex session and turn on the runner. A new role receives the explicit handoff and the workspace revision required for its step. It runs in its own session when that step needs independent context. A later executor can implement the same Meshwork operations for starting work, reporting progress, requesting approval, cancelling, and returning a result.

The reference implementations inform separate parts of the design.

- Paseo shows a Codex App Server adapter inside a daemon and an outbound daemon connection for Hub dispatch. Its durable receipts provide a reference for retry and reconciliation. [Codex adapter](https://github.com/getpaseo/paseo/blob/main/packages/server/src/server/agent/providers/codex-app-server-agent.ts) · [Paseo Hub protocol](https://github.com/getpaseo/paseo/blob/main/docs/hub.md)
- T3 Code separates the provider turn finishing from follow-up work such as saving a workspace checkpoint. Meshwork applies this distinction to workflow handoffs and deliverable persistence. [T3 Code architecture](https://github.com/pingdotgg/t3code/blob/main/docs/internals/01_architecture.md)
- Orca runs agents in the environment that owns the worktree and exposes structured chat on supported hosts. That gives Meshwork a reference for runner ownership and task-level execution detail. [Remote Orca Servers](https://orca.dev/docs/remote-servers) · [Orca Chat UI](https://orca.dev/docs/agents/native-chat)
- Herdr hosts native terminal sessions and uses integration hooks for session identity. This is a reference for a future executor that is available primarily through a terminal. [Herdr integrations](https://herdr.dev/tui/docs/integrations/)

## Code review example

1. A project administrator adds a review bot to a project workflow and configures a trigger node for newly opened code changes or new revisions. The node selects one or more connected repositories. The project configures review rules, eligible runners, and read access to the selected repositories.
2. A GitHub pull request or GitLab merge request event reaches the team server. The connector maps the relevant event to the common code change event. The server records the source connection, repository, change identifier, head commit, comparison base, and workflow version. It deduplicates webhook redeliveries and activates each trigger at most once per source change and revision for automatic review. [GitHub pull request events](https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request) · [GitLab merge request events](https://docs.gitlab.com/user/project/integrations/webhook_events/#merge-request-events)
3. The selected runner obtains the diff for that revision and runs a Codex reviewer with the project rules. The default review step reads the diff and related files. Project policy can enable test execution in an isolated workspace. The run records what was actually checked.
4. The runner submits a structured report with a summary, findings with file and line where applicable, and verification evidence. The project task exposes the report and routes it to a real member when approval is required.
5. An optional publication step uses the destination connector to post the allowed report as a GitHub review or GitLab discussion. The proposed initial default is an internal report with optional publication after human approval. The connector requires publication permission and checks that the report still matches the current revision. A report for an older revision remains in task history while a new revision gets its own review. [GitHub pull request review API](https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request) · [GitLab merge request discussions API](https://docs.gitlab.com/api/discussions/#create-a-new-thread-in-the-merge-request-diff)

## Reliability and permissions

- **Dispatch and recovery.** Persist each ready assignment with a stable ID. Only one runner can hold an active claim for an attempt. A disconnected runner's work remains pending reconciliation. On reconnect, match the runner's recorded attempt and provider session before issuing another attempt. If the earlier outcome remains uncertain, show it in the task and allow an authorized person to decide how to proceed.
- **Result and transition.** Store the accepted result and the next transition in one transaction, using durable references for any attached files. Record a separate publication operation so repeated deliveries can be reconciled before another external write.
- **Project access.** Use separate identities for user accounts, enrolled runners, and external connectors. Enforce membership and project-level permissions when reading a task, submitting a result, managing a bot, or publishing to an external platform. Limit each runner enrollment to the projects and workspaces it can serve.
- **Execution access.** Keep Codex credentials on the runner. Treat repository content, diffs, and documents as input to the step. The project's execution policy governs writable paths, command execution, and approvals. Give the reviewer read access by default and give the connector the explicit permission needed for publication.
- **Offline work.** A personal run stays on the desktop. A project step awaiting an offline runner remains visible to the team. A Linux runner can be configured for workflows that need an always-available execution environment.

## Local release acceptance

1. **Local project workflow.** Create a local project and run a task with default Codex. Create a workflow on the Bots page and select it in two projects with different working directories. Check that Codex reads the correct directory and shows its result in the task card.
2. **Human handoff.** Add a human decision step and verify that approval advances the task. The next Codex step receives the previous result and the decision note.
3. **Local recovery.** Reopen Meshwork and see the saved bots, workflows, projects, and tasks. An interrupted step stays visible and requires an explicit retry. Steps from older projects become reusable workflows, and prior task history remains available.

## Planned team acceptance

1. **Project collaboration.** Create a project on the team server and assign it to a teammate. With two real accounts, verify project visibility, configure a project bot, and hand a task step to the second teammate. Check that an approval or request for changes appears in both accounts and advances the workflow according to its definition.
2. **Project triggers and code review.** Configure one trigger node for selected GitHub and GitLab repositories. A PR or MR event starts the same review workflow on a pinned revision. Eligible desktop and Linux runners can take the review step, and the resulting report is available to the team. A redelivery resolves to the existing review record. A new commit gets its own review and keeps the earlier report in the history. A waiting step advances when the matching CI result arrives. A manually triggered task can run without a repository connection.
3. **Runner reconnection.** A runner reconnects after a network interruption, reconciles the existing attempt, and reports a single result or an explicit uncertain state. The task card reflects the outcome and preserves the audit trail.
