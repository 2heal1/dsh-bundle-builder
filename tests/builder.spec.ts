import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from '@rstest/core'
import { buildBundle } from '../src/index.ts'
import { cleanFixtures, fixture, updateManifest } from './fixtures.ts'

afterEach(cleanFixtures)

describe('Bundle package build', () => {
  it('emits a complete Node and browser package directly in dist', async () => {
    const root = fixture({ client: true })
    writeFileSync(join(root, 'src', 'config.ts'), 'export interface FixtureConfig { value?: string }\n')
    writeFileSync(join(root, 'src', 'index.ts'), [
      "import type { Context } from '@deepseek-ai/cordis'",
      "import type { FixtureConfig } from './config.ts'",
      'export interface Config extends FixtureConfig {}',
      'export function apply(_ctx: Context, _config: Config): void {}',
      '',
    ].join('\n'))
    updateManifest(root, (manifest) => {
      manifest.dependencies = { runtime: '^1.0.0' }
      manifest.dsh = { client: { inject: ['maps'], external: ['runtime'], immediately: true } }
    })
    mkdirSync(join(root, 'dist'), { recursive: true })
    writeFileSync(join(root, 'dist', 'stale.txt'), 'stale\n')

    const result = await buildBundle({ cwd: root, target: 'package' })
    const packageDir = result.packageDir!
    expect(packageDir).toBe(join(root, 'dist'))
    expect(existsSync(join(packageDir, 'stale.txt'))).toBe(false)
    for (const name of ['package.json', 'cordis.patch.yml', 'index.js', 'index.d.ts', 'client.js', 'client.js.map', 'client.d.ts']) {
      expect(existsSync(join(packageDir, name)), name).toBe(true)
    }
    const nodeTypes = readFileSync(join(packageDir, 'index.d.ts'), 'utf8')
    expect(nodeTypes).toContain('FixtureConfig')
    expect(nodeTypes).not.toContain('./config')
    const clientSource = readFileSync(join(packageDir, 'client.js'), 'utf8')
    expect(clientSource).toContain('window.__ModuleLoader__.load')
    let registration: { factory: (require: (request: string) => unknown) => Record<string, unknown> } | undefined
    runInNewContext(clientSource, {
      window: { __ModuleLoader__: { load: (value: typeof registration) => { registration = value } } },
    })
    expect(registration?.factory(request => new Proxy({}, {
      get: (_target, property) => { throw new Error(`unexpected client external ${request}.${String(property)}`) },
    }))).toMatchObject({
      name: 'fixture-client',
      apply: expect.any(Function),
    })
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      name: 'fixture-dsh-bundle',
      version: '1.0.0',
      type: 'module',
      main: './index.js',
      types: './index.d.ts',
      dependencies: { runtime: '^1.0.0' },
      peerDependencies: { '@deepseek-ai/cordis': '^4.0.0' },
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        client: { platform: 'web', inject: ['maps'], external: ['runtime'], immediately: true },
      },
    })
    expect(manifest).not.toHaveProperty('scripts')
    expect(manifest).not.toHaveProperty('devDependencies')
    expect(manifest).not.toHaveProperty('dsh.bundleBuilder')
    expect(manifest.exports).toHaveProperty('./client')
  }, 30_000)

  it('emits a loadable empty Node entry when the Bundle only patches builtins', async () => {
    const root = fixture({ node: false, patch: '- insert:\n    - id: loader\n      name: cordis:loader\n' })
    const result = await buildBundle({ cwd: root, target: 'package' })
    const packageDir = result.packageDir!
    expect(existsSync(join(packageDir, 'index.js'))).toBe(true)
    expect(existsSync(join(packageDir, 'index.d.ts'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(manifest.exports).not.toHaveProperty('./client')
    await expect(import(join(packageDir, 'index.js'))).resolves.toBeTypeOf('object')
  }, 30_000)

  it('builds a TSX client with CSS Modules and static assets', async () => {
    const root = fixture({ client: true })
    rmSync(join(root, 'src', 'client', 'index.ts'))
    writeFileSync(join(root, 'src', 'client', 'styles.d.ts'), [
      "declare module '*.module.css' {",
      '  const classes: Record<string, string>',
      '  export default classes',
      '}',
      '',
    ].join('\n'))
    writeFileSync(join(root, 'src', 'client', 'index.tsx'), [
      '/// <reference path="./styles.d.ts" />',
      "import styles from './styles.module.css'",
      "export const className = styles.root ?? ''",
      '',
    ].join('\n'))
    writeFileSync(join(root, 'src', 'client', 'styles.module.css'), '.root { background: url(./marker.svg); }\n')
    writeFileSync(join(root, 'src', 'client', 'marker.svg'), `<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(12_000)}</svg>\n`)
    updateManifest(root, (manifest) => {
      manifest.dsh = { bundleBuilder: { clientEntry: 'src/client/index.tsx' } }
    })

    const result = await buildBundle({ cwd: root, target: 'package' })
    const packageDir = result.packageDir!
    expect(readFileSync(join(packageDir, 'client.js'), 'utf8')).toContain('className')
    expect(readFileSync(join(packageDir, 'client.d.ts'), 'utf8')).toContain('className')
    expect(readdirSync(join(packageDir, 'assets'))).toContainEqual(expect.stringMatching(/\.svg$/))
  }, 30_000)

  it('rejects browser code splitting without replacing the previous artifact', async () => {
    const root = fixture({ client: true })
    mkdirSync(join(root, 'dist'), { recursive: true })
    writeFileSync(join(root, 'dist', 'previous.txt'), 'previous\n')
    writeFileSync(join(root, 'src', 'client', 'lazy.ts'), 'export const lazy = true\n')
    writeFileSync(join(root, 'src', 'client', 'index.ts'), "export const load = () => import('./lazy.ts')\n")

    await expect(buildBundle({ cwd: root, target: 'package' }))
      .rejects.toThrow('dynamic imports and code splitting are unsupported')
    expect(readFileSync(join(root, 'dist', 'previous.txt'), 'utf8')).toBe('previous\n')
  }, 30_000)
})
