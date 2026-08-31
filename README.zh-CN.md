# DSH Bundle Builder

[English](./README.md) | 中文

`dsh-bundle-builder` 是用于构建可安装 DSH Bundle 包的工具。它负责校验 Bundle 元数据与 Cordis patch，编译 Node 入口和可选的 Web 入口，生成 TypeScript 类型声明与包元数据，并将完整包产物写入 `dist/`。

## 为什么需要 Builder

DSH Bundle 同时包含可执行的插件代码、Cordis patch 和 DSH 包声明。DSH 安装并运行 Bundle 之前，这些内容的入口、exports、依赖信息和 Web 加载方式必须保持一致。Builder 会统一校验并构建这些输入，并在构建阶段报告无效的组合关系。

## 安装

```sh
pnpm add -D dsh-bundle-builder typescript
```

要求 Node.js `^22.19.0` 或 `>=24.0.0`。

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
    "dsh-bundle-builder": "^0.1.0",
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
```

构建会用完整的包产物替换 `dist/`：

```text
dist/
├── package.json
├── cordis.patch.yml
├── index.js
├── index.d.ts
├── client.js       # 存在 src/client/index.ts 时生成
├── client.js.map
├── client.d.ts
└── assets/         # 浏览器入口导入资源时生成
```

通过 DSH 的普通插件流程安装 `dist/`，例如：

```sh
dsh plugin --profile demo add ./dist
```

浏览器构建只允许生成一个 `client.js`。普通 DSH 包格式只有一个客户端入口，因此 Builder 会拒绝浏览器动态导入和代码分割。

## 可选配置

只配置不符合默认约定的路径：

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

`modules` 把 patch 插入的模块名映射到源码入口。Bundle 自身的包名会自动映射到 `src/index.ts`，已安装的依赖包名则通过 Node 解析。

命令行路径会覆盖 `package.json`：

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

## 开发 Builder

```sh
pnpm install
pnpm check
```

`pnpm check` 会依次运行 lint、严格类型检查、Rstest 覆盖率、Rslib 包构建、构建后 CLI 测试和 `publint`。

Changesets 与可信发布流程见[发布说明](./docs/releasing.md)。

## License

[MIT](./LICENSE)
