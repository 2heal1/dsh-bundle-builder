import type { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context): void {
  ctx.logger('example-dsh-bundle:client').info('Example DSH Web plugin loaded')
}
