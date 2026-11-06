import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const run = promisify(execFile)
export function postgresMajor(version: string): number {
  const match = /(?:PostgreSQL\)?\s+|^)(\d+)(?:\.\d+)?/.exec(version.trim())
  const major = Number(match?.[1])
  if (!Number.isSafeInteger(major) || major < 10 || major > 99)
    throw new Error('Could not identify the PostgreSQL major version.')
  return major
}
export async function installedPostgresMajor(tool: 'pg_dump' | 'pg_restore'): Promise<number> {
  const bin = process.env.CMS_PG_BIN
  if (bin && !bin.startsWith('/')) throw new Error('CMS_PG_BIN must be an absolute directory.')
  try {
    const { stdout } = await run(bin ? join(bin, tool) : tool, ['--version'], { timeout: 10000, maxBuffer: 16384 })
    return postgresMajor(stdout)
  } catch {
    throw new Error(`${tool} version could not be checked. Install PostgreSQL client tools and set CMS_PG_BIN.`)
  }
}
export function assertBackupVersion(serverMajor: number, clientMajor: number): void {
  if (clientMajor < serverMajor)
    throw new Error(
      `PostgreSQL ${serverMajor} requires pg_dump ${serverMajor} or newer; the installed client is ${clientMajor}.`,
    )
}
export function assertRestoreVersion(
  sourceMajor: number,
  dumpMajor: number,
  targetMajor: number,
  restoreMajor: number,
): void {
  const required = Math.max(sourceMajor, dumpMajor)
  if (targetMajor < required || restoreMajor < dumpMajor) {
    throw new Error(
      `This backup requires PostgreSQL ${required} or newer and pg_restore ${dumpMajor} or newer. The target was not modified.`,
    )
  }
}
