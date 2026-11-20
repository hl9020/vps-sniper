const $ = (id) => document.getElementById(id)

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (typeof v === 'boolean') el[k] = v
    else el.setAttribute(k, v)
  }
  el.append(...kids.filter((x) => x !== null && x !== undefined && x !== false))
  return el
}

const api = async (method, path, body) => {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || r.statusText)
  return j
}

const time = (iso) => new Date(iso).toLocaleString()
const eur = (n) => (n === undefined ? '' : `€${n.toFixed(2)}`)
const k = (type, loc) => `${type}@${loc}`

let cat
let cfg
let jobs = []
let st = { avail: {}, jobs: {} }
let dirty = false

const markDirty = () => {
  dirty = true
  $('save').classList.add('dirty')
}

const msg = (text, ok) => {
  $('msg').textContent = text
  $('msg').className = `small ${ok ? 'ok' : 'bad'}`
}

const typeOf = (name) => cat.types.find((t) => t.name === name)
const locOf = (name) => cat.locations.find((l) => l.name === name)
const spec = (t) => `${t.cores} vCPU · ${t.memory} GB · ${t.disk} GB · ${t.architecture}`

const renderTypeSelect = () => {
  const groups = new Map()
  for (const t of [...cat.types].sort((a, b) => Math.min(...Object.values(a.prices)) - Math.min(...Object.values(b.prices)))) {
    if (!groups.has(t.category)) groups.set(t.category, [])
    groups.get(t.category).push(t)
  }
  $('newType').replaceChildren(
    ...[...groups].map(([c, ts]) => h('optgroup', { label: c.replaceAll('_', ' ') }, ...ts.map((t) => h('option', { value: t.name }, `${t.name} - ${spec(t)}`)))),
  )
  renderLocSelect()
}

const renderLocSelect = () => {
  const t = typeOf($('newType').value)
  const keep = $('newLoc').value
  $('newLoc').replaceChildren(
    ...(t ? t.locations : []).map((l) => {
      const loc = locOf(l)
      const up = st.avail[k(t.name, l)]
      return h('option', { value: l, selected: l === keep }, `${l}${loc ? ` · ${loc.city}` : ''} · ${up ? 'available' : 'sold out'} · ${eur(t.prices[l])}`)
    }),
  )
}

const statusCell = (j) => {
  if (!j.id) return h('span', { class: 'st new' }, 'unsaved')
  const s = st.jobs[j.id]
  if (!s) return h('span', { class: 'st' }, 'watching')
  if (s.status === 'ordered' && s.server) return h('span', { title: [s.server.ipv4, s.server.ipv6].filter(Boolean).join(' · ') }, h('span', { class: 'st ordered' }, 'ordered'), ' ', h('small', {}, s.server.name))
  if (s.status === 'failed') return h('span', { title: s.error ?? '' }, h('span', { class: 'st failed' }, 'failed'), ' ', h('small', {}, s.error ?? ''))
  return h('span', { class: 'st' }, 'watching')
}

const reset = async (id) => {
  const j = jobs.find((x) => x.id === id)
  if (st.jobs[id]?.status === 'ordered' && j?.action === 'order' && !confirm('This job already ordered a server. Resetting it will order another server as soon as one is available. Continue?')) return
  try {
    await api('POST', `/api/jobs/${id}/reset`, {})
    await poll()
  } catch (e) {
    msg(e.message, false)
  }
}

const renderJobs = () => {
  $('noJobs').hidden = jobs.length > 0
  $('jobs').hidden = jobs.length === 0
  $('jobs').replaceChildren(
    h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Location'), h('th', {}, 'Price/mo'), h('th', {}, 'Now'), h('th', {}, 'Action'), h('th', {}, 'Status'), h('th', {})),
    ...jobs.map((j, i) => {
      const t = typeOf(j.type)
      const loc = locOf(j.location)
      const up = st.avail[k(j.type, j.location)]
      const s = j.id ? st.jobs[j.id] : undefined
      return h('tr', {},
        h('td', {}, j.type, t ? h('small', {}, ` ${spec(t)}`) : h('small', {}, ' unknown type')),
        h('td', {}, j.location, loc ? h('small', {}, ` ${loc.city}`) : null),
        h('td', {}, t ? eur(t.prices[j.location]) : ''),
        s && s.status !== 'watching'
          ? h('td', { class: 'muted' }, '–')
          : h('td', {}, h('span', { class: `dot${up ? ' on' : ''}` }), up ? 'available' : 'sold out'),
        h('td', {}, j.action === 'order' ? 'Notify + order' : 'Notify'),
        h('td', {}, statusCell(j)),
        h('td', { class: 'act' },
          s && s.status !== 'watching' ? h('button', { type: 'button', title: 'Watch again', onclick: () => reset(j.id) }, 'Reset') : null,
          ' ',
          h('button', { type: 'button', title: 'Remove job', onclick: () => { jobs.splice(i, 1); markDirty(); renderJobs() } }, 'Remove'),
        ),
      )
    }),
  )
}

