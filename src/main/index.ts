import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { channels } from '../shared/channels.ts'
import { botSchema, projectSchema, resolveWorkflowSteps, snapshotProject, taskInputSchema, taskMessageLimit, workflowSchema, type Bot, type Project, type Workflow } from '../shared/workflow.ts'
import { CodexExecutor, detectCodex } from '../runtime/codex.ts'
import { readWorkspacePreview } from '../runtime/file-preview.ts'
import { SqliteStore } from '../runtime/store.ts'
import { WorkflowEngine } from '../runtime/workflow-engine.ts'

const entry = join(__dirname, '../renderer/index.html')
const entryUrl = pathToFileURL(entry).href
const codexSetting = 'codex-path'
let window: BrowserWindow | undefined

function showWindow() {
  if (window && !window.isDestroyed()) {
    window.show()
    window.focus()
    return
  }
  window = new BrowserWindow({
    width: 1320, height: 860, minWidth: 840, minHeight: 620, show: false, backgroundColor: '#171b22',
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => { window = undefined })
  void window.loadFile(entry)
}

function register(channel: string, handler: (...args: unknown[]) => unknown) {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (event.sender !== window?.webContents || event.senderFrame?.url !== entryUrl) throw new Error('Unknown Meshwork window.')
    return handler(...args)
  })
}

function verifyDirectory(path: string) {
  if (!isAbsolute(path) || !statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('Choose an existing workspace folder.')
  }
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (app.isReady()) showWindow() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

  void app.whenReady().then(() => {
    const store = new SqliteStore(join(app.getPath('userData'), 'meshwork.sqlite'))
    const codex = () => store.getSetting(codexSetting) || detectCodex()
    const changed = () => {
      if (window && !window.isDestroyed()) window.webContents.send(channels.changed)
    }
    const engine = new WorkflowEngine(store, new CodexExecutor(codex), changed)
    const uuid = z.uuid()
    register(channels.load, () => ({
      bots: store.listBots(), workflows: store.listWorkflows(), projects: store.listProjects(), tasks: store.listTasks(), codexPath: codex(),
    }))
    register(channels.saveBot, (raw, id) => {
      const input = botSchema.parse(raw)
      const existing = id === undefined ? undefined : store.getBot(uuid.parse(id))
      if (id !== undefined && !existing) throw new Error('Bot could not be found.')
      const bot: Bot = {
        ...input, id: existing?.id ?? randomUUID(), version: (existing?.version ?? 0) + 1, updatedAt: new Date().toISOString(),
      }
      store.saveBot(bot)
      changed()
      return bot
    })
    register(channels.saveWorkflow, (raw, id) => {
      const input = workflowSchema.parse(raw)
      const existing = id === undefined ? undefined : store.getWorkflow(uuid.parse(id))
      if (id !== undefined && !existing) throw new Error('Workflow could not be found.')
      const workflow: Workflow = {
        ...input, id: existing?.id ?? randomUUID(), version: (existing?.version ?? 0) + 1, updatedAt: new Date().toISOString(),
      }
      resolveWorkflowSteps(workflow.steps, (botId) => store.getBot(botId))
      store.saveWorkflow(workflow)
      changed()
      return workflow
    })
    register(channels.saveProject, (raw, id) => {
      const input = projectSchema.parse(raw)
      verifyDirectory(input.workspace)
      const existing = id === undefined ? undefined : store.getProject(uuid.parse(id))
      if (id !== undefined && !existing) throw new Error('Project could not be found.')
      const project: Project = {
        ...input, id: existing?.id ?? randomUUID(), version: (existing?.version ?? 0) + 1, updatedAt: new Date().toISOString(),
      }
      if (project.workflowId && !store.getWorkflow(project.workflowId)) throw new Error('The project workflow could not be found.')
      store.saveProject(project)
      changed()
      return project
    })
    register(channels.startTask, (raw) => {
      const input = taskInputSchema.parse(raw)
      const project = store.getProject(input.projectId)
      if (!project) throw new Error('Choose an existing project.')
      verifyDirectory(project.workspace)
      const workflow = project.workflowId ? store.getWorkflow(project.workflowId) : undefined
      return engine.enqueue(snapshotProject(project, workflow, (id) => store.getBot(id)), { kind: 'manual', objective: input.objective })
    })
    register(channels.cancelTask, (id) => engine.cancel(uuid.parse(id)))
    register(channels.deleteTask, (id) => engine.deleteTask(uuid.parse(id)))
    register(channels.previewTaskFile, (id, rawPath) => {
      const task = store.getTask(uuid.parse(id))
      const path = z.string().min(1).max(4096).parse(rawPath)
      if (!task) throw new Error('Task could not be found.')
      if (!task.attempts.some((attempt) => attempt.result?.files.includes(path))) throw new Error('The file is not in this task’s results.')
      return readWorkspacePreview(task.project.workspace, path)
    })
    register(channels.retryTask, (id) => engine.retry(uuid.parse(id)))
    register(channels.sendFollowUp, (id, text) => {
      engine.sendFollowUp(uuid.parse(id), z.string().trim().min(1).max(taskMessageLimit).parse(text))
    })
    register(channels.completeTask, (id) => engine.completeTask(uuid.parse(id)))
    register(channels.completeHumanStep, (id, accepted, note) => {
      engine.completeHumanStep(uuid.parse(id), z.boolean().parse(accepted), z.string().trim().min(1).max(12_000).parse(note))
    })
    register(channels.answerApproval, (taskId, approvalId, accepted) => {
      engine.answerApproval(uuid.parse(taskId), uuid.parse(approvalId), z.boolean().parse(accepted))
    })
    register(channels.chooseWorkspace, async () => {
      const result = await dialog.showOpenDialog(window!, { title: 'Choose a workspace', properties: ['openDirectory'] })
      return result.canceled ? null : result.filePaths[0] ?? null
    })
    register(channels.chooseCodex, async () => {
      const result = await dialog.showOpenDialog(window!, { title: 'Choose the Codex CLI executable', properties: ['openFile'] })
      const selected = result.canceled ? null : result.filePaths[0] ?? null
      if (selected) {
        store.setSetting(codexSetting, selected)
        changed()
      }
      return selected
    })
    register(channels.resetCodex, () => { store.setSetting(codexSetting, ''); changed() })

    let closing = false
    app.on('before-quit', (event) => {
      if (closing) return
      event.preventDefault()
      closing = true
      void Promise.resolve(engine.stop()).finally(() => { store.close(); app.quit() })
    })
    engine.start()
    app.on('activate', showWindow)
    showWindow()
  }).catch((error: unknown) => {
    console.error('Meshwork could not open.', error)
    dialog.showErrorBox('Meshwork could not open', error instanceof Error ? error.message : String(error))
    app.quit()
  })
}
