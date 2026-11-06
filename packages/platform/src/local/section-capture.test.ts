import { expect, it } from 'vitest'
import { createChromiumScreenshotter, type ScreenshotBrowser } from './index.ts'
it('captures only the section bounds offline with scripting disabled', async () => {
  let options: unknown,
    selected = '',
    pageCapture = false,
    closed = false
  const browser: ScreenshotBrowser = {
    async newContext(input) {
      options = input
      return {
        async newPage() {
          return {
            async setContent() {},
            locator(selector) {
              selected = selector
              return {
                async boundingBox() {
                  return { width: 1280, height: 326 }
                },
                async screenshot() {
                  return new Uint8Array([1, 2, 3])
                },
              }
            },
            async screenshot() {
              pageCapture = true
              return new Uint8Array([4])
            },
          }
        },
        async close() {
          closed = true
        },
      }
    },
    async close() {},
  }
  const screenshotter = createChromiumScreenshotter({ launch: async () => browser })
  const capture = await screenshotter.capture({
    html: '<div id="s0">A section</div>',
    viewport: { width: 1280, height: 800, cropToSection: true },
  })
  expect(options).toMatchObject({ offline: true, javaScriptEnabled: false })
  expect(selected).toBe('#s0')
  expect(pageCapture).toBe(false)
  expect(closed).toBe(true)
  expect(capture).toMatchObject({ width: 1280, height: 326, fidelity: 'rendered' })
  await screenshotter.close()
})
