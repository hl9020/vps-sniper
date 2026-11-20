import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { HTTPException } from 'hono/http-exception'
import { timingSafeEqual } from 'node:crypto'
import { availability, getMeta, getTypes, isActive } from './catalog.js'
import { env } from './env.js'
import { HcloudError } from './hcloud.js'
import { sendMail } from './mailer.js'
import { getSettings, saveSettings, Settings } from './settings.js'
import { jobState, log, persist, pruneJobs, state } from './state.js'
import { forget, kick, status } from './watcher.js'

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const app = new Hono()

app.get('/healthz', (c) => c.text('ok'))

app.use('*', basicAuth({ realm: 'VPS-Sniper', verifyUser: (u, p) => same(u, env.adminUser) && same(p, env.adminPass) }))

app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && !c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: 'JSON required' }, 415)
  await next()
})

app.onError((e, c) => {
  if (e instanceof HTTPException) return e.getResponse()
  const msg = e instanceof HcloudError ? `Hetzner API: ${e.code}: ${e.message}` : e.message
  return c.json({ error: msg }, 502)
})

app.get('/api/settings', (c) => c.json(getSettings()))

app.put('/api/settings', async (c) => {
  const r = Settings.safeParse(await c.req.json())
  if (!r.success) return c.json({ error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400)
  const saved = saveSettings(r.data)
  pruneJobs(saved.jobs.map((j) => j.id))
  persist()
  log('info', `Settings saved (${saved.enabled ? 'enabled' : 'disabled'}, ${saved.jobs.length} jobs, every ${saved.intervalSec} s)`)
  kick()
  return c.json(saved)
})

app.get('/api/catalog', async (c) => {
  const [types, meta] = await Promise.all([getTypes(60_000), getMeta()])
  const images = new Map<string, { name: string; description: string; archs: string[] }>()
  for (const i of meta.images) {
    if (!i.name || i.deprecated) continue
    const e = images.get(i.name) ?? { name: i.name, description: i.description, archs: [] }
    e.archs.push(i.architecture)
    images.set(i.name, e)
  }
  return c.json({
    types: types
      .map((t) => ({
        name: t.name,
        description: t.description,
        category: t.category,
        cores: t.cores,
        memory: t.memory,
        disk: t.disk,
        cpuType: t.cpu_type,
        architecture: t.architecture,
        prices: Object.fromEntries(t.prices.map((p) => [p.location, Number(p.price_monthly.gross)])),
        locations: t.locations.filter(isActive).map((l) => l.name),
      }))
      .filter((t) => t.locations.length),
    locations: meta.locations.map((l) => ({ name: l.name, city: l.city, country: l.country, zone: l.network_zone })),
    images: [...images.values()].sort((a, b) => a.name.localeCompare(b.name)),
    sshKeys: meta.sshKeys.map((k) => ({ id: k.id, name: k.name })),
  })
})

app.get('/api/status', async (c) => {
  const s = getSettings()
  const types = await getTypes(Math.max(60_000, s.intervalSec * 2000))
  return c.json({
    enabled: s.enabled,
    lastPoll: status.lastPoll,
    lastError: status.lastError,
    avail: availability(types),
    jobs: Object.fromEntries(s.jobs.map((j) => [j.id, jobState(j.id)])),
    events: state.events.slice(0, 50),
  })
})

let testMailAt = 0

app.post('/api/test-mail', async (c) => {
  const wait = Math.ceil((testMailAt + 10_000 - Date.now()) / 1000)
  if (wait > 0) return c.json({ error: `Please wait ${wait} s before sending another test mail` }, 429)
  testMailAt = Date.now()
  await sendMail('Test', 'Mail delivery works.')
  log('info', `Test mail sent to ${env.smtp.to.join(', ')}`)
  return c.json({ ok: true, to: env.smtp.to })
})

app.post('/api/jobs/:id/reset', (c) => {
  const id = c.req.param('id')
  if (!getSettings().jobs.some((j) => j.id === id)) return c.json({ error: 'unknown job' }, 404)
  Object.assign(jobState(id), { status: 'watching', error: null, server: null, lastNotified: null })
  forget(id)
  log('info', `Job ${id.slice(0, 8)} reset to watching`)
  kick()
  return c.json({ ok: true })
})

app.use('/*', serveStatic({ root: './public' }))

serve({ fetch: app.fetch, port: env.port }, (i) => {
  console.log(`VPS-Sniper listening on :${i.port}`)
  kick()
})
