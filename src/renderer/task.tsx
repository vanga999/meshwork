import { Check, Circle, FileText, LoaderCircle, RotateCcw, ShieldAlert, Square, Terminal, UserRound } from 'lucide-react'
import { useState } from 'react'
import type { Attempt, Task, TaskStatus } from '../shared/workflow.ts'

const stateLabel: Record<TaskStatus, string> = {
  queued: 'Queued', running: 'Running', waiting: 'Needs decision', completed: 'Completed',
  failed: 'Stopped', interrupted: 'Interrupted', cancelled: 'Cancelled',
}

export function Status({ status }: { status: TaskStatus }) {
  return <span className={`status status-${status}`}><span />{stateLabel[status]}</span>
}

export function dateLabel(at: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))
}

function AttemptDetails({ attempt }: { attempt: Attempt }) {
  return <div className="attempt">
    {attempt.result && <div className="result">
      <p className="result-summary">{attempt.result.summary}</p>
      {attempt.result.details && <p className="result-details">{attempt.result.details}</p>}
      {attempt.result.files.length > 0 && <ul className="files">{attempt.result.files.map((file, index) => <li key={`${file}-${index}`}><FileText size={14} /><code>{file}</code></li>)}</ul>}
    </div>}
    {attempt.error && <p className="form-error">{attempt.error}</p>}
    {attempt.activity.length > 0 && <details className="activity" open={attempt.status === 'running' ? true : undefined}>
      <summary>Execution activity</summary>
      <ul>{attempt.activity.map(({ at, label, detail }, index) => <li key={index} title={dateLabel(at)}><strong>{label}</strong>{detail && <span>{detail}</span>}</li>)}</ul>
    </details>}
    {attempt.provider && <details className="activity"><summary>Codex session</summary><code>{attempt.provider.threadId}</code>{attempt.provider.turnId && <code>{attempt.provider.turnId}</code>}</details>}
  </div>
}

function HumanDecision({ task, perform }: { task: Task; perform(action: () => Promise<unknown>): Promise<void> }) {
  const [note, setNote] = useState('')
  return <div className="decision">
    <label htmlFor="decision-note">Decision note</label>
    <textarea id="decision-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={12000} placeholder="Summarize what you checked or what needs work." />
    <div className="actions">
      <button className="button primary" disabled={!note.trim()} onClick={() => void perform(() => window.meshwork.completeHumanStep(task.id, true, note))}><Check size={16} /> Approve</button>
      <button className="button secondary" disabled={!note.trim()} onClick={() => void perform(() => window.meshwork.completeHumanStep(task.id, false, note))}>Stop with feedback</button>
    </div>
  </div>
}

export function TaskDetail({ task, perform }: { task: Task; perform(action: () => Promise<unknown>): Promise<void> }) {
  const title = task.trigger.objective.split('\n')[0]
  const finished = task.attempts.filter((attempt) => attempt.status === 'completed').length
  return <article className="task-detail">
    <header className="detail-heading">
      <div className="detail-meta"><Status status={task.approvals.length ? 'waiting' : task.status} /><span>{task.project.name} · v{task.project.version}</span><span>{dateLabel(task.createdAt)}</span></div>
      <h1>{title}</h1>
      <div className="detail-meta"><code>{task.project.workspace}</code></div>
      {task.trigger.objective !== title && <p className="objective">{task.trigger.objective.slice(title.length).trim()}</p>}
      <div className="actions">
        {['running', 'waiting', 'queued'].includes(task.status) && <button className="button secondary" onClick={() => void perform(() => window.meshwork.cancelTask(task.id))}><Square size={14} /> Stop task</button>}
        {['interrupted', 'failed', 'cancelled'].includes(task.status) && <button className="button secondary" onClick={() => void perform(() => window.meshwork.retryTask(task.id))}><RotateCcw size={15} /> Retry current step</button>}
      </div>
    </header>
    <div className="step-summary"><h2>Workflow</h2><span>{finished} of {task.project.steps.length} complete</span></div>
    <ol className="timeline">
      {task.project.steps.map((step, index) => {
        const history = task.attempts.filter((attempt) => attempt.stepIndex === index)
        const latest = history.at(-1)
        const current = task.stepIndex === index
        return <li className={`timeline-step ${current ? 'current-step' : ''}`} key={index}>
          <div className="timeline-icon">{latest?.status === 'completed' ? <Check size={16} /> : latest?.status === 'running' ? <LoaderCircle size={16} className="spin" /> : <Circle size={14} />}</div>
          <div className="timeline-content">
            <div className="step-heading"><h3>{step.role}</h3><span>{step.kind === 'codex' ? <Terminal size={14} /> : <UserRound size={14} />}{step.kind === 'codex' ? 'Codex' : 'Human decision'}</span></div>
            <p className="instructions">{step.instructions}</p>
            {latest && <AttemptDetails attempt={latest} />}
            {history.length > 1 && <details className="activity"><summary>Previous attempts ({history.length - 1})</summary>{history.slice(0, -1).map((attempt) => <div className="previous-attempt" key={attempt.id}><p className="muted">{dateLabel(attempt.startedAt)} · {stateLabel[attempt.status]}</p><AttemptDetails attempt={attempt} /></div>)}</details>}
            {current && task.status === 'waiting' && <HumanDecision key={latest?.id} task={task} perform={perform} />}
            {current && task.approvals.map((approval) => <section className="approval" key={approval.id}>
              <h4><ShieldAlert size={16} /> {approval.title}</h4>
              {approval.detail && <pre>{approval.detail}</pre>}
              <div className="actions"><button className="button primary" onClick={() => void perform(() => window.meshwork.answerApproval(task.id, approval.id, true))}>Allow once</button><button className="button secondary" onClick={() => void perform(() => window.meshwork.answerApproval(task.id, approval.id, false))}>Decline</button></div>
            </section>)}
          </div>
        </li>
      })}
    </ol>
  </article>
}
