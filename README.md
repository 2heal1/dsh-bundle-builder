# DSH Bundle Builder

English | [中文](./README.zh-CN.md)

`dsh-bundle-builder` is a build tool for installable DSH Bundle packages. It validates Bundle metadata and Cordis patches, compiles Node and optional Web entries, generates TypeScript declarations and package metadata, and writes the complete package artifact to `dist/`.

## Why

A DSH Bundle combines executable plugin code with a Cordis patch and DSH package declarations. These files must agree on entries, exports, dependency metadata, and Web loading behavior before DSH can install and run the Bundle. The Builder validates and builds these inputs together, reporting invalid composition during the build.

## Install

```sh
pnpm add -D dsh-bundle-builder typescript
```

Node.js `^22.19.0` or `>=24.0.0` is required.

## Quick start

The Builder recognizes the following project layout. A project that follows it can build without additional configuration; paths can be overridden when needed.

```text
my-bundle/
├── package.json
├── cordis.patch.yml
└── src/
    ├── index.ts
    └── client/index.ts   # optional DSH Web plugin
```

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
    "dsh-bundle-builder": "^0.1.0",
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
```

The build replaces `dist/` with the complete package artifact:

```text
dist/
├── package.json
├── cordis.patch.yml
├── index.js
├── index.d.ts
├── client.js       # when src/client/index.ts exists
├── client.js.map
├── client.d.ts
└── assets/         # when the browser entry imports assets
```

Install `dist/` through the normal DSH plugin flow, for example:

```sh
dsh plugin --profile demo add ./dist
```

The browser build intentionally emits one `client.js`. Browser dynamic imports and code splitting are rejected because the ordinary DSH package format has one client entry.

## Optional configuration

Configure only paths that differ from the conventions:

```json
{
  "dsh": {
    "bundleBuilder": {
      "outDir": "build",
      "patch": "config/my.patch.yml",
      "nodeEntry": "source/plugin.ts",
      "clientEntry": "source/client.tsx",
      "modules": {
        "my-dsh-bundle": "source/plugin.ts"
      }
    }
  }
}
```

`modules` maps a module name inserted by the patch to a source entry. The Bundle package's own name automatically maps to `src/index.ts`; installed dependency names resolve through Node.

Command-line paths override `package.json`:

```sh
dsh-bundle lint --cwd ./examples/basic
dsh-bundle build --cwd ./examples/basic --out-dir ./artifact
```

## Library API

```ts
import { buildBundle, lintBundle, loadBundleProject } from 'dsh-bundle-builder'

const project = lintBundle({ cwd: process.cwd() })
const result = await buildBundle({ cwd: project.cwd })
console.log(result.packageDir)
```

## Develop this Builder

```sh
pnpm install
pnpm check
```

`pnpm check` runs linting, strict type checking, Rstest coverage, the Rslib package build, built-CLI tests, and `publint`.

## License

[MIT](./LICENSE)
