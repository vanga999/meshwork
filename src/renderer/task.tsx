import { Check, Circle, Ellipsis, FileText, Info, LoaderCircle, RotateCcw, Send, ShieldAlert, Square, Terminal, Trash2, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { agentName, canRetryTask, canReviewTask, taskMessageLimit, type Attempt, type Task, type TaskStatus } from '../shared/workflow.ts'
import { workflowDependencies, workflowLinks } from '../shared/workflow-graph.ts'
import { errorMessage, Modal } from './forms.tsx'
import { FilePreviewPane } from './file-preview.tsx'

const stateLabel: Record<TaskStatus, string> = {
  queued: 'Queued', running: 'Running', waiting: 'Needs decision', completed: 'Completed',
  'awaiting-review': 'Awaiting review', failed: 'Stopped', interrupted: 'Interrupted', cancelled: 'Cancelled',
}

type TaskActions = { task: Task; perform(action: () => Promise<unknown>): Promise<void> }
type PreviewSelection = { path?: string; open(path: string): void }

function Status({ status }: { status: TaskStatus }) {
  return <span className={`status status-${status}`}><span />{stateLabel[status]}</span>
}

function dateLabel(at: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))
}

function positionTaskMenu(button: HTMLButtonElement, menu: HTMLDivElement) {
  const anchor = button.getBoundingClientRect()
  const list = button.closest('.task-list')?.getBoundingClientRect()
  if (list && (anchor.bottom <= list.top || anchor.top >= list.bottom)) {
    menu.hidePopover()
    return
  }

  const { width, height } = menu.getBoundingClientRect()
  const gap = 4
  const edge = 8
  const below = anchor.bottom + gap
  const above = anchor.top - height - gap
  const maxTop = window.innerHeight - height - edge
  const top = below > maxTop && above >= edge ? above : below
  const left = Math.max(edge, Math.min(anchor.right - width, window.innerWidth - width - edge))
  menu.style.top = `${Math.max(edge, Math.min(top, maxTop))}px`
  menu.style.left = `${left}px`
}

export function TaskRow({ task, selected, select, showInfo, remove }: { task: Task; selected: boolean; select(): void; showInfo(): void; remove(): void }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = `task-actions-${task.id}`
  const title = task.trigger.objective.split('\n')[0]

  useEffect(() => {
    const button = trigger.current
    const popover = menu.current
    if (!button || !popover) return
    const list = button.closest('.task-list')
    const reposition = () => {
      if (popover.matches(':popover-open')) positionTaskMenu(button, popover)
    }
    const stopTracking = () => {
      list?.removeEventListener('scroll', reposition)
      window.removeEventListener('resize', reposition)
    }
    const trackPopover = () => {
      if (popover.matches(':popover-open')) {
        list?.addEventListener('scroll', reposition)
        window.addEventListener('resize', reposition)
        reposition()
      } else stopTracking()
    }
    popover.addEventListener('toggle', trackPopover)
    return () => {
      popover.removeEventListener('toggle', trackPopover)
      stopTracking()
    }
  }, [])

  return <div className={`task-row${selected ? ' selected' : ''}`}>
    <button type="button" className="task-select" aria-current={selected ? 'true' : undefined} onClick={select}>
      <span className="task-row-content"><strong>{title}</strong><span>{task.project.name}</span></span>
      <Status status={task.approvals.length ? 'waiting' : task.status} />
    </button>
    <button type="button" className="icon-button task-menu-trigger" aria-label={`Task actions for ${title}`} title="Task actions" popoverTarget={menuId} ref={trigger} onClick={(event) => {
      event.preventDefault()
      const popover = menu.current
      if (!popover) return
      if (popover.matches(':popover-open')) popover.hidePopover()
      else {
        popover.showPopover({ source: event.currentTarget })
        positionTaskMenu(event.currentTarget, popover)
      }
    }}><Ellipsis size={18} /></button>
    <div className="task-row-menu" id={menuId} popover="auto" ref={menu}>
      <button type="button" onClick={() => { menu.current?.hidePopover(); showInfo() }}><Info size={16} /> Task information</button>
      <button type="button" className="task-menu-delete" onClick={() => { menu.current?.hidePopover(); remove() }}><Trash2 size={16} /> Delete task</button>
    </div>
  </div>
}

export function TaskInfoDialog({ task, close }: { task: Task; close(): void }) {
  return <Modal title="Task information" close={close}>
    <dl className="task-info">
      <dt>Objective</dt><dd className="objective">{task.trigger.objective}</dd>
      <dt>Status</dt><dd><Status status={task.approvals.length ? 'waiting' : task.status} /></dd>
      <dt>Project</dt><dd>{task.project.name}</dd>
      <dt>Workspace</dt><dd><code>{task.project.workspace}</code></dd>
      <dt>Coding agent</dt><dd>{agentName(task.agent)}</dd>
      {task.agent?.model && <><dt>Model</dt><dd>{task.agent.model}</dd></>}
      {task.agent?.baseUrl && <><dt>Model endpoint</dt><dd><code>{task.agent.baseUrl}</code></dd></>}
      {task.project.workflow && <><dt>Workflow</dt><dd>{task.project.workflow.name} · v{task.project.workflow.version}</dd></>}
      <dt>Created</dt><dd><time dateTime={task.createdAt}>{dateLabel(task.createdAt)}</time></dd>
      <dt>Last updated</dt><dd><time dateTime={task.updatedAt}>{dateLabel(task.updatedAt)}</time></dd>
      <dt>Task ID</dt><dd><code>{task.id}</code></dd>
    </dl>
  </Modal>
}

