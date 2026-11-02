#!/bin/sh
# Build the scorer for wasm32-wasip2 and print its SHA-256 (= OutLayer version_key).
#   ./build.sh         production build (pin this one): out/kredofi_scorer.wasm
#   ./build.sh demo    + demo profiles: out/kredofi_scorer_demo.wasm (local / testnet Dev mode)
#   ./build.sh debug   + demo + debug: out/kredofi_scorer_debug.wasm (local only, never deploy)
#   ./build.sh legacy  production build WITHOUT path remapping (historical: the Nov 1 mainnet pin
#                      87ceab66... was built this way, on macOS, from the Nov 1 source).
#
# Reproducible on any machine: absolute paths (this folder, the Cargo home) are rewritten to fixed
# ones, so panic locations embed /kredofi/scorer/... and /cargo/... instead of the builder's paths.
# Same toolchain (rust-toolchain.toml) + same Cargo.lock + same source = same bytes.
set -e
cd "$(dirname "$0")"
REMAP=1
case "${1:-}" in
  "")     FEATURES="";            OUT=kredofi_scorer.wasm ;;
  demo)   FEATURES="demo";        OUT=kredofi_scorer_demo.wasm ;;
  debug)  FEATURES="demo,debug";  OUT=kredofi_scorer_debug.wasm ;;
  legacy) FEATURES="";            OUT=kredofi_scorer_legacy.wasm; REMAP=0 ;;
  *) echo "usage: ./build.sh [demo|debug|legacy]"; exit 1 ;;
esac
TARGET_DIR="${KF_TARGET_BASE:-target}/build-${1:-prod}"
if [ "$REMAP" = 1 ]; then
  CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
  export RUSTFLAGS="--remap-path-prefix=$(pwd)=/kredofi/scorer --remap-path-prefix=$CARGO_HOME_DIR=/cargo"
  TARGET_DIR="$TARGET_DIR-remap"
fi
cargo build --target wasm32-wasip2 --release --features "$FEATURES" --target-dir "$TARGET_DIR"
mkdir -p out
cp "$TARGET_DIR/wasm32-wasip2/release/kredofi_scorer.wasm" "out/$OUT"
echo "out/$OUT  $(wc -c < "out/$OUT") bytes"
echo "sha256 $( (command -v sha256sum >/dev/null && sha256sum "out/$OUT" || shasum -a 256 "out/$OUT") | cut -d' ' -f1)"
