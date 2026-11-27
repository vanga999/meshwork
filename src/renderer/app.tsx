import { Bot as BotIcon, ChevronRight, CircleDot, Folder, Inbox, Layers3, Network, Play, Plus, Settings, Terminal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Dashboard, Task } from '../shared/workflow.ts'
import { BotEditor, errorMessage, ProjectEditor, TaskEditor } from './forms.tsx'
import { Status, TaskDetail } from './task.tsx'

type Page = 'tasks' | 'projects' | 'bots' | 'settings'
type Modal = { kind: 'bot' | 'project'; id?: string } | { kind: 'task'; projectId?: string }
type Filter = 'all' | 'active' | 'done'
const pageLabels: Record<Page, string> = { tasks: 'Tasks', projects: 'Projects', bots: 'Bots', settings: 'Settings' }
const filters = [{ value: 'all', label: 'All' }, { value: 'active', label: 'In progress' }, { value: 'done', label: 'Finished' }] as const
const active = (task: Task) => ['queued', 'running', 'waiting'].includes(task.status)

export function App() {
  const [data, setData] = useState<Dashboard>({ bots: [], projects: [], tasks: [], codexPath: '' })
  const [page, setPage] = useState<Page>('tasks')
  const [modal, setModal] = useState<Modal>()
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string>()
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

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
  const runnableProjects = data.projects.filter((project) => project.steps.length > 0)
  const botsById = new Map(data.bots.map((bot) => [bot.id, bot]))
  const openTask = (projectId?: string) => {
    if (runnableProjects.length) setModal({ kind: 'task', projectId })
    else setPage('projects')
  }

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon"><Network size={22} strokeWidth={1.8} /></span><span>Meshwork</span></div>
      <nav aria-label="Workspace navigation">
        <button className={page === 'tasks' ? 'selected' : ''} aria-current={page === 'tasks' ? 'page' : undefined} onClick={() => setPage('tasks')}><Inbox size={18} /> Tasks</button>
        <button className={page === 'projects' ? 'selected' : ''} aria-current={page === 'projects' ? 'page' : undefined} onClick={() => setPage('projects')}><Folder size={18} /> Projects</button>
        <button className={page === 'bots' ? 'selected' : ''} aria-current={page === 'bots' ? 'page' : undefined} onClick={() => setPage('bots')}><BotIcon size={18} /> Bots</button>
        <button className={page === 'settings' ? 'selected' : ''} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => setPage('settings')}><Settings size={17} /> Settings</button>
      </nav>
      <div className="local"><CircleDot size={13} /> Local workspace</div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="page-label">{pageLabels[page]}</div>
        {page === 'tasks' && runnableProjects.length > 0 && <button className="button primary" onClick={() => openTask()}><Plus size={17} /> New task</button>}
        {page === 'projects' && <button className="button primary" onClick={() => setModal({ kind: 'project' })}><Plus size={17} /> New project</button>}
        {page === 'bots' && <button className="button primary" onClick={() => setModal({ kind: 'bot' })}><Plus size={17} /> New bot</button>}
      </header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={17} /></button></div>}

      {page === 'tasks' && <div className="task-layout">
        <section className="task-list" aria-label="Tasks">
          <div className="segment" aria-label="Filter tasks">{filters.map(({ value, label }) => <button key={value} className={value === filter ? 'selected' : ''} aria-pressed={value === filter} onClick={() => setFilter(value)}>{label}</button>)}</div>
          {visible.length === 0 && <p className="empty-list">{loaded ? 'No tasks to show.' : 'Loading tasks…'}</p>}
          {visible.map((task) => <button className={`task-row ${task.id === current?.id ? 'selected' : ''}`} key={task.id} onClick={() => setSelected(task.id)}>
            <div className="task-row-content"><strong>{task.trigger.objective.split('\n')[0]}</strong><span>{task.project.name}</span></div>
            <Status status={task.approvals.length ? 'waiting' : task.status} />
          </button>)}
        </section>
        <div className="task-pane">
          {current ? <TaskDetail key={current.id} task={current} perform={perform} /> : <div className="empty-state">
            <span className="empty-icon"><Layers3 size={28} strokeWidth={1.55} /></span>
            <h1>{runnableProjects.length ? 'Start a task' : 'Set up a project'}</h1>
            <p>{runnableProjects.length ? 'Select a project and give its workflow an objective. Each step and its results will appear here.' : 'Choose a workspace and arrange the bot and human steps that will run there.'}</p>
            <button className="button primary" onClick={() => openTask()}>{runnableProjects.length ? <Plus size={17} /> : <Folder size={17} />} {runnableProjects.length ? 'New task' : 'Go to Projects'}</button>
          </div>}
        </div>
      </div>}

      {page === 'projects' && <section className="content-page" aria-label="Local projects">
        <h1>Local projects</h1>
        {data.projects.length === 0 && <p className="muted">Create a project to choose its workspace and configure its workflow.</p>}
        <div className="bot-grid">{data.projects.map((project) => <article className="bot-card" key={project.id}>
          <div className="bot-card-heading"><span className="bot-icon"><Folder size={19} /></span><h2>{project.name}</h2><span className="muted">v{project.version}</span></div>
          <p className="folder"><Folder size={15} /><code title={project.workspace}>{project.workspace}</code></p>
          {project.steps.length > 0 ? <ol className="bot-steps">{project.steps.map((step, index) => <li key={index}>
            <span>{index + 1}</span><strong>{step.kind === 'human' ? step.role : (botsById.get(step.botId)?.name ?? 'Unavailable bot')}</strong>{step.kind === 'human' ? 'Human decision' : 'Codex bot'}
          </li>)}</ol> : <p className="muted">Add a workflow step to run tasks.</p>}
          <div className="actions"><button className="button secondary" onClick={() => setModal({ kind: 'project', id: project.id })}>Edit project</button><button className="button primary" disabled={!project.steps.length} onClick={() => openTask(project.id)}><Play size={15} /> Run task</button></div>
        </article>)}</div>
      </section>}

      {page === 'bots' && <section className="content-page" aria-label="Personal bots">
        <h1>Personal bots</h1>
        {data.bots.length === 0 && <p className="muted">Define reusable roles to assign to steps in your projects.</p>}
        <div className="bot-grid">{data.bots.map((bot) => <article className="bot-card" key={bot.id}>
          <div className="bot-card-heading"><span className="bot-icon"><BotIcon size={19} /></span><h2>{bot.name}</h2><span className="muted">v{bot.version}</span></div>
          <p className="bot-description">{bot.instructions}</p>
          <p className="muted">Codex · {bot.access === 'read-only' ? 'Read only' : 'Workspace writes'}</p>
          <div className="actions"><button className="button secondary" onClick={() => setModal({ kind: 'bot', id: bot.id })}>Edit bot</button></div>
        </article>)}</div>
      </section>}

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
    {modal?.kind === 'project' && <ProjectEditor project={data.projects.find((project) => project.id === modal.id)} bots={data.bots} close={() => setModal(undefined)} save={async (input) => {
      await window.meshwork.saveProject(input, modal.id)
      setModal(undefined)
    }} />}
    {modal?.kind === 'task' && <TaskEditor projects={runnableProjects} projectId={modal.projectId} close={() => setModal(undefined)} start={async (input) => {
      const task = await window.meshwork.startTask(input)
      setSelected(task.id)
      setFilter('all')
      setModal(undefined)
      setPage('tasks')
    }} />}
  </div>
}
