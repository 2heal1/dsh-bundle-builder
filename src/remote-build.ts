/** Build URL-loadable Node and browser DSH Bundle artifacts. */

import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pluginReact } from '@rsbuild/plugin-react'
import type { BundleProject } from './project.ts'
import {
  remoteContainerName,
  type RemoteBundleManifest,
  type RemoteBundleSharedModule,
} from './remote-protocol.ts'
import { exactAliases, runRslibBuild } from './rslib.ts'

const WEB_PLATFORM_SHARES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

const require = createRequire(import.meta.url)

function packageRootRequest(request: string): string {
  if (request.startsWith('@')) return request.split('/').slice(0, 2).join('/')
  /* v8 ignore next -- splitting a non-empty package request always returns a first item. */
  return request.split('/')[0] ?? request
}

function nodeShares(project: BundleProject): RemoteBundleSharedModule[] {
  return Object.entries(project.peers).map(([request, requiredVersion]) => ({ request, requiredVersion }))
}

function webShares(project: BundleProject): string[] {
  if (project.clientEntry === undefined) return []
  const requests = new Set(project.client.external)
  for (const request of WEB_PLATFORM_SHARES) {
    if (project.versions[request] !== undefined || project.versions[packageRootRequest(request)] !== undefined) {
      requests.add(request)
    }
  }
  return [...requests]
}

function federationShared(shared: readonly RemoteBundleSharedModule[]): Record<string, object> {
  return Object.fromEntries(shared.map(item => [item.request, {
    import: false,
    singleton: true,
    strictVersion: true,
    requiredVersion: item.requiredVersion,
  }]))
}

function browserFederationShared(shared: readonly string[]): Record<string, object> {
  return Object.fromEntries(shared.map(request => [request, {
    import: false,
    singleton: true,
    requiredVersion: false,
  }]))
}

function bootstrapSource(project: BundleProject): string {
  const imports: string[] = []
  const fields: string[] = []
  let index = 0
  for (const [specifier, entry] of project.modules) {
    const local = `module${String(index++)}`
    imports.push(`import * as ${local} from ${JSON.stringify(entry)}`)
    fields.push(`${JSON.stringify(specifier)}: ${local}`)
  }
  return `${imports.join('\n')}\nexport const modules = Object.freeze({${fields.join(',')}})\n`
}

function nodeRuntimePlugin(): string {
  return require.resolve('@module-federation/node/runtimePlugin')
}

