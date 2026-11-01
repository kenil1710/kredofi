#!/bin/sh
# Build the scorer for wasm32-wasip2 and print its SHA-256 (= OutLayer version_key).
#   ./build.sh        production build (pin this one): out/kredofi_scorer.wasm
#   ./build.sh demo   + demo profiles: out/kredofi_scorer_demo.wasm (local / testnet Dev mode)
#   ./build.sh debug  + demo + debug: out/kredofi_scorer_debug.wasm (local only, never deploy)
set -e
cd "$(dirname "$0")"
case "${1:-}" in
  "")    FEATURES="";            OUT=kredofi_scorer.wasm ;;
  demo)  FEATURES="demo";        OUT=kredofi_scorer_demo.wasm ;;
  debug) FEATURES="demo,debug";  OUT=kredofi_scorer_debug.wasm ;;
  *) echo "usage: ./build.sh [demo|debug]"; exit 1 ;;
esac
TARGET_DIR="target/build-${1:-prod}"
cargo build --target wasm32-wasip2 --release --features "$FEATURES" --target-dir "$TARGET_DIR"
mkdir -p out
cp "$TARGET_DIR/wasm32-wasip2/release/kredofi_scorer.wasm" "out/$OUT"
echo "out/$OUT  $(wc -c < "out/$OUT") bytes"
echo "sha256 $(shasum -a 256 "out/$OUT" | cut -d' ' -f1)"
