#!/usr/bin/env python3
"""Interactive, ephemeral school SSO gate; session values never reach logs or disk."""
import json
import subprocess
import threading
from pathlib import Path
root=Path(__file__).resolve().parents[1]
settings=Path.home()/'.config/canvas-sidekick/settings.json'
url=json.loads(settings.read_text())['schoolUrl']
process=subprocess.Popen([str(root/'target/debug/canvas-sidekick-auth')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
def diagnostics():
    for line in process.stderr:
        if line.startswith('SIDEKICK_AUTH_DIAGNOSTIC '):
            print(line.strip(),flush=True)
threading.Thread(target=diagnostics,daemon=True).start()
process.stdin.write(json.dumps({'url':url,'diagnostics':True})+'\n')
process.stdin.close()
# Read complete events without echoing the authenticated event's session payload.
event=None
try:
    for line in process.stdout:
        try:
            value=json.loads(line)
        except json.JSONDecodeError:
            continue
        if value.get('type') in ('authenticated','failed'):
            event=value
            break
    process.wait(timeout=20)
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
if event and event.get('type')=='authenticated':
    print('PASS: school SSO profile verified; test session discarded.')
elif event:
    print('SSO validation pending: '+str(event.get('reason','unknown failure')))
else:
    raise SystemExit('Native login helper ended without a result; session output discarded.')
