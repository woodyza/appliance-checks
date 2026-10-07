<script setup lang="ts">
import { computed } from 'vue'
import AdminFrame from '../../components/AdminFrame.vue'
import { listAdminUsers, listBrigades } from '../../data/admin'
import type { AdminRole } from '../../domain/types'
import { NOT_AUTHORISED, useAdminGate } from '../../state/adminGate'

const gate = useAdminGate(
  async (profile) => {
    if (profile.kind !== 'superadmin') return NOT_AUTHORISED
    const [users, brigades] = await Promise.all([listAdminUsers(), listBrigades()])
    return { users, brigades }
  },
  "Couldn't load admin users.",
)

const users = computed(() => gate.data.value?.users ?? [])

function roleLabel(role: AdminRole): string {
  return role === 'brigadeAdmin' ? 'Brigade Admin' : 'VSO'
}

function brigadeNames(ids: string[]): string {
  const brigades = gate.data.value?.brigades ?? []
  return ids.map((id) => brigades.find((entry) => entry.brigade.brigadeId === id)?.brigade.name ?? id).join(', ')
}
</script>

<template>
  <AdminFrame
    title="Users"
    :up="{ to: '/admin', label: '‹ Admin' }"
    :loading="gate.loading.value"
    :not-authorised="gate.notAuthorised.value"
    :error="gate.error.value"
  >
    <div class="screen active screen-picker">
      <router-link
        to="/admin/users/new"
        class="small-btn new-entry positive new-user"
      >
        + New user
      </router-link>

      <router-link
        v-for="user in users"
        :key="user.email"
        :to="`/admin/users/${encodeURIComponent(user.email)}`"
        class="appliance-card"
      >
        <div class="appliance-card-name">
          {{ user.email }}
          <div class="section-card-meta">
            {{ user.displayName ? `${user.displayName} · ` : '' }}{{ roleLabel(user.role) }} · {{ brigadeNames(user.brigadeIds) }}
          </div>
        </div>
        <div class="section-chevron">
          <span class="chev chev-right" />
        </div>
      </router-link>
    </div>
  </AdminFrame>
</template>
