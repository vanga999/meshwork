import { z } from 'zod'
import { workflowGraphError, workflowGraphSchema, workflowNodeLimit, type WorkflowGraph } from './workflow-graph.ts'

const nameSchema = z.string().trim().min(1).max(100)
const instructionsSchema = z.string().trim().min(1).max(12_000)
const accessSchema = z.enum(['read-only', 'workspace-write'])
const humanStepSchema = z.object({ kind: z.literal('human'), role: nameSchema, instructions: instructionsSchema })

export const builtInAgentIds = ['codex', 'claude'] as const
export const agentIdSchema = z.union([z.enum(builtInAgentIds), z.uuid()])
export type AgentId = z.infer<typeof agentIdSchema>
export const agentDriverSchema = z.enum(['codex', 'claude', 'command'])
export type AgentDriver = z.infer<typeof agentDriverSchema>
export const agentDriverNames: Record<AgentDriver, string> = { codex: 'Codex', claude: 'Claude Code', command: 'Custom command' }
export const defaultAgentLabel = 'Default agent'

const endpointSchema = z.string().trim().max(4096).refine((value) => {
  if (!value) return true
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
  } catch { return false }
}, 'Enter an HTTP or HTTPS base URL without credentials, a query, or a fragment.')
  .transform((value) => value ? new URL(value).href.replace(/\/+$/, '') : '')

export const agentConnectionSchema = z.object({
  baseUrl: endpointSchema,
  model: z.string().trim().max(200),
  apiKey: z.string().trim().max(4096).regex(/^[\x21-\x7E]*$/, 'Enter an API key without spaces or line breaks.').optional(),
}).refine(({ baseUrl, model }) => !baseUrl || Boolean(model), { path: ['model'], message: 'Enter the model name for this endpoint.' })

export type AgentConnectionInput = z.input<typeof agentConnectionSchema>
export const agentProfileSchema = z.object({
  name: nameSchema,
  driver: agentDriverSchema,
  path: z.string().trim().max(4096),
  args: z.array(z.string().max(4096).refine((arg) => !arg.includes('\0'))).max(100),
})
export type AgentProfileInput = z.input<typeof agentProfileSchema>
export type AgentSelection = { id: AgentId; driver?: AgentDriver; name?: string; args?: string[]; baseUrl?: string; model?: string; keyed?: boolean }
export type AgentSettings = {
  id: AgentId; name: string; driver: AgentDriver; builtIn: boolean; args: string[];
  path?: string; available: boolean; automatic: boolean; baseUrl: string; model: string; hasApiKey: boolean;
}

export function agentDriver(agent?: AgentSelection): AgentDriver {
  return agent?.driver ?? (agent?.id === 'claude' ? 'claude' : 'codex')
}

export function agentName(agent?: AgentSelection) {
  return agent?.name ?? agentDriverNames[agentDriver(agent)]
}

export const botSchema = z.object({
  name: nameSchema,
  instructions: instructionsSchema,
  access: accessSchema,
})

const stepInstructionsSchema = z.string().trim().max(12_000)
const workflowStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bot'), botId: z.uuid(), instructions: stepInstructionsSchema }),
  z.object({ kind: z.literal('codex'), instructions: stepInstructionsSchema }),
  humanStepSchema,
])

export const workflowSchema = z.object({
  name: nameSchema,
  steps: z.array(workflowStepSchema).min(1, 'Add at least one workflow step.').max(workflowNodeLimit),
  graph: workflowGraphSchema.optional(),
}).superRefine(({ steps, graph }, context) => {
  if (!graph) return
  const message = graph.positions.length !== steps.length ? 'Place every node on the canvas.' : workflowGraphError(steps.length, graph.links)
  if (message) context.addIssue({ code: 'custom', path: ['graph'], message })
})

export const projectSchema = z.object({
  name: nameSchema,
  workspace: z.string().min(1).max(4096),
  workflowId: z.uuid().optional(),
})

export const taskInputSchema = z.object({
  projectId: z.uuid(),
  objective: z.string().trim().min(1).max(20_000),
  agent: agentIdSchema.optional(),
})

export const resultSchema = z.object({
  summary: z.string(),
  details: z.string(),
  files: z.array(z.string()),
})

export type BotInput = z.infer<typeof botSchema>
export type WorkflowStep = z.infer<typeof workflowStepSchema>
export type WorkflowInput = z.infer<typeof workflowSchema>
export type ProjectInput = z.infer<typeof projectSchema>
export type TaskInput = z.infer<typeof taskInputSchema>
export type StepResult = z.infer<typeof resultSchema>
type Versioned = { id: string; version: number; updatedAt: string }
export type Bot = BotInput & Versioned
export type Workflow = WorkflowInput & Versioned
export type Project = ProjectInput & Versioned
export type Step = z.infer<typeof humanStepSchema> | AgentStep
export type AgentStep = {
  // Keep the stored kind used by earlier desktop versions.
  kind: 'codex'
  role: string
  instructions: string
  access: Bot['access']
  bot?: { id: string; version: number }
}
export type ProjectSnapshot = Omit<Project, 'workflowId'> & {
  workflow?: Pick<Workflow, 'id' | 'name' | 'version'>
  steps: Step[]
  graph?: WorkflowGraph
}

