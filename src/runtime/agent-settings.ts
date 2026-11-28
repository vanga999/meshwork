import { randomUUID } from 'node:crypto'
import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { agentConnectionSchema, agentDriverNames, agentIdSchema, agentProfileSchema, builtInAgentIds, type AgentId, type AgentProfileInput, type AgentSelection, type AgentSettings } from '../shared/workflow.ts'
import type { SqliteStore } from './store.ts'

type SavedConnection = { baseUrl?: string; model?: string; encryptedKey?: string }
type Secrets = { encrypt(value: string): string; decrypt(value: string): string }
type Settings = Pick<SqliteStore, 'getSetting' | 'setSetting'>
type Profile = AgentProfileInput & { id: AgentId }
const profileSetting = 'custom-agents'

function isBuiltIn(id: AgentId): id is typeof builtInAgentIds[number] {
  return id === 'codex' || id === 'claude'
}

function isExecutable(path: string) {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch { return false }
}

function detectExecutable(agent: typeof builtInAgentIds[number]) {
  const name = process.platform === 'win32' ? `${agent}.exe` : agent
  const directories = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  directories.push(join(homedir(), '.local', 'bin'), join(homedir(), '.cargo', 'bin'))
  if (process.platform === 'darwin') directories.push('/opt/homebrew/bin', '/usr/local/bin')
  return directories.map((directory) => resolve(directory, name)).find(isExecutable)
}

export class AgentSettingsStore {
  private readonly store: Settings
  private readonly secrets: Secrets

  constructor(store: Settings, secrets: Secrets) {
    this.store = store
    this.secrets = secrets
  }

  get defaultAgent(): AgentId {
    const selected = agentIdSchema.safeParse(this.store.getSetting('default-agent')).data
    return selected && (isBuiltIn(selected) || this.customProfiles().some(({ id }) => id === selected)) ? selected : 'codex'
  }

  setDefault(agent: AgentId) {
    this.profile(agent)
    this.store.setSetting('default-agent', agent)
  }

  list() {
    return [...builtInAgentIds.map((id) => this.profile(id)), ...this.customProfiles()].map((profile) => this.describe(profile))
  }

  saveProfile(raw: unknown, id?: AgentId) {
    const parsed = agentProfileSchema.safeParse(raw)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    const { name, driver, path, args } = parsed.data
    if (driver === 'command' && !path) throw new Error('Choose an executable for the custom command.')
    this.verifyExecutable(path, name)
    const profiles = this.customProfiles()
    const existing = id ? profiles.find((profile) => profile.id === id) : undefined
    if (id && !existing) throw new Error('Custom agent could not be found.')
    if (existing && existing.driver !== driver) throw new Error('Add a separate agent to use a different adapter.')
    const updated: Profile = { id: id ?? randomUUID(), name, driver, path, args: driver === 'command' ? args : [] }
    this.saveProfiles(existing ? profiles.map((profile) => profile.id === id ? updated : profile) : [...profiles, updated])
    return updated.id
  }

  get(agent: AgentId): AgentSettings {
    return this.describe(this.profile(agent))
  }

  setExecutable(agent: AgentId, path: string) {
    const profile = this.profile(agent)
    if (isBuiltIn(agent)) {
      this.verifyExecutable(path, profile.name)
      this.store.setSetting(`${agent}-path`, path)
    } else this.saveProfile({ ...profile, path }, agent)
  }

  executable(agent: AgentId) {
    const { name, path, available } = this.get(agent)
    if (!path || !available) throw new Error(`${name} was not found. Configure its executable in Settings.`)
    return path
  }

  setConnection(agent: AgentId, raw: unknown) {
    this.profile(agent)
    const parsed = agentConnectionSchema.safeParse(raw)
    if (!parsed.success) throw new Error(parsed.error.issues[0].message)
    const { baseUrl, model, apiKey } = parsed.data
    const existing = this.connection(agent)
    const encryptedKey = !baseUrl ? undefined : apiKey === undefined
      ? (baseUrl === existing.baseUrl ? existing.encryptedKey : undefined)
      : (apiKey ? this.secrets.encrypt(apiKey) : undefined)
    this.store.setSetting(`${agent}-connection`, JSON.stringify({ baseUrl, model, encryptedKey }))
  }

  select(id: AgentId): AgentSelection {
    const { name, driver, args } = this.profile(id)
    const { baseUrl, model, encryptedKey } = this.connection(id)
    return {
      id, ...(isBuiltIn(id) ? {} : { name, driver, args }),
      baseUrl: baseUrl || undefined, model: model || undefined, keyed: encryptedKey ? true : undefined,
    }
  }

  apiKey(selection: AgentSelection) {
    if (!selection.baseUrl) return undefined
    const { baseUrl, encryptedKey } = this.connection(selection.id)
    if (selection.baseUrl === baseUrl && encryptedKey) return this.secrets.decrypt(encryptedKey)
    if (selection.keyed) throw new Error('Restore the API key for this task’s original endpoint in Settings.')
    return undefined
  }

  private connection(agent: AgentId): SavedConnection {
    const stored = this.store.getSetting(`${agent}-connection`)
    return stored ? JSON.parse(stored) as SavedConnection : {}
  }

  private describe(profile: Profile): AgentSettings {
    const path = profile.path || (profile.driver === 'command' ? undefined : detectExecutable(profile.driver))
    const { baseUrl, model, encryptedKey } = this.connection(profile.id)
    return {
      ...profile, builtIn: isBuiltIn(profile.id), path, available: !!path && (!profile.path || isExecutable(path)), automatic: !profile.path,
      baseUrl: baseUrl ?? '', model: model ?? '', hasApiKey: !!encryptedKey,
    }
  }

  private profile(id: AgentId): Profile {
    if (isBuiltIn(id)) return { id, name: agentDriverNames[id], driver: id, args: [], path: this.store.getSetting(`${id}-path`) ?? '' }
    const profile = this.customProfiles().find((agent) => agent.id === id)
    if (!profile) throw new Error('Coding agent could not be found.')
    return profile
  }

  private customProfiles(): Profile[] {
    const saved = this.store.getSetting(profileSetting)
    return saved ? JSON.parse(saved) as Profile[] : []
  }

  private saveProfiles(profiles: Profile[]) { this.store.setSetting(profileSetting, JSON.stringify(profiles)) }

  private verifyExecutable(path: string, name: string) {
    if (path && (!isAbsolute(path) || !isExecutable(path))) throw new Error(`Choose an executable file for ${name}.`)
  }
}
