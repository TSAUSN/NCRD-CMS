'use client'
import { useEffect, useState } from 'react'
import { Button, Field, TextLink } from '../../../components/ui/index.ts'
import { loadPageDetails, savePageDetailsAction } from './page-details-actions.ts'
import type { PageDetailsInput } from '../../../lib/page-details.ts'
import styles from './inspector.module.css'
export function PageDetailsFields({
  pageId,
  onSave,
  originalDesign = false,
}: {
  pageId: string
  originalDesign?: boolean
  onSave: (input: PageDetailsInput) => Promise<Awaited<ReturnType<typeof savePageDetailsAction>> | null>
}) {
  const [loaded, setLoaded] = useState<Extract<Awaited<ReturnType<typeof loadPageDetails>>, { ok: true }> | null>(null)
  const [title, setTitle] = useState('')
  const [address, setAddress] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const [inMenu, setInMenu] = useState(false)
  const [saved, setSaved] = useState('')
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void loadPageDetails(pageId)
      .then(result => {
        if (!active) return
        if (!result.ok) {
          setError(result.message)
          return
        }
        setLoaded(result)
        setTitle(result.title)
        setAddress(result.address)
        setParent(result.parentId)
        setInMenu(result.inMenu)
        setSaved(JSON.stringify([result.title, result.address, result.parentId, result.inMenu]))
      })
      .catch(() => {
        if (active) setError('Page details could not be loaded. Reopen this drawer to try again.')
      })
    return () => {
      active = false
    }
  }, [pageId])
  const serial = JSON.stringify([title, address, parent, inMenu])
  const dirty = serial !== saved
  const addressProblem =
    address !== '' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(address)
      ? 'Use lowercase letters, numbers and single hyphens.'
      : loaded?.reservedAddresses.includes(address)
        ? 'Another page already uses this address.'
        : null
  async function save() {
    if (!loaded || !title.trim() || addressProblem) return
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const result = await onSave({
        pageId,
        title,
        address,
        parentId: parent,
        inMenu: loaded.menuReadOnly ? null : inMenu,
        menuRevision: loaded.menuRevision,
      })
      if (!result) return
      if (!result.ok) setError(result.message)
      else {
        setSaved(serial)
        setLoaded({ ...loaded, menuRevision: result.menuRevision })
        setNotice(result.message)
      }
    } catch {
      setError('The page details could not be saved. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <section className={styles.content} aria-label="Page details">
      <h3>Page</h3>
      {!loaded && !error && <p role="status">Loading page details…</p>}
      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loaded && (
        <>
          {!loaded.canManage && (
            <p className="hint">
              An editor can change the page name and address. You can still update its content and search details.
            </p>
          )}
          <Field id="page-title" label="Page title">
            <input
              value={title}
              maxLength={200}
              disabled={!loaded.canManage || pending}
              onChange={event => setTitle(event.target.value)}
            />
          </Field>
          <Field
            id="page-address"
            label="Page address"
            error={addressProblem ?? undefined}
            help="Leave blank for the home page. Publish the page to change its live address."
          >
            <input
              value={address}
              maxLength={160}
              disabled={!loaded.canManage || pending}
              onChange={event => setAddress(event.target.value.toLowerCase())}
            />
          </Field>
          <Field id="page-parent" label="Parent page">
            <select
              value={parent ?? ''}
              disabled={!loaded.canManage || pending}
              onChange={event => setParent(event.target.value || null)}
            >
              <option value="">No parent — top level</option>
              {parent && !loaded.pages.some(page => page.id === parent) && (
                <option value={parent}>Previous parent (no longer available)</option>
              )}
              {loaded.pages.map(page => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
            </select>
          </Field>
          {loaded.menuReadOnly ? (
            <p className="hint">
              {loaded.menuLocations.length
                ? 'In the menu: ' + loaded.menuLocations.join('; ') + '.'
                : "This page isn't in the menu."}{' '}
              {loaded.canManageMenu ? (
                <>
                  Change the menu in{' '}
                  <TextLink href={'/sites/' + loaded.siteId + '/header'} target="_blank" rel="noopener noreferrer">
                    Header &amp; menu
                  </TextLink>
                  .
                </>
              ) : (
                <>A Site admin can change the menu in Header &amp; menu.</>
              )}
            </p>
          ) : (
            <div className={styles.settingGroup}>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={inMenu}
                  disabled={!loaded.canManage || pending}
                  onChange={event => setInMenu(event.target.checked)}
                />
                Show in menu
              </label>
              <p className="hint">
                Parent pages group the Pages list. Arrange dropdowns in {originalDesign ? 'Menu & footer' : 'Site look'}
                . Menu changes stay private until you publish them.
              </p>
            </div>
          )}
          {loaded.canManage && (
            <Button
              disabled={!dirty || !title.trim() || Boolean(addressProblem)}
              loading={pending}
              onClick={() => void save()}
            >
              Save page details
            </Button>
          )}
        </>
      )}
    </section>
  )
}
