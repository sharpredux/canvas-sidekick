#!/usr/bin/env python3
"""Verify the exporter against a synthetic Electron profile, never the real profile."""
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
electron=Path('/home/franz/canvas-sidekick/node_modules/electron/dist/electron')
with tempfile.TemporaryDirectory(prefix='sidekick-migration-gate-') as temp:
    temp=Path(temp);profile=temp/'profile';profile.mkdir();renderer=temp/'index.html';renderer.write_text('<html><body>Migration fixture</body></html>')
    config=json.dumps({'profile':str(profile),'renderer':str(renderer)})+'\n'
    seed=subprocess.run([str(electron),str(root/'tools/seed-legacy-gate.cjs')],input=config,capture_output=True,text=True,timeout=30)
    assert seed.returncode==0,seed.stderr
    def hashes():
        return {str(p.relative_to(profile)):hashlib.sha256(p.read_bytes()).hexdigest() for p in profile.rglob('*') if p.is_file() and not p.is_symlink() and not p.name.startswith('Singleton')}
    before=hashes()
    result=subprocess.run([str(electron),str(root/'tools/legacy-export.cjs')],input=config,capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stderr
    data=json.loads(result.stdout)
    assert data['settings']['future']==42
    assert data['manualTasks'][0]['id']=='personal'
    assert data['taskCompletionOverrides']['personal']['completed'] is False
    assert data['schedule']=='synthetic schedule'
    assert data['archives']['2026-11-09'][0]['id']=='archive'
    assert any(c['name']=='canvas_session' and c['value']=='synthetic-cookie' and c['httpOnly'] for c in data['cookies'])
    assert before==hashes(),'Exporter changed the original synthetic profile'
    destination=temp/'rust-profile'
    configuration={'destination':str(destination),'source':str(profile),'renderer':str(renderer),'electron':str(electron)}
    migrated=subprocess.run([str(root/'target/debug/migrate-profile')],input=json.dumps(configuration)+'\n',capture_output=True,text=True,timeout=45)
    assert migrated.returncode==0,migrated.stderr
    assert json.loads(migrated.stdout)['type']=='migration-complete'
    imported=json.loads((destination/'imported/state.json').read_text())
    assert imported['items'][0]['id']=='personal'
    assert imported['taskCompletionOverrides']['personal']['completed'] is False
    attributes=['service','canvas-sidekick-rust','profile',str(destination.resolve())]
    try:
        secret=subprocess.run(['secret-tool','lookup',*attributes],capture_output=True,text=True)
        assert secret.returncode==0
        session=json.loads(secret.stdout)
        assert any(c['value']=='synthetic-cookie' for c in session['cookies'])
        for file in destination.rglob('*'):
            if file.is_file():assert b'synthetic-cookie' not in file.read_bytes()
        assert before==hashes(),'Migration changed the original synthetic profile'
    finally:
        subprocess.run(['secret-tool','clear',*attributes],capture_output=True)
    print('PASS: legacy export, atomic Rust import, native credential transfer; source unchanged and no plaintext session file')
