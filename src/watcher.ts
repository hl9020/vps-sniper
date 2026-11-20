import { api, availability, getMeta, key, monthly, pollApi, setTypes } from './catalog.js'
import { HcloudError, type ServerType } from './hcloud.js'
import { sendMail } from './mailer.js'
import { getSettings, type Job, type Saved } from './settings.js'
import { jobState, log, persist } from './state.js'

type Outcome = { kind: 'ordered'; job: Job } | { kind: 'failed'; job: Job; error: string } | { kind: 'rejected'; job: Job }

export const status = { lastPoll: null as string | null, lastError: null as string | null }

let prev = new Set<string>()
const retryAt = new Map<string, number>()
let errCount = 0
let errMailAt = 0
let lowRate = false
const flag = { busy: false, again: false }
const pending = (): boolean => flag.again
let timer: NodeJS.Timeout | undefined

const schedule = (ms: number): void => {
  clearTimeout(timer)
  timer = setTimeout(() => void tick(), ms)
}

export const kick = (): void => {
  schedule(0)
}

export const forget = (id: string): void => {
  prev.delete(id)
  retryAt.delete(id)
}

const describe = (e: unknown): string => {
  if (e instanceof HcloudError) return `${e.code}: ${e.message}`
  if (e instanceof Error) return e.message
  return String(e)
}

const mail = (subject: string, text: string): Promise<boolean> =>
  sendMail(subject, text).then(
    () => true,
    (e: unknown) => {
      log('error', `Mail failed: ${describe(e)}`)
      return false
    },
  )

const label = (j: Job): string => `${j.type} @ ${j.location}`

const line = (j: Job, types: ServerType[]): string => {
  const t = types.find((x) => x.name === j.type)
  if (!t) return `- ${label(j)}`
  const p = monthly(t, j.location)
  return `- ${label(j)}: ${t.cores} vCPU, ${t.memory} GB RAM, ${t.disk} GB disk, ${t.architecture}${p === null ? '' : `, ${p.toFixed(2)} EUR/month gross`}`
}

const order = async (s: Saved, j: Job, t: ServerType): Promise<Outcome> => {
  const js = jobState(j.id)
  const fail = (error: string): Outcome => {
    js.status = 'failed'
    js.error = error
    log('error', `Order ${label(j)} failed: ${error}`)
    return { kind: 'failed', job: j, error }
  }
  const { images } = await getMeta()
  const img = images.find((i) => i.name === s.order.image && i.architecture === t.architecture)
  if (!img) return fail(`image ${s.order.image} not found for architecture ${t.architecture}`)
  const name = `${s.order.namePrefix}-${j.type}-${j.location}-${Date.now().toString(36)}`
  try {
    const srv = await api.createServer({
      name,
      server_type: j.type,
      location: j.location,
      image: img.id,
      ssh_keys: s.order.sshKeys,
      labels: { 'managed-by': 'vps-sniper' },
      public_net: { enable_ipv4: s.order.ipv4, enable_ipv6: true },
    })
    js.status = 'ordered'
    js.error = null
    js.server = { id: srv.id, name: srv.name, ipv4: srv.public_net.ipv4?.ip ?? null, ipv6: srv.public_net.ipv6?.ip ?? null, ts: new Date().toISOString() }
    log('ok', `Ordered ${srv.name} (${label(j)})`)
    return { kind: 'ordered', job: j }
  } catch (e) {
    if (e instanceof HcloudError && (e.code === 'resource_unavailable' || e.code === 'placement_error')) {
      retryAt.set(j.id, Date.now() + 30_000)
      log('warn', `Order ${label(j)} rejected (${describe(e)}), retrying in 30 s`)
      return { kind: 'rejected', job: j }
    }
    return fail(describe(e))
  }
}

const onError = (e: unknown, interval: number): number => {
  errCount++
  const msg = describe(e)
  status.lastError = msg
  if (errCount === 1 || errCount % 50 === 0) log('error', `Polling failed (${errCount}x): ${msg}`)
  const hard = e instanceof HcloudError && (e.status === 401 || e.status === 403)
  if ((hard || errCount >= 10) && Date.now() - errMailAt > 3_600_000) {
    errMailAt = Date.now()
    void mail('Polling error', `Polling the Hetzner Cloud API failed ${errCount} time(s) in a row.\n\nLast error: ${msg}`)
  }
  if (e instanceof HcloudError && e.status === 429) return 60_000
  return errCount > 3 ? Math.max(interval, 60_000) : interval
}

