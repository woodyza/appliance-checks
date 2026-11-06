<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminIcon from './AdminIcon.vue'
import AdminSidebar from './AdminSidebar.vue'
import { type AdminProfile, adminHomePath } from '../domain/adminProfile'
import { adminNav } from '../domain/adminNav'
import { adminProfile, currentUser, signOut } from '../state/auth'
import { ensureNavAppliances, navAppliances } from '../state/navAppliances'
import { useShellLayout } from '../state/shellLayout'

const props = withDefaults(
  defineProps<{
    title: string
    loading: boolean
    notAuthorised: boolean
    error: string | null
    crumbs: { label: string; to?: string }[]
    up?: { to: string; label: string }
    home?: boolean
    brigade?: { slug: string; name: string }
    width?: 'admin' | 'wide'
  }>(),
  { up: undefined, brigade: undefined, width: 'admin' },
)

const route = useRoute()
const router = useRouter()
const layout = useShellLayout()

const profile = ref<AdminProfile | null>(null)
onMounted(async () => {
  try {
    profile.value = await adminProfile()
  } catch {
    profile.value = null
  }
})

watch(
  () => props.brigade?.slug,
  (slug) => {
    if (slug) ensureNavAppliances(slug)
  },
  { immediate: true },
)

const nav = computed(() =>
  adminNav(profile.value, props.brigade, props.brigade ? navAppliances(props.brigade.slug) : null),
)
const homePath = computed(() => (profile.value ? adminHomePath(profile.value) : '/admin'))
const shellWidth = computed(() => (props.width === 'wide' ? '90rem' : '48rem'))

const overlay = ref<HTMLDialogElement | null>(null)
const menuOpen = ref(false)

function openMenu(): void {
  overlay.value?.showModal()
  menuOpen.value = true
}

// A link to the page you're already on doesn't change the route, so links close it too.
function onOverlayClick(event: MouseEvent): void {
  const target = event.target as Element
  if (target === overlay.value || target.closest('a')) overlay.value?.close()
}

watch(() => route.fullPath, () => overlay.value?.close())
watch(layout, () => {
  menuOpen.value = false
})

async function handleSignOut(): Promise<void> {
  await signOut()
  await router.replace('/admin/sign-in')
}
</script>

<template>
  <div
    :class="['admin-shell', `shell-${layout}`]"
    :style="{ '--shell-width': shellWidth }"
  >
    <AdminSidebar
      v-if="layout === 'full'"
      :nav="nav"
      :home="homePath"
    />

    <template v-else-if="layout === 'rail'">
      <aside class="nav-rail">
        <button
          type="button"
          class="nav-rail-button"
          aria-label="Menu"
          title="Menu"
          aria-haspopup="dialog"
          :aria-expanded="menuOpen"
          @click="openMenu"
        >
          <AdminIcon name="menu" />
        </button>
        <router-link
          v-for="link in nav.top"
          :key="link.to"
          :to="link.to"
          class="nav-rail-button"
          :aria-label="link.label"
          :title="link.label"
          exact-active-class="nav-current"
        >
          <AdminIcon :name="link.icon === 'users' ? 'users' : 'building'" />
        </router-link>
        <router-link
          v-if="nav.brigade"
          :to="nav.brigade.overview"
          class="nav-rail-button"
          :aria-label="nav.brigade.name"
          :title="nav.brigade.name"
          exact-active-class="nav-current"
        >
          <AdminIcon name="firetruck" />
        </router-link>
      </aside>
      <dialog
        ref="overlay"
        class="nav-overlay"
        @click="onOverlayClick"
        @close="menuOpen = false"
      >
        <AdminSidebar
          :nav="nav"
          :home="homePath"
        />
      </dialog>
    </template>

    <div class="shell-main">
      <header v-if="layout === 'mobile'">
        <router-link
          v-if="up"
          :to="up.to"
          class="header-back header-up"
        >
          {{ up.label }}
        </router-link>
        <div class="header-titles">
          <div
            v-if="home"
            class="header-wordmark"
          >
            Appliance Checks
          </div>
          <div
            v-else
            class="header-callsign"
          >
            {{ title }}
          </div>
        </div>
        <button
          v-if="home"
          class="header-back"
          @click="handleSignOut"
        >
          Sign out
        </button>
      </header>

      <div
        v-else
        class="shell-topbar"
      >
        <nav
          class="shell-crumbs"
          aria-label="Breadcrumb"
        >
          <ol>
            <li
              v-for="(crumb, index) in crumbs"
              :key="index"
            >
              <span
                v-if="index === crumbs.length - 1"
                aria-current="page"
                class="crumb-current"
              >{{ crumb.label }}</span>
              <router-link
                v-else-if="crumb.to"
                :to="crumb.to"
              >
                {{ crumb.label }}
              </router-link>
              <span v-else>{{ crumb.label }}</span>
            </li>
          </ol>
        </nav>
        <span class="shell-email">{{ currentUser?.email }}</span>
        <button
          class="small-btn shell-signout"
          @click="handleSignOut"
        >
          Sign out
        </button>
      </div>

      <div class="shell-content">
        <div
          v-if="loading"
          class="screen active screen-loading"
        >
          <div class="spinner" />
          <div class="loading-text">
            Loading…
          </div>
        </div>

        <div
          v-else-if="notAuthorised"
          class="screen active screen-error not-authorised"
        >
          <div class="error-icon">
            ⚠️
          </div>
          <div class="error-msg">
            Not authorised.<br>
            UID: {{ currentUser?.uid }}
          </div>
        </div>

        <div
          v-else-if="error"
          class="screen active screen-error"
        >
          <div class="error-icon">
            ⚠️
          </div>
          <div class="error-msg">
            {{ error }}
          </div>
        </div>

        <slot v-else />
      </div>
    </div>
  </div>
</template>
