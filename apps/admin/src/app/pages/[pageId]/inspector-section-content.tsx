import dynamic from 'next/dynamic'
import {
  dataValueBindings,
  numberChoiceValues,
  usesSiteSocialAccounts,
  siteSocialGroup,
  siteSocialHidesSampleNote,
  isDrawingSlot,
  isIconSlot,
  sampleFieldNames,
  repeatItemSlotId,
  repeatItemSpec,
  isHeroSlides,
} from '@cms/schema'
import { captureFieldEdit, isSectionNew, isSlotChanged, type EditorState } from '@cms/domain'
import { IconButton, TextLink } from '../../../components/ui/index.ts'
import { SlotIcon } from '../../../components/icons.tsx'
import { inspectorFieldGroups, linkWordsName } from '../../../lib/inspector-groups.ts'
import { OptionalIntroduction } from './optional-introduction.tsx'
import { ContentRepeatPanel } from './content-repeat-panel.tsx'
import { HeroSlidesPanel } from './hero-slides-panel.tsx'
import { SlotField } from './inspector-fields/slot-field.tsx'
import { RepeatList } from './inspector-fields/repeat-list.tsx'
import type { InspectorProps } from './inspector.tsx'
import styles from './inspector.module.css'

const DataValueField = dynamic(() => import('./data-value-field.tsx').then(module => module.DataValueField))

