FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/storage/package.json ./packages/storage/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @cognitive-runtime/contracts build
RUN pnpm --filter @cognitive-runtime/runtime build
RUN pnpm --filter @cognitive-runtime/storage build
RUN pnpm --filter @cognitive-runtime/api build

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
COPY --from=build /app/apps/api/drizzle.config.ts ./apps/api/
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/storage/dist ./packages/storage/dist
COPY --from=build /app/packages/storage/package.json ./packages/storage/
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/
COPY --from=build /app/packages/runtime/dist ./packages/runtime/dist
COPY --from=build /app/packages/runtime/package.json ./packages/runtime/
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
