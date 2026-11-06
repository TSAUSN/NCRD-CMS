'use client'
import { NATIONAL_THEME } from '@cms/seeds/core-themes'

import { useState, type CSSProperties } from 'react'
import type { SiteSetup } from '@cms/schema'
import { IconAlert, IconCheck } from '../../../components/icons.tsx'
import {
  BRAND_COLOURS,
  BUTTON_SHAPES,
  TYPE_PAIRINGS,
  brandColourFor,
  buttonShapeFor,
  isHexColour,
  lookChecks,
  lookSummary,
  typePairingFor,
  withBrandColour,
} from '../../../lib/site-look.ts'

type Theme = SiteSetup['theme']
type SampleStyle = CSSProperties & Record<`--${string}`, string>
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

/** The Look step: brand colour, type pairing and button shape as choices a
 * newcomer judges by eye, beside a sample that changes as they choose. */
export function LookChoices({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const brand = brandColourFor(theme),
    pairing = typePairingFor(theme),
    shape = buttonShapeFor(theme)
  // What the editor typed, kept until it becomes the colour or another choice replaces it.
  const [typed, setTyped] = useState<{ base: string; text: string } | null>(null)
  const shown = typed && typed.base === theme.colors.primary ? typed.text : theme.colors.primary
  return (
    <>
      <p className="wizard-lede">
        Every choice here can be changed later in Site look. The preview shows the colours, type and button shape the
        site starts with.
      </p>
      <button type="button" className="secondary" onClick={() => onChange(structuredClone(NATIONAL_THEME))}>
        Use National preset
      </button>
      <fieldset className="look-group">
        <legend>Brand colour</legend>
        <div className="look-options look-colours">
          {BRAND_COLOURS.map(colour => {
            const id = `look-colour-${key(colour.name)}`
            return (
              <label className="look-option" key={colour.name}>
                <input
                  type="radio"
                  name="brand-colour"
                  checked={brand?.name === colour.name}
                  aria-labelledby={id}
                  aria-describedby={`${id}-about`}
                  onChange={() => onChange(withBrandColour(theme, colour.primary, colour.accent))}
                />
                <span className="look-swatch" style={{ background: colour.primary }} aria-hidden="true" />
                <span className="look-option-copy">
                  <strong id={id}>{colour.name}</strong>
                  <small id={`${id}-about`}>{colour.description}</small>
                </span>
              </label>
            )
          })}
        </div>
        <div className={`look-custom${brand ? '' : ' is-chosen'}`}>
          <label htmlFor="look-custom-colour">Or a colour of your own</label>
          <div className="theme-colour-input">
            <input
              type="color"
              aria-label="Pick your own colour"
              value={theme.colors.primary}
              onChange={event => {
                setTyped(null)
                onChange(withBrandColour(theme, event.target.value))
              }}
            />
            <input
              type="text"
              id="look-custom-colour"
              value={shown}
              maxLength={7}
              spellCheck={false}
              autoComplete="off"
              aria-describedby="look-custom-colour-hint"
              onChange={event => {
                const text = event.target.value.trim()
                const valid = isHexColour(text)
                setTyped({ base: valid ? text.toLowerCase() : theme.colors.primary, text })
                if (valid) onChange(withBrandColour(theme, text))
              }}
            />
          </div>
          <p className="hint" id="look-custom-colour-hint">
            {brand
              ? 'A six-digit hex colour such as #0f6b75. Button labels are chosen to stay readable on it.'
              : 'Using your own colour. Button labels are chosen to stay readable on it; the preview says whether text in it is.'}
          </p>
        </div>
      </fieldset>
      <fieldset className="look-group">
        <legend>Type</legend>
        <div className="look-options look-types">
          {TYPE_PAIRINGS.map(option => {
            const id = `look-type-${key(option.name)}`
            return (
              <label className="look-option" key={option.name}>
                <input
                  type="radio"
                  name="type-pairing"
                  checked={pairing?.name === option.name}
                  aria-labelledby={id}
                  aria-describedby={`${id}-about`}
                  onChange={() => onChange({ ...theme, fonts: { heading: option.heading, body: option.body } })}
                />
                <span className="look-type-sample" style={{ fontFamily: option.heading }} aria-hidden="true">
                  Ag
                </span>
                <span className="look-option-copy">
                  <strong id={id} style={{ fontFamily: option.heading }}>
                    {option.name}
                  </strong>
                  <small id={`${id}-about`} style={{ fontFamily: option.body }}>
                    {option.description}
                  </small>
                </span>
              </label>
            )
          })}
        </div>
        {!pairing && (
          <p className="hint">
            This setup uses its own heading and body fonts. Choose a pairing to replace them, or keep them and adjust
            them later in Site look.
          </p>
        )}
      </fieldset>
      <fieldset className="look-group">
        <legend>Button shape</legend>
        <div className="look-options look-shapes">
          {BUTTON_SHAPES.map(option => {
            const id = `look-shape-${key(option.name)}`
            return (
              <label className="look-option look-shape" key={option.name}>
                <input
                  type="radio"
                  name="button-shape"
                  checked={shape?.name === option.name}
                  aria-labelledby={id}
                  onChange={() => onChange({ ...theme, buttons: { ...theme.buttons, radius: option.radius } })}
                />
                <span
                  className="look-button-sample"
                  aria-hidden="true"
                  style={{ borderRadius: option.radius, background: theme.colors.primary }}
                />
                <strong id={id}>{option.name}</strong>
              </label>
            )
          })}
        </div>
      </fieldset>
    </>
  )
}

/**
 * A sample of the planned site in its chosen look. It is drawn from the same
 * theme tokens the renderer uses, so colours, fonts and button shape are exact;
 * the layout is a sample, and the page editor shows the real pages after
 * creation.
 */
export function SitePreview({ setup }: { setup: SiteSetup }) {
  const { theme } = setup,
    { colors, fonts, buttons } = theme
  const name = setup.name.trim() || 'Your site name'
  const home = setup.pages.find(page => page.slug === '') ?? setup.pages[0]
  const fill = buttons.color === 'accent' ? colors.accent : colors.primary
  const style: SampleStyle = {
    '--sample-primary': colors.primary,
    '--sample-surface': colors.surface,
    '--sample-band': colors.surfaceAlt,
    '--sample-ink': colors.ink,
    '--sample-muted': colors.muted,
    '--sample-heading': fonts.heading,
    '--sample-body': fonts.body,
    '--sample-button': fill,
    '--sample-button-ink': buttons.color === 'accent' ? colors.accentContrast : colors.primaryContrast,
    '--sample-button-radius': buttons.radius,
    '--sample-button-weight': buttons.weight === 'regular' ? '600' : '750',
    '--sample-accent': colors.accent,
    '--sample-on-primary': colors.primaryContrast,
    '--sample-on-accent': colors.accentContrast,
  }
  const footerName = setup.footer.brand.siteName.trim() || name
  const footerLine = setup.footer.brand.blurb.trim() || setup.footer.legal.copyright.trim()
  return (
    <section className="wizard-preview" aria-labelledby="wizard-preview-title">
      <h3 id="wizard-preview-title">Preview</h3>
      <div
        className={`wizard-sample is-header-${setup.header.preset}`}
        style={style}
        role="img"
        aria-label={`Sample home page: ${lookSummary(theme)}`}
      >
        {setup.header.enabled && (
          <div className={`wizard-sample-header is-surface-${setup.header.surface}`}>
            <span className="wizard-sample-brand">{setup.header.brand.siteName.trim() || name}</span>
            {setup.header.partner?.name.trim() && (
              <span className="wizard-sample-partner">
                {setup.header.partner.label} <b>{setup.header.partner.name}</b>
              </span>
            )}
            <span className="wizard-sample-nav">
              {sampleMenu(setup.pages)
                .slice(0, 3)
                .map((item, index) => (
                  <span key={index}>
                    {item.title}
                    {item.children ? ' ▾' : ''}
                  </span>
                ))}
            </span>
          </div>
        )}
        <div className="wizard-sample-main">
          <span className="wizard-sample-eyebrow">Welcome</span>
          <span className="wizard-sample-heading">{!home || home.slug === '' ? name : home.title}</span>
          {home?.intro && <span className="wizard-sample-intro">{home.intro}</span>}
          <span className={`wizard-sample-button is-${buttons.style}`}>Primary action</span>
        </div>
        <div className="wizard-sample-band">A quiet band, for the sections that sit behind the main content.</div>
        {setup.footer.enabled && (
          <div className="wizard-sample-footer">
            <span className="wizard-sample-footer-name">{footerName}</span>
            {footerLine && <span>{footerLine}</span>}
          </div>
        )}
      </div>
      <ul className="wizard-contrast" aria-label="Readability">
        {lookChecks(theme).map(check => (
          <li key={check.id} className={check.pass ? 'pass' : 'fail'}>
            {check.pass ? <IconCheck size={14} /> : <IconAlert size={14} />}
            <span>{check.message}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The menu the plan makes: nested pages open from the page above them, which
 * shows a drop-down mark; one whose parent is left out stands on its own. */
function sampleMenu(pages: SiteSetup['pages']): { title: string; children: number }[] {
  const items: { title: string; children: number }[] = []
  let parent: { home: boolean; item: { title: string; children: number } | null } | null = null
  for (const page of pages) {
    const item = { title: page.title || 'Untitled page', children: 0 }
    if (!page.nested) {
      parent = { home: page.slug === '', item: page.menu ? item : null }
      if (page.menu) items.push(item)
      continue
    }
    if (!page.menu) continue
    if (parent?.item && !parent.home) parent.item.children += 1
    else items.push(item)
  }
  return items
}
