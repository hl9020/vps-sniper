const BASE = 'https://api.hetzner.cloud/v1'

export interface Price {
  location: string
  price_monthly: { net: string; gross: string }
}

export interface Deprecation {
  announced: string
  unavailable_after: string
}

export interface TypeLocation {
  id: number
  name: string
  available: boolean
  recommended: boolean
  deprecation: Deprecation | null
}

export interface ServerType {
  id: number
  name: string
  description: string
  category: string
  cores: number
  memory: number
  disk: number
  cpu_type: string
  architecture: string
  prices: Price[]
  locations: TypeLocation[]
}

export interface Location {
  id: number
  name: string
  description: string
  city: string
  country: string
  network_zone: string
}

export interface Image {
  id: number
  name: string | null
  description: string
  architecture: string
  os_flavor: string
  status: string
  deprecated: string | null
}

export interface SshKey {
  id: number
  name: string
  fingerprint: string
}

export interface Server {
  id: number
  name: string
  public_net: { ipv4: { ip: string } | null; ipv6: { ip: string } | null }
}

export interface RateLimit {
  limit: number
  remaining: number
  reset: number
}

export interface CreateServer {
  name: string
  server_type: string
  location: string
  image: number
  ssh_keys: number[]
  labels: Record<string, string>
  public_net: { enable_ipv4: boolean; enable_ipv6: boolean }
}

interface ErrorBody {
  error?: { code: string; message: string }
}

interface Page {
  meta?: { pagination?: { next_page: number | null } }
}

export class HcloudError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export class Hcloud {
  rate: RateLimit | null = null

  constructor(private readonly token: string) {}

  async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    const lim = r.headers.get('ratelimit-limit')
    const rem = r.headers.get('ratelimit-remaining')
    const rst = r.headers.get('ratelimit-reset')
    if (lim && rem && rst) this.rate = { limit: Number(lim), remaining: Number(rem), reset: Number(rst) }
    const txt = await r.text()
    const json: unknown = txt ? JSON.parse(txt) : {}
    if (!r.ok) {
      const e = (json as ErrorBody).error
      throw new HcloudError(r.status, e?.code ?? `http_${r.status}`, e?.message ?? r.statusText)
    }
    return json as T
  }

  async list<T>(path: string, key: string): Promise<T[]> {
    const out: T[] = []
    const sep = path.includes('?') ? '&' : '?'
    let page: number | null = 1
    while (page !== null) {
      const res: Record<string, unknown> & Page = await this.req('GET', `${path}${sep}per_page=50&page=${page}`)
      out.push(...(res[key] as T[]))
      page = res.meta?.pagination?.next_page ?? null
    }
    return out
  }

  serverTypes = (): Promise<ServerType[]> => this.list('/server_types', 'server_types')
  locations = (): Promise<Location[]> => this.list('/locations', 'locations')
  images = (): Promise<Image[]> => this.list('/images?type=system&status=available', 'images')
  sshKeys = (): Promise<SshKey[]> => this.list('/ssh_keys', 'ssh_keys')

  createServer = async (b: CreateServer): Promise<Server> => (await this.req<{ server: Server }>('POST', '/servers', b)).server
}
