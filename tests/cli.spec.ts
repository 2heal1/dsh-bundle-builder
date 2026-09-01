import { afterEach, describe, expect, it, rs } from '@rstest/core'
import { parseArgs, runCli, serveRemoteBundle, usage } from '../src/cli.ts'
import { cleanFixtures, fixture } from './fixtures.ts'

afterEach(cleanFixtures)

function output(): { stdout: string[]; stderr: string[]; io: { stdout(text: string): void; stderr(text: string): void } } {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    io: {
      stdout: text => { stdout.push(text) },
      stderr: text => { stderr.push(text) },
    },
  }
}

describe('CLI', () => {
  it('parses commands and path overrides', () => {
    expect(parseArgs([
      'build', '--cwd', 'fixture', '--out-dir', 'artifact', '--target', 'remote', '--build-id', 'build-1',
    ])).toEqual({
      command: 'build',
      cwd: 'fixture',
      outDir: 'artifact',
      target: 'remote',
      buildId: 'build-1',
      host: '127.0.0.1',
      port: 4173,
    })
    expect(parseArgs(['--help'])).toBeUndefined()
    expect(usage()).toContain('dsh-bundle <build|lint|serve>')
    expect(() => parseArgs([])).toThrow('expected build, lint, or serve')
    expect(() => parseArgs(['lint', '--cwd'])).toThrow('--cwd requires a value')
    expect(() => parseArgs(['build', '--target', 'other'])).toThrow('--target must be')
    expect(() => parseArgs(['serve', '--port', '70000'])).toThrow('--port must be')
    expect(() => parseArgs(['lint', '--unknown'])).toThrow('unknown option')
  })

  it('prints help, successful lint output, and errors', async () => {
    const help = output()
    expect(await runCli(['--help'], help.io)).toBe(0)
    expect(help.stdout.join('')).toContain('Usage:')
    expect(help.stderr).toEqual([])

    const lint = output()
    expect(await runCli(['lint', '--cwd', fixture(), '--target', 'package'], lint.io)).toBe(0)
    expect(lint.stdout).toEqual(['dsh-bundle: fixture-dsh-bundle is valid\n'])

    const error = output()
    expect(await runCli(['lint', '--cwd', '/definitely/missing'], error.io)).toBe(1)
    expect(error.stderr.join('')).toContain('failed to read')
  })

  it('builds through the command and supports the process output adapter', async () => {
    const root = fixture({ node: false, patch: '- insert:\n    - id: loader\n      name: cordis:loader\n' })
    const build = output()
    expect(await runCli(['build', '--cwd', root, '--target', 'package'], build.io)).toBe(0)
    expect(build.stdout).toEqual([`package: ${root}/dist\n`])

    const stdout = rs.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(await runCli(['--help'])).toBe(0)
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Usage: dsh-bundle'))
    } finally {
      stdout.mockRestore()
    }
  }, 30_000)

  it('serves remote artifacts with direct CORS and immutable-build caching', async () => {
    const result = await serveRemoteBundle({
      cwd: fixture({ node: false, patch: '- insert:\n    - id: loader\n      name: cordis:loader\n' }),
      buildId: 'served-build',
      port: 0,
    })
    try {
      const manifest = await fetch(result.url)
      expect(manifest.status).toBe(200)
      expect(manifest.headers.get('access-control-allow-origin')).toBe('*')
      expect(manifest.headers.get('cache-control')).toBe('no-cache')
      const body = await manifest.json() as { node: { entry: string } }

      const entry = await fetch(new URL(body.node.entry, result.url))
      expect(entry.status).toBe(200)
      expect(entry.headers.get('content-type')).toContain('text/javascript')
      expect(entry.headers.get('cache-control')).toContain('immutable')

      const head = await fetch(result.url, { method: 'HEAD' })
      expect(head.status).toBe(200)
      expect(await head.text()).toBe('')
      expect((await fetch(new URL('missing.js', result.url))).status).toBe(404)
      expect((await fetch(result.url, { method: 'POST' })).status).toBe(405)
      expect((await fetch(new URL('%', result.url))).status).toBe(400)
    } finally {
      await new Promise<void>((resolve, reject) => {
        result.server.close(error => { if (error === undefined) resolve(); else reject(error) })
      })
    }
  }, 30_000)
})
