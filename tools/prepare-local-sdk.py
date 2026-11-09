#!/usr/bin/env python3
"""Extract explicitly downloaded development RPMs; never installs system packages."""
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parents[1] / '.sdk/root'
root.mkdir(parents=True, exist_ok=True)
rust_version = subprocess.check_output(['rustc', '--version'], text=True).split()[1]
for rpm in (root.parent / 'rpms').glob('*.rpm'):
    if rpm.name.startswith('rustfmt-') and not rpm.name.startswith(f'rustfmt-{rust_version}-'):
        continue
    process = subprocess.Popen(['rpm2cpio', str(rpm)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    subprocess.run(['cpio', '-idmu', '--quiet'], stdin=process.stdout, cwd=root, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    process.stdout.close()
    if process.wait():
        raise SystemExit(f'Could not extract {rpm.name}')
for pc in (root / 'usr/lib64/pkgconfig').glob('*.pc'):
    pc.write_text(pc.read_text().replace('prefix=/usr', f'prefix={root}/usr'))
for link in (root / 'usr/lib64').glob('*.so'):
    if link.is_symlink() and not link.exists():
        libraries = sorted(Path('/usr/lib64').glob(link.name + '.*'), key=lambda p: len(p.name))
        if libraries:
            link.unlink()
            link.symlink_to(libraries[0])
print(f'Local SDK: {root}')
