import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInstance } from '@module-federation/runtime-tools'
import * as Cordis from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from '@rstest/core'
import { serveRemoteBundle } from '../src/cli.ts'
import {
  buildBundle,
  remoteContainerName,
  type RemoteBundleManifest,
} from '../src/index.ts'
import { cleanFixtures, fixture } from './fixtures.ts'

afterEach(cleanFixtures)

describe('remote Bundle build', () => {
  it('emits package and immutable Node/Web artifacts for the default dual target', async () => {
    const root = fixture({ client: true })
    const result = await buildBundle({ cwd: root, buildId: 'build-e2e' })
    expect(result.packageDir).toBe(join(root, 'dist'))
    expect(result.remoteManifest).toBe(join(root, 'dist', 'remote', 'dsh-bundle.json'))
    expect(existsSync(join(root, 'dist', 'package.json'))).toBe(true)

    const manifest = JSON.parse(readFileSync(result.remoteManifest!, 'utf8')) as RemoteBundleManifest
    expect(manifest).toEqual({
      schemaVersion: 1,
      name: 'fixture-dsh-bundle',
      buildId: 'build-e2e',
      patch: 'builds/build-e2e/cordis.patch.yml',
      node: {
        entry: 'builds/build-e2e/node/remoteEntry.js',
        shared: [{ request: '@deepseek-ai/cordis', requiredVersion: '^4.0.0' }],
      },
      web: {
        entry: 'builds/build-e2e/web/remoteEntry.js',
        shared: ['@deepseek-ai/cordis'],
      },
    })
    expect(existsSync(join(root, 'dist', 'remote', manifest.node.entry))).toBe(true)
    expect(existsSync(join(root, 'dist', 'remote', manifest.web!.entry))).toBe(true)

    await buildBundle({ cwd: root, target: 'package' })
    expect(existsSync(result.remoteManifest!)).toBe(true)
    await expect(buildBundle({ cwd: root, target: 'remote', buildId: 'build-e2e' }))
      .rejects.toThrow('immutable remote build already exists')
  }, 30_000)

  it('supports a Node-only remote target without emitting package files', async () => {
    const root = fixture({ node: false, patch: '- insert:\n    - id: loader\n      name: cordis:loader\n' })
    const result = await buildBundle({ cwd: root, target: 'remote', buildId: 'node-only' })
    expect(result.packageDir).toBeUndefined()
    expect(existsSync(join(root, 'dist', 'package.json'))).toBe(false)
    const manifest = JSON.parse(readFileSync(result.remoteManifest!, 'utf8')) as RemoteBundleManifest
    expect(manifest.web).toBeUndefined()
    expect(existsSync(join(root, 'dist', 'remote', manifest.node.entry))).toBe(true)
  }, 30_000)

  it('loads the generated Node container over HTTP with Host Cordis', async () => {
    const served = await serveRemoteBundle({ cwd: fixture(), buildId: 'runtime-load', port: 0 })
    try {
      const manifest = await fetch(served.url).then(async response => response.json()) as RemoteBundleManifest
      const container = remoteContainerName(manifest.buildId)
      const runtime = createInstance({
        name: `test_host_${container}`,
        remotes: [{
          name: container,
          entry: new URL(manifest.node.entry, served.url).href,
          type: 'commonjs-module',
        }],
        shared: {
          '@deepseek-ai/cordis': {
            version: '4.0.0',
            scope: 'default',
            shareConfig: { singleton: true, requiredVersion: false, strictVersion: true },
            get: async () => () => Cordis,
          },
        },
      })
      const bootstrap = await runtime.loadRemote<{ modules: Record<string, unknown> }>(`${container}/bundle`)
      expect(Object.keys(bootstrap?.modules ?? {})).toEqual(['fixture-dsh-bundle'])
    } finally {
      await new Promise<void>((resolve, reject) => {
        served.server.close(error => { if (error === undefined) resolve(); else reject(error) })
      })
    }
  }, 30_000)

  it('rejects invalid ids and removes failed immutable builds', async () => {
    await expect(buildBundle({ cwd: fixture(), target: 'remote', buildId: 'bad/id' }))
      .rejects.toThrow('buildId may contain only')

    const broken = fixture()
    writeFileSync(join(broken, 'src', 'index.ts'), "import './missing.ts'\nexport const value = true\n")
    await expect(buildBundle({ cwd: broken, target: 'remote', buildId: 'broken' }))
      .rejects.toThrow('remote build failed')
    expect(existsSync(join(broken, 'dist', 'remote', 'builds', 'broken'))).toBe(false)
  }, 30_000)

  it('derives deterministic and distinct federation container names', () => {
    expect(remoteContainerName('build-a')).toBe(remoteContainerName('build-a'))
    expect(remoteContainerName('build-a')).not.toBe(remoteContainerName('build-b'))
    expect(remoteContainerName('build-a')).toMatch(/^dsh_[a-f0-9]{20}$/)
  })
})
