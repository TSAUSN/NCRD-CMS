import type { RefObject } from 'react'
import type { usePageDetails } from './new-page-draft.ts'
import ownedStyles from './new-page-styles.module.css'

export function NewPageDetails({
  details,
  siteAddress,
  titleInput,
}: {
  details: ReturnType<typeof usePageDetails>
  siteAddress: string
  titleInput: RefObject<HTMLInputElement | null>
}) {
  const { title, setTitle, address, slugProblem, editAddress } = details
  return (
    <section className={'creator-block ' + ownedStyles.plannerBlock} aria-labelledby="page-details-title">
      <div className="creator-block-head">
        <span className="creator-step">1</span>
        <div>
          <h3 id="page-details-title">Page details</h3>
          <p>You can change the title later. The address should stay memorable.</p>
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="page-title">What is this page called?</label>
          <input
            ref={titleInput}
            id="page-title"
            name="title"
            type="text"
            required
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder="About us"
          />
          <p className="hint">People see this in the browser tab and search results.</p>
        </div>
        <div className="field">
          <label htmlFor="page-slug">Web address</label>
          <input
            id="page-slug"
            name="slug"
            type="text"
            value={address}
            onChange={event => editAddress(event.target.value)}
            placeholder="about-us"
            aria-describedby={slugProblem ? 'page-address-preview page-slug-problem' : 'page-address-preview'}
          />
          <p className="address-preview mono" id="page-address-preview">
            {siteAddress}/{address}
          </p>
          {slugProblem && (
            <p className="error-inline" id="page-slug-problem">
              {slugProblem}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
