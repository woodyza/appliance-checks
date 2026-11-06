<script setup lang="ts">
import type { AdminNavNodes } from '../domain/adminNav'

defineProps<{ nav: AdminNavNodes; home: string }>()
</script>

<template>
  <aside class="nav-sidebar">
    <router-link
      :to="home"
      class="nav-brand"
    >
      <img
        src="/station-80-trucks-sidebar.webp"
        alt=""
        width="224"
        height="124"
      >
      <span class="nav-wordmark">Appliance Checks</span>
    </router-link>

    <nav
      class="nav-list"
      aria-label="Admin"
    >
      <router-link
        v-for="link in nav.top"
        :key="link.to"
        :to="link.to"
        class="nav-item"
        exact-active-class="nav-current"
      >
        {{ link.label }}
      </router-link>

      <template v-if="nav.brigade">
        <div
          class="nav-brigade"
          :title="nav.brigade.name"
        >
          {{ nav.brigade.name }}
        </div>
        <router-link
          :to="nav.brigade.overview"
          class="nav-item nav-sub"
          exact-active-class="nav-current"
        >
          Overview
        </router-link>
        <div
          v-if="nav.brigade.appliances.length"
          class="nav-heading"
        >
          Appliances
        </div>
        <router-link
          v-for="appliance in nav.brigade.appliances"
          :key="appliance.to"
          :to="appliance.to"
          :class="['nav-item', 'nav-sub', 'nav-appliance', { 'nav-inactive': appliance.inactive }]"
          :title="appliance.label"
          exact-active-class="nav-current"
        >
          {{ appliance.label }}{{ appliance.inactive ? ' (inactive)' : '' }}
        </router-link>
      </template>
    </nav>
  </aside>
</template>