const hint = () => {
  const n = Number($('intervalSec').value)
  $('intervalHint').textContent = n < 2 ? 'Below 2 s only with a separate polling project (HCLOUD_POLL_TOKEN).' : `≈ ${Math.round(3600 / n)} of 3600 requests/hour.`
}

const renderForm = () => {
  $('enabled').checked = cfg.enabled
  $('intervalSec').value = cfg.intervalSec
  $('namePrefix').value = cfg.order.namePrefix
  $('ipv4').checked = cfg.order.ipv4
  $('image').replaceChildren(
    ...(cat.images.some((i) => i.name === cfg.order.image) ? [] : [h('option', { value: '', selected: true }, '- choose -')]),
    ...cat.images.map((i) => h('option', { value: i.name, selected: i.name === cfg.order.image }, `${i.name} (${i.archs.join(', ')})`)),
  )
  $('sshKeys').replaceChildren(
    ...(cat.sshKeys.length
      ? cat.sshKeys.map((s) => h('label', {}, h('input', { type: 'checkbox', value: String(s.id), checked: cfg.order.sshKeys.includes(s.id), onchange: markDirty }), s.name))
      : [h('span', { class: 'muted small' }, 'No SSH keys in this project. Add one in the Hetzner Console under Security, SSH keys, then reload this page. Without a key Hetzner mails a root password.')]),
  )
  jobs = cfg.jobs.map((j) => ({ ...j }))
  renderJobs()
  hint()
  dirty = false
  $('save').classList.remove('dirty')
}

const collect = () => ({
  enabled: $('enabled').checked,
  intervalSec: Number($('intervalSec').value),
  order: {
    image: $('image').value,
    sshKeys: [...$('sshKeys').querySelectorAll('input:checked')].map((i) => Number(i.value)),
    ipv4: $('ipv4').checked,
    namePrefix: $('namePrefix').value.trim(),
  },
  jobs,
})

const renderStatus = () => {
  const pill = $('pill')
  pill.textContent = !st.enabled ? 'paused' : st.lastError ? 'error' : 'watching'
  pill.className = `pill${!st.enabled ? '' : st.lastError ? ' err' : ' run'}`
  $('meta').textContent = st.lastError ? st.lastError : st.lastPoll ? `last check ${time(st.lastPoll)}` : ''
  $('events').replaceChildren(...st.events.map((e) => h('li', { class: e.level }, h('time', {}, time(e.ts)), e.msg)))
  renderJobs()
  renderLocSelect()
}

const poll = async () => {
  try {
    st = await api('GET', '/api/status')
    renderStatus()
  } catch (e) {
    $('pill').textContent = 'offline'
    $('pill').className = 'pill err'
    $('meta').textContent = e.message
  }
}

const init = async () => {
  try {
    ;[cat, cfg] = await Promise.all([api('GET', '/api/catalog'), api('GET', '/api/settings')])
  } catch (e) {
    msg(`Loading failed: ${e.message}`, false)
    return
  }
  renderTypeSelect()
  renderForm()
  await poll()
  setInterval(poll, 5000)

  for (const id of ['enabled', 'intervalSec', 'namePrefix', 'ipv4', 'image']) $(id).addEventListener('input', markDirty)
  $('intervalSec').addEventListener('input', hint)
  $('newType').addEventListener('change', renderLocSelect)

  $('add').addEventListener('click', () => {
    const type = $('newType').value
    const location = $('newLoc').value
    const action = document.querySelector('input[name="newAction"]:checked').value
    if (!type || !location) return
    jobs.push({ type, location, action })
    markDirty()
    renderJobs()
    msg('Job added. Save to activate it.', true)
  })

  $('save').addEventListener('click', async () => {
    try {
      cfg = await api('PUT', '/api/settings', collect())
      jobs = cfg.jobs.map((j) => ({ ...j }))
      dirty = false
      $('save').classList.remove('dirty')
      msg('Saved.', true)
      await poll()
    } catch (e) {
      msg(e.message, false)
    }
  })

  $('testMail').addEventListener('click', async () => {
    const b = $('testMail')
    b.disabled = true
    b.textContent = 'Sending…'
    msg('Sending test mail…', true)
    try {
      const r = await api('POST', '/api/test-mail', {})
      msg(`Test mail sent to ${r.to.join(', ')}. Check your inbox.`, true)
    } catch (e) {
      msg(`Test mail failed: ${e.message}`, false)
    }
    b.textContent = 'Send test mail'
    setTimeout(() => { b.disabled = false }, 10_000)
  })

  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault() })
}

init()
