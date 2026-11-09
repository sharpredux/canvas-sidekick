#!/usr/bin/env python3
"""Drive isolated Rust screens with mock Canvas/Ollama and a synthetic keyring entry."""
import ctypes as C
import json
import os
import queue
import subprocess
import sys
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
        elif path.endswith('/announcements'):data=[{'id':11,'title':'Announcement with a long title','message':'<p>Long announcement text </p>'*10,'context_code':'course_101','posted_at':now.isoformat(),'user_name':'Synthetic teacher'}]
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
def pointer_outside():
    x=C.CDLL('libX11.so.6');xt=C.CDLL('libXtst.so.6')
    x.XOpenDisplay.argtypes=[C.c_char_p];x.XOpenDisplay.restype=C.c_void_p;d=x.XOpenDisplay(None)
    xt.XTestFakeMotionEvent.argtypes=[C.c_void_p,C.c_int,C.c_int,C.c_int,C.c_ulong]
    x.XFlush.argtypes=[C.c_void_p];x.XCloseDisplay.argtypes=[C.c_void_p]
    xt.XTestFakeMotionEvent(d,-1,0,0,0);x.XFlush(d);x.XCloseDisplay(d)
server=ThreadingHTTPServer(('127.0.0.1',0),Mock);threading.Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
hosted='--hosted' in sys.argv
host_display=None
if hosted:
    host_x=C.CDLL('libX11.so.6')
    host_x.XOpenDisplay.argtypes=[C.c_char_p];host_x.XOpenDisplay.restype=C.c_void_p
    host_x.XDefaultRootWindow.argtypes=[C.c_void_p];host_x.XDefaultRootWindow.restype=C.c_ulong
    host_x.XCreateSimpleWindow.argtypes=[C.c_void_p,C.c_ulong,C.c_int,C.c_int,C.c_uint,C.c_uint,C.c_uint,C.c_ulong,C.c_ulong];host_x.XCreateSimpleWindow.restype=C.c_ulong
    host_x.XMapWindow.argtypes=[C.c_void_p,C.c_ulong];host_x.XFlush.argtypes=[C.c_void_p]
    host_x.XDestroyWindow.argtypes=[C.c_void_p,C.c_ulong];host_x.XCloseDisplay.argtypes=[C.c_void_p]
    host_display=host_x.XOpenDisplay(None);assert host_display
    parent=host_x.XCreateSimpleWindow(host_display,host_x.XDefaultRootWindow(host_display),100,100,650,500,0,0,0)
    host_x.XMapWindow(host_display,parent);host_x.XFlush(host_display);raise_window(parent)
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
        arguments=[os.environ.get('WIDGET_EXECUTABLE',str(root/'target/debug/canvas-sidekick'))]
        if hosted:arguments+=['--hosted-parent',str(parent)]
        process=subprocess.Popen(arguments,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        def send(command):
            process.stdin.write(json.dumps({'v':1,**command})+'\n');process.stdin.flush()
        events=queue.Queue()
        def read():
            for line in process.stdout:
                try:events.put(json.loads(line))
                except json.JSONDecodeError:pass
        threading.Thread(target=read,daemon=True).start()
        ready=events.get(timeout=15)
        while ready.get('type')!='ready':ready=events.get(timeout=15)
        xid=ready['xid']
        if hosted:
            send({'type':'bounds','x':0,'y':0,'width':650,'height':500});send({'type':'visible','visible':True})
        else:
            raise_window(xid)
            if '--edge' not in sys.argv:send({'type':'bounds','x':400,'y':100})
        pointer_outside()
        time.sleep(2)
        state=json.loads((profile/'state.json').read_text())
        assert any(i['id']=='assignment_10' for i in state['items']),'Canvas data did not reach the native state'
        output=root/'artifacts/ui';output.mkdir(parents=True,exist_ok=True)
        fixture=json.dumps({'now':now.isoformat(),'settings':json.loads((profile/'settings.json').read_text()),'items':state['items']})
        if not hosted:(output/'fixture.json').write_text(fixture)
        combinations=[('Medium','Standard')]
        if '--small' in sys.argv:combinations=[('Small','Largest' if '--largest' in sys.argv else 'Standard')]
        if os.environ.get('SIDEKICK_UI_MATRIX')=='1' or '--matrix' in sys.argv:
            combinations=[(size,text) for size in ['Small','Medium','Large'] for text in ['Standard','Larger','Largest']]
            output=root/'artifacts/native';output.mkdir(parents=True,exist_ok=True)
        if hosted:output=root/'artifacts/native-hosted';output.mkdir(parents=True,exist_ok=True)
        (output/'fixture.json').write_text(fixture)
        for size,text in combinations:
            send({'type':'test-preferences','size':size,'textSize':text});time.sleep(1.1)
            for index,name in [(2,'up-next'),(3,'tasks'),(4,'updates'),(1,'calendar'),(5,'settings'),(0,'ai-chat')]:
                send({'type':'tab','index':index});time.sleep(0.6)
                assert process.poll() is None,process.stderr.read()
                filename=f'{size}-{text}-{name}.png' if len(combinations)>1 else name+'.png'
                subprocess.run(['import','-window',str(xid),str(output/filename)],check=True,timeout=10)
                dimensions=subprocess.check_output(['identify','-format','%wx%h',str(output/filename)],text=True)
                expected='650x500' if hosted else {'Small':'280x320','Medium':'360x520','Large':'480x640'}[size]
                assert dimensions==expected, (name,dimensions,expected)
                if size=='Small' and name=='settings':
                    pixel=subprocess.check_output(['magick',str(output/filename),'-format','%[pixel:p{14,100}]','info:'],text=True)
                    expected='234,244,238' if hosted else '0,0,0'
                    assert expected in pixel.replace(' ',''), ('Compact tabs shifted the body margin',pixel)
            if '--details' in sys.argv:
                schedule='Time Slot\tMon 08/06\tTue 09/06\n7:30AM - 9:00AM\t- CCINOV8 - INNOVATION Offline Venue : Online Teacher : Melvin Gabriel Ignacio Room No :\t- CCINOV8 - INNOVATION Offline Venue : Online Teacher : Melvin Gabriel Ignacio Room No :'
                scenarios=[('form',None),('form-picker',None),('form-year',None),('form-required',None),('import',None),('import-filled',schedule),('schedule',schedule),('day',None),('ai-offline',None),('ai-model',None),('ai-pull',None),('auth-idle',None),('auth-waiting',None),('auth-error',None),('auth-success',None)]
                for name,text_value in scenarios:
                    command={'type':'test-view','mode':'import' if name=='import-filled' else name}
                    if text_value:command['text']=text_value
                    send(command);time.sleep(.15 if name=='auth-success' else .4)
                    assert process.poll() is None,process.stderr.read()
                    subprocess.run(['import','-window',str(xid),str(output/f'{size}-{text}-{name}.png')],check=True,timeout=10)
                    if name in ['form-picker','form-year']:
                        picker=json.loads(subprocess.check_output(['python3',str(root/'tools/query-native-child.py'),str(xid),'--picker'],text=True))
                        assert picker and (picker['width'],picker['height'])==(392,282), ('Native datetime popup is missing or clipped',picker)
                        if '--edge' in sys.argv and size=='Small' and not hosted:
                            assert picker['x']==-125, ('Datetime popup must align its right edge to the input at the screen edge',picker)
                        surface=output/f'{size}-{text}-{name}-surface.png'
                        subprocess.run(['import','-window',str(picker['xid']),str(surface)],check=True,timeout=10)
                        target=output/f'{size}-{text}-{name}.png'
                        subprocess.run(['magick',str(target),str(surface),'-geometry',f"{picker['x']:+d}{picker['y']:+d}",'-compose','Over','-composite',str(target)],check=True)
                        if name=='form-picker' and size=='Small':
                            # Select a date physically below the 320px owner, proving the whole popup works.
                            local=now.astimezone();offset=(local.replace(day=1).weekday()+1)%7;cell=offset+19
                            px=11+(cell%7)*28+14;py=74+(cell//7)*28+14
                            assert picker['y']+py>320, 'Fixture must exercise the popup outside the owner bounds'
                            subprocess.run(['python3',str(root/'tools/x11-click.py'),str(picker['xid']),str(px),str(py)],check=True)
                            time.sleep(.15);send({'type':'test-form-state'})
                            reply=events.get(timeout=5)
                            while reply.get('type')!='test-form-state':reply=events.get(timeout=5)
                            assert reply['date'].startswith(local.replace(day=20).strftime('%m/%d/%Y')),reply
                    if name=='ai-offline':
                        # The full setup surface must survive painter-only content.
                        pixel=subprocess.check_output(['magick',str(output/f'{size}-{text}-{name}.png'),'-format','%[pixel:p{20,100}]','info:'],text=True)
                        expected='252,254,253' if hosted else '28,28,30'
                        assert expected in pixel.replace(' ',''), ('AI setup surface collapsed',pixel)
                send({'type':'test-view','mode':'normal'})
        if '--details' in sys.argv:
            send({'type':'test-view','mode':'form-picker'});time.sleep(.4)
            assert json.loads(subprocess.check_output(['python3',str(root/'tools/query-native-child.py'),str(xid),'--picker'],text=True)), 'Datetime popup did not reopen'
        before=len(requests);send({'type':'visible','visible':False});time.sleep(4.5);assert len(requests)>before,'Background polling stopped while hidden'
        if '--details' in sys.argv:
            assert json.loads(subprocess.check_output(['python3',str(root/'tools/query-native-child.py'),str(xid),'--picker'],text=True)) is None, 'Datetime popup remained visible after hiding its owner'
            send({'type':'visible','visible':True});time.sleep(.4)
            assert json.loads(subprocess.check_output(['python3',str(root/'tools/query-native-child.py'),str(xid),'--picker'],text=True)) is None, 'Hidden datetime popup reopened with its owner'
        send({'type':'quit'});process.wait(timeout=10)
        assert process.returncode==0,process.stderr.read()
        assert any('/students/submissions' in path for path in requests)
        print(f'PASS: mock Canvas state, native keyring restore, {len(combinations)*(21 if "--details" in sys.argv else 6)} native captures, verified dimensions, polling while hidden; screenshots in {output.relative_to(root)}')
    except Exception:
        if process and process.poll() is not None: print(process.stderr.read())
        raise
    finally:
        if process and process.poll() is None:process.kill();process.wait()
        subprocess.run(['secret-tool','clear',*attributes],capture_output=True)
        if host_display:host_x.XDestroyWindow(host_display,parent);host_x.XCloseDisplay(host_display)
server.shutdown()
