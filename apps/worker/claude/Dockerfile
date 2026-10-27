# agenthub/worker-claude
# Build from the repo root:
#   docker build -f apps/worker/claude/Dockerfile -t agenthub/worker-claude .
FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/common/package.json apps/worker/common/package.json
COPY apps/worker/claude/package.json apps/worker/claude/package.json
COPY packages/runtime-contract/package.json packages/runtime-contract/package.json
RUN pnpm install --frozen-lockfile --filter @agenthub/worker-claude...
COPY apps/worker/common apps/worker/common
COPY apps/worker/claude apps/worker/claude
COPY packages/runtime-contract packages/runtime-contract
RUN pnpm --filter @agenthub/worker-common build && pnpm --filter @agenthub/runtime-contract build && pnpm --filter @agenthub/worker-claude build
RUN pnpm --filter @agenthub/worker-claude deploy --prod /out

FROM node:22-bookworm-slim
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin agenthub
WORKDIR /app
COPY --from=build --chown=10001:10001 /out ./
USER 10001
ENV PORT=4096 NODE_ENV=production CLAUDE_MOCK=1 WORKSPACE_DIR=/workspace
EXPOSE 4096
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4096)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
