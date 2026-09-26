<script setup lang="ts">
import type { RouteLocationNormalizedLoaded } from 'vue-router'

// Navigating directly between two appliances (e.g. `/:slug/:applianceId1` to
// `/:slug/:applianceId2`) matches the same route record, so Vue Router reuses the CheckView
// instance instead of remounting it. Keying on slug + applianceId forces a remount (and so a
// fresh useCheckSession load) whenever either changes, while leaving Section navigation within
// the same appliance (which only changes `sectionId`) alone.
function routeKey(route: RouteLocationNormalizedLoaded): string {
  return `${String(route.params.slug ?? '')}/${String(route.params.applianceId ?? '')}`
}
</script>

<template>
  <router-view v-slot="{ Component, route }">
    <component
      :is="Component"
      :key="routeKey(route)"
    />
  </router-view>
</template>
