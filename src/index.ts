/** Public programmatic API for building and validating DSH Bundles. */

import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { buildPackageBundle } from './package-build.ts'
import { loadBundleProject } from './project.ts'
import type { BundleBuilderOverrides, BundleProject } from './project.ts'

export {
  loadBundleProject,
  type BundleBuilderConfig,
  type BundleBuilderOverrides,
  type BundleProject,
} from './project.ts'

/** Paths emitted by one Builder invocation. */
export interface BundleBuildResult {
  /** Normalized project used for the build. */
  project: BundleProject
  /** Ready-to-install package artifact directory. */
  packageDir: string
}

/**
 * Validate that every patch-inserted module has a resolvable source.
 * @param project - Normalized Bundle project.
 */
export function lintBundleProject(project: BundleProject): void {
  const require = createRequire(join(project.cwd, 'package.json'))
  for (const [specifier, entry] of project.modules) {
    if (entry.startsWith('/') || /^[A-Za-z]:[/\\]/.test(entry)) {
      if (!existsSync(entry) || !statSync(entry).isFile()) {
        throw new Error(`dsh-bundle: module ${JSON.stringify(specifier)} not found: ${entry}`)
      }
      continue
    }
    try {
      require.resolve(entry)
    } catch (cause) {
      throw new Error(`dsh-bundle: cannot resolve patch module ${JSON.stringify(specifier)} from ${project.cwd}`, { cause })
    }
  }
  if (project.clientEntry !== undefined && !project.modules.has(project.name)) {
    throw new Error(
      `dsh-bundle: conventional browser entry ${project.clientEntry} requires the patch to insert ${JSON.stringify(project.name)}`,
    )
  }
}

/**
 * Validate one Bundle project without emitting artifacts.
 * @param overrides - Project and output overrides.
 * @returns Normalized project.
 */
export function lintBundle(overrides: BundleBuilderOverrides = {}): BundleProject {
  const project = loadBundleProject(overrides)
  lintBundleProject(project)
  return project
}

/**
 * Build one ordinary installable DSH Bundle package.
 * @param overrides - Project and output overrides.
 * @returns Emitted artifact path and normalized project.
 */
export async function buildBundle(overrides: BundleBuilderOverrides = {}): Promise<BundleBuildResult> {
  const project = lintBundle(overrides)
  const packageDir = await buildPackageBundle(project)
  return { project, packageDir }
}
