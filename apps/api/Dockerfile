FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/mobile/package.json ./apps/mobile/package.json

RUN npm ci --workspace=@entsiegelung/shared --workspace=@entsiegelung/api --include-workspace-root
RUN npm --workspace @entsiegelung/shared run build && npm --workspace @entsiegelung/api run build
RUN npm prune --omit=dev --workspace=@entsiegelung/shared --workspace=@entsiegelung/api --include-workspace-root

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV UPLOADS_DIR=/var/lib/entsiegelung/uploads

RUN mkdir -p /var/lib/entsiegelung/uploads && chown -R node:node /var/lib/entsiegelung

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations

USER node
EXPOSE 3000
CMD ["sh", "-c", "node apps/api/dist/db/migrate.js && node apps/api/dist/server.js"]
