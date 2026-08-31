/** Convention and package.json configuration resolution for DSH Bundle builds. */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { parsePatchSource, type PatchEntry, type PatchOptions } from './patch.ts'

/** Optional `package.json#dsh.bundleBuilder` path overrides. */
export interface BundleBuilderConfig {
  /** Output directory; defaults to `dist`. */
  outDir?: string
  /** Patch document; defaults to `cordis.patch.yml`. */
  patch?: string
  /** Node package entry; defaults to `src/index.ts` when present. */
  nodeEntry?: string
  /** Browser plugin entry; defaults to `src/client/index.ts` when present. */
  clientEntry?: string
  /** Explicit patch-specifier to source-entry mappings. */
  modules?: Record<string, string>
}

/** Command-line overrides over package.json configuration. */
export interface BundleBuilderOverrides {
  /** Project directory; defaults to the current directory. */
  cwd?: string
  /** Output-directory override. */
  outDir?: string
}

/** Validated inputs for one ordinary DSH Bundle package build. */
export interface BundleProject {
  /** Absolute project directory. */
  cwd: string
  /** Parsed source package manifest. */
  packageJson: Record<string, unknown>
  /** Bundle package name. */
  name: string
  /** Bundle package version. */
  version: string
  /** Absolute output directory. */
  outDir: string
  /** Absolute patch path. */
  patchPath: string
  /** Parsed patch list. */
  patches: PatchOptions[]
  /** Optional conventional Node entry. */
  nodeEntry?: string
  /** Optional conventional browser entry. */
  clientEntry?: string
  /** Patch module specifier to source entry or dependency request. */
  modules: Map<string, string>
  /** Publishable peer dependency ranges. */
  peers: Record<string, string>
  /** Browser Cordis dependency metadata copied to the built package. */
  client: {
    inject: string[]
    external: string[]
    immediately: boolean
  }
}

const CONFIG_FIELDS = new Set(['outDir', 'patch', 'nodeEntry', 'clientEntry', 'modules'])

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function optionalStringArray(subject: string, value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`dsh-bundle: ${subject} must be a string array`)
  }
  return value as string[]
}

function absolute(projectDir: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(projectDir, path)
}

function optionalEntry(projectDir: string, configured: unknown, conventional: string, subject: string): string | undefined {
  if (configured !== undefined && (typeof configured !== 'string' || configured === '')) {
    throw new Error(`dsh-bundle: ${subject} must be a non-empty string`)
  }
  const path = absolute(projectDir, configured ?? conventional)
  if (configured !== undefined && !existsSync(path)) throw new Error(`dsh-bundle: ${subject} not found: ${path}`)
  if (!existsSync(path)) return undefined
  if (!statSync(path).isFile()) throw new Error(`dsh-bundle: ${subject} must be a file: ${path}`)
  return path
}

function collectPatchModules(patches: PatchOptions[]): string[] {
  const modules = new Set<string>()
  const visit = (entry: PatchEntry): void => {
    if (typeof entry.name === 'string' && !entry.name.startsWith('cordis:')) modules.add(entry.name)
    if (entry.group === true && Array.isArray(entry.config)) {
      for (const child of entry.config as PatchEntry[]) visit(child)
    }
  }
  for (const patch of patches) {
    if (Array.isArray(patch.insert)) for (const entry of patch.insert) visit(entry)
  }
  return [...modules]
}

function stringRecord(subject: string, value: unknown): Record<string, string> {
  if (value === undefined) return {}
  const record = object(value)
  if (record === undefined || Object.values(record).some(item => typeof item !== 'string')) {
    throw new Error(`dsh-bundle: ${subject} must be an object of string values`)
  }
  return record as Record<string, string>
}

function installedVersion(projectDir: string, request: string): string {
  const require = createRequire(join(projectDir, 'package.json'))
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(require.resolve(`${request}/package.json`), 'utf8'))
  } catch (cause) {
    throw new Error(`dsh-bundle: cannot resolve workspace dependency ${JSON.stringify(request)} from ${projectDir}`, { cause })
  }
  const version = object(manifest)?.version
  if (typeof version !== 'string' || version === '') {
    throw new Error(`dsh-bundle: workspace dependency ${JSON.stringify(request)} has no package version`)
  }
  return version
}

function normalizeWorkspaceRanges(projectDir: string, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([request, range]) => {
    if (!range.startsWith('workspace:')) return [request, range]
    const selector = range.slice('workspace:'.length)
    if (selector !== '*' && selector !== '^' && selector !== '~') return [request, selector]
    const version = installedVersion(projectDir, request)
    return [request, selector === '*' ? version : `${selector}${version}`]
  }))
}

function prospectiveRealPath(path: string): string {
  let ancestor = path
  const suffix: string[] = []
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)
    suffix.unshift(basename(ancestor))
    if (parent === ancestor) break
    ancestor = parent
  }
  return resolve(realpathSync(ancestor), ...suffix)
}

function assertSafeOutput(cwd: string, outDir: string, inputs: readonly (string | undefined)[]): void {
  const realCwd = realpathSync(cwd)
  const realOutDir = prospectiveRealPath(outDir)
  if (realOutDir === realCwd || realCwd.startsWith(`${realOutDir}${sep}`)) {
    throw new Error('dsh-bundle: outDir must not be the Bundle project directory or one of its ancestors')
  }
  const ownedInput = inputs.find((input) => {
    if (input === undefined) return false
    const realInput = realpathSync(input)
    return realInput === realOutDir || realInput.startsWith(`${realOutDir}${sep}`)
  })
  if (ownedInput !== undefined) {
    throw new Error(`dsh-bundle: outDir contains build input ${ownedInput}`)
  }
  if (existsSync(join(outDir, '.git'))) {
    throw new Error(`dsh-bundle: refusing to replace Git working tree ${outDir}`)
  }
}

