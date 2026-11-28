import { FolderOpen, Play, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { agentDriverNames, agentDriverSchema, agentIdSchema, defaultAgentLabel, type AgentConnectionInput, type AgentId, type AgentProfileInput, type AgentSettings, type Bot, type BotInput, type Project, type ProjectInput, type TaskInput, type Workflow } from '../shared/workflow.ts'

export function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export function Modal({ title, children, close, className }: { title: string; children: ReactNode; close(): void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className={className} aria-labelledby="modal-title" onCancel={(event) => { event.preventDefault(); close() }}>
    <header className="modal-heading">
      <h2 id="modal-title">{title}</h2>
      <button className="icon-button" type="button" onClick={close} aria-label="Close"><X size={19} /></button>
    </header>
    {children}
  </dialog>
}

export function DialogForm({ title, action, close, submit, children, destructive = false, className }: { title: string; action: ReactNode; close(): void; submit(): Promise<void>; children: ReactNode; destructive?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try { await submit() }
    catch (error) { setError(errorMessage(error)); setBusy(false) }
  }

  return <Modal title={title} className={className} close={() => { if (!destructive || !busy) close() }}>
    <form className="form" onSubmit={handleSubmit}>
      {children}
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="form-footer"><button type="button" className="button secondary" onClick={close} disabled={destructive && busy} autoFocus={destructive}>Cancel</button><button type="submit" className={`button ${destructive ? 'danger' : 'primary'}`} disabled={busy}>{action}</button></footer>
    </form>
  </Modal>
}

export function DeleteTaskDialog({ title, running, close, remove }: { title: string; running: boolean; close(): void; remove(): Promise<void> }) {
  return <DialogForm title="Delete task?" action={<><Trash2 size={15} /> Delete task</>} close={close} submit={remove} destructive>
    <p className="delete-description">{running ? 'Stop the current run and permanently delete' : 'Permanently delete'} <strong>{title}</strong> and its task history?</p>
  </DialogForm>
}

export function BotEditor({ bot, close, save }: { bot?: Bot; close(): void; save(input: BotInput): Promise<void> }) {
  const [name, setName] = useState(bot?.name ?? '')
  const [instructions, setInstructions] = useState(bot?.instructions ?? '')
  const [access, setAccess] = useState<BotInput['access']>(bot?.access ?? 'read-only')

  return <DialogForm title={bot ? 'Edit bot' : 'New bot'} action="Save bot" close={close} submit={() => save({ name, instructions, access })}>
    <label>Bot name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} placeholder="Code reviewer" /></label>
    <label>Responsibilities<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} required maxLength={12000} rows={5} placeholder="Describe this bot's role and the result it should return." /></label>
    <label>Workspace access<select value={access} onChange={(event) => setAccess(event.target.value === 'workspace-write' ? 'workspace-write' : 'read-only')}><option value="read-only">Read only</option><option value="workspace-write">Allow workspace writes</option></select></label>
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
      <option value="">{defaultAgentLabel}</option>
      {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
    </select></label>
  </DialogForm>
}

export function TaskEditor({ projects, projectId, defaultAgent, agents, close, start }: { projects: Project[]; projectId?: string; defaultAgent: AgentId; agents: AgentSettings[]; close(): void; start(input: TaskInput): Promise<void> }) {
  const [selected, setSelected] = useState(projectId ?? projects[0]?.id ?? '')
  const [agent, setAgent] = useState(defaultAgent)
  const [objective, setObjective] = useState('')
  return <DialogForm title="New task" action={<><Play size={16} /> Start task</>} close={close} submit={() => start({ projectId: selected, objective, agent })}>
    <label>Project<select value={selected} required onChange={(event) => setSelected(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    <label>Coding agent<select value={agent} onChange={(event) => setAgent(agentIdSchema.parse(event.target.value))}>{agents.map(({ id, name, available }) => <option key={id} value={id}>{name}{available ? '' : ' (executable not found)'}</option>)}</select></label>
    <label>Task objective<textarea rows={5} value={objective} required maxLength={20000} placeholder="What should be accomplished, and how will you accept the result?" onChange={(event) => setObjective(event.target.value)} /></label>
  </DialogForm>
}

export function AgentConnectionEditor({ settings, close, save }: { settings: AgentSettings; close(): void; save(input: AgentConnectionInput): Promise<void> }) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [model, setModel] = useState(settings.model)
  const [apiKey, setApiKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const custom = !!baseUrl.trim()

  return <DialogForm title={`${settings.name} model connection`} action="Save connection" close={close} submit={() => save({
    baseUrl, model, apiKey: clearKey ? '' : apiKey.trim() || undefined,
  })}>
    <label>Base URL<input type="url" value={baseUrl} maxLength={4096} onChange={(event) => setBaseUrl(event.target.value)} placeholder={settings.driver === 'claude' ? 'https://gateway.example.com' : 'https://gateway.example.com/v1'} /></label>
    <p className="muted">{settings.driver === 'claude' ? 'Use an Anthropic Messages API base URL.' : settings.driver === 'codex' ? 'Use a Responses API base URL.' : 'The command receives a local endpoint URL and a bearer token in its JSON input.'} Leave blank to use the agent’s own connection.</p>
    <label>Model<input value={model} required={custom} maxLength={200} onChange={(event) => setModel(event.target.value)} placeholder="Agent default" /></label>
    {custom && <>
      <label>API key<input type="password" autoComplete="off" value={apiKey} disabled={clearKey} maxLength={4096} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.hasApiKey ? 'Saved key hidden' : 'Optional'} /></label>
      {settings.hasApiKey && <label className="checkbox-label"><input type="checkbox" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)} /> Remove saved API key</label>}
    </>}
  </DialogForm>
}

