/** Version-one remote DSH Bundle manifest types shared by Builder APIs. */

import { createHash } from 'node:crypto'

/** One Host-provided Node module consumed by a remote container. */
export interface RemoteBundleSharedModule {
  /** Exact module request used as the Module Federation share key. */
  request: string
  /** Version range required by the remote build. */
  requiredVersion: string
}

/** Browser half of one remote Bundle build. */
export interface RemoteBundleWebManifest {
  /** Browser Module Federation entry, relative to the manifest URL. */
  entry: string
  /** Host-provided browser module identities. */
  shared: string[]
}

/** Stable subscription document for one immutable remote Bundle build. */
export interface RemoteBundleManifest {
  /** Protocol version. */
  schemaVersion: 1
  /** Bundle package name and subscription identifier. */
  name: string
  /** Immutable build identifier. */
  buildId: string
  /** Bundle patch document, relative to the manifest URL. */
  patch: string
  /** Node Module Federation build. */
  node: {
    /** Node remote entry, relative to the manifest URL. */
    entry: string
    /** Modules supplied by the DSH Host. */
    shared: RemoteBundleSharedModule[]
  }
  /** Optional browser Module Federation build. */
  web?: RemoteBundleWebManifest
}

/**
 * Derive the Module Federation container name from an immutable build id.
 * @param buildId - Immutable remote build identifier.
 * @returns A deterministic JavaScript identifier.
 */
export function remoteContainerName(buildId: string): string {
  return `dsh_${createHash('sha256').update(buildId).digest('hex').slice(0, 20)}`
}
