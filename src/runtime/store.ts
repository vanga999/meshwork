import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Bot, Project, ProjectSnapshot, Task, Workflow } from '../shared/workflow.ts'

export interface WorkflowStore {
  listBots(): Bot[]
  getBot(id: string): Bot | undefined
  saveBot(bot: Bot): void
  listWorkflows(): Workflow[]
  getWorkflow(id: string): Workflow | undefined
  saveWorkflow(workflow: Workflow): void
  listProjects(): Project[]
  getProject(id: string): Project | undefined
  saveProject(project: Project): void
  listTasks(): Task[]
  getTask(id: string): Task | undefined
  saveTask(task: Task): void
  deleteTask(id: string): void
}

type Table = 'bots' | 'workflows' | 'projects' | 'tasks'
type LegacyProject = Project & Pick<Workflow, 'steps'>
type LegacyTask = Omit<Task, 'project'> & { bot: ProjectSnapshot }

export class SqliteStore implements WorkflowStore {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    this.migrateLegacyWorkflows()
  }

  listBots() { return this.list<Bot>('bots') }
  getBot(id: string) { return this.get<Bot>('bots', id) }
  saveBot(bot: Bot) { this.save('bots', bot) }
  listWorkflows() { return this.list<Workflow>('workflows') }
  getWorkflow(id: string) { return this.get<Workflow>('workflows', id) }
  saveWorkflow(workflow: Workflow) { this.save('workflows', workflow) }
  listProjects() { return this.list<Project>('projects') }
  getProject(id: string) { return this.get<Project>('projects', id) }
  saveProject(project: Project) { this.save('projects', project) }
  listTasks() { return this.list<Task>('tasks') }
  getTask(id: string) { return this.get<Task>('tasks', id) }
  saveTask(task: Task) { this.save('tasks', task) }
  deleteTask(id: string) { this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id) }

  getSetting(key: string) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
    return row ? String(row.value) : undefined
  }

  setSetting(key: string, value: string) {
    this.db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  close() { this.db.close() }

  private list<T>(table: Table): T[] {
    return this.db.prepare(`SELECT data FROM ${table} ORDER BY updated_at DESC, id`).all()
      .map((row) => JSON.parse(String(row.data)) as T)
  }

  private get<T>(table: Table, id: string): T | undefined {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id)
    return row ? JSON.parse(String(row.data)) as T : undefined
  }

  private save(table: Table, record: { id: string; updatedAt: string }) {
    this.db.prepare(`INSERT INTO ${table} VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data`)
      .run(record.id, record.updatedAt, JSON.stringify(record))
  }

  private migrateLegacyWorkflows() {
    const version = () => Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
    if (version() >= 2) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = version()
      if (current === 0) this.migrateDirectoryBoundBots()
      if (current < 2) {
        for (const project of this.list<Project | LegacyProject>('projects')) {
          if ('steps' in project) this.extractWorkflow(project)
        }
        this.db.exec('PRAGMA user_version = 2')
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private migrateDirectoryBoundBots() {
    for (const record of this.list<Bot | ProjectSnapshot>('bots')) {
      if (!('steps' in record)) continue
      const { steps, ...fields } = record
      this.extractWorkflow({
        ...fields,
        steps: steps.map((step) => {
          if (step.kind === 'human') return step
          const botId = randomUUID()
          this.saveBot({ id: botId, name: step.role, instructions: step.instructions, access: step.access, version: 1, updatedAt: record.updatedAt })
          return { kind: 'bot', botId, instructions: '' }
        }),
      })
      this.db.prepare('DELETE FROM bots WHERE id = ?').run(record.id)
    }
    for (const record of this.list<Task | LegacyTask>('tasks')) {
      if (!('bot' in record)) continue
      const { bot, ...fields } = record
      this.saveTask({ ...fields, project: bot })
    }
  }

  private extractWorkflow({ steps, ...project }: LegacyProject) {
    if (steps.length) {
      const workflow: Workflow = { id: randomUUID(), name: project.name, steps, version: 1, updatedAt: project.updatedAt }
      this.saveWorkflow(workflow)
      project.workflowId = workflow.id
    }
    this.saveProject(project)
  }
}
