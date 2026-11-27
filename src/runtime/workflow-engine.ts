import { randomUUID } from 'node:crypto'
import type { Activity, Approval, Attempt, ProjectSnapshot, Step, StepResult, Task, WorkflowTrigger } from '../shared/workflow.ts'
import type { WorkflowStore } from './store.ts'

export type Execution = {
  objective: string
  workspace: string
  step: Extract<Step, { kind: 'codex' }>
  handoffs: { role: string; result: StepResult }[]
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
  controller: AbortController
  approvals: Map<string, (accepted: boolean) => void>
}

const now = () => new Date().toISOString()

export class WorkflowEngine {
  private readonly store: WorkflowStore
  private readonly executor: StepExecutor
  private readonly changed: () => void
  private active?: ActiveExecution
  private inFlight?: Promise<void>
  private stopped = false

  constructor(store: WorkflowStore, executor: StepExecutor, changed: () => void) {
    this.store = store
    this.executor = executor
    this.changed = changed
  }

  start() {
    for (const task of this.store.listTasks()) {
      if (task.status !== 'running') continue
      const attempt = this.currentAttempt(task)
      attempt.error = 'Meshwork closed during this step. Check the workspace before retrying.'
      task.approvals = []
      this.finish(task, 'interrupted')
    }
    this.dispatch()
  }

  enqueue(project: ProjectSnapshot, trigger: WorkflowTrigger) {
    if (!project.steps.length) throw new Error('Add a workflow step before starting a task.')
    const createdAt = now()
    const task: Task = {
      id: randomUUID(), project: structuredClone(project), trigger, status: 'queued', stepIndex: 0,
      attempts: [], approvals: [], createdAt, updatedAt: createdAt,
    }
    this.save(task)
    this.dispatch()
    return this.requireTask(task.id)
  }

  completeHumanStep(id: string, accepted: boolean, note: string) {
    const task = this.requireTask(id)
    if (task.status !== 'waiting') throw new Error('This step no longer needs a decision.')
    const attempt = this.currentAttempt(task)
    if (accepted) {
      attempt.result = { summary: 'Approved', details: note, files: [] }
      this.advance(task)
    } else {
      attempt.error = note
      this.finish(task, 'failed')
    }
    this.dispatch()
  }

  cancel(id: string) {
    const task = this.requireTask(id)
    if (task.status === 'running') {
      if (this.active?.taskId === id) this.active.controller.abort()
      return
    }
    if (task.status === 'waiting') this.finish(task, 'cancelled')
    if (task.status === 'queued') {
      task.status = 'cancelled'
      this.save(task)
    }
  }

  retry(id: string) {
    const task = this.requireTask(id)
    if (!['failed', 'interrupted', 'cancelled'].includes(task.status)) {
      throw new Error('Only stopped work can be retried.')
    }
    task.status = 'queued'
    this.save(task)
    this.dispatch()
  }

  answerApproval(taskId: string, approvalId: string, accepted: boolean) {
    const task = this.requireTask(taskId)
    const active = this.active
    const respond = active?.taskId === taskId ? active.approvals.get(approvalId) : undefined
    const approval = task.approvals.find((item) => item.id === approvalId)
    if (!respond || !active || !approval) throw new Error('This permission request has expired.')
    active.approvals.delete(approvalId)
    task.approvals = task.approvals.filter((item) => item.id !== approvalId)
    this.currentAttempt(task).activity.push({ at: now(), label: accepted ? 'Permission allowed once' : 'Permission declined', detail: approval.title })
    this.save(task)
    respond(accepted)
  }

  stop() {
    this.stopped = true
    this.active?.controller.abort()
    return this.inFlight
  }

  private dispatch() {
    if (this.stopped || this.active) return
    const queue = this.store.listTasks().filter((task) => task.status === 'queued')
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    for (const task of queue) {
      const step = task.project.steps[task.stepIndex]
      const attempt: Attempt = {
        id: randomUUID(), stepIndex: task.stepIndex, status: step.kind === 'human' ? 'waiting' : 'running',
        startedAt: now(), activity: [],
      }
      task.attempts.push(attempt)
      task.status = attempt.status
      this.save(task)
      if (step.kind === 'codex') {
        const active = { taskId: task.id, controller: new AbortController(), approvals: new Map<string, (accepted: boolean) => void>() }
        this.active = active
        active.controller.signal.addEventListener('abort', () => {
          for (const resolve of active.approvals.values()) resolve(false)
          active.approvals.clear()
        }, { once: true })
        this.inFlight = this.execute(task, step, active)
        return
      }
    }
  }

  private async execute(task: Task, step: Extract<Step, { kind: 'codex' }>, active: ActiveExecution) {
    const { signal } = active.controller
    try {
      const handoffs = task.attempts.flatMap((attempt) => attempt.result && attempt.status === 'completed'
        ? [{ role: task.project.steps[attempt.stepIndex].role, result: attempt.result }] : [])
      const result = await this.executor.execute({
        objective: task.trigger.objective, workspace: task.project.workspace, step, handoffs, signal,
        onActivity: (activity) => {
          const current = this.requireTask(task.id)
          const attempt = this.currentAttempt(current)
          attempt.activity = [...attempt.activity.slice(-79), { at: now(), ...activity }]
          this.save(current)
        },
        onSession: (session) => {
          const current = this.requireTask(task.id)
          this.currentAttempt(current).provider = session
          this.save(current)
        },
        requestApproval: (approval) => {
          if (signal.aborted) return Promise.resolve(false)
          const current = this.requireTask(task.id)
          const id = randomUUID()
          return new Promise((resolve) => {
            active.approvals.set(id, resolve)
            current.approvals.push({ ...approval, id })
            this.save(current)
          })
        },
      })
      if (this.stopped) return
      const current = this.requireTask(task.id)
      current.approvals = []
      if (signal.aborted) {
        this.finish(current, 'cancelled')
      } else {
        this.currentAttempt(current).result = result
        this.advance(current)
      }
    } catch (error) {
      if (this.stopped) return
      const current = this.requireTask(task.id)
      current.approvals = []
      if (signal.aborted) this.finish(current, 'cancelled')
      else {
        this.currentAttempt(current).error = error instanceof Error ? error.message : String(error)
        this.finish(current, 'failed')
      }
    } finally {
      for (const resolve of active.approvals.values()) resolve(false)
      this.active = undefined
      this.dispatch()
    }
  }

  private advance(task: Task) {
    const attempt = this.currentAttempt(task)
    attempt.status = 'completed'
    attempt.finishedAt = now()
    if (task.stepIndex + 1 === task.project.steps.length) task.status = 'completed'
    else {
      task.stepIndex++
      task.status = 'queued'
    }
    this.save(task)
  }

  private finish(task: Task, status: 'failed' | 'interrupted' | 'cancelled') {
    const attempt = this.currentAttempt(task)
    attempt.status = status
    attempt.finishedAt = now()
    task.status = status
    this.save(task)
  }

  private currentAttempt(task: Task) {
    const attempt = task.attempts.at(-1)
    if (!attempt || attempt.stepIndex !== task.stepIndex) throw new Error('Step execution could not be found.')
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
