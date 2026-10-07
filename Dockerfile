# syntax=docker/dockerfile:1
# Production image:
#   docker build -t forge .
#   docker run -d -p 80:80 -v forge_storage:/app/storage --name forge forge

ARG BUN_VERSION=1.2.20
FROM docker.io/oven/bun:${BUN_VERSION}-slim AS base
WORKDIR /app
ENV NODE_ENV=production \
    PORT=80

# Install production dependencies in a throwaway stage.
FROM base AS build
COPY backend/package.json backend/bun.lock ./backend/
RUN cd backend && bun install --frozen-lockfile --production

FROM base
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y curl git && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY backend ./backend
COPY public ./public

# Run as a non-root user that owns the SQLite storage volume.
RUN groupadd --system --gid 1000 forge && \
    useradd forge --uid 1000 --gid 1000 --create-home --shell /bin/bash && \
    mkdir -p storage && chown -R forge:forge storage
USER 1000:1000

EXPOSE 80
HEALTHCHECK CMD curl -fs http://localhost/up || exit 1
CMD ["bun", "backend/src/index.ts"]
