// The one place the required Node major is enforced at runtime. package.json's
// `engines` is advisory unless a package manager is configured to enforce it,
// and a mismatch otherwise surfaces as a confusing downstream failure.
const required = 24
const [major] = process.versions.node.split('.').map(Number)

if (major !== required) {
  console.error(
    `\ncms-v2 requires Node ${required}.x — this shell is running ${process.versions.node}.\n` +
      `The repository pins it in .nvmrc and .node-version:\n\n` +
      `  nvm use     # or: fnm use\n\n` +
      `Development, CI, and the reference container all run one Node major on purpose (SPEC §2).\n`,
  )
  process.exit(1)
}
