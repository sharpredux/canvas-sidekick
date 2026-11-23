#!/usr/bin/env python3
"""Exercise native sign-in, cookie renewal, restart and reconnect with synthetic Canvas."""
import json
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

root = Path(__file__).resolve().parents[1]
phase = 'initial'
assignment = {
    'id': 'assignment_42',
    'type': 'assignment',
    'title': 'Authenticated Sidekick handoff',
    'context_name': 'Synthetic course',
    'context_code': 'course_1',
    'start_at': '2030-11-09T00:00:00Z',
    'assignment': {'id': 42, 'course_id': 1, 'submission_types': ['online_upload']},
}
requests = []


class Mock(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split('?')[0]
        cookie = self.headers.get('Cookie', '')
        requests.append((phase, path, cookie))
        status, data, headers = 200, [], {}
        if not path.startswith('/api/'):
            data = '<html>Isolated sign-in handoff test</html>'
            headers['Set-Cookie'] = 'canvas_session=seed; Path=/; HttpOnly'
        elif path.endswith('/profile'):
            if phase == 'expired':
                status = 302
                headers['Location'] = '/login'
            elif 'canvas_session=seed' in cookie:
                data = {'id': 123}
                value = 'connected' if phase == 'initial' else 'restored'
                headers['Set-Cookie'] = f'canvas_session={value}; Path=/; HttpOnly'
            elif cookie in ('canvas_session=connected', 'canvas_session=renewed', 'canvas_session=restored'):
                data = {'id': 123}
            else:
                status = 401
        elif path.endswith('/upcoming_events'):
            if phase == 'expired':
                status = 401
            elif phase == 'isolated-rejection':
                status = 401
                headers['Set-Cookie'] = 'canvas_session=; Path=/; Max-Age=0'
            elif phase == 'rate-limited':
                status = 429
            elif cookie:
                data = [assignment]
                if phase == 'rotate':
                    headers['Set-Cookie'] = 'canvas_session=renewed; Path=/; HttpOnly'
            else:
                status = 401
        elif path.endswith('/students/submissions'):
            data = [{'assignment_id': 42, 'workflow_state': 'unsubmitted'}]
        elif path.endswith('/activity_stream') and phase == 'rotate':
            status = 401

        body = (data if isinstance(data, str) else json.dumps(data)).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'text/html' if isinstance(data, str) else 'application/json')
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def wait_for(check, description):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(.1)
    raise AssertionError(description)


