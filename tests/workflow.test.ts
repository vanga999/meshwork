import assert from 'node:assert/strict'
import { once, EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { snapshotProject, workflowSchema, type Bot, type Project, type ProjectSnapshot, type Task, type Workflow } from '../src/shared/workflow.ts'
import { SqliteStore } from '../src/runtime/store.ts'
import { WorkflowEngine, type StepExecutor } from '../src/runtime/workflow-engine.ts'

function setup(executor: StepExecutor) {
  const directory = mkdtempSync(join(tmpdir(), 'meshwork-workflow-'))
  const path = join(directory, 'tasks.sqlite')
  const store = new SqliteStore(path)
  const events = new EventEmitter()
  const changed = () => events.emit('changed')
  const engine = new WorkflowEngine(store, executor, changed)
  const updatedAt = new Date().toISOString()
  const bot: Bot = { id: 'analyze', name: 'Analyze', instructions: 'Run local checks', access: 'read-only', version: 1, updatedAt }
  const report: Bot = { ...bot, id: 'report', name: 'Summarize', instructions: 'Collect the findings' }
  store.saveBot(bot)
  store.saveBot(report)
  const workflow: Workflow = {
    id: 'workflow', name: 'Review', version: 1, updatedAt,
    steps: [
      { kind: 'bot', botId: bot.id, instructions: 'Inspect only the readme.' },
      { kind: 'human', role: 'Review', instructions: 'Read the checks' },
      { kind: 'bot', botId: report.id, instructions: '' },
    ],
  }
  store.saveWorkflow(workflow)
  const project: Project = {
    id: 'project', name: 'Local review', version: 1, updatedAt, workspace: directory, workflowId: workflow.id,
  }
  store.saveProject(project)
  const start = (objective: string) => engine.enqueue(snapshotProject(project, store.getWorkflow(workflow.id), (id) => store.getBot(id)), { kind: 'manual', objective })
  async function waitFor(id: string, predicate: (task: Task) => boolean) {
    const signal = AbortSignal.timeout(3000)
    for (;;) {
      const task = store.getTask(id)!
      if (predicate(task)) return task
      await once(events, 'changed', { signal })
    }
  }
  return { path, store, engine, bot, report, project, workflow, start, waitFor, cleanup: async () => {
    await engine.stop()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  } }
}

test('snapshots the project, workflow and bot versions and passes results through a human handoff', async () => {
  const results: string[][] = []
  const instructions: string[] = []
  const fixture = setup({ execute: async (request) => {
    results.push(request.handoffs.map(({ result }) => result.details))
    instructions.push(request.step.instructions)
    return { summary: request.step.role, details: 'Checks complete', files: ['notes.txt'] }
  } })
  try {
    const { engine, project, workflow, report, start, waitFor, store } = fixture
    const task = start('Review the local folder')
    await waitFor(task.id, (run) => run.status === 'waiting')
    store.saveProject({ ...project, version: 2, workflowId: undefined })
    store.saveWorkflow({ ...workflow, version: 2, steps: workflow.steps.slice(0, 1) })
    store.saveBot({ ...report, version: 2, instructions: 'Updated after the task started' })
    engine.completeHumanStep(task.id, true, 'Verified the checks')
    const done = await waitFor(task.id, (run) => run.status === 'awaiting-review')
    assert.equal(done.project.version, 1)
    assert.deepEqual(done.project.workflow, { id: workflow.id, name: workflow.name, version: 1 })
    assert.deepEqual(done.project.steps[2], { kind: 'codex', role: report.name, instructions: report.instructions, access: report.access, bot: { id: report.id, version: 1 } })
    assert.equal(done.attempts.length, 3)
    assert.deepEqual(results, [[], ['Checks complete', 'Verified the checks']])
    assert.deepEqual(instructions, ['Run local checks\n\nWorkflow step instructions:\nInspect only the readme.', 'Collect the findings'])
    assert.deepEqual(done.attempts[2].result?.files, ['notes.txt'])
    engine.completeTask(task.id)
    assert.equal(store.getTask(task.id)?.status, 'completed')
  } finally { await fixture.cleanup() }
})

test('records approvals and starts a queued task only after execution stops', async () => {
  const fixture = setup({ execute: async (request) => {
    if (request.objective === 'one') {
      const decision = await request.requestApproval({ title: 'Run a command', detail: 'test' })
      assert.equal(decision, false)
    }
    return { summary: 'Done', details: '', files: [] }
  } })
  try {
    const { engine, workflow, start, waitFor, store } = fixture
    store.saveWorkflow({ ...workflow, steps: workflow.steps.slice(0, 1) })
    const first = start('one')
    const second = start('two')
    assert.equal(store.getTask(second.id)?.status, 'queued')
    assert.equal(first.approvals.length, 1)
    engine.answerApproval(first.id, first.approvals[0].id, false)
    await waitFor(second.id, (run) => run.status === 'awaiting-review')
    const complete = store.getTask(first.id)!
    assert.equal(complete.status, 'awaiting-review')
    assert.equal(complete.approvals.length, 0)
    assert.equal(complete.attempts[0].activity[0].label, 'Permission declined')
  } finally { await fixture.cleanup() }
})

test('deletes queued and running tasks without rerunning them or blocking the queue', async () => {
  const objectives: string[] = []
  const fixture = setup({ execute: async ({ objective, requestApproval }) => {
    objectives.push(objective)
    if (objective === 'Remove running task') {
      const accepted = await requestApproval({ title: 'Run a command', detail: 'test' })
      assert.equal(accepted, false)
    }
    return { summary: 'Done', details: '', files: [] }
  } })
  try {
    const { engine, workflow, start, store, waitFor } = fixture
    store.saveWorkflow({ ...workflow, steps: workflow.steps.slice(0, 1) })
    const running = start('Remove running task')
    const queued = start('Remove queued task')
    const next = start('Keep this task')
    assert.equal(running.approvals.length, 1)
    await engine.deleteTask(queued.id)
    await engine.deleteTask(running.id)
    await waitFor(next.id, (task) => task.status === 'awaiting-review')
    assert.deepEqual(objectives, ['Remove running task', 'Keep this task'])
    assert.deepEqual(store.listTasks().map(({ id }) => id), [next.id])
  } finally { await fixture.cleanup() }
})

function diamondProject(project: Project): ProjectSnapshot {
  return {
    ...project,
    steps: ['Start', 'Left', 'Right', 'Join'].map((role) => ({ kind: 'codex', role, access: 'read-only', instructions: role })),
    graph: {
      positions: [{ x: 24, y: 100 }, { x: 264, y: 32 }, { x: 264, y: 160 }, { x: 504, y: 100 }],
      links: [{ from: 0, to: 1 }, { from: 0, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 3 }],
    },
  }
}

test('runs independent nodes together and waits for every branch result at the join', async () => {
  const calls: [string, string[]][] = []
  const fixture = setup({ execute: async ({ step, handoffs, requestApproval }) => {
    calls.push([step.role, handoffs.map(({ result }) => result.summary)])
    if (step.role === 'Left' || step.role === 'Right') {
      assert.equal(await requestApproval({ title: step.role, detail: 'Branch approval' }), true)
    }
    return { summary: step.role, details: '', files: [] }
  } })
  try {
    const { project, engine, waitFor } = fixture
    const started = engine.enqueue(diamondProject(project), { kind: 'manual', objective: 'Parallel review' })
    const waiting = await waitFor(started.id, (task) => task.approvals.length === 2)
    const [left, right] = waiting.approvals
    assert.deepEqual([left.stepIndex, right.stepIndex], [1, 2])
    assert.deepEqual(calls, [['Start', []], ['Left', ['Start']], ['Right', ['Start']]])
    engine.answerApproval(started.id, left.id, true)
    const partial = await waitFor(started.id, (task) => task.attempts.some((attempt) => attempt.stepIndex === 1 && attempt.status === 'completed'))
    assert.deepEqual(partial.approvals.map(({ id }) => id), [right.id])
    assert.equal(partial.attempts.some((attempt) => attempt.stepIndex === 3), false)
    engine.answerApproval(started.id, right.id, true)
    await waitFor(started.id, (task) => task.status === 'awaiting-review')
    assert.deepEqual(calls.at(-1), ['Join', ['Start', 'Left', 'Right']])
  } finally { await fixture.cleanup() }
})

test('retries a failed branch without repeating completed inputs', async () => {
  const calls: string[] = []
  const fixture = setup({ execute: async ({ step }) => {
    calls.push(step.role)
    if (step.role === 'Right' && calls.filter((role) => role === 'Right').length === 1) throw new Error('Try again')
    return { summary: step.role, details: '', files: [] }
  } })
  try {
    const { project, engine, waitFor } = fixture
    const started = engine.enqueue(diamondProject(project), { kind: 'manual', objective: 'Recover the branch' })
    await waitFor(started.id, (task) => task.status === 'failed')
    assert.deepEqual(calls, ['Start', 'Left', 'Right'])
    engine.retry(started.id)
    await waitFor(started.id, (task) => task.status === 'awaiting-review')
    assert.deepEqual(calls, ['Start', 'Left', 'Right', 'Right', 'Join'])
  } finally { await fixture.cleanup() }
})

test('keeps parallel human decisions independent and interruption recovery preserves finished branches', async () => {
  const calls: string[] = []
  const fixture = setup({ execute: async ({ step, signal }) => {
    calls.push(step.role)
    if (step.role === 'Join') await new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    return { summary: step.role, details: '', files: [] }
  } })
  try {
    const { project, engine, store, waitFor } = fixture
    const graph = diamondProject(project)
    graph.steps[1] = { kind: 'human', role: 'Left reviewer', instructions: 'Review the left branch' }
    graph.steps[2] = { kind: 'human', role: 'Right reviewer', instructions: 'Review the right branch' }
    const started = engine.enqueue(graph, { kind: 'manual', objective: 'Review independently' })
    await waitFor(started.id, (task) => task.attempts.filter(({ status }) => status === 'waiting').length === 2)
    engine.completeHumanStep(started.id, true, 'Reviewed right', 2)
    assert.deepEqual(calls, ['Start'])
    engine.completeHumanStep(started.id, true, 'Reviewed left', 1)
    assert.deepEqual(calls, ['Start', 'Join'])
    await engine.stop()
    const recovered = new WorkflowEngine(store, { execute: async ({ step, handoffs }) => {
      calls.push(step.role)
      assert.deepEqual(handoffs.map(({ result }) => result.details), ['', 'Reviewed left', 'Reviewed right'])
      return { summary: step.role, details: '', files: [] }
    } }, () => undefined)
    try {
      recovered.start()
      assert.equal(store.getTask(started.id)?.status, 'interrupted')
      recovered.retry(started.id)
      assert.deepEqual(calls, ['Start', 'Join', 'Join'])
    } finally { await recovered.stop() }
  } finally { await fixture.cleanup() }
})

test('accepts a fork and rejects circular, duplicated and out-of-range graph connections', () => {
  const workflow = {
    name: 'Review',
    steps: Array.from({ length: 3 }, () => ({ kind: 'codex', instructions: '' })),
    graph: { positions: [{ x: 24, y: 100 }, { x: 264, y: 32 }, { x: 264, y: 160 }], links: [{ from: 0, to: 1 }, { from: 0, to: 2 }] },
  }
  assert.equal(workflowSchema.safeParse(workflow).success, true)
  for (const link of [{ from: 2, to: 0 }, { from: 0, to: 1 }, { from: 3, to: 1 }]) {
    assert.equal(workflowSchema.safeParse({ ...workflow, graph: { ...workflow.graph, links: [...workflow.graph.links, link] } }).success, false)
  }
})

test('keeps interrupted work visible and waits for an explicit retry after restart', async () => {
  const fixture = setup({ execute: ({ signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }) })
  const { engine, start, path } = fixture
  try {
    const task = start('Review')
    await engine.stop()
    const reopened = new SqliteStore(path)
    let executions = 0
    const resumed = new WorkflowEngine(reopened, { execute: async () => {
      executions++
      return { summary: 'Done', details: '', files: [] }
    } }, () => undefined)
    try {
      resumed.start()
      const interrupted = reopened.getTask(task.id)!
      assert.equal(interrupted.status, 'interrupted')
      assert.equal(interrupted.attempts[0].status, 'interrupted')
      assert.equal(executions, 0)
      resumed.retry(task.id)
      assert.equal(executions, 1)
      assert.equal(reopened.getTask(task.id)?.attempts.length, 2)
    } finally {
      await resumed.stop()
      reopened.close()
    }
  } finally { await fixture.cleanup() }
})

test('reuses one workflow in two projects with different workspaces', async () => {
  const inputs: [string, string][] = []
  const fixture = setup({ execute: async (request) => {
    inputs.push([request.workspace, request.step.instructions])
    return { summary: 'Done', details: '', files: [] }
  } })
  try {
    const { engine, project, workflow, bot, start, waitFor, store } = fixture
    const shared = { ...workflow, steps: workflow.steps.slice(0, 1) }
    store.saveWorkflow(shared)
    const first = start('First')
    const secondProject: Project = { ...project, id: 'second-project', workspace: join(project.workspace, 'second') }
    const second = engine.enqueue(snapshotProject(secondProject, shared, (id) => store.getBot(id)), { kind: 'manual', objective: 'Second' })
    await waitFor(first.id, (run) => run.status === 'awaiting-review')
    await waitFor(second.id, (run) => run.status === 'awaiting-review')
    assert.deepEqual(inputs, [
      [project.workspace, 'Run local checks\n\nWorkflow step instructions:\nInspect only the readme.'],
      [secondProject.workspace, 'Run local checks\n\nWorkflow step instructions:\nInspect only the readme.'],
    ])
    assert.deepEqual(store.getBot(bot.id), bot)
  } finally { await fixture.cleanup() }
})

test('upgrades existing projects and runs a project with no workflow or bot using Codex', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'meshwork-projects-'))
  const path = join(directory, 'tasks.sqlite')
  const updatedAt = new Date().toISOString()
  const project = { id: 'plain', name: 'Plain', workspace: directory, version: 1, updatedAt }
  const configured = { ...project, id: 'with-steps', name: 'With steps', steps: [{ kind: 'human', role: 'Reviewer', instructions: 'Verify the result' }] }
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL); PRAGMA user_version = 1;')
  const insert = db.prepare('INSERT INTO projects VALUES (?, ?, ?)')
  insert.run(project.id, updatedAt, JSON.stringify({ ...project, steps: [] }))
  insert.run(configured.id, updatedAt, JSON.stringify(configured))
  db.close()
  try {
    const store = new SqliteStore(path)
    const executions: unknown[] = []
    const events = new EventEmitter()
    const engine = new WorkflowEngine(store, { execute: async ({ objective, workspace, step }) => {
      executions.push({ objective, workspace, step })
      return { summary: 'Done', details: '', files: [] }
    } }, () => events.emit('changed'))
    try {
      assert.deepEqual(store.getProject(project.id), project)
      assert.equal(store.listBots().length, 0)
      const [workflow] = store.listWorkflows()
      assert.deepEqual(workflow.steps, configured.steps)
      assert.equal(store.getProject(configured.id)?.workflowId, workflow.id)
      const snapshot = snapshotProject(project, undefined, (id) => store.getBot(id))
      const task = engine.enqueue(snapshot, { kind: 'manual', objective: 'Run a task' })
      assert.deepEqual(executions, [{ objective: 'Run a task', workspace: directory, step: {
        kind: 'codex', role: 'Default Codex', access: 'workspace-write', instructions: 'Complete the task objective in the project workspace.',
      } }])
      await once(events, 'changed', { signal: AbortSignal.timeout(3000) })
      assert.equal(store.getTask(task.id)?.status, 'awaiting-review')
    } finally { await engine.stop(); store.close() }
    const reopened = new SqliteStore(path)
    try { assert.equal(reopened.listWorkflows().length, 1) }
    finally { reopened.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('keeps follow-ups on the task, resumes the Codex session and requires final confirmation', async () => {
  const executions: unknown[] = []
  let failed = false
  const fixture = setup({ execute: async ({ followUp, handoffs, onSession, step }) => {
    if (!followUp) {
      onSession({ threadId: 'original-thread', turnId: 'original-turn' })
      return { summary: 'First result', details: '', files: [] }
    }
    executions.push({ followUp, step: step.role, handoffs: handoffs.map(({ result }) => result.summary) })
    onSession({ threadId: 'original-thread', turnId: 'follow-up-turn' })
    if (!failed) {
      failed = true
      throw new Error('Temporary error')
    }
    return { summary: 'Revised result', details: '', files: [] }
  } })
  try {
    const { store, engine, workflow, start, waitFor } = fixture
    store.saveWorkflow({ ...workflow, steps: workflow.steps.slice(0, 2) })
    const task = start('Prepare result')
    assert.throws(() => engine.completeTask(task.id), /not ready/)
    assert.throws(() => engine.sendFollowUp(task.id, 'Too early'), /ready for review/)
    await waitFor(task.id, (run) => run.status === 'waiting')
    engine.completeHumanStep(task.id, true, 'Checked')
    assert.equal(store.getTask(task.id)?.status, 'awaiting-review')
    engine.sendFollowUp(task.id, 'Revise the answer')
    assert.throws(() => engine.completeTask(task.id), /not ready/)
    const stopped = await waitFor(task.id, (run) => run.status === 'failed')
    assert.equal(stopped.messages?.length, 1)
    engine.retry(task.id)
    await waitFor(task.id, (run) => run.status === 'awaiting-review')
    engine.sendFollowUp(task.id, 'Check the revision')
    const ready = await waitFor(task.id, (run) => run.status === 'awaiting-review')
    assert.deepEqual(executions, [
      { followUp: { text: 'Revise the answer', threadId: 'original-thread' }, step: 'Analyze', handoffs: ['First result', 'Approved'] },
      { followUp: { text: 'Revise the answer', threadId: 'original-thread' }, step: 'Analyze', handoffs: ['First result', 'Approved'] },
      { followUp: { text: 'Check the revision', threadId: 'original-thread' }, step: 'Analyze', handoffs: ['First result', 'Approved', 'Revised result'] },
    ])
    assert.deepEqual(ready.attempts.slice(2).map((attempt) => attempt.messageId), [ready.messages![0].id, ready.messages![0].id, ready.messages![1].id])
    assert.equal(ready.project.steps.length, 2)
    engine.completeTask(task.id)
    assert.equal(store.getTask(task.id)?.status, 'completed')
    assert.throws(() => engine.sendFollowUp(task.id, 'After completion'), /ready for review/)
  } finally { await fixture.cleanup() }
})

test('an agent and its endpoint remain selected for a task after restarting the engine', async () => {
  const seen: unknown[] = []
  const executor: StepExecutor = { execute: async ({ agent, step }) => {
    seen.push([agent, step.role])
    return { summary: 'Done', details: '', files: [] }
  } }
  const fixture = setup(executor)
  try {
    const { project, engine, store, waitFor } = fixture
    const selection = { id: 'claude', baseUrl: 'https://models.example', model: 'workspace-agent' } as const
    const snapshot = snapshotProject({ ...project, workflowId: undefined }, undefined, (id) => store.getBot(id), selection)
    const task = engine.enqueue(snapshot, { kind: 'manual', objective: 'Review' }, selection)
    await waitFor(task.id, (run) => run.status === 'awaiting-review')
    await engine.stop()
    const resumed = new WorkflowEngine(store, executor, () => undefined)
    try {
      resumed.start()
      resumed.sendFollowUp(task.id, 'Check again')
      assert.deepEqual(seen, [[selection, 'Default Claude Code'], [selection, 'Default Claude Code']])
    } finally { await resumed.stop() }
  } finally { await fixture.cleanup() }
})

test('migrates directory-bound bots into projects and preserves existing task results', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meshwork-legacy-'))
  const path = join(directory, 'tasks.sqlite')
  const db = new DatabaseSync(path)
  const updatedAt = new Date().toISOString()
  const legacy = {
    id: 'old-bot', name: 'Old workflow', workspace: directory, updatedAt, version: 2,
    steps: [{ kind: 'codex', role: 'Analyzer', instructions: 'Inspect the workspace', access: 'read-only' }, { kind: 'human', role: 'Reviewer', instructions: 'Review the result' }],
  }
  db.exec(`
    CREATE TABLE bots (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
  `)
  db.prepare('INSERT INTO bots VALUES (?, ?, ?)').run(legacy.id, updatedAt, JSON.stringify(legacy))
  db.prepare('INSERT INTO tasks VALUES (?, ?, ?)').run('old-task', updatedAt, JSON.stringify({
    id: 'old-task', bot: legacy, status: 'waiting', stepIndex: 1,
    trigger: { kind: 'manual', objective: 'Analyze' }, approvals: [], createdAt: updatedAt, updatedAt,
    attempts: [
      { id: 'first-attempt', stepIndex: 0, status: 'completed', startedAt: updatedAt, activity: [], result: { summary: 'Saved result', details: '', files: ['findings.txt'] } },
      { id: 'waiting-attempt', stepIndex: 1, status: 'waiting', startedAt: updatedAt, activity: [] },
    ],
  }))
  db.close()
  try {
    const store = new SqliteStore(path)
    try {
      const project = store.getProject(legacy.id)!
      const [bot] = store.listBots()
      const workflow = store.getWorkflow(project.workflowId!)!
      const task = store.getTask('old-task')!
      assert.equal(project.workspace, directory)
      assert.equal(project.name, legacy.name)
      assert.equal(bot.name, 'Analyzer')
      assert.equal('workspace' in bot, false)
      assert.deepEqual(workflow.steps, [{ kind: 'bot', botId: bot.id, instructions: '' }, legacy.steps[1]])
      assert.deepEqual(task.project, legacy)
      assert.equal(task.status, 'waiting')
      assert.deepEqual(task.attempts[0].result?.files, ['findings.txt'])
      const engine = new WorkflowEngine(store, { execute: async () => { throw new Error('Unexpected Codex step') } }, () => undefined)
      engine.completeHumanStep(task.id, true, 'Reviewed the existing result')
      assert.equal(store.getTask(task.id)?.status, 'awaiting-review')
    } finally { store.close() }
    const reopened = new SqliteStore(path)
    try {
      assert.equal(reopened.listBots().length, 1)
      assert.equal(reopened.listProjects().length, 1)
    } finally { reopened.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
