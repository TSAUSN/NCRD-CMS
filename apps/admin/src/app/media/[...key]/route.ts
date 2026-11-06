// Serving a stored media object back (SPEC §6.11).
//
// The worker writes section thumbnails into the media store and records the
// object key on the definition version; the library reads that key and renders
// an `<img>`. Without this route the two halves never meet: every card's picture
// is a 404, and the only evidence is a broken image in a grid that otherwise
// looks finished.
//
// FOUR THINGS THIS ROUTE HAS TO GET RIGHT
//
// It is behind the session. Media belongs to a tenant, and an admin route that
// served objects to anybody with a key would be a way to enumerate one tenant's
// uploads from another's browser. Thumbnails happen to be renders of global
// section definitions, but this route is the door for every object the store
// will ever hold, and "the only thing behind it today is harmless" is not a
// property that survives the next feature.
//
// It never trusts the key. The store joins the key onto a directory, so a key
// containing `..` reads whatever the process can read. The grammar below is
// deliberately narrower than anything the store produces — lowercase hex, digits
// and a single dot before a known extension — rather than a blocklist of the
// traversal spellings somebody has thought of.
//
// It never echoes a content type. The type is decided here from the extension,
// from a closed list, so a file whose bytes somebody else chose cannot also
// choose the header that says how to interpret them. `nosniff` closes the other
// half of that.
//
// The object is immutable, but access is not: membership may be revoked. Admin
// delivery is therefore no-store so every preview re-checks the session/RLS.
import { notFound } from 'next/navigation'
import { asUser, configuredMediaStore } from '@cms/platform'
import { currentSession } from '../../../lib/session.ts'

export const dynamic = 'force-dynamic'

const THUMBNAIL_KEY = /^section-thumbnails\/[0-9a-f-]{36}\/v[1-9][0-9]*\/[a-f0-9]{16}\/[a-f0-9]{32}\.png$/

export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }): Promise<Response> {
  const session = await currentSession()
  if (!session) notFound()

  const { key } = await context.params
  const objectKey = key.join('/')
  if (!THUMBNAIL_KEY.test(objectKey)) notFound()

  // `thumbnail_path` is resolved inside the current user transaction. Global
  // definitions are visible to active users; a site definition is visible only
  // to a member of that site. Knowing an internal object key is never authority.
  const visible = await asUser(
    { userId: session.principal.userId },
    async client =>
      (await client.query('SELECT 1 FROM section_def_versions WHERE thumbnail_path = $1 LIMIT 1', [objectKey]))
        .rowCount === 1,
  )
  if (!visible) notFound()

  const bytes = await configuredMediaStore().get(objectKey)
  if (bytes === null) notFound()

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'content-type': 'image/png',
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      // Nothing in a stored object may act as a document, whatever its bytes
      // turn out to be.
      'content-security-policy': "default-src 'none'; sandbox",
      'content-disposition': 'inline',
    },
  })
}