server = ThreadingHTTPServer(('127.0.0.1', 0), Mock)
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
with tempfile.TemporaryDirectory(prefix='sidekick-login-handoff-') as temporary:
    temp = Path(temporary)
    profile = temp / 'profile'
    profile.mkdir()
    (profile / 'settings.json').write_text('{}')
    secret_tool = shutil.which('secret-tool')
    assert secret_tool
    shim = temp / 'secret-tool'
    shim.write_text('''#!/bin/sh
if [ -e "$SIDEKICK_TEST_KEYRING/$1-blocked" ]; then
    echo 'Synthetic keyring failure' >&2
    exit 1
fi
exec "$SIDEKICK_TEST_SECRET_TOOL" "$@"
''')
    shim.chmod(0o700)
    env = {
        **os.environ,
        'CANVAS_SIDEKICK_PROFILE': str(profile),
        'CANVAS_SIDEKICK_OLLAMA_URL': origin + '/ollama',
        'CANVAS_SIDEKICK_TEST_AUTOSTART_DIR': str(temp / 'autostart'),
        'CANVAS_SIDEKICK_POLL_SECONDS': '1',
        'SIDEKICK_TEST_KEYRING': str(temp),
        'SIDEKICK_TEST_SECRET_TOOL': secret_tool,
        'PATH': f"{temp}:{os.environ['PATH']}",
    }
    attributes = ['service', 'canvas-sidekick-rust', 'profile', str(profile)]

    def stored_cookie(value):
        lookup = subprocess.run([secret_tool, 'lookup', *attributes], text=True, capture_output=True)
        if lookup.returncode:
            return False
        session = json.loads(lookup.stdout)
        return session['origin'] == origin and any(
            row['raw_cookie'].split(';')[0] == f'canvas_session={value}'
            for row in session.get('cookieStore', [])
        )

    def send(command, **fields):
        process.stdin.write(json.dumps({'type': command, **fields}) + '\n')
        process.stdin.flush()

    def launch():
        app = subprocess.Popen(
            [str(root / 'target/debug/canvas-sidekick')], env=env, text=True,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        events = queue.Queue()

        def read():
            for line in app.stdout:
                try:
                    events.put(json.loads(line))
                except json.JSONDecodeError:
                    pass

        threading.Thread(target=read, daemon=True).start()
        ready = events.get(timeout=15)
        assert ready['type'] == 'ready'
        if 'xid' in ready and shutil.which('xprop'):
            wait_for(
                lambda: '_NET_WM_STATE_SKIP_TASKBAR' in subprocess.check_output(
                    ['xprop', '-id', hex(ready['xid']), '_NET_WM_STATE'], text=True
                ),
                'The native window is missing its taskbar exclusion hint',
            )
        return app, events

    def ui_is(**fields):
        send('test-canvas-state')
        while True:
            event = events.get(timeout=5)
            if event['type'] == 'test-canvas-state':
                return all(event[key] == value for key, value in fields.items())

    def stop():
        send('quit')
        assert process.wait(timeout=10) == 0, process.stderr.read()

    process = None
    try:
        process, events = launch()
        wait_for(lambda: ui_is(ready=True, tasksVisible=False), 'First-run login did not load')
        send('test-login', url=origin)
        wait_for(lambda: ui_is(ready=True, itemCount=1), 'Sign-in did not populate the widget')
        assert stored_cookie('connected'), 'Verification cookie rotation was lost'

        (temp / 'store-blocked').touch()
        phase = 'rotate'
        wait_for(lambda: ui_is(ready=True, unsaved=True), 'Failed renewal save was hidden')
        assert stored_cookie('connected')
        wait_for(
            lambda: any(path.endswith('/upcoming_events') and cookie == 'canvas_session=renewed'
                        for _, path, cookie in requests),
            'The widget did not reuse the in-memory renewal after a save failure',
        )
        (temp / 'store-blocked').unlink()
        wait_for(lambda: stored_cookie('renewed'), 'Renewed cookie was not saved on retry')
        wait_for(lambda: ui_is(ready=True, unsaved=False), 'Save failure did not clear')

        for failure in ('isolated-rejection', 'rate-limited'):
            phase = failure
            wait_for(lambda: any(p == failure for p, _, _ in requests), 'Sync was not attempted')
            wait_for(lambda: ui_is(ready=True, reconnect=False, itemCount=1), failure)
            assert stored_cookie('renewed'), failure

        phase = 'normal'
        stop()
        (temp / 'lookup-blocked').touch()
        process, events = launch()
        wait_for(lambda: ui_is(ready=True, tasksVisible=True, keyringUnavailable=True, itemCount=1),
                 'Keyring failure hid the saved tasks')
        (temp / 'lookup-blocked').unlink()
        stop()
        before_restart = len(requests)
        process, events = launch()
        wait_for(lambda: any(p == 'normal' and cookie == 'canvas_session=renewed'
                             for p, _, cookie in requests[before_restart:]),
                 'Restart did not use the saved renewal')

        phase = 'expired'
        wait_for(lambda: ui_is(ready=True, tasksVisible=True, reconnect=True, itemCount=1),
                 'Confirmed expiry did not preserve the widget')
        assert stored_cookie('renewed'), 'Expiry deleted the protected session'
        assert not any(p == 'expired' and path == '/login' for p, path, _ in requests), (
            'Background sync followed the login redirect'
        )
        phase = 'reconnecting'
        send('test-login', url=origin)
        wait_for(lambda: ui_is(ready=True, reconnect=False, itemCount=1),
                 'User-initiated reconnect did not restore sync')
        assert stored_cookie('restored')
        for file in profile.rglob('*'):
            if file.is_file():
                assert b'canvas_session' not in file.read_bytes(), 'Plaintext session on disk'
        stop()
        print('PASS: login rotation, partial sync renewal, keyring recovery, restart and reconnect')
    finally:
        if process and process.poll() is None:
            process.kill()
            process.wait()
        subprocess.run([secret_tool, 'clear', *attributes], capture_output=True)
server.shutdown()