export function InspectorSectionContent({
  props,
  index,
  section,
  slots,
}: {
  props: InspectorProps
  index: number
  section: EditorState['document']['sections'][number]
  slots: NonNullable<InspectorProps['entry']>['slots']
}) {
  const { state, entry } = props
  const isNew = isSectionNew(state, index)
  const samples = new Set(sampleFieldNames(section.values))
  const bindings = dataValueBindings(section.values)
  const siteSocial = usesSiteSocialAccounts(section.values, slots, entry?.slug)

  function renderFields() {
    const row = (slot: (typeof slots)[number], label: string, className: string, grouped = false) => {
      const changed = !isNew && isSlotChanged(state, index, slot.id)
      const id = `slot-${index}-${slot.id}`
      return (
        <div
          className={className}
          key={slot.id}
          data-inspector-slot={slot.id}
          data-selected={className === 'field' && state.selection.slot === slot.id ? 'true' : undefined}
        >
          <div className="field-head">
            <label id={`field-label-${id}`} htmlFor={slot.kind === 'richtext' ? undefined : id}>
              {!grouped && (
                <span className="field-kind">
                  <SlotIcon kind={isIconSlot(slot) || isDrawingSlot(slot) ? 'icon' : slot.kind} size={13} />
                </span>
              )}
              {label}
            </label>
            {samples.has(slot.id) && <span className="chip chip-neutral">Sample</span>}
            {changed && (
              <IconButton
                variant="tertiary"
                size="s"
                tooltip={`Revert ${label} to the version when you opened this page`}
                onClick={() => props.onRevertSlot(slot.id)}
              >
                <span className="dot" aria-hidden="true" />
              </IconButton>
            )}
          </div>
          {(() => {
            const field = (
              <SlotField
                id={id}
                slot={slot}
                value={section.values[slot.id]}
                siteId={props.siteId}
                mediaAssets={props.mediaAssets}
                linkTargets={props.linkTargets}
                pagePath={props.metadataContext.path ?? '/'}
                imagePreviews={props.imagePreviews}
                originalDesign={props.originalDesign}
                supportsFocus={!props.originalDesign && entry?.image_focus_supported === true}
                definitionId={section.section_def_id}
                definitionVersion={section.section_def_version}
                themeColors={props.themeColors}
                onEditList={props.onEditList}
                customCode={Boolean(section.raw_html?.trim() || section.custom_css?.trim())}
                onBeginLinkEdit={() => {
                  const snapshot = captureFieldEdit(section.values, slot.id)
                  return () => props.onRestoreSlot(slot.id, snapshot)
                }}
                canAdvanced={props.canAdvanced}
                grouped={grouped}
                onChange={next => props.onChange(slot.id, next)}
              />
            )
            const bound = bindings[slot.id]
            const eligible =
              bound ||
              (slot.kind === 'text' &&
                (/^(number|value|amount|total|figure)$/i.test(slot.label) || slot.id.split('__').at(-1) === 'value'))
            return !props.originalDesign && props.pageId && eligible ? (
              <DataValueField
                id={id}
                pageId={props.pageId}
                binding={bound}
                onChange={(binding, value, label) =>
                  props.onValuesChange(numberChoiceValues(section.values, slot.id, binding, value, label), slot.id)
                }
              >
                {field}
              </DataValueField>
            ) : (
              field
            )
          })()}
        </div>
      )
    }
    const groupRow = (group: ReturnType<typeof inspectorFieldGroups<(typeof slots)[number]>>[number]) => {
      if (group.kind === 'single') return row(group.slot, group.slot.label, 'field')
      // An imported link: its words and where it goes, under its name.
      const members = [group.destination, ...group.words]
      const titleId = `link-group-${index}-${group.destination.id}`
      return (
        <div
          className="field link-group"
          key={group.destination.id}
          role="group"
          aria-labelledby={titleId}
          data-selected={members.some(slot => slot.id === state.selection.slot) ? 'true' : undefined}
        >
          <p className="link-group-title" id={titleId}>
            <span className="field-kind">
              <SlotIcon kind="link" size={13} />
            </span>
            {group.name}
          </p>
          {group.words.map(slot => row(slot, linkWordsName(group, slot), 'link-group-row', true))}
          {row(group.destination, 'Where it goes', 'link-group-row', true)}
        </div>
      )
    }
    const focusedRepeat = !props.originalDesign
      ? slots.find(slot => repeatItemSpec(slot) && state.selection.slot?.startsWith(slot.id + '__'))
      : null
    return inspectorFieldGroups(slots).map(group => {
      if (focusedRepeat && (group.kind !== 'single' || group.slot.id !== focusedRepeat.id)) return null
      if (
        group.kind === 'single' &&
        group.slot.id === 'sample_note' &&
        siteSocialHidesSampleNote(entry?.slug) &&
        siteSocial
      )
        return null
      if (group.kind === 'single' && group.slot.id === siteSocialGroup(slots) && siteSocial)
        return (
          <p key="site-social-accounts" className="hint">
            These accounts come from site Settings.{' '}
            {props.canEditSiteLook !== false ? (
              <TextLink href={'/sites/' + props.siteId + '/settings/social'}>Open Social accounts</TextLink>
            ) : (
              'An Admin can change them.'
            )}
          </p>
        )
      const spec = group.kind === 'single' ? repeatItemSpec(group.slot) : null
      if (
        !props.originalDesign &&
        group.kind === 'single' &&
        group.slot.id === 'intro' &&
        group.slot.kind === 'richtext' &&
        group.slot.constraints?.required !== true &&
        slots.some(slot => repeatItemSpec(slot))
      )
        return (
          <OptionalIntroduction
            key={state.sectionOrigins[index] + ':intro'}
            value={section.values.intro}
            focused={state.selection.slot === 'intro'}
          >
            {groupRow(group)}
          </OptionalIntroduction>
        )
      if (group.kind !== 'single' || !spec) return groupRow(group)
      if (isHeroSlides(group.slot))
        return (
          <HeroSlidesPanel
            key={state.sectionOrigins[index] + ':' + group.slot.id}
            slot={group.slot}
            spec={spec}
            values={section.values}
            selected={state.selection.slot}
            onValuesChange={props.onValuesChange}
            siteId={props.siteId}
            canChooseStories={props.canChooseStories === true}
            media={props.mediaAssets}
            pageId={props.pageId}
            definitionId={section.section_def_id}
            definitionVersion={section.section_def_version}
            publishedValues={props.publishedHeroValues}
            canStyle={props.canAdvanced}
            targets={props.linkTargets}
            renderField={(key, id) => {
              const field = spec.fields.find(field => field.id === id)
              return field
                ? row({ ...field, id: repeatItemSlotId(group.slot.id, key, field.id) }, field.label, 'field')
                : null
            }}
            renderItem={key =>
              inspectorFieldGroups(
                ['photo', 'title', 'intro', 'primary', 'secondary']
                  .flatMap(id => spec.fields.filter(field => field.id === id))
                  .map(field => ({ ...field, id: repeatItemSlotId(group.slot.id, key, field.id) })),
              ).map(groupRow)
            }
          />
        )
      if (!props.originalDesign)
        return (
          <ContentRepeatPanel
            key={state.sectionOrigins[index] + ':' + group.slot.id}
            origin={state.sectionOrigins[index]!}
            slot={group.slot}
            spec={spec}
            values={section.values}
            selected={state.selection.slot}
            onValuesChange={props.onValuesChange}
            onDiscardEmpty={props.onDiscardEmptyRepeat}
            renderItem={key =>
              inspectorFieldGroups(
                spec.fields.map(field => ({
                  ...field,
                  id: repeatItemSlotId(group.slot.id, key, field.id),
                })),
              ).map(groupRow)
            }
          />
        )
      return (
        <RepeatList
          key={group.slot.id}
          index={index}
          slot={group.slot}
          spec={spec}
          values={section.values}
          selected={state.selection.slot}
          onValuesChange={props.onValuesChange}
          renderItem={key =>
            inspectorFieldGroups(
              spec.fields.map(field => ({ ...field, id: repeatItemSlotId(group.slot.id, key, field.id) })),
            ).map(groupRow)
          }
        />
      )
    })
  }

  return (
    <div className={styles.content}>
      {!props.canAdvanced && Boolean(section.custom_css?.trim() || section.raw_html?.trim()) && (
        <p className="notice notice-info">
          This section contains preserved custom code. Only an administrator can change it. Content fields remain
          available.
        </p>
      )}
      {section.values.__cms_report_links === true && (
        <p className="hint">Add a web page or a PDF, or both. The buttons show only for what exists.</p>
      )}
      {entry?.slug === 'core-report-page-links' && (
        <p className="hint">
          Made from this page. These links follow visible sections with a link name and a heading. Change a heading to
          change its words, or use the section’s Page link label for a shorter name. An Admin can choose Change link
          name from a section’s menu.
        </p>
      )}
      {slots.length === 0 && (
        <p className="muted">
          {props.canManageSections === false
            ? 'This section has no content fields. A Site admin can change its layout.'
            : 'This section has no editable fields. You can move or hide it here; its content follows its saved layout.'}
        </p>
      )}

      {renderFields()}
    </div>
  )
}
