# AEGIS v6.9 — Production Server
# Multi-stage build: compile TypeScript then run with minimal image

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src/ src/
COPY sql/ sql/

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=build /app /app

# tsx runs TypeScript directly without a separate compile step
ENV NODE_ENV=production
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "src/index.ts"]
