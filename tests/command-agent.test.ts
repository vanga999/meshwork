import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CommandExecutor } from '../src/runtime/command-agent.ts'
import type { Execution } from '../src/runtime/workflow-engine.ts'

test('passes literal arguments, task context and the saved session to a custom executable', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'meshwork-command-agent-'))
  try {
    const script = join(workspace, 'custom agent.cjs')
    await writeFile(script, `
      const fs = require('node:fs');
      const input = JSON.parse(fs.readFileSync(0, 'utf8'));
      console.log(JSON.stringify({summary: 'Custom result', details: JSON.stringify([input, process.argv.slice(2)]), files: [], sessionId: input.sessionId ?? 'my-session'}));
    `)
    const executor = new CommandExecutor(() => process.execPath)
    const sessions: string[] = []
    const execution: Execution = {
      objective: 'Inspect the workspace', workspace, agent: { id: 'my-command', driver: 'command', name: 'Custom', args: [script, 'a b', 'x;echo literal'], model: 'custom-model' },
      step: { kind: 'codex', role: 'Custom', access: 'read-only', instructions: 'Review' }, handoffs: [], signal: AbortSignal.timeout(3000),
      onActivity: () => undefined, onSession: ({ threadId }) => { sessions.push(threadId) }, requestApproval: async () => false,
    }
    const first = await executor.execute(execution)
    const [initial, args] = JSON.parse(first.details)
    assert.deepEqual(args, ['a b', 'x;echo literal'])
    assert.equal(initial.access, 'read-only')
    assert.equal(initial.model, 'custom-model')
    assert.match(initial.prompt, /Inspect the workspace/)
    const next = await executor.execute({ ...execution, followUp: { text: 'Check once more', threadId: sessions[0] } }, { url: 'http://127.0.0.1:8000', token: 'local-run-token' })
    const [followUp] = JSON.parse(next.details)
    assert.deepEqual(followUp.endpoint, { baseUrl: 'http://127.0.0.1:8000', token: 'local-run-token' })
    assert.equal(followUp.sessionId, 'my-session')
    assert.equal(followUp.followUp, 'Check once more')
    assert.deepEqual(sessions, ['my-session', 'my-session'])
  } finally { await rm(workspace, { recursive: true, force: true }) }
})
