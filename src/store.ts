import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { env } from './env.js'

mkdirSync(env.dataDir, { recursive: true })

export const readJson = (name: string): unknown => {
  const p = join(env.dataDir, name)
  if (!existsSync(p)) return undefined
  return JSON.parse(readFileSync(p, 'utf8')) as unknown
}

export const writeJson = (name: string, data: unknown): void => {
  const p = join(env.dataDir, name)
  writeFileSync(`${p}.tmp`, JSON.stringify(data, null, 2))
  renameSync(`${p}.tmp`, p)
}
