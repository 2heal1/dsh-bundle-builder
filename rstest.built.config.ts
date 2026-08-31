import { withRslibConfig } from '@rstest/adapter-rslib'
import { defineConfig } from '@rstest/core'

export default defineConfig({
  extends: withRslibConfig(),
  include: ['tests/**/*.built.spec.ts'],
})
