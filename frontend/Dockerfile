# Frontend Dockerfile - Multi-stage build (Next.js standalone)
# Build context: monorepo root (.)

# --- Stage 1: Install dependencies ---
FROM node:20-alpine AS deps

WORKDIR /app

# Copy workspace config and lockfile
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/

# Install dependencies (hoisted to root node_modules by npm workspaces)
RUN npm ci --workspace=frontend

# --- Stage 2: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy deps from previous stage (all hoisted to root node_modules)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/frontend/package.json ./frontend/package.json

# Copy frontend source
COPY frontend/ ./frontend/

# Set build-time env vars (NEXT_PUBLIC_* values are inlined into the client bundle at build time)
ARG NEXT_PUBLIC_API_URL=
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ARG NEXT_PUBLIC_BASE_PATH=
ARG NEXT_PUBLIC_SITE_NAME=
ARG NEXT_PUBLIC_ORG_NAME=
ARG NEXT_PUBLIC_LOGO_PATH=
ARG NEXT_PUBLIC_PRIMARY_COLOR=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV NEXT_PUBLIC_SITE_NAME=${NEXT_PUBLIC_SITE_NAME}
ENV NEXT_PUBLIC_ORG_NAME=${NEXT_PUBLIC_ORG_NAME}
ENV NEXT_PUBLIC_LOGO_PATH=${NEXT_PUBLIC_LOGO_PATH}
ENV NEXT_PUBLIC_PRIMARY_COLOR=${NEXT_PUBLIC_PRIMARY_COLOR}

# Build Next.js
RUN cd frontend && npx next build

# --- Stage 3: Production ---
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build output (server.js lands at /app/server.js)
COPY --from=builder /app/frontend/.next/standalone ./
# Copy static assets next to standalone server (.next/static) and at frontend path
COPY --from=builder /app/frontend/.next/static ./.next/static
COPY --from=builder /app/frontend/.next/static ./frontend/.next/static
# Copy public files (both paths needed for standalone mode)
COPY --from=builder /app/frontend/public ./frontend/public
COPY --from=builder /app/frontend/public ./public
# Copy node_modules that standalone tracing missed (monorepo hoisting issue)
COPY --from=deps /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000

# Base path must match the build-time NEXT_PUBLIC_BASE_PATH for the healthcheck URL
ARG NEXT_PUBLIC_BASE_PATH=
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000${NEXT_PUBLIC_BASE_PATH}/api/health || exit 1

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
