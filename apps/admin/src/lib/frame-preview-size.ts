import { PREVIEW_MESSAGE } from '@cms/renderer/preview-messages'
export function framePreviewHeight(
  message: unknown,
  channel: string,
  part: 'header' | 'footer' = 'footer',
): number | null {
  if (!message || typeof message !== 'object') return null
  const value = message as Record<string, unknown>
  return value.type === PREVIEW_MESSAGE.frameSize &&
    value.channel === channel &&
    value.part === part &&
    typeof value.height === 'number' &&
    Number.isInteger(value.height) &&
    value.height > 0 &&
    value.height <= 4096
    ? value.height
    : null
}
