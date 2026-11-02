#!/bin/sh
# Canonical, machine-independent scorer build: runs ./build.sh inside a pinned Linux Rust image, so
# macOS, Linux and Windows (Docker) users all get the same bytes. A native macOS build gives a
# different hash for the same source (host-dependent toolchain output), so pins use this script.
#   ./build-docker.sh         production -> out/kredofi_scorer.wasm
#   ./build-docker.sh demo    testnet demo build
set -e
cd "$(dirname "$0")/.."
IMAGE="rust:1.93.0-slim@sha256:760ad1d638d70ebbd0c61e06210e1289cbe45ff6425e3ea6e01241de3e14d08e"
MODE="${1:-}"
docker run --rm ${DOCKER_PLATFORM:+--platform "$DOCKER_PLATFORM"} -v "$(pwd)":/work -w /work/scorer "$IMAGE" sh -c "rustup target add wasm32-wasip2 >/dev/null 2>&1 && KF_TARGET_BASE=target-docker ./build.sh $MODE"
