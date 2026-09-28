<script setup lang="ts">
import AdminFrame from '../../components/AdminFrame.vue'
import { useAdminGate } from '../../state/adminGate'

const gate = useAdminGate()
</script>

<template>
  <AdminFrame
    title="Admin"
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
          User admin
        </div>
        <div class="section-chevron">
          <span class="chev chev-right" />
        </div>
      </router-link>

      <router-link
        v-for="entry in gate.brigades.value"
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
