import { constants, accessSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { z } from 'zod'
import { resultSchema } from '../shared/workflow.ts'
import { CodexRpc, type Message } from './codex-rpc.ts'
import type { Execution, StepExecutor } from './workflow-engine.ts'

const turnSchema = z.object({ id: z.string(), status: z.string(), error: z.object({ message: z.string() }).nullish() })
const outputSchema = z.toJSONSchema(resultSchema, { target: 'draft-7' })

export function detectCodex() {
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const paths = (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((directory) => join(directory, executable))
  paths.push(join(homedir(), '.local', 'bin', executable), join(homedir(), '.cargo', 'bin', executable))
  if (process.platform === 'darwin') paths.push(join('/opt/homebrew/bin', executable), join('/usr/local/bin', executable))
  return paths.find((candidate) => {
    try {
      accessSync(candidate, constants.X_OK)
      return true
    } catch {
      return false
    }
  }) ?? executable
}

export class CodexExecutor implements StepExecutor {
  private readonly executable: () => string

  constructor(executable: () => string) { this.executable = executable }

  async execute(execution: Execution) {
    const { signal, workspace, step, onActivity } = execution
    signal.throwIfAborted()
    const executable = this.executable()
    let threadId: string | undefined
    let turnId: string | undefined
    let finalText = ''
    let lastText = ''
    let providerError = ''
    let resolveTurn!: (turn: z.infer<typeof turnSchema>) => void
    const completed = new Promise<z.infer<typeof turnSchema>>((resolve) => { resolveTurn = resolve })
    const rpc = new CodexRpc(executable, workspace, (message) => {
      const params = message.params ?? {}
      if (message.id !== undefined && message.method) {
        this.handleRequest(rpc, message.id, message.method, params, execution)
        return
      }
      if (params.threadId !== threadId || !threadId || signal.aborted) return
      if (turnId && typeof params.turnId === 'string' && params.turnId !== turnId) return
      if (message.method === 'turn/completed') {
        const parsed = turnSchema.safeParse(params.turn)
        if (parsed.success && (!turnId || parsed.data.id === turnId)) resolveTurn(parsed.data)
      }
      if (message.method === 'error' && params.willRetry !== true) {
        providerError = z.object({ message: z.string() }).safeParse(params.error).data?.message ?? ''
        if (providerError) onActivity({ label: 'Codex error', detail: providerError.slice(0, 2000) })
      }
      if (message.method === 'item/completed') {
        const item = z.record(z.string(), z.unknown()).safeParse(params.item).data
        if (!item) return
        if (item.type === 'agentMessage' && typeof item.text === 'string') {
          lastText = item.text
          if (item.phase === 'final_answer') finalText = item.text
          if (item.phase === 'commentary' && item.text) onActivity({ label: 'Codex update', detail: item.text.slice(0, 1200) })
        }
        if (item.type === 'commandExecution' && typeof item.command === 'string') {
          const label = typeof item.exitCode === 'number' ? `Command exited with ${item.exitCode}` : 'Command finished'
          onActivity({ label, detail: item.command.slice(0, 1200) })
        }
        if (item.type === 'fileChange') onActivity({ label: 'File changes reported' })
      }
    })

    let abort!: () => void
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason ?? new Error('Task cancelled.'))
      signal.addEventListener('abort', abort, { once: true })
    })
    const run = async () => {
      onActivity({ label: 'Starting Codex', detail: workspace })
      await rpc.request('initialize', { clientInfo: { name: 'meshwork', title: 'Meshwork', version: '0.1.0' }, capabilities: null })
      signal.throwIfAborted()
      rpc.notify('initialized')
      const settings = { cwd: workspace, sandbox: step.access, approvalPolicy: 'on-request', approvalsReviewer: 'user' }
      const resumeId = execution.followUp?.threadId
      const resumed = resumeId ? await rpc.request('thread/resume', { ...settings, threadId: resumeId, excludeTurns: true }).catch((error: Error) => {
        if (error.message !== `no rollout found for thread id ${resumeId}`) throw error
        onActivity({ label: 'Starting a new Codex session', detail: 'The earlier session is unavailable. Saved task results are included.' })
      }) : undefined
      signal.throwIfAborted()
      const started = z.object({ thread: z.object({ id: z.string() }) }).parse(resumed ?? await rpc.request('thread/start', settings))
      threadId = started.thread.id
      signal.throwIfAborted()
      execution.onSession({ threadId })
      const input = [
        `You are executing the ${step.role} step of a Meshwork workflow.`,
        `Task objective:\n${execution.objective}`,
        `Your responsibilities and completion criteria:\n${step.instructions}`,
        `Previous step results (context for this step):\n${JSON.stringify(execution.handoffs)}`,
        ...(execution.followUp ? [`Latest user follow-up for this task:\n${execution.followUp.text}`] : []),
        'Return an accurate summary, details including any checks and limitations, and an array of relevant file paths relative to the workspace. Use an empty array if there are no files.',
      ].join('\n\n')
      const startedTurn = z.object({ turn: z.object({ id: z.string() }) }).parse(await rpc.request('turn/start', {
        threadId, input: [{ type: 'text', text: input, text_elements: [] }], outputSchema,
      }))
      turnId = startedTurn.turn.id
      signal.throwIfAborted()
      execution.onSession({ threadId, turnId })
      const result = await Promise.race([completed, rpc.exited.then((error) => { throw error })])
      if (result.status !== 'completed') throw new Error(result.error?.message || providerError || `Codex turn ended with status ${result.status}.`)
      const text = finalText || lastText
      try {
        return resultSchema.parse(JSON.parse(text))
      } catch {
        if (text) onActivity({ label: 'Codex response', detail: text.slice(0, 4000) })
        throw new Error('Codex finished without a valid structured result. See the step activity before retrying.')
      }
    }

    try {
      return await Promise.race([run(), cancelled])
    } finally {
      signal.removeEventListener('abort', abort)
      if (signal.aborted && threadId && turnId) {
        await rpc.request('turn/interrupt', { threadId, turnId }, 1500).catch(() => undefined)
      }
      await rpc.close()
    }
  }

  private handleRequest(rpc: CodexRpc, id: NonNullable<Message['id']>, method: string, params: NonNullable<Message['params']>, execution: Execution) {
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      const title = method.includes('commandExecution') ? 'Codex requests permission to run a command' : 'Codex requests permission to change files'
      const detail = [params.command, params.cwd, params.reason, params.grantRoot].filter((value): value is string => typeof value === 'string').join('\n')
      void execution.requestApproval({ title, detail: detail.slice(0, 8000) }).then((accepted) => {
        rpc.reply(id, { decision: accepted ? 'accept' : 'decline' })
      }, () => rpc.reply(id, { decision: 'decline' }))
      return
    }
    if (method === 'item/permissions/requestApproval') {
      execution.onActivity({ label: 'Additional sandbox permissions declined', detail: 'The step keeps its configured workspace access.' })
      rpc.reply(id, { permissions: {}, scope: 'turn' })
      return
    }
    execution.onActivity({ label: 'Codex request unavailable', detail: method })
    rpc.rejectRequest(id, 'This request is unavailable in the Meshwork desktop client.')
  }
}
