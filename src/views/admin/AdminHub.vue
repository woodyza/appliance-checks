<script setup lang="ts">
import AdminFrame from '../../components/AdminFrame.vue'
import { NOT_AUTHORISED, useAdminGate } from '../../state/adminGate'

const gate = useAdminGate(
  async (profile) => (profile.kind === 'superadmin' ? true : NOT_AUTHORISED),
  "Couldn't load your admin access.",
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
        to="/admin/users"
        class="appliance-card"
      >
        <div class="appliance-card-name">
          Users
        </div>
        <div class="section-chevron">
          <span class="chev chev-right" />
        </div>
      </router-link>

      <router-link
        to="/admin/brigades"
        class="appliance-card"
      >
        <div class="appliance-card-name">
          Brigades
        </div>
        <div class="section-chevron">
          <span class="chev chev-right" />
        </div>
      </router-link>
    </div>
  </AdminFrame>
</template>
