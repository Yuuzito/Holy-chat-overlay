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

class CORSHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
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
