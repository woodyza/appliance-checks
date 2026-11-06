import { reactive } from 'vue'
import { listAllAppliances } from '../data/checkSheet'
import type { ApplianceSummary } from '../data/checks'
import type { Appliance } from '../domain/types'

const cache = reactive(new Map<string, ApplianceSummary[]>())
const inFlight = new Map<string, Promise<ApplianceSummary[]>>()
let generation = 0

/** Reactive: reading it inside a computed or render tracks the cache entry. */
export function navAppliances(slug: string): ApplianceSummary[] | null {
  return cache.get(slug) ?? null
}

function startLoad(slug: string): Promise<ApplianceSummary[]> {
  const existing = inFlight.get(slug)
  if (existing) return existing

  const startedIn = generation
  const load = listAllAppliances(slug)
    .then((appliances) => {
      if (startedIn === generation) cache.set(slug, appliances)
      return appliances
    })
    .finally(() => {
      if (inFlight.get(slug) === load) inFlight.delete(slug)
    })
  inFlight.set(slug, load)
  return load
}

export function ensureNavAppliances(slug: string): void {
  if (cache.has(slug) || inFlight.has(slug)) return
  startLoad(slug).catch((err) => console.error(err))
}

export function loadNavAppliances(slug: string): Promise<ApplianceSummary[]> {
  return startLoad(slug)
}

export function addNavAppliance(slug: string, appliance: ApplianceSummary): void {
  const cached = cache.get(slug)
  if (cached) cache.set(slug, [...cached, appliance])
}

export function patchNavAppliance(
  slug: string,
  id: string,
  fields: Partial<Pick<Appliance, 'callsign' | 'active'>>,
): void {
  const cached = cache.get(slug)
  if (!cached) return
  cache.set(
    slug,
    cached.map((appliance) => (appliance.id === id ? { ...appliance, ...fields } : appliance)),
  )
}

export function clearNavAppliances(): void {
  generation++
  cache.clear()
  inFlight.clear()
}
