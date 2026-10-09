import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Fail rather than fall back to 5174 when 5173 is busy: the dev Sheets key's referrers, Playwright
  // and the CLI all assume 5173.
  server: { strictPort: true },
})
