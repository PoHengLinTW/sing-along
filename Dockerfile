# syntax=docker/dockerfile:1
# One image: Fastify serves /api and the built web app. Build context is the repo root.

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
# Dependencies first, so source edits don't reinstall them.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm --filter @sing-along/web build && pnpm --filter @sing-along/api build

FROM node:22-alpine
# The API is a single esbuild bundle: no node_modules in the final image.
ENV NODE_ENV=production \
    PORT=3100 \
    WEB_DIST_DIR=/app/web \
    MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY --from=build /repo/apps/web/dist ./web
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Migrations run inside server.js before it starts listening.
CMD ["node", "--enable-source-maps", "dist/server.js"]
