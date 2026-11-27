import { Bot as BotIcon, ChevronRight, CircleDot, Folder, Inbox, Layers3, Network, PanelLeftClose, PanelLeftOpen, Play, Plus, Settings, Terminal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { canReviewTask, defaultCodexLabel, type Dashboard, type Task } from '../shared/workflow.ts'
import { BotEditor, DeleteTaskDialog, errorMessage, ProjectEditor, TaskEditor, WorkflowEditor } from './forms.tsx'
import { TaskDetail, TaskInfoDialog, TaskRow } from './task.tsx'

type Page = 'tasks' | 'projects' | 'bots' | 'settings'
type Modal = { kind: 'bot' | 'project' | 'workflow'; id?: string } | { kind: 'task'; projectId?: string } | { kind: 'task-info' | 'delete-task'; taskId: string }
type Filter = 'all' | 'active' | 'done'
const pageLabels: Record<Page, string> = { tasks: 'Tasks', projects: 'Projects', bots: 'Bots', settings: 'Settings' }
const navItems = [{ page: 'tasks', Icon: Inbox }, { page: 'projects', Icon: Folder }, { page: 'bots', Icon: BotIcon }, { page: 'settings', Icon: Settings }] as const
const sidebarStorageKey = 'meshwork.sidebar-collapsed'
const filters = [{ value: 'all', label: 'All' }, { value: 'active', label: 'In progress' }, { value: 'done', label: 'Finished' }] as const
const active = (task: Task) => canReviewTask(task) || ['queued', 'running', 'waiting'].includes(task.status)

export function App() {
  const [data, setData] = useState<Dashboard>({ bots: [], workflows: [], projects: [], tasks: [], codexPath: '' })
  const [page, setPage] = useState<Page>('tasks')
  const [modal, setModal] = useState<Modal>()
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string>()
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(sidebarStorageKey) === 'true')

  useEffect(() => {
    let alive = true
    let sequence = 0
    const refresh = async () => {
      const request = ++sequence
      try {
        const dashboard = await window.meshwork.load()
        if (alive && request === sequence) { setData(dashboard); setLoaded(true) }
      } catch (error) {
        if (alive && request === sequence) { setError(errorMessage(error)); setLoaded(true) }
      }
    }
    const unsubscribe = window.meshwork.subscribe(() => void refresh())
    void refresh()
    return () => { alive = false; unsubscribe() }
  }, [])

  async function perform(action: () => Promise<unknown>) {
    setError('')
    try { await action() }
    catch (error) { setError(errorMessage(error)) }
  }

  const visible = data.tasks.filter((task) => filter === 'all' || (filter === 'active' ? active(task) : !active(task)))
  const current = visible.find((task) => task.id === selected) ?? visible[0]
  const menuTask = modal?.kind === 'task-info' || modal?.kind === 'delete-task' ? data.tasks.find((task) => task.id === modal.taskId) : undefined
  const hasProjects = data.projects.length > 0
  const workflowsById = new Map(data.workflows.map((workflow) => [workflow.id, workflow]))
  const botsById = new Map(data.bots.map((bot) => [bot.id, bot]))
  const openTask = (projectId?: string) => {
    if (hasProjects) setModal({ kind: 'task', projectId })
    else setPage('projects')
  }
  const sidebarAction = sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'

  return <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
    <aside className="sidebar" id="workspace-sidebar">
      <div className="brand" title="Meshwork"><span className="brand-icon"><Network size={22} strokeWidth={1.8} /></span><span className="sidebar-label">Meshwork</span></div>
      <nav aria-label="Workspace navigation">
        {navItems.map(({ page: target, Icon }) => <button key={target} className={page === target ? 'selected' : ''} aria-current={page === target ? 'page' : undefined} aria-label={pageLabels[target]} title={sidebarCollapsed ? pageLabels[target] : undefined} onClick={() => setPage(target)}>
          <Icon size={18} /><span className="sidebar-label">{pageLabels[target]}</span>
        </button>)}
      </nav>
      <div className="local" title="Local workspace"><CircleDot size={13} /><span className="sidebar-label">Local workspace</span></div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="topbar-heading">
          <button type="button" className="icon-button" aria-label={sidebarAction} title={sidebarAction} aria-controls="workspace-sidebar" aria-expanded={!sidebarCollapsed} onClick={() => {
            const next = !sidebarCollapsed
            setSidebarCollapsed(next)
            localStorage.setItem(sidebarStorageKey, String(next))
          }}>{sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
          <div className="page-label">{pageLabels[page]}</div>
        </div>
        {page === 'tasks' && hasProjects && <button className="button primary" onClick={() => openTask()}><Plus size={17} /> New task</button>}
        {page === 'projects' && <button className="button primary" onClick={() => setModal({ kind: 'project' })}><Plus size={17} /> New project</button>}
        {page === 'bots' && <div className="actions">
          <button className="button secondary" onClick={() => setModal({ kind: 'bot' })}><Plus size={17} /> New bot</button>
          <button className="button primary" onClick={() => setModal({ kind: 'workflow' })}><Plus size={17} /> New workflow</button>
        </div>}
      </header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={17} /></button></div>}

      {page === 'tasks' && <div className="task-layout">
        <section className="task-list" aria-label="Tasks">
          <div className="segment" aria-label="Filter tasks">{filters.map(({ value, label }) => <button key={value} className={value === filter ? 'selected' : ''} aria-pressed={value === filter} onClick={() => setFilter(value)}>{label}</button>)}</div>
          {visible.length === 0 && <p className="empty-list">{loaded ? 'No tasks to show.' : 'Loading tasks…'}</p>}
          {visible.map((task) => <TaskRow key={task.id} task={task} selected={task.id === current?.id} select={() => setSelected(task.id)}
            showInfo={() => setModal({ kind: 'task-info', taskId: task.id })} remove={() => setModal({ kind: 'delete-task', taskId: task.id })} />)}
        </section>
        <div className="task-pane">
          {current ? <TaskDetail key={current.id} task={current} perform={perform} /> : <div className="empty-state">
            <span className="empty-icon"><Layers3 size={28} strokeWidth={1.55} /></span>
            <h1>{hasProjects ? 'Start a task' : 'Set up a project'}</h1>
            <p>{hasProjects ? 'Choose a project and describe what you want to accomplish.' : 'Create a project with a workspace folder to start running tasks.'}</p>
            <button className="button primary" onClick={() => openTask()}>{hasProjects ? <Plus size={17} /> : <Folder size={17} />} {hasProjects ? 'New task' : 'Go to Projects'}</button>
          </div>}
        </div>
      </div>}

      {page === 'projects' && <section className="content-page" aria-label="Local projects">
        <h1>Local projects</h1>
        {data.projects.length === 0 && <p className="muted">Choose a workspace folder to run tasks with Codex.</p>}
        <div className="bot-grid">{data.projects.map((project) => <article className="bot-card" key={project.id}>
          <div className="bot-card-heading"><span className="bot-icon"><Folder size={19} /></span><h2>{project.name}</h2><span className="muted">v{project.version}</span></div>
          <p className="folder"><Folder size={15} /><code title={project.workspace}>{project.workspace}</code></p>
          <p className="folder"><Network size={15} /> {project.workflowId ? (workflowsById.get(project.workflowId)?.name ?? 'Unavailable workflow') : defaultCodexLabel}</p>
          <div className="actions"><button className="button secondary" onClick={() => setModal({ kind: 'project', id: project.id })}>Edit project</button><button className="button primary" onClick={() => openTask(project.id)}><Play size={15} /> Run task</button></div>
        </article>)}</div>
      </section>}

      {page === 'bots' && <div className="content-page bot-library">
        <section aria-labelledby="workflows-heading">
          <h1 id="workflows-heading">Local workflows</h1>
          {data.workflows.length === 0 ? <p className="muted">Create a workflow to reuse its Bot and human steps across projects.</p> : <div className="bot-grid">{data.workflows.map((workflow) => <article className="bot-card" key={workflow.id}>
            <div className="bot-card-heading"><span className="bot-icon"><Network size={19} /></span><h2>{workflow.name}</h2><span className="muted">v{workflow.version}</span></div>
            <ol className="bot-steps">{workflow.steps.map((step, index) => <li key={index}>
              <span>{index + 1}</span><strong>{step.kind === 'human' ? step.role : step.kind === 'codex' ? defaultCodexLabel : (botsById.get(step.botId)?.name ?? 'Unavailable bot')}</strong>{step.kind === 'human' ? 'Human decision' : 'Codex'}
            </li>)}</ol>
            <div className="actions"><button className="button secondary" onClick={() => setModal({ kind: 'workflow', id: workflow.id })}>Edit workflow</button></div>
          </article>)}</div>}
        </section>
        <section aria-labelledby="bots-heading">
          <h1 id="bots-heading">Personal bots</h1>
          {data.bots.length === 0 ? <p className="muted">Create a bot to reuse its role and instructions in workflows.</p> : <div className="bot-grid">{data.bots.map((bot) => <article className="bot-card" key={bot.id}>
            <div className="bot-card-heading"><span className="bot-icon"><BotIcon size={19} /></span><h2>{bot.name}</h2><span className="muted">v{bot.version}</span></div>
            <p className="bot-description">{bot.instructions}</p>
            <p className="muted">Codex · {bot.access === 'read-only' ? 'Read only' : 'Workspace writes'}</p>
            <div className="actions"><button className="button secondary" onClick={() => setModal({ kind: 'bot', id: bot.id })}>Edit bot</button></div>
          </article>)}</div>}
        </section>
      </div>}

      {page === 'settings' && <section className="content-page" aria-label="Settings">
        <h1>Local settings</h1>
        <article className="settings-card"><div className="bot-card-heading"><span className="bot-icon"><Terminal size={19} /></span><h2>Codex CLI</h2></div>
          <p className="muted">Meshwork uses the installed Codex CLI and its existing sign-in.</p>
          <p className="runtime-path"><ChevronRight size={16} /><code>{data.codexPath || 'Detecting…'}</code></p>
          <div className="actions"><button className="button secondary" onClick={() => void perform(window.meshwork.chooseCodex)}>Choose executable</button><button className="button secondary" onClick={() => void perform(window.meshwork.resetCodex)}>Use automatic detection</button></div>
        </article>
      </section>}
    </main>

    {modal?.kind === 'bot' && <BotEditor bot={data.bots.find((bot) => bot.id === modal.id)} close={() => setModal(undefined)} save={async (input) => {
      await window.meshwork.saveBot(input, modal.id)
      setModal(undefined)
    }} />}
    {modal?.kind === 'workflow' && <WorkflowEditor workflow={data.workflows.find((workflow) => workflow.id === modal.id)} bots={data.bots} close={() => setModal(undefined)} save={async (input) => {
      await window.meshwork.saveWorkflow(input, modal.id)
      setModal(undefined)
    }} />}
    {modal?.kind === 'project' && <ProjectEditor project={data.projects.find((project) => project.id === modal.id)} workflows={data.workflows} close={() => setModal(undefined)} save={async (input) => {
      await window.meshwork.saveProject(input, modal.id)
      setModal(undefined)
    }} />}
    {modal?.kind === 'task' && <TaskEditor projects={data.projects} projectId={modal.projectId} close={() => setModal(undefined)} start={async (input) => {
      const task = await window.meshwork.startTask(input)
      setSelected(task.id)
      setFilter('all')
      setModal(undefined)
      setPage('tasks')
    }} />}
    {modal?.kind === 'task-info' && menuTask && <TaskInfoDialog task={menuTask} close={() => setModal(undefined)} />}
    {modal?.kind === 'delete-task' && menuTask && <DeleteTaskDialog title={menuTask.trigger.objective.split('\n')[0]} running={menuTask.status === 'running'} close={() => setModal(undefined)} remove={async () => {
      await window.meshwork.deleteTask(menuTask.id)
      setModal(undefined)
    }} />}
  </div>
}
