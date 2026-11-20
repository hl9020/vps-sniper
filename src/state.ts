import { readJson, writeJson } from './store.js'

export type Level = 'info' | 'ok' | 'warn' | 'error'

export interface Event {
  ts: string
  level: Level
  msg: string
}

export interface Ordered {
  id: number
  name: string
  ipv4: string | null
  ipv6: string | null
  ts: string
}

export interface JobState {
  status: 'watching' | 'ordered' | 'failed'
  lastNotified: string | null
  server: Ordered | null
  error: string | null
}

export interface State {
  jobs: Record<string, JobState>
  events: Event[]
}

const FILE = 'state.json'

export const state: State = (readJson(FILE) as State | undefined) ?? { jobs: {}, events: [] }

export const persist = (): void => {
  writeJson(FILE, state)
}

export const jobState = (id: string): JobState => {
  state.jobs[id] ??= { status: 'watching', lastNotified: null, server: null, error: null }
  return state.jobs[id]
}

export const pruneJobs = (ids: string[]): void => {
  for (const id of Object.keys(state.jobs)) if (!ids.includes(id)) Reflect.deleteProperty(state.jobs, id)
}

export const log = (level: Level, msg: string): void => {
  state.events.unshift({ ts: new Date().toISOString(), level, msg })
  state.events.length = Math.min(state.events.length, 200)
  persist()
  console.log(`[${level}] ${msg}`)
}
