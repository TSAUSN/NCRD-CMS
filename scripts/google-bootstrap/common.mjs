import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const phases = ['infrastructure', 'database', 'media', 'build', 'deploy', 'hosting', 'operations', 'verify']
export const apis = [
  'serviceusage',
  'cloudresourcemanager',
  'iam',
  'run',
  'sqladmin',
  'storage',
  'artifactregistry',
  'cloudbuild',
  'secretmanager',
  'firebase',
  'firebasehosting',
  'cloudscheduler',
  'monitoring',
  'logging',
]
export const roles = ['admin', 'site', 'worker', 'operator', 'builder', 'scheduler']
export const kept = ['sawso', 'echelon-chapters', 'echelon']
export const wait = ms => new Promise(done => setTimeout(done, ms))
export const name = (c, role) => c.servicePrefix + '-' + role
export const identity = (c, role) => `cms-${role}@${c.projectId}.iam.gserviceaccount.com`
export const bucket = (c, role) => c.projectId + '-' + role
export const imageRoot = c => `${c.region}-docker.pkg.dev/${c.projectId}/cms-v2/app`
export const origin = (c, role) => `https://${name(c, role)}-${c.projectNumber}.${c.region}.run.app`

export function local(program, args, env = process.env) {
  const result = spawnSync(program, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0) throw Error(`${program} failed; private output omitted. No later step ran.`)
  return result.stdout.trim()
}
export function receipt(c, key, value) {
  writeFileSync(join(c.privateDirectory, key + '.json'), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
}
export function readReceipt(c, key) {
  return JSON.parse(readFileSync(join(c.privateDirectory, key + '.json'), 'utf8'))
}

/** gcloud uses --tier for shared cores, CPU/memory for dedicated Enterprise. */
export function sqlMachineArgs(tier) {
  if (tier === 'db-custom-1-3840') return ['--cpu=1', '--memory=3840MiB']
  if (['db-f1-micro', 'db-g1-small'].includes(tier)) return ['--tier=' + tier]
  throw Error('Choose the reviewed bounded SQL tier.')
}
