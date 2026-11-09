#!/usr/bin/env python3
"""Generate a local overlay report; differences are evidence, never an acceptance pass."""
import html
import json
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[1]
output=ROOT/'artifacts/parity-report';output.mkdir(parents=True,exist_ok=True)
records=[]
for hosted in [False,True]:
    reference=ROOT/('artifacts/reference-hosted' if hosted else 'artifacts/reference')
    native=ROOT/('artifacts/native-hosted' if hosted else 'artifacts/native')
    for source in sorted(reference.glob('*.png')):
        target=native/source.name
        if hosted and not target.exists() and source.name.startswith('Medium-Standard-'):
            target=native/source.name.removeprefix('Medium-Standard-')
        if not target.exists():continue
        dimensions=[]
        for file in [source,target]:
            dimensions.append(subprocess.check_output(['identify','-format','%wx%h',str(file)],text=True))
        if dimensions[0]!=dimensions[1]:
            records.append({'name':source.stem,'hosted':hosted,'status':'viewport mismatch','dimensions':dimensions})
            continue
        result=subprocess.run(['magick','compare','-metric','MAE',str(source),str(target),'null:'],capture_output=True,text=True)
        assert result.returncode in [0,1],result.stderr
        score=float(re.search(r'\(([\d.eE+-]+)\)',result.stderr).group(1))
        records.append({'name':source.stem,'hosted':hosted,'status':'review pending','mae':score,'dimensions':dimensions[0],
                        'reference':'../'+str(source.relative_to(ROOT/'artifacts')),'native':'../'+str(target.relative_to(ROOT/'artifacts'))})
(output/'measurements.json').write_text(json.dumps(records,indent=2)+'\n')
cards=[]
for record in sorted(records,key=lambda r:r.get('mae',1),reverse=True):
    title=('Hosted · ' if record['hosted'] else '')+record['name']
    if 'mae' not in record:
        cards.append(f'<article><h2>{html.escape(title)}</h2><p>Viewport mismatch: {record["dimensions"]}</p></article>');continue
    width,height=record['dimensions'].split('x')
    cards.append(f'''<article data-name="{html.escape(title.lower())}"><h2>{html.escape(title)}</h2>
<p>Pixel MAE {record['mae']:.5f} · {width} × {height} · Review pending</p>
<div class="comparison" style="width:{width}px;height:{height}px"><img src="{record['reference']}" alt="Electron reference"><img class="native" src="{record['native']}" alt="Rust candidate"></div></article>''')
document='''<!doctype html><meta charset="utf-8"><title>Canvas Sidekick visual parity review</title>
<style>body{font:14px system-ui;background:#eef2ef;color:#172c22;margin:24px}header{position:sticky;top:0;background:#eef2eff5;padding:12px 0;z-index:2}h1{font-size:22px}h2{font-size:15px}p{max-width:950px}input[type=search]{padding:8px;width:300px}.grid{display:flex;flex-wrap:wrap;gap:24px;align-items:start}article{background:white;border:1px solid #ccd9ce;padding:16px;border-radius:12px;max-width:100%;overflow:auto}.comparison{position:relative;background:#000;max-width:none}.comparison img{position:absolute;top:0;left:0}.native{opacity:var(--opacity,.5)}label{margin-left:16px}</style>
<header><h1>Canvas Sidekick: Electron → Rust</h1><p>Local development evidence. The current native glassy edge finish and widget curvature are approved differences. Other UI details still follow Electron. Captures and pixel metrics do not certify acceptance. Move the overlay slider to inspect geometry, typography and states. Results are sorted by pixel difference; animation and antialiasing can contribute.</p>
<input id="filter" type="search" placeholder="Filter by size, tab, state or hosted"><label>Electron <input id="opacity" type="range" min="0" max="100" value="50"> Rust</label></header><main class="grid">'''+''.join(cards)+'''</main>
<script>document.querySelector('#opacity').oninput=e=>document.documentElement.style.setProperty('--opacity',e.target.value/100);document.querySelector('#filter').oninput=e=>document.querySelectorAll('article').forEach(card=>card.hidden=!card.dataset.name?.includes(e.target.value.toLowerCase()));</script>'''
(output/'index.html').write_text(document)
print(f'{len(records)} comparison pairs written to {output}; acceptance remains pending.')
