<script setup lang="ts">
import { computed } from 'vue'
import AdminFrame from '../../components/AdminFrame.vue'
import { hasBrigadeList } from '../../domain/adminProfile'
import { listBrigadesFor, NOT_AUTHORISED, useAdminGate } from '../../state/adminGate'

const gate = useAdminGate(
  async (profile) => (hasBrigadeList(profile) ? await listBrigadesFor(profile) : NOT_AUTHORISED),
  "Couldn't load brigades.",
)

// The superadmin comes from the hub; for a VSO this list is their admin home.
const isSuperadmin = computed(() => gate.profile.value?.kind === 'superadmin')
const isVso = computed(() => gate.profile.value?.kind === 'admin')
</script>

<template>
  <AdminFrame
    title="Brigades"
    :up="isSuperadmin ? { to: '/admin', label: '‹ Admin' } : undefined"
    :show-sign-out="isVso"
    :loading="gate.loading.value"
    :not-authorised="gate.notAuthorised.value"
    :error="gate.error.value"
  >
    <div class="screen active screen-picker">
      <router-link
        v-if="isSuperadmin"
        to="/admin/brigades/new"
        class="small-btn new-entry new-brigade"
      >
        + New brigade
      </router-link>

      <router-link
        v-for="entry in gate.data.value ?? []"
        :key="entry.slug"
        :to="`/${entry.slug}/admin`"
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
