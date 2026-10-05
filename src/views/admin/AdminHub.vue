<script setup lang="ts">
import AdminFrame from '../../components/AdminFrame.vue'
import type { BrigadeSummary } from '../../data/admin'
import { hasHub } from '../../domain/adminProfile'
import { listBrigadesFor, NOT_AUTHORISED, useAdminGate } from '../../state/adminGate'

interface Hub {
  brigades: BrigadeSummary[]
  userAdmin: boolean
}

const gate = useAdminGate<Hub>(
  async (profile) =>
    hasHub(profile)
      ? { brigades: await listBrigadesFor(profile), userAdmin: profile.kind === 'superadmin' }
      : NOT_AUTHORISED,
  "Couldn't load brigades.",
)
</script>

<template>
  <AdminFrame
    title="Admin"
    show-sign-out
    :loading="gate.loading.value"
    :not-authorised="gate.notAuthorised.value"
    :error="gate.error.value"
  >
    <div class="screen active screen-picker">
      <router-link
        v-if="gate.data.value?.userAdmin"
        to="/admin/users"
        class="appliance-card"
      >
        <div class="appliance-card-name">
          User admin
        </div>
        <div class="section-chevron">
          <span class="chev chev-right" />
        </div>
      </router-link>

      <router-link
        v-for="entry in gate.data.value?.brigades ?? []"
        :key="entry.slug"
        :to="`/${entry.slug}`"
        class="appliance-card"
      >
        <div class="appliance-card-name">
          {{ entry.brigade.name }}{{ entry.brigade.active ? '' : ' (inactive)' }}
        </div>
        <div class="section-chevron">
          <span class="chev chev-right" />
        </div>
      </router-link>
    </div>
  </AdminFrame>
</template>
