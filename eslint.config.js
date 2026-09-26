// @ts-check
import { defineConfig, globalIgnores } from 'eslint/config'
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'

export default defineConfig(
  globalIgnores(['dist/**', 'apps-script/**', 'node_modules/**']),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      // TypeScript already checks this, and the core rule false-positives on ambient DOM
      // lib types (e.g. Event, HTMLSelectElement) used only in type positions inside .vue files.
      'no-undef': 'off',
    },
  },
)
