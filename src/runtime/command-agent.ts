import { z } from 'zod'
import { agentName, resultSchema } from '../shared/workflow.ts'
import type { AgentEndpoint } from './agent-endpoint.ts'
import { runAgentProcess } from './agent-process.ts'
import { agentPrompt } from './agent-prompt.ts'
import type { Execution, StepExecutor } from './workflow-engine.ts'

const responseSchema = resultSchema.extend({ sessionId: z.string().min(1).optional() })
const resultLimit = 1024 * 1024

export class CommandExecutor implements StepExecutor {
  private readonly executable: () => string

  constructor(executable: () => string) { this.executable = executable }

  async execute(execution: Execution, endpoint?: AgentEndpoint) {
    const { agent, workspace, step, followUp, signal, onActivity, onSession } = execution
    const name = agentName(agent)
    let stdout = ''
    let tooLarge = false
    onActivity({ label: `Starting ${name}`, detail: workspace })
    const { code, stderr } = await runAgentProcess({
      name, executable: this.executable(), args: agent.args ?? [], cwd: workspace, signal, stopProcessGroup: true,
      input: `${JSON.stringify({
        version: 1, prompt: agentPrompt(execution), workspace, access: step.access, model: agent.model,
        sessionId: followUp?.threadId, followUp: followUp?.text,
        endpoint: endpoint && { baseUrl: endpoint.url, token: endpoint.token },
      })}\n`,
      onLine(line) {
        if (tooLarge || stdout.length + line.length + 1 > resultLimit) tooLarge = true
        else stdout += `${line}\n`
      },
    })
    if (code !== 0) throw new Error(stderr || `${name} exited (${code ?? 'signal'}).`)
    if (tooLarge) throw new Error(`${name} returned more than 1 MB of output.`)
    let raw: unknown
    try { raw = JSON.parse(stdout) } catch { throw new Error(`${name} must return a JSON result on stdout.`) }
    const parsed = responseSchema.safeParse(raw)
    if (!parsed.success) throw new Error(`${name} must return summary, details, and files in its JSON result.`)
    const { sessionId, ...result } = parsed.data
    if (sessionId) onSession({ threadId: sessionId })
    return result
  }
}
