import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const roots: string[] = []

/** Remove all temporary Bundle projects created by this module. */
export function cleanFixtures(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

/** Create a conventional DSH Bundle fixture with a local Cordis type stub. */
export function fixture(options: { client?: boolean; node?: boolean; peer?: boolean; patch?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bundle-builder-'))
  roots.push(root)
  mkdirSync(join(root, 'src', 'client'), { recursive: true })
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: 'fixture-dsh-bundle',
    version: '1.0.0',
    type: 'module',
    ...(options.peer === false ? {} : { peerDependencies: { '@deepseek-ai/cordis': '^4.0.0' } }),
    devDependencies: { '@deepseek-ai/cordis': '^4.0.0', privateTool: '1.0.0' },
    scripts: { build: 'private-command' },
  }, undefined, 2)}\n`)
  writeFileSync(join(root, 'cordis.patch.yml'), options.patch ?? [
    '- insert:',
    '    - id: fixture',
    '      name: fixture-dsh-bundle',
    '      config:',
    '        value: !!js process.env.FIXTURE_VALUE',
    '',
  ].join('\n'))
  if (options.node !== false) {
    writeFileSync(join(root, 'src', 'index.ts'), [
      "import type { Context } from '@deepseek-ai/cordis'",
      'export interface Config { value?: string }',
      'export function apply(_ctx: Context, _config: Config): void {}',
      '',
    ].join('\n'))
  }
  if (options.client === true) {
    writeFileSync(join(root, 'src', 'client', 'index.ts'), [
      "import type { Context } from '@deepseek-ai/cordis'",
      "export const name = 'fixture-client'",
      'export function apply(_ctx: Context): void {}',
      '',
    ].join('\n'))
  }
  installPackage(root, '@deepseek-ai/cordis', {
    name: '@deepseek-ai/cordis',
    version: '4.7.2',
    type: 'module',
    exports: { '.': './index.js', './package.json': './package.json' },
  }, 'export interface Context {}\n')
  return root
}

/** Install a minimal package into one fixture's node_modules. */
export function installPackage(
  root: string,
  name: string,
  manifest: Record<string, unknown>,
  declaration = 'export {}\n',
): void {
  const directory = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  writeFileSync(join(directory, 'index.js'), 'export {}\n')
  writeFileSync(join(directory, 'index.d.ts'), declaration)
}

/** Mutate a fixture package manifest. */
export function updateManifest(root: string, update: (manifest: Record<string, unknown>) => void): void {
  const path = join(root, 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  update(manifest)
  writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`)
}
