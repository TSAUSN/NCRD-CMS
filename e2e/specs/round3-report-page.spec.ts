import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn, canvas } from './helpers.ts'
import { annualReportTemplate } from '../../packages/seeds/src/report-template.ts'
import { NATIONAL_TEMPLATE_THEME } from '../../packages/seeds/src/core-themes.ts'
test('a complete shared report keeps native editing and private changes with phone disclosures without scripts', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    context = await browser.newContext({ javaScriptEnabled: false }),
    view = await context.newPage(),
    folder = resolve('../.r8-progress/round3/report-page/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    await c.query('BEGIN')
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const definitions = (
      await c.query(
        "SELECT d.id,d.slug,d.name,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.scope='global'",
      )
    ).rows
    const theme = (await c.query('SELECT revision FROM themes WHERE site_id=$1', [f.site])).rows[0]!,
      themeRevision = (
        await c.query('SELECT * FROM app.save_theme_draft($1,$2,$3)', [
          f.site,
          theme.revision,
          JSON.stringify(NATIONAL_TEMPLATE_THEME),
        ])
      ).rows[0]!.revision
    await c.query('SELECT app.publish_theme($1,$2)', [f.site, themeRevision])
    const before = (
      await c.query(
        'SELECT p.revision,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [f.pages[0]],
      )
    ).rows[0]!
    const content = annualReportTemplate(definitions, [
      {
        part: 'cover',
        band: 'cover',
        values: {
          heading: '[Year]',
          subheading: '[Annual report]',
          kicker: '[Office]',
          caption: '<p>[Cover caption]</p>',
          primary: { label: 'Read the report', url: '#numbers' },
          secondary: { label: 'Download PDF', url: 'https://example.test/report.pdf' },
        },
      },
      { part: 'links', band: 'links', values: { mobile_label: 'Explore this report' } },
      {
        part: 'mission',
        band: 'mission',
        values: {
          heading: '[Mission]',
          body: '<p>[Approved mission]</p>',
          report_page: { url: '#numbers', label: 'See the numbers' },
        },
      },
      {
        part: 'vision',
        band: 'vision',
        values: {
          cards: { items: ['i1', 'i2'] },
          cards__i1__title: '[Vision]',
          cards__i1__body: '<ul><li>[Priority]</li></ul>',
          cards__i2__title: '[Sectors]',
          cards__i2__body: '<ol><li>[Sector]</li></ol>',
        },
      },
      {
        part: 'metrics',
        band: 'metrics',
        values: {
          intro: '<p>[Reviewed impact]</p>',
          photo: { src: '/cms-samples/r8-landscape.png', alt: '[Sample impact photo]', decorative: false },
          photo_note: '[Photo credit]',
          stats: { items: ['i1'] },
          stats__i1__value: '123',
          stats__i1__label: '[Projects]',
          __cms_anchor: 'numbers',
          page_link_label: 'Numbers',
        },
      },
      {
        part: 'letters',
        band: 'letters',
        values: {
          heading: '[Messages]',
          letters: { items: ['i1', 'i2'] },
          letters__i2__name: '[Second report leader]',
          letters__i2__role: '[Second role]',
          letters__i2__intro: '[Second introduction]',
          letters__i2__message: '<p>[Second complete message]</p>',
          letters__i2__open_label: 'Read the full message',
          letters__i2__photo: { src: '/cms-samples/r8-square.png', alt: '[Second sample portrait]', decorative: false },
          letters__i1__name: '[Report leader]',
          letters__i1__role: '[Role]',
          letters__i1__intro: '<p>[Introduction]</p>',
          letters__i1__message: '<p>[Complete message]</p>',
          letters__i1__open_label: 'Read the full message',
          letters__i1__photo: {
            src: '/cms-samples/r8-square.png',
            alt: '[Sample portrait]',
            decorative: false,
            focal: { x: 0.5, y: 0.5 },
          },
        },
      },
      {
        part: 'country',
        band: 'disaster',
        values: {
          layout: 'response',
          heading: '[Response]',
          country: '[Country]',
          title: '[Response story]',
          body: '<p>[Approved response paragraph]</p>',
          photo_note: '<p>[Caption]</p><blockquote><p>[Quoted words]</p></blockquote>',
          photo: { src: '/cms-samples/r8-landscape.png', alt: '[Sample photo]', decorative: false },
          stats: { items: ['i1', 'i2'] },
          stats__i1__value: '10',
          stats__i1__after: '[First stat]',
          stats__i2__value: '20',
          stats__i2__after: '[Second stat]',
          action_heading: '[Discover]',
          action_text: '<p>[Read the local sample story]</p>',
          action: { label: 'Watch the impact story', url: 'https://example.test/impact' },
        },
      },
      {
        part: 'country',
        band: 'disaster',
        values: {
          layout: 'reading',
          country: '[Country]',
          title: '[Reading story]',
          body: '<p>[Reading words]</p>',
          photo: { src: '/cms-samples/r8-landscape.png', alt: '[Sample reading photo]', decorative: false },
          stats: { items: ['i1'] },
          stats__i1__value: '30',
          stats__i1__after: '[Reading stat]',
        },
      },
      {
        part: 'country',
        band: 'business',
        values: {
          layout: 'reading',
          country: '[Program country]',
          title: '[Program reading]',
          body: '<p>[Program words]</p>',
          stats: { items: ['i1'] },
          stats__i1__value: '40',
          stats__i1__after: '[Program stat]',
        },
      },
      {
        part: 'country',
        band: 'education',
        values: {
          layout: 'feature',
          country: '[Feature country]',
          title: '[Feature story]',
          body: '<p>[Feature words]</p>',
          photo: { src: '/cms-samples/r8-landscape.png', alt: '[Feature photo]', decorative: false },
        },
      },
      {
        part: 'country',
        band: 'trafficking',
        values: {
          layout: 'text',
          title: '[Brief heading]',
          body: '<p>[Brief words]</p>',
          stats_heading: '[Brief numbers]',
          stats: { items: ['i1'] },
          stats__i1__value: '12',
          stats__i1__after: '[Brief stat]',
        },
      },
      {
        part: 'fact',
        band: 'trafficking',
        values: {
          layout: 'text',
          title: '[Fact heading]',
          stats: { items: ['i1'] },
          stats__i1__before: '[Fact before]',
          stats__i1__value: '12',
          stats__i1__after: '[Fact after]',
        },
      },
      {
        part: 'give',
        band: 'give',
        values: {
          heading: '[Giving]',
          cards: { items: ['i1', 'i2'] },
          cards__i1__title: '[Online]',
          cards__i1__action: { label: 'Give now', url: 'https://example.test/give' },
          cards__i2__title: '[Phone]',
          cards__i2__action: { url: '', label: '' },
          cards__i2__body: '<p><a href="tel:18001234567">Call us</a></p>',
          extra: '<h3>[Other ways]</h3><ul><li>[First way]</li><li>[Second way]</li></ul>',
          questions: '<p>[Questions]</p>',
          small: '<p>[Report legal text]</p><p>[Second legal paragraph]</p>',
        },
      },
      {
        part: 'directory',
        band: 'directory',
        values: {
          heading: '[Directory]',
          source: '[Directory source]',
          questions: { items: ['i1'] },
          questions__i1__question: '[Board]',
          questions__i1__count: '1',
          questions__i1__open_label: 'View members',
          questions__i1__answer: '<p>[Member — sample]</p>',
          __cms_anchor: 'directory',
        },
      },
      { part: 'closing', band: 'closing', values: { heading: '[Thank you]' } },
    ])
    await c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      f.pages[0],
      before.revision,
      JSON.stringify(content),
      JSON.stringify(before.meta),
    ])
    await c.query("SELECT app.publish_page($1,$2,3,NULL,'[]')", [f.pages[0], Number(before.revision) + 1])
    await c.query('COMMIT')
    const published = (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!
      .published_version_id
    for (const width of [1440, 1024, 390]) {
      await view.setViewportSize({ width, height: 1000 })
      await view.goto('http://' + f.host + `:${E2E_PORTS.site}/`, { timeout: 90000 })
      await expect(view.locator('#cms-main.cms-report-page')).toBeVisible()
      await expect(view.locator('.cms-report-part--cover h1')).toHaveCSS('font-size', width > 760 ? '54px' : '43px')
      const impactPhoto = view.locator('.cms-report-part--metrics .core-stats-photo img')
      await expect(impactPhoto).toHaveCSS('width', width > 760 ? '180px' : '92px')
      await expect(impactPhoto).toHaveCSS('height', width > 760 ? '112px' : '106px')
      await expect(view.locator('.cms-report-part--metrics .core-stats-intro-copy p')).toHaveCSS(
        'font-size',
        width > 760 ? '18px' : '14px',
      )
      await expect(view.locator('.cms-report-part--mission .core-text-image-body p').first()).toHaveCSS(
        'font-size',
        width > 760 ? '17px' : '16px',
      )
      await expect(view.locator('.cms-report-part--directory summary')).toHaveCSS('display', 'flex')
      await expect(view.locator('.cms-report-part--directory .core-faq-count')).toHaveCSS('width', '30px')
      await expect(view.locator('.cms-report-part--directory .core-faq-open')).toHaveCSS('color', 'rgb(237, 28, 43)')
      await expect(view.getByRole('heading', { name: '[Brief heading]', exact: true })).toHaveCSS('font-size', '21px')
      await expect(view.locator('.ar-brief')).toHaveCount(1)
      await expect(view.getByRole('heading', { name: '[Fact heading]', exact: true })).toHaveCSS('font-size', '16px')
      const factHeading = await view.getByRole('heading', { name: '[Fact heading]', exact: true }).boundingBox()
      const factStats = await view.locator('.cms-report-part--fact .ar-stat-grid').boundingBox()
      expect(factStats!.y - factHeading!.y - factHeading!.height).toBeCloseTo(12, 1)
      expect(
        await view
          .locator('.ar-reading-copy > .ar-eyebrow')
          .first()
          .evaluate(node => parseFloat(getComputedStyle(node).lineHeight)),
      ).toBeCloseTo(15.4, 3)
      await expect(view.getByRole('heading', { name: '[Brief numbers]', exact: true })).toHaveCSS('font-size', '18px')
      await expect(view.locator('.ar-photo-note blockquote')).toHaveCSS('border-left-width', '3px')
      await expect(view.getByText('[Quoted words]', { exact: true })).toHaveCSS('font-size', '19px')
      expect(
        await view
          .getByText('[Feature words]', { exact: true })
          .evaluate(node => parseFloat(getComputedStyle(node).lineHeight)),
      ).toBeCloseTo(width > 760 ? 29.24 : 27.2, 3)
      const givingSection = view.locator('.cms-report-part--give')
      await expect(givingSection.locator('.national-contact-photo')).toBeHidden()
      await expect(givingSection.locator('.national-actions a').filter({ hasText: /^$/ })).toBeHidden()
      await expect(givingSection.locator('.national-contact-extra li').nth(1)).toHaveCSS('margin-top', '15px')
      await expect(givingSection.locator('.national-contact-small')).toHaveCSS('border-top-width', '1px')
      await expect(givingSection.locator('.national-contact-small p').first()).toHaveCSS('line-height', '16.5px')
      await expect(givingSection.locator('.national-contact-small p').nth(1)).toHaveCSS('margin-top', '20px')
      await expect(givingSection.locator('.national-contact-questions')).toHaveCSS(
        'margin-top',
        width > 760 ? '20px' : '50px',
      )
      await expect(givingSection.locator('.national-contacts > .national-tile').nth(1).locator('h3')).toHaveCSS(
        'margin-bottom',
        '24px',
      )
      const givingLayout = await givingSection.locator('.national-contact-layout').boundingBox()
      const givingCopy = await givingSection.locator('.national-contact-copy').boundingBox()
      expect(givingCopy!.width).toBeCloseTo(givingLayout!.width, 1)
      const giving = view.getByRole('link', { name: 'Give now', exact: true })
      await expect(giving).toHaveCSS('color', 'rgb(255, 255, 255)')
      await expect(giving).toHaveCSS('text-decoration-line', 'none')
      await expect(giving).toHaveCSS('background-color', 'rgb(237, 28, 43)')
      expect((await giving.boundingBox())!.width).toBeLessThan(givingCopy!.width / 2)
      await expect(view.getByRole('link', { name: 'Call us', exact: true })).toHaveCSS(
        'text-decoration-line',
        'underline',
      )
      const pdf = view.getByRole('link', { name: /^Download PDF/ }),
        impact = view.getByRole('link', { name: /^Watch the impact story/ })
      await expect(pdf).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      await expect(pdf).toHaveCSS('color', 'rgb(52, 70, 95)')
      await expect(impact).toHaveCSS('color', 'rgb(255, 255, 255)')
      await expect(impact).toHaveCSS('text-decoration-line', 'none')
      expect(
        await view
          .locator('.cms-report-part--directory .core-faq-open')
          .evaluate(node => getComputedStyle(node, '::after').content),
      ).toContain('＋')
      expect(
        await view
          .locator('.cms-report-part--mission .core-report-page a')
          .evaluate(node => getComputedStyle(node, '::after').content),
      ).toContain('↓')
      await expect(view.getByRole('heading', { name: '[Year] [Annual report]' })).toBeVisible()
      await expect(view.getByText('[Directory source]', { exact: true })).toBeVisible()
      await expect(view.getByText('[Member — sample]', { exact: true })).toBeHidden()
      await view.getByText('[Board]', { exact: true }).click()
      await expect(view.getByText('[Member — sample]', { exact: true })).toBeVisible()
      if (width === 390) await view.getByText('Explore this report', { exact: true }).click()
      await expect(
        view
          .getByRole('navigation', { name: width === 390 ? 'On this page on phones' : 'On this page', exact: true })
          .getByRole('link', { name: 'Numbers', exact: true }),
      ).toHaveAttribute('href', '#numbers')
      const response = view.locator('[data-report-layout=response]')
      const captionContrast = await response.locator('.ar-eyebrow').evaluate(node => {
        const luminance = (colour: string) => {
          const channels = colour
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map(value => value / 255)
            .map(value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
          return channels.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
        }
        let current: Element | null = node,
          paper = 'rgb(255, 255, 255)'
        while (current) {
          const colour = getComputedStyle(current).backgroundColor
          if (colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') {
            paper = colour
            break
          }
          current = current.parentElement
        }
        const ink = luminance(getComputedStyle(node).color),
          background = luminance(paper)
        return (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05)
      })
      expect(captionContrast, 'Country caption against the actual report band').toBeGreaterThanOrEqual(4.5)
      const heading = await response.locator('.ar-response-top>div').boundingBox(),
        photo = await response.locator('.ar-response-top>figure').boundingBox()
      expect(heading).not.toBeNull()
      expect(photo).not.toBeNull()
      if (width > 760) expect(heading!.x + heading!.width).toBeLessThanOrEqual(photo!.x)
      else expect(heading!.y + heading!.height).toBeLessThanOrEqual(photo!.y)
      for (const portrait of await view.locator('.ar-leader-photo img').all())
        await expect(portrait).toHaveCSS('object-position', '50% 100%')
      await expect(view.locator('.ar-reading-story')).toHaveCount(2)
      await expect(view.locator('.ar-secondary-story .ar-reading-head')).toContainText('[Program reading]')
      await expect(view.locator('.ar-reading-story').first().locator('.ar-reading-copy')).toContainText(
        '[Reading story]',
      )
      const closing = view.locator('.cms-report-part--closing .ar-closing')
      await expect(closing).toHaveCSS('min-height', width > 760 ? '250px' : '210px')
      const quote = await closing.getByRole('heading', { name: '[Thank you]', exact: true }).boundingBox(),
        container = await closing.locator('.ar-container').boundingBox()
      expect(Math.abs(quote!.width - Math.min(500, container!.width))).toBeLessThan(1)
      const letters = view.locator('.ar-letters')
      const letterColumns = await letters.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)
      expect(letterColumns).toBe(width > 1000 ? 2 : 1)
      const feature = view.locator('.ar-report-feature')
      const photoColumn = await feature.locator('figure').boundingBox()
      if (width > 1000) expect(photoColumn!.width).toBeCloseTo(320, 1)
      else expect(photoColumn!.width).toBeCloseTo(width - 44, 1)
      await expect(view.locator('.cms-report-band--metrics')).toHaveCSS('padding-top', width > 760 ? '48px' : '36px')
      await expect(view.locator('.cms-report-part--mission .row>div').last()).toHaveCSS('margin-top', '0px')
      await expect(view.locator('.cms-report-part--cover img')).toHaveCount(0)
      await expect(view.locator('.cms-report-part--mission img')).toHaveCount(0)
      const missionContainer = await view.locator('.cms-report-part--mission .core>.container').boundingBox()
      const missionCopy = await view.locator('.cms-report-part--mission .row>div').last().boundingBox()
      expect(missionCopy!.width).toBeCloseTo(missionContainer!.width, 1)

      await expect(view.locator('.core-report-actions a').first()).toHaveCSS('min-height', '42px')
      const closingHeading = await view.locator('.cms-report-part--closing h2').boundingBox()
      expect(closingHeading!.x).toBeCloseTo(width > 760 ? Math.max(28, (width - 1120) / 2) : 22, 1)
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await view.screenshot({ path: resolve(folder, 'report-' + width + '.png'), fullPage: true })
    }
    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + f.pages[0] + '?section=0', { timeout: 90000 })
    await expect(canvas(page).locator('.cms-report-part--cover h1')).toHaveCSS('font-size', '54px')
    const structure = page.getByRole('complementary', { name: 'Page structure', exact: true })
    await expect(
      structure.getByRole('button', { name: 'Country story — [Program country]', exact: true }),
    ).toBeVisible()
    await expect(structure.getByRole('button', { name: 'Country story with stats', exact: true })).toHaveCount(0)
    await expect(canvas(page).getByRole('link', { name: /^Download PDF/ })).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    )
    await expect(canvas(page).getByRole('link', { name: /^Download PDF/ })).toHaveCSS('color', 'rgb(52, 70, 95)')
    await canvas(page).locator('[data-cms-section="0"] cms-slot[data-cms-slot="subheading"]').click()
    await page.locator('.inspector').getByLabel('Second heading line', { exact: true }).fill('[Updated report]')
    await expect(canvas(page).getByRole('heading', { name: '[Year] [Updated report]' })).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: resolve(folder, 'edit-' + width + '.png') })
    }
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    expect(
      (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!.published_version_id,
    ).toBe(published)

    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const head = (await c.query('SELECT revision FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!,
      copy = (await c.query('SELECT * FROM app.duplicate_page($1,$2)', [f.pages[0], head.revision])).rows[0]!
    await c.query('COMMIT')
    const copied = (
      await c.query(
        'SELECT p.published_version_id,p.status,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [copy.page_id],
      )
    ).rows[0]!
    expect(copied.published_version_id).toBeNull()
    expect(copied.status).toBe('draft')
    expect(copied.content[0].values.__cms_report_template).toBe('annual')
    await page.goto('/pages/' + copy.page_id, { timeout: 90000 })
    await expect(canvas(page).getByRole('heading', { name: '[Year] [Updated report]' })).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: resolve(folder, 'private-copy-1440.png') })

    // Insertion is an administrator action; the writer's content-only access stays unchanged.
    await page.context().clearCookies()
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + copy.page_id + '?section=0')
    await expect(canvas(page).locator('#cms-main.cms-report-page')).toBeVisible()
    await page.getByRole('button', { name: 'More section actions', exact: true }).click()
    await page.getByRole('button', { name: 'Add above', exact: true }).click()
    const library = page.getByRole('dialog', { name: 'Add a section', exact: true })
    await library.getByLabel('Search sections', { exact: true }).fill('Text block')
    await library
      .getByTestId('library-card-core-text-block')
      .getByRole('button', { name: /^Add Text block / })
      .click()
    await expect(library.getByRole('button', { name: 'Add this section', exact: true })).toBeEnabled()
    await expect(canvas(page).locator('#cms-main.cms-report-page')).toBeVisible()
    await expect(canvas(page).locator('[data-cms-section="1"] h1')).toHaveCSS('font-size', '54px')
    await library.getByRole('button', { name: 'Add this section', exact: true }).click()
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.locator('.saved-state')).toContainText('All changes saved')
    await expect(canvas(page).locator('#cms-main.cms-report-page')).toBeVisible()
    await expect(canvas(page).locator('[data-cms-section="0"][class*="core-text-block"]')).toBeVisible()
    expect(
      (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [copy.page_id])).rows[0]!
        .published_version_id,
    ).toBeNull()
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await context.close()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
