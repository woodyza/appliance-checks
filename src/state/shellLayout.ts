import { onUnmounted, readonly, ref, type Ref } from 'vue'

export type ShellLayout = 'full' | 'rail' | 'mobile'

const FULL_QUERY = '(min-width: 1280px)'
const RAIL_QUERY = '(min-width: 900px)'

export function useShellLayout(): Readonly<Ref<ShellLayout>> {
  const full = window.matchMedia(FULL_QUERY)
  const rail = window.matchMedia(RAIL_QUERY)

  function resolve(): ShellLayout {
    if (full.matches) return 'full'
    return rail.matches ? 'rail' : 'mobile'
  }

  const layout = ref<ShellLayout>(resolve())
  const update = (): void => {
    layout.value = resolve()
  }

  full.addEventListener('change', update)
  rail.addEventListener('change', update)
  onUnmounted(() => {
    full.removeEventListener('change', update)
    rail.removeEventListener('change', update)
  })

  return readonly(layout)
}
