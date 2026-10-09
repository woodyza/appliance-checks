<script setup lang="ts">
import LandingLayout from '../components/LandingLayout.vue'
import { currentUser } from '../state/auth'
</script>

<template>
  <LandingLayout>
    <p class="message">
      <svg
        class="qr-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <rect
          x="3"
          y="3"
          width="7"
          height="7"
          rx="1"
        />
        <rect
          x="14"
          y="3"
          width="7"
          height="7"
          rx="1"
        />
        <rect
          x="3"
          y="14"
          width="7"
          height="7"
          rx="1"
        />
        <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
      </svg>
      <span>Scan your brigade's QR code<small>to start a Check</small></span>
    </p>
    <router-link
      v-if="currentUser"
      class="admin"
      to="/admin"
    >
      Admin
    </router-link>
    <router-link
      v-else
      class="admin"
      to="/admin/sign-in"
    >
      Admin sign-in
    </router-link>
  </LandingLayout>
</template>

<style scoped>
.message {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 1.05rem;
  font-weight: 600;
  text-align: left;
}

.message small {
  display: block;
  color: var(--text-dim);
  font-size: 0.9rem;
  font-weight: 400;
}

.qr-icon {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  color: var(--accent);
}

.admin {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  padding: 10px 20px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-dim);
  font-size: 0.9rem;
  font-weight: 600;
  text-decoration: none;
}
</style>
