#!/bin/zsh
set -e

cd "$(dirname "$0")"

PORT=4173
while lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

URL="http://127.0.0.1:${PORT}/yolo.html"
echo "Kendo Suburi AR Mirror YOLO comparison"
echo "Opening ${URL}"

python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/kendo-yolo-mirror.log 2>&1 &
SERVER_PID=$!

sleep 0.8
open "$URL"
wait "$SERVER_PID"
