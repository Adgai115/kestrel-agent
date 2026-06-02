# Kestrel Agent — production Docker image
# Build: docker build -t kestrel-agent .
# Run:   docker run -e KESTREL_API_KEY=<your-key> -p 3100:3100 kestrel-agent

FROM node:24-alpine AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable && corepack prepare pnpm@10 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/gateway/package.json packages/gateway/
COPY packages/cli/package.json packages/cli/
COPY packages/permissions/package.json packages/permissions/
COPY packages/channels/package.json packages/channels/
COPY packages/memory/package.json packages/memory/
COPY packages/storage/package.json packages/storage/
COPY packages/tools/package.json packages/tools/
COPY packages/skills/package.json packages/skills/
COPY packages/tasks/package.json packages/tasks/
COPY packages/lsp/package.json packages/lsp/
COPY packages/mcp/package.json packages/mcp/
COPY packages/sandbox/package.json packages/sandbox/
COPY packages/web-console/package.json packages/web-console/
COPY packages/observability/package.json packages/observability/
COPY apps/bootstrap/package.json apps/bootstrap/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm build

FROM base AS runner
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/gateway/package.json packages/gateway/
COPY --from=builder /app/packages/cli/package.json packages/cli/
COPY --from=builder /app/packages/permissions/package.json packages/permissions/
COPY --from=builder /app/packages/channels/package.json packages/channels/
COPY --from=builder /app/packages/memory/package.json packages/memory/
COPY --from=builder /app/packages/storage/package.json packages/storage/
COPY --from=builder /app/packages/tools/package.json packages/tools/
COPY --from=builder /app/packages/skills/package.json packages/skills/
COPY --from=builder /app/packages/tasks/package.json packages/tasks/
COPY --from=builder /app/packages/lsp/package.json packages/lsp/
COPY --from=builder /app/packages/mcp/package.json packages/mcp/
COPY --from=builder /app/packages/sandbox/package.json packages/sandbox/
COPY --from=builder /app/packages/web-console/package.json packages/web-console/
COPY --from=builder /app/packages/observability/package.json packages/observability/
COPY --from=builder /app/apps/bootstrap/package.json apps/bootstrap/
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/packages packages

ENV KESTREL_GATEWAY_HOST=0.0.0.0
ENV KESTREL_PORT=3100
EXPOSE 3100

# Default: start the Gateway daemon
CMD ["node", "packages/gateway/dist/bin.js"]
