import type { Client } from 'pg'

/**
 * PostgreSQL checks a proposed object's owner has CREATE on its containing
 * schema. Hosted migration logins are not superusers, so the bootstrap must
 * establish those prerequisites before historical 0002 transfers ownership.
 * Keep this deployment preflight outside the immutable migration history.
 */
export async function prepareMigrationOwnerSchemas(client: Client): Promise<void> {
  const owner = (
    await client.query<{ rolcanlogin: boolean }>(
      "SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname='cms_migration_owner'",
    )
  ).rows[0]
  if (!owner) throw new Error('CMS ownership preflight requires migration 0000 to create cms_migration_owner first.')
  if (owner.rolcanlogin) throw new Error('CMS ownership preflight refused: cms_migration_owner must be a NOLOGIN role.')
  const schemas = (
    await client.query<{ nspname: string }>(
      "SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname IN ('public','app','public_api')",
    )
  ).rows
  if (schemas.length !== 3)
    throw new Error(
      'CMS ownership preflight requires the existing public, app and public_api schemas from migration 0000.',
    )
  // Literal role/schema names. No grants to PUBLIC or ordinary service roles,
  // no LOGIN, no BYPASSRLS, and no change to membership or default privileges.
  await client.query('GRANT USAGE, CREATE ON SCHEMA public, app, public_api TO cms_migration_owner')
}
