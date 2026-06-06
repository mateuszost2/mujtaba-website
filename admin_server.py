#!/usr/bin/env python3
"""
Admin server for Mujtaba Manzoor portfolio.
Run: python admin_server.py
Open: http://localhost:8001/admin.html
"""

import json
import os
import subprocess
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

METADATA_FILE = 'metadata.json'

FOLDER_MAP = {
    'documentaries': 'videos/documentaries',
    'ngo_works':     'videos/ngo_works',
    'photos':        'pictures/documentary_photography',
}

def load_metadata():
    if os.path.exists(METADATA_FILE):
        with open(METADATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_metadata(data):
    with open(METADATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def regenerate_manifest():
    try:
        subprocess.Popen(
            [sys.executable, 'generate_manifest.py'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
    except Exception as e:
        print(f'Manifest error: {e}')

class AdminHandler(SimpleHTTPRequestHandler):

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/get-metadata':
            metadata = load_metadata()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(metadata).encode())
        else:
            super().do_GET()

    def do_POST(self):

        # ── Save metadata ──
        if self.path == '/api/save-metadata':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                metadata = load_metadata()
                metadata[data['filename']] = {
                    'title': data.get('title', ''),
                    'year': data.get('year', ''),
                    'role': data.get('role', ''),
                    'description': data.get('description', ''),
                }
                save_metadata(metadata)
                regenerate_manifest()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"ok": true}')
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())

        # ── Upload file ──
        elif self.path.startswith('/api/upload'):
            try:
                content_type = self.headers.get('Content-Type', '')
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length)

                boundary = None
                for part in content_type.split(';'):
                    part = part.strip()
                    if part.startswith('boundary='):
                        boundary = part[9:].strip('"')
                        break

                if not boundary:
                    raise ValueError('No boundary found')

                cat = None
                filename = None
                file_data = None

                delimiter = ('--' + boundary).encode()
                parts = body.split(delimiter)

                for part in parts:
                    if b'Content-Disposition' not in part:
                        continue
                    if b'\r\n\r\n' in part:
                        raw_headers, content = part.split(b'\r\n\r\n', 1)
                    else:
                        continue
                    if content.endswith(b'\r\n'):
                        content = content[:-2]

                    headers_str = raw_headers.decode('utf-8', errors='ignore')

                    if 'name="cat"' in headers_str:
                        cat = content.decode('utf-8', errors='ignore').strip()
                    elif 'name="file"' in headers_str:
                        for line in headers_str.split('\r\n'):
                            if 'Content-Disposition' in line:
                                for segment in line.split(';'):
                                    segment = segment.strip()
                                    if segment.startswith('filename='):
                                        filename = segment[9:].strip().strip('"')
                                        break
                                break
                        file_data = content

                if not cat or not filename or file_data is None:
                    raise ValueError(f'Missing: cat={cat}, filename={filename}')

                folder = FOLDER_MAP.get(cat)
                if not folder:
                    raise ValueError(f'Unknown category: {cat}')

                filename = os.path.basename(filename)
                if not filename:
                    raise ValueError('Invalid filename')

                os.makedirs(folder, exist_ok=True)
                dest = os.path.join(folder, filename)

                with open(dest, 'wb') as f:
                    f.write(file_data)

                regenerate_manifest()

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'ok': True, 'path': dest}).encode())

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())

        # ── Delete file ──
        elif self.path == '/api/delete':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                cat = data.get('cat')
                filename = os.path.basename(data.get('filename', ''))

                if not filename:
                    raise ValueError('Invalid filename')

                folder = FOLDER_MAP.get(cat)
                if not folder:
                    raise ValueError(f'Unknown category: {cat}')

                filepath = os.path.join(folder, filename)
                if os.path.exists(filepath):
                    os.remove(filepath)

                if cat in ('documentaries', 'ngo_works'):
                    base = os.path.splitext(filename)[0]
                    thumb = os.path.join(folder, base + '.jpg')
                    if os.path.exists(thumb):
                        os.remove(thumb)

                if cat == 'photos':
                    base = os.path.splitext(filename)[0]
                    compressed = os.path.join(folder, 'compressed', base + '.jpg')
                    if os.path.exists(compressed):
                        os.remove(compressed)

                metadata = load_metadata()
                if filename in metadata:
                    del metadata[filename]
                    save_metadata(metadata)

                regenerate_manifest()

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"ok": true}')

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass

if __name__ == '__main__':
    port = 8001
    server = HTTPServer(('', port), AdminHandler)
    print(f'Admin server running at http://localhost:{port}/admin.html')
    print('Press Ctrl+C to stop.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')