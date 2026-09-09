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
HERE = Path(__file__).resolve().parent
USER_VOICE = ('30 岁上下的成年男性，普通话，日常说话的音量和语速，'
              '像跟熟人说话，不播音、不端着；仅有很轻的室内底噪。')
# 节奏说明放在最前面：这套 Case 考的是全双工的承接，念稿腔一出来整条就废了。
RHYTHM = """节奏（这条最重要）：
- 这是一段真实对话的录音，不是逐条朗读。接话的那句要像接着上一句说的：起音自然、不重新起调，
  不要每段都像新开场，也不要段段同一个语调曲线。
- 句子按意思断。长句中间该换气就换气，一个意群一口气；不要匀速念到底，也不要每个逗号都停一样长。
- 语气助词（啊、呢、吧、嘛、哈、诶、嗯、哦）是气口不是实词：轻、短、不重读，黏在前一个字上带过去。
- 陈述句尾音自然落下去，不要每句都往上扬；疑问只在最后一两个字抬。
- 应答和垫话（嗯、好、行、对）比正文低半档、短促，说完就收，不拖尾。
- 犹豫和停顿该有就有，但别拖到像卡住。"""
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


DELIVERY = re.compile(r'语速|音量|轻声|拖长|短音|重读|略慢|略快|收住|停顿|低语|压着嗓|压低|上扬|气声|一档|接话|承接|首音|念稿')
SKIP = re.compile(r'^(准备|禁止|考核点|不许|别)')
# 「保持静默」「听完不抢话」说的是这一行不出声，不是这句怎么念；表格串行还会切出「规语速」这种半截词。
MUTE = re.compile(r'静默|不发声|不出声|听完|不抢话|闭嘴')


def user_note(cid, text):
    """用户那一格里的（烦躁）（低语）（说完停 0.8 秒）本来就是读法，别丢了。"""
    code = cid[len('explicit-'):].upper().rstrip('B') if cid.startswith('explicit-') else cid
    rows = next((c['rows'] for c in json.loads((HERE / 'parsed.json').read_text('utf-8'))
                 if c['id'] == code), [])
    key = re.sub(r'[^\w\u4e00-\u9fff]', '', text)[:6]
    for r in rows:
        cell = r['user'].replace('​', '')
        if key and key in re.sub(r'[^\w\u4e00-\u9fff]', '', cell):
            notes = [n for n in re.findall(r'[（(]([^）)]{2,20})[）)]', cell)
                     if not re.search(r'触碰|LIVING|点击|按下|手机亮|静默|不出声', n)]
            return '；'.join(notes)[:60]
    return ''


def delivery(cid, uid):
    """文档的「AI 回复内容／表达控制」列本来就写了这句该怎么念，挑出跟语气有关的喂给生成。

    表达控制只管助手那一侧；「接话延迟 0ms」是时间线上的要求，母带里每句是分开读的，
    所以换成读法上的等价说法——起音像接话，不像重新开场。
    """
    d = json.loads((ROOT / 'case-packages' / cid / 'case.json').read_text('utf-8'))
    t = json.loads((ROOT / 'case-packages' / cid / 'timeline.json').read_text('utf-8'))
    u = next(x for x in d['utterances'] if x['id'] == uid)
    if u['speaker'] != 'assistant': return user_note(cid, u['text'])
    best, hit = 0, None
    for tr in t['tracks']:
        if tr['id'] != 'expression': continue
        for c in tr['clips']:
            over = min(c['end_at_ms'], u['end_at_ms']) - max(c['start_at_ms'], u['start_at_ms'])
            if over > best: best, hit = over, c
    out, seen = [], set()
    for seg in re.split(r'[；;]', (hit or {}).get('description', '')):
        seg = seg.strip()
        if not seg or SKIP.match(seg): continue
        if '接话延迟' in seg or '首音' in seg: seg = '紧接上一句起音，像接话不像开场'
        elif not DELIVERY.search(seg) or MUTE.search(seg): continue
        seg = re.sub(r'^规语速', '常规语速', seg)
        if len(seg) < 3: continue
        if seg not in seen: seen.add(seg); out.append(seg)
    return '；'.join(out)[:110]


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
    lines3 = [(u['id'], u['speaker'], u['text']) for u in sorted(d['utterances'], key=lambda u: u['id'])]
    lines = [(s, t) for _, s, t in lines3]
    role = {'user': '用户', 'assistant': '助手', 'third_party': '旁人'}
    scene = SCENES.get(cid, d['static_context']['constraints'].get('task_goal', ''))
    note = '\n'.join(f'{i + 1}. {h}' for i, h in enumerate(hints(lines, {'id': cid, **d})))
    def spoken(t):
        # 台词末尾的破折号是「被打断」的记号，不是要读的字。留着它，
        # 生成侧有时会整句跳过（C1 的「等下——」就被漏掉过），所以去掉、改成读法说明。
        return re.sub(r'[—－-]+$', '', t).strip() or t
    def note(uid, t):
        parts = [delivery(cid, uid)] + (['说到这儿被对方打断，读完就收，不要把句子补完整'] if t != spoken(t) else [])
        parts = [x for x in parts if x]
        return f'\n（读法：{"；".join(parts)}）' if parts else ''
    body = '\n\n'.join(f'{role[s]}：{spoken(t)}' + note(uid, t) for uid, s, t in lines3)
    prompt = (
        f'生成完整的 {len(lines)} 段双人普通话对话，严格按下面的顺序逐条读完，每段之间留约 0.8 秒静音，'
        '不读角色名或说明，不增加台词、不合并台词、不改字。各角色全程保持同一音色。无音乐、无环境音效。\n'
        f'场景：{scene}\n'
        f'用户：{USER_VOICE}\n'
        f'助手：{ASSIST_VOICE}\n'
        '两个角色音色要明显可分（男声与女声、音区拉开）。\n'
        '不要朗诵、客服腔或新闻播音腔，不刻意加气声或装甜。\n'
        f'\n{RHYTHM}\n'
        '\n下面每段台词后面括号里的「读法」是这一句的语气要求，照它念，但不要把括号里的字读出来。\n'
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
        req = request(cid)
        out.write_text(json.dumps(req, ensure_ascii=False, indent=2) + '\n', 'utf-8')
        # 备用版：去掉逐句读法，只留节奏段。火山的文本审核偶尔会拒掉带读法的那版
        # （B3 「发群通知」那条就被拒了两次），生成脚本会自动退到这一版。
        plain = dict(req, text_prompt=re.sub(r'\n（读法：[^）]*）', '', req['text_prompt']))
        (out.parent / 'master-request-plain.json').write_text(
            json.dumps(plain, ensure_ascii=False, indent=2) + '\n', 'utf-8')
        print(f'{cid}: {out}')
