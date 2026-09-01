/** Public programmatic API for building and validating DSH Bundles. */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { buildPackageBundle } from './package-build.ts'
import { loadBundleProject } from './project.ts'
import { buildRemoteBundle } from './remote-build.ts'
import type { BundleBuilderOverrides, BundleProject } from './project.ts'

export {
  loadBundleProject,
  type BundleBuilderConfig,
  type BundleBuilderOverrides,
  type BundleBuilderTarget,
  type BundleProject,
} from './project.ts'
export {
  remoteContainerName,
  type RemoteBundleManifest,
  type RemoteBundleSharedModule,
  type RemoteBundleWebManifest,
} from './remote-protocol.ts'

/** Paths emitted by one Builder invocation. */
export interface BundleBuildResult {
  /** Normalized project used for the build. */
  project: BundleProject
  /** Ready-to-install package artifact directory, when selected. */
  packageDir?: string
  /** Stable remote subscription manifest, when selected. */
  remoteManifest?: string
}

function packageRootRequest(request: string): string {
  if (request.startsWith('@')) return request.split('/').slice(0, 2).join('/')
  /* v8 ignore next -- splitting a non-empty package request always returns a first item. */
  return request.split('/')[0] ?? request
}

function declaresBrowserPlugin(require: NodeJS.Require, request: string): boolean {
  const root = packageRootRequest(request)
  /* v8 ignore next -- built-in modules cannot pass the preceding module-resolution check. */
  const manifestPath = (require.resolve.paths(root) ?? [])
    .map(searchPath => join(searchPath, root, 'package.json'))
    .find(candidate => existsSync(candidate))
  if (manifestPath === undefined) return false
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    /* v8 ignore next -- only a concurrent filesystem mutation can invalidate the resolved manifest. */
    return false
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) return false
  const dsh = (manifest as Record<string, unknown>).dsh
  return typeof dsh === 'object' && dsh !== null && !Array.isArray(dsh)
    && (dsh as Record<string, unknown>).client !== undefined
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
  if (project.target === 'package') return
  for (const [specifier, entry] of project.modules) {
    if (specifier === project.name || entry.startsWith('/') || /^[A-Za-z]:[/\\]/.test(entry)) continue
    if (declaresBrowserPlugin(require, entry)) {
      throw new Error(
        `dsh-bundle: remote target cannot include browser plugin ${JSON.stringify(specifier)} from a dependency; only the Bundle's own src/client/index.ts is emitted`,
      )
    }
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
 * Build the selected package, remote, or dual artifact.
 * @param overrides - Project and output overrides.
 * @returns Emitted artifact path and normalized project.
 */
export async function buildBundle(overrides: BundleBuilderOverrides = {}): Promise<BundleBuildResult> {
  const project = lintBundle(overrides)
  const packageTask = project.target === 'package' || project.target === 'dual'
    ? buildPackageBundle(project)
    : Promise.resolve(undefined)
  const remoteTask = project.target === 'remote' || project.target === 'dual'
    ? buildRemoteBundle(project)
    : Promise.resolve(undefined)
  const [packageDir, remoteManifest] = await Promise.all([packageTask, remoteTask])
  return {
    project,
    ...(packageDir === undefined ? {} : { packageDir }),
    ...(remoteManifest === undefined ? {} : { remoteManifest }),
  }
}
