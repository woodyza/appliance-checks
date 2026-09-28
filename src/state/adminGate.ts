import { onMounted, type Ref, ref } from 'vue'
import { type BrigadeSummary, listBrigades } from '../data/admin'

export function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'permission-denied'
}

export interface AdminGate {
  loading: Ref<boolean>
  notAuthorised: Ref<boolean>
  error: Ref<string | null>
  brigades: Ref<BrigadeSummary[]>
}

/** Runs the shared superadmin/admin gate probe (`listBrigades()`) once, on mount. */
export function useAdminGate(): AdminGate {
  const loading = ref(true)
  const notAuthorised = ref(false)
  const error = ref<string | null>(null)
  const brigades = ref<BrigadeSummary[]>([])

  onMounted(async () => {
    try {
      brigades.value = await listBrigades()
    } catch (err) {
      if (isPermissionDenied(err)) {
        notAuthorised.value = true
      } else {
        error.value = "Couldn't load brigades."
      }
    } finally {
      loading.value = false
    }
  })

  return { loading, notAuthorised, error, brigades }
}
