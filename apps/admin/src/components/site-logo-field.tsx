'use client'
import { useId, useState } from 'react'
import { MediaPicker } from '../app/pages/[pageId]/media-picker.tsx'
import type { MediaAsset } from '../lib/media-library.ts'
import { Button } from './ui/index.ts'
import styles from './site-logo-field.module.css'
type Choice = { id: string; name: string; url: string; alt: string }
export function SiteLogoField({
  siteId,
  siteName,
  compact,
  value,
  choices,
  disabled,
  onChange,
  fallback = 'name',
}: {
  siteId: string
  siteName: string
  compact: boolean
  value: string | null
  choices: Choice[]
  disabled: boolean
  onChange: (id: string | null) => void
  fallback?: 'name' | 'full' | 'compact'
}) {
  const id = useId(),
    [open, setOpen] = useState(false),
    [chosen, setChosen] = useState<Choice | null>(null),
    [failed, setFailed] = useState<string | null>(null)
  const label = compact ? 'Compact logo' : 'Full logo',
    destination = compact ? 'compact logo' : 'full logo',
    selected = value
      ? chosen?.id === value
        ? chosen
        : (choices.find(item => item.id === value) ?? {
            id: value,
            name: 'Selected logo',
            url: '/media/' + encodeURIComponent(value) + '/thumbnail',
            alt: siteName,
          })
      : null
  function remember(asset: MediaAsset) {
    setChosen({ id: asset.id, name: asset.name, url: asset.previewUrl ?? asset.deliveryUrl ?? '', alt: asset.altText })
    setFailed(null)
  }
  return (
    <section className={styles.field} aria-labelledby={id}>
      <h3 id={id}>{label}</h3>
      {selected ? (
        <>
          <div className={styles.preview}>
            {selected.url && failed !== selected.id ? (
              <img src={selected.url} alt="" onError={() => setFailed(selected.id)} />
            ) : (
              <span>Preview unavailable</span>
            )}
          </div>
          <p className={styles.name}>{selected.name}</p>
        </>
      ) : (
        <p className={styles.help}>
          {fallback === 'full'
            ? 'The full logo is used on smaller screens.'
            : fallback === 'compact'
              ? 'The compact logo is used until you choose a full logo.'
              : compact
                ? 'Phones use the site name until you choose a compact logo.'
                : 'The site name is shown without a logo.'}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>
          {value ? 'Change' : 'Choose'} {destination}
        </Button>
        {value && (
          <Button variant="tertiary" disabled={disabled} onClick={() => onChange(null)}>
            {fallback === 'full'
              ? 'Use full logo on phones'
              : fallback === 'compact'
                ? 'Use compact logo instead'
                : 'Use site name instead'}
          </Button>
        )}
      </div>

      {open && (
        <MediaPicker
          siteId={siteId}
          initialAssets={[]}
          currentValue={value ? { media_id: value } : undefined}
          mode="site-logo"
          confirmLabel={'Use as ' + destination}
          onSelectedAsset={remember}
          onChoose={image => {
            if (image.media_id) onChange(image.media_id)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  )
}
