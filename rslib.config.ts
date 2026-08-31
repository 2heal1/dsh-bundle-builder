import { defineConfig } from '@rslib/core'

export default defineConfig({
  lib: [{
    format: 'esm',
    bundle: true,
    dts: { bundle: true },
    syntax: 'es2024',
  }],
  source: {
    entry: {
      index: './src/index.ts',
      bin: './src/bin.ts',
    },
  },
  output: {
    target: 'node',
    distPath: { root: 'lib' },
    cleanDistPath: true,
    sourceMap: false,
  },
})
