/** Rslib helpers shared by Node and optional DSH Web plugin builds. */

import { createRslib, type RslibConfig } from '@rslib/core'

/**
 * Run one Rslib build and close its resources after completion.
 * @param cwd - Build project root.
 * @param config - Complete in-memory Rslib configuration.
 */
export async function runRslibBuild(cwd: string, config: RslibConfig): Promise<void> {
  const rslib = await createRslib({ cwd, config })
  const result = await rslib.build()
  await result.close()
}

/**
 * Convert source mappings to exact Rslib aliases.
 * @param modules - Patch module mappings.
 * @returns Aliases for absolute source entries only.
 */
export function exactAliases(modules: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries([...modules]
    .filter(([, entry]) => entry.startsWith('/') || /^[A-Za-z]:[/\\]/.test(entry))
    .map(([specifier, entry]) => [`${specifier}$`, entry]))
}