export function AgentProfileEditor({ settings, close, save }: { settings?: AgentSettings; close(): void; save(input: AgentProfileInput): Promise<void> }) {
  const [name, setName] = useState(settings?.name ?? '')
  const [driver, setDriver] = useState(settings?.driver ?? 'command')
  const [path, setPath] = useState(settings?.automatic ? '' : settings?.path ?? '')
  const [args, setArgs] = useState(settings?.args.join('\n') ?? '')
  const [fileError, setFileError] = useState('')

  return <DialogForm title={settings ? 'Edit agent' : 'Add coding agent'} action={settings ? 'Save agent' : 'Add agent'} close={close} submit={() => save({
    name, driver, path, args: driver === 'command' ? args.split(/\r?\n/).filter(Boolean) : [],
  })}>
    <label>Agent name<input value={name} maxLength={100} required onChange={(event) => setName(event.target.value)} placeholder="Local coding agent" /></label>
    <label>Adapter<select value={driver} disabled={!!settings} onChange={(event) => setDriver(agentDriverSchema.parse(event.target.value))}>
      {agentDriverSchema.options.map((id) => <option key={id} value={id}>{agentDriverNames[id]}</option>)}
    </select></label>
    <label>Executable
      <span className="input-group">
        <input value={path} maxLength={4096} required={driver === 'command'} onChange={(event) => setPath(event.target.value)} placeholder={driver === 'command' ? '/path/to/agent' : 'Detect automatically'} />
        <button className="button secondary" type="button" onClick={() => {
          setFileError('')
          void window.meshwork.chooseAgentExecutable().then((selected) => { if (selected) setPath(selected) }, (error) => setFileError(errorMessage(error)))
        }}><FolderOpen size={16} /> Browse</button>
      </span>
    </label>
    {fileError && <p className="form-error" role="alert">{fileError}</p>}
    {driver === 'command' && <>
      <label>Arguments<textarea value={args} rows={3} onChange={(event) => setArgs(event.target.value)} placeholder="One argument per line" /></label>
      <p className="muted">This executable exchanges JSON over stdin and stdout. It runs with your account’s permissions and must enforce the requested workspace access.</p>
    </>}
  </DialogForm>
}
