/** Build an ordinary installable DSH Bundle package. */

import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { build } from 'tsdown'
import webpack from 'webpack'
import type { Configuration } from 'webpack'
import type { BundleProject } from './project.ts'
import { bundleRules, exactAliases, runWebpack } from './webpack.ts'

const CLIENT_BASELINE = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

function declarationPath(dir: string, stem: string): string {
  const candidate = readdirSync(dir).find(name => name === `${stem}.d.ts` || name === `${stem}.d.mts`)
  if (candidate === undefined) throw new Error(`dsh-bundle: declaration build emitted no ${stem}.d.ts`)
  return join(dir, candidate)
}

async function buildDeclaration(project: BundleProject, entry: string, stem: string, outDir: string): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-bundle-types-'))
  try {
    await build({
      cwd: project.cwd,
      config: false,
      entry: { [stem]: entry },
      outDir: temporary,
      format: ['esm'],
      platform: 'browser',
      target: 'es2022',
      fixedExtension: false,
      dts: true,
      clean: true,
      logLevel: 'warn',
    })
    copyFileSync(declarationPath(temporary, stem), join(outDir, `${stem}.d.ts`))
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

async function buildNodePackage(project: BundleProject, outDir: string): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-bundle-node-'))
  try {
    const entry = project.nodeEntry ?? join(temporary, 'index.ts')
    if (project.nodeEntry === undefined) writeFileSync(entry, 'export {}\n')
    await build({
      cwd: project.cwd,
      config: false,
      entry: { index: entry },
      outDir,
      format: ['esm'],
      platform: 'node',
      target: 'es2024',
      fixedExtension: false,
      dts: true,
      clean: false,
      logLevel: 'warn',
    })
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

async function buildClientPackage(project: BundleProject, outDir: string): Promise<void> {
  const entry = project.clientEntry
  if (entry === undefined) return
  await buildDeclaration(project, entry, 'client', outDir)
  const externals = [...new Set([...CLIENT_BASELINE, ...project.client.external])]
  const config: Configuration = {
    mode: 'production',
    target: ['web', 'es2022'],
    context: project.cwd,
    cache: false,
    devtool: 'source-map',
    entry: { client: entry },
    output: {
      path: outDir,
      filename: 'client.js',
      chunkFilename: 'client-[contenthash].js',
      library: { type: 'commonjs2' },
      clean: false,
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
      alias: exactAliases(project.modules),
    },
    externals: Object.fromEntries(externals.map(request => [request, `commonjs ${request}`])),
    module: { rules: bundleRules() },
    optimization: { minimize: true, runtimeChunk: false, splitChunks: false },
    plugins: [
      new webpack.BannerPlugin({
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(project.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
        raw: true,
        entryOnly: true,
      }),
      new webpack.BannerPlugin({
        banner: 'return module.exports; } });',
        raw: true,
        entryOnly: true,
        footer: true,
      }),
    ],
  }
  const stats = await runWebpack(config)
  const assets = stats.toJson({ all: false, assets: true }).assets ?? []
  const javascript = assets.filter(asset => asset.name.endsWith('.js'))
  if (javascript.length !== 1 || javascript[0]?.name !== 'client.js') {
    throw new Error('dsh-bundle: browser build must emit one client.js; dynamic imports and code splitting are unsupported')
  }
}

function packageManifest(project: BundleProject): Record<string, unknown> {
  const source = structuredClone(project.packageJson)
  const dsh = typeof source.dsh === 'object' && source.dsh !== null && !Array.isArray(source.dsh)
    ? source.dsh as Record<string, unknown>
    : {}
  delete dsh.bundleBuilder
  dsh.bundle = { patch: './cordis.patch.yml' }
  if (project.clientEntry !== undefined) {
    dsh.client = {
      platform: 'web',
      ...(project.client.inject.length === 0 ? {} : { inject: project.client.inject }),
      ...(project.client.external.length === 0 ? {} : { external: project.client.external }),
      ...(project.client.immediately ? { immediately: true } : {}),
    }
  }
  source.dsh = dsh
  source.type = 'module'
  source.peerDependencies = project.peers
  source.main = './index.js'
  source.types = './index.d.ts'
  source.exports = {
    '.': { types: './index.d.ts', default: './index.js' },
    ...(project.clientEntry === undefined ? {} : {
      './client': { types: './client.d.ts', default: './client.js' },
    }),
    './cordis.patch.yml': './cordis.patch.yml',
    './package.json': './package.json',
  }
  source.files = [
    'index.js',
    'index.d.ts',
    ...(project.clientEntry === undefined ? [] : ['client.js', 'client.js.map', 'client.d.ts', 'assets']),
    'cordis.patch.yml',
  ]
  delete source.scripts
  delete source.devDependencies
  return source
}

function publishPackageRoot(stagingDir: string, outDir: string): void {
  const stagingName = basename(stagingDir)
  for (const name of readdirSync(outDir)) {
    if (name === stagingName) continue
    rmSync(join(outDir, name), { recursive: true, force: true })
  }
  for (const name of readdirSync(stagingDir)) renameSync(join(stagingDir, name), join(outDir, name))
}

/**
 * Build a ready-to-install DSH Bundle package at `project.outDir`.
 * @param project - Normalized Bundle project.
 * @returns Absolute package artifact directory.
 */
export async function buildPackageBundle(project: BundleProject): Promise<string> {
  const outDir = project.outDir
  mkdirSync(outDir, { recursive: true })
  const stagingDir = mkdtempSync(join(outDir, '.dsh-package-'))
  try {
    await buildNodePackage(project, stagingDir)
    await buildClientPackage(project, stagingDir)
    copyFileSync(project.patchPath, join(stagingDir, 'cordis.patch.yml'))
    writeFileSync(join(stagingDir, 'package.json'), `${JSON.stringify(packageManifest(project), undefined, 2)}\n`)
    /* v8 ignore next -- a successful tsdown entry build always emits index.js. */
    if (!existsSync(join(stagingDir, 'index.js'))) {
      throw new Error(`dsh-bundle: package build emitted no index.js from ${basename(project.nodeEntry ?? 'generated entry')}`)
    }
    publishPackageRoot(stagingDir, outDir)
    return outDir
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}
