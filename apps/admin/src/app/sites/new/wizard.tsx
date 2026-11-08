'use client'
import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import { ConfirmDialog } from '../../../components/confirm.tsx'
import { LookChoices, SitePreview } from './look.tsx'
import { WizardNameStep } from './wizard-name-step.tsx'
import { WizardPagesStep } from './wizard-pages-step.tsx'
import { WizardFrameStep } from './wizard-frame-step.tsx'
import { WizardReviewStep } from './wizard-review-step.tsx'
import { WIZARD_STEPS, useSiteWizard } from './use-site-wizard.ts'

const savedTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function SiteWizard({
  stagingBase,
  managedStaging = false,
  progressKey,
}: {
  stagingBase: string | null
  managedStaging?: boolean
  progressKey?: string | undefined
}) {
  const {
    setup,
    setSetup,
    step,
    slugTouched,
    setSlugTouched,
    error,
    result,
    pending,
    heading,
    file,
    savedAt,
    reading,
    saveProblem,
    hasProgress,
    browserSaved,
    clearProgress,
    move,
    chooseKind,
    describe,
    setPagesTouched,
    setDescription,
    importSetup,
    exportSetup,
    submit,
    switchKind,
    setSwitchKind,
    kind,
  } = useSiteWizard(stagingBase, progressKey)
  return (
    <div className="site-wizard">
      {hasProgress && (
        <div className="wizard-progress" role="status">
          <p>
            {browserSaved && savedAt
              ? `Progress saved in this browser at ${savedTime(savedAt)}. You can come back to it.`
              : saveProblem ||
                'Current changes are not saved in this browser. Complete required fields before leaving.'}
          </p>
          <button type="button" className="ghost small" disabled={pending || reading} onClick={clearProgress}>
            Clear saved draft
          </button>
        </div>
      )}
      <ol className="steps" aria-label="Site setup steps">
        {WIZARD_STEPS.map((label, index) => (
          <li key={label} className={index === step ? 'on' : index < step ? 'done' : ''}>
            <button
              type="button"
              disabled={pending || reading}
              aria-current={index === step ? 'step' : undefined}
              onClick={() => move(index)}
            >
              <span className="step-n">{index + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>
      {(error || (result && !result.ok)) && (
        <div className="notice notice-error" role="alert">
          <p>{error || (result && !result.ok ? result.message : '')}</p>
          {result && !result.ok && result.reauthenticate && (
            <a href="/sign-in?reauth=1" target="_blank" rel="noopener">
              Confirm sign-in in another tab
            </a>
          )}
        </div>
      )}
      {!stagingBase && (
        <p className="notice notice-error">
          The installation needs a staging address before sites can be created. You can prepare and save the setup now.
        </p>
      )}
      <div className="site-wizard-layout">
        <section className="card" aria-labelledby="wizard-step-title">
          <h2 id="wizard-step-title" tabIndex={-1} ref={heading}>
            {WIZARD_STEPS[step]}
          </h2>
          <fieldset disabled={pending || reading}>
            {step === 0 && (
              <WizardNameStep
                setup={setup}
                setSetup={setSetup}
                slugTouched={slugTouched}
                setSlugTouched={setSlugTouched}
                managedStaging={managedStaging}
                stagingBase={stagingBase}
                describe={describe}
                chooseKind={chooseKind}
              />
            )}
            {step === 1 && (
              <LookChoices theme={setup.theme} onChange={theme => setSetup(current => ({ ...current, theme }))} />
            )}
            {step === 2 && (
              <WizardPagesStep
                setup={setup}
                setSetup={setSetup}
                setPagesTouched={setPagesTouched}
                setDescription={setDescription}
              />
            )}
            {step === 3 && <WizardFrameStep setup={setup} setSetup={setSetup} />}
            {step === 4 && <WizardReviewStep setup={setup} managedStaging={managedStaging} stagingBase={stagingBase} />}
          </fieldset>
          <div className="actions wizard-actions">
            {step > 0 && (
              <button type="button" className="secondary" disabled={pending || reading} onClick={() => move(step - 1)}>
                Back
              </button>
            )}
            {step < 4 ? (
              <button type="button" disabled={pending || reading} onClick={() => move(step + 1)}>
                Continue
              </button>
            ) : (
              <button type="button" className="navy" disabled={pending || reading || !stagingBase} onClick={submit}>
                {pending ? 'Creating site…' : 'Create site'}
              </button>
            )}
            {!pending && (
              <Link className="btn ghost" href="/">
                Cancel setup
              </Link>
            )}
          </div>
        </section>
        <aside className={`wizard-summary card${step === 1 ? ' is-look' : ''}`} aria-label="Site setup summary">
          <SitePreview setup={setup} />
          {step !== 1 && (
            <>
              <h3>Planned pages</h3>
              <ol>
                {setup.pages.map((page, index) => (
                  <li key={index}>{page.title || 'Untitled page'}</li>
                ))}
              </ol>
            </>
          )}
          <details className="wizard-summary-tools">
            <summary>Reuse these choices for another site</summary>
            <p className="hint">
              Save these choices as a file, or start from a file saved earlier. To move a whole site with its pages and
              files, use Import an existing site instead.
            </p>
            <div className="cluster">
              <button type="button" className="secondary small" disabled={pending || reading} onClick={exportSetup}>
                Save choices
              </button>
              <button
                type="button"
                className="secondary small"
                disabled={pending || reading}
                onClick={() => file.current?.click()}
              >
                Load choices
              </button>
            </div>
          </details>
          <input
            disabled={pending || reading}
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={event => {
              const selected = event.target.files?.[0]
              event.target.value = ''
              void importSetup(selected)
            }}
          />
        </aside>
      </div>
      {switchKind && (
        <ConfirmDialog
          title="Replace the planned pages?"
          what="Changing the starter replaces the pages currently planned in this setup."
          reassurance="Your site name, colours, header, and footer choices stay unchanged. No site has been created yet."
          confirmLabel="Replace planned pages"
          onCancel={() => setSwitchKind(null)}
          onConfirm={() => kind(switchKind)}
        />
      )}
    </div>
  )
}
