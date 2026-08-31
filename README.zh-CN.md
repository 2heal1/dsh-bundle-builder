# DSH Bundle Builder

[English](./README.md) | 中文

`dsh-bundle-builder` 用于校验和构建普通、可安装的 DSH Bundle 包。它默认采用 DSH Bundle 的约定目录，多数项目不需要编写 Builder 配置。

## 安装

```sh
pnpm add -D dsh-bundle-builder typescript
```

要求 Node.js `^22.19.0` 或 `>=24.0.0`。

## 快速开始

创建以下目录：

```text
my-bundle/
├── package.json
├── cordis.patch.yml
└── src/
    ├── index.ts
    └── client/index.ts   # 可选的 DSH Web 插件
```

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

## License

[MIT](./LICENSE)
