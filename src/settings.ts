import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { readJson, writeJson } from './store.js'

const Job = z.object({
  id: z.string().min(1).optional(),
  type: z.string().min(1),
  location: z.string().min(1),
  action: z.enum(['notify', 'order']),
})

export const Settings = z
  .object({
    enabled: z.boolean(),
    intervalSec: z.number().int().min(1).max(3600),
    order: z.object({
      image: z.string(),
      sshKeys: z.array(z.number().int().positive()).max(20),
      ipv4: z.boolean(),
      namePrefix: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/, 'lowercase letters, digits and dashes'),
    }),
    jobs: z.array(Job).max(100),
  })
  .superRefine((s, ctx) => {
    if (s.jobs.some((j) => j.action === 'order') && !s.order.image) ctx.addIssue({ code: 'custom', path: ['order', 'image'], message: 'image is required for order jobs' })
  })

export type Settings = z.infer<typeof Settings>
export type Job = Required<z.infer<typeof Job>>

export interface Saved extends Omit<Settings, 'jobs'> {
  jobs: Job[]
}

const initial: Saved = {
  enabled: false,
  intervalSec: 5,
  order: { image: 'ubuntu-24.04', sshKeys: [], ipv4: true, namePrefix: 'sniper' },
  jobs: [],
}

const FILE = 'settings.json'
const raw = readJson(FILE)
let cur: Saved = raw === undefined ? initial : (Settings.parse(raw) as Saved)
if (raw === undefined) writeJson(FILE, cur)

export const getSettings = (): Saved => cur

export const saveSettings = (s: Settings): Saved => {
  cur = { ...s, jobs: s.jobs.map((j) => ({ ...j, id: j.id ?? randomUUID() })) }
  writeJson(FILE, cur)
  return cur
}
