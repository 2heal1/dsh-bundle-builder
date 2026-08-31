/** Parsing for the DSH loader patch-list YAML dialect. */

import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as yaml from 'js-yaml'

/** Loader entry fields used while discovering Bundle modules. */
export interface PatchEntry {
  /** Plugin module request. */
  name?: string
  /** Whether this entry contains nested loader entries. */
  group?: boolean | null
  /** Plugin configuration or nested entries for a group. */
  config?: unknown
}

/** One DSH loader patch entry. */
export interface PatchOptions extends PatchEntry {
  /** Entries inserted by this patch. */
  insert?: PatchEntry[]
  /** Additional loader fields preserved by the source document. */
  [key: string]: unknown
}

interface JavaScriptExpression {
  readonly __jsExpr: string
}

const JavaScriptExpressionType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: data => typeof data === 'string',
  construct: data => ({ __jsExpr: data }) satisfies JavaScriptExpression,
})

const patchSchema = yaml.JSON_SCHEMA.extend(JavaScriptExpressionType)

function anchorInsertedPluginNames(patches: PatchOptions[], source: string): PatchOptions[] {
  const base = dirname(resolve(source))
  const visit = (entry: PatchEntry): void => {
    if (typeof entry.name === 'string' && (entry.name.startsWith('./') || entry.name.startsWith('../'))) {
      entry.name = pathToFileURL(resolve(base, entry.name)).href
    }
    if (entry.group === true && Array.isArray(entry.config)) {
      for (const child of entry.config as PatchEntry[]) visit(child)
    }
  }
  for (const patch of patches) {
    if (Array.isArray(patch.insert)) for (const entry of patch.insert) visit(entry)
  }
  return patches
}

/**
 * Parse and validate a DSH Bundle patch document.
 * @param source - Absolute patch filename used in diagnostics and relative-path anchoring.
 * @param content - YAML source text.
 * @returns Parsed top-level loader patches.
 */
export function parsePatchSource(source: string, content: string): PatchOptions[] {
  let parsed: unknown
  try {
    parsed = yaml.load(content, { schema: patchSchema })
  } catch (cause) {
    throw new Error(`dsh-bundle: failed to parse patch ${source}: ${String(cause)}`, { cause })
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`dsh-bundle: patch ${source} must be a top-level YAML array of loader patch entries`)
  }
  parsed.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`dsh-bundle: patch entry ${index + 1} in ${source} must be a mapping`)
    }
  })
  return anchorInsertedPluginNames(parsed as PatchOptions[], source)
}
