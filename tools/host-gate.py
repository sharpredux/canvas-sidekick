#!/usr/bin/env python3
"""Full native host parenting, pipe synchronization, keyboard/pointer and lifecycle check."""
import ctypes as C
import json,os,queue,subprocess,tempfile,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
root=Path(__file__).resolve().parents[1]
messages=[]
class Mock(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def reply(self,value):
        payload=json.dumps(value).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
    def do_GET(self):self.reply({'version':'test'} if self.path.endswith('/version') else {'models':[{'name':'qwen2.5:3b'}]} if self.path.endswith('/tags') else [])
    def do_POST(self):
        value=json.loads(self.rfile.read(int(self.headers['Content-Length'])));messages.append(value)
        self.reply({'message':{'content':json.dumps({'intent':'unknown'}) if 'format' in value else 'Synthetic keyboard reply'}})
server=ThreadingHTTPServer(('127.0.0.1',0),Mock);threading.Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
x=C.CDLL('libX11.so.6');xt=C.CDLL('libXtst.so.6')
x.XOpenDisplay.argtypes=[C.c_char_p];x.XOpenDisplay.restype=C.c_void_p;display=x.XOpenDisplay(None)
assert display,'X11 desktop unavailable'
x.XQueryTree.argtypes=[C.c_void_p,C.c_ulong,C.POINTER(C.c_ulong),C.POINTER(C.c_ulong),C.POINTER(C.POINTER(C.c_ulong)),C.POINTER(C.c_uint)]
x.XGetGeometry.argtypes=[C.c_void_p,C.c_ulong,C.POINTER(C.c_ulong),C.POINTER(C.c_int),C.POINTER(C.c_int),C.POINTER(C.c_uint),C.POINTER(C.c_uint),C.POINTER(C.c_uint),C.POINTER(C.c_uint)]
x.XFree.argtypes=[C.c_void_p];x.XFlush.argtypes=[C.c_void_p];x.XCloseDisplay.argtypes=[C.c_void_p]
x.XTranslateCoordinates.argtypes=[C.c_void_p,C.c_ulong,C.c_ulong,C.c_int,C.c_int,C.POINTER(C.c_int),C.POINTER(C.c_int),C.POINTER(C.c_ulong)]
x.XSetInputFocus.argtypes=[C.c_void_p,C.c_ulong,C.c_int,C.c_ulong]
x.XStringToKeysym.argtypes=[C.c_char_p];x.XStringToKeysym.restype=C.c_ulong;x.XKeysymToKeycode.argtypes=[C.c_void_p,C.c_ulong];x.XKeysymToKeycode.restype=C.c_uint
xt.XTestFakeMotionEvent.argtypes=[C.c_void_p,C.c_int,C.c_int,C.c_int,C.c_ulong]
xt.XTestFakeButtonEvent.argtypes=[C.c_void_p,C.c_uint,C.c_int,C.c_ulong]
xt.XTestFakeKeyEvent.argtypes=[C.c_void_p,C.c_uint,C.c_int,C.c_ulong]
def geometry(window):
    r=C.c_ulong();a=C.c_int();b=C.c_int();w=C.c_uint();h=C.c_uint();border=C.c_uint();depth=C.c_uint()
    assert x.XGetGeometry(display,window,C.byref(r),C.byref(a),C.byref(b),C.byref(w),C.byref(h),C.byref(border),C.byref(depth))
    return r.value,a.value,b.value,w.value,h.value
def click(window,px,py):
    root_window=geometry(window)[0];rx=C.c_int();ry=C.c_int();child=C.c_ulong()
    x.XTranslateCoordinates(display,window,root_window,px,py,C.byref(rx),C.byref(ry),C.byref(child))
    x.XSetInputFocus(display,window,1,0);xt.XTestFakeMotionEvent(display,-1,rx.value,ry.value,0)
    xt.XTestFakeButtonEvent(display,1,1,0);xt.XTestFakeButtonEvent(display,1,0,0);x.XFlush(display)
with tempfile.TemporaryDirectory(prefix='sidekick-full-host-') as temp:
    temp=Path(temp);profile=temp/'native';profile.mkdir();electron_profile=temp/'electron';electron_profile.mkdir()
    (profile/'settings.json').write_text(json.dumps({'schoolUrl':origin,'size':'Medium'}))
    (profile/'state.json').write_text(json.dumps({'items':[{'id':'personal','type':'deadline','title':'Host synchronization fixture','course':'Personal','isManual':True,'isCustom':True,'dueDate':'2030-11-09T00:00:00Z','timeEstimate':'30m'}]}))
    attributes=['service','canvas-sidekick-rust','profile',str(profile)]
    session={'origin':origin,'cookies':[{'name':'canvas_session','value':'synthetic','domain':'127.0.0.1','path':'/','httpOnly':True}]}
    stored=subprocess.run(['secret-tool','store','--label=Sidekick host test',*attributes],input=json.dumps(session),text=True,capture_output=True);assert stored.returncode==0
    config=temp/'config.json';config.write_text(json.dumps({'profile':str(profile),'electronProfile':str(electron_profile)}))
    process=None
    try:
        env={**os.environ,'SIDEKICK_HOST_CONFIG':str(config),'CANVAS_SIDEKICK_OLLAMA_URL':origin+'/api','CANVAS_SIDEKICK_TEST_AUTOSTART_DIR':str(temp/'autostart')}
        process=subprocess.Popen([str(root.parent/'canvas-sidekick/node_modules/electron/dist/electron'),str(root/'tools/host-gate.cjs')],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        events=queue.Queue();observed=[]
        def read():
            for line in process.stdout:
                try:events.put(json.loads(line))
                except json.JSONDecodeError:pass
        threading.Thread(target=read,daemon=True).start()
        deadline=time.monotonic()+12;ready=None
        while time.monotonic()<deadline and ready is None:
            event=events.get(timeout=12);observed.append(event)
            if event.get('type')=='host-ready':ready=event
        assert ready,'Native child did not report readiness'
        window=ready['xid'];time.sleep(.5)
        root_id=C.c_ulong();parent=C.c_ulong();children=C.POINTER(C.c_ulong)();count=C.c_uint()
        assert x.XQueryTree(display,window,C.byref(root_id),C.byref(parent),C.byref(children),C.byref(count));x.XFree(children)
        assert parent.value==ready['parent'],'Native widget is not inside the host'
        assert geometry(window)[1:]==(80,100,650,500),geometry(window)
        click(window,33,25);time.sleep(.5);click(window,140,450)
        for letter in ['t','e','s','t','Return']:
            key=x.XKeysymToKeycode(display,x.XStringToKeysym(letter.encode()));xt.XTestFakeKeyEvent(display,key,1,0);xt.XTestFakeKeyEvent(display,key,0,0);x.XFlush(display);time.sleep(.04)
        time.sleep(.4)
        assert any(any(m.get('role')=='user' and m.get('content')=='test' for m in request.get('messages',[])) for request in messages),'Native pointer/keyboard input did not reach AI chat'
        time.sleep(3.1);assert geometry(window)[1:]==(100,120,600,480),geometry(window)
        process.wait(timeout=12)
        while not events.empty():observed.append(events.get())
        assert process.returncode==0,process.stderr.read()
        assert any(e.get('type')=='tasks-roundtrip' for e in observed),'Host toggle did not return a completed snapshot'
        assert any(e.get('type')=='host-stopped' for e in observed),'Child did not close cleanly'
        print('PASS: full Rust child parenting, hidden startup, host bounds/visibility, task toggle roundtrip, real pointer/keyboard input, clean shutdown')
    finally:
        if process and process.poll() is None:process.kill();process.wait()
        subprocess.run(['secret-tool','clear',*attributes],capture_output=True)
x.XCloseDisplay(display);server.shutdown()
