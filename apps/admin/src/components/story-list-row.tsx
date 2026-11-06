import { useState } from 'react'
import { storyFeatureRank, storyTagIds, type StoriesSettings, type StoryListPatch } from '@cms/schema'
import { GuardedLink as Link } from './guarded-link.tsx'
import shared from './workspace.module.css'
import { Badge, Button, ButtonLink } from './ui/index.ts'
import { IconImage } from './icons.tsx'
import type { StoryListRow } from '../lib/story-list.ts'
import { storyInSource, storyListLive } from '../lib/story-list.ts'
import styles from './story-list-row.module.css'
/** Shared photo/content/tag row for Stories and related content task lists. */
export function StoryListRowView({
  row,
  settings,
  publishedSettings,
  siteId,
  editable,
  onChange,
  pending = false,
  featureEditable = false,
}: {
  row: StoryListRow
  settings: StoriesSettings
  publishedSettings: StoriesSettings
  siteId: string
  editable: boolean
  pending?: boolean
  featureEditable?: boolean
  onChange: (patch: StoryListPatch) => void
}) {
  const [failed, setFailed] = useState<string | null>(null),
    v = row.values,
    title = String(v.title ?? 'Untitled story'),
    photo = v.photo && typeof v.photo === 'object' ? (v.photo as { alt?: string }) : null,
    href = '/sites/' + siteId + '/stories/' + row.id,
    live = storyListLive(row, publishedSettings)
  return (
    <article className={styles.row} data-story-id={row.id} aria-label={title}>
      <Link className={styles.photo} href={href} aria-label={'Edit story: ' + title}>
        {row.photoPreview && row.photoPreview !== failed ? (
          <img src={row.photoPreview} alt={photo?.alt ?? ''} onError={() => setFailed(row.photoPreview)} />
        ) : (
          <span>
            <IconImage />
            <small>Photo unavailable</small>
          </span>
        )}
      </Link>
      <div className={styles.content}>
        <h2>
          <Link href={href} title={title}>
            {title}
          </Link>
        </h2>
        <p className={styles.description}>{String(v.summary ?? '')}</p>
        <div className={styles.meta}>
          <time dateTime={String(v.published_date ?? '')}>{String(v.published_date ?? '') || 'No date'}</time>
          <Badge tone={live ? (row.changed ? 'pending' : 'live') : 'neutral'}>
            {live ? (row.changed ? 'Changes not live' : 'Live') : row.published ? 'Not in feeds' : 'Draft'}
          </Badge>
          {!storyInSource(v) && <Badge tone="pending">No longer in feed</Badge>}
          {v.hidden === true && <Badge>Hidden{row.changed ? ' (draft)' : ''}</Badge>}
          {storyInSource(v) && v.reviewed !== true && <Badge tone="pending">Needs review</Badge>}
          {v.body_is_sample === true && <Badge tone="pending">Sample text</Badge>}
          {!row.hasText && <Badge tone="pending">Story text needed</Badge>}
        </div>
        {(['main', 'secondary'] as const).map(group => (
          <div
            key={group}
            className={styles.tags}
            role="group"
            aria-label={group === 'main' ? settings.mainLabel : settings.secondaryLabel}
          >
            <span className={styles.tagLabel}>{group === 'main' ? settings.mainLabel : settings.secondaryLabel}</span>
            <div className={styles.chipGroup}>
              {(group === 'main' ? settings.mainTags : settings.secondaryTags).map(tag =>
                editable ? (
                  <button
                    key={tag.id}
                    type="button"
                    disabled={pending}
                    className={shared.tagChip}
                    title={tag.label}
                    data-group={group}
                    aria-pressed={storyTagIds(v, group).includes(tag.id)}
                    onClick={() =>
                      onChange({ action: 'tag', group, id: tag.id, selected: !storyTagIds(v, group).includes(tag.id) })
                    }
                  >
                    {tag.label}
                  </button>
                ) : storyTagIds(v, group).includes(tag.id) ? (
                  <span key={tag.id} className={shared.tagChip} title={tag.label} data-group={group} data-selected>
                    {tag.label}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        ))}
      </div>
      <div className={styles.actions}>
        {editable && (
          <>
            <label className={shared.checkRow}>
              <input
                type="checkbox"
                disabled={pending}
                checked={v.reviewed === true}
                onChange={event => onChange({ action: 'reviewed', value: event.target.checked })}
              />
              Reviewed
            </label>
            <label className={shared.checkRow}>
              <input
                type="checkbox"
                disabled={pending}
                checked={v.hidden === true}
                onChange={event => onChange({ action: 'hidden', value: event.target.checked })}
              />
              Hide from feeds
            </label>
            {featureEditable && (
              <Button
                className={styles.feature}
                variant="tertiary"
                size="s"
                disabled={pending}
                aria-pressed={Boolean(storyFeatureRank(v))}
                onClick={() => onChange({ action: 'featured', value: !storyFeatureRank(v) })}
              >
                <span aria-hidden="true">{storyFeatureRank(v) ? '★' : '☆'}</span>
                {storyFeatureRank(v) ? 'Featured' : 'Feature'}
              </Button>
            )}
          </>
        )}
        <ButtonLink size="s" variant="secondary" href={href}>
          Edit story
        </ButtonLink>
      </div>
    </article>
  )
}
