import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ['src/**/*.test.ts'], environment: 'node', setupFiles: ['src/test-setup.ts'] },
})
