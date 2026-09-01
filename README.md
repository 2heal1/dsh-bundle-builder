# DSH Bundle Builder

English | [中文](./README.zh-CN.md)

`dsh-bundle-builder` builds installable and URL-loadable DSH Bundle artifacts. It validates Bundle metadata and Cordis patches, compiles Node and optional Web entries, generates TypeScript declarations and package metadata, and can emit package and remote forms from the same source.

> `dsh-bundle-builder` is an independent community project and is not an official DeepSeek AI project.

## Why

A DSH Bundle combines executable plugin code with a Cordis patch and DSH package declarations. These files must agree on entries, exports, dependency metadata, shared runtime modules, and Web loading behavior before DSH can run the Bundle. The Builder validates and builds these inputs together, whether the Bundle is installed through a package manager or loaded from a remote subscription URL.

## Install

```sh
pnpm add -D dsh-bundle-builder typescript
```

Node.js `^22.19.0` or `>=24.0.0` is required.

## Compatibility

`dsh-bundle-builder` targets the current DSH Bundle package format and accepts `@deepseek-ai/cordis ^4.0.0` as the Bundle peer dependency. Remote artifacts require DSH remote Bundle protocol support and are not loadable by current public DSH releases. Run `dsh-bundle lint` after upgrading DSH or Cordis.

## Project conventions

The Builder recognizes the following source layout and writes the package artifact to `dist/`. These paths can be overridden through [Optional configuration](#optional-configuration).

```text
my-bundle/
├── package.json
├── cordis.patch.yml
└── src/
    ├── index.ts
    └── client/index.ts   # optional DSH Web plugin
```

## Quick start

Declare Cordis as a peer dependency so DSH supplies the runtime singleton:

```json
{
  "name": "my-dsh-bundle",
  "version": "1.0.0",
  "type": "module",
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.0",
    "dsh-bundle-builder": "^0.1.1",
    "typescript": "^6.0.0"
  },
  "scripts": {
    "lint:bundle": "dsh-bundle lint",
    "build": "dsh-bundle build"
  }
}
```

Insert the package from `cordis.patch.yml`:

```yaml
- insert:
    - id: my-plugin
      name: my-dsh-bundle
      config: {}
```

Export the Cordis plugin from `src/index.ts`:

```ts
import type { Context } from '@deepseek-ai/cordis'

export interface Config {}

export function apply(ctx: Context, config: Config): void {
  // Register this Bundle's behavior.
}
```

Then validate and build:

```sh
pnpm dsh-bundle lint
pnpm dsh-bundle build
pnpm dsh-bundle build --target package
pnpm dsh-bundle build --target remote
```

The default target is `dual`, which emits the package and remote forms together. Use `package` or `remote` when only one form is needed. A remote build id defaults to a new UUID and can be supplied explicitly for a release:

```sh
pnpm dsh-bundle build --build-id 2026.09.01-1
```

The package artifact remains directly installable from `dist/`:

```text
dist/
├── package.json
├── cordis.patch.yml
├── index.js
├── index.d.ts
├── client.js       # when src/client/index.ts exists
├── client.js.map
├── client.d.ts
├── assets/         # when the package browser entry imports assets
└── remote/
    ├── dsh-bundle.json
    └── builds/<buildId>/
        ├── cordis.patch.yml
        ├── node/remoteEntry.js
        └── web/remoteEntry.js   # when src/client/index.ts exists
```

Install `dist/` through the normal DSH plugin flow, for example:

```sh
dsh plugin --profile demo add ./dist
```

With DSH remote Bundle support, subscribe to the stable manifest URL:

```sh
dsh plugin --profile demo add my-dsh-bundle@https://plugins.example.com/my-dsh-bundle/dsh-bundle.json
```

`dsh-bundle.json` selects one immutable `builds/<buildId>/` generation. DSH resolves the stable manifest when the process starts.

Serve a remote artifact locally during development:

```sh
pnpm dsh-bundle serve --port 4173
```

The package browser build intentionally emits one `client.js` and rejects dynamic imports. The remote browser build supports chunks under its immutable build directory.

## Example

[`examples/basic`](./examples/basic) is a complete Bundle with Node and Web entries. It is built by `pnpm check`, so the example stays aligned with the Builder:

```sh
pnpm example:build
```

## Optional configuration

Configure only paths that differ from the conventions:

```json
{
  "dsh": {
    "bundleBuilder": {
      "target": "dual",
      "outDir": "build",
      "patch": "config/my.patch.yml",
      "nodeEntry": "source/plugin.ts",
      "clientEntry": "source/client.tsx",
      "buildId": "release-2026-09-01",
      "modules": {
        "my-dsh-bundle": "source/plugin.ts"
      }
    }
  }
}
```

`modules` maps a module name inserted by the patch to a source entry. The Bundle package's own name automatically maps to `src/index.ts`; installed dependency names resolve through Node. The default `target` is `dual`, and `buildId` defaults to a new UUID.

Command-line paths override `package.json`:

```sh
dsh-bundle lint --cwd ./examples/basic
dsh-bundle build --cwd ./examples/basic --out-dir ./artifact --target remote
```

## Library API

```ts
import { buildBundle, lintBundle, loadBundleProject } from 'dsh-bundle-builder'

const project = lintBundle({ cwd: process.cwd() })
const result = await buildBundle({ cwd: project.cwd })
console.log(result.packageDir)
console.log(result.remoteManifest)
```

## Remote limitations

- Runtime types and module augmentation come from the package artifact, not the remote URL.
- A remote Bundle can publish its own `src/client/index.ts`. Dependencies that declare their own DSH Web plugin are rejected for the remote target.
- `dsh-bundle serve` is intended for local development.

## Develop this Builder

```sh
pnpm install
pnpm check
```

`pnpm check` runs linting, strict type checking, Rstest coverage for package and remote builds, the Rslib package build, built-CLI tests, the basic dual example, and `publint`.

See [Releasing](./docs/releasing.md) for the Changesets and trusted-publishing workflow.

## License

[MIT](./LICENSE)