const report = async (s: Saved, types: ServerType[], fresh: Job[], outs: Outcome[]): Promise<void> => {
  const ordered = outs.filter((o) => o.kind === 'ordered')
  const failed = outs.filter((o) => o.kind === 'failed')
  const rejected = outs.filter((o) => o.kind === 'rejected' && fresh.includes(o.job))
  const parts: string[] = []
  for (const o of ordered) {
    const srv = jobState(o.job.id).server
    if (srv) parts.push(`Server ordered:\n${line(o.job, types)}\n  Name: ${srv.name}\n  ID: ${srv.id}\n  IP: ${[srv.ipv4, srv.ipv6].filter(Boolean).join(', ') || '-'}`)
  }
  for (const o of failed) parts.push(`Order failed, job stopped:\n${line(o.job, types)}\n  Error: ${o.error}`)
  for (const o of rejected) parts.push(`Available, but the order was rejected. Retrying every 30 s while it stays available:\n${line(o.job, types)}`)
  const notify = fresh.filter((j) => j.action === 'notify')
  if (notify.length) parts.push(`Available now:\n${notify.map((j) => line(j, types)).join('\n')}`)
  if (!parts.length) return

  const subject = ordered[0]
    ? `Server ordered: ${label(ordered[0].job)}`
    : failed[0]
      ? `Order failed: ${label(failed[0].job)}`
      : `Available: ${label((rejected[0]?.job ?? notify[0]) as Job)}`
  const more = ordered.length + failed.length + rejected.length + notify.length - 1
  const ok = await mail(`${subject}${more > 0 ? ` (+${more} more)` : ''}`, `${parts.join('\n\n')}\n\nAvailability is an indicator, not a guarantee.`)
  if (!ok) return
  const ts = new Date().toISOString()
  for (const j of fresh) jobState(j.id).lastNotified = ts
}

const run = async (s: Saved): Promise<number> => {
  const interval = s.intervalSec * 1000
  let types: ServerType[]
  try {
    types = await pollApi.serverTypes()
  } catch (e) {
    return onError(e, interval)
  }
  if (errCount) log('info', 'Polling recovered')
  errCount = 0
  status.lastError = null
  status.lastPoll = new Date().toISOString()
  setTypes(types)

  const avail = availability(types)
  const now = Date.now()
  const fresh: Job[] = []
  const outs: Outcome[] = []
  const next = new Set<string>()
  const seen = new Set<string>()
  for (const j of s.jobs) {
    const js = jobState(j.id)
    if (js.status !== 'watching') continue
    if (!avail[key(j.type, j.location)]) continue
    next.add(j.id)
    if (!prev.has(j.id)) {
      if (!seen.has(label(j))) log('ok', `${label(j)} is available`)
      seen.add(label(j))
      fresh.push(j)
    }
    if (j.action !== 'order' || (retryAt.get(j.id) ?? 0) > now) continue
    const t = types.find((x) => x.name === j.type)
    if (!t) continue
    try {
      outs.push(await order(s, j, t))
    } catch (e) {
      js.status = 'failed'
      js.error = describe(e)
      outs.push({ kind: 'failed', job: j, error: js.error })
    }
  }
  prev = next

  await report(s, types, fresh, outs)
  persist()

  const rate = pollApi.rate
  if (rate && rate.remaining < 30) {
    if (!lowRate) log('warn', `Rate limit low (${rate.remaining} left), slowing down`)
    lowRate = true
    return Math.max(interval, (30 - rate.remaining) * 1000)
  }
  lowRate = false
  return interval
}

const tick = async (): Promise<void> => {
  if (flag.busy) {
    flag.again = true
    return
  }
  flag.busy = true
  flag.again = false
  const t0 = Date.now()
  let wait = getSettings().intervalSec * 1000
  try {
    const s = getSettings()
    if (s.enabled && s.jobs.some((j) => jobState(j.id).status === 'watching')) wait = await run(s)
  } catch (e) {
    log('error', `Unexpected error: ${describe(e)}`)
  } finally {
    flag.busy = false
    schedule(pending() ? 0 : Math.max(0, wait - (Date.now() - t0)))
  }
}
