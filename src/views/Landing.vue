<script setup lang="ts">
import { adminHome, currentUser } from '../state/auth'
</script>

<template>
  <div class="landing">
    <p>Scan the QR code on your appliance to start a Check.</p>
    <router-link
      v-if="currentUser"
      class="retry-btn"
      :to="adminHome()"
    >
      Admin
    </router-link>
    <router-link
      v-else
      class="retry-btn"
      to="/admin/sign-in"
    >
      Admin sign-in
    </router-link>
  </div>
</template>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100dvh;
  padding: 20px;
  text-align: center;
}
</style>
