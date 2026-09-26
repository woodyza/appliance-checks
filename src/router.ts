import { createRouter, createWebHistory } from 'vue-router'
import { SLUG_PATTERN } from './domain/slug'
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
    { path: `/:slug(${SLUG_PATTERN})`, component: ApplianceList, sensitive: true },
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

router.beforeEach((to) => {
  const slug = to.params.slug
  if (typeof slug === 'string' && !SLUG_REGEX.test(slug)) return '/'
})