function AttemptDetails({ attempt, preview }: { attempt: Attempt; preview: PreviewSelection }) {
  return <div className="attempt">
    {attempt.result && <div className="result">
      <p className="result-summary">{attempt.result.summary}</p>
      {attempt.result.details && <p className="result-details">{attempt.result.details}</p>}
      {attempt.result.files.length > 0 && <ul className="files">{attempt.result.files.map((file, index) => <li key={`${file}-${index}`}>
        <button type="button" className="file-link" title={file} aria-pressed={preview.path === file} aria-controls={preview.path === file ? 'task-file-preview' : undefined} onClick={() => preview.open(file)}><FileText size={15} /><code>{file}</code></button>
      </li>)}</ul>}
    </div>}
    {attempt.error && <p className="form-error">{attempt.error}</p>}
    {attempt.activity.length > 0 && <details className="activity" open={attempt.status === 'running' ? true : undefined}>
      <summary>Execution activity</summary>
      <ul>{attempt.activity.map(({ at, label, detail }, index) => <li key={index} title={dateLabel(at)}><strong>{label}</strong>{detail && <span>{detail}</span>}</li>)}</ul>
    </details>}
    {attempt.provider && <details className="activity"><summary>Agent session</summary><code>{attempt.provider.threadId}</code>{attempt.provider.turnId && <code>{attempt.provider.turnId}</code>}</details>}
  </div>
}

function HumanDecision({ task, perform, stepIndex }: TaskActions & { stepIndex: number }) {
  const [note, setNote] = useState('')
  const noteId = `decision-note-${stepIndex}`
  return <div className="decision">
    <label htmlFor={noteId}>Decision note</label>
    <textarea id={noteId} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={12000} placeholder="Summarize what you checked or what needs work." />
    <div className="actions">
      <button className="button primary" disabled={!note.trim()} onClick={() => void perform(() => window.meshwork.completeHumanStep(task.id, true, note, stepIndex))}><Check size={16} /> Approve</button>
      <button className="button secondary" disabled={!note.trim()} onClick={() => void perform(() => window.meshwork.completeHumanStep(task.id, false, note, stepIndex))}>Stop with feedback</button>
    </div>
  </div>
}

function ApprovalRequests({ task, perform, stepIndex }: TaskActions & { stepIndex: number }) {
  return task.approvals.filter((approval) => (approval.stepIndex ?? task.stepIndex) === stepIndex).map((approval) => <section className="approval" key={approval.id}>
    <h4><ShieldAlert size={16} /> {approval.title}</h4>
    {approval.detail && <pre>{approval.detail}</pre>}
    <div className="actions"><button className="button primary" onClick={() => void perform(() => window.meshwork.answerApproval(task.id, approval.id, true))}>Allow once</button><button className="button secondary" onClick={() => void perform(() => window.meshwork.answerApproval(task.id, approval.id, false))}>Decline</button></div>
  </section>)
}

function TaskConversation({ task, perform, preview }: TaskActions & { preview: PreviewSelection }) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const messages = task.messages ?? []
  const finished = task.status === 'completed'
  const canReview = canReviewTask(task)
  const agent = agentName(task.agent)

  async function act(action: () => Promise<void>) {
    setPending(true)
    setError('')
    try {
      await action()
      setText('')
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  if (finished && !messages.length) return null
  return <section className="task-conversation" aria-labelledby="conversation-heading">
    <h2 id="conversation-heading">Conversation</h2>
    {messages.map((message) => {
      const attempts = task.attempts.filter((attempt) => attempt.messageId === message.id)
      return <div className="conversation-turn" key={message.id}>
        <div className="conversation-message">
          <div className="conversation-meta"><strong>You</strong><time dateTime={message.createdAt}>{dateLabel(message.createdAt)}</time></div>
          <p>{message.text}</p>
        </div>
        {attempts.map((attempt) => <div className="conversation-reply" key={attempt.id}>
          <div className="conversation-meta"><strong>{agent}</strong><Status status={attempt.status} /></div>
          <AttemptDetails attempt={attempt} preview={preview} />
        </div>)}
        {message === messages.at(-1) && task.stepIndex === task.project.steps.length && <>
          {task.status === 'queued' && <p className="muted" role="status">Follow-up queued.</p>}
          <ApprovalRequests task={task} perform={perform} stepIndex={task.project.steps.length} />
        </>}
      </div>
    })}
    {!finished && <form className="conversation-composer" onSubmit={(event) => {
      event.preventDefault()
      if (canReview && !pending && text.trim()) void act(() => window.meshwork.sendFollowUp(task.id, text))
    }}>
      <label htmlFor="task-follow-up">Follow-up message</label>
      <textarea id="task-follow-up" rows={3} maxLength={taskMessageLimit} value={text} disabled={pending} onChange={(event) => setText(event.target.value)} placeholder={`Tell ${agent} what to change or check.`} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="actions conversation-actions">
        <button className="button primary" type="submit" disabled={pending || !canReview || !text.trim()}><Send size={15} /> Send follow-up</button>
        {canReview && <button className="button secondary" type="button" disabled={pending} onClick={() => void act(() => window.meshwork.completeTask(task.id))}><Check size={16} /> Mark complete</button>}
      </div>
      {!canReview && <p className="muted">You can send a follow-up once the workflow is ready for review.</p>}
    </form>}
  </section>
}

export function TaskDetail({ task, perform }: TaskActions) {
  const [file, setFile] = useState<{ path: string; request: number }>()
  const preview: PreviewSelection = { path: file?.path, open: (path) => setFile((current) => ({ path, request: (current?.request ?? 0) + 1 })) }
  return <div className={`task-workspace${file ? ' preview-open' : ''}`} onKeyDown={(event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && event.target instanceof Element && !event.target.closest('dialog')) setFile(undefined)
  }}>
    <TaskContent task={task} perform={perform} preview={preview} />
    {file && <FilePreviewPane key={file.request} taskId={task.id} path={file.path} close={() => setFile(undefined)} />}
  </div>
}