export function defaultAgentStep(agent?: AgentSelection, instructions = ''): AgentStep {
  return {
    kind: 'codex', role: `Default ${agentName(agent)}`, access: 'workspace-write',
    instructions: instructions || 'Complete the task objective in the project workspace.',
  }
}

export function resolveWorkflowSteps(steps: WorkflowStep[], getBot: (id: string) => Bot | undefined, agent?: AgentSelection): Step[] {
  return steps.map((step) => {
    if (step.kind === 'human') return step
    if (step.kind === 'codex') return defaultAgentStep(agent, step.instructions)
    const bot = getBot(step.botId)
    if (!bot) throw new Error('A workflow step references a bot that could not be found.')
    const instructions = step.instructions ? `${bot.instructions}\n\nWorkflow step instructions:\n${step.instructions}` : bot.instructions
    return { kind: 'codex', role: bot.name, instructions, access: bot.access, bot: { id: bot.id, version: bot.version } }
  })
}

export function snapshotProject(project: Project, workflow: Workflow | undefined, getBot: (id: string) => Bot | undefined, agent?: AgentSelection): ProjectSnapshot {
  const { workflowId, ...fields } = project
  if (workflowId !== workflow?.id) throw new Error('The project workflow could not be found.')
  return {
    ...fields,
    workflow: workflow && { id: workflow.id, name: workflow.name, version: workflow.version },
    ...(workflow?.graph && { graph: workflow.graph }),
    steps: resolveWorkflowSteps(workflow?.steps ?? [{ kind: 'codex', instructions: '' }], getBot, agent),
  }
}

export type WorkflowTrigger =
  | { kind: 'manual'; objective: string }
  | { kind: 'event'; objective: string; source: string; eventId: string }

export type AttemptStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'interrupted' | 'cancelled'
export type TaskStatus = AttemptStatus | 'queued' | 'awaiting-review'
export type Activity = { at: string; label: string; detail?: string }
export type Approval = { id: string; title: string; detail: string; stepIndex?: number }
export const taskMessageLimit = 12_000
export type TaskMessage = { id: string; text: string; createdAt: string }

export type Attempt = {
  id: string
  stepIndex: number
  messageId?: string
  status: AttemptStatus
  startedAt: string
  finishedAt?: string
  provider?: { threadId: string; turnId?: string }
  result?: StepResult
  error?: string
  activity: Activity[]
}

export type Task = {
  id: string
  project: ProjectSnapshot
  trigger: WorkflowTrigger
  status: TaskStatus
  agent?: AgentSelection
  // An index past the workflow's final step identifies a conversation follow-up.
  stepIndex: number
  attempts: Attempt[]
  approvals: Approval[]
  retrySteps?: number[]
  messages?: TaskMessage[]
  createdAt: string
  updatedAt: string
}

export const canRetryTask = (task: Task) => ['failed', 'interrupted', 'cancelled'].includes(task.status)

export function canReviewTask(task: Task) {
  return task.status === 'awaiting-review' || (task.stepIndex === task.project.steps.length && canRetryTask(task))
}

export type WorkflowSnapshot = { bots: Bot[]; workflows: Workflow[]; projects: Project[]; tasks: Task[] }
export type Dashboard = WorkflowSnapshot & { agents: AgentSettings[]; defaultAgent: AgentId }
export type TaskFilePreview =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'image'; source: string }

export interface WorkflowApi {
  load(): Promise<WorkflowSnapshot>
  saveBot(input: BotInput, id?: string): Promise<Bot>
  saveWorkflow(input: WorkflowInput, id?: string): Promise<Workflow>
  saveProject(input: ProjectInput, id?: string): Promise<Project>
  startTask(input: TaskInput): Promise<Task>
  sendFollowUp(id: string, text: string): Promise<void>
  completeTask(id: string): Promise<void>
  cancelTask(id: string): Promise<void>
  deleteTask(id: string): Promise<void>
  retryTask(id: string): Promise<void>
  completeHumanStep(id: string, accepted: boolean, note: string, stepIndex?: number): Promise<void>
  answerApproval(taskId: string, approvalId: string, accepted: boolean): Promise<void>
  subscribe(listener: () => void): () => void
}

export interface DesktopApi extends WorkflowApi {
  load(): Promise<Dashboard>
  previewTaskFile(taskId: string, path: string): Promise<TaskFilePreview>
  chooseWorkspace(): Promise<string | null>
  chooseAgentExecutable(agent?: AgentId): Promise<string | null>
  saveAgentProfile(input: AgentProfileInput, id?: AgentId): Promise<AgentId>
  resetAgentExecutable(agent: AgentId): Promise<void>
  saveAgentConnection(agent: AgentId, input: AgentConnectionInput): Promise<void>
  setDefaultAgent(agent: AgentId): Promise<void>
}
