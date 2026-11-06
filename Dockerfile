# One artifact: admin/site web apps, worker, migrate, drain and local seed roles.
# Build the separate `recovery` target with a client matching the hosted database.
ARG POSTGRES_MAJOR=17
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json           apps/admin/
COPY apps/site/package.json            apps/site/
COPY apps/worker/package.json          apps/worker/
COPY packages/schema/package.json      packages/schema/
COPY packages/domain/package.json      packages/domain/
COPY packages/platform/package.json    packages/platform/
COPY packages/renderer/package.json    packages/renderer/
COPY packages/seeds/package.json       packages/seeds/
COPY packages/importer/package.json    packages/importer/
COPY scripts/package.json              scripts/
COPY e2e/package.json                  e2e/
RUN pnpm install --frozen-lockfile

# Keep the installed workspace and its store together. A fresh base plus copied
# links cannot reliably reinstall offline without copying the package store too.
FROM deps AS build
COPY . .
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV NEXT_DEPLOYMENT_ID=${APP_VERSION}
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter admin build && pnpm --filter site build

FROM postgres:${POSTGRES_MAJOR}-bookworm AS recovery
ARG POSTGRES_MAJOR
ENV CMS_POSTGRES_MAJOR=${POSTGRES_MAJOR}
COPY --from=base /usr/local/bin/node /usr/local/bin/node
COPY --from=build /app /app
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV NEXT_DEPLOYMENT_ID=${APP_VERSION}
ENV NODE_ENV=production
WORKDIR /app/packages/platform
USER postgres
ENTRYPOINT ["node", "--experimental-strip-types", "src/recovery-cli.ts"]
CMD ["inventory", "/backups"]

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV NEXT_DEPLOYMENT_ID=${APP_VERSION}
COPY --from=build /app ./
COPY docker-entrypoint.sh /usr/local/bin/entrypoint
# Chromium is a worker dependency, not a host-machine prerequisite. Its shared
# installation and system libraries are baked into this same versioned image.
RUN node apps/worker/node_modules/playwright/cli.js install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chmod +x /usr/local/bin/entrypoint \
    && mkdir -p /data/media /app/apps/admin/.next/cache /app/apps/site/.next/cache \
    && chown -R node:node /data/media /app/apps/admin/.next/cache /app/apps/site/.next/cache
USER node
EXPOSE 3000 3001 3002
ENTRYPOINT ["/usr/local/bin/entrypoint"]
CMD ["admin"]
