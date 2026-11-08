'use client'
import { useEffect, useState } from 'react'
import { CMS_ICONS, isCmsIcon, type CmsIconName } from '@cms/schema'
import { renderCmsIcon } from '@cms/renderer'
import { Button, Dialog } from './ui/index.ts'
import styles from './icon-picker.module.css'
const recentKey = 'cms-recent-icons'
export function IconPicker({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id: string
  value: unknown
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [recent, setRecent] = useState<CmsIconName[]>([])
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(recentKey) ?? '[]')
      if (Array.isArray(stored)) setRecent(stored.filter(isCmsIcon).slice(0, 6))
    } catch {
      /* A private browser may disable storage. */
    }
  }, [])
  function choose(name: CmsIconName) {
    const next = [name, ...recent.filter(item => item !== name)].slice(0, 6)
    setRecent(next)
    try {
      localStorage.setItem(recentKey, JSON.stringify(next))
    } catch {}
    onChange(name)
    setOpen(false)
  }
  function choices(names: CmsIconName[]) {
    return (
      <div className={styles.grid}>
        {names.map(name => (
          <Button key={name} variant="secondary" aria-pressed={name === value} onClick={() => choose(name)}>
            <span
              className={styles.symbol}
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: renderCmsIcon(name) }}
            />
            {CMS_ICONS[name]}
          </Button>
        ))}
      </div>
    )
  }
  const matches = (Object.keys(CMS_ICONS) as CmsIconName[]).filter(name =>
    (name + ' ' + CMS_ICONS[name]).toLowerCase().includes(search.trim().toLowerCase()),
  )
  return (
    <>
      <div className={styles.current}>
        <Button
          id={id}
          aria-label={isCmsIcon(value) ? 'Change icon: ' + CMS_ICONS[value] : 'Choose icon'}
          disabled={disabled}
          variant="secondary"
          onClick={() => {
            setSearch('')
            setOpen(true)
          }}
        >
          {isCmsIcon(value) && (
            <span
              className={styles.symbol}
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: renderCmsIcon(value) }}
            />
          )}
          {isCmsIcon(value) ? CMS_ICONS[value] + ' · Change icon' : 'Choose icon'}
        </Button>
        {isCmsIcon(value) && (
          <Button disabled={disabled} variant="tertiary" onClick={() => onChange('')}>
            Remove icon
          </Button>
        )}
      </div>
      <p className="hint">Decorative symbol. Keep its meaning in the nearby text too.</p>
      {open && (
        <Dialog
          title="Choose an icon"
          onClose={() => setOpen(false)}
          footer={
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          }
        >
          <div className={styles.body}>
            <label>
              Search icons
              <input autoFocus type="search" value={search} onChange={event => setSearch(event.target.value)} />
            </label>
            {!search.trim() && recent.length > 0 && (
              <section>
                <h3>Recently used</h3>
                {choices(recent)}
              </section>
            )}
            <section>
              <h3>{search.trim() ? 'Matching icons' : 'All icons'}</h3>
              {matches.length ? (
                choices(matches)
              ) : (
                <p role="status">No icons match. Try a word such as people, heart or calendar.</p>
              )}
            </section>
          </div>
        </Dialog>
      )}
    </>
  )
}
