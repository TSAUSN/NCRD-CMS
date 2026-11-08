'use client'
import type { HeaderConfigV1, FooterConfigV1, GlobalElementLink } from '@cms/schema'
import { type FramePageChoice, type FrameMediaChoice, type LinkLocation } from './preset-frame-links.tsx'
import { PresetHeaderIdentity, PresetHeaderLinks } from './preset-header-fields.tsx'
import {
  PresetFooterLayout,
  PresetFooterGroups,
  PresetFooterContact,
  PresetFooterPolicyLinks,
} from './preset-footer-fields.tsx'
import styles from './preset-frame-fields.module.css'

export type { FramePageChoice, FrameMediaChoice } from './preset-frame-links.tsx'

export function PresetFrameFields({
  siteId,
  part,
  header,
  footer,
  canManage,
  superAdmin,
  media,
  pages,
  siteName,
  compact = false,
  identityControls = true,
  socialSettingsHref,
  onHeader,
  onFooter,
}: {
  siteId: string
  part: 'header' | 'footer'
  header: HeaderConfigV1
  footer: FooterConfigV1
  canManage: boolean
  superAdmin: boolean
  media: FrameMediaChoice[]
  pages: FramePageChoice[]
  siteName: string
  compact?: boolean
  identityControls?: boolean
  socialSettingsHref?: string
  onHeader: (header: HeaderConfigV1) => void
  onFooter: (footer: FooterConfigV1) => void
}) {
  const setPresetHeader = (update: (current: HeaderConfigV1) => HeaderConfigV1) => {
    if (canManage) onHeader(update(header))
  }
  const setPresetFooter = (update: (current: FooterConfigV1) => FooterConfigV1) => {
    if (canManage) onFooter(update(footer))
  }
  const publishedPages = pages.filter(page => page.published)
  function updateLink(location: LinkLocation, next: GlobalElementLink | null) {
    if (location.area === 'header-utility') {
      setPresetHeader(current => ({
        ...current,
        utilityLinks:
          next === null
            ? current.utilityLinks.filter((_, index) => index !== location.index)
            : current.utilityLinks.map((link, index) => (index === location.index ? next : link)),
      }))
    } else if (location.area === 'header-cta') setPresetHeader(current => ({ ...current, cta: next }))
    else if (location.area === 'footer-legal') {
      setPresetFooter(current => ({ ...current, legal: { ...current.legal, [location.key]: next } }))
    } else {
      setPresetFooter(current => ({
        ...current,
        groups: current.groups.map((group, groupIndex) =>
          groupIndex !== location.groupIndex
            ? group
            : {
                ...group,
                links:
                  next === null
                    ? group.links.filter((_, index) => index !== location.index)
                    : group.links.map((link, index) => (index === location.index ? next : link)),
              },
        ),
      }))
    }
  }

  return (
    <div key={part} className={styles.fields}>
      {part === 'header' ? (
        <>
          <PresetHeaderIdentity
            header={header}
            setPresetHeader={setPresetHeader}
            canManage={canManage}
            compact={compact}
            identityControls={identityControls}
            media={media}
            siteId={siteId}
          />
          <PresetHeaderLinks
            header={header}
            setPresetHeader={setPresetHeader}
            canManage={canManage}
            publishedPages={publishedPages}
            updateLink={updateLink}
          />
        </>
      ) : (
        <>
          <PresetFooterLayout
            footer={footer}
            setPresetFooter={setPresetFooter}
            canManage={canManage}
            superAdmin={superAdmin}
            compact={compact}
          />
          <PresetFooterGroups
            footer={footer}
            setPresetFooter={setPresetFooter}
            canManage={canManage}
            publishedPages={publishedPages}
            updateLink={updateLink}
          />
          <PresetFooterContact footer={footer} setPresetFooter={setPresetFooter} canManage={canManage} />
          <PresetFooterPolicyLinks
            footer={footer}
            setPresetFooter={setPresetFooter}
            canManage={canManage}
            publishedPages={publishedPages}
            updateLink={updateLink}
            siteName={siteName}
            socialSettingsHref={socialSettingsHref}
          />
        </>
      )}
    </div>
  )
}