/**
 * Resolve and validate one Bundle project.
 * @param overrides - Command-line project and output overrides.
 * @returns Normalized project inputs.
 */
export function loadBundleProject(overrides: BundleBuilderOverrides = {}): BundleProject {
  const cwd = resolve(overrides.cwd ?? process.cwd())
  const packagePath = join(cwd, 'package.json')
  let packageJson: Record<string, unknown>
  try {
    packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>
  } catch (cause) {
    throw new Error(`dsh-bundle: failed to read ${packagePath}: ${String(cause)}`, { cause })
  }
  if (typeof packageJson.name !== 'string' || packageJson.name === '') {
    throw new Error(`dsh-bundle: ${packagePath} must declare a non-empty name`)
  }
  if (typeof packageJson.version !== 'string' || packageJson.version === '') {
    throw new Error(`dsh-bundle: ${packagePath} must declare a non-empty version`)
  }

  const dsh = object(packageJson.dsh)
  if (packageJson.dsh !== undefined && dsh === undefined) {
    throw new Error('dsh-bundle: package.json#dsh must be an object')
  }
  const configuredBuilder = object(dsh?.bundleBuilder)
  if (dsh?.bundleBuilder !== undefined && configuredBuilder === undefined) {
    throw new Error('dsh-bundle: package.json#dsh.bundleBuilder must be an object')
  }
  const rawConfig = configuredBuilder ?? {}
  const unknownFields = Object.keys(rawConfig).filter(field => !CONFIG_FIELDS.has(field))
  if (unknownFields.length !== 0) {
    throw new Error(`dsh-bundle: unknown package.json#dsh.bundleBuilder field ${JSON.stringify(unknownFields[0])}`)
  }
  const rawOutDir = overrides.outDir ?? rawConfig.outDir ?? 'dist'
  if (typeof rawOutDir !== 'string' || rawOutDir === '') throw new Error('dsh-bundle: outDir must be a non-empty string')
  const outDir = absolute(cwd, rawOutDir)
  const patchName = rawConfig.patch ?? 'cordis.patch.yml'
  if (typeof patchName !== 'string' || patchName === '') throw new Error('dsh-bundle: patch must be a non-empty string')
  const patchPath = absolute(cwd, patchName)
  let patchSource: string
  try {
    patchSource = readFileSync(patchPath, 'utf8')
  } catch (cause) {
    throw new Error(`dsh-bundle: failed to read patch ${patchPath}: ${String(cause)}`, { cause })
  }
  const patches = parsePatchSource(patchPath, patchSource)
  const nodeEntry = optionalEntry(cwd, rawConfig.nodeEntry, 'src/index.ts', 'nodeEntry')
  const clientEntry = optionalEntry(cwd, rawConfig.clientEntry, 'src/client/index.ts', 'clientEntry')
  assertSafeOutput(cwd, outDir, [packagePath, patchPath, nodeEntry, clientEntry])

  const configuredModules = stringRecord('package.json#dsh.bundleBuilder.modules', rawConfig.modules)
  const modules = new Map<string, string>()
  for (const specifier of collectPatchModules(patches)) {
    if (specifier.startsWith('file:')) {
      throw new Error(
        'dsh-bundle: relative patch module names are not portable in an installed package; '
        + 'use the Bundle package name or a dependency package name',
      )
    }
    const configured = configuredModules[specifier]
    if (configured !== undefined) modules.set(specifier, absolute(cwd, configured))
    else if (specifier === packageJson.name && nodeEntry !== undefined) modules.set(specifier, nodeEntry)
    else modules.set(specifier, specifier)
  }
  for (const [specifier, entry] of Object.entries(configuredModules)) {
    if (!modules.has(specifier)) modules.set(specifier, absolute(cwd, entry))
  }

  const peers = normalizeWorkspaceRanges(cwd, stringRecord('peerDependencies', packageJson.peerDependencies))
  if (peers['@deepseek-ai/cordis'] === undefined) {
    throw new Error('dsh-bundle: peerDependencies must declare @deepseek-ai/cordis so DSH supplies its singleton')
  }
  const clientDecl = object(dsh?.client)
  if (dsh?.client !== undefined && clientDecl === undefined) {
    throw new Error('dsh-bundle: package.json#dsh.client must be an object')
  }
  if (clientDecl !== undefined && clientEntry === undefined) {
    throw new Error('dsh-bundle: package.json declares dsh.client but no browser entry exists at src/client/index.ts or dsh.bundleBuilder.clientEntry')
  }
  if (clientDecl?.platform !== undefined && clientDecl.platform !== 'web') {
    throw new Error('dsh-bundle: package.json#dsh.client.platform must be "web"')
  }
  if (clientDecl?.immediately !== undefined && typeof clientDecl.immediately !== 'boolean') {
    throw new Error('dsh-bundle: package.json#dsh.client.immediately must be a boolean')
  }

  return {
    cwd,
    packageJson,
    name: packageJson.name,
    version: packageJson.version,
    outDir,
    patchPath,
    patches,
    ...(nodeEntry === undefined ? {} : { nodeEntry }),
    ...(clientEntry === undefined ? {} : { clientEntry }),
    modules,
    peers,
    client: {
      inject: optionalStringArray('package.json#dsh.client.inject', clientDecl?.inject),
      external: optionalStringArray('package.json#dsh.client.external', clientDecl?.external),
      immediately: clientDecl?.immediately === true,
    },
  }
}
