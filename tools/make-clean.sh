#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rm -rf "$ROOT_DIR/dist/build" "$ROOT_DIR/store/paquetes"
echo "Cleaned dist/build and store/paquetes."
