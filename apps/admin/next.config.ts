// Loads the repository .env when one exists. An environment variable that is
// already set always wins, so CI's own configuration is untouched.
import '../../scripts/load-env.ts'

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@cms/schema', '@cms/renderer', '@cms/seeds', '@cms/domain', '@cms/platform'],
  poweredByHeader: false,
  // The proxy needs to tell a Flight request from a new HTML document.
  // The default normalization removes the Flight headers before it runs.
  skipProxyUrlNormalize: true,
  // Neither app uses next/image. Switching the optimizer off removes its public
  // endpoint, the subject of Next.js advisories (AUTH-05, October 6).
  images: { unoptimized: true },
}

export default nextConfig
