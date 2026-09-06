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


def enroll(case_id, speaker, url, model, prefix):
    dashscope = need_key()
    try:
        from dashscope.audio.tts_v2 import VoiceEnrollmentService
        svc = VoiceEnrollmentService()
        voice_id = svc.create_voice(target_model=model, prefix=prefix, url=url)
        rid = getattr(svc, 'get_last_request_id', lambda: '')()
    except ImportError:
        import urllib.request
        body = json.dumps({'model': 'voice-enrollment', 'input': {'action': 'create', 'target_model': model, 'prefix': prefix, 'url': url}}).encode()
        req = urllib.request.Request('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization', data=body, method='POST',
                                     headers={'Authorization': f'Bearer {os.environ["DASHSCOPE_API_KEY"]}', 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=120) as r: j = json.loads(r.read())
        voice_id = j['output']['voice_id']; rid = j.get('request_id', '')
    voices = load_voices(case_id)
    voices[speaker] = {'voice_id': voice_id, 'model': model, 'sample_url': url, 'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'request_id': rid}
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
        enroll(args.case_id, args.speaker, args.url, args.model, args.prefix or ''.join(c for c in args.speaker if c.isalnum())[:10] or 'voice')
    elif args.cmd == 'synth':
        synth(args.case_id, args.only, args.force, args.model, args.rate, args.pitch)
    else:
        audio_dir = ROOT / 'cases' / args.case_id / 'audio'
        voices = load_voices(args.case_id)
        base = args.url_base or f"https://raw.githubusercontent.com/{os.environ.get('GITHUB_REPOSITORY', '')}/{os.environ.get('GITHUB_REF_NAME', 'main')}/cases/{args.case_id}/audio"
        for f in sorted(audio_dir.glob('ref_*.*')):
            sp = f.stem[4:]
            if sp in voices or f.suffix.lower() not in ('.wav', '.mp3', '.m4a'): continue
            enroll(args.case_id, sp, f'{base}/{f.name}', args.model, ''.join(c for c in sp if c.isalnum())[:10] or 'voice')
        synth(args.case_id, args.only, args.force, args.model, args.rate, args.pitch)


if __name__ == '__main__':
    main()
