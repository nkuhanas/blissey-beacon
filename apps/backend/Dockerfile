FROM node:24.22.0-bookworm-slim AS build
RUN npm install --global pnpm@10.34.7
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY tools/simulator/package.json tools/simulator/package.json
RUN pnpm install --frozen-lockfile
COPY apps/backend apps/backend
COPY packages/contracts packages/contracts
COPY tools/simulator tools/simulator
RUN pnpm --filter @blissey/contracts build && pnpm --filter @blissey/backend build
RUN pnpm --filter @blissey/backend deploy --prod --legacy /runtime

FROM node:24.22.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /runtime ./
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
