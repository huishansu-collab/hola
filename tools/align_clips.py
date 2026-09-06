#!/usr/bin/env python3
"""
tools/align_clips.py — 用语音识别把火山整段母带和剧本台词对齐,算出每句的精确切点(不调任何云端 API)。

    pip install sherpa-onnx numpy imageio-ffmpeg
    python3 tools/align_clips.py morning            # 首次自动下载 SenseVoice 模型(≈1GB,GitHub Releases)
    node server/cli.js recut morning               # 按对齐结果重新切段

流程:母带 → SenseVoice 逐字识别(带时间戳)→ 剧本字符与识别字符做编辑距离对齐 → 每句首尾字的时间 →
      相邻两句之间取能量最低的静音点作切点 → 写 cases/<id>/audio/master_align.json(recut 优先读它)。
纯静音切分在句内停顿(……、——)或句间没停顿时会切错,这一步能把这种错处修正掉。
"""
import json, os, re, subprocess, sys, tarfile, urllib.request, difflib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'
MODEL_URL = f'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{MODEL}.tar.bz2'
NORM = re.compile(r'[^一-鿿A-Za-z0-9]')
norm = lambda t: NORM.sub('', str(t)).lower()


def ffmpeg_exe():
    try:
        import imageio_ffmpeg; return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        import shutil; return shutil.which('ffmpeg')


def ensure_model(model_dir: Path):
    if (model_dir / 'model.int8.onnx').exists(): return model_dir
    model_dir.parent.mkdir(parents=True, exist_ok=True)
    tarball = model_dir.parent / f'{MODEL}.tar.bz2'
    print(f'下载识别模型 {MODEL_URL}', file=sys.stderr)
    urllib.request.urlretrieve(MODEL_URL, tarball)
    with tarfile.open(tarball, 'r:bz2') as tf: tf.extractall(model_dir.parent)
    tarball.unlink(missing_ok=True)
    return model_dir


