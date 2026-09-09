#!/usr/bin/env python3
"""把单文件页面里内嵌的 WAV data URI 无损转成 FLAC，页面体积约降到三分之一。

    python3 local/shrink_audio.py <输入.html> <输出.html>

FLAC 是无损的，解码后的采样数与原 WAV 完全一致，因此不会触发
components/audio/synthesis.ts 里「语音文件长度与时间线不一致」那条校验
（它的容差只有 2 个采样点，换成有损格式很容易因编码器补零而失败）。
仓库里的音频仍按 Case 包 v1 的规定保持 48 kHz WAV，这一步只作用于发布产物。
"""
import base64, os, re, subprocess, sys, tempfile

src, dst = sys.argv[1], sys.argv[2]
html = open(src, encoding='utf-8').read()
uris = list(dict.fromkeys(re.findall(r'data:audio/wav;base64,[A-Za-z0-9+/=]{100,}', html)))
tmp = tempfile.mkdtemp()
wav, flac = os.path.join(tmp, 'a.wav'), os.path.join(tmp, 'a.flac')
mapping = {}
for u in uris:
    open(wav, 'wb').write(base64.b64decode(u.split(',', 1)[1]))
    if os.path.exists(flac):
        os.remove(flac)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav,
                    '-c:a', 'flac', '-compression_level', '12', flac], check=True)
    mapping[u] = 'data:audio/flac;base64,' + base64.b64encode(open(flac, 'rb').read()).decode()
for u in sorted(mapping, key=len, reverse=True):     # 长的先替换，避免前缀互相干扰
    html = html.replace(u, mapping[u])
open(dst, 'w', encoding='utf-8').write(html)
print(f'{len(uris)} 条音频转 FLAC：{os.path.getsize(src)/1048576:.2f} MB → '
      f'{os.path.getsize(dst)/1048576:.2f} MB')
