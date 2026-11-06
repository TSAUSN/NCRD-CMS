/** E2E setup drops its database. Validate the entire disposable target before
 * opening a connection or starting the test applications. */
export function e2eTarget(env: Record<string, string | undefined> = process.env) {
  const database = env['E2E_DATABASE'] ?? 'cms_e2e'
  const host = env['E2E_PG_HOST'] ?? '127.0.0.1'
  const port = env['E2E_PG_PORT'] ?? '54329'
  if (!/^cms_e2e(?:_[a-z0-9_]+)?$/.test(database) || database.length > 63) {
    throw new Error(
      'E2E_DATABASE must be cms_e2e or cms_e2e_<lowercase fixture name>, at most 63 characters. Only disposable test databases may be reset.',
    )
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(
      'E2E_PG_HOST must be 127.0.0.1 or localhost. The destructive E2E reset is restricted to a local disposable PostgreSQL instance.',
    )
  }
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('E2E_PG_PORT must be a TCP port from 1 to 65535.')
  }
  return { database, host, port }
}
