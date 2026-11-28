import { randomUUID } from 'node:crypto'
import { canRetryTask, canReviewTask, defaultAgentStep, type Activity, type AgentSelection, type AgentStep, type Approval, type Attempt, type ProjectSnapshot, type StepResult, type Task, type TaskMessage, type WorkflowTrigger } from '../shared/workflow.ts'
import { workflowAncestors, workflowDependencies, workflowGraphError, workflowLinks } from '../shared/workflow-graph.ts'
import type { WorkflowStore } from './store.ts'

export type Execution = {
  objective: string
  workspace: string
  agent: AgentSelection
  step: AgentStep
  handoffs: { role: string; result: StepResult }[]
  followUp?: { text: string; threadId?: string }
  signal: AbortSignal
  onActivity(activity: Omit<Activity, 'at'>): void
  onSession(session: NonNullable<Attempt['provider']>): void
  requestApproval(approval: Omit<Approval, 'id'>): Promise<boolean>
}

export interface StepExecutor {
  execute(execution: Execution): Promise<StepResult>
}

type ActiveExecution = {
  taskId: string
  attempt: Attempt
  controller: AbortController
  approvals: Map<string, (accepted: boolean) => void>
  done?: Promise<void>
}

const now = () => new Date().toISOString()
const stoppedStep = (attempt: Attempt) => ['failed', 'interrupted', 'cancelled'].includes(attempt.status)
const workflowStatuses = new Set(['queued', 'running', 'waiting'])

function latestSteps(task: Task) {
  const latest = Array.from({ length: task.project.steps.length }, (): Attempt | undefined => undefined)
  for (const attempt of task.attempts) {
    if (!attempt.messageId) latest[attempt.stepIndex] = attempt
  }
  return latest
}

function dependenciesFor(task: Task) {
  return workflowDependencies(task.project.steps.length, workflowLinks(task.project.steps.length, task.project.graph))
}

export class WorkflowEngine {
  private readonly store: WorkflowStore
  private readonly executor: StepExecutor
  private readonly changed: () => void
  private readonly active = new Map<string, ActiveExecution>()
  private stopped = false

  constructor(store: WorkflowStore, executor: StepExecutor, changed: () => void) {
    this.store = store
    this.executor = executor
    this.changed = changed
  }

  start() {
    for (const task of this.store.listTasks()) {
      if (task.status !== 'running') continue
      for (const attempt of task.attempts) {
        if (attempt.status !== 'running') continue
        attempt.error = 'Meshwork closed during this step. Check the workspace before retrying.'
        this.finish(attempt, 'interrupted')
      }
      task.approvals = []
      task.retrySteps = undefined
      this.updateStatus(task)
      this.save(task)
    }
    this.dispatch()
  }

  enqueue(project: ProjectSnapshot, trigger: WorkflowTrigger, agent: AgentSelection = { id: 'codex' }) {
    if (!project.steps.length) throw new Error('Add a workflow step before starting a task.')
    const invalid = project.graph && workflowGraphError(project.steps.length, project.graph.links)
    if (invalid) throw new Error(invalid)
    const createdAt = now()
    const task: Task = {
      id: randomUUID(), project: structuredClone(project), trigger, status: 'queued', stepIndex: 0,
      attempts: [], approvals: [], agent, createdAt, updatedAt: createdAt,
    }
    this.save(task)
    this.dispatch()
    return this.requireTask(task.id)
  }

  sendFollowUp(id: string, text: string) {
    const task = this.requireTask(id)
    if (!canReviewTask(task)) throw new Error('Wait for the task to be ready for review before sending a follow-up.')
    task.messages = [...(task.messages ?? []), { id: randomUUID(), text, createdAt: now() }]
    task.stepIndex = task.project.steps.length
    task.status = 'queued'
    this.save(task)
    this.dispatch()
  }

  completeTask(id: string) {
    const task = this.requireTask(id)
    if (!canReviewTask(task)) throw new Error('The task is not ready to be marked complete.')
    task.status = 'completed'
    this.save(task)
  }

  completeHumanStep(id: string, accepted: boolean, note: string, stepIndex?: number) {
    const task = this.requireTask(id)
    const index = stepIndex ?? task.stepIndex
    const attempt = latestSteps(task)[index]
    if (attempt?.status !== 'waiting' || task.project.steps[index]?.kind !== 'human') {
      throw new Error('This step no longer needs a decision.')
    }
    if (accepted) attempt.result = { summary: 'Approved', details: note, files: [] }
    else attempt.error = note
    this.finish(attempt, accepted ? 'completed' : 'failed')
    this.updateStatus(task)
    this.save(task)
    this.dispatch()
  }

