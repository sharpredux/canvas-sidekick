#!/usr/bin/env python3
"""Extract both candidate packages and exercise their actual release executables."""
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading

ROOT=Path(__file__).resolve().parents[1]
packages=ROOT/'artifacts/packages'

def launch(main,profile):
    if not profile.exists():
        profile.mkdir();(profile/'settings.json').write_text('{}')
    process=subprocess.Popen([str(main),'--profile',str(profile)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    events=queue.Queue()
    def read():
        for line in process.stdout:
            try:events.put(json.loads(line))
            except json.JSONDecodeError:pass
    threading.Thread(target=read,daemon=True).start()
    try:
        event=events.get(timeout=25)
        while event.get('type')!='ready':event=events.get(timeout=25)
        assert event.get('xid'),'Packaged native window did not become ready'
        process.stdin.write('{"type":"quit"}\n');process.stdin.flush();process.wait(timeout=10)
        assert process.returncode==0,process.stderr.read()
    finally:
        if process.poll() is None:process.kill();process.wait()

def smoke(directory,label):
    binaries=directory/'usr/libexec/canvas-sidekick-rust'
    main=binaries/'canvas-sidekick';helper=binaries/'canvas-sidekick-auth'
    assert (binaries/'migration/legacy-export.cjs').is_file(),'Missing migration bridge'
    for executable in [main,helper]:
        linked=subprocess.run(['ldd',str(executable)],capture_output=True,text=True,check=True)
        assert 'not found' not in linked.stdout, linked.stdout
    assert b'test-view' not in main.read_bytes(),'Debug fixture controls leaked into release executable'
    profile=directory/'smoke-profile'
    profile.mkdir();(profile/'settings.json').write_text('{}')
    saved=json.dumps({'items':[{'id':'retained','type':'deadline','title':'Retained upgrade fixture','isManual':True,'isCustom':True,'futureField':42}]}).encode()
    (profile/'state.json').write_bytes(saved)
    (profile/'schedule.txt').write_text('Retained schedule fixture')
    launch(main,profile)
    launch(main,profile)
    assert (profile/'state.json').read_bytes()==saved,'Package restart changed existing tasks'
    assert (profile/'schedule.txt').read_text()=='Retained schedule fixture'
    corrupt=b'{interrupted data'
    (profile/'state.json').write_bytes(corrupt)
    rejected=subprocess.run([str(main),'--profile',str(profile)],stdin=subprocess.DEVNULL,capture_output=True,timeout=10)
    assert rejected.returncode!=0,'Corrupted state must not be silently replaced'
    assert (profile/'state.json').read_bytes()==corrupt
    (profile/'state.json').write_bytes(saved)
    launch(main,profile)
    # Includes private HttpOnly-cookie handoff and failed navigation with the packaged helper.
    subprocess.run(['python3',str(ROOT/'tools/auth-gate.py')],env={**os.environ,'SIDEKICK_AUTH_EXECUTABLE':str(helper)},check=True)
    print(f'PASS: {label} release window, restart/data retention, corruption recovery, dependencies, migration bridge and native login helper')

with tempfile.TemporaryDirectory(prefix='sidekick-package-smoke-') as temporary:
    temporary=Path(temporary)
    image=next(packages.glob('*.AppImage'))
    subprocess.run([str(image),'--appimage-extract'],cwd=temporary,check=True,stdout=subprocess.DEVNULL)
    smoke(temporary/'squashfs-root','AppImage')
    launch(image,temporary/'mounted-appimage-profile')
    print('PASS: mounted AppImage launcher, native window and clean exit')
    rpm=next(packages.glob('*.rpm'));rpm_root=temporary/'rpm';rpm_root.mkdir()
    payload=subprocess.run(['rpm2cpio',str(rpm)],capture_output=True,check=True).stdout
    subprocess.run(['cpio','-idm','--quiet'],input=payload,cwd=rpm_root,check=True)
    smoke(rpm_root,'RPM')
