#!/usr/bin/env python3
"""Drive isolated Rust screens with mock Canvas/Ollama and a synthetic keyring entry."""
import ctypes as C
import json
import os
import queue
import subprocess
import tempfile
import threading
import time
from datetime import datetime,timedelta,timezone
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
root=Path(__file__).resolve().parents[1]
requests=[]
now=datetime.now(timezone.utc)
due=(now+timedelta(days=1)).isoformat()
class Mock(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        requests.append(self.path)
        path=self.path.split('?')[0]
        if path.endswith('/upcoming_events'):
            data=[{'id':'assignment_10','type':'assignment','title':'A very long assignment title with an unbroken suffix ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789','context_name':'A long course name for layout verification','context_code':'course_101','start_at':due,'assignment':{'id':10,'course_id':101,'submission_types':['online_upload']}},{'id':'assignment_12','type':'assignment','title':'Meeting','context_name':'Meeting course','context_code':'course_101','start_at':due,'description':'https://zoom.us/j/123','assignment':{'id':12,'course_id':101,'submission_types':['online_upload']}}]
        elif path.endswith('/students/submissions'):data=[{'assignment_id':10,'workflow_state':'unsubmitted'},{'assignment_id':12,'workflow_state':'unsubmitted'}]
        elif path.endswith('/courses'):data=[{'id':101,'course_code':'Layout course'}]
        elif path.endswith('/announcements'):data=[{'id':11,'title':'Announcement with a long title','message':'<p>Long announcement text </p>'*10,'context_code':'course_101','posted_at':datetime.now(timezone.utc).isoformat(),'user_name':'Synthetic teacher'}]
        elif path.endswith('/activity_stream'):data=[]
        elif path.endswith('/version'):data={'version':'test'}
        elif path.endswith('/tags'):data={'models':[{'name':'qwen2.5:3b'}]}
        else:data=[]
        self.reply(data)
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))))
        if 'intent' in body.get('format',{}).get('properties',{}):message={'intent':'unknown'}
        elif 'difficulty' in body.get('format',{}).get('properties',{}):message={'difficulty':'medium','estimatedHours':2}
        else:message='Synthetic study assistant reply'
        self.reply({'message':{'content':json.dumps(message) if isinstance(message,dict) else message}})
    def reply(self,data):
        payload=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
class Data(C.Union):_fields_=[('l',C.c_long*5),('b',C.c_char*20)]
class Message(C.Structure):_fields_=[('type',C.c_int),('serial',C.c_ulong),('send_event',C.c_int),('display',C.c_void_p),('window',C.c_ulong),('message_type',C.c_ulong),('format',C.c_int),('data',Data)]
class Event(C.Union):_fields_=[('message',Message),('pad',C.c_long*24)]
def raise_window(xid):
    x=C.CDLL('libX11.so.6');x.XOpenDisplay.restype=C.c_void_p;x.XOpenDisplay.argtypes=[C.c_char_p];d=x.XOpenDisplay(None)
    x.XDefaultRootWindow.argtypes=[C.c_void_p];x.XDefaultRootWindow.restype=C.c_ulong
    x.XInternAtom.argtypes=[C.c_void_p,C.c_char_p,C.c_int];x.XInternAtom.restype=C.c_ulong
    x.XSendEvent.argtypes=[C.c_void_p,C.c_ulong,C.c_int,C.c_long,C.POINTER(Event)]
    x.XFlush.argtypes=[C.c_void_p];x.XCloseDisplay.argtypes=[C.c_void_p]
    for action,state in [(0,b'_NET_WM_STATE_BELOW'),(1,b'_NET_WM_STATE_ABOVE')]:
        event=Event();event.message.type=33;event.message.send_event=1;event.message.display=d;event.message.window=xid;event.message.message_type=x.XInternAtom(d,b'_NET_WM_STATE',0);event.message.format=32;event.message.data.l[:]=[action,x.XInternAtom(d,state,0),0,1,0];x.XSendEvent(d,x.XDefaultRootWindow(d),0,(1<<20)|(1<<19),C.byref(event))
    x.XFlush(d);x.XCloseDisplay(d)
