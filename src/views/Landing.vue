<script setup lang="ts">
import { currentUser } from '../state/auth'
</script>

<template>
  <main class="landing">
    <h1 class="title">
      Appliance<br>Checks
    </h1>
    <div class="hero">
      <img
        src="/station-80-trucks.webp"
        alt=""
        width="1400"
        height="776"
      >
    </div>
    <div class="actions">
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
    </div>
  </main>
</template>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100dvh;
  padding: 24px 20px;
  text-align: center;
}

.title {
  position: relative;
  z-index: 1;
  margin-bottom: -0.55em;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: clamp(3.2rem, 15vw, 6rem);
  line-height: 0.85;
  text-transform: uppercase;
  letter-spacing: 0.01em;
  color: #f2e600;
  -webkit-text-stroke: 2px var(--bg);
  paint-order: stroke fill;
  text-shadow: 0 4px 0 #e8401c;
}

.hero {
  position: relative;
  width: min(100%, 680px);
}

.hero::before {
  content: '';
  position: absolute;
  inset: 15% 5% 0;
  background: radial-gradient(ellipse at 50% 70%, rgba(232, 160, 32, 0.28), transparent 65%);
  filter: blur(10px);
}

.hero img {
  position: relative;
  display: block;
  width: 100%;
  height: auto;
}

.actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  margin-top: 28px;
}

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
