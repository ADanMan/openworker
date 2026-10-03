"""Publish verified Preview builds to new immutable artifact directories."""
import datetime
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys

p = pathlib.Path(sys.argv[1])
digest = hashlib.sha256(p.read_bytes()).hexdigest()
git = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], text=True).strip())
now = datetime.datetime.now(datetime.timezone.utc)
root = pathlib.Path(__file__).resolve().parent / 'artifacts'
root.mkdir(exist_ok=True)
# Exclusive creation: no previous artifact is ever replaced.
target = root / (sys.argv[2] + '-preview-' + now.strftime('%Y%m%dT%H%M%S%fZ') + '-' + digest[:12])
target.mkdir()
shutil.copyfile(p, target / p.name)
(target / (p.name + '.sha256')).write_text(digest + '  ' + p.name + '\n')
(target / 'manifest.json').write_text(json.dumps({
    'artifact': p.name, 'sha256': digest, 'versionName': sys.argv[2],
    'versionCode': int(sys.argv[3]), 'applicationId': 'app.opentweek.preview',
    'label': 'OpenTweek Preview', 'signingType': 'disposable-debug',
    'gitCommit': git, 'gitDirty': dirty, 'builtAtUtc': now.isoformat(),
}, indent=2) + '\n')
for artifact in target.iterdir():
    artifact.chmod(0o444)
target.chmod(0o555)
print(str((target / p.name).resolve()) + '\nSHA256 ' + digest)