server=ThreadingHTTPServer(('127.0.0.1',0),Mock);threading.Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
with tempfile.TemporaryDirectory(prefix='sidekick-rust-ui-') as temp:
    profile=Path(temp)
    (profile/'settings.json').write_text(json.dumps({'schoolUrl':origin,'size':'Medium','textSize':'Standard'}))
    (profile/'state.json').write_text(json.dumps({'items':[{'id':'personal','type':'deadline','title':'Personal fixture','course':'Personal','isManual':True,'isCustom':True,'dueDate':due,'timeEstimate':'30m'}]}))
    session={'origin':origin,'cookies':[{'name':'canvas_session','value':'synthetic','domain':'127.0.0.1','path':'/','httpOnly':True}]}
    attributes=['service','canvas-sidekick-rust','profile',str(profile)]
    stored=subprocess.run(['secret-tool','store','--label=Sidekick UI test',*attributes],input=json.dumps(session),capture_output=True,text=True)
    assert stored.returncode==0,'Could not store the isolated test credential'
    env={**os.environ,'CANVAS_SIDEKICK_PROFILE':str(profile),'CANVAS_SIDEKICK_OLLAMA_URL':origin+'/api','CANVAS_SIDEKICK_POLL_SECONDS':'2','CANVAS_SIDEKICK_TEST_NOW':now.isoformat(),'CANVAS_SIDEKICK_TEST_AUTOSTART_DIR':str(profile/'autostart')}
    process=None
    try:
        process=subprocess.Popen([os.environ.get('WIDGET_EXECUTABLE',str(root/'target/debug/canvas-sidekick'))],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        events=queue.Queue()
        def read():
            for line in process.stdout:
                try:events.put(json.loads(line))
                except json.JSONDecodeError:pass
        threading.Thread(target=read,daemon=True).start()
        ready=events.get(timeout=15);xid=ready['xid'];raise_window(xid)
        time.sleep(2)
        state=json.loads((profile/'state.json').read_text())
        assert any(i['id']=='assignment_10' for i in state['items']),'Canvas data did not reach the native state'
        output=root/'artifacts/ui';output.mkdir(parents=True,exist_ok=True)
        (output/'fixture.json').write_text(json.dumps({'now':now.isoformat(),'settings':json.loads((profile/'settings.json').read_text()),'items':state['items']}))
        combinations=[('Medium','Standard')]
        if os.environ.get('SIDEKICK_UI_MATRIX')=='1':
            combinations=[(size,text) for size in ['Small','Medium','Large'] for text in ['Standard','Larger','Largest']]
            output=root/'artifacts/native';output.mkdir(parents=True,exist_ok=True)
        for size,text in combinations:
            process.stdin.write(json.dumps({'type':'test-preferences','size':size,'textSize':text})+'\n');process.stdin.flush();time.sleep(1.1)
            for index,name in [(2,'up-next'),(3,'tasks'),(4,'updates'),(1,'calendar'),(5,'settings'),(0,'ai-chat')]:
                process.stdin.write(json.dumps({'type':'tab','index':index})+'\n');process.stdin.flush();time.sleep(0.6)
                assert process.poll() is None,process.stderr.read()
                filename=f'{size}-{text}-{name}.png' if len(combinations)>1 else name+'.png'
                subprocess.run(['import','-window',str(xid),str(output/filename)],check=True,timeout=10)
        before=len(requests);process.stdin.write(json.dumps({'type':'visible','visible':False})+'\n');process.stdin.flush();time.sleep(4.5);assert len(requests)>before,'Background polling stopped while hidden'
        process.stdin.write(json.dumps({'type':'quit'})+'\n');process.stdin.flush();process.wait(timeout=10)
        assert process.returncode==0,process.stderr.read()
        assert any('/students/submissions' in path for path in requests)
        print('PASS: mock Canvas state, native keyring restore, six native screens, polling while hidden; screenshots in artifacts/ui')
    except Exception:
        if process and process.poll() is not None: print(process.stderr.read())
        raise
    finally:
        if process and process.poll() is None:process.kill();process.wait()
        subprocess.run(['secret-tool','clear',*attributes],capture_output=True)
server.shutdown()