  cancel(id: string) {
    const task = this.requireTask(id)
    const waiting = latestSteps(task).filter((attempt) => attempt?.status === 'waiting')
    if (!workflowStatuses.has(task.status) && !waiting.length) return
    for (const attempt of waiting) if (attempt) this.finish(attempt, 'cancelled')
    task.retrySteps = undefined
    const running = this.runsFor(id)
    if (!running.length) task.status = 'cancelled'
    this.save(task)
    for (const run of running) run.controller.abort()
  }

  async deleteTask(id: string) {
    const running = this.runsFor(id)
    this.cancel(id)
    await Promise.all(running.map((run) => run.done))
    this.store.deleteTask(id)
    this.changed()
  }

  retry(id: string) {
    const task = this.requireTask(id)
    if (!canRetryTask(task)) throw new Error('Only stopped work can be retried.')
    if (task.stepIndex < task.project.steps.length) task.retrySteps = latestSteps(task).flatMap((attempt, index) => attempt && stoppedStep(attempt) ? [index] : [])
    task.status = 'queued'
    this.save(task)
    this.dispatch()
  }

  answerApproval(taskId: string, approvalId: string, accepted: boolean) {
    const task = this.requireTask(taskId)
    const run = this.runsFor(taskId).find((item) => item.approvals.has(approvalId))
    const approval = task.approvals.find((item) => item.id === approvalId)
    if (!run || !approval) throw new Error('This permission request has expired.')
    const respond = run.approvals.get(approvalId)!
    run.approvals.delete(approvalId)
    task.approvals = task.approvals.filter((item) => item.id !== approvalId)
    this.attemptFor(task, run).activity.push({ at: now(), label: accepted ? 'Permission allowed once' : 'Permission declined', detail: approval.title })
    this.save(task)
    respond(accepted)
  }

  stop() {
    this.stopped = true
    const running = [...this.active.values()]
    for (const run of running) run.controller.abort()
    return Promise.all(running.map((run) => run.done))
  }

  private runsFor(taskId: string) {
    return [...this.active.values()].filter((run) => run.taskId === taskId)
  }

  private dispatch() {
    if (this.stopped) return
    const running = [...this.active.values()]
    if (running.length) {
      if (running.every((run) => !run.controller.signal.aborted)) this.schedule(this.requireTask(running[0].taskId))
      return
    }
    const queue = this.store.listTasks().filter((task) => workflowStatuses.has(task.status))
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    for (const task of queue) {
      this.schedule(task)
      if (this.active.size) return
    }
  }

  private schedule(task: Task) {
    const length = task.project.steps.length
    const followUp = task.stepIndex === length ? task.messages?.at(-1) : undefined
    let ready: number[]
    if (followUp) {
      if (task.status !== 'queued') return
      ready = [length]
    } else {
      const latest = latestSteps(task)
      const retries = new Set(task.retrySteps)
      if (latest.some((attempt, index) => attempt && stoppedStep(attempt) && !retries.has(index))) return
      ready = dependenciesFor(task).flatMap((upstream, index) =>
        (!latest[index] || retries.has(index)) && upstream.every((parent) => latest[parent]?.status === 'completed') ? [index] : [])
    }
    if (!ready.length) return

    const launches: { run: ActiveExecution; step: AgentStep }[] = []
    for (const index of ready) {
      const step = followUp
        ? this.followUpStep(task) ?? defaultAgentStep(task.agent)
        : task.project.steps[index]
      const attempt: Attempt = {
        id: randomUUID(), stepIndex: index, status: step.kind === 'human' ? 'waiting' : 'running',
        messageId: followUp?.id, startedAt: now(), activity: [],
      }
      task.attempts.push(attempt)
      if (step.kind === 'codex') {
        const run: ActiveExecution = { taskId: task.id, attempt, controller: new AbortController(), approvals: new Map() }
        run.controller.signal.addEventListener('abort', () => {
          for (const resolve of run.approvals.values()) resolve(false)
          run.approvals.clear()
        }, { once: true })
        this.active.set(attempt.id, run)
        launches.push({ run, step })
      }
    }
    const remaining = task.retrySteps?.filter((index) => !ready.includes(index))
    task.retrySteps = remaining?.length ? remaining : undefined
    this.updateStatus(task)
    this.save(task)
    for (const { run, step } of launches) run.done = this.execute(task, step, run, followUp)
  }

  private followUpStep(task: Task) {
    const prior = task.attempts.findLast((attempt) => attempt.status === 'completed' && !attempt.messageId && task.project.steps[attempt.stepIndex]?.kind === 'codex')
    const step = prior && task.project.steps[prior.stepIndex]
    return step?.kind === 'codex' ? step : undefined
  }

