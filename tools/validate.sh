#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo test --locked --no-default-features
cargo build --locked --no-default-features --bin parity-driver
node tools/parity.mjs
TZ=Asia/Manila node tools/view-parity.mjs
