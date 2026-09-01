/** Build an ordinary installable DSH Bundle package. */

import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import { pluginReact } from '@rsbuild/plugin-react'
import type { BundleProject } from './project.ts'
import { exactAliases, runRslibBuild } from './rslib.ts'

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

function filesWithin(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else files.push(path)
    }
  }
  visit(root)
  return files
}

function declarationPath(dir: string, entry: string, rootDir: string, stem: string): string {
  const relativeDeclaration = relative(rootDir, entry).replaceAll('\\', '/').replace(/\.[^.]+$/, '.d.ts')
  const candidate = filesWithin(dir).find((path) => {
    const normalized = path.replaceAll('\\', '/')
    return normalized.endsWith(`/${relativeDeclaration}`)
      || basename(path) === `${stem}.d.ts` || basename(path) === `${stem}.d.mts`
  })
  if (candidate === undefined) throw new Error(`dsh-bundle: declaration build emitted no ${stem}.d.ts`)
  return candidate
}

async function buildDeclaration(
  project: BundleProject,
  entry: string,
  stem: string,
  outDir: string,
  target: 'node' | 'web',
): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-bundle-types-'))
  try {
    const rootDir = entry === project.cwd || entry.startsWith(`${project.cwd}${sep}`) ? project.cwd : dirname(entry)
    const generatedTsconfig = join(temporary, 'tsconfig.json')
    const projectTsconfig = join(project.cwd, 'tsconfig.json')
    if (!existsSync(projectTsconfig)) {
      writeFileSync(generatedTsconfig, `${JSON.stringify({
        compilerOptions: {
          target: target === 'node' ? 'ES2024' : 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          jsx: 'react-jsx',
          allowImportingTsExtensions: true,
          rootDir,
          strict: true,
          skipLibCheck: true,
        },
        files: [entry],
      }, undefined, 2)}\n`)
    }
    const declarationDir = join(temporary, 'output')
    await runRslibBuild(project.cwd, {
      logLevel: 'warn',
      lib: [{
        format: 'esm',
        bundle: true,
        dts: { bundle: true },
        syntax: target === 'node' ? 'es2024' : 'es2022',
      }],
      source: {
        entry: { [stem]: entry },
        tsconfigPath: existsSync(projectTsconfig) ? projectTsconfig : generatedTsconfig,
      },
      output: {
        target,
        distPath: { root: declarationDir },
        cleanDistPath: true,
        minify: false,
        sourceMap: false,
      },
      ...(target === 'web' ? { plugins: [pluginReact()] } : {}),
    })
    copyFileSync(declarationPath(declarationDir, entry, rootDir, stem), join(outDir, `${stem}.d.ts`))
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

async function buildNodePackage(project: BundleProject, outDir: string): Promise<void> {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-bundle-node-'))
  try {
    const entry = project.nodeEntry ?? join(temporary, 'index.ts')
    if (project.nodeEntry === undefined) writeFileSync(entry, 'export {}\n')
    await runRslibBuild(project.cwd, {
      logLevel: 'warn',
      lib: [{
        format: 'esm',
        bundle: true,
        autoExtension: false,
        syntax: 'es2024',
      }],
      source: { entry: { index: entry } },
      output: {
        target: 'node',
        distPath: { root: outDir },
        cleanDistPath: false,
        filename: { js: '[name].js' },
        minify: false,
        sourceMap: false,
      },
    })
    await buildDeclaration(project, entry, 'index', outDir, 'node')
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

async function buildClientPackage(project: BundleProject, outDir: string): Promise<void> {
  const entry = project.clientEntry
  if (entry === undefined) return
  const externals = [...new Set([...CLIENT_BASELINE, ...project.client.external])]
  await runRslibBuild(project.cwd, {
    logLevel: 'warn',
    lib: [{
      format: 'cjs',
      bundle: true,
      autoExtension: false,
      autoExternal: false,
      syntax: 'es2022',
      shims: {
        cjs: {
          'import.meta.url': false,
          'import.meta.dirname': false,
          'import.meta.filename': false,
        },
      },
      banner: {
        js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(project.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
      },
      footer: { js: 'return module.exports; } });' },
    }],
    source: { entry: { client: entry } },
    resolve: {
      alias: exactAliases(project.modules),
    },
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
      cleanDistPath: false,
      externals,
      filename: {
        js: '[name].js',
        image: '[contenthash][ext]',
        svg: '[contenthash][ext]',
        font: '[contenthash][ext]',
        media: '[contenthash][ext]',
        assets: '[contenthash][ext]',
      },
      injectStyles: true,
      minify: true,
      sourceMap: true,
    },
    plugins: [pluginReact()],
    tools: {
      rspack(config) {
        config.externalsType = 'commonjs'
        config.output ??= {}
        config.output.chunkFilename = 'client-[contenthash].js'
        config.optimization ??= {}
        config.optimization.runtimeChunk = false
        config.optimization.splitChunks = false
      },
    },
  })
  const javascript = filesWithin(outDir).filter(path => path.endsWith('.js'))
  if (javascript.length !== 2 || !javascript.some(path => basename(path) === 'index.js')
    || !javascript.some(path => basename(path) === 'client.js')) {
    throw new Error('dsh-bundle: browser build must emit one client.js; dynamic imports and code splitting are unsupported')
  }
  await buildDeclaration(project, entry, 'client', outDir, 'web')
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
    if (name === 'remote' || name === stagingName) continue
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
    /* v8 ignore next -- a successful Rslib entry build always emits index.js. */
    if (!existsSync(join(stagingDir, 'index.js'))) {
      throw new Error(`dsh-bundle: package build emitted no index.js from ${basename(project.nodeEntry ?? 'generated entry')}`)
    }
    publishPackageRoot(stagingDir, outDir)
    return outDir
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}