  private async execute(task: Task, step: AgentStep, run: ActiveExecution, followUp?: TaskMessage) {
    const { signal } = run.controller
    try {
      const ancestors = followUp ? undefined : workflowAncestors(run.attempt.stepIndex, dependenciesFor(task))
      const handoffs = task.attempts.flatMap((attempt) => !attempt.messageId && attempt.result && attempt.status === 'completed'
        && (!ancestors || ancestors.has(attempt.stepIndex))
        ? [{ role: task.project.steps[attempt.stepIndex].role, result: attempt.result }] : [])
      let threadId: string | undefined
      if (followUp) {
        const previous = task.attempts.findLast((attempt) => attempt.messageId && attempt.result && attempt.status === 'completed')
        if (previous?.result) handoffs.push({ role: step.role, result: previous.result })
        const index = task.project.steps.indexOf(step)
        const resumed = task.attempts.findLast((attempt) => attempt.provider?.threadId && (
          attempt.messageId || (attempt.stepIndex === index && attempt.status === 'completed')
        ))
        threadId = resumed?.provider?.threadId
      }
      const result = await this.executor.execute({
        objective: task.trigger.objective, workspace: task.project.workspace, agent: task.agent ?? { id: 'codex' }, step, handoffs, signal,
        followUp: followUp && { text: followUp.text, threadId },
        onActivity: (activity) => {
          const current = this.requireTask(task.id)
          const attempt = this.attemptFor(current, run)
          attempt.activity = [...attempt.activity.slice(-79), { at: now(), ...activity }]
          this.save(current)
        },
        onSession: (session) => {
          const current = this.requireTask(task.id)
          this.attemptFor(current, run).provider = session
          this.save(current)
        },
        requestApproval: (approval) => {
          if (signal.aborted) return Promise.resolve(false)
          const current = this.requireTask(task.id)
          const id = randomUUID()
          return new Promise((resolve) => {
            run.approvals.set(id, resolve)
            current.approvals.push({ ...approval, id, stepIndex: run.attempt.stepIndex })
            this.save(current)
          })
        },
      })
      if (!this.stopped) this.settle(run, signal.aborted ? 'cancelled' : 'completed', result)
    } catch (error) {
      // A synchronous executor failure must settle after the dispatch loop has registered every launch.
      await Promise.resolve()
      if (!this.stopped) this.settle(run, signal.aborted ? 'cancelled' : 'failed', undefined, error instanceof Error ? error.message : String(error))
    } finally {
      for (const resolve of run.approvals.values()) resolve(false)
      this.active.delete(run.attempt.id)
      this.dispatch()
    }
  }

  private settle(run: ActiveExecution, status: 'completed' | 'failed' | 'cancelled', result?: StepResult, error?: string) {
    const task = this.requireTask(run.taskId)
    const attempt = this.attemptFor(task, run)
    task.approvals = task.approvals.filter((approval) => approval.stepIndex !== attempt.stepIndex)
    if (status === 'completed') attempt.result = result
    if (status === 'failed') attempt.error = error
    this.finish(attempt, status)
    this.updateStatus(task)
    this.save(task)
  }

  private updateStatus(task: Task) {
    if (task.stepIndex === task.project.steps.length) {
      const status = task.attempts.at(-1)?.status
      if (status) task.status = status === 'completed' ? 'awaiting-review' : status
      return
    }
    const attempts = latestSteps(task)
    const active = attempts.find((attempt) => attempt?.status === 'running')
    const cancelled = attempts.find((attempt) => attempt?.status === 'cancelled')
    const stopped = cancelled ?? attempts.find((attempt) => attempt && stoppedStep(attempt))
    const waiting = attempts.find((attempt) => attempt?.status === 'waiting')
    const next = active ?? (task.retrySteps?.length ? undefined : stopped ?? waiting)
    if (next) {
      task.status = next.status
      task.stepIndex = next.stepIndex
    } else if (attempts.every((attempt) => attempt?.status === 'completed')) {
      task.status = 'awaiting-review'
    } else {
      task.status = 'queued'
      task.stepIndex = task.retrySteps?.[0] ?? attempts.findIndex((attempt) => !attempt)
    }
  }

  private finish(attempt: Attempt, status: 'completed' | 'failed' | 'interrupted' | 'cancelled') {
    attempt.status = status
    attempt.finishedAt = now()
  }

  private attemptFor(task: Task, run: ActiveExecution) {
    const attempt = task.attempts.find(({ id }) => id === run.attempt.id)
    if (!attempt) throw new Error('Step execution could not be found.')
    return attempt
  }

  private requireTask(id: string) {
    const task = this.store.getTask(id)
    if (!task) throw new Error('Task could not be found.')
    return task
  }

  private save(task: Task) {
    task.updatedAt = now()
    this.store.saveTask(task)
    this.changed()
  }
}
