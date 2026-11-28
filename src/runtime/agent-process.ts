import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

type Options = {
  name: string; executable: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv;
  signal: AbortSignal; input: string; stopProcessGroup?: boolean; onLine(line: string): void;
}

export async function runAgentProcess({ name, executable, args, cwd, env, signal, input, stopProcessGroup, onLine }: Options) {
  signal.throwIfAborted()
  const detached = !!stopProcessGroup && process.platform !== 'win32'
  const child = spawn(executable, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached, env })
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once('error', (error) => reject(new Error(`Could not start ${name}. ${error.message}`)))
    child.once('close', resolve)
  })
  let stderr = ''
  let forceStop: ReturnType<typeof setTimeout> | undefined
  const interrupt = (signal: NodeJS.Signals) => {
    if (detached && child.pid) {
      try { process.kill(-child.pid, signal); return } catch { /* The process group may already be gone. */ }
    }
    child.kill(signal)
  }
  const stop = () => {
    interrupt('SIGTERM')
    forceStop = setTimeout(() => interrupt('SIGKILL'), 1500)
  }
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  lines.on('line', (line) => { if (!signal.aborted) onLine(line) })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000) })
  child.stdin.on('error', () => undefined)

  try {
    child.stdin.end(input)
    const code = await exit
    signal.throwIfAborted()
    return { code, stderr: stderr.trim() }
  } finally {
    signal.removeEventListener('abort', stop)
    clearTimeout(forceStop)
    lines.close()
  }
}
