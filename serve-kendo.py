#!/usr/bin/env python3
"""Kendo Virtual Coach local server.

MediaPipe Tasks / WASM を安定して読むために、通常の http.server に
COOP/COEP と正しい MIME を足した開発用サーバです。
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
import os


PORT = int(os.environ.get("PORT", "4174"))
HOST = os.environ.get("HOST", "127.0.0.1")

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/octet-stream", ".task")


class KendoHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError):
            # ブラウザ更新や検証中断で接続が切れただけなので、起動ログを汚さない。
            pass


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = ThreadingHTTPServer((HOST, PORT), KendoHandler)
    print(f"Kendo Virtual Coach: http://{HOST}:{PORT}/index.html")
    print("Stop: Ctrl+C")
    server.serve_forever()
