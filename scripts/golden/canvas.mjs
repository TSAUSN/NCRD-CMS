import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client, privateDirectory } from './local.mjs'
import { get, artifact, hash } from './http.mjs'
/** Fixed tickets are disposable local fixture data, never deployed credentials.
 * A future-dated ten-minute fixture window (with the real constraint intact)
 * pins the same expiry/channel/token so we compare the complete instrumented
 * document without normalizing away any HTML or runtime metadata. */
export async function canvasPreviews(t, out, routes, cookie, manifest, statePath) {
  privateDirectory(dirname(statePath))
  let tickets
  if (existsSync(statePath)) tickets = JSON.parse(readFileSync(statePath, 'utf8'))
  else {
    const saved = spawnSync('pg_dump', ['--format=custom', '--file=' + join(out, 'before-canvas-fixture.dump')], {
      env: {
        ...process.env,
        PGHOST: t.host,
        PGPORT: t.port,
        PGUSER: t.user,
        PGPASSWORD: t.password,
        PGDATABASE: t.database,
      },
      encoding: 'utf8',
    })
    if (saved.status !== 0) throw Error('Back up golden fixture before issuing preview tickets.')
    const selected = routes.filter(
      r =>
        (r.slug === 'sawso' && r.path === '/ways-we-help/education') ||
        (r.slug === 'echelon-chapters' && ['/', '/chapters/atlanta'].includes(r.path)) ||
        (r.slug === 'echelon' && r.path === '/'),
    )
    if (selected.length !== 4) throw Error('Expected Education, national, Atlanta and Symposium golden previews.')
    tickets = []
    const origin = `http://127.0.0.1:${t.ports.admin}`
    const expiry = new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString()
    const db = new Client({ connectionString: t.url })
    await db.connect()
    try {
      for (const route of selected) {
        const response = await fetch(`${origin}/api/pages/${route.page_id}/canvas`, {
          method: 'POST',
          headers: { cookie, origin, 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'open',
            versionId: route.draft_version_id,
            sitePreview: 'draft',
            channel: 'golden_' + hash(route.page_id).slice(0, 32),
            showHidden: false,
          }),
          signal: AbortSignal.timeout(30000),
        })
        if (!response.ok) throw Error('Normal local canvas-ticket command failed; response omitted.')
        const value = await response.json()
        if (!/^[a-f0-9]{64}$/.test(value.token ?? '')) throw Error('Invalid local preview ticket.')
        const updated = await db.query(
          "UPDATE public.canvas_preview_tickets SET created_at=$1::timestamptz-interval '10 minutes',expires_at=$1 WHERE token_hash=encode(sha256(convert_to($2,'UTF8')),'hex') AND page_id=$3",
          [expiry, value.token, route.page_id],
        )
        if (updated.rowCount !== 1) throw Error('Could not pin local golden fixture ticket.')
        tickets.push({
          page: route.page_id,
          slug: route.slug,
          host: route.staging_hostname,
          version: route.draft_version_id,
          token: value.token,
          expiry,
          database: t.database,
          ports: t.ports,
        })
      }
      writeFileSync(statePath, JSON.stringify(tickets, null, 2), { mode: 0o600, flag: 'wx' })
    } finally {
      await db.end()
    }
  }
  if (!Array.isArray(tickets) || tickets.length !== 4) throw Error('Invalid private canvas fixture state.')
  for (const ticket of tickets) {
    if (
      ticket.database !== t.database ||
      JSON.stringify(ticket.ports) !== JSON.stringify(t.ports) ||
      Date.parse(ticket.expiry) <= Date.now() ||
      !/^[a-f0-9]{64}$/.test(ticket.token) ||
      !routes.some(
        r => r.page_id === ticket.page && r.draft_version_id === ticket.version && r.staging_hostname === ticket.host,
      )
    )
      throw Error(
        'Local canvas fixture expired or belongs to different data/ports. Capture a fresh explicit baseline; do not normalize it.',
      )
    for (const kind of ['editing', 'visitor']) {
      const path = '/__cms/canvas/' + ticket.token + (kind === 'visitor' ? '?visit=1' : '')
      const { bytes } = await get(t.ports.site, ticket.host, path)
      artifact(out, manifest, `canvas/${ticket.slug}/${ticket.page}-${kind}.html`, bytes)
    }
  }
  return tickets.length * 2
}
