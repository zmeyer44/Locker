# ── Stage 1: Base ────────────────────────────────────────────────────────────
FROM node:22-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl \
  && rm -rf /var/lib/apt/lists/*
ENV PYTHON=/usr/bin/python3
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# ── Stage 2: Install dependencies ────────────────────────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/common/package.json ./packages/common/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/email/package.json ./packages/email/package.json
COPY packages/storage/package.json ./packages/storage/package.json
RUN pnpm install --frozen-lockfile

# ── Stage 3: Build ───────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/ /app/
COPY . .

# These are needed at build time for Next.js to inline public env vars.
# They can be overridden at runtime via docker-compose env vars.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NODE_ENV=production

# Next.js expects .env files to exist during build (even if empty).
# The real env vars are provided at runtime via docker-compose.
RUN touch .env apps/web/.env

RUN pnpm turbo build --filter=@locker/web

# ── Stage 4: Migrator ───────────────────────────────────────────────────────
# Used as an init container to run DB migrations before the app starts.
FROM base AS migrator
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY packages/database/drizzle ./packages/database/drizzle
COPY packages/database/drizzle.config.ts ./packages/database/drizzle.config.ts
COPY packages/database/package.json ./packages/database/package.json
COPY packages/database/src ./packages/database/src
COPY packages/common ./packages/common
COPY package.json turbo.json pnpm-workspace.yaml ./
CMD ["pnpm", "db:migrate"]

# ── Stage 5: Production image ────────────────────────────────────────────────
FROM node:22-slim AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Copy the standalone Next.js server
COPY --from=builder /app/apps/web/.next/standalone ./
# Copy static assets and public files
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# Create local-blobs directory for local storage provider
RUN mkdir -p /app/local-blobs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
