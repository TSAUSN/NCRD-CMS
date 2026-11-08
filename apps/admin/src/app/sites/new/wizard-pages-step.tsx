import type { Dispatch, SetStateAction } from 'react'
import type { SiteSetup } from '@cms/schema'
import { SITE_SETUP_FOOTER_PAGES, type SiteSetupPage } from '@cms/schema'
import { CORE_PAGE_TEMPLATES } from '@cms/seeds/core-templates'
import { keepNestingValid, nestParent, pageNotes, wizardPageTemplateLabel } from './wizard-page-order.ts'

export function WizardPagesStep({
  setup,
  setSetup,
  setPagesTouched,
  setDescription,
}: {
  setup: SiteSetup
  setSetup: Dispatch<SetStateAction<SiteSetup>>
  setPagesTouched: (value: boolean) => void
  setDescription: (text: string) => void
}) {
  function updatePage(index: number, patch: Partial<SiteSetupPage>) {
    setPagesTouched(true)
    if (patch.intro !== undefined && setup.pages[index]?.slug === '') setDescription(patch.intro)
    setSetup(current => ({
      ...current,
      pages: current.pages.map((page, at) => (at === index ? { ...page, ...patch } : page)),
    }))
  }
  function orderPage(index: number, delta: number) {
    const next = [...setup.pages]
    const target = index + delta
    if (!next[target]) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setPagesTouched(true)
    setSetup({ ...setup, pages: keepNestingValid(next) })
  }
  return (
    <>
      <p>Arrange the initial pages and adjust their titles and introductions.</p>
      {setup.pages.map((page, index) => (
        <details className={`wizard-page${page.nested ? ' is-nested' : ''}`} key={index} open={index === 0}>
          <summary>
            {page.title || 'Untitled page'} <span className="muted">/{page.slug}</span>
            <span className="wizard-page-meta">
              {wizardPageTemplateLabel(page)}
              {pageNotes(setup.pages, index)}
            </span>
          </summary>
          <div className="field">
            <label htmlFor={`setup-page-title-${index}`}>Page title</label>
            <input
              type="text"
              id={`setup-page-title-${index}`}
              value={page.title}
              maxLength={80}
              onChange={event => updatePage(index, { title: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`setup-page-slug-${index}`}>Page address</label>
            <input
              type="text"
              id={`setup-page-slug-${index}`}
              value={page.slug}
              readOnly={page.slug === ''}
              maxLength={160}
              onChange={event => updatePage(index, { slug: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`setup-page-intro-${index}`}>Introduction</label>
            <textarea
              id={`setup-page-intro-${index}`}
              value={page.intro}
              maxLength={500}
              onChange={event => updatePage(index, { intro: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`page-template-${index}`}>Page template</label>
            <select
              id={`page-template-${index}`}
              value={page.template ?? (page.layout !== 'content' ? page.layout : 'blank')}
              onChange={event =>
                updatePage(index, {
                  template: event.target.value as NonNullable<SiteSetupPage['template']>,
                  layout: ['speakers', 'program', 'resources'].includes(event.target.value)
                    ? (event.target.value as SiteSetupPage['layout'])
                    : 'content',
                })
              }
            >
              {CORE_PAGE_TEMPLATES.map(template => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          {page.layout === 'content' && (
            <div className="field">
              <label htmlFor={`setup-page-body-${index}`}>Body text</label>
              <textarea
                id={`setup-page-body-${index}`}
                value={page.body}
                maxLength={5000}
                onChange={event => updatePage(index, { body: event.target.value })}
              />
            </div>
          )}
          <div className="wizard-page-choices">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={page.menu}
                onChange={event => updatePage(index, { menu: event.target.checked })}
              />
              <span>
                Show in the site menu
                <small>A page left out still exists; add it to the menu later in Navigation.</small>
              </span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={page.footer}
                disabled={!page.footer && setup.pages.filter(item => item.footer).length >= SITE_SETUP_FOOTER_PAGES}
                onChange={event => updatePage(index, { footer: event.target.checked })}
              />
              <span>
                Show in the footer
                <small>Listed among the footer’s links, up to {SITE_SETUP_FOOTER_PAGES} pages.</small>
              </span>
            </label>
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary small"
              disabled={index === 0}
              onClick={() => orderPage(index, -1)}
            >
              Move up
            </button>
            <button
              type="button"
              className="secondary small"
              disabled={index === setup.pages.length - 1}
              onClick={() => orderPage(index, 1)}
            >
              Move down
            </button>
            {page.nested ? (
              <button type="button" className="secondary small" onClick={() => updatePage(index, { nested: false })}>
                Un-nest
              </button>
            ) : (
              <button
                type="button"
                className="secondary small"
                disabled={
                  !nestParent(
                    setup.pages.map((item, at) => (at === index ? { ...item, nested: true } : item)),
                    index,
                  )
                }
                onClick={() => updatePage(index, { nested: true })}
              >
                Nest under the page above
              </button>
            )}
            {page.slug !== '' && (
              <button
                type="button"
                className="danger small"
                onClick={() => {
                  setPagesTouched(true)
                  setSetup({ ...setup, pages: keepNestingValid(setup.pages.filter((_, at) => at !== index)) })
                }}
              >
                Remove page
              </button>
            )}
          </div>
        </details>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={setup.pages.length >= 12}
        onClick={() => {
          let number = setup.pages.length + 1
          while (setup.pages.some(page => page.slug === `page-${number}`)) number++
          setPagesTouched(true)
          setSetup({
            ...setup,
            pages: [
              ...setup.pages,
              {
                title: 'New page',
                slug: `page-${number}`,
                intro: '',
                body: '',
                layout: 'content',
                menu: true,
                nested: false,
                footer: false,
              },
            ],
          })
        }}
      >
        Add a page
      </button>
      <p className="hint">
        <strong>Nest</strong> puts a page under the one above it, which is how a drop-down appears in the menu. Pages go
        one level deep, and the home page always stays at the top.
      </p>
    </>
  )
}
