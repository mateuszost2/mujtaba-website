#!/usr/bin/env python3
"""
Admin server for Mujtaba Manzoor portfolio.
Run: python admin_server.py
Open: http://localhost:8001/admin.html
"""

import json
import os
import re
import subprocess
import sys
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from http.server import HTTPServer, SimpleHTTPRequestHandler
from dotenv import load_dotenv


METADATA_FILE = 'metadata.json'

FOLDER_MAP = {
    'documentaries': 'videos/documentaries',
    'ngo_works':     'videos/ngo_works',
    'photos':        'pictures/documentary_photography',
    'main_video':    'videos/main_video',
    'about_photo':   'pictures/about_me_pic',
}
load_dotenv()

SMTP_EMAIL    = os.getenv('SMTP_EMAIL')
SMTP_PASSWORD = os.getenv('SMTP_PASSWORD')
CONTACT_EMAIL = os.getenv('CONTACT_EMAIL')

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
        self.send_header('Accept-Ranges', 'bytes')
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
        elif self.headers.get('Range'):
            self.serve_range_request()
        else:
            super().do_GET()

    def serve_range_request(self):
        """Serve a partial response for Range requests (needed for video seeking)."""
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            super().do_GET()
            return

        file_size = os.path.getsize(path)
        match = re.match(r'bytes=(\d*)-(\d*)', self.headers['Range'])
        if not match or (not match.group(1) and not match.group(2)):
            super().do_GET()
            return

        start_str, end_str = match.groups()
        if start_str == '':
            length = min(int(end_str), file_size)
            start, end = file_size - length, file_size - 1
        else:
            start = int(start_str)
            end = int(end_str) if end_str else file_size - 1

        end = min(end, file_size - 1)
        if start > end or start >= file_size:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{file_size}')
            self.end_headers()
            return

        length = end - start + 1
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
        self.send_header('Content-Length', str(length))
        self.end_headers()

        with open(path, 'rb') as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

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

        # ── Contact form ──
        elif self.path == '/api/contact':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                name = data.get('name', '')
                email = data.get('email', '')
                message = data.get('message', '')

                msg = MIMEMultipart()
                msg['From'] = SMTP_EMAIL
                msg['To'] = CONTACT_EMAIL
                msg['Subject'] = f'Portfolio contact: {name}'
                msg.attach(MIMEText(
                    f'From: {name}\nEmail: {email}\n\n{message}',
                    'plain', 'utf-8'
                ))

                with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
                    smtp.login(SMTP_EMAIL, SMTP_PASSWORD)
                    smtp.send_message(msg)

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
    print(f'Admin server is running.')
    print('Press Ctrl+C to stop.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')