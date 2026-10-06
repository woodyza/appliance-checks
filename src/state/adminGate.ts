import { onMounted, type Ref, ref } from 'vue'
import { type BrigadeSummary, listBrigades, listBrigadesById } from '../data/admin'
import { getBrigade } from '../data/checks'
import { type AdminProfile, canManage } from '../domain/adminProfile'
import { adminProfile } from './auth'
import { isPermissionDenied } from './permissionDenied'

export { isPermissionDenied }

export const NOT_AUTHORISED = Symbol('not authorised')

export interface AdminGate<T> {
  loading: Ref<boolean>
  notAuthorised: Ref<boolean>
  error: Ref<string | null>
  data: Ref<T | null>
  profile: Ref<AdminProfile | null>
}

/**
 * Resolves the signed-in person's admin profile, then runs the screen's `load` once, on mount.
 * `load` returns `NOT_AUTHORISED` to refuse; a `permission-denied` from it counts the same.
 */
export function useAdminGate<T>(
  load: (profile: AdminProfile) => Promise<T | typeof NOT_AUTHORISED>,
  errorMessage: string,
): AdminGate<T> {
  const loading = ref(true)
  const notAuthorised = ref(false)
  const error = ref<string | null>(null)
  const data = ref<T | null>(null) as Ref<T | null>
  const profile = ref<AdminProfile | null>(null)

  onMounted(async () => {
    try {
      profile.value = await adminProfile()
      const loaded = await load(profile.value)
      if (loaded === NOT_AUTHORISED) {
        notAuthorised.value = true
      } else {
        data.value = loaded
      }
    } catch (err) {
      if (isPermissionDenied(err)) {
        notAuthorised.value = true
      } else {
        error.value = errorMessage
      }
    } finally {
      loading.value = false
    }
  })

  return { loading, notAuthorised, error, data, profile }
}

/** The brigades the profile can see in the admin screens: all of them for a superadmin, else the assigned ones. */
export async function listBrigadesFor(profile: AdminProfile): Promise<BrigadeSummary[]> {
  if (profile.kind === 'superadmin') return listBrigades()
  return profile.kind === 'admin' ? listBrigadesById(profile.brigadeIds) : []
}

/**
 * The gate load for a brigade's admin screens: refuses without reading the brigade if there's no
 * profile, then null for a slug that isn't a brigade, else refuses unless the profile manages it.
 */
export async function loadBrigadeForAdmin(
  profile: AdminProfile,
  slug: string,
): Promise<BrigadeSummary | null | typeof NOT_AUTHORISED> {
  if (profile.kind === 'none') return NOT_AUTHORISED
  const brigade = await getBrigade(slug)
  if (!brigade) return null
  return canManage(profile, brigade.brigadeId) ? { slug, brigade } : NOT_AUTHORISED
}
