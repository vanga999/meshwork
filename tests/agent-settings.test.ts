import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentSettingsStore } from '../src/runtime/agent-settings.ts'

test('stores each agent settings separately and only uses a saved key for its endpoint', () => {
  const values = new Map<string, string>()
  const settings = new AgentSettingsStore({
    getSetting: (key) => values.get(key),
    setSetting: (key, value) => { values.set(key, value) },
  }, { encrypt: () => 'encrypted', decrypt: () => 'test-key' })

  assert.equal(settings.defaultAgent, 'codex')
  settings.setDefault('claude')
  assert.equal(settings.defaultAgent, 'claude')
  settings.setConnection('claude', { baseUrl: 'https://models.example/', model: 'local-claude', apiKey: 'test-key' })
  const task = settings.select('claude')
  assert.deepEqual(task, { id: 'claude', baseUrl: 'https://models.example', model: 'local-claude', keyed: true })
  assert.equal(settings.get('claude').hasApiKey, true)
  assert.ok(!JSON.stringify(settings.get('claude')).includes('test-key'))
  assert.ok(!values.get('claude-connection')?.includes('test-key'))
  assert.equal(settings.get('codex').baseUrl, '')

  settings.setConnection('claude', { baseUrl: 'https://models.example', model: 'another-model' })
  assert.equal(settings.apiKey(task), 'test-key')
  settings.setConnection('claude', { baseUrl: 'https://different.example', model: 'another-model' })
  assert.equal(settings.get('claude').hasApiKey, false)
  assert.throws(() => settings.apiKey(task), /original endpoint/)
  assert.equal(settings.apiKey(settings.select('claude')), undefined)
  assert.throws(() => settings.setConnection('codex', { baseUrl: 'https://user:password@example.com', model: 'x' }), /without credentials/)
  assert.throws(() => settings.setConnection('codex', { baseUrl: 'http://localhost:8080/v1', model: '' }), /model name/)
})

test('keeps custom profiles separate from built-in agents and restores the selected profile', () => {
  const values = new Map<string, string>()
  const store = { getSetting: (key: string) => values.get(key), setSetting: (key: string, value: string) => { values.set(key, value) } }
  const secrets = { encrypt: () => 'encrypted', decrypt: () => 'test-key' }
  const settings = new AgentSettingsStore(store, secrets)
  const command = { name: 'My agent', driver: 'command', path: process.execPath, args: ['my script.js', '--local only'] }
  const id = settings.saveProfile(command)
  const second = settings.saveProfile({ name: 'Private Codex', driver: 'codex', path: '', args: [] })
  settings.setDefault(id)
  settings.setConnection(second, { baseUrl: 'http://localhost:8080/v1', model: 'local' })

  const reopened = new AgentSettingsStore(store, secrets)
  assert.equal(reopened.defaultAgent, id)
  assert.deepEqual(reopened.list().map(({ name }) => name), ['Codex', 'Claude Code', 'My agent', 'Private Codex'])
  assert.deepEqual(reopened.select(id).args, command.args)
  assert.equal(reopened.executable(id), process.execPath)
  assert.equal(reopened.select(second).driver, 'codex')
  assert.equal(reopened.select('codex').baseUrl, undefined)
  assert.equal(reopened.select(second).model, 'local')
  assert.throws(() => reopened.saveProfile({ ...command, path: '' }), /Choose an executable/)
})