def decode16k(ff, path):
    import numpy as np
    raw = subprocess.run([ff, '-loglevel', 'error', '-i', str(path), '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype('float32') / 32768


def rms_env(pcm, sr=16000, frame=0.02):
    import numpy as np
    n = int(sr * frame); total = len(pcm) // n
    x = pcm[:total * n].reshape(total, n)
    return np.sqrt((x * x).mean(axis=1))


def align_master(rec, ff, path, lines, pad=0.18):
    """lines: [{'id','text'}] → [[start,end]] 秒;附带每句识别相似度"""
    import numpy as np
    pcm = decode16k(ff, path); dur = len(pcm) / 16000
    st = rec.create_stream(); st.accept_waveform(16000, pcm); rec.decode_stream(st)
    toks = [norm(t) for t in st.result.tokens]; times = list(st.result.timestamps)
    hyp = []  # (char, time)
    for t, ts in zip(toks, times):
        for ch in t: hyp.append((ch, ts))
    ref = []  # (char, line index)
    for i, l in enumerate(lines):
        for ch in norm(l['text']): ref.append((ch, i))
    sm = difflib.SequenceMatcher(None, [c for c, _ in ref], [c for c, _ in hyp], autojunk=False)
    first = [None] * len(lines); last = [None] * len(lines); matched = [0] * len(lines)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != 'equal': continue
        for k in range(i2 - i1):
            li = ref[i1 + k][1]; ts = hyp[j1 + k][1]
            first[li] = ts if first[li] is None else min(first[li], ts)
            last[li] = ts if last[li] is None else max(last[li], ts)
            matched[li] += 1
    # 没识别到字的句子:按相邻句插值
    for i in range(len(lines)):
        if first[i] is None:
            prev_end = last[i - 1] if i > 0 and last[i - 1] is not None else 0.0
            nxt = next((first[j] for j in range(i + 1, len(lines)) if first[j] is not None), dur)
            first[i] = prev_end + (nxt - prev_end) * 0.35; last[i] = prev_end + (nxt - prev_end) * 0.65
    env = rms_env(pcm); th = env.max() * 0.06
    def lowest_point(a, b):
        fa, fb = int(a / 0.02), int(b / 0.02)
        if fb - fa < 2: return (a + b) / 2
        seg = env[fa:fb]
        # 最长的静音段取中点;没有静音段取能量最低帧
        best, cur, s0, bs = None, 0, None, 0
        for k, v in enumerate(seg):
            if v <= th:
                if s0 is None: s0 = k
                cur = k - s0 + 1
                if cur > bs: bs, best = cur, (s0, k)
            else: s0 = None
        if best and bs >= 3: return (fa + (best[0] + best[1]) / 2) * 0.02
        return (fa + int(seg.argmin())) * 0.02
    bounds = [0.0]
    for i in range(len(lines) - 1):
        a, b = last[i] + 0.12, first[i + 1] - 0.02
        if b <= a: a, b = last[i], first[i + 1]
        bounds.append(lowest_point(a, b))
    bounds.append(dur)
    regs = []
    for i in range(len(lines)):
        a, b = bounds[i], bounds[i + 1]
        fa, fb = int(a / 0.02), max(int(a / 0.02) + 1, int(b / 0.02))
        idx = np.where(env[fa:fb] > th)[0]
        if len(idx): a2, b2 = (fa + idx[0]) * 0.02, (fa + idx[-1] + 1) * 0.02
        else: a2, b2 = a, b
        regs.append([round(max(a, a2 - pad), 3), round(min(b, b2 + pad), 3)])
    sims = [round(matched[i] / max(1, len(norm(lines[i]['text']))), 2) for i in range(len(lines))]
    return regs, sims, st.result.text


def main():
    case = sys.argv[1] if len(sys.argv) > 1 else 'morning'
    model_dir = Path(os.environ.get('SENSEVOICE_DIR') or (Path.home() / '.cache' / 'duplex-studio' / MODEL))
    ensure_model(model_dir)
    import sherpa_onnx
    rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(model=str(model_dir / 'model.int8.onnx'), tokens=str(model_dir / 'tokens.txt'), num_threads=min(8, os.cpu_count() or 4), use_itn=False, language='zh')
    ff = ffmpeg_exe()
    if not ff: sys.exit('需要 ffmpeg(pip install imageio-ffmpeg)')
    plan = json.loads(subprocess.check_output(['node', 'server/cli.js', 'plan', case, '--provider', 'volc', '--compact'], cwd=ROOT, text=True))
    audio_dir = Path(plan['audio_dir'])
    items = plan['items']
    out = {}
    speakers = list(dict.fromkeys(it['speaker'] for it in items))
    for sp in speakers:
        sp_items = [it for it in items if it['speaker'] == sp]
        masters = []
        for f in sorted(os.listdir(audio_dir)):
            if f == f'master_{sp}.mp3': masters.append((f, 0))
            elif f.startswith(f'master_{sp}_') and f.endswith('.mp3'):
                fid = f[len(f'master_{sp}_'):-4]; idx = next((k for k, it in enumerate(sp_items) if it['id'] == fid), -1)
                if idx >= 0: masters.append((f, idx))
        masters.sort(key=lambda m: m[1])
        for k, (f, idx) in enumerate(masters):
            chunk = sp_items[idx:(masters[k + 1][1] if k + 1 < len(masters) else len(sp_items))]
            if not chunk: continue
            regs, sims, text = align_master(rec, ff, audio_dir / f, chunk)
            out[f] = {'ids': [it['id'] for it in chunk], 'regs': regs, 'sim': sims}
            low = [f"{it['id']}({s:.2f})" for it, s in zip(chunk, sims) if s < 0.5]
            print(f'{f}: {len(chunk)} 句 · 识别匹配率均值 {sum(sims)/len(sims):.2f}' + (f' · 偏低: {" ".join(low)}' if low else ''), file=sys.stderr)
    (audio_dir / 'master_align.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', 'utf-8')
    print(f'→ {audio_dir / "master_align.json"}({len(out)} 条母带)', file=sys.stderr)


if __name__ == '__main__':
    main()
