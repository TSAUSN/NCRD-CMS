import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import { migrate, MIGRATIONS_DIR } from '../src/migrate/index.ts'
import { requireTestDatabase } from './harness.ts'

describe('hosted non-superuser migration owner bootstrap', () => {
  it('reproduces raw ownership failure then migrates without changing history or granting service-role CREATE', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const name = `cms_owner_bootstrap_${suffix}`
    const password = randomUUID()
    const admin = new Client({ connectionString: requireTestDatabase() })
    await admin.connect()
    let createdRole = false
    let createdDatabase = false
    try {
      // This is a real non-superuser deploy identity with its own fresh DB.
      // The shared NOLOGIN role already exists from integration setup; PG16+
      // requires ADMIN OPTION for 0000's explicit grant of an existing role.
      await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS CREATEROLE INHERIT`)
      createdRole = true
      await admin.query(`GRANT cms_migration_owner TO ${name} WITH ADMIN OPTION`)
      await admin.query(`CREATE DATABASE ${name} OWNER ${name}`)
      createdDatabase = true
      const url = new URL(requireTestDatabase())
      url.username = name
      url.password = password
      url.pathname = `/${name}`
      const before = await migrate(url.toString(), { through: '0001_core.sql' })
      expect(before).toHaveLength(2)
      const deploy = new Client({ connectionString: url.toString() })
      await deploy.connect()
      try {
        expect(
          (await deploy.query('SELECT rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0],
        ).toEqual({ rolsuper: false, rolcreaterole: true })
        await deploy.query('BEGIN')
        await expect(
          deploy.query(await readFile(join(MIGRATIONS_DIR, '0002_grants_rls.sql'), 'utf8')),
        ).rejects.toMatchObject({ code: '42501' })
        await deploy.query('ROLLBACK')
      } finally {
        await deploy.end()
      }

      const after = await migrate(url.toString(), { through: '0002_grants_rls.sql' })
      expect(after.slice(0, 2).map(row => [row.name, row.checksum])).toEqual(
        before.map(row => [row.name, row.checksum]),
      )
      expect(after[2]!.alreadyApplied).toBe(false)
      expect((await migrate(url.toString(), { through: '0002_grants_rls.sql' })).every(row => row.alreadyApplied)).toBe(
        true,
      )
      const inspect = new Client({ connectionString: url.toString() })
      await inspect.connect()
      try {
        const owner = (
          await inspect.query(
            "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='public.sites'::regclass",
          )
        ).rows[0]
        expect(owner.owner).toBe('cms_migration_owner')
        const grants = await inspect.query(`SELECT role, schema,
          has_schema_privilege(role,schema,'CREATE') AS can_create
          FROM unnest(ARRAY['cms_authenticated_user','cms_public_renderer','cms_worker']) role
          CROSS JOIN unnest(ARRAY['public','app','public_api']) schema`)
        expect(grants.rows).toHaveLength(9)
        expect(grants.rows.every(row => row.can_create === false)).toBe(true)
      } finally {
        await inspect.end()
      }
    } finally {
      if (createdDatabase) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      if (createdRole) await admin.query(`DROP ROLE IF EXISTS ${name}`)
      await admin.end()
    }
  })
})
