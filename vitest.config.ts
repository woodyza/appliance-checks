import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/domain/**/*.test.ts', 'tests/cli/lib/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'emulator',
          include: ['tests/rules/**/*.test.ts', 'tests/cli/*.test.ts'],
          // tests/cli/store.test.ts wipes the whole emulator database between tests; running
          // emulator test files in parallel would race with tests/rules seeding its own data.
          fileParallelism: false,
        },
      },
    ],
  },
})
