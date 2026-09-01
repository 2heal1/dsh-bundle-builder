import type { Context } from '@deepseek-ai/cordis'

export interface Config {
  message?: string
}

export function apply(ctx: Context, config: Config): void {
  ctx.logger('example-dsh-bundle').info(config.message ?? 'Example DSH Bundle loaded')
}
