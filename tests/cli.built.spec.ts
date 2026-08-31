import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from '@rstest/core'

const roots: string[] = []
const bin = resolve('bin.js')

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function nodeOnlyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bundle-built-cli-'))
  roots.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: 'built-cli-fixture',
    version: '1.0.0',
    type: 'module',
    peerDependencies: { '@deepseek-ai/cordis': '^4.0.0' },
    devDependencies: { typescript: '^6.0.0' },
  })}\n`)
  writeFileSync(join(root, 'cordis.patch.yml'), '- insert:\n    - id: loader\n      name: cordis:loader\n')
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(resolve('node_modules/typescript'), join(root, 'node_modules', 'typescript'),
    process.platform === 'win32' ? 'junction' : 'dir')
  return root
}

describe('built executable', () => {
  it('prints help through the installed wrapper', () => {
    const result = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: dsh-bundle')
    expect(result.stderr).toBe('')
  })

  it('validates and builds a conventional Bundle', () => {
    const root = nodeOnlyFixture()
    const lint = spawnSync(process.execPath, [bin, 'lint', '--cwd', root], { encoding: 'utf8' })
    expect(lint.status).toBe(0)
    expect(lint.stdout).toContain('built-cli-fixture is valid')

    const build = spawnSync(process.execPath, [bin, 'build', '--cwd', root], { encoding: 'utf8' })
    expect(build.status).toBe(0)
    expect(build.stdout).toContain(`package: ${join(root, 'dist')}`)
    expect(build.stderr).toBe('')
  }, 30_000)
})
