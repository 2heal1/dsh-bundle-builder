#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const entry = new URL('./lib/bin.js', import.meta.url)
if (!existsSync(fileURLToPath(entry))) {
  process.stderr.write('dsh-bundle: lib/bin.js is missing; build dsh-bundle-builder before running the command\n')
  process.exit(1)
}
await import(entry.href)
