'use client'
import { ReportLinkField } from '../report-link-field.tsx'
import { LinkSettings } from '../../../../components/link-settings.tsx'
import { IconPicker } from '../../../../components/icon-picker.tsx'
import dynamic from 'next/dynamic'
import { checkContrast } from '@cms/domain'
import { isGovernedEmbedKind } from '@cms/renderer'
import type { LinkTarget } from '../../../../lib/queries.ts'
import type { MediaAsset } from '../../../../lib/media-library.ts'
import {
  StoriesFeedField,
  StoryStartViewField,
  StoryStartRegionField,
  StoryPerRegionField,
} from '../stories-feed-field.tsx'
import { CollectionField } from '../collection-field.tsx'
import { isDrawingSlot, isIconSlot } from '@cms/schema'
import { DrawingField } from './drawing-field.tsx'
import { EmbedField } from './embed-field.tsx'
import { LinkField } from './link-field.tsx'
import { ButtonAppearanceField } from './button-appearance-field.tsx'
import { ImageField } from './image-field.tsx'

const RichTextField = dynamic(() => import('../rich-text-field.tsx').then(module => module.RichTextField), {
  ssr: false,
  loading: () => <div className="rich-editor-loading">Loading formatting tools…</div>,
})

export function SlotField({
  id,
  slot,
  value,
  siteId,
  pagePath = '/',
  definitionId,
  definitionVersion,
  mediaAssets,
  linkTargets,
  themeColors,
  customCode,
  onEditList,
  imagePreviews,
  originalDesign,
  supportsFocus = false,
  grouped = false,
  canAdvanced = false,
  onBeginLinkEdit,
  onChange,
}: {
  id: string
  slot: { id: string; kind: string; label: string; constraints?: Record<string, unknown> }
  /** Shown inside an imported link's group, which already names its parts. */
  grouped?: boolean
  supportsFocus?: boolean
  canAdvanced?: boolean
  onBeginLinkEdit?: () => () => void
  imagePreviews?: Record<string, string>
  originalDesign?: boolean
  value: unknown
  siteId: string
  pagePath?: string
  definitionId: string
  definitionVersion: number
  mediaAssets: MediaAsset[]
  linkTargets: LinkTarget[]
  themeColors: Record<string, string>
  onEditList?: (readerKey: string, stableKey?: string) => void
  customCode: boolean
  onChange: (value: unknown) => void
}) {
  if (slot.kind === 'text' && typeof slot.constraints?.storyPerRegionFor === 'string')
    return (
      <StoryPerRegionField
        id={id}
        value={value}
        onChange={onChange}
        siteId={siteId}
        definitionId={definitionId}
        definitionVersion={definitionVersion}
        fieldId={slot.constraints.storyPerRegionFor}
        path={pagePath}
      />
    )
  if (slot.kind === 'text' && typeof slot.constraints?.storyRegionFor === 'string')
    return (
      <StoryStartRegionField
        id={id}
        value={value}
        onChange={onChange}
        siteId={siteId}
        definitionId={definitionId}
        definitionVersion={definitionVersion}
        fieldId={slot.constraints.storyRegionFor}
      />
    )
  if (typeof slot.constraints?.storyViewFor === 'string')
    return (
      <StoryStartViewField
        id={id}
        value={value}
        onChange={onChange}
        siteId={siteId}
        definitionId={definitionId}
        definitionVersion={definitionVersion}
        fieldId={slot.constraints.storyViewFor}
      />
    )
  if (slot.kind === 'repeat' && slot.constraints?.storyFeed === true)
    return (
      <StoriesFeedField
        id={id}
        value={value}
        onChange={onChange}
        siteId={siteId}
        definitionId={definitionId}
        definitionVersion={definitionVersion}
        fieldId={slot.id}
        path={pagePath}
        world={slot.constraints.storyWidget === 'world'}
        split={slot.constraints.storyWidget === 'split'}
      />
    )
  if (slot.kind === 'text' && slot.constraints?.presentation === 'cms-date-calendar-v1')
    return <input id={id} type="date" value={String(value ?? '')} onChange={event => onChange(event.target.value)} />
  if (slot.kind === 'text' && slot.constraints?.multiline === true)
    return <textarea id={id} rows={3} value={String(value ?? '')} onChange={event => onChange(event.target.value)} />
  if (slot.kind === 'text' && Array.isArray(slot.constraints?.choices)) {
    const choices = slot.constraints.choices.filter(
      (choice): choice is { value: string; label: string } =>
        Boolean(choice) &&
        typeof choice === 'object' &&
        typeof choice.value === 'string' &&
        typeof choice.label === 'string',
    )
    return (
      <select id={id} value={String(value ?? '')} onChange={event => onChange(event.target.value)}>
        {choices.map(choice => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    )
  }
  if (slot.kind === 'repeat')
    return (
      <CollectionField
        key={`${definitionId}:${definitionVersion}:${slot.id}`}
        id={id}
        value={value}
        siteId={siteId}
        definitionId={definitionId}
        version={definitionVersion}
        fieldId={slot.id}
        onChange={onChange}
        onEditList={onEditList}
      />
    )
  if (isDrawingSlot(slot)) return <DrawingField id={id} value={value} onChange={onChange} />
  if (isIconSlot(slot)) return <IconPicker id={id} value={value} onChange={onChange} />
  if (slot.kind === 'richtext') {
    return (
      <RichTextField
        key={`${definitionId}:${definitionVersion}:${slot.id}`}
        id={id}
        labelId={`field-label-${id}`}
        value={String(value ?? '')}
        history="page"
        sourceMode={canAdvanced || originalDesign === true}
        constraints={slot.constraints}
        onChange={next => onChange(next)}
      />
    )
  }

  if (slot.kind === 'link' && isGovernedEmbedKind(slot.constraints?.['embed'])) {
    return (
      <EmbedField
        key={id}
        id={id}
        kind={slot.constraints['embed']}
        value={value}
        onChange={onChange}
        help={typeof slot.constraints['embedHelp'] === 'string' ? slot.constraints['embedHelp'] : ''}
      />
    )
  }
  if (slot.kind === 'link' || slot.kind === 'button') {
    if (!originalDesign && ['page', 'pdf'].includes(String(slot.constraints?.reportLink)))
      return (
        <ReportLinkField
          key={id}
          id={id}
          kind={slot.constraints?.reportLink === 'pdf' ? 'pdf' : 'page'}
          value={value}
          siteId={siteId}
          targets={linkTargets}
          onChange={onChange}
          onEditStart={onBeginLinkEdit}
        />
      )
    if (!originalDesign)
      return (
        <LinkSettings
          onEditStart={onBeginLinkEdit}
          key={id}
          id={id}
          value={value}
          targets={linkTargets}
          onChange={onChange}
          destinationOnly={slot.constraints?.destinationOnly === true}
          advanced={
            canAdvanced ? (
              <ButtonAppearanceField
                id={id}
                value={value && typeof value === 'object' ? (value as Record<string, unknown>) : {}}
                colors={themeColors}
                customCode={customCode}
                onChange={onChange}
              />
            ) : undefined
          }
        />
      )
    return (
      <LinkField
        key={id}
        id={id}
        value={value}
        targets={linkTargets}
        onChange={onChange}
        grouped={grouped}
        destinationOnly={slot.constraints?.destinationOnly === true}
        themeColors={themeColors}
        customCode={customCode}
      />
    )
  }
  if (slot.kind === 'image') {
    return (
      <ImageField
        id={id}
        value={value}
        siteId={siteId}
        mediaAssets={mediaAssets}
        imagePreviews={imagePreviews}
        originalDesign={originalDesign}
        supportsFocus={supportsFocus}
        onChange={onChange}
      />
    )
  }

  const text = String(value ?? '')
  // Only report contrast when the value is a supported color.
  const verdict = /^#|^rgb/i.test(text.trim()) ? checkContrast(text, '#ffffff') : null

  return (
    <>
      <input id={id} type="text" value={text} onChange={event => onChange(event.target.value)} />
      {verdict && (
        <p className={verdict.passesAA ? 'hint' : 'warn-inline'}>
          <span className="swatch" style={{ background: text }} aria-hidden="true" />
          {verdict.message}
        </p>
      )}
    </>
  )
}
