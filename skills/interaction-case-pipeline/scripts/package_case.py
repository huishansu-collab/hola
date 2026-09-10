"""Build a confirmed source Case and deliver a portable, importable case.zip."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, type=Path)
    parser.add_argument('--case', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    repo, root = args.repo.resolve(), args.case.resolve()
    output = args.output.absolute()

    def source(name):
        if not isinstance(name, str) or any(c in name for c in '\\:') or any(p in ('', '.', '..') for p in name.split('/')):
            raise ValueError('Unsafe source path')
        p = (root / name).resolve()
        if not p.is_relative_to(root) or not p.is_file():
            raise ValueError('Missing or external source: ' + name)
        return p

    manifest = json.loads(source('manifest.json').read_text())
    names = ['manifest.json'] + [manifest['files'][k] for k in ('case', 'timeline', 'alignment', 'brief', 'script')]
    data = json.loads(source(manifest['files']['case']).read_text())
    if any(e.get('tool_name') == 'audio.play' for e in data.get('events', [])):
        raise ValueError('source/1 build does not map waiting audio; use a verified platform snapshot ZIP or extend the source adapter first')
    alignment = json.loads(source(manifest['files']['alignment']).read_text())
    names += list(dict.fromkeys(c['source'] for c in alignment['clips']))
    requests = root / 'generation' / 'requests'
    if requests.exists():
        names += [p.relative_to(root).as_posix() for p in requests.rglob('*.json') if 'response' not in p.name.lower()]
    inputs = {name: source(name) for name in names}
    if output.resolve() in inputs.values() or output.suffix.lower() != '.zip':
        raise ValueError('Output must be a separate ZIP file')

    def check_credentials(value):
        if isinstance(value, dict):
            for key, item in value.items():
                normalized = key.lower().replace('-', '').replace('_', '')
                if normalized in ('apikey', 'xapikey', 'authorization', 'secretaccesskey', 'accesskeysecret'):
                    raise ValueError('Credentials must remain outside the Case package')
                check_credentials(item)
        elif isinstance(value, list):
            for item in value:
                check_credentials(item)
    for p in inputs.values():
        if p.suffix == '.json':
            check_credentials(json.loads(p.read_text()))

    # Rebuild in isolation so an older build or a symlinked build folder cannot be packaged.
    with tempfile.TemporaryDirectory(prefix='interaction-case-build-') as staging:
        build = Path(staging)
        subprocess.run(['node', str(repo / 'scripts/case-package/cli.mjs'), 'build', str(root), '--out', str(build)], cwd=repo, check=True)
        files = dict(inputs)
        for name in ('audio.wav', 'case.json', 'peaks.json'):
            files['build/' + name] = build / name
        for clip in (build / 'clips').glob('*.wav'):
            files['build/clips/' + clip.name] = clip
        if len(files) > 999 or sum(p.stat().st_size for p in files.values()) > 256 * 1024 * 1024:
            raise ValueError('Case exceeds platform expanded ZIP limit')
        output.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix='.case-', suffix='.zip', dir=output.parent)
        os.close(fd)
        try:
            with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as archive:
                for name, p in sorted(files.items()):
                    archive.write(p, name)
                archive.writestr('README.md', '# ' + manifest['title'] + '\n\n完整 Case 源包。manifest.json 保留 Case ID；brief.md 与 script.md 为说明及对白。\n\n源音频及切点位于 audio/sources/、generation/；build/ 包含片段、完整 JSON、真实波形和双声道音频（用户左、助手右）。\n\n在平台 Files 中选择导入本 ZIP；同 ID 更新原 Case。\n')
            if Path(temporary).stat().st_size > 64 * 1024 * 1024:
                raise ValueError('Case exceeds platform 64 MB ZIP limit')
            with zipfile.ZipFile(temporary) as archive:
                if archive.testzip():
                    raise ValueError('ZIP integrity check failed')
            os.replace(temporary, output)
        finally:
            Path(temporary).unlink(missing_ok=True)
    print('Case ZIP:', output)


if __name__ == '__main__':
    main()
