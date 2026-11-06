import { renderPage, type SectionDefView } from '@cms/renderer'
import type { SlotDef, StructuredDocument } from '@cms/schema'
import { definitionPreviewValues } from './definition-preview.ts'
import { SCRIPTLESS_RENDER_OPTIONS } from './scriptless-preview.ts'
import type { SitePreview } from './site-preview.ts'

/** A component preview uses its real placement and the chosen site's menu.
 * Sample values are preview-only; this helper does not create content. */
export function renderDefinitionPreview({
  definition,
  name,
  placement = 'page',
  preview,
}: {
  definition: SectionDefView & { slots: SlotDef[]; structured_doc?: StructuredDocument | null }
  name: string
  placement?: 'page' | 'header' | 'footer'
  preview: SitePreview
}): string {
  const instance = {
    section_def_id: definition.section_def_id,
    section_def_version: definition.version,
    values: definitionPreviewValues(definition.slots, definition.structured_doc ?? null),
  }
  const shell = { ...preview.shell }
  if (placement !== 'page') {
    shell[placement] = {
      schemaVersion: 2,
      enabled: true,
      ...(placement === 'header' ? { sticky: false } : {}),
      component: instance,
    }
    shell[`${placement}_component`] = definition
  }
  return renderPage({
    manifest: {
      page: { id: 'preview', version_id: 'preview', title: name, path: '/' },
      meta: { noindex: true },
      sections: placement === 'page' ? [{ def: definition, instance }] : [],
      fonts: preview.fonts,
    },
    shell,
    navigationPaths: { ...preview.navigationPaths, preview: '/' },
    isStaging: true,
    options: { ...SCRIPTLESS_RENDER_OPTIONS, sectionOnly: placement === 'page' },
  }).html
}
