#!/bin/zsh
set -e

cd "$(dirname "$0")"

PORT="${1:-4174}"
URL="http://127.0.0.1:${PORT}/index.html"

open_camera_browser() {
  if [ -d "/Applications/Google Chrome.app" ]; then
    open -a "Google Chrome" "${URL}"
  elif [ -d "/Applications/Safari.app" ]; then
    open -a "Safari" "${URL}"
  else
    open "${URL}"
  fi
}

if lsof -PiTCP:"${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Kendo Virtual Coach is already running."
  echo "Opening ${URL}"
  open_camera_browser
  exit 0
fi

echo "Starting Kendo Virtual Coach on ${URL}"
echo "Keep this Terminal window open while using the camera."
open_camera_browser

python3 -m http.server "${PORT}" --bind 127.0.0.1
