# Poller Dockerfile - Multi-stage build
# Build context: monorepo root (.)

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace config and lockfile
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY poller/package.json ./poller/

# Install dependencies
RUN npm ci --workspace=poller

# Copy shared and poller source
COPY shared/ ./shared/
COPY poller/ ./poller/

# Build shared lib then poller
RUN cd shared && npx tsc && cd ../poller && npx tsc

# --- Stage 2: Production ---
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy workspace config
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY poller/package.json ./poller/

# Install production deps only
RUN npm ci --workspace=poller --omit=dev

# Copy compiled output
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/poller/dist ./poller/dist

# Run as the non-root 'node' user shipped by the base image
RUN chown -R node:node /app
USER node

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "poller/dist/index.js"]
