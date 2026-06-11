# syntax=docker/dockerfile:1.7

# --- Stage 1: build workflow-web (vite bundle) ---
FROM node:20-bookworm-slim AS web-build
WORKDIR /workflow-web
COPY workflow-web/package.json workflow-web/package-lock.json ./
RUN npm ci
COPY workflow-web/ ./
RUN npm run build

# --- Stage 2: build workflow-core (tsc) ---
FROM node:20-bookworm-slim AS api-build
WORKDIR /workflow-core
COPY workflow-core/package.json workflow-core/package-lock.json ./
RUN npm ci
COPY workflow-core/ ./
RUN npm run build

# --- Stage 3: install prod-only node_modules ---
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /workflow-core
COPY workflow-core/package.json workflow-core/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- Stage 4: runtime ---
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    WEB_DIST_DIR=/app/public
WORKDIR /app

# Run as non-root
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nodejs

COPY --from=prod-deps --chown=nodejs:nodejs /workflow-core/node_modules ./node_modules
COPY --from=api-build --chown=nodejs:nodejs /workflow-core/dist          ./dist
COPY --from=api-build --chown=nodejs:nodejs /workflow-core/migrations    ./migrations
COPY --from=api-build --chown=nodejs:nodejs /workflow-core/package.json  ./package.json
COPY --from=web-build --chown=nodejs:nodejs /workflow-web/dist           ./public

USER nodejs
EXPOSE 3000

# Default: run the API server.
# Migrations: override with `node dist/engine/db/cli-migrate.js`
CMD ["node", "dist/server/index.js"]
