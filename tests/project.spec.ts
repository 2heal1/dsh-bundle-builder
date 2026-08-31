import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { lintBundle, loadBundleProject } from '../src/index.ts'
import { parsePatchSource } from '../src/patch.ts'
import { bundleRules, exactAliases } from '../src/webpack.ts'
import { cleanFixtures, fixture, installPackage, updateManifest } from './fixtures.ts'

afterEach(cleanFixtures)

describe('Bundle project', () => {
  it('uses conventional entries, parses !!js, and discovers nested modules', () => {
    const root = fixture({ client: true, patch: [
      '- insert:',
      '    - id: group',
      '      name: cordis:group',
      '      group: true',
      '      config:',
      '        - id: fixture',
      '          name: fixture-dsh-bundle',
      '          config:',
      '            value: !!js process.env.FIXTURE_VALUE',
      '',
    ].join('\n') })
    const project = loadBundleProject({ cwd: root })
    expect(project).toMatchObject({
      name: 'fixture-dsh-bundle',
      version: '1.0.0',
      outDir: join(root, 'dist'),
      client: { inject: [], external: [], immediately: false },
    })
    expect(project.nodeEntry).toBe(join(root, 'src', 'index.ts'))
    expect(project.clientEntry).toBe(join(root, 'src', 'client', 'index.ts'))
    expect(project.modules).toEqual(new Map([['fixture-dsh-bundle', project.nodeEntry!]]))
    expect(() => lintBundle({ cwd: root })).not.toThrow()
  })

  it('supports explicit paths and dependency modules', () => {
    const root = fixture({ client: true, patch: [
      '- insert:',
      '    - id: fixture',
      '      name: fixture-dsh-bundle',
      '    - id: dependency',
      '      name: fixture-dependency',
      '',
    ].join('\n') })
    writeFileSync(join(root, 'src', 'other.ts'), 'export const other = true\n')
    installPackage(root, 'fixture-dependency', {
      name: 'fixture-dependency',
      version: '2.0.0',
      type: 'module',
      exports: { '.': './index.js' },
    })
    updateManifest(root, (manifest) => {
      manifest.dependencies = { 'fixture-dependency': '^2.0.0' }
      manifest.dsh = {
        client: { inject: ['maps'], external: ['fixture-dependency'], immediately: true },
        bundleBuilder: {
          outDir: 'artifact',
          patch: 'cordis.patch.yml',
          nodeEntry: 'src/index.ts',
          clientEntry: 'src/client/index.ts',
          modules: { 'fixture-dsh-bundle': 'src/other.ts' },
        },
      }
    })
    const project = lintBundle({ cwd: root, outDir: 'command-output' })
    expect(project).toMatchObject({
      outDir: join(root, 'command-output'),
      client: { inject: ['maps'], external: ['fixture-dependency'], immediately: true },
    })
    expect(project.modules.get('fixture-dsh-bundle')).toBe(join(root, 'src', 'other.ts'))
    expect(project.modules.get('fixture-dependency')).toBe('fixture-dependency')
  })

  it('normalizes publishable workspace peer ranges', () => {
    for (const [range, expected] of [
      ['workspace:*', '4.7.2'],
      ['workspace:^', '^4.7.2'],
      ['workspace:~', '~4.7.2'],
      ['workspace:>=4', '>=4'],
      ['^4.0.0', '^4.0.0'],
    ] as const) {
      const root = fixture()
      updateManifest(root, (manifest) => {
        manifest.peerDependencies = { '@deepseek-ai/cordis': range }
      })
      expect(loadBundleProject({ cwd: root }).peers['@deepseek-ai/cordis']).toBe(expected)
    }

    const absent = fixture()
    updateManifest(absent, (manifest) => {
      manifest.peerDependencies = { '@deepseek-ai/cordis': '^4.0.0', absent: 'workspace:*' }
    })
    expect(() => loadBundleProject({ cwd: absent })).toThrow('cannot resolve workspace dependency')

    const versionless = fixture()
    updateManifest(versionless, (manifest) => {
      manifest.peerDependencies = { '@deepseek-ai/cordis': '^4.0.0', versionless: 'workspace:*' }
    })
    installPackage(versionless, 'versionless', {
      name: 'versionless', version: '', exports: { '.': './index.js', './package.json': './package.json' },
    })
    expect(() => loadBundleProject({ cwd: versionless })).toThrow('has no package version')
  })

  it('rejects malformed manifests, configuration, and patch documents', () => {
    const cases: Array<[(manifest: Record<string, unknown>) => void, string]> = [
      [(manifest) => { manifest.name = '' }, 'non-empty name'],
      [(manifest) => { manifest.version = '' }, 'non-empty version'],
      [(manifest) => { manifest.dsh = [] }, 'package.json#dsh must be an object'],
      [(manifest) => { manifest.dsh = { bundleBuilder: [] } }, 'package.json#dsh.bundleBuilder must be an object'],
      [(manifest) => { manifest.peerDependencies = [] }, 'peerDependencies must be an object'],
      [(manifest) => { manifest.dsh = { bundleBuilder: { outDir: '' } } }, 'outDir must be a non-empty string'],
      [(manifest) => { manifest.dsh = { bundleBuilder: { patch: '' } } }, 'patch must be a non-empty string'],
      [(manifest) => { manifest.dsh = { bundleBuilder: { nodeEntry: 1 } } }, 'nodeEntry must be a non-empty string'],
      [(manifest) => { manifest.dsh = { bundleBuilder: { nodeEntry: 'missing.ts' } } }, 'nodeEntry not found'],
      [(manifest) => { manifest.dsh = { bundleBuilder: { modules: [] } } }, 'modules must be an object'],
      [(manifest) => { manifest.dsh = { bundleBuilder: { target: 'dual' } } }, 'unknown package.json#dsh.bundleBuilder field'],
    ]
    for (const [mutate, message] of cases) {
      const root = fixture()
      updateManifest(root, mutate)
      expect(() => loadBundleProject({ cwd: root })).toThrow(message)
    }

    const noPeer = fixture({ peer: false })
    expect(() => loadBundleProject({ cwd: noPeer })).toThrow('must declare @deepseek-ai/cordis')

    const noManifest = fixture()
    rmSync(join(noManifest, 'package.json'))
    expect(() => loadBundleProject({ cwd: noManifest })).toThrow('failed to read')

    const noPatch = fixture()
    rmSync(join(noPatch, 'cordis.patch.yml'))
    expect(() => loadBundleProject({ cwd: noPatch })).toThrow('failed to read patch')

    expect(() => parsePatchSource('/tmp/patch.yml', 'insert: []\n')).toThrow('top-level YAML array')
    expect(() => parsePatchSource('/tmp/patch.yml', '- valid\n')).toThrow('must be a mapping')
    expect(() => parsePatchSource('/tmp/patch.yml', ': invalid\n')).toThrow('failed to parse patch')
  })

  it('rejects nonportable or unresolved modules and incomplete client declarations', () => {
    const relative = fixture({ patch: '- insert:\n    - id: relative\n      name: ./src/index.ts\n' })
    expect(() => loadBundleProject({ cwd: relative })).toThrow('relative patch module names are not portable')

    const absent = fixture({ patch: '- insert:\n    - id: absent\n      name: absent-package\n' })
    expect(() => lintBundle({ cwd: absent })).toThrow('cannot resolve patch module')

    const missingMapped = fixture()
    updateManifest(missingMapped, (manifest) => {
      manifest.dsh = { bundleBuilder: { modules: { 'fixture-dsh-bundle': 'missing.ts' } } }
    })
    expect(() => lintBundle({ cwd: missingMapped })).toThrow('module "fixture-dsh-bundle" not found')

    const declaredClient = fixture()
    updateManifest(declaredClient, (manifest) => { manifest.dsh = { client: { platform: 'web' } } })
    expect(() => loadBundleProject({ cwd: declaredClient })).toThrow('declares dsh.client but no browser entry exists')

    const invalidClient = fixture({ client: true })
    updateManifest(invalidClient, (manifest) => { manifest.dsh = { client: { inject: [1] } } })
    expect(() => loadBundleProject({ cwd: invalidClient })).toThrow('inject must be a string array')

    const invalidClientObject = fixture({ client: true })
    updateManifest(invalidClientObject, (manifest) => { manifest.dsh = { client: [] } })
    expect(() => loadBundleProject({ cwd: invalidClientObject })).toThrow('package.json#dsh.client must be an object')

    const invalidPlatform = fixture({ client: true })
    updateManifest(invalidPlatform, (manifest) => { manifest.dsh = { client: { platform: 'node' } } })
    expect(() => loadBundleProject({ cwd: invalidPlatform })).toThrow('dsh.client.platform must be "web"')

    const invalidImmediately = fixture({ client: true })
    updateManifest(invalidImmediately, (manifest) => { manifest.dsh = { client: { immediately: 'yes' } } })
    expect(() => loadBundleProject({ cwd: invalidImmediately })).toThrow('dsh.client.immediately must be a boolean')

    const uninsertedClient = fixture({ client: true, patch: '[]\n' })
    expect(() => lintBundle({ cwd: uninsertedClient })).toThrow('requires the patch to insert')
  })

  it('protects source directories from output replacement', () => {
    const root = fixture()
    expect(() => loadBundleProject({ cwd: root, outDir: '.' })).toThrow('must not be the Bundle project directory')
    expect(() => loadBundleProject({ cwd: root, outDir: '..' })).toThrow('or one of its ancestors')
    expect(() => loadBundleProject({ cwd: root, outDir: 'src' })).toThrow('outDir contains build input')

    mkdirSync(join(root, 'safe'), { recursive: true })
    expect(loadBundleProject({ cwd: root, outDir: 'safe' }).outDir).toBe(join(root, 'safe'))

    mkdirSync(join(root, 'release', '.git'), { recursive: true })
    expect(() => loadBundleProject({ cwd: root, outDir: 'release' })).toThrow('refusing to replace Git working tree')
  })

  it('uses process.cwd by default and exposes deterministic Webpack helpers', () => {
    const root = fixture()
    const previous = process.cwd()
    process.chdir(root)
    try {
      expect(loadBundleProject()).toMatchObject({ name: 'fixture-dsh-bundle' })
    } finally {
      process.chdir(previous)
    }
    expect(bundleRules()).toHaveLength(3)
    expect(exactAliases(new Map([
      ['absolute', '/tmp/entry.ts'],
      ['windows', 'C:\\project\\entry.ts'],
      ['dependency', 'dependency'],
    ]))).toEqual({
      'absolute$': '/tmp/entry.ts',
      'windows$': 'C:\\project\\entry.ts',
    })
  })
})
