// Deliberately local-only: never loads .env, accepts a remote URL or resets data.
import { Client } from 'pg'
import { installCoreLibrary } from './core-install.ts'
const owner = new Client({ connectionString: 'postgres://cms:cms@127.0.0.1:54329/cms_demo' })
const authenticated = new Client({ connectionString: 'postgres://cms_admin_app:devpassword@127.0.0.1:54329/cms_demo' })
try {
  await owner.connect()
  const actor = (
    await owner.query<{ id: string }>(
      "SELECT u.id FROM app_users u JOIN global_roles r ON r.user_id=u.id WHERE u.email='admin@example.test' AND r.role='super_admin'",
    )
  ).rows[0]
  if (!actor)
    throw new Error('The existing local demo administrator is missing. Start the demo first; no account was created.')
  await authenticated.connect()
  await authenticated.query('BEGIN')
  await authenticated.query("SELECT set_config('app.user_id',$1,true)", [actor.id])
  const result = await installCoreLibrary(authenticated)
  await authenticated.query('COMMIT')
  console.log(
    `Core library: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged. Existing page pins and drafts were preserved.`,
  )
} catch (error) {
  await authenticated.query('ROLLBACK').catch(() => {})
  console.error(error instanceof Error ? error.message : 'The core library could not be installed.')
  process.exitCode = 1
} finally {
  await authenticated.end().catch(() => {})
  await owner.end().catch(() => {})
}
