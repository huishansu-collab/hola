#!/usr/bin/env python3
"""给导入的 Case 生成火山 seed-audio 的整段母带请求。

    python3 local/explicit-cases/voice_request.py explicit-a1 explicit-a2 ...

一个 Case 一次生成：所有台词按录制顺序（utterance id）连读，段间留静音，
之后用 local/align_master.py 按识别结果切段。角色描述全库统一——
用户是同一把男声、助手是同一把女声，这样几十个 Case 听起来像同一套系统。
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
USER_VOICE = ('30 岁上下的成年男性，普通话，日常说话的音量和语速，'
              '像跟熟人说话，不播音、不端着；仅有很轻的室内底噪。')
ASSIST_VOICE = ('24～25 岁女性的普通话声音，语速中等偏快，连贯松弛，'
                '用平时聊天的正常音量说话；干净人声，无环境声。')
# 场景一句话跟着文档的考点走，读的人需要知道自己在什么处境里说话。
SCENES = {
    'explicit-a1': '早上出门前站在玄关，随口问今天要不要带伞。',
    'explicit-a2': '刷手机看到代购，连着问汇率；问到第三句发现自己把币种看岔了，当场改口。',
    'explicit-a3': '看到一个不认识的字，用「上面一个山、下面一个今」描述字形问怎么念。',
    'explicit-b1': '在厨房定倒计时，说完就走开去忙别的；中途改了一次时长。',
    'explicit-b2': '出门前顺手交代一句「到家提醒我收衣服」，又补了个八点的兜底。',
    'explicit-b3': '工位上把明天的周会往后挪半小时，顺手让助手在群里发通知。',
    'explicit-c1': '在户外边走边口述回消息；助手念稿念到一半被打断，改了措辞重念。',
    'explicit-c2': '工位旁边有同事，全程压着嗓子低声问，助手一句话都不出声。',
    'explicit-c3': '让助手给张伟发消息，通讯录里有两个张伟，问清楚是哪个。',
    'explicit-d1': '开车等红灯，前面堵了，让助手换条不堵的路。',
}


def hints(lines, case):
    out = []
    if any(re.fullmatch(r'嗯[…\.]+', t) for _, t in lines):
        out.append('「嗯……」是等结果时先出声占住话权的垫话，轻声、自然拖长约 0.4 秒，'
                   '说完就收；它不是回答，后面紧跟的那句才是答案。')
    if any(t == '嗯。' for _, t in lines):
        out.append('单独的「嗯。」是短促的一声，只表示收到指令，不拖长、不上扬。')
    cut = [t for _, t in lines if t.endswith('——')]
    if cut:
        out.append(f'「{cut[0]}」说到破折号处就是被对方打断的地方；照常读完，'
                   '语气是话说到一半，不要把句子补完整、不要收尾。')
    if '低语' in json.dumps(case, ensure_ascii=False) or case['id'] == 'explicit-c2':
        out.append('这一条用户全程压着嗓子说，音量明显低于平时，但吐字要清楚。')
    return out


def request(cid):
    d = json.loads((ROOT / 'case-packages' / cid / 'case.json').read_text('utf-8'))
    lines = [(u['speaker'], u['text']) for u in sorted(d['utterances'], key=lambda u: u['id'])]
    role = {'user': '用户', 'assistant': '助手', 'third_party': '旁人'}
    scene = SCENES.get(cid, d['static_context']['constraints'].get('task_goal', ''))
    note = '\n'.join(f'{i + 1}. {h}' for i, h in enumerate(hints(lines, {'id': cid, **d})))
    body = '\n\n'.join(f'{role[s]}：{t}' for s, t in lines)
    prompt = (
        f'生成完整的 {len(lines)} 段双人普通话对话，严格按下面的顺序逐条读完，每段之间留约 0.8 秒静音，'
        '不读角色名或说明，不增加台词、不合并台词、不改字。各角色全程保持同一音色。无音乐、无环境音效。\n'
        f'场景：{scene}\n'
        f'用户：{USER_VOICE}\n'
        f'助手：{ASSIST_VOICE}\n'
        '两个角色音色要明显可分（男声与女声、音区拉开）。\n'
        '按意思连读，轻重有变化，小词轻轻带过，不把每个字都念得同样清楚。'
        '不要朗诵、客服腔或新闻播音腔，不刻意加气声或装甜。\n'
        + (f'\n几处特别说明：\n{note}\n' if note else '')
        + f'\n{body}')
    return {'model': 'seed-audio-1.0', 'text_prompt': prompt,
            'audio_config': {'format': 'mp3', 'sample_rate': 48000,
                             'pitch_rate': 0, 'speech_rate': 0, 'loudness_rate': 0},
            'watermark': {}}


if __name__ == '__main__':
    for cid in sys.argv[1:]:
        out = ROOT / 'local' / cid / 'master-request.json'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(request(cid), ensure_ascii=False, indent=2) + '\n', 'utf-8')
        print(f'{cid}: {out}')
