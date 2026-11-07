import { useEffect, useState } from 'react'
import { clipboardKey, readSectionClipboard, type SectionClipboard } from '../../../lib/section-clipboard.ts'

/** Load the same person's saved section copy for this site. */
export function useEditorSectionClipboard(props: { userId: string; siteId: string }) {
  const [copiedSection, setCopiedSection] = useState<SectionClipboard | null>(null)
  const [pasting, setPasting] = useState(false)
  useEffect(() => {
    try {
      setCopiedSection(
        readSectionClipboard(
          localStorage.getItem(clipboardKey(props.userId, props.siteId)),
          props.userId,
          props.siteId,
        ),
      )
    } catch {
      /* Session copy remains available when storage is disabled. */
    }
  }, [props.userId, props.siteId])
  return { copiedSection, setCopiedSection, pasting, setPasting }
}
