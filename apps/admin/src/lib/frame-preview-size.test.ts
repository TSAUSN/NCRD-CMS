import { it, expect, vi } from 'vitest'
import { PREVIEW_MESSAGE } from '@cms/renderer/preview-messages'
import { framePreviewHeight } from './frame-preview-size.ts'
import { reportFramePreviewSize } from '../app/pages/[pageId]/report-frame-preview-size.ts'
it('accepts only a bounded height for the expected frame and ticket channel', () => {
  const message = { type: PREVIEW_MESSAGE.frameSize, channel: 'current', part: 'footer', height: 613 }
  expect(framePreviewHeight(message, 'current')).toBe(613)
  expect(framePreviewHeight({ ...message, part: 'header' }, 'current', 'header')).toBe(613)
  for (const changed of [
    { channel: 'old' },
    { part: 'header' },
    { type: 'other' },
    { height: 0 },
    { height: Infinity },
    { height: 4097 },
    { height: 613.2 },
  ])
    expect(framePreviewHeight({ ...message, ...changed }, 'current')).toBeNull()
})
it('reports only dimensions to the exact configured parent origin', () => {
  const postMessage = vi.fn(),
    footer = { scrollHeight: 613, getBoundingClientRect: () => ({ height: 612.4 }) },
    attributes: Record<string, string> = {
      'data-cms-parent-origin': 'http://127.0.0.1:3200',
      'data-cms-channel': 'current',
    },
    doc = { documentElement: { getAttribute: (name: string) => attributes[name] }, querySelector: () => footer },
    view = { parent: { postMessage } }
  reportFramePreviewSize(doc as unknown as Document, view as unknown as Window)
  expect(postMessage).toHaveBeenCalledWith(
    { type: PREVIEW_MESSAGE.frameSize, channel: 'current', part: 'footer', height: 613 },
    'http://127.0.0.1:3200',
  )
  postMessage.mockClear()
  attributes['data-cms-parent-origin'] = 'https://example.test/unsafe-path'
  reportFramePreviewSize(doc as unknown as Document, view as unknown as Window)
  expect(postMessage).not.toHaveBeenCalled()
})
