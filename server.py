#!/usr/bin/env python3
"""
Lightweight local HTTP server for Kick Chat OBS Overlay
Serves overlay files locally with CORS headers enabled.
"""

import http.server
import webbrowser
import os
import sys

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
STATIC_TYPES = ('.png', '.webp', '.svg', '.gif', '.jpg', '.jpeg', '.ico', '.woff', '.woff2', '.mp3', '.ogg', '.wav')

class CORSHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        # Images and fonts barely change: OBS keeps them for a day instead of downloading them on
        # every scene load. Code and pages are revalidated each time (a 304 when unchanged), so edits
        # still show at once
        path = self.path.split('?', 1)[0].lower()
        if path.endswith(STATIC_TYPES):
            self.send_header('Cache-Control', 'public, max-age=86400')
        else:
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

def main():
    os.chdir(DIRECTORY)
    handler = CORSHTTPRequestHandler
    # Threaded so a slow request (e.g. a stalled image) doesn't block the overlay's other files
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("", PORT), handler) as httpd:
        url = f"http://localhost:{PORT}/index.html"
        print("=" * 60)
        print(f" Holy Chat (overlay de Kick) en ejecución:")
        print(f" URL: {url}")
        print(" Para OBS Studio: Agrega una fuente de 'Navegador' con esa URL.")
        print(" Presiona Ctrl+C para detener el servidor.")
        print("=" * 60)
        
        # Open in default browser if not running with --no-browser
        if "--no-browser" not in sys.argv:
            webbrowser.open(url)
            
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")

if __name__ == "__main__":
    main()
