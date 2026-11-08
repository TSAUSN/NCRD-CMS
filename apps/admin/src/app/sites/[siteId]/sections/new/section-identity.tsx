import { type ReactNode } from 'react'
import type { HtmlSectionDraft, SectionCreatorProps } from './use-html-section-draft.ts'

export function SectionIdentity({
  model,
  initial,
  siteName,
  rights,
  children,
}: {
  model: HtmlSectionDraft
  children: ReactNode
} & Pick<SectionCreatorProps, 'initial' | 'siteName' | 'rights'>) {
  const {
    name,
    setName,
    setSlug,
    setTouchedSlug,
    category,
    setCategory,
    placement,
    setPlacement,
    scope,
    setScope,
    busy,
    effectiveSlug,
  } = model
  return (
    <>
      <div className="card">
        <div className="field">
          <label htmlFor="sec-name">What is this section called?</label>
          <input
            id="sec-name"
            type="text"
            value={name}
            placeholder="Promo band"
            disabled={busy}
            onChange={event => setName(event.target.value)}
          />
          <p className="hint">People pick sections by this name when they add one to a page.</p>
        </div>
        <div className="row2">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="sec-slug">Short name</label>
            <input
              id="sec-slug"
              type="text"
              value={effectiveSlug}
              placeholder="promo-band"
              disabled={busy || !!initial}
              onChange={event => {
                setTouchedSlug(true)
                setSlug(event.target.value)
              }}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="sec-category">Group it under</label>
            <input
              id="sec-category"
              type="text"
              value={category}
              disabled={busy}
              onChange={event => setCategory(event.target.value)}
            />
          </div>
        </div>
        <p className="hint">
          The short name is used behind the scenes and cannot be changed later, because your styles are attached to it.
        </p>
      </div>
      {children}
      <div className="card">
        <div className="field">
          <label htmlFor="sec-placement">Used as</label>
          <select
            id="sec-placement"
            value={placement}
            disabled={busy || !rights.global}
            onChange={event => setPlacement(event.target.value as typeof placement)}
          >
            <option value="page">Page section</option>
            <option value="header">Site header</option>
            <option value="footer">Site footer</option>
          </select>
          <p className="hint">
            {placement === 'page'
              ? 'Page sections are added separately to each page.'
              : 'This component is chosen and edited in Header & footer once for the whole site. Use a Site menu field between tags to render governed Navigation.'}
            {initial
              ? ' Placement can change only while the definition is unused.'
              : ' Only a super admin can create a site frame component.'}
          </p>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Who can use it</h2>
        </div>
        <label className="choice">
          <input
            type="radio"
            name="scope"
            checked={scope === 'site'}
            onChange={() => setScope('site')}
            disabled={busy || !rights.site || !!initial}
          />
          <span>
            <strong>Only {siteName}</strong>
            <span className="muted">It appears in this site’s library and nowhere else.</span>
          </span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name="scope"
            checked={scope === 'global'}
            onChange={() => setScope('global')}
            disabled={busy || !rights.global || !!initial}
          />
          <span>
            <strong>Every site</strong>
            <span className="muted">
              {rights.global
                ? 'Anybody editing any site here can add it to a page.'
                : 'Only a super admin can make a section available to every site.'}
            </span>
          </span>
        </label>
      </div>
    </>
  )
}
