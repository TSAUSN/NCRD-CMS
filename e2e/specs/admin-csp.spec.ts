import { expect, test } from '@playwright/test'
import { Client } from 'pg'
import { e2eTarget } from '../test-target.ts'
import { canvas, signIn } from './helpers.ts'

async function demoHome(): Promise<string> {
  const { database, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await client.connect()
  try {
    return (
      await client.query(
        "SELECT p.id FROM pages p JOIN sites s ON s.id=p.site_id WHERE s.slug='demo' AND p.slug='' AND p.archived_at IS NULL",
      )
    ).rows[0]!.id
  } finally {
    await client.end()
  }
}

// AUTH-05: the admin's own pages run only scripts carrying the request's nonce,
// and the editor still works under that policy; previews keep their own policy.
test('admin pages carry a nonce policy without a single violation, and the canvas preview keeps its own', async ({
  page,
}) => {
  const violations: string[] = []
  page.on('console', message => {
    if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text().slice(0, 200))
  })
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', event =>
      console.error(
        `Refused to: ${event.violatedDirective} ${event.blockedURI} at ${event.sourceFile}:${event.lineNumber}:${event.columnNumber} ${event.sample}`,
      ),
    ),
  )
  const signInResponse = await page.goto('/sign-in')
  expect(signInResponse!.headers()['content-security-policy']).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  )
  await signIn(page, 'root@example.test')

  const dashboard = await page.goto('/')
  const policy = dashboard!.headers()['content-security-policy']!
  const nonce = /'nonce-([^']+)'/.exec(policy)![1]!
  // Next.js put the same nonce on its own scripts.
  expect(
    await page
      .locator('script[src]')
      .evaluateAll((scripts, value) => scripts.every(script => (script as HTMLScriptElement).nonce === value), nonce),
  ).toBe(true)
  // A different request gets a different nonce.
  const again = await page.request.get('/')
  expect(again.headers()['content-security-policy']).not.toContain(nonce)

  // The editor, with its canvas preview, works under the policy; the canvas keeps its own single policy.
  const previewResponse = page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/preview/'))
  await page.goto(`/pages/${await demoHome()}`)
  await expect(canvas(page).locator('[data-cms-section]').first()).toBeVisible()
  const preview = await previewResponse
  expect(preview.status()).toBe(200)
  const previewPolicies = (await preview.headersArray()).filter(
    header => header.name.toLowerCase() === 'content-security-policy',
  )
  expect(previewPolicies).toHaveLength(1)
  expect(previewPolicies[0]!.value).not.toContain('nonce-')
  expect(violations).toEqual([])
  // Neither app uses next/image, so the optimizer endpoint behind Next.js advisories answers nothing.
  const optimizer = await page.request.get('/_next/image?url=%2Ffavicon.ico&w=64&q=75')
  expect(optimizer.status()).not.toBe(200)
})
