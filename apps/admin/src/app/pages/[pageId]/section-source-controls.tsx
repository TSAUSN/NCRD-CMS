'use client'
import contentEditorStyles from '../../../components/content-editor.module.css'
import { Disclosure } from '../../../components/ui/index.ts'
import { useEffect, useState } from 'react'
import { checkCustomCss, type CssCheck } from '../../actions/section-definitions.ts'
import { IconAlert, IconBrush, IconCheck, IconCode } from '../../../components/icons.tsx'

/**
 * Custom CSS and Edit HTML (SPEC §6.4), each stating what it costs before it
 * opens.
 *
 * The consequence is written above the box rather than beside the Save button,
 * because by the time somebody has pasted a tracking script into a page they did
 * not know they could, telling them the page now needs a super admin's review is
 * news about work they have already done. v1's own copy is the register: say
 * what happens, say what is *not* affected, and say whether it can be undone.
 */
export function SectionSourceControls({
  index,
  css,
  html,
  approved,
  canEditHtml,
  onCustomCss,
  onRawHtml,
}: {
  index: number
  css: string
  html: string
  approved: boolean
  canEditHtml: boolean
  onCustomCss: (css: string) => void
  onRawHtml: (html: string) => void
}) {
  const [check, setCheck] = useState<CssCheck | null>(null)

  // Asked of the server, debounced, because the answer is the CSS policy's and
  // the CSS policy is a parser rather than a regular expression somebody could
  // reimplement here.
  useEffect(() => {
    if (css.trim() === '') {
      setCheck(null)
      return
    }
    const timer = setTimeout(() => {
      void checkCustomCss(css, index)
        .then(setCheck)
        .catch(() => setCheck(null))
    }, 400)
    return () => clearTimeout(timer)
  }, [css, index])

  const inUse = css.trim() !== '' || html.trim() !== ''

  return (
    <>
      <h3>Custom code</h3>
      {inUse && (
        <p className={approved ? 'notice notice-ok' : 'notice notice-warn'} style={{ marginTop: 0 }}>
          {approved ? <IconCheck size={16} /> : <IconAlert size={16} />}
          <span className="notice-body">
            {approved
              ? 'A super admin has already approved the custom code on this draft.'
              : 'This page has custom code on it, so a super admin has to look at it before the page can go live. Everything else about the page is unaffected.'}
          </span>
        </p>
      )}

      <Disclosure
        className={contentEditorStyles.disclosure}
        title={
          <>
            <IconBrush size={15} /> Custom CSS for this section
            {css.trim() !== '' && <span className="hatch-flag">In use</span>}
          </>
        }
      >
        <div className="hatch-body">
          <div className="hatch-consequence">
            Styles you write here apply to this one section on this one page.
            <ul>
              <li>They cannot affect any other section — they are confined to this block for you.</li>
              <li>Using this means a super admin has to approve the page before it goes live.</li>
              <li>You can clear the box to undo it completely.</li>
            </ul>
          </div>
          <label className="sr-only" htmlFor={`css-${index}`}>
            Custom CSS
          </label>
          <textarea
            id={`css-${index}`}
            className="code"
            rows={6}
            spellCheck={false}
            value={css}
            placeholder={'.cms-section h2 {\n  letter-spacing: -.02em;\n}'}
            onChange={event => onCustomCss(event.target.value)}
          />
          {check && check.blocking.length > 0 && (
            <div className="notice notice-error" role="alert" style={{ marginTop: '.75rem' }}>
              <IconAlert size={16} />
              <div className="notice-body">
                <strong>None of this is being used.</strong>
                <ul>
                  {check.blocking.map(problem => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {check && check.blocking.length === 0 && check.dropped.length > 0 && (
            <div className="notice notice-warn" style={{ marginTop: '.75rem' }}>
              <IconAlert size={16} />
              <div className="notice-body">
                <strong>Some of this is being left out.</strong>
                <ul>
                  {check.dropped.map(problem => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {check && check.ok && check.dropped.length === 0 && (
            <p className="ok-inline">
              <IconCheck size={14} /> All of this is being used.
            </p>
          )}
        </div>
      </Disclosure>

      {canEditHtml && (
        <Disclosure
          className={contentEditorStyles.disclosure}
          title={
            <>
              <IconCode size={15} /> Edit the HTML of this section
              {html.trim() !== '' && <span className="hatch-flag">In use</span>}
            </>
          }
        >
          <div className="hatch-body">
            <div className="hatch-consequence">
              This replaces everything inside this section with markup you write yourself.
              <ul>
                <li>The section’s own fields stop being used while there is anything in this box.</li>
                <li>It is published exactly as you write it, so a super admin has to approve the page first.</li>
                <li>Clearing the box brings the section’s normal content straight back.</li>
              </ul>
            </div>
            <label className="sr-only" htmlFor={`html-${index}`}>
              Section HTML
            </label>
            <textarea
              id={`html-${index}`}
              className="code"
              rows={8}
              spellCheck={false}
              value={html}
              placeholder={'<div class="notice">\n  <p>Anything you like.</p>\n</div>'}
              onChange={event => onRawHtml(event.target.value)}
            />
            <p className="hint">
              The preview beside you shows exactly what this will look like, because it is rendered the same way the
              live page will be.
            </p>
          </div>
        </Disclosure>
      )}
    </>
  )
}
