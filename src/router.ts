import { createRouter, createWebHistory } from 'vue-router'
import { SLUG_PATTERN } from './domain/slug'
import { adminHome, authReady, currentUser, isSignInLink } from './state/auth'
import AdminHub from './views/admin/AdminHub.vue'
import BrigadeAdminView from './views/admin/BrigadeAdminView.vue'
import SignIn from './views/admin/SignIn.vue'
import UserAdminView from './views/admin/UserAdminView.vue'
import ApplianceList from './views/ApplianceList.vue'
import CheckView from './views/CheckView.vue'
import Landing from './views/Landing.vue'
import SectionList from './views/SectionList.vue'
import SectionView from './views/SectionView.vue'

const SLUG_REGEX = new RegExp(`^${SLUG_PATTERN}$`)

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Landing },
    // Explicit `/admin` routes go before the slug routes, even though `admin` can't match the
    // 6-char slug pattern anyway.
    { path: '/admin/sign-in', component: SignIn, meta: { redirectIfSignedIn: true } },
    { path: '/admin', component: AdminHub, meta: { requiresAuth: true } },
    { path: '/admin/users', component: UserAdminView, meta: { requiresAuth: true } },
    { path: `/:slug(${SLUG_PATTERN})`, component: ApplianceList, sensitive: true },
    {
      // The static `admin` segment outranks `/:slug/:applianceId`'s param, so this shadows an
      // appliance id'd "admin" (appliance ids come from the CLI, so don't use that one).
      path: `/:slug(${SLUG_PATTERN})/admin`,
      component: BrigadeAdminView,
      meta: { requiresAuth: true },
      sensitive: true,
    },
    {
      // `sensitive` lives on the leaf (child) records, not this parent: vue-router 5's matcher
      // fails to register the empty-path child at all when the parent record that owns
      // `children` also sets `sensitive: true` (verified in the emulator/dev server). The global
      // `beforeEach` guard below is a backstop for this split placement, so a non-lowercase slug
      // is rejected consistently regardless of exactly how each record's case-sensitivity is set.
      path: `/:slug(${SLUG_PATTERN})/:applianceId`,
      component: CheckView,
      children: [
        { path: '', name: 'sectionList', component: SectionList, sensitive: true },
        { path: ':sectionId', name: 'sectionView', component: SectionView, sensitive: true },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const slug = to.params.slug
  if (typeof slug === 'string' && !SLUG_REGEX.test(slug)) return '/'

  // A sign-in link still goes through, so someone signed in can switch accounts.
  if (to.meta.redirectIfSignedIn) {
    await authReady()
    if (currentUser.value && !isSignInLink(new URL(to.fullPath, window.location.origin).href)) return adminHome()
  }

  if (to.meta.requiresAuth) {
    // Waits only for the first `onAuthStateChanged` result (a signed-in device's session
    // restoring); `currentUser` itself stays live for any sign-in that happens afterwards.
    await authReady()
    if (!currentUser.value) return '/admin/sign-in'
  }
})
