# DSH Bundle Builder

[English](./README.md) | 中文

`dsh-bundle-builder` 用于构建可安装和可通过 URL 加载的 DSH Bundle 产物。它负责校验 Bundle 元数据与 Cordis patch，编译 Node 入口和可选的 Web 入口，生成 TypeScript 类型声明与包元数据，并能从同一份源码生成 package 与 remote 两种形式。

> `dsh-bundle-builder` 是独立的社区项目，不是 DeepSeek AI 官方项目。

## 为什么需要 Builder

DSH Bundle 同时包含可执行的插件代码、Cordis patch 和 DSH 包声明。DSH 运行 Bundle 之前，这些内容的入口、exports、依赖信息、共享运行时模块和 Web 加载方式必须保持一致。无论 Bundle 通过包管理器安装还是从远程订阅 URL 加载，Builder 都会统一校验并构建这些输入。

## 安装

```sh
pnpm add -D dsh-bundle-builder typescript
```

要求 Node.js `^22.19.0` 或 `>=24.0.0`。

## 兼容性

`dsh-bundle-builder` 面向当前 DSH Bundle 包格式，并接受 `@deepseek-ai/cordis ^4.0.0` 作为 Bundle 的 peer dependency。remote 产物需要 DSH 支持远程 Bundle 协议，当前公开发布的 DSH 版本尚不能加载。升级 DSH 或 Cordis 后应重新运行 `dsh-bundle lint`。

## 项目约定

Builder 可以识别下面的源码目录，并默认将包产物写入 `dist/`。这些路径可以通过[可选配置](#可选配置)覆盖。

```text
my-bundle/
├── package.json
├── cordis.patch.yml
└── src/
    ├── index.ts
    └── client/index.ts   # 可选的 DSH Web 插件
```

## 快速开始

把 Cordis 声明为 peer dependency，让 DSH 提供运行时单例：

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

在 `cordis.patch.yml` 中插入当前包：

```yaml
- insert:
    - id: my-plugin
      name: my-dsh-bundle
      config: {}
```

在 `src/index.ts` 中导出 Cordis 插件：

```ts
import type { Context } from '@deepseek-ai/cordis'

export interface Config {}

export function apply(ctx: Context, config: Config): void {
  // 注册这个 Bundle 的行为。
}
```

执行校验和构建：

```sh
pnpm dsh-bundle lint
pnpm dsh-bundle build
pnpm dsh-bundle build --target package
pnpm dsh-bundle build --target remote
```

默认 target 是 `dual`，会同时生成 package 和 remote 两种形式。只需要一种产物时，可以选择 `package` 或 `remote`。remote build id 默认是新的 UUID，也可以在发布时显式指定：

```sh
pnpm dsh-bundle build --build-id 2026.09.01-1
```

package 产物仍然可以直接从 `dist/` 安装：

```text
dist/
├── package.json
├── cordis.patch.yml
├── index.js
├── index.d.ts
├── client.js       # 存在 src/client/index.ts 时生成
├── client.js.map
├── client.d.ts
├── assets/         # package 浏览器入口导入资源时生成
└── remote/
    ├── dsh-bundle.json
    └── builds/<buildId>/
        ├── cordis.patch.yml
        ├── node/remoteEntry.js
        └── web/remoteEntry.js   # 存在 src/client/index.ts 时生成
```

通过 DSH 的普通插件流程安装 `dist/`，例如：

```sh
dsh plugin --profile demo add ./dist
```

DSH 支持远程 Bundle 后，可以订阅稳定的 manifest URL：

```sh
dsh plugin --profile demo add my-dsh-bundle@https://plugins.example.com/my-dsh-bundle/dsh-bundle.json
```

`dsh-bundle.json` 指向一个不可变的 `builds/<buildId>/` 版本。DSH 会在进程启动时解析这个稳定 manifest。

开发阶段可以在本地提供 remote 产物：

```sh
pnpm dsh-bundle serve --port 4173
```

package 浏览器构建只允许生成一个 `client.js`，并拒绝动态导入。remote 浏览器构建可以在不可变构建目录中包含 chunks。

## 示例

[`examples/basic`](./examples/basic) 是一个同时包含 Node 和 Web 入口的完整 Bundle。仓库的 `pnpm check` 会构建这个示例，确保它始终与 Builder 保持一致：

```sh
pnpm example:build
```

## 可选配置

只配置不符合默认约定的路径：

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

`modules` 把 patch 插入的模块名映射到源码入口。Bundle 自身的包名会自动映射到 `src/index.ts`，已安装的依赖包名则通过 Node 解析。默认 `target` 是 `dual`，`buildId` 默认是新的 UUID。

命令行路径会覆盖 `package.json`：

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

## Remote 限制

- 运行时类型和 module augmentation 来自 package 产物，而不是 remote URL。
- remote Bundle 可以发布自己的 `src/client/index.ts`；remote target 会拒绝声明了自身 DSH Web 插件的依赖包。
- `dsh-bundle serve` 用于本地开发。

## 开发 Builder

```sh
pnpm install
pnpm check
```

`pnpm check` 会依次运行 lint、严格类型检查、package 与 remote 构建的 Rstest 覆盖率、Rslib 包构建、构建后 CLI 测试、basic dual 示例和 `publint`。

Changesets 与可信发布流程见[发布说明](./docs/releasing.md)。

## License

[MIT](./LICENSE)
