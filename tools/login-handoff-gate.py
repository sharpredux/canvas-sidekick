#!/usr/bin/env python3
"""Verify sign-in closes its helper and populates the actual Sidekick, without an account."""
import ctypes as C
import json,os,queue,subprocess,tempfile,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
root=Path(__file__).resolve().parents[1]
class Mock(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        path=self.path.split('?')[0]
        if path=='/api/v1/users/self/profile':value={'id':123}
        elif path.endswith('/upcoming_events'):value=[{'id':'assignment_42','type':'assignment','title':'Authenticated Sidekick handoff','context_name':'Synthetic course','context_code':'course_1','start_at':'2030-11-09T00:00:00Z','assignment':{'id':42,'course_id':1,'submission_types':['online_upload']}}]
        elif path.endswith('/students/submissions'):value=[{'assignment_id':42,'workflow_state':'unsubmitted'}]
        else:value=[]
        if path.startswith('/api/'):
            accepted='canvas_session=synthetic-handoff' in self.headers.get('Cookie','')
            self.send_response(200 if accepted else 401);self.send_header('Content-Type','application/json');payload=json.dumps(value if accepted else {}).encode()
        else:
            self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Set-Cookie','canvas_session=synthetic-handoff; Path=/; HttpOnly; SameSite=Lax');payload=b'<html><body>Isolated sign-in handoff test</body></html>'
        self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
server=ThreadingHTTPServer(('127.0.0.1',0),Mock);threading.Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
with tempfile.TemporaryDirectory(prefix='sidekick-login-handoff-') as temporary:
    profile=Path(temporary);(profile/'settings.json').write_text('{}')
    env={**os.environ,'CANVAS_SIDEKICK_PROFILE':str(profile),'CANVAS_SIDEKICK_TEST_AUTOSTART_DIR':str(profile/'autostart')}
    process=None;attributes=['service','canvas-sidekick-rust','profile',str(profile)]
    try:
        process=subprocess.Popen([str(root/'target/debug/canvas-sidekick')],env=env,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        events=queue.Queue()
        def read():
            for line in process.stdout:
                try:events.put(json.loads(line))
                except json.JSONDecodeError:pass
        threading.Thread(target=read,daemon=True).start()
        ready=events.get(timeout=15);assert ready['type']=='ready';time.sleep(1)
        process.stdin.write(json.dumps({'type':'test-login','url':origin})+'\n');process.stdin.flush()
        deadline=time.monotonic()+30;state=None
        while time.monotonic()<deadline:
            assert process.poll() is None,process.stderr.read()
            state_file=profile/'state.json'
            if state_file.exists():
                state=json.loads(state_file.read_text())
                if any(item['id']=='assignment_42' for item in state['items']):break
            time.sleep(.1)
        assert state and any(item['id']=='assignment_42' for item in state['items']),'Authentication did not hand back to the native Sidekick'
        lookup=subprocess.run(['secret-tool','lookup',*attributes],text=True,capture_output=True);assert lookup.returncode==0
        assert json.loads(lookup.stdout)['origin']==origin
        for file in profile.rglob('*'):
            if file.is_file():assert b'synthetic-handoff' not in file.read_bytes(),'Plaintext session was written to the profile'
        process.stdin.write(json.dumps({'type':'quit'})+'\n');process.stdin.flush();process.wait(timeout=10);assert process.returncode==0,process.stderr.read()
        print('PASS: native sign-in helper → protected session → 500ms success state → Sidekick assignment fetch and saved state')
    finally:
        if process and process.poll() is None:process.kill();process.wait()
        subprocess.run(['secret-tool','clear',*attributes],capture_output=True)
server.shutdown()
