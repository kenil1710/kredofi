# KredoFi testnet demo on a Hugging Face Docker Space. This Space holds only the compiled Next.js
# standalone server (built and minified locally by scripts/hf_space.py), its public assets and the
# pinned testnet scorer WASM. No source code and no secrets: keys are Space secrets, injected at runtime.
FROM node:22-bookworm-slim
ARG WASMTIME_VERSION=50.0.0
ARG WASMTIME_SHA256=77c19ee0437991f9ac7837b9c269d9c7076744f85dad263fea5214cc2723c7ff
# Must equal the scorer_version pinned on kredofi.kency.testnet (the server also checks at runtime).
ARG SCORER_SHA256=7f57898102233ceaa9990eef9d4abde214a58c11f3ecfa850e7a5b532a51ecb9

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && curl -fsSL -o /tmp/wasmtime.tar.xz "https://github.com/bytecodealliance/wasmtime/releases/download/v${WASMTIME_VERSION}/wasmtime-v${WASMTIME_VERSION}-x86_64-linux.tar.xz" \
 && echo "${WASMTIME_SHA256}  /tmp/wasmtime.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/wasmtime.tar.xz -C /tmp \
 && mv "/tmp/wasmtime-v${WASMTIME_VERSION}-x86_64-linux/wasmtime" /usr/local/bin/wasmtime \
 && rm -rf /tmp/wasmtime* \
 && apt-get purge -y curl xz-utils && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --chown=node:node app/ ./
COPY scorer/kredofi_scorer_demo.wasm /app/scorer/kredofi_scorer_demo.wasm
RUN echo "${SCORER_SHA256}  /app/scorer/kredofi_scorer_demo.wasm" | sha256sum -c - \
 && mkdir -p /home/node/data/submitted && chown -R node:node /home/node/data

USER node
ENV HOME=/home/node NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=7860 HOSTNAME=0.0.0.0 \
    SCORER_WASM=/app/scorer/kredofi_scorer_demo.wasm \
    SCORER_OUT_DIR=/home/node/data/submitted \
    LEDGER_CACHE=/home/node/data/ledger.json
EXPOSE 7860
CMD ["node", "server.js"]
