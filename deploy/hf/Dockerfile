# KredoFi on a Hugging Face Docker Space (docs/DEPLOY_HF.md). Testnet only: the server runs the pinned
# demo scorer with wasmtime (Dev mode), relays demo-account meta transactions and serves the ledger.
# No secret is in this image or this Space's files: HF injects them at runtime (Space secrets).
# HF runs the container as uid 1000 (= the `node` user here) with no persistent disk.

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /app/web
ENV NEXT_TELEMETRY_DISABLED=1
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS run
ARG WASMTIME_VERSION=50.0.0
ARG WASMTIME_SHA256=77c19ee0437991f9ac7837b9c269d9c7076744f85dad263fea5214cc2723c7ff
# Must equal the scorer_version pinned on kredofi.kency.testnet (the server also checks at runtime).
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
COPY --from=build --chown=node:node /app/web/.next/standalone ./
COPY --from=build --chown=node:node /app/web/.next/static ./.next/static
RUN rm -rf /app/node_modules/@img /app/node_modules/sharp
COPY scorer/out/kredofi_scorer_demo.wasm /app/scorer/kredofi_scorer_demo.wasm
RUN echo "${SCORER_SHA256}  /app/scorer/kredofi_scorer_demo.wasm" | sha256sum -c - \
 && mkdir -p /home/node/data/submitted && chown -R node:node /home/node/data

USER node
ENV HOME=/home/node \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=7860 \
    HOSTNAME=0.0.0.0 \
    SCORER_WASM=/app/scorer/kredofi_scorer_demo.wasm \
    SCORER_OUT_DIR=/home/node/data/submitted \
    LEDGER_CACHE=/home/node/data/ledger.json
EXPOSE 7860
CMD ["node", "server.js"]
