import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { renderPage, nationalNavigationScriptHash, type SiteShell } from '@cms/renderer'
import { compileSeedSection } from '@cms/seeds'
import { NATIONAL_HEADER } from '@cms/seeds/national-library'
import { SAWSO_THEME } from '@cms/seeds/core-themes'
function example() {
  const compiled = compileSeedSection(NATIONAL_HEADER),
    values = {
      logo: { src: '/cms-themes/sawso/salvation-army-shield.svg', alt: 'The Salvation Army', decorative: false },
      name: 'World Service Office',
      tagline: 'Hope in Every Language',
      donate: { url: 'https://give.sawso.org/?form=main', label: 'Support this work', trackingCode: 'utm_source=site' },
      secondary: { url: '/help', label: 'Find help' },
    }
  const shell: SiteShell = {
    site: { id: 'site', name: '[Site]', slug: 'sawso' },
    theme: SAWSO_THEME,
    canonical_host: null,
    staging_host: 'demo.staging.localhost',
    navigation: [
      {
        label: 'Get involved',
        visible: true,
        target: { type: 'url', url: '/' },
        dropdownGroup: true,
        children: [{ label: 'Visit', visible: true, target: { type: 'url', url: '/visit' } }],
      },
      ...['Learn more', 'Our team', 'Resources', 'Reports', 'Contact'].map(label => ({
        label,
        visible: true,
        target: { type: 'url' as const, url: '/visit' },
      })),
    ],
    header: {
      schemaVersion: 2,
      enabled: true,
      sticky: true,
      component: { section_def_id: '77777777-7777-4777-8777-777777777777', section_def_version: 1, values },
    },
    header_component: {
      section_def_id: '77777777-7777-4777-8777-777777777777',
      version: 1,
      slug: NATIONAL_HEADER.slug,
      compiled_ast: compiled.compiledAst,
      css: compiled.compiledCss,
      slots: compiled.slots,
      css_policy_version: compiled.compiledAst.cssPolicyVersion,
    },
  }
  return renderPage({
    shell,
    manifest: { page: { id: 'page', version_id: 'version', title: '[Page]', path: '/' }, meta: {}, sections: [] },
    isStaging: true,
  }).html
}
test('national logo, tracked buttons and dropdown groups remain usable without JavaScript', async ({
  browser,
}, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false }),
    page = await context.newPage(),
    html = example(),
    url = `http://demo.staging.localhost:${E2E_PORTS.site}/frame-specimen`,
    folder = resolve('../.r8-progress/round3/header-foundation', info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    await page.route(url, route => route.fulfill({ status: 200, contentType: 'text/html', body: html }))
    await page.goto(url)
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.locator('header img[alt="The Salvation Army"]')).toBeVisible()
      const menu = page.getByRole('navigation', { name: 'Phone menu', exact: true })
      if ((await page.locator('.national-phone-menu').getAttribute('open')) === null)
        await page.locator('.national-phone-menu>summary').click()
      const group = menu.locator('summary').filter({ hasText: 'Get involved' })
      await group.focus()
      await page.keyboard.press('Enter')
      await expect(menu.getByRole('link', { name: 'Visit', exact: true })).toBeVisible()
      await expect(menu.getByRole('link', { name: 'Get involved', exact: true })).toHaveCount(0)
      if (width >= 992) {
        await expect(
          page.locator('header').getByRole('link', { name: 'Support this work', exact: true }),
        ).toHaveAttribute('href', 'https://give.sawso.org/?form=main&utm_source=site')
        await expect(page.locator('header').getByRole('link', { name: 'Find help', exact: true })).toHaveAttribute(
          'href',
          '/help',
        )
      }
      if (width === 1024) {
        const action = await page
            .locator('header')
            .getByRole('link', { name: 'Support this work', exact: true })
            .boundingBox(),
          toggle = await page.locator('.national-phone-menu>summary').boundingBox()
        expect(action!.x).toBeGreaterThan(width / 2)
        expect(toggle!.x - action!.x - action!.width).toBeGreaterThan(0)
        expect(toggle!.x - action!.x - action!.width).toBeLessThan(40)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, 'group-' + width + '.png') })
      await group.press('Enter')
    }
  } finally {
    await context.close()
  }
})

test('the existing Menu follows rendered label width and returns to the desktop links when they fit', async ({
  page,
}, info) => {
  const folder = resolve('../.r8-progress/round3/header-fit', info.project.name),
    url = `http://demo.staging.localhost:${E2E_PORTS.site}/frame-fit`,
    html = example()
  await mkdir(folder, { recursive: true })
  await page.route(url, route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: {
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; script-src '" +
          nationalNavigationScriptHash() +
          "'",
      },
      body: html,
    }),
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(url)
  const header = page.locator('.cms-frame--header'),
    nav = page.locator('.national-desktop-nav'),
    toggle = page.locator('.national-phone-menu>summary')
  await expect(header).toHaveAttribute('data-cms-nav-measured', '')
  await nav
    .locator(':scope>.cms-nav-list>.cms-nav-item')
    .last()
    .evaluate(n => {
      n.querySelector('a')!.textContent = 'Ways We Help in Communities Around the World'
    })
  await expect(header).toHaveAttribute('data-cms-nav-fit', 'compact')
  await expect(toggle).toBeVisible()
  await expect(nav).toBeHidden()
  await page.screenshot({ path: resolve(folder, 'crowded-1440.png') })
  await toggle.click()
  const phone = page.getByRole('navigation', { name: 'Phone menu', exact: true }),
    group = phone.locator('summary').filter({ hasText: 'Get involved' })
  await group.click()
  await expect(phone.getByRole('link', { name: 'Visit', exact: true })).toBeVisible()
  const ink = await phone
    .getByRole('link', { name: 'Learn more', exact: true })
    .evaluate(n => getComputedStyle(n).color)
  expect(await group.evaluate(n => getComputedStyle(n).color)).toBe(ink)
  expect(await group.evaluate(n => getComputedStyle(n, '::after').content)).toBe('""')
  expect(await group.evaluate(n => getComputedStyle(n, '::after').borderBottomWidth)).toBe('2px')
  await page.screenshot({ path: resolve(folder, 'group-1440.png') })
  await toggle.click()
  await nav.locator(':scope>.cms-nav-list>.cms-nav-item').evaluateAll(nodes => nodes.slice(3).forEach(n => n.remove()))
  await expect(header).toHaveAttribute('data-cms-nav-fit', 'wide')
  await expect(toggle).toBeHidden()
  await expect(nav).toBeVisible()
  const desktopGroup = nav.locator('summary').filter({ hasText: 'Get involved' })
  await desktopGroup.hover()
  await expect(nav.getByRole('link', { name: 'Visit', exact: true })).toBeVisible()
  expect(
    await nav
      .locator(':scope>.cms-nav-list>.cms-nav-item>:is(a,details>summary)')
      .evaluateAll(nodes => nodes.every(n => getComputedStyle(n).whiteSpace === 'nowrap')),
  ).toBe(true)
  await page.screenshot({ path: resolve(folder, 'fits-1440.png') })
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(toggle).toBeVisible()
    await expect(nav).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(folder, 'compact-' + width + '.png') })
  }
})
