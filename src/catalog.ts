import { env } from './env.js'
import { Hcloud, type Image, type Location, type ServerType, type SshKey, type TypeLocation } from './hcloud.js'

export const api = new Hcloud(env.token)
export const pollApi = env.pollToken === env.token ? api : new Hcloud(env.pollToken)

interface Meta {
  at: number
  locations: Location[]
  images: Image[]
  sshKeys: SshKey[]
}

let types: { at: number; list: ServerType[] } | null = null
let meta: Meta | null = null

export const setTypes = (list: ServerType[]): void => {
  types = { at: Date.now(), list }
}

export const getTypes = async (maxAgeMs: number): Promise<ServerType[]> => {
  if (!types || Date.now() - types.at > maxAgeMs) setTypes(await pollApi.serverTypes())
  return (types as { list: ServerType[] }).list
}

export const getMeta = async (): Promise<Meta> => {
  if (!meta || Date.now() - meta.at > 60_000) {
    const [locations, images, sshKeys] = await Promise.all([api.locations(), api.images(), api.sshKeys()])
    meta = { at: Date.now(), locations, images, sshKeys }
  }
  return meta
}

export const isActive = (l: TypeLocation): boolean => !l.deprecation || Date.parse(l.deprecation.unavailable_after) > Date.now()

export const monthly = (t: ServerType, loc: string): number | null => {
  const p = t.prices.find((x) => x.location === loc)
  return p ? Number(p.price_monthly.gross) : null
}

export const key = (type: string, loc: string): string => `${type}@${loc}`

export const availability = (list: ServerType[]): Record<string, boolean> => {
  const out: Record<string, boolean> = {}
  for (const t of list) for (const l of t.locations) if (isActive(l)) out[key(t.name, l.name)] = l.available
  return out
}
