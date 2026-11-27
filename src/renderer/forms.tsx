import { ArrowDown, ArrowUp, Bot as BotIcon, FolderOpen, Play, Plus, Terminal, Trash2, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { defaultCodexLabel, type Bot, type BotInput, type Project, type ProjectInput, type TaskInput, type Workflow, type WorkflowInput, type WorkflowStep } from '../shared/workflow.ts'

export function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

function Modal({ title, children, close }: { title: string; children: ReactNode; close(): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} aria-labelledby="modal-title" onCancel={(event) => { event.preventDefault(); close() }}>
    <header className="modal-heading">
      <h2 id="modal-title">{title}</h2>
      <button className="icon-button" type="button" onClick={close} aria-label="Close"><X size={19} /></button>
    </header>
    {children}
  </dialog>
}

function DialogForm({ title, action, close, submit, children }: { title: string; action: ReactNode; close(): void; submit(): Promise<void>; children: ReactNode }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try { await submit() }
    catch (error) { setError(errorMessage(error)); setBusy(false) }
  }

  return <Modal title={title} close={close}>
    <form className="form" onSubmit={handleSubmit}>
      {children}
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="form-footer"><button type="button" className="button secondary" onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{action}</button></footer>
    </form>
  </Modal>
}

export function BotEditor({ bot, close, save }: { bot?: Bot; close(): void; save(input: BotInput): Promise<void> }) {
  const [name, setName] = useState(bot?.name ?? '')
  const [instructions, setInstructions] = useState(bot?.instructions ?? '')
  const [access, setAccess] = useState<BotInput['access']>(bot?.access ?? 'read-only')

  return <DialogForm title={bot ? 'Edit bot' : 'New bot'} action="Save bot" close={close} submit={() => save({ name, instructions, access })}>
    <label>Bot name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} placeholder="Code reviewer" /></label>
    <label>Responsibilities<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} required maxLength={12000} rows={5} placeholder="Describe this bot's role and the result it should return." /></label>
    <label>Codex workspace access<select value={access} onChange={(event) => setAccess(event.target.value === 'workspace-write' ? 'workspace-write' : 'read-only')}><option value="read-only">Read only</option><option value="workspace-write">Allow workspace writes</option></select></label>
  </DialogForm>
}

export function ProjectEditor({ project, workflows, close, save }: { project?: Project; workflows: Workflow[]; close(): void; save(input: ProjectInput): Promise<void> }) {
  const [name, setName] = useState(project?.name ?? '')
  const [workspace, setWorkspace] = useState(project?.workspace ?? '')
  const [workflowId, setWorkflowId] = useState(project?.workflowId ?? '')
  const [folderError, setFolderError] = useState('')

  return <DialogForm title={project ? 'Edit project' : 'New project'} action="Save project" close={close} submit={() => save({ name, workspace, workflowId: workflowId || undefined })}>
    <label>Project name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} placeholder="Project name" /></label>
    <label>Workspace folder
      <span className="input-group">
        <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} required placeholder="/path/to/workspace" />
        <button className="button secondary" type="button" onClick={() => {
          setFolderError('')
          void window.meshwork.chooseWorkspace().then((selected) => { if (selected) setWorkspace(selected) }, (error) => setFolderError(errorMessage(error)))
        }}><FolderOpen size={16} /> Browse</button>
      </span>
    </label>
    {folderError && <p className="form-error" role="alert">{folderError}</p>}
    <label>Workflow<select value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>
      <option value="">{defaultCodexLabel}</option>
      {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
    </select></label>
  </DialogForm>
}

type DraftStep = { id: string; value: WorkflowStep }
const withDraftId = (value: WorkflowStep) => ({ id: crypto.randomUUID(), value })

