import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildBundle } from '../src/index.ts'
import { cleanFixtures, fixture, updateManifest } from './fixtures.ts'

afterEach(cleanFixtures)

describe('Bundle package build', () => {
  it('emits a complete Node and browser package directly in dist', async () => {
    const root = fixture({ client: true })
    updateManifest(root, (manifest) => {
      manifest.dependencies = { runtime: '^1.0.0' }
      manifest.dsh = { client: { inject: ['maps'], external: ['runtime'], immediately: true } }
    })
    mkdirSync(join(root, 'dist'), { recursive: true })
    writeFileSync(join(root, 'dist', 'stale.txt'), 'stale\n')

    const result = await buildBundle({ cwd: root })
    expect(result.packageDir).toBe(join(root, 'dist'))
    expect(existsSync(join(result.packageDir, 'stale.txt'))).toBe(false)
    for (const name of ['package.json', 'cordis.patch.yml', 'index.js', 'index.d.ts', 'client.js', 'client.js.map', 'client.d.ts']) {
      expect(existsSync(join(result.packageDir, name)), name).toBe(true)
    }
    expect(readFileSync(join(result.packageDir, 'client.js'), 'utf8')).toContain('window.__ModuleLoader__.load')
    const manifest = JSON.parse(readFileSync(join(result.packageDir, 'package.json'), 'utf8')) as Record<string, unknown>
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
    const result = await buildBundle({ cwd: root })
    expect(existsSync(join(result.packageDir, 'index.js'))).toBe(true)
    expect(existsSync(join(result.packageDir, 'index.d.ts'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(result.packageDir, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(manifest.exports).not.toHaveProperty('./client')
    await expect(import(join(result.packageDir, 'index.js'))).resolves.toBeTypeOf('object')
  }, 30_000)

  it('rejects browser code splitting without replacing the previous artifact', async () => {
    const root = fixture({ client: true })
    mkdirSync(join(root, 'dist'), { recursive: true })
    writeFileSync(join(root, 'dist', 'previous.txt'), 'previous\n')
    writeFileSync(join(root, 'src', 'client', 'lazy.ts'), 'export const lazy = true\n')
    writeFileSync(join(root, 'src', 'client', 'index.ts'), "export const load = () => import('./lazy.ts')\n")

    await expect(buildBundle({ cwd: root })).rejects.toThrow('dynamic imports and code splitting are unsupported')
    expect(readFileSync(join(root, 'dist', 'previous.txt'), 'utf8')).toBe('previous\n')
  }, 30_000)
})
