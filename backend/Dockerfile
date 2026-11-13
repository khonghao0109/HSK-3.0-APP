# syntax=docker/dockerfile:1
# =============================================================================
# HSK 3.0 APP — backend (NestJS 11 + Prisma 5 + PostgreSQL)
# Multi-stage build; mọi stage dùng cùng base image pin theo digest
# (manifest list có linux/amd64 + linux/arm64, Node 24.22.0).
# Context build: thư mục backend/ (xem backend/.dockerignore).
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: build — cài full deps, generate Prisma client, compile, prune về prod
# -----------------------------------------------------------------------------
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build

WORKDIR /app

# Prisma CLI cần openssl để detect engine (debian-openssl-3.0.x) khi generate.
RUN apt-get update \
    && apt-get install --no-install-recommends -y openssl \
    && rm -rf /var/lib/apt/lists/*

# Cài dependencies trước để tận dụng Docker layer cache.
# --ignore-scripts: giống CI; argon2 dùng prebuilds kèm sẵn, sharp qua optional
# deps (@img/*) nên không cần install script.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Prisma schema trước, generate client (nest build cần @prisma/client đã generate).
COPY prisma ./prisma
RUN npx prisma generate

# Source còn lại → build → prune về production deps.
# prisma + @prisma/client nằm trong dependencies nên vẫn còn sau prune
# (script bounded-prisma-migrate-deploy cần package prisma lúc runtime).
COPY . .
RUN npm run build \
    && npm prune --omit=dev

# -----------------------------------------------------------------------------
# Stage 2: runtime — chỉ prod deps + dist + prisma, chạy bằng user node (1000)
# -----------------------------------------------------------------------------
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS runtime

WORKDIR /app

# Prisma query/schema engine (debian-openssl-3.0.x) cần libssl/openssl lúc chạy.
RUN apt-get update \
    && apt-get install --no-install-recommends -y openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 3000

# Migrate KHÔNG chạy tự động khi start. Chạy riêng một lần bằng:
#   docker run --rm <img> node dist/scripts/operations/bounded-prisma-migrate-deploy.js
# Worker chạy bằng: node dist/src/worker.js
CMD ["node", "dist/src/main.js"]