export function WorkflowEditor({ workflow, bots, close, save }: { workflow?: Workflow; bots: Bot[]; close(): void; save(input: WorkflowInput): Promise<void> }) {
  const [name, setName] = useState(workflow?.name ?? '')
  const [steps, setSteps] = useState<DraftStep[]>(() => workflow?.steps.map(withDraftId) ?? [])
  const picker = useRef<HTMLDetailsElement>(null)

  function edit(id: string, value: WorkflowStep) {
    setSteps((current) => current.map((step) => step.id === id ? { id, value } : step))
  }

  function move(index: number, direction: number) {
    setSteps((current) => {
      const next = [...current]
      const [step] = next.splice(index, 1)
      next.splice(index + direction, 0, step)
      return next
    })
  }

  function add(value: WorkflowStep) {
    const step = withDraftId(value)
    setSteps((current) => [...current, step])
    if (picker.current) {
      picker.current.open = false
      picker.current.querySelector('summary')?.focus()
    }
  }

  return <DialogForm title={workflow ? 'Edit workflow' : 'New workflow'} action="Save workflow" close={close} submit={() => {
    if (!steps.length) throw new Error('Add at least one workflow step.')
    return save({ name, steps: steps.map((step) => step.value) })
  }}>
    <label>Workflow name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} placeholder="Code review and approval" /></label>
    <div className="section-heading"><h3>Steps</h3><span className="muted">Runs in order</span></div>
    {steps.map(({ id, value }, index) => <fieldset key={id} className="step-form">
      <legend>Step {index + 1}</legend>
      <div className="step-controls">
        <button className="icon-button" type="button" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
        <button className="icon-button" type="button" aria-label={`Move step ${index + 1} down`} disabled={index + 1 === steps.length} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
        <button className="icon-button" type="button" aria-label={`Remove step ${index + 1}`} onClick={() => setSteps((current) => current.filter((step) => step.id !== id))}><Trash2 size={16} /></button>
      </div>
      {value.kind === 'bot' ? <label>Bot<select value={value.botId} required onChange={(event) => edit(id, { ...value, botId: event.target.value })}>
        {bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
      </select></label> : value.kind === 'human' ? <label>Human role<input value={value.role} required maxLength={100} placeholder="Reviewer" onChange={(event) => edit(id, { ...value, role: event.target.value })} /></label> : <strong>{defaultCodexLabel}</strong>}
      <label>{value.kind === 'human' ? 'Decision instructions' : 'Step instructions (optional)'}<textarea value={value.instructions} required={value.kind === 'human'} maxLength={12000} rows={3} placeholder={value.kind === 'human' ? 'Describe what the reviewer should verify.' : 'Describe what this step should do.'} onChange={(event) => edit(id, { ...value, instructions: event.target.value })} /></label>
    </fieldset>)}
    {steps.length < 20 ? <details className="step-picker" ref={picker} onKeyDown={(event) => {
      if (event.key === 'Escape' && event.currentTarget.open) {
        event.preventDefault()
        event.currentTarget.open = false
        event.currentTarget.querySelector('summary')?.focus()
      }
    }}>
      <summary className="button secondary" aria-label="Add step" title="Add step"><Plus size={18} /></summary>
      <div className="step-options">
        <button type="button" onClick={() => add({ kind: 'codex', instructions: '' })}><Terminal size={16} /> {defaultCodexLabel}</button>
        {bots.map((bot) => <button key={bot.id} type="button" onClick={() => add({ kind: 'bot', botId: bot.id, instructions: '' })}><BotIcon size={16} /> {bot.name}</button>)}
        <button type="button" onClick={() => add({ kind: 'human', role: '', instructions: '' })}><UserRound size={16} /> Human decision</button>
      </div>
    </details> : <button className="button secondary step-limit" type="button" disabled aria-label="Workflow step limit reached" title="Workflows support up to 20 steps"><Plus size={18} /></button>}
  </DialogForm>
}

export function TaskEditor({ projects, projectId, close, start }: { projects: Project[]; projectId?: string; close(): void; start(input: TaskInput): Promise<void> }) {
  const [selected, setSelected] = useState(projectId ?? projects[0]?.id ?? '')
  const [objective, setObjective] = useState('')
  return <DialogForm title="New task" action={<><Play size={16} /> Start task</>} close={close} submit={() => start({ projectId: selected, objective })}>
    <label>Project<select value={selected} required onChange={(event) => setSelected(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    <label>Task objective<textarea rows={5} value={objective} required maxLength={20000} placeholder="What should be accomplished, and how will you accept the result?" onChange={(event) => setObjective(event.target.value)} /></label>
  </DialogForm>
}
