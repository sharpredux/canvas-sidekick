#!/usr/bin/env python3
"""Build parallel-install candidate RPM/AppImage packages; never install or launch them."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]

def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, cwd=ROOT, **kwargs)

def put(path, text, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(mode)

def notices(destination):
    """Retain supplied font licenses and cached Cargo dependency notices."""
    destination.mkdir(parents=True, exist_ok=True)
    for source in (ROOT/'assets/fonts').glob('*OFL*'):
        shutil.copy2(source, destination/source.name)
    registry = Path(os.environ.get('CARGO_HOME', Path.home()/'.cargo'))/'registry/src'
    packages = tomllib.loads((ROOT/'Cargo.lock').read_text())['package']
    index = []
    for package in packages:
        if not package.get('source', '').startswith('registry+'):
            continue
        name = f"{package['name']}-{package['version']}"
        source = next(registry.glob('*/'+name), None)
        if source is None:
            raise RuntimeError(f'Missing cached dependency notices: {name}')
        metadata = tomllib.loads((source/'Cargo.toml').read_text())['package']
        index.append({'package':name,'license':metadata.get('license'), 'repository':metadata.get('repository')})
        files = set(source.glob('LICENSE*')) | set(source.glob('COPYING*')) | set(source.glob('NOTICE*'))
        if metadata.get('license-file'):
            files.add(source/metadata['license-file'])
        for file in files:
            if file.is_file():
                target=destination/name/file.name
                target.parent.mkdir(exist_ok=True)
                shutil.copy2(file,target)
    put(destination/'cargo-licenses.json',json.dumps(index,indent=2)+'\n')

def stage(directory, binaries):
    libexec=directory/'usr/libexec/canvas-sidekick-rust'
    libexec.mkdir(parents=True)
    for name in ['canvas-sidekick','canvas-sidekick-auth']:
        shutil.copy2(binaries/name,libexec/name)
        (libexec/name).chmod(0o755)
    (libexec/'migration').mkdir()
    shutil.copy2(ROOT/'tools/legacy-export.cjs',libexec/'migration/legacy-export.cjs')
    put(directory/'usr/bin/canvas-sidekick-rust', '#!/bin/sh\nexec /usr/libexec/canvas-sidekick-rust/canvas-sidekick "$@"\n', 0o755)
    put(directory/'usr/share/applications/canvas-sidekick-rust.desktop',
        '[Desktop Entry]\nType=Application\nName=Canvas Sidekick (Rust candidate)\n'
        'Comment=Canvas LMS agenda and local AI study assistant\nExec=canvas-sidekick-rust\n'
        'Icon=canvas-sidekick-rust\nTerminal=false\nCategories=Education;\nStartupWMClass=canvas-sidekick\n')
    icon=directory/'usr/share/icons/hicolor/256x256/apps/canvas-sidekick-rust.png'
    icon.parent.mkdir(parents=True);shutil.copy2(ROOT/'assets/app-icon.png',icon)
    docs=directory/'usr/share/doc/canvas-sidekick-rust';docs.mkdir(parents=True)
    for name in ['README.md','PARITY.md']:
        shutil.copy2(ROOT/name,docs/name)
    notices(directory/'usr/share/licenses/canvas-sidekick-rust')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-build',action='store_true')
    parser.add_argument('--appimage-tools',type=Path,default=Path.home()/'.cache/electron-builder/appimage/appimage-12.0.1')
    args=parser.parse_args()
    if platform.system()!='Linux' or platform.machine()!='x86_64':
        parser.error('This candidate packaging target is Linux x86_64.')
    if not args.skip_build:
        run('cargo','build','--locked','--release','--features','auth','--bin','canvas-sidekick','--bin','canvas-sidekick-auth')
    binaries=ROOT/'target/release'
    for name in ['canvas-sidekick','canvas-sidekick-auth']:
        if not (binaries/name).is_file():
            parser.error(f'Missing release binary: {name}')
    version=tomllib.loads((ROOT/'Cargo.toml').read_text())['package']['version']
    output=ROOT/'artifacts/packages';output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sidekick-package-',dir=output) as temporary:
        temporary=Path(temporary);appdir=temporary/'AppDir';stage(appdir,binaries)
        shutil.copytree(appdir/'usr/share/licenses/canvas-sidekick-rust',output/'notices',dirs_exist_ok=True)
        tools=args.appimage_tools
        runtime=tools/'runtime-x64';squash=tools/'linux-x64/mksquashfs'
        if not runtime.is_file() or not squash.is_file():
            parser.error('Supply --appimage-tools pointing to the cached electron-builder AppImage 12.0.1 tools.')
        run(tools/'linux-x64/desktop-file-validate',appdir/'usr/share/applications/canvas-sidekick-rust.desktop')
        # Type-2 AppImage: unchanged runtime followed by a SquashFS AppDir.
        put(appdir/'AppRun','#!/bin/sh\nexec "$APPDIR/usr/libexec/canvas-sidekick-rust/canvas-sidekick" "$@"\n',0o755)
        (appdir/'canvas-sidekick-rust.desktop').symlink_to('usr/share/applications/canvas-sidekick-rust.desktop')
        (appdir/'canvas-sidekick-rust.png').symlink_to('usr/share/icons/hicolor/256x256/apps/canvas-sidekick-rust.png')
        (appdir/'.DirIcon').symlink_to('canvas-sidekick-rust.png')
        filesystem=temporary/'app.squashfs'
        run(squash,appdir,filesystem,'-noappend','-all-root','-comp','gzip','-processors','1','-no-progress')
        image=output/f'Canvas-Sidekick-Rust-{version}-x86_64.AppImage'
        with image.open('wb') as stream:
            stream.write(runtime.read_bytes())
            with filesystem.open('rb') as payload:shutil.copyfileobj(payload,stream)
        image.chmod(0o755)
        offset=int(run(image,'--appimage-offset',capture_output=True,text=True).stdout.strip())
        assert offset==runtime.stat().st_size, (offset,runtime.stat().st_size)
        # Exclude AppImage-specific root entries from the RPM payload.
        top=temporary/'rpmbuild';top.mkdir();spec=top/'candidate.spec'
        put(spec,f'''Name: canvas-sidekick-rust
Version: {version}
Release: 0.candidate
Summary: Native Canvas Sidekick rebuild candidate
License: LicenseRef-Canvas-Sidekick
Requires: /usr/bin/secret-tool
%global debug_package %{{nil}}
%global __os_install_post %{{nil}}
%description
Canvas LMS agenda and local AI study assistant. Parallel-install candidate;
the existing Electron package and profile are retained for migration.
%prep
%build
%install
mkdir -p %{{buildroot}}
cp -a "{appdir}/usr" %{{buildroot}}/
%files
/usr/bin/canvas-sidekick-rust
/usr/libexec/canvas-sidekick-rust
/usr/share/applications/canvas-sidekick-rust.desktop
/usr/share/icons/hicolor/256x256/apps/canvas-sidekick-rust.png
%doc /usr/share/doc/canvas-sidekick-rust
%license /usr/share/licenses/canvas-sidekick-rust
''')
        run('rpmbuild','-bb','--define',f'_topdir {top}',spec)
        rpm=next((top/'RPMS').rglob('*.rpm'));package=output/rpm.name;shutil.copy2(rpm,package)
        run('rpm','-qpl',package,stdout=subprocess.DEVNULL)
        record={'version':version,'status':'candidate; Windows and visual acceptance pending',
                'platform':platform.platform(),
                'runtimeDependencies':['GTK3','WebKitGTK 4.1','secret-tool','OpenGL/EGL','X11 or XWayland'],
                'artifacts':[{ 'file':file.name,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()} for file in [image,package]]}
        put(output/'manifest.json',json.dumps(record,indent=2)+'\n')
    print(f'Candidate packages written to {output}; nothing installed.')

if __name__=='__main__':main()
