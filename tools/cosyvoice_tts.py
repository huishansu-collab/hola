#!/usr/bin/env python3
"""
tools/cosyvoice_tts.py — 用阿里云百炼 CosyVoice 的「声音复刻」让某个说话人用指定样本的音色说话。

    pip install dashscope
    export DASHSCOPE_API_KEY=sk-...

    # 1) 复刻:样本放在 cases/<id>/audio/ref_<speaker>.wav(10‒20 秒、单人、干净),要能被公网访问(仓库是公开的话就是 raw.githubusercontent.com)
    python3 tools/cosyvoice_tts.py enroll morning assistant --url https://raw.githubusercontent.com/<owner>/<repo>/<branch>/cases/morning/audio/ref_assistant.wav
    # 2) 合成:有音色的说话人逐句生成 24kHz wav,写进 manifest(source=cosy:<model>:<voice_id>)
    python3 tools/cosyvoice_tts.py synth morning [--only assistant] [--force] [--model cosyvoice-v2] [--rate 1.0]

音色 id 存在 cases/<id>/audio/voices.json;GitHub Actions 里 provider=cosy 会先按 ref_<speaker>.wav 自动复刻再合成。
"""
import argparse, hashlib, json, os, subprocess, sys, time, wave, io
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = 'cosyvoice-v2'


def need_key():
    key = os.environ.get('DASHSCOPE_API_KEY')
    if not key: raise SystemExit('缺少 DASHSCOPE_API_KEY')
    import dashscope
    dashscope.api_key = key
    base = os.environ.get('DASHSCOPE_BASE_URL')
    if base and 'intl' in base: dashscope.base_http_api_url = base.rstrip('/') + '/api/v1'
    return dashscope


def voices_path(case_id): return ROOT / 'cases' / case_id / 'audio' / 'voices.json'
def load_voices(case_id):
    p = voices_path(case_id); return json.loads(p.read_text('utf-8')) if p.exists() else {}
def save_voices(case_id, v): voices_path(case_id).write_text(json.dumps(v, ensure_ascii=False, indent=2) + '\n', 'utf-8')


API_BASE = 'https://dashscope.aliyuncs.com/api/v1'


def enroll_once(url, model, prefix, extra_headers=None):
    """调一次复刻接口;返回 voice_id,失败抛异常(带 DashScope 的错误码)"""
    import urllib.request, urllib.error
    body = json.dumps({'model': 'voice-enrollment', 'input': {'action': 'create_voice', 'target_model': model, 'prefix': prefix, 'url': url}}).encode()
    headers = {'Authorization': f'Bearer {os.environ["DASHSCOPE_API_KEY"]}', 'Content-Type': 'application/json', **(extra_headers or {})}
    req = urllib.request.Request(f'{API_BASE}/services/audio/tts/customization', data=body, method='POST', headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=180) as r: j = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'{e.code} {e.read().decode("utf-8", "replace")[:300]}')
    if 'output' not in j or 'voice_id' not in j['output']: raise RuntimeError(json.dumps(j, ensure_ascii=False)[:300])
    return j['output']['voice_id'], j.get('request_id', '')


