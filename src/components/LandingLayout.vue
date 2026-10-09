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
      <slot />
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
</style>
