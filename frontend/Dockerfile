# syntax=docker/dockerfile:1

# Base image pin bằng digest, dùng chung cho mọi stage.
# node:24-bookworm-slim (manifest list linux/amd64 + linux/arm64).
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts

FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next build tự set NODE_ENV=production; không set NODE_ENV trước để npm không bỏ devDeps.
RUN npm run build

FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# output: 'standalone' không tự copy .next/static và public — copy thủ công.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
CMD ["node", "server.js"]
