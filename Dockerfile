# syntax=docker/dockerfile:1.7
# Multi-stage build for student-accounts (server/ Express+Prisma, client/ Vite+React).
# Server serves the built React app from /app/public when NODE_ENV=production.

ARG NODE_VERSION=22

# ---- builder ---------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /build

# Native build toolchain for better-sqlite3
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# --- client ---
COPY client/package.json client/package-lock.json* ./client/
RUN --mount=type=cache,target=/root/.npm cd client && npm ci
COPY client ./client
RUN cd client && npm run build

# --- server ---
COPY server/package.json server/package-lock.json* ./server/
RUN --mount=type=cache,target=/root/.npm cd server && npm ci
COPY server ./server
RUN cd server && npx prisma generate && npm run build

# Bundle client into server's public/ (server/src/app.ts serves /app/public)
RUN mkdir -p server/public && cp -r client/dist/. server/public/

# Drop dev deps
RUN cd server && npm prune --omit=dev

# ---- runtime ---------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/league-infrastructure/student-accounts"
LABEL org.opencontainers.image.title="student-accounts"
LABEL org.opencontainers.image.description="League student account management service"
LABEL org.opencontainers.image.licenses="UNLICENSED"

WORKDIR /app

# OpenSSL for Prisma's query engine (slim image lacks it)
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid app --shell /sbin/nologin app \
 && mkdir -p /app/data \
 && chown -R app:app /app

ENV NODE_ENV=production
ENV PORT=5201

COPY --from=builder --chown=app:app /build/server/dist ./dist
COPY --from=builder --chown=app:app /build/server/node_modules ./node_modules
COPY --from=builder --chown=app:app /build/server/prisma ./prisma
COPY --from=builder --chown=app:app /build/server/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=app:app /build/server/public ./public
COPY --from=builder --chown=app:app /build/server/package.json ./package.json
COPY --chown=app:app docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER app
EXPOSE 5201

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/index.js"]
