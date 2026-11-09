#!/usr/bin/env python3
"""Exercise native HttpOnly cookies and login verification without a real account."""
import json
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

requests = []
class Canvas(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        requests.append(self.path)
        if self.path == '/api/v1/users/self/profile':
            cookie = self.headers.get('Cookie', '')
            if 'canvas_session=authenticated' in cookie:
                body, status, mime = b'{"id":123}', 200, 'application/json'
            elif 'canvas_session=html' in cookie:
                body, status, mime = b'<html>Not authenticated</html>', 200, 'text/html'
            else:
                body, status, mime = b'', 302, 'text/html'
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Location', '/login')
        else:
            stage = self.path.strip('/') or 'preauth'
            next_stage = {'preauth': 'html', 'html': 'authenticated'}.get(stage)
            body = ('<html><body>Isolated Canvas login gate: ' + stage +
                    (f'<script>setTimeout(()=>location.href="/{next_stage}",1400)</script>' if next_stage else '') + '</body></html>').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Set-Cookie', f'canvas_session={stage}; Path=/; HttpOnly; SameSite=Lax')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

server = ThreadingHTTPServer(('127.0.0.1', 0), Canvas)
threading.Thread(target=server.serve_forever, daemon=True).start()
root = Path(__file__).resolve().parents[1]
try:
    result = subprocess.run([str(root / 'target/debug/canvas-sidekick-auth')],
                            input=json.dumps({'url': f'http://127.0.0.1:{server.server_port}/preauth'})+'\n',
                            capture_output=True, text=True, timeout=30, cwd=root)
    assert result.returncode == 0, result.stderr
    event = json.loads(result.stdout)
    assert event['type'] == 'authenticated'
    cookie = next(c for c in event['cookies'] if c['name'] == 'canvas_session')
    assert cookie['value'] == 'authenticated', 'Pre-authentication or HTML response accepted'
    assert cookie['httpOnly'], 'Native cookie access must include HttpOnly cookies'
    assert '/html' in requests and '/authenticated' in requests
    assert requests.count('/api/v1/users/self/profile') >= 3
    print('PASS: native HttpOnly cookie retrieval, redirect/HTML rejection, authenticated profile probe')
finally:
    server.shutdown()
