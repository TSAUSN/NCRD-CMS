'use client'
import { governedEmbed, type GovernedEmbedKind } from '@cms/renderer'

const EMBED_PROVIDERS: Record<GovernedEmbedKind, string> = {
  video: 'YouTube or Vimeo',
  map: 'Google Maps',
  form: 'Microsoft Forms or Google Forms',
}

/** A governed embed: the ordinary link a provider gives, checked as it is typed
 * by the same rule the page renders with (governed-embeds.ts). */
export function EmbedField({
  id,
  kind,
  value,
  help,
  onChange,
}: {
  id: string
  kind: GovernedEmbedKind
  value: unknown
  help: string
  onChange: (value: unknown) => void
}) {
  const current = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const url = String(current['url'] ?? '')
  const embed = governedEmbed(kind, url)
  const empty = url.trim() === '' || url.trim() === '#'
  return (
    <div className="subfields">
      <label htmlFor={`${id}-url`}>Link from {EMBED_PROVIDERS[kind]}</label>
      <input
        id={`${id}-url`}
        type="url"
        value={empty ? '' : url}
        aria-describedby={`${id}-embed-note`}
        onChange={event => onChange({ ...current, url: event.target.value })}
      />
      <p className={!empty && !embed ? 'error-inline' : 'hint'} id={`${id}-embed-note`}>
        {embed
          ? `${embed.providerName} ${kind}. Visitors see a short notice and choose whether to load it.`
          : !empty
            ? `This link is not one the page can show. Use a link from ${EMBED_PROVIDERS[kind]}.`
            : help || `Paste a link from ${EMBED_PROVIDERS[kind]}.`}
      </p>
    </div>
  )
}
