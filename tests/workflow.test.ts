import assert from 'node:assert/strict'
import { once, EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { snapshotProject, type Bot, type Project, type Task, type Workflow } from '../src/shared/workflow.ts'
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
    const done = await waitFor(task.id, (run) => run.status === 'completed')
    assert.equal(done.project.version, 1)
    assert.deepEqual(done.project.workflow, { id: workflow.id, name: workflow.name, version: 1 })
    assert.deepEqual(done.project.steps[2], { kind: 'codex', role: report.name, instructions: report.instructions, access: report.access, bot: { id: report.id, version: 1 } })
    assert.equal(done.attempts.length, 3)
    assert.deepEqual(results, [[], ['Checks complete', 'Verified the checks']])
    assert.deepEqual(instructions, ['Run local checks\n\nWorkflow step instructions:\nInspect only the readme.', 'Collect the findings'])
    assert.deepEqual(done.attempts[2].result?.files, ['notes.txt'])
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
    await waitFor(second.id, (run) => run.status === 'completed')
    const complete = store.getTask(first.id)!
    assert.equal(complete.status, 'completed')
    assert.equal(complete.approvals.length, 0)
    assert.equal(complete.attempts[0].activity[0].label, 'Permission declined')
  } finally { await fixture.cleanup() }
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
    await waitFor(first.id, (run) => run.status === 'completed')
    await waitFor(second.id, (run) => run.status === 'completed')
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
      assert.equal(store.getTask(task.id)?.status, 'completed')
    } finally { await engine.stop(); store.close() }
    const reopened = new SqliteStore(path)
    try { assert.equal(reopened.listWorkflows().length, 1) }
    finally { reopened.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
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
      assert.equal(store.getTask(task.id)?.status, 'completed')
    } finally { store.close() }
    const reopened = new SqliteStore(path)
    try {
      assert.equal(reopened.listBots().length, 1)
      assert.equal(reopened.listProjects().length, 1)
    } finally { reopened.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
