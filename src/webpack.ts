/** Webpack helpers for the optional DSH Web plugin build. */

import { createRequire } from 'node:module'
import webpack from 'webpack'
import type { Configuration, Stats } from 'webpack'

const require = createRequire(import.meta.url)

/**
 * Run one Webpack compiler.
 * @param config - Complete Webpack configuration.
 * @returns Successful compilation statistics.
 */
export function runWebpack(config: Configuration): Promise<Stats> {
  return new Promise((resolve, reject) => {
    const compiler = webpack(config)
    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        /* v8 ignore start -- these outcomes require Webpack compiler or shutdown infrastructure faults. */
        if (error !== null) {
          reject(error)
          return
        }
        if (closeError !== null) {
          reject(closeError)
          return
        }
        if (stats === undefined) {
          reject(new Error('dsh-bundle: Webpack returned no build stats'))
          return
        }
        /* v8 ignore stop */
        if (stats.hasErrors()) {
          reject(new Error(stats.toString({ all: false, errors: true, errorDetails: true, colors: false })))
          return
        }
        resolve(stats)
      })
    })
  })
}

/** @returns TypeScript, TSX, CSS, and asset rules for DSH Web plugins. */
export function bundleRules(): NonNullable<NonNullable<Configuration['module']>['rules']> {
  return [{
    test: /\.[cm]?[jt]sx?$/,
    exclude: /node_modules/,
    use: {
      loader: require.resolve('swc-loader'),
      options: {
        jsc: {
          parser: { syntax: 'typescript', tsx: true, decorators: true },
          transform: { react: { runtime: 'automatic' } },
        },
      },
    },
  }, {
    test: /\.css$/,
    use: [{ loader: require.resolve('style-loader') }, {
      loader: require.resolve('css-loader'),
      options: {
        modules: { auto: /\.module\.css$/, localIdentName: 'dsh_[hash:base64:8]' },
        url: false,
      },
    }],
  }, {
    test: /\.(?:png|jpe?g|gif|svg|webp|woff2?)$/,
    type: 'asset',
    generator: { filename: 'assets/[contenthash][ext]' },
  }]
}

/**
 * Convert source mappings to exact Webpack aliases.
 * @param modules - Patch module mappings.
 * @returns Aliases for absolute source entries only.
 */
export function exactAliases(modules: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries([...modules]
    .filter(([, entry]) => entry.startsWith('/') || /^[A-Za-z]:[/\\]/.test(entry))
    .map(([specifier, entry]) => [`${specifier}$`, entry]))
}
