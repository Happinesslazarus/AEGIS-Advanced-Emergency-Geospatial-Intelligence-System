# AEGIS v6.9 — Production Server
# Multi-stage build: compile TypeScript then run with minimal image

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force
COPY tsconfig.json ./
COPY src/ src/
COPY sql/ sql/

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache tini curl

# Create non-root user (CIS Docker Benchmark)
RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app /app

# Create upload and log directories with correct ownership
RUN mkdir -p uploads logs && chown -R app:app uploads logs

# Switch to non-root user
USER app

# tsx runs TypeScript directly without a separate compile step
ENV NODE_ENV=production
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3001/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "src/index.ts"]
