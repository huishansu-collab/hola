#!/usr/bin/env python3
"""
tools/offline_tts.py — 离线语音生成(不需要任何 API key、不联网调用)。

引擎:Kokoro v1.1-zh(82M 参数,中文 100 个音色 + 英文)via sherpa-onnx,CPU 即可,约 3× 实时。

    pip install sherpa-onnx numpy                 # 一次性
    python3 tools/offline_tts.py morning          # 首次自动下载模型(≈365MB,GitHub Releases)到 ~/.cache/duplex-studio/

选项:
    --voice user=zm_010 --voice assistant=zf_001 --voice 司机=zm_029
                        按说话人指定音色(也可在剧本 speakers.<x>.tts.local_voice 里写)
    --only u001,u002    只生成这些台词          --force     已有的也重做
    --no-mp3            不输出 64kbps mp3(默认同时输出:单文件包 / 网页只带 mp3,wav 留给母带混音)
    --threads N         推理线程(默认 CPU 核数,最多 8)
    --model-dir DIR     模型目录(默认 $KOKORO_MODEL_DIR 或 ~/.cache/duplex-studio/kokoro-multi-lang-v1_1)
    --list-voices       列出全部音色 id

输出:cases/<id>/audio/<clip>.wav(24kHz 16-bit mono)+ <clip>.mp3;manifest 里 source=local:kokoro-v1.1-zh:<voice>。
之后 npm start / npm run build:static 即可听到;想换成 OpenAI 音色,再跑 npm run tts -- <id> --force 即可覆盖。
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tarfile, time, urllib.request, wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL_NAME = 'kokoro-multi-lang-v1_1'
MODEL_URL = f'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/{MODEL_NAME}.tar.bz2'
ENGINE = 'kokoro-v1.1-zh'

# voices.bin 里的说话人顺序(sherpa-onnx 导出时按名字排序):0-2 英文,3-57 中文女声 zf_*,58-102 中文男声 zm_*
VOICES = ('af_maple af_sol bf_vale zf_001 zf_002 zf_003 zf_004 zf_005 zf_006 zf_007 zf_008 zf_017 zf_018 zf_019 zf_021 zf_022 '
          'zf_023 zf_024 zf_026 zf_027 zf_028 zf_032 zf_036 zf_038 zf_039 zf_040 zf_042 zf_043 zf_044 zf_046 zf_047 zf_048 zf_049 '
          'zf_051 zf_059 zf_060 zf_067 zf_070 zf_071 zf_072 zf_073 zf_074 zf_075 zf_076 zf_077 zf_078 zf_079 zf_083 zf_084 zf_085 '
          'zf_086 zf_087 zf_088 zf_090 zf_092 zf_093 zf_094 zf_099 zm_009 zm_010 zm_011 zm_012 zm_013 zm_014 zm_015 zm_016 zm_020 '
          'zm_025 zm_029 zm_030 zm_031 zm_033 zm_034 zm_035 zm_037 zm_041 zm_045 zm_050 zm_052 zm_053 zm_054 zm_055 zm_056 zm_057 '
          'zm_058 zm_061 zm_062 zm_063 zm_064 zm_065 zm_066 zm_068 zm_069 zm_080 zm_081 zm_082 zm_089 zm_091 zm_095 zm_096 zm_097 '
          'zm_098 zm_100').split()
SID = {n: i for i, n in enumerate(VOICES)}

# 角色默认音色:助手 = 女声(沉稳、语速略快);用户 = 男声;第三方轮流用(与用户拉开音高)
DEFAULT_VOICE = {'assistant': 'zf_001', 'user': 'zm_010'}
THIRD_PARTY_POOL = ['zm_029', 'zf_047', 'zm_011', 'zf_006', 'zm_012']

DIGITS = '零一二三四五六七八九'


def zh_digits(m):
    d = m.group(0)
    return ''.join(DIGITS[int(ch)] for ch in d) if len(d) >= 3 else d     # 301 → 三零一(房间号/尾号念法);短数字交给 number-zh.fst


def prep_text(text: str) -> str:
    """把剧本台词整理成引擎读得顺的文本:去掉舞台符号、英文缩写留空格、数字念法。"""
    t = text.strip()
    t = re.sub(r'[「」『』“”"]', '', t)
    t = t.replace('Q&A', 'Q and A').replace('&', ' and ')
    t = re.sub(r'\b[eE]mm+\b', '嗯', t)
    t = re.sub(r'\d+', zh_digits, t)
    t = re.sub(r'([A-Za-z]+)', r' \1 ', t)                       # 中英文之间留空格,英文段走 espeak
    t = re.sub(r'(—+|…+|-{2,})$', '', t.strip())                    # 句尾被打断的破折号
    t = re.sub(r'—+|…+|-{2,}', '，', t)
    t = re.sub(r'[，、]{2,}', '，', t)
    t = re.sub(r'[，、]+([。！？])', r'\1', t)
    t = re.sub(r'\s+', ' ', t).strip().strip('，、 ')
    if t and t[-1] not in '。！？.!?': t += '。'
    return t


def speed_for(it, base=1.0):
    s = float(it.get('speed') or 1.0) * base
    if it.get('role') == 'user': s *= 1.05
    d = (it.get('direction') or '') + (it.get('tone') or '')
    if re.search(r'急促|抢话|硬插|着急|快', d): s *= 1.08
    if re.search(r'轻缓|放松|轻声|压低|低语|叹气|慢', d): s *= 0.95
    if it.get('whisper'): s *= 0.95
    return round(min(1.25, max(0.85, s)), 3)


def local_hash(voice, speed, text):
    return hashlib.sha1(f'{ENGINE}|{voice}|{speed}|{text}'.encode('utf-8')).hexdigest()[:16]


def ensure_model(model_dir: Path):
    if (model_dir / 'model.onnx').exists() and (model_dir / 'voices.bin').exists():
        return model_dir
    model_dir.parent.mkdir(parents=True, exist_ok=True)
    tarball = model_dir.parent / f'{MODEL_NAME}.tar.bz2'
    print(f'下载模型 {MODEL_URL}\n  → {tarball}', file=sys.stderr)

    def hook(n, bs, total):
        if total > 0 and n % 200 == 0: print(f'\r  {n * bs / 1048576:6.0f} / {total / 1048576:.0f} MB', end='', file=sys.stderr)
    urllib.request.urlretrieve(MODEL_URL, tarball, hook)
    print('\n解压…', file=sys.stderr)
    with tarfile.open(tarball, 'r:bz2') as tf:
        tf.extractall(model_dir.parent)
    tarball.unlink(missing_ok=True)
    if not (model_dir / 'model.onnx').exists(): raise SystemExit(f'模型解压后没找到 {model_dir}/model.onnx')
    return model_dir


def make_tts(model_dir: Path, threads: int):
    try:
        import sherpa_onnx
    except ImportError:
        raise SystemExit('缺少 sherpa-onnx:pip install sherpa-onnx numpy')
    d = str(model_dir)
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=f'{d}/model.onnx', voices=f'{d}/voices.bin', tokens=f'{d}/tokens.txt',
                lexicon=f'{d}/lexicon-us-en.txt,{d}/lexicon-zh.txt', data_dir=f'{d}/espeak-ng-data', dict_dir=f'{d}/dict', lang=''),
            num_threads=threads, debug=False, provider='cpu'),
        rule_fsts=f'{d}/phone-zh.fst,{d}/date-zh.fst,{d}/number-zh.fst', max_num_sentences=1)
    return sherpa_onnx.OfflineTts(cfg)


def post_process(s, sr, whisper=False):
    import numpy as np
    s = np.asarray(s, dtype=np.float32)
    peak = float(np.abs(s).max()) if len(s) else 0.0
    if peak <= 0: return s
    thr = max(0.01, peak * 0.03)
    idx = np.where(np.abs(s) > thr)[0]
    a = max(0, idx[0] - int(0.04 * sr)); b = min(len(s), idx[-1] + int(0.15 * sr))
    s = s[a:b]
    rms = float(np.sqrt((s ** 2).mean())) or 1e-6
    gain = min(0.10 / rms, 0.95 / float(np.abs(s).max()))         # 统一到 -20 dBFS,峰值不过 0.95
    if whisper: gain *= 0.5
    return np.clip(s * gain, -1, 1)


def write_wav(path: Path, s, sr):
    import numpy as np
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((s * 32767).astype('<i2').tobytes())


def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which('ffmpeg')


def to_mp3(ff, wav: Path, mp3: Path):
    subprocess.run([ff, '-y', '-loglevel', 'error', '-i', str(wav), '-codec:a', 'libmp3lame', '-b:a', '64k', str(mp3)], check=True)


def main():
    ap = argparse.ArgumentParser(description='离线语音生成(Kokoro v1.1-zh via sherpa-onnx)')
    ap.add_argument('case_id', nargs='?')
    ap.add_argument('--voice', action='append', default=[], help='speaker=voice,可重复')
    ap.add_argument('--only', default='')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--no-mp3', action='store_true')
    ap.add_argument('--threads', type=int, default=min(8, os.cpu_count() or 4))
    ap.add_argument('--model-dir', default=os.environ.get('KOKORO_MODEL_DIR') or str(Path.home() / '.cache' / 'duplex-studio' / MODEL_NAME))
    ap.add_argument('--list-voices', action='store_true')
    a = ap.parse_args()
    if a.list_voices:
        for i, n in enumerate(VOICES): print(f'{i:3d}  {n}')
        return
    if not a.case_id: ap.error('用法:offline_tts.py <caseId> [--voice speaker=voice ...]')

    plan = json.loads(subprocess.check_output(['node', 'server/cli.js', 'plan', a.case_id, '--compact'], cwd=ROOT, text=True))
    items = plan['items']
    only = set(x for x in a.only.split(',') if x)
    if only: items = [it for it in items if it['id'] in only or it['clip'] in only]
    audio_dir = Path(plan['audio_dir']); audio_dir.mkdir(parents=True, exist_ok=True)

    overrides = dict(v.split('=', 1) for v in a.voice)
    third_i = 0; voice_of = {}
    for it in items:
        sp = it['speaker']
        if sp in voice_of: continue
        v = overrides.get(sp) or it.get('local_voice') or DEFAULT_VOICE.get(it.get('role'))
        if not v:
            v = THIRD_PARTY_POOL[third_i % len(THIRD_PARTY_POOL)]; third_i += 1
        if v not in SID: raise SystemExit(f'未知音色 {v}(--list-voices 查看)')
        voice_of[sp] = v
    print('音色:', ', '.join(f'{k}={v}' for k, v in voice_of.items()), file=sys.stderr)

    manifest_path = audio_dir / 'manifest.json'
    manifest = json.loads(manifest_path.read_text('utf-8')) if manifest_path.exists() else {'clips': {}}
    manifest.setdefault('clips', {})

    todo = []
    for it in items:
        voice = voice_of[it['speaker']]; speed = speed_for(it); text = prep_text(it['text'])
        h = local_hash(voice, speed, text)
        have = manifest['clips'].get(it['clip']) or {}
        if not a.force and have.get('hash') == h and (audio_dir / (it['clip'] + '.wav')).exists():
            continue
        todo.append((it, voice, speed, text, h))
    print(f'{len(items)} 句,需生成 {len(todo)} 句', file=sys.stderr)
    if not todo: return

    tts = make_tts(ensure_model(Path(a.model_dir)), a.threads)
    ff = None if a.no_mp3 else ffmpeg_exe()
    if not a.no_mp3 and not ff: print('提示:没找到 ffmpeg(pip install imageio-ffmpeg),只输出 wav', file=sys.stderr)
    t_all = time.time(); total_ms = 0
    for n, (it, voice, speed, text, h) in enumerate(todo, 1):
        t0 = time.time()
        au = tts.generate(text, sid=SID[voice], speed=speed)
        s = post_process(au.samples, au.sample_rate, whisper=bool(it.get('whisper')))
        wav = audio_dir / (it['clip'] + '.wav'); write_wav(wav, s, au.sample_rate)
        for ext in ('.m4a', '.ogg', '.opus', '.aac', '.flac'):
            (audio_dir / (it['clip'] + ext)).unlink(missing_ok=True)
        if ff: to_mp3(ff, wav, audio_dir / (it['clip'] + '.mp3'))
        st = wav.stat(); dur = round(len(s) / au.sample_rate * 1000); total_ms += dur
        manifest['clips'][it['clip']] = {
            'file': wav.name, 'size': st.st_size, 'mtime': st.st_mtime * 1000, 'duration_ms': dur, 'format': 'wav', 'sample_rate': au.sample_rate,
            'hash': h, 'source': f'local:{ENGINE}:{voice}', 'text': it['text'], 'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        }
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', 'utf-8')
        print(f'[{n}/{len(todo)}] {it["id"]} {it["speaker_name"]:<4} {voice} ×{speed:<5} {dur / 1000:5.1f}s ({time.time() - t0:.1f}s) {text[:30]}', file=sys.stderr)
    print(f'完成:{len(todo)} 句,语音共 {total_ms / 1000:.0f}s,用时 {time.time() - t_all:.0f}s → {audio_dir}', file=sys.stderr)


if __name__ == '__main__':
    main()
