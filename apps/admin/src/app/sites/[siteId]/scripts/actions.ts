'use server'
import { SiteFileBundle } from '@cms/schema'
import { asUser } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { revalidatePath } from 'next/cache'
import { currentSession } from '../../../../lib/session.ts'
export async function approveSiteFiles(
  siteId: string,
  expectedRevision: string,
  input: unknown,
  reviewed: boolean,
): Promise<{ ok: true; revision: string; versionId: string } | { ok: false; message: string }> {
  const session = await currentSession(),
    bundle = SiteFileBundle.safeParse(input)
  if (!session?.principal.isSuperAdmin) return { ok: false, message: 'Only a Super Admin can approve site scripts.' }
  if (!reviewed || !bundle.success || !/^\d+$/.test(expectedRevision))
    return { ok: false, message: 'Review the complete file list, sources and loading choices before approving.' }
  try {
    const saved = await asUser(
      { userId: session.principal.userId },
      async client =>
        (
          await client.query<{ revision: string; version_id: string }>(
            'SELECT * FROM app.save_site_file_bundle($1,$2,$3)',
            [siteId, expectedRevision, JSON.stringify(bundle.data)],
          )
        ).rows[0]!,
    )
    revalidatePath('/sites/' + siteId + '/scripts')
    revalidatePath('/sites/' + siteId + '/publishing')
    return { ok: true, revision: saved.revision, versionId: saved.version_id }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'The reviewed files could not be saved. Your choices are still here; refresh the current version before trying again.',
    }
  }
}
