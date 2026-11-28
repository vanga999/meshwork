import { z } from 'zod'
import { resultSchema } from '../shared/workflow.ts'
import type { AgentEndpoint } from './agent-endpoint.ts'
import { runAgentProcess } from './agent-process.ts'
import { agentPrompt, agentResultSchema } from './agent-prompt.ts'
import type { Execution, StepExecutor } from './workflow-engine.ts'

const frameSchema = z.object({
  type: z.string(), subtype: z.string().optional(), session_id: z.string().optional(),
  is_error: z.boolean().optional(), result: z.string().optional(), errors: z.array(z.string()).optional(),
  structured_output: z.unknown().optional(),
  message: z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional(), name: z.string().optional() })) }).optional(),
})

export class ClaudeExecutor implements StepExecutor {
  private readonly executable: () => string

  constructor(executable: () => string) { this.executable = executable }

  async execute(execution: Execution, endpoint?: AgentEndpoint) {
    const { signal, workspace, step, onActivity, onSession } = execution
    signal.throwIfAborted()
    const executable = this.executable()
    const tools = ['Read', 'Glob', 'Grep']
    const shell = step.access === 'workspace-write' && process.platform !== 'win32'
    if (step.access === 'workspace-write') tools.push('Edit', 'Write')
    if (shell) tools.push('Bash')
    const args = [
      '--print', '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(agentResultSchema),
      '--restricted', '--strict-mcp-config', '--tools', tools.join(','), '--allowedTools', tools.filter((tool) => tool !== 'Bash').join(','),
      '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
    ]
    if (shell) args.push('--settings', JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false } }))
    if (execution.agent.model) args.push(`--model=${execution.agent.model}`)
    if (execution.followUp?.threadId) args.push(`--resume=${execution.followUp.threadId}`)

    const env = { ...process.env }
    if (endpoint) {
      delete env.ANTHROPIC_AUTH_TOKEN
      delete env.ANTHROPIC_CUSTOM_HEADERS
      delete env.CLAUDE_CODE_USE_BEDROCK
      delete env.CLAUDE_CODE_USE_VERTEX
      delete env.CLAUDE_CODE_USE_FOUNDRY
      env.ANTHROPIC_BASE_URL = endpoint.url
      env.ANTHROPIC_API_KEY = endpoint.token
    }

    onActivity({ label: 'Starting Claude Code', detail: workspace })
    const output: { result?: z.infer<typeof frameSchema> } = {}
    let session: string | undefined
    const { code, stderr } = await runAgentProcess({
      name: 'Claude Code', executable, args, cwd: workspace, env, signal, input: agentPrompt(execution),
      onLine(line) {
        let raw: unknown
        try { raw = JSON.parse(line) } catch { return }
        const frame = frameSchema.safeParse(raw).data
        if (!frame) return
        if (frame.session_id && frame.session_id !== session) {
          session = frame.session_id
          onSession({ threadId: session })
        }
        if (frame.type === 'result') output.result = frame
        if (frame.type === 'assistant') {
          for (const part of frame.message?.content ?? []) {
            if (part.type === 'tool_use' && part.name) onActivity({ label: `Claude Code · ${part.name}` })
            if (part.type === 'text' && part.text) onActivity({ label: 'Claude Code update', detail: part.text.slice(0, 1200) })
          }
        }
      },
    })

    const { result } = output
    if (code !== 0 || result?.is_error || (result?.subtype && result.subtype !== 'success')) {
      throw new Error(result?.errors?.join('\n') || result?.result || stderr || `Claude Code exited (${code ?? 'signal'}).`)
    }
    const parsed = resultSchema.safeParse(result?.structured_output)
    if (!parsed.success) throw new Error('Claude Code did not return a valid structured result. See the step activity.')
    return parsed.data
  }
}
