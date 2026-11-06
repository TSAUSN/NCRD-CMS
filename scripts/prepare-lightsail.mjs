// Compatibility entrypoint for existing single-server release configurations.
import { pathToFileURL } from 'node:url'
import { vmFiles, prepareVm } from './prepare-vm.mjs'
export { vmFiles as lightsailFiles }

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [configPath, destination] = process.argv.slice(2)
  if (!configPath || !destination)
    throw Error('Usage: node scripts/prepare-lightsail.mjs CONFIG_JSON NEW_PRIVATE_DIRECTORY')
  prepareVm(configPath, destination)
}
