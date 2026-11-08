import { NextResponse } from 'next/server'
import { notFound } from 'next/navigation'
import { acceptInvite, asUser, localSessionCookieSecure, SESSION_COOKIE } from '@cms/platform'
import { authProvider } from '../../../lib/session.ts'
import { localChapterMailOrigin } from '../../../lib/local-chapter-mail.ts'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const origin = localChapterMailOrigin()
  if (!origin) notFound()
  const provider = authProvider()
  if (provider.name !== 'local' || !provider.issue) notFound()
  let destination = '/sign-in?error=expired-link'
  let sessionToken: string | undefined
  try {
    const code = new URL(request.url).searchParams.get('code') ?? ''
    const identity = await asUser(
      { userId: null },
      async client =>
        (
          await client.query<{ user_id: string; email: string; page_id: string }>(
            'SELECT * FROM app.consume_local_chapter_sign_in($1)',
            [code],
          )
        ).rows[0],
    )
    if (identity) {
      const subject = {
        subject: 'local|' + identity.email,
        email: identity.email,
        authenticatedAt: Math.floor(Date.now() / 1000),
      }
      await acceptInvite(subject)
      sessionToken = await provider.issue(subject)
      destination = '/pages/' + identity.page_id
    }
  } catch {
    destination = '/sign-in?error=expired-link'
    sessionToken = undefined
  }
  const response = NextResponse.redirect(new URL(destination, origin), 303)
  response.headers.set('cache-control', 'no-store, private')
  response.headers.set('referrer-policy', 'no-referrer')
  if (sessionToken)
    response.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: localSessionCookieSecure(),
      path: '/',
      maxAge: 3600,
    })
  return response
}
