# syntax=docker/dockerfile:1.7
# Imagem de produção da API. Build a partir da raiz do monorepo:
#   docker build -f infrastructure/docker/backend.Dockerfile -t levoja-api .

FROM node:24-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY scripts/package.json scripts/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @levoja/backend... --filter @levoja/shared
COPY shared shared
COPY backend backend
RUN pnpm --filter @levoja/shared build \
 && pnpm --filter @levoja/backend exec prisma generate \
 && pnpm --filter @levoja/backend build \
 && pnpm deploy --filter @levoja/backend --prod --legacy /out \
 && cp -r backend/dist backend/prisma backend/prisma.config.ts /out/

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S levoja && adduser -S levoja -G levoja
COPY --from=build --chown=levoja:levoja /out ./
USER levoja
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:3333/health || exit 1
# Migrations são aplicadas por um job de deploy separado: `npx prisma migrate deploy`
CMD ["node", "dist/main.js"]
