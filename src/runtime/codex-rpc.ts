import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'

const messageSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
})

export type Message = z.infer<typeof messageSchema>
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }

export class CodexRpc {
  private readonly child
  private readonly pending = new Map<number, Pending>()
  private sequence = 0
  private failure?: Error
  private stderr = ''
  private closing = false
  readonly exited: Promise<Error>

  constructor(executable: string, workspace: string, receive: (message: Message) => void) {
    this.child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    this.exited = new Promise((resolve) => {
      this.child.once('error', (error) => resolve(this.fail(new Error(`Could not start Codex from ${executable}. ${error.message}`))))
      this.child.once('close', (code) => resolve(this.fail(new Error(`Codex exited (${code ?? 'signal'}). ${this.stderr.trim()}`.trim()))))
    })
    this.child.stdin.on('error', (error) => this.fail(error))
    this.child.stderr.setEncoding('utf8').on('data', (text: string) => { this.stderr = (this.stderr + text).slice(-2000) })
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      if (this.closing) return
      const message = this.parse(line)
      if (!message) return
      if (message.method) {
        receive(message)
      } else if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
      }
    })
  }

  request(method: string, params: unknown, timeoutMs = 45_000) {
    if (this.failure) return Promise.reject(this.failure)
    const id = ++this.sequence
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex did not respond to ${method}.`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ id, method, params })
    })
  }

  notify(method: string) { this.send({ method }) }
  reply(id: string | number, result: unknown) { this.send({ id, result }) }
  rejectRequest(id: string | number, message: string) { this.send({ id, error: { code: -32601, message } }) }

  async close() {
    this.closing = true
    this.child.stdin.end()
    const exited = this.exited.then(() => true)
    if (await Promise.race([exited, delay(350, false, { ref: false })])) return
    this.child.kill('SIGTERM')
    if (await Promise.race([exited, delay(750, false, { ref: false })])) return
    this.child.kill('SIGKILL')
    await Promise.race([exited, delay(750, false, { ref: false })])
  }

  private send(message: unknown) {
    if (!this.failure && !this.closing) this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private fail(error: Error) {
    this.failure ??= error
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(this.failure)
    }
    this.pending.clear()
    return this.failure
  }

  private parse(line: string) {
    try {
      const parsed = messageSchema.safeParse(JSON.parse(line))
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }
}
