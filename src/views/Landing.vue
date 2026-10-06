<script setup lang="ts">
import { currentUser } from '../state/auth'
</script>

<template>
  <div class="landing">
    <p>Scan the QR code for your brigade to start a Check</p>
    <router-link
      v-if="currentUser"
      class="retry-btn"
      to="/admin"
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
