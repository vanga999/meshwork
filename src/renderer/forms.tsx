import { ArrowDown, ArrowUp, FolderOpen, Play, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Bot, BotInput, Project, ProjectInput, ProjectStep, TaskInput } from '../shared/workflow.ts'

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

type DraftStep = { id: string; value: ProjectStep }
const withDraftId = (value: ProjectStep) => ({ id: crypto.randomUUID(), value })

export function ProjectEditor({ project, bots, close, save }: { project?: Project; bots: Bot[]; close(): void; save(input: ProjectInput): Promise<void> }) {
  const [name, setName] = useState(project?.name ?? '')
  const [workspace, setWorkspace] = useState(project?.workspace ?? '')
  const [steps, setSteps] = useState<DraftStep[]>(() => project?.steps.map(withDraftId) ?? [])
  const [folderError, setFolderError] = useState('')

  function edit(id: string, value: ProjectStep) {
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

  return <DialogForm title={project ? 'Edit project' : 'New project'} action="Save project" close={close} submit={() => save({ name, workspace, steps: steps.map((step) => step.value) })}>
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
    <div className="section-heading"><h3>Workflow steps</h3><span className="muted">Runs in order</span></div>
    {bots.length === 0 && <p className="muted">Create a reusable role on the Bots page to add a bot step.</p>}
    {steps.map(({ id, value }, index) => <fieldset key={id} className="step-form">
      <legend>Step {index + 1}</legend>
      <div className="step-controls">
        <button className="icon-button" type="button" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
        <button className="icon-button" type="button" aria-label={`Move step ${index + 1} down`} disabled={index + 1 === steps.length} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
        <button className="icon-button" type="button" aria-label={`Remove step ${index + 1}`} onClick={() => setSteps(steps.filter((step) => step.id !== id))}><Trash2 size={16} /></button>
      </div>
      {value.kind === 'bot' ? <label>Bot<select value={value.botId} required onChange={(event) => edit(id, { ...value, botId: event.target.value })}>
        <option value="" disabled>Select a bot</option>
        {bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
      </select></label> : <label>Human role<input value={value.role} required maxLength={100} placeholder="Reviewer" onChange={(event) => edit(id, { ...value, role: event.target.value })} /></label>}
      <label>{value.kind === 'bot' ? 'Project instructions (optional)' : 'Decision instructions'}<textarea value={value.instructions} required={value.kind === 'human'} maxLength={12000} rows={3} placeholder={value.kind === 'bot' ? 'Add instructions for this bot in this project.' : 'Describe what the reviewer should verify.'} onChange={(event) => edit(id, { ...value, instructions: event.target.value })} /></label>
    </fieldset>)}
    <div className="actions">
      <button className="button secondary" type="button" disabled={!bots.length || steps.length >= 20} onClick={() => setSteps([...steps, withDraftId({ kind: 'bot', botId: '', instructions: '' })])}><Plus size={16} /> Add bot step</button>
      <button className="button secondary" type="button" disabled={steps.length >= 20} onClick={() => setSteps([...steps, withDraftId({ kind: 'human', role: '', instructions: '' })])}><Plus size={16} /> Add human step</button>
    </div>
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
