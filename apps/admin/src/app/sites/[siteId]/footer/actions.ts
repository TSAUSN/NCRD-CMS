'use server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError, mapErrors } from '@cms/domain'
import { FooterConfig } from '@cms/schema'
import { currentSession } from '../../../../lib/session.ts'
import { saveFooterDraft } from '../../../../lib/footer-draft.ts'
export async function saveFooter(input: {
  siteId: string
  headerRevision: number
  footerRevision: number
  footer: unknown
}) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before saving.' }
  const footer = FooterConfig.safeParse(input.footer)
  if (!footer.success) return { ok: false as const, message: 'Check the footer fields before saving.' }
  try {
    const saved = await mapErrors(() =>
      asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
        saveFooterDraft(client, { ...input, footer: footer.data }),
      ),
    )
    revalidatePath(`/sites/${input.siteId}/footer`)
    revalidatePath(`/sites/${input.siteId}/publishing`)
    return { ok: true as const, ...saved, message: 'Footer draft saved. Visitors still see the published version.' }
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof DomainError
          ? error.message
          : 'The save could not be confirmed. Your changes are still here. Reload to compare before trying again.',
    }
  }
}
