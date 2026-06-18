#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
cd "$ROOT_DIR"

npx --yes tailwindcss@3.4.17 \
  -c ./tailwind.config.cjs \
  -i ./styles/tailwind.input.css \
  -o ./assets/app-tailwind.css \
  --minify
