/** Keep acceptance servers separate from the retained demo and other worktrees. */
export function e2ePorts(env: Record<string, string | undefined> = process.env) {
  const read = (key: 'E2E_ADMIN_PORT' | 'E2E_SITE_PORT', fallback: number) => {
    const value = env[key] ?? String(fallback)
    if (
      !/^\d{4,5}$/.test(value) ||
      Number(value) < 1024 ||
      Number(value) > 65535 ||
      [3000, 3001, 54329].includes(Number(value))
    )
      throw new Error(`${key} must be a dedicated TCP port from 1024 to 65535, outside retained demo ports.`)
    return Number(value)
  }
  const admin = read('E2E_ADMIN_PORT', 3200),
    site = read('E2E_SITE_PORT', 3201)
  if (admin === site) throw new Error('E2E_ADMIN_PORT and E2E_SITE_PORT must differ.')
  return { admin, site }
}
export const E2E_PORTS = e2ePorts()
export const ADMIN_ORIGIN = `http://127.0.0.1:${E2E_PORTS.admin}`
export const SITE_ORIGIN = `http://127.0.0.1:${E2E_PORTS.site}`
export const STAGING_ORIGIN = `http://demo.staging.localhost:${E2E_PORTS.site}`
export const SITE_PORT = E2E_PORTS.site
