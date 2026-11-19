# syntax=docker/dockerfile:1.7

# --- Build: SPA + bundled server (no node_modules needed at runtime) ---
FROM node:26.13.1-alpine3.23@sha256:39d8c143e60e99ae98f014bebea1e72fc96d3c9bdf9504bc3a27af5c05bfa39f AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json vite.config.ts components.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# --- Runtime: distroless Node 22, non-root, no shell ---
FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:39c66687298417dbf3ff2fb8b6012c20554494e16414ef7afd07b9abbb45b501
ARG VERSION=dev
LABEL org.opencontainers.image.title="system-map" \
      org.opencontainers.image.description="Interactive, read-only map of a self-hosted server, rendered from YAML" \
      org.opencontainers.image.source="https://github.com/mrRedSun/system-map" \
      org.opencontainers.image.version="${VERSION}"
WORKDIR /app
COPY --from=build /src/dist /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080
EXPOSE 8080
USER 65532:65532
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/healthcheck.mjs"]
CMD ["/app/server.mjs"]