function TaskContent({ task, perform, preview }: TaskActions & { preview: PreviewSelection }) {
  const title = task.trigger.objective.split('\n')[0]
  const finished = task.attempts.filter((attempt) => !attempt.messageId && attempt.status === 'completed').length
  const { steps, graph } = task.project
  const dependencies = graph && workflowDependencies(steps.length, workflowLinks(steps.length, graph))
  return <article className="task-detail">
    <header className="detail-heading">
      <div className="detail-meta"><Status status={task.approvals.length ? 'waiting' : task.status} /><span>{task.project.name} · v{task.project.version}</span><span>{dateLabel(task.createdAt)}</span></div>
      <h1>{title}</h1>
      <div className="detail-meta"><code>{task.project.workspace}</code></div>
      {task.trigger.objective !== title && <p className="objective">{task.trigger.objective.slice(title.length).trim()}</p>}
      <div className="actions">
        {['running', 'waiting', 'queued'].includes(task.status) && <button className="button secondary" onClick={() => void perform(() => window.meshwork.cancelTask(task.id))}><Square size={14} /> Stop task</button>}
        {canRetryTask(task) && <button className="button secondary" onClick={() => void perform(() => window.meshwork.retryTask(task.id))}><RotateCcw size={15} /> {task.stepIndex === steps.length ? 'Retry follow-up' : graph ? 'Retry stopped nodes' : 'Retry current step'}</button>}
      </div>
    </header>
    <div className="step-summary"><h2>{task.project.workflow?.name ?? 'Workflow'}</h2><span>{task.project.workflow && `v${task.project.workflow.version} · `}{finished} of {task.project.steps.length} complete</span></div>
    <ol className={`timeline${graph ? ' graph-timeline' : ''}`}>
      {steps.map((step, index) => {
        const history = task.attempts.filter((attempt) => attempt.stepIndex === index)
        const latest = history.at(-1)
        const current = latest?.status === 'running' || latest?.status === 'waiting' || (!graph && task.stepIndex === index)
        return <li className={`timeline-step ${current ? 'current-step' : ''}`} key={index}>
          <div className="timeline-icon">{latest?.status === 'completed' ? <Check size={16} /> : latest?.status === 'running' ? <LoaderCircle size={16} className="spin" /> : <Circle size={14} />}</div>
          <div className="timeline-content">
            <div className="step-heading"><h3>{step.role}</h3><span>{step.kind === 'codex' ? <Terminal size={14} /> : <UserRound size={14} />}{step.kind === 'codex' ? agentName(task.agent) : 'Human decision'}</span></div>
            {dependencies?.[index].length ? <p className="step-dependencies">Inputs from {dependencies[index].map((parent) => steps[parent].role).join(', ')}</p> : null}
            <p className="instructions">{step.instructions}</p>
            {latest && <AttemptDetails attempt={latest} preview={preview} />}
            {history.length > 1 && <details className="activity"><summary>Previous attempts ({history.length - 1})</summary>{history.slice(0, -1).map((attempt) => <div className="previous-attempt" key={attempt.id}><p className="muted">{dateLabel(attempt.startedAt)} · {stateLabel[attempt.status]}</p><AttemptDetails attempt={attempt} preview={preview} /></div>)}</details>}
            {latest?.status === 'waiting' && <HumanDecision key={latest.id} task={task} perform={perform} stepIndex={index} />}
            {latest?.status === 'running' && <ApprovalRequests task={task} perform={perform} stepIndex={index} />}
          </div>
        </li>
      })}
    </ol>
    <TaskConversation task={task} perform={perform} preview={preview} />
  </article>
}