async function buildNodeRemote(
  project: BundleProject,
  outDir: string,
  container: string,
  shared: readonly RemoteBundleSharedModule[],
): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-bundle-remote-node-'))
  try {
    const bootstrap = join(temporary, 'bootstrap.ts')
    const entry = join(temporary, 'entry.ts')
    writeFileSync(bootstrap, bootstrapSource(project))
    writeFileSync(entry, 'export {}\n')
    await runRslibBuild(project.cwd, {
      mode: 'production',
      logLevel: 'warn',
      lib: [{
        format: 'cjs',
        bundle: true,
        autoExternal: false,
        syntax: 'es2024',
      }],
      source: { entry: { main: entry } },
      resolve: { alias: exactAliases(project.modules) },
      performance: { buildCache: false },
      output: {
        target: 'node',
        distPath: { root: outDir },
        cleanDistPath: true,
        filename: { js: '[name].[contenthash].js' },
        minify: true,
        sourceMap: false,
      },
      tools: {
        rspack(config, { appendPlugins, rspack }) {
          config.target = 'async-node'
          config.externalsPresets = { node: true }
          config.output ??= {}
          config.output.chunkFilename = '[name].[contenthash].js'
          config.output.chunkLoading = 'async-node'
          config.output.library = { type: 'commonjs-module', name: container }
          config.output.uniqueName = container
          config.output.publicPath = 'auto'
          appendPlugins(new rspack.container.ModuleFederationPlugin({
            name: container,
            filename: 'remoteEntry.js',
            library: { type: 'commonjs-module', name: container },
            exposes: { './bundle': bootstrap },
            shared: federationShared(shared),
            runtimePlugins: [nodeRuntimePlugin()],
          }))
        },
      },
    })
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

async function buildWebRemote(
  project: BundleProject,
  outDir: string,
  container: string,
  shared: readonly string[],
): Promise<void> {
  if (project.clientEntry === undefined) return
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-bundle-remote-web-'))
  try {
    const entry = join(temporary, 'entry.ts')
    writeFileSync(entry, 'export {}\n')
    await runRslibBuild(project.cwd, {
      mode: 'production',
      logLevel: 'warn',
      lib: [{
        format: 'cjs',
        bundle: true,
        autoExternal: false,
        syntax: 'es2022',
      }],
      source: { entry: { main: entry } },
      resolve: { alias: exactAliases(project.modules) },
      performance: { buildCache: false },
      output: {
        target: 'web',
        distPath: {
          root: outDir,
          image: 'assets',
          svg: 'assets',
          font: 'assets',
          media: 'assets',
          assets: 'assets',
        },
        cleanDistPath: true,
        filename: {
          js: '[name].[contenthash].js',
          image: '[contenthash][ext]',
          svg: '[contenthash][ext]',
          font: '[contenthash][ext]',
          media: '[contenthash][ext]',
          assets: '[contenthash][ext]',
        },
        minify: true,
        sourceMap: true,
      },
      plugins: [pluginReact()],
      moduleFederation: {
        options: {
          name: container,
          filename: 'remoteEntry.js',
          library: { type: 'var', name: container },
          exposes: { './client': project.clientEntry },
          shared: browserFederationShared(shared),
        },
      },
      tools: {
        rspack(config) {
          config.output ??= {}
          config.output.chunkFilename = '[name].[contenthash].js'
          config.output.library = { type: 'var', name: container }
          config.output.uniqueName = container
          config.output.publicPath = 'auto'
        },
      },
    })
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

function writeManifest(path: string, manifest: RemoteBundleManifest): void {
  const temporary = `${path}.${process.pid.toString(36)}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(manifest, undefined, 2)}\n`)
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/**
 * Build one immutable remote generation and update `<outDir>/remote/dsh-bundle.json`.
 * @param project - Normalized Bundle project.
 * @returns Stable subscription-manifest path.
 */
export async function buildRemoteBundle(project: BundleProject): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/.test(project.buildId)) {
    throw new Error('dsh-bundle: buildId may contain only ASCII letters, digits, dot, underscore, and hyphen')
  }
  const remoteDir = join(project.outDir, 'remote')
  const buildRelative = `builds/${project.buildId}`
  const buildDir = join(remoteDir, buildRelative)
  if (existsSync(buildDir)) {
    throw new Error(`dsh-bundle: immutable remote build already exists: ${buildDir}`)
  }
  mkdirSync(buildDir, { recursive: true })
  const node = nodeShares(project)
  const web = webShares(project)
  const container = remoteContainerName(project.buildId)
  try {
    copyFileSync(project.patchPath, join(buildDir, 'cordis.patch.yml'))
    const builds = await Promise.allSettled([
      buildNodeRemote(project, join(buildDir, 'node'), container, node),
      buildWebRemote(project, join(buildDir, 'web'), container, web),
    ])
    const failures = builds.flatMap((result): unknown[] => (
      result.status === 'rejected' ? [result.reason] : []
    ))
    if (failures.length !== 0) throw new AggregateError(failures, 'dsh-bundle: remote build failed')
    const manifest: RemoteBundleManifest = {
      schemaVersion: 1,
      name: project.name,
      buildId: project.buildId,
      patch: `${buildRelative}/cordis.patch.yml`,
      node: { entry: `${buildRelative}/node/remoteEntry.js`, shared: node },
      ...(project.clientEntry === undefined ? {} : {
        web: {
          entry: `${buildRelative}/web/remoteEntry.js`,
          shared: web,
        },
      }),
    }
    mkdirSync(remoteDir, { recursive: true })
    const manifestPath = join(remoteDir, 'dsh-bundle.json')
    writeManifest(manifestPath, manifest)
    return manifestPath
  } catch (error) {
    rmSync(buildDir, { recursive: true, force: true })
    throw error
  }
}
