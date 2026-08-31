# DSH Bundle Builder

English | [中文](./README.zh-CN.md)

`dsh-bundle-builder` validates and builds an ordinary installable DSH Bundle package. It uses the conventional DSH Bundle layout by default, so most projects need no Builder configuration.

## What it provides

A DSH Bundle is one installable composition layer rather than only one plugin entry. Its patch can assemble the Bundle's own Cordis plugin, installed plugin dependencies, and their configuration in a defined order. The Builder turns that source layer into a package DSH can add to a Profile.

With one build, a Bundle can provide:

- a Node plugin entry and its TypeScript declarations;
- an optional DSH Web plugin with TypeScript, TSX, CSS Modules, and static assets;
- the `cordis.patch.yml` layer that composes its plugins;
- a generated package manifest with the DSH declarations and exports needed by the Host.

The conventional layout keeps authoring focused on plugin code and composition. Cordis remains a peer dependency, so the installed Bundle participates in the Host's existing context instead of creating a second Cordis runtime. Ordinary runtime dependencies remain package dependencies and are installed by the package manager. The resulting `dist/` can be inspected, packed, published, or installed from a filesystem path through the same package workflow.

The build pipeline uses [Rslib](https://rslib.rs/) for the Builder itself and for emitted Node and Web artifacts. The repository uses [Rstest](https://rstest.rs/) so tests exercise the same Rspack-based compilation model.

## Install

```sh
pnpm add -D dsh-bundle-builder typescript
```

Node.js `^22.19.0` or `>=24.0.0` is required.

## Quick start

Create this layout:

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
