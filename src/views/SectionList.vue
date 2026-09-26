<script setup lang="ts">
import { inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CHECK_SESSION_KEY } from '../state/checkSession'

const session = inject(CHECK_SESSION_KEY)!
const route = useRoute()
const router = useRouter()

function openSection(sectionId: string): void {
  void router.push({ path: `${route.path}/${sectionId}`, query: route.query })
}

function percent(answered: number, due: number): number {
  return due > 0 ? Math.round((answered / due) * 100) : 0
}
</script>

<template>
  <div class="screen active screen-sections">
    <div class="check-type-banner">
      <div class="check-type-left">
        <div :class="['check-type-pill', session.monthly.value ? 'monthly' : 'weekly']">
          {{ session.monthly.value ? 'Monthly' : 'Weekly' }}
        </div>
        <div class="check-type-desc">
          {{ session.monthly.value ? 'Final week — all checks active' : 'Monthly checks hidden until final week' }}
        </div>
      </div>
    </div>

    <div
      v-for="entry in session.progress.value"
      :key="entry.section.id"
      class="section-card"
      @click="openSection(entry.section.id)"
    >
      <div class="section-card-body">
        <div class="section-card-name">
          {{ entry.section.title }}
        </div>
        <div class="section-card-meta">
          {{ entry.answered }}/{{ entry.due.length }} checked
        </div>
      </div>
      <div class="section-card-progress">
        <div class="progress-label">
          {{ percent(entry.answered, entry.due.length) }}%
        </div>
        <div class="progress-bar-track">
          <div
            :class="['progress-bar-fill', entry.answered === entry.due.length ? 'complete' : '']"
            :style="{ width: `${percent(entry.answered, entry.due.length)}%` }"
          />
        </div>
      </div>
      <div class="section-chevron">
        <span class="chev chev-right" />
      </div>
    </div>
  </div>
</template>
