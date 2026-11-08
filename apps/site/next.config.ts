// Loads the repository .env when one exists. An environment variable that is
// already set always wins, so CI's own configuration is untouched.
import '../../scripts/load-env.ts'

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@cms/schema', '@cms/renderer', '@cms/domain', '@cms/platform'],
  // The public renderer emits complete documents itself; nothing here needs a
  // React runtime in the browser.
  poweredByHeader: false,
  // Neither app uses next/image. Switching the optimizer off removes its public
  // endpoint, the subject of Next.js advisories (AUTH-05, October 6).
  images: { unoptimized: true },
}

export default nextConfig