def oss_upload(local_path, model):
    """DashScope 临时文件上传(48 小时有效):getPolicy → 表单直传 OSS → 返回 oss:// 链接"""
    import urllib.request, uuid, mimetypes
    req = urllib.request.Request(f'{API_BASE}/uploads?action=getPolicy&model={model}', headers={'Authorization': f'Bearer {os.environ["DASHSCOPE_API_KEY"]}'})
    with urllib.request.urlopen(req, timeout=60) as r: d = json.loads(r.read())['data']
    key = f"{d['upload_dir']}/{uuid.uuid4().hex}_{Path(local_path).name}"
    boundary = uuid.uuid4().hex
    fields = {'OSSAccessKeyId': d['oss_access_key_id'], 'Signature': d['signature'], 'policy': d['policy'], 'x-oss-object-acl': d['x_oss_object_acl'],
              'x-oss-forbid-overwrite': d['x_oss_forbid_overwrite'], 'key': key, 'success_action_status': '200'}
    parts = []
    for k, v in fields.items(): parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    ctype = mimetypes.guess_type(str(local_path))[0] or 'application/octet-stream'
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{Path(local_path).name}"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + Path(local_path).read_bytes() + b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    body = b''.join(parts)
    up = urllib.request.Request(d['upload_host'], data=body, method='POST', headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(up, timeout=180) as r: r.read()
    return f'oss://{key}'


def enroll(case_id, speaker, url, model, prefix, local_path=None):
    """复刻音色。DashScope 得能下载到样本:依次试 传入的 url、jsDelivr(GitHub 公开仓库的 CDN)、DashScope 临时 OSS 上传、raw.githubusercontent"""
    need_key()
    cands = []
    if url: cands.append((url, None))
    repo, sha = os.environ.get('GITHUB_REPOSITORY'), os.environ.get('GITHUB_SHA')
    rel = f'cases/{case_id}/audio/{Path(local_path).name}' if local_path else None
    if repo and sha and rel:
        cands.append((f'https://cdn.jsdelivr.net/gh/{repo}@{sha}/{rel}', None))
    if local_path and Path(local_path).exists():
        cands.append(('__oss__', None))
    if repo and rel:
        cands.append((f'https://raw.githubusercontent.com/{repo}/{os.environ.get("GITHUB_REF_NAME", "main")}/{rel}', None))
    seen = set(); last = None
    for cand, _ in cands:
        if cand in seen: continue
        seen.add(cand)
        try:
            if cand == '__oss__':
                for m in (model, 'voice-enrollment'):
                    try: oss = oss_upload(local_path, m); break
                    except Exception as e: last = e; oss = None
                if not oss: raise last
                print(f'  临时 OSS:{oss}', file=sys.stderr)
                voice_id, rid = enroll_once(oss, model, prefix, {'X-DashScope-OssResourceResolve': 'enable'})
                used = oss
            else:
                print(f'  试 {cand}', file=sys.stderr)
                voice_id, rid = enroll_once(cand, model, prefix)
                used = cand
            break
        except Exception as e:
            last = e; print(f'  失败:{str(e)[:200]}', file=sys.stderr)
    else:
        raise SystemExit(f'复刻失败:{speaker} — {last}')
    voices = load_voices(case_id)
    voices[speaker] = {'voice_id': voice_id, 'model': model, 'sample_url': used, 'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'request_id': rid}
    save_voices(case_id, voices)
    print(f'复刻完成:{speaker} → {voice_id}', file=sys.stderr)
    return voice_id


def plan(case_id):
    return json.loads(subprocess.check_output(['node', 'server/cli.js', 'plan', case_id, '--compact'], cwd=ROOT, text=True))


def synth(case_id, only, force, model, rate, pitch):
    dashscope = need_key()
    from dashscope.audio.tts_v2 import SpeechSynthesizer, AudioFormat
    voices = load_voices(case_id)
    pl = plan(case_id); items = pl['items']; audio_dir = Path(pl['audio_dir'])
    manifest_path = audio_dir / 'manifest.json'
    manifest = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else {'clips': {}}
    manifest.setdefault('clips', {})
    only = set(x for x in (only or '').split(',') if x)
    todo = []
    for it in items:
        v = voices.get(it['speaker'])
        if not v: continue
        if only and not ({it['id'], it['clip'], it['speaker']} & only): continue
        m = v.get('model') or model
        h = hashlib.sha1(f'cosy|{m}|{v["voice_id"]}|{rate}|{pitch}|{it["text"]}'.encode()).hexdigest()[:16]
        have = manifest['clips'].get(it['clip']) or {}
        if not force and have.get('hash') == h and (audio_dir / (it['clip'] + '.wav')).exists(): continue
        todo.append((it, v, m, h))
    print(f'{len(items)} 句,需合成 {len(todo)} 句(有音色的说话人:{", ".join(voices) or "无"})', file=sys.stderr)
    fails = 0; total_ms = 0
    for n, (it, v, m, h) in enumerate(todo, 1):
        wav = None; err = None
        for attempt in range(3):
            try:
                syn = SpeechSynthesizer(model=m, voice=v['voice_id'], format=AudioFormat.WAV_24000HZ_MONO_16BIT, speech_rate=rate, pitch_rate=pitch)
                wav = syn.call(it['text'])
                if not wav: raise RuntimeError(f'空返回(request {syn.get_last_request_id()})')
                break
            except Exception as e:
                err = e; time.sleep(2 * (attempt + 1))
        if not wav:
            fails += 1; print(f'✗ {it["id"]} {err}', file=sys.stderr); continue
        path = audio_dir / (it['clip'] + '.wav'); path.write_bytes(wav)
        for ext in ('.mp3', '.m4a'): (audio_dir / (it['clip'] + ext)).unlink(missing_ok=True)
        with wave.open(str(path), 'rb') as w: dur = round(w.getnframes() / w.getframerate() * 1000); sr = w.getframerate()
        total_ms += dur
        st = path.stat()
        manifest['clips'][it['clip']] = {'file': path.name, 'size': st.st_size, 'mtime': st.st_mtime * 1000, 'duration_ms': dur, 'format': 'wav', 'sample_rate': sr,
                                         'hash': h, 'source': f'cosy:{m}:{v["voice_id"]}', 'text': it['text'], 'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', 'utf-8')
        print(f'[{n}/{len(todo)}] {it["id"]} {it["speaker_name"]:<4} {dur/1000:5.1f}s {it["text"][:28]}', file=sys.stderr)
    print(f'完成:合成 {len(todo) - fails} 句,失败 {fails},语音共 {total_ms/1000:.0f}s', file=sys.stderr)
    if fails: sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    e = sub.add_parser('enroll'); e.add_argument('case_id'); e.add_argument('speaker'); e.add_argument('--url', required=True); e.add_argument('--model', default=DEFAULT_MODEL); e.add_argument('--prefix', default=None)
    s = sub.add_parser('synth'); s.add_argument('case_id'); s.add_argument('--only', default=''); s.add_argument('--force', action='store_true'); s.add_argument('--model', default=DEFAULT_MODEL); s.add_argument('--rate', type=float, default=1.0); s.add_argument('--pitch', type=float, default=1.0)
    a = sub.add_parser('auto', help='CI 用:有 ref_<speaker>.wav 而没音色的先复刻,再合成'); a.add_argument('case_id'); a.add_argument('--only', default=''); a.add_argument('--force', action='store_true'); a.add_argument('--model', default=DEFAULT_MODEL); a.add_argument('--rate', type=float, default=1.0); a.add_argument('--pitch', type=float, default=1.0); a.add_argument('--url-base', default=None, help='样本的公网地址前缀,默认按 GITHUB_REPOSITORY / GITHUB_REF_NAME 拼 raw.githubusercontent.com')
    args = ap.parse_args()
    if args.cmd == 'enroll':
        enroll(args.case_id, args.speaker, args.url, args.model, args.prefix or ''.join(c for c in args.speaker if c.isalnum())[:10] or 'voice', local_path=ROOT / 'cases' / args.case_id / 'audio' / f'ref_{args.speaker}.wav')
    elif args.cmd == 'synth':
        synth(args.case_id, args.only, args.force, args.model, args.rate, args.pitch)
    else:
        audio_dir = ROOT / 'cases' / args.case_id / 'audio'
        voices = load_voices(args.case_id)
        base = args.url_base or f"https://raw.githubusercontent.com/{os.environ.get('GITHUB_REPOSITORY', '')}/{os.environ.get('GITHUB_REF_NAME', 'main')}/cases/{args.case_id}/audio"
        for f in sorted(audio_dir.glob('ref_*.*')):
            sp = f.stem[4:]
            if sp in voices or f.suffix.lower() not in ('.wav', '.mp3', '.m4a'): continue
            enroll(args.case_id, sp, f'{base}/{f.name}' if args.url_base else None, args.model, ''.join(c for c in sp if c.isalnum())[:10] or 'voice', local_path=f)
        synth(args.case_id, args.only, args.force, args.model, args.rate, args.pitch)


if __name__ == '__main__':
    main()
