import { withRslibConfig } from '@rstest/adapter-rslib'
import { defineConfig } from '@rstest/core'

export default defineConfig({
  extends: withRslibConfig(),
  include: ['tests/**/*.spec.ts'],
  exclude: ['tests/**/*.built.spec.ts'],
  coverage: {
    provider: 'v8',
    include: ['src/**/*.ts'],
    exclude: ['src/bin.ts'],
    reporters: ['text', 'json-summary'],
    thresholds: {
      lines: 95,
      functions: 95,
      statements: 95,
      branches: 90,
    },
  },
})
