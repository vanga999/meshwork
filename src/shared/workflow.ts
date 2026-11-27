import { z } from 'zod'

const nameSchema = z.string().trim().min(1).max(100)
const instructionsSchema = z.string().trim().min(1).max(12_000)
const accessSchema = z.enum(['read-only', 'workspace-write'])
const humanStepSchema = z.object({ kind: z.literal('human'), role: nameSchema, instructions: instructionsSchema })

export const botSchema = z.object({
  name: nameSchema,
  instructions: instructionsSchema,
  access: accessSchema,
})

const projectStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bot'), botId: z.uuid(), instructions: z.string().trim().max(12_000) }),
  humanStepSchema,
])

export const projectSchema = z.object({
  name: nameSchema,
  workspace: z.string().min(1).max(4096),
  steps: z.array(projectStepSchema).max(20),
})

export const taskInputSchema = z.object({
  projectId: z.uuid(),
  objective: z.string().trim().min(1).max(20_000),
})

export const resultSchema = z.object({
  summary: z.string(),
  details: z.string(),
  files: z.array(z.string()),
})

export type BotInput = z.infer<typeof botSchema>
export type ProjectStep = z.infer<typeof projectStepSchema>
export type ProjectInput = z.infer<typeof projectSchema>
export type TaskInput = z.infer<typeof taskInputSchema>
export type StepResult = z.infer<typeof resultSchema>
type Versioned = { id: string; version: number; updatedAt: string }
export type Bot = BotInput & Versioned
export type Project = ProjectInput & Versioned
export type Step = z.infer<typeof humanStepSchema> | {
  kind: 'codex'
  role: string
  instructions: string
  access: Bot['access']
  bot?: { id: string; version: number }
}
export type ProjectSnapshot = Omit<Project, 'steps'> & { steps: Step[] }

export function snapshotProject(project: Project, getBot: (id: string) => Bot | undefined): ProjectSnapshot {
  return {
    ...project,
    steps: project.steps.map((step) => {
      if (step.kind === 'human') return step
      const bot = getBot(step.botId)
      if (!bot) throw new Error('A workflow step references a bot that could not be found.')
      const instructions = step.instructions ? `${bot.instructions}\n\nProject step instructions:\n${step.instructions}` : bot.instructions
      return { kind: 'codex', role: bot.name, instructions, access: bot.access, bot: { id: bot.id, version: bot.version } }
    }),
  }
}

export type WorkflowTrigger =
  | { kind: 'manual'; objective: string }
  | { kind: 'event'; objective: string; source: string; eventId: string }

export type TaskStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'interrupted' | 'cancelled'
export type Activity = { at: string; label: string; detail?: string }
export type Approval = { id: string; title: string; detail: string }

export type Attempt = {
  id: string
  stepIndex: number
  status: Exclude<TaskStatus, 'queued'>
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
  stepIndex: number
  attempts: Attempt[]
  approvals: Approval[]
  createdAt: string
  updatedAt: string
}

export type WorkflowSnapshot = { bots: Bot[]; projects: Project[]; tasks: Task[] }
export type Dashboard = WorkflowSnapshot & { codexPath: string }

export interface WorkflowApi {
  load(): Promise<WorkflowSnapshot>
  saveBot(input: BotInput, id?: string): Promise<Bot>
  saveProject(input: ProjectInput, id?: string): Promise<Project>
  startTask(input: TaskInput): Promise<Task>
  cancelTask(id: string): Promise<void>
  retryTask(id: string): Promise<void>
  completeHumanStep(id: string, accepted: boolean, note: string): Promise<void>
  answerApproval(taskId: string, approvalId: string, accepted: boolean): Promise<void>
  subscribe(listener: () => void): () => void
}

export interface DesktopApi extends WorkflowApi {
  load(): Promise<Dashboard>
  chooseWorkspace(): Promise<string | null>
  chooseCodex(): Promise<string | null>
  resetCodex(): Promise<void>
}
