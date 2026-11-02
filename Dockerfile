# KredoFi web app for Fly.io (docs/DEPLOY.md). Testnet only: the server runs the pinned demo scorer
# with wasmtime (Dev mode), relays demo-account meta transactions and serves the public ledger.
# Secrets are NOT in this image: Fly injects them at runtime (`fly secrets`).

# ---- build the Next.js app (standalone output). Runs on the builder's own platform: the output is
# plain JavaScript (no native modules; sharp is removed below and images are unoptimized).
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /app/web
ENV NEXT_TELEMETRY_DISABLED=1
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- runtime: Node + wasmtime + the pinned demo scorer
FROM node:22-bookworm-slim AS run
ARG WASMTIME_VERSION=50.0.0
ARG WASMTIME_SHA256=77c19ee0437991f9ac7837b9c269d9c7076744f85dad263fea5214cc2723c7ff
# Must equal the scorer_version pinned on kredofi.kency.testnet; the server also refuses to score
# on a mismatch (web/src/server/scorer.ts).
ARG SCORER_SHA256=17f25a0da471d58d10053cc5596465a3e09782ee2f9ba75c181ed4d4e3aaf271

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && curl -fsSL -o /tmp/wasmtime.tar.xz "https://github.com/bytecodealliance/wasmtime/releases/download/v${WASMTIME_VERSION}/wasmtime-v${WASMTIME_VERSION}-x86_64-linux.tar.xz" \
 && echo "${WASMTIME_SHA256}  /tmp/wasmtime.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/wasmtime.tar.xz -C /tmp \
 && mv "/tmp/wasmtime-v${WASMTIME_VERSION}-x86_64-linux/wasmtime" /usr/local/bin/wasmtime \
 && rm -rf /tmp/wasmtime* \
 && apt-get purge -y curl xz-utils && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
 && wasmtime --version

WORKDIR /app
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./.next/static
# No native modules from the build platform (sharp is only for next/image, which KredoFi doesn't use).
RUN rm -rf /app/node_modules/@img /app/node_modules/sharp
COPY scorer/out/kredofi_scorer_demo.wasm /app/scorer/kredofi_scorer_demo.wasm
RUN echo "${SCORER_SHA256}  /app/scorer/kredofi_scorer_demo.wasm" | sha256sum -c -
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SCORER_WASM=/app/scorer/kredofi_scorer_demo.wasm \
    SCORER_OUT_DIR=/data/submitted \
    LEDGER_CACHE=/data/ledger.json
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
