# Backend Dockerfile - Multi-stage build
# Build context: monorepo root (.)

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace config and lockfile
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/

# Install dependencies (backend workspace only)
RUN npm ci --workspace=backend

# Copy shared and backend source and database migrations
COPY shared/ ./shared/
COPY backend/ ./backend/
COPY database/ ./database/

# Build shared lib then backend
RUN cd shared && npx tsc && cd ../backend && npx tsc

# --- Stage 2: Production ---
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
# Containers must listen beyond loopback; see HOST in .env.example.
ENV HOST=0.0.0.0

# Copy workspace config
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/

# Install production deps only
RUN npm ci --workspace=backend --omit=dev

# Copy compiled output and database migrations
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/database ./database

# Copy the migrate script (plain JS, not compiled by tsc)
COPY backend/src/db/migrate.js ./backend/dist/db/migrate.js

# Run as the non-root 'node' user shipped by the base image
RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "backend/dist/index.js"]
