/** Command-line parsing and execution for DSH Bundle builds. */

import { buildBundle, lintBundle } from './index.ts'
import type { BundleBuilderOverrides } from './project.ts'

interface ParsedArgs extends BundleBuilderOverrides {
  command: 'build' | 'lint'
}

/** Command output sinks, injectable for callers and tests. */
export interface CliOutput {
  /** Standard output writer. */
  stdout: (text: string) => void
  /** Standard error writer. */
  stderr: (text: string) => void
}

/** @returns CLI usage text. */
export function usage(): string {
  return `Usage: dsh-bundle <build|lint> [options]

Options:
  --out-dir <path>  output directory (default: dist)
  --cwd <path>      Bundle project directory (default: cwd)
  -h, --help        show this help
`
}

function value(args: readonly string[], index: number, flag: string): string {
  const result = args[index + 1]
  if (result === undefined || result.startsWith('-')) throw new Error(`dsh-bundle: ${flag} requires a value`)
  return result
}

/**
 * Parse CLI arguments.
 * @param args - Arguments after the executable name.
 * @returns Parsed command, or `undefined` for help.
 */
export function parseArgs(args: readonly string[]): ParsedArgs | undefined {
  if (args.includes('--help') || args.includes('-h')) return undefined
  const command = args[0]
  if (command !== 'build' && command !== 'lint') throw new Error('dsh-bundle: expected build or lint')
  const parsed: ParsedArgs = { command }
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--out-dir') {
      parsed.outDir = value(args, index, argument)
      index += 1
    } else if (argument === '--cwd') {
      parsed.cwd = value(args, index, argument)
      index += 1
    } else {
      throw new Error(`dsh-bundle: unknown option ${JSON.stringify(argument)}`)
    }
  }
  return parsed
}

/**
 * Execute the Builder CLI without mutating process exit state.
 * @param args - Arguments after the executable name.
 * @param output - Standard output and error writers.
 * @returns Process exit code.
 */
export async function runCli(
  args: readonly string[],
  output: CliOutput = {
    stdout: text => process.stdout.write(text),
    stderr: text => process.stderr.write(text),
  },
): Promise<number> {
  try {
    const parsed = parseArgs(args)
    if (parsed === undefined) {
      output.stdout(usage())
    } else if (parsed.command === 'lint') {
      const project = lintBundle(parsed)
      output.stdout(`dsh-bundle: ${project.name} is valid\n`)
    } else {
      const result = await buildBundle(parsed)
      output.stdout(`package: ${result.packageDir}\n`)
    }
    return 0
  } catch (error) {
    output.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
