import { afterEach, describe, expect, it, rs } from '@rstest/core'
import { parseArgs, runCli, usage } from '../src/cli.ts'
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
    expect(parseArgs(['build', '--cwd', 'fixture', '--out-dir', 'artifact'])).toEqual({
      command: 'build', cwd: 'fixture', outDir: 'artifact',
    })
    expect(parseArgs(['--help'])).toBeUndefined()
    expect(usage()).toContain('dsh-bundle <build|lint>')
    expect(() => parseArgs([])).toThrow('expected build or lint')
    expect(() => parseArgs(['serve'])).toThrow('expected build or lint')
    expect(() => parseArgs(['lint', '--cwd'])).toThrow('--cwd requires a value')
    expect(() => parseArgs(['lint', '--unknown'])).toThrow('unknown option')
  })

  it('prints help, successful lint output, and errors', async () => {
    const help = output()
    expect(await runCli(['--help'], help.io)).toBe(0)
    expect(help.stdout.join('')).toContain('Usage:')
    expect(help.stderr).toEqual([])

    const lint = output()
    expect(await runCli(['lint', '--cwd', fixture()], lint.io)).toBe(0)
    expect(lint.stdout).toEqual(['dsh-bundle: fixture-dsh-bundle is valid\n'])

    const error = output()
    expect(await runCli(['lint', '--cwd', '/definitely/missing'], error.io)).toBe(1)
    expect(error.stderr.join('')).toContain('failed to read')
  })

  it('builds through the command and supports the process output adapter', async () => {
    const root = fixture({ node: false, patch: '- insert:\n    - id: loader\n      name: cordis:loader\n' })
    const build = output()
    expect(await runCli(['build', '--cwd', root], build.io)).toBe(0)
    expect(build.stdout).toEqual([`package: ${root}/dist\n`])

    const stdout = rs.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(await runCli(['--help'])).toBe(0)
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Usage: dsh-bundle'))
    } finally {
      stdout.mockRestore()
    }
  }, 30_000)
})
