import { ActionNote, Button, Dialog, Field } from '../../../../components/ui/index.ts'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import ownedStyles from './workspace-styles.module.css'
import type { NationalTemplateModel } from './use-national-template.ts'

export function TemplateStartDialog({ model }: { model: NationalTemplateModel }) {
  const {
    pending,
    close,
    create,
    name,
    slug,
    source,
    copy,
    sites,
    restored,
    clearSetup,
    editName,
    editSlug,
    setSource,
    setCopy,
    words,
    setWords,
    stories,
    setStories,
    error,
  } = model
  return (
    <Dialog
      title="Start a site from the national template"
      pending={pending}
      onClose={close}
      footer={
        <>
          <ActionNote>Save draft and leave keeps these choices only in this browser. It creates no site.</ActionNote>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={create}
            disabled={
              pending ||
              !name.trim() ||
              !slug ||
              (source === 'copy' && (!copy || !sites.some(site => site.id === copy)))
            }
          >
            {pending ? 'Creating private site…' : 'Create private site'}
          </Button>
        </>
      }
    >
      <fieldset disabled={pending} className={listInspectorStyles.formStack + ' ' + ownedStyles.plainFieldset}>
        {restored && (
          <p role="status">Setup restored from this browser. Check its source and choices before creating.</p>
        )}
        {restored && (
          <Button variant="secondary" onClick={clearSetup}>
            Clear saved setup
          </Button>
        )}
        <Field id="national-site-name" label="Site name" required>
          <input value={name} maxLength={120} onChange={event => editName(event.target.value)} />
        </Field>
        <Field
          id="national-site-address"
          label="Test address"
          help="The site stays private until its first publish."
          required
        >
          <input value={slug} maxLength={40} onChange={event => editSlug(event.target.value)} />
        </Field>
        <p className="muted">{slug || '[site-name]'}.staging.localhost</p>
        <fieldset>
          <legend>Start with the pages from</legend>
          {(
            [
              ['copy', 'A copy of a site'],
              ['templates', 'A saved set of page templates'],
              ['home', 'Home page only'],
            ] as const
          )
            .filter(([value]) => value !== 'copy' || sites.length > 0)
            .map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="national-source"
                  checked={source === value}
                  onChange={() => setSource(value)}
                />{' '}
                {label}
              </label>
            ))}
        </fieldset>
        {source === 'copy' && (
          <Field id="national-copy-source" label="Site to copy">
            <select value={copy} onChange={event => setCopy(event.target.value)}>
              {!sites.some(site => site.id === copy) && (
                <option value={copy} disabled>
                  Saved source is unavailable — choose a current site
                </option>
              )}
              {sites.map(site => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <label>
          <input type="checkbox" checked={words} onChange={event => setWords(event.target.checked)} /> Bring the words
          too
        </label>
        {source === 'copy' && (
          <label>
            <input type="checkbox" checked={stories} onChange={event => setStories(event.target.checked)} /> Bring the
            stories and tags
          </label>
        )}
        <p>
          Next you'll add the logo, build the menu and write the footer. The new site stays private until its first
          publish.
        </p>
        {pending && <p role="status">Creating the site and checking its content. This may take up to a minute.</p>}
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </Dialog>
  )
}
