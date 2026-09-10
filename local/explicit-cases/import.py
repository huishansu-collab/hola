#!/usr/bin/env python3
"""把《语音双工 - Explicit case》文档里的 58 条脚本导成 Case 包 v1（planned，无音频）。

    python3 local/explicit-cases/import.py 文档.pdf     # 抽表 → parsed.json → case-packages/
    python3 local/explicit-cases/import.py              # 重新生成仓库里保留的这几条（默认 A 组）
    python3 local/explicit-cases/import.py c1 d1        # 按 case 号临时生成别的几条
    python3 local/explicit-cases/import.py all          # 全部 58 条都生成

文档是六列双轨表：时间 / 用户音频轨道 / Assistant 音频轨道 / 后台判断与反应 /
AI 工具调用轨道 / AI 回复内容·表达控制。列的位置每张表都不一样，所以先按表头
的词取列锚点，再按行距和时间格是否完整切行——见 tables.py。

转换里做了三件明确的事，别的都按原文照搬：
1. 时间按 400 ms 微轮次吸附。文档里有的表整体偏 50 ms（第一行触碰占 0–50），
   有的偏 100/200/300；先减去众数残差，再吸附到刻度，顺序保持不变。
2. 工具调用参数与返回按原文保留成文本，不虚构 API 字段——文档只给了中文参数。
3. 打断行（用户开口、助手「停止播报」）把上一句助手语音延到停声点，
   补一对 audio.stop，这样打断在数据里是真的重叠，而不只是一句注释。
"""
import json, re, sys, subprocess
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parent.parent.parent
HERE = ROOT / 'local/explicit-cases'
OUT = ROOT / 'case-packages'
PREFIX = 'explicit-'
AUTHORS = '郑琛达|袁国真|杜博伟|秦浩文|楚明翰|黎一禾'
QUOTE = re.compile(r'[“"]([^”"]*)[”"]')
DASH = re.compile(r'^[—\-–\s]*$')

def note_clean(s):
    s = re.sub(r'(道|轨道|（实际播出）|出）|Assistant音频轨道|AI回复内容／表达控制|后台判断与反应)+$', '', s.strip())
    return s.strip()


JUNK = {'道', '轨道', '出）', '音频轨道', '（实际播出）', '轨道（实际播出）', 'Assistant音频轨道'}


def clean(s):
    s = s.replace('​', '').strip()
    s = re.split(r'标注\s*Policy|唤醒和结束都写在明面上|每条脚本开头', s)[0]
    s = re.sub(r'^(轨道（实际播出）|轨道|道|出）)', '', s).strip()
    s = re.sub(r'（实际播出）', '', s)
    s = re.sub(rf'({AUTHORS})$', '', s).strip()
    s = re.sub(r'^—+|—+$', '', s).strip() if not DASH.match(s) else s
    return '' if s in JUNK else s

def quoted(s):
    q = [x.strip() for x in QUOTE.findall(s) if x.strip()]
    # 引号没收口的，把最后一个引号之后的尾巴也带上——表格换行会把后半句甩到下一行，
    # 只取成对的会把「有条快 8 分钟」这半句直接丢掉。
    if (s.count('“') + s.count('”') + s.count('"')) % 2 == 1:
        tail = re.split(r'[“”"]', s)[-1].strip()
        if tail: q.append(tail)
    return ' '.join(q)

def spans(row):
    t = row['time']
    m = re.search(r'\+(\d+):(\d+)(?:\.(\d))?\s*[–—-]\s*\+?(\d+):(\d+)(?:\.(\d))?', t)
    if m:
        g = m.groups()
        a = (int(g[0]) * 60 + int(g[1])) * 1000 + int(g[2] or 0) * 100
        b = (int(g[3]) * 60 + int(g[4])) * 1000 + int(g[5] or 0) * 100
        return a, b
    m = re.search(r'(\d{1,3}(?:,\d{3})*|\d+)\s*[–—-]\s*(\d{1,3}(?:,\d{3})*|\d+)', t)
    return int(m.group(1).replace(',', '')), int(m.group(2).replace(',', ''))

GAP = 10000        # 会话超时断开后重新唤醒，文档没写隔了多久，按 10 秒落表并写进说明


def absolute(rows):
    """文档时间 → 一条单调的时间轴。

    有两种「时钟重新起算」：G3 那种写「+8 分钟（计时到点）」的相对段，按标注加偏移；
    K3 那种会话超时后重新唤醒的第二个收音窗口，文档从 0 重新写，这里接在上一段后面
    留 GAP 毫秒——间隔文档没给，属于本次转换的假设，写在 script.md 里。
    """
    out, base, offset, prev_raw, prev_end, gaps = [], 0, 0, -1, 0, []
    for r in rows:
        m = re.search(r'\+(\d+)\s*分钟', r['time'])
        a, b = spans(r)
        if m: base = int(m.group(1)) * 60000
        a, b = a + base, b + base
        if a + 2000 < prev_raw:          # 判定只看原始时间，否则每一行都会再补一次偏移
            offset = prev_end + GAP - a
            gaps.append(len(out))
        prev_raw = a
        a, b = a + offset, b + offset
        prev_end = max(prev_end, b)
        out.append((a, b))
    return out, gaps


def normalize(rows):
    """文档时间 → 400 ms 刻度，顺序不变。"""
    raw, gaps = absolute(rows)
    res = Counter(a % 400 for a, _ in raw if a > 0)
    shift = res.most_common(1)[0][0] if res else 0
    if shift not in (0, 50, 100, 200, 300): shift = 0
    snap = lambda t: max(0, round(max(0, t - shift) / 400)) * 400
    out, last = [], -400
    for a, b in raw:
        a2, b2 = snap(a), snap(b)
        if a2 < last: a2 = last
        if b2 <= a2: b2 = a2 + 400
        out.append((a2, b2)); last = a2
    return out, shift, gaps


# \w 在 Python 里连中文一起匹配，工具名会把后面的「发起」「执行中」粘进来，只认 ASCII。
TOOLNAME = re.compile(r'([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+(?:/[A-Za-z0-9_.]+)?)')
BARE = re.compile(r'^([a-z]{2,12})\s*[（(]')          # 文档里不带点的工具：calc、location、seek
DONE = re.compile(r'成功|完成|返回|已设|命中|失败|已发|触发|撤销')


def tool_calls(text):
    """一格里的工具动作 → [(kind, name, args, 原文)]。

    「查询成功，耗时400ms」这种没写工具名的返回要落到当前挂着的那次调用上，
    不然会把「ms」当成工具名——文档里返回句常常只写耗时。
    """
    out = []
    for seg in re.split(r'[；;]', text):
        seg = seg.strip()
        if not seg or DASH.match(seg): continue
        m = TOOLNAME.search(seg) or BARE.match(seg)
        name = m.group(1) if m else None
        args = ''
        if name:
            m2 = re.search(re.escape(name) + r'\s*[（(]([^）)]*)[）)]', seg)
            args = (m2.group(1).strip() if m2 else '')
        if re.search(r'发起|检索中|进行中$', seg): out.append(('call', name, args, seg))
        elif DONE.search(seg): out.append(('result', name, args, seg))
        elif name: out.append(('once', name, args, seg))
        else: out.append(('note', None, '', seg))
    return out


def build(case):
    code = case['id']
    cid = PREFIX + code.lower()
    title = f"{code} · {case['title']}"
    rows, shift, gaps = normalize(case['rows'])
    users, assistants, controls, worlds = [], [], [], []
    states, exprs, tool_clips, events, tools = [], [], [], [], {}
    customs, paras = [], []
    pending = {}
    seq = [0]
    def uid():
        seq[0] += 1; return f'u{seq[0]:03d}'
    stop_needed = []
    open_quote = {}
    odd = lambda t: (t.count('“') + t.count('”') + t.count('"')) % 2 == 1
    dash_tail = {}
    for (a, b), row in zip(rows, case['rows']):
        u, asst = clean(row['user']), clean(row['assistant'])
        # 用户轨:说话 / 行为 / 旁人
        if u and not DASH.match(u):
            if u.startswith('行为') or (u.startswith('（') and '”' not in u and '"' not in u):
                controls.append({'kind': 'action', 'label': re.sub(r'^行为[：:]\s*', '', u)[:60],
                                 'description': u, 'start_at_ms': a, 'end_at_ms': b})
            elif open_quote.get('user') and users and not quoted(u):
                # 上一行的引号没收口，这一行是同一句的后半截，接回去而不是新起一句
                users[-1]['text'] += dash_tail.pop('user', '') + u.strip('“”"\' ')
                users[-1]['end_at_ms'] = b
            else:
                text = (quoted(u) or re.sub(r'^[^：:]{0,8}[：:]', '', u)).strip('“”"\' ')
                who = 'third_party' if u.startswith('旁人') else 'user'
                if text:
                    i = uid()
                    users.append({'id': i, 'speaker': who, 'speaker_id': 'user_1' if who == 'user' else 'third_party_1',
                                  'text': text, 'start_at_ms': a, 'end_at_ms': b, '_raw': u})
                    # 打断在文档里有两种写法：用户格标「打断①」，或助手格写「停止播报」。
                    if re.match(r'^(打断|插话|同时开口|竞争打断)', u) or '停止播报' in asst:
                        stop_needed.append(i)
                    if re.match(r'^(改口|同时开口|打断)', u):
                        customs.append({'label': re.split(r'[：:]', u)[0], 'role': 'user',
                                        'start_at_ms': a, 'end_at_ms': b})
                    if '低语' in u or '压着嗓' in u:
                        paras.append({'type': '低语', 'role': 'user', 'start_at_ms': a, 'end_at_ms': b})
        # 助手轨:说话 / 非语音动作 / 停播
        if asst and not DASH.match(asst):
            if '停止播报' in asst:
                pass
            elif asst.startswith('（') and not QUOTE.search(asst):
                controls.append(None) if False else exprs.append(
                    {'kind': 'action', 'label': asst[:60], 'description': asst,
                     'start_at_ms': a, 'end_at_ms': b, '_track': 'assistant'})
            elif open_quote.get('assistant') and assistants and not quoted(asst):
                assistants[-1]['text'] += dash_tail.pop('assistant', '') + asst.strip('“”"\' ')
                assistants[-1]['end_at_ms'] = b
            else:
                text = (quoted(asst) or asst).strip('“”"\' ')
                if text:
                    i = uid()
                    assistants.append({'id': i, 'speaker': 'assistant', 'speaker_id': 'assistant',
                                       'text': text, 'start_at_ms': a, 'end_at_ms': b})
        # 「有俩张伟——」这种破折号是原文的停顿，clean 会把它剥掉，接续时再补回来
        dash_tail = {k: '——' for k, v in (('user', row['user']), ('assistant', row['assistant']))
                     if v.replace('​', '').rstrip().endswith('—')}
        open_quote = {'user': odd(u) or (open_quote.get('user') and not odd(u) and not quoted(u)),
                      'assistant': odd(asst) or (open_quote.get('assistant') and not odd(asst) and not quoted(asst))}
        r = clean(row['reason'])
        if r and not DASH.match(r):
            label = re.split(r'[（(]', r)[0][:40] or r[:40]
            states.append({'kind': 'state', 'label': label, 'description': r,
                           'start_at_ms': a, 'end_at_ms': b})
        e = clean(row['expr'])
        if e and not DASH.match(e):
            exprs.append({'kind': 'expression', 'label': re.split(r'[；;]', e)[0][:40], 'description': e,
                          'trigger': '', 'delivery': '', 'annotation': e,
                          'start_at_ms': a, 'end_at_ms': b, '_track': 'expression'})
        # 工具轨
        t = clean(row['tool'])
        if t and not DASH.match(t):
            for kind, name, args, seg in tool_calls(t):
                if kind == 'note' or (not name and not pending):
                    tool_clips.append({'kind': 'state', 'label': seg[:40], 'description': seg,
                                       'start_at_ms': a, 'end_at_ms': b})
                    continue
                if kind == 'call':
                    tools.setdefault(name, seg)
                    pending[name] = {'name': name, 'args': args, 'a': a, 'desc': seg}
                elif kind == 'result':
                    key = name if name in pending else next(iter(pending), None)
                    if key:
                        p = pending.pop(key)
                        tools.setdefault(p['name'], p['desc'])
                        events.append((p['name'], p['args'], p['a'], max(a, p['a'] + 400), p['desc'], seg))
                    else:
                        tools.setdefault(name, seg)
                        events.append((name, args, a, max(b, a + 400), seg, seg))
                else:
                    tools.setdefault(name, seg)
                    events.append((name, args, a, max(b, a + 400), seg, seg))
    for p in pending.values():
        events.append((p['name'], p['args'], p['a'], p['a'] + 400, p['desc'], '文档未写返回'))
    return dict(cid=cid, code=code, title=title, section=case.get('section', ''), gaps=gaps,
                note=note_clean(case['note']), shift=shift,
                rows=rows, users=users, assistants=assistants, controls=controls,
                states=states, exprs=exprs, tool_clips=tool_clips, events=events,
                tools=tools, customs=customs, paras=paras, stop_needed=stop_needed)


def lanes(clips):
    """同一轨道里时间重叠的片段分层，避免互相压住。"""
    ends = []
    for c in sorted(clips, key=lambda c: (c['start_at_ms'], c['end_at_ms'])):
        for i, e in enumerate(ends):
            if e <= c['start_at_ms']:
                c['lane'] = i; ends[i] = c['end_at_ms']; break
        else:
            c['lane'] = len(ends); ends.append(c['end_at_ms'])
    for c in clips:
        if c.get('lane') == 0: c.pop('lane')
    return clips


def emit(b):
    users, assistants = b['users'], b['assistants']
    events, tools = list(b['events']), dict(b['tools'])
    interruptions = []
    # 打断：把上一句助手语音延到停声点，补一对 audio.stop——数据里真的重叠才叫打断。
    for uid in b['stop_needed']:
        u = next(x for x in users if x['id'] == uid)
        before = [a for a in assistants if a['end_at_ms'] <= u['start_at_ms']]
        after = [a for a in assistants if a['start_at_ms'] > u['start_at_ms']]
        if not before: continue
        r = before[-1]
        stop = u['start_at_ms'] + 400
        if after and stop >= after[0]['start_at_ms']: continue
        r['end_at_ms'] = stop
        interruptions.append({'user_id': u['id'], 'assistant_id': r['id'],
                              'detected_at_ms': u['start_at_ms'], 'stop_command_at_ms': u['start_at_ms'],
                              'fade_start_at_ms': u['start_at_ms'], 'stop_at_ms': stop,
                              'timing_basis': '文档给的是「≤400 ms 停声」，这里按一个微轮次落表'})
        # 文档在打断那一行往往已经写了 audio.stop，替换掉它，别再补一条重复的
        payload = ('audio.stop', f"打断 {r['id']}", u['start_at_ms'], stop, '用户开口，停播当前语音',
                   {'status': 'stopped', 'stopped_at_ms': stop, 'simulated': True})
        same = next((n for n, e in enumerate(events)
                     if e[0] == 'audio.stop' and abs(e[2] - u['start_at_ms']) <= 400), None)
        if same is None: events.append(payload)
        else: events[same] = payload
        tools.setdefault('audio.stop', '用户打断时停止当前助手语音')
    # 文档按行排时序，个别行仍会让两条人声压在一起。压住不管的话，
    # 「打断」和「附和」就分不出来了，所以这里逐对定性：助手整段落在用户句内是附和，
    # 用户在助手说话中途开口是打断（补 audio.stop），其余的把助手挪到用户说完之后。
    backchannels = []
    for u in sorted(users, key=lambda x: x['start_at_ms']):
        for r in sorted(assistants, key=lambda x: x['start_at_ms']):
            if u['end_at_ms'] <= r['start_at_ms'] or r['end_at_ms'] <= u['start_at_ms']: continue
            if any(i['user_id'] == u['id'] and i['assistant_id'] == r['id'] for i in interruptions): continue
            if u['start_at_ms'] < r['start_at_ms'] < r['end_at_ms'] < u['end_at_ms']:
                backchannels.append({'assistant_id': r['id'], 'over_user_id': u['id']})
            elif r['start_at_ms'] < u['start_at_ms'] and r['start_at_ms'] + 400 <= u['start_at_ms']:
                r['end_at_ms'] = u['start_at_ms']       # 表格换行造成的尾巴，剪掉
            else:
                shift = u['end_at_ms'] - r['start_at_ms']
                r['start_at_ms'] += shift; r['end_at_ms'] += shift
    utterances = sorted(users + assistants, key=lambda u: (u['start_at_ms'], u['id']))
    for u in utterances: u.pop('_raw', None)
    duration = max([u['end_at_ms'] for u in utterances] + [c['end_at_ms'] for c in b['controls']] +
                   [c['end_at_ms'] for c in b['states']] + [400]) + 400
    # Events：文档只给了中文参数，就照原样存成文本，不虚构 API 字段。
    ev, defs, tool_clips = [], [], list(b['tool_clips'])
    for n, (name, args, a, z, desc, res) in enumerate(events):
        eid = f'e{n + 1:02d}'
        a = min(a, duration); z = min(max(z, a + 400), duration)
        ev.append({'event_id': eid, 'event_type': 'function_call', 'tool_name': name,
                   'time_at_ms': a, 'query': json.dumps({'request': args or desc}, ensure_ascii=False)})
        ev.append({'event_id': eid, 'event_type': 'function_call', 'tool_name': name, 'time_at_ms': z,
                   'results': res if isinstance(res, dict) else {'note': res, 'simulated': True}})
        tool_clips.append({'kind': 'tool', 'event_id': eid, 'description': desc[:60],
                           'start_at_ms': a, 'end_at_ms': z})
    ev.sort(key=lambda e: (e['time_at_ms'], e['event_id'], 'query' not in e))
    for name, desc in tools.items():
        defs.append({'type': 'function', 'function': {
            'name': name, 'description': desc[:120],
            'parameters': {'type': 'object', 'required': ['request'],
                           'properties': {'request': {'type': 'string', 'description': '文档原文写的调用参数'}}}}})
    case = {
        'meta_data': {'sample': {'sample_id': None, 'sample_name': None, 'case_id': b['cid'],
                                 'case_name': b['title'], 'source_type': 'simulated_case', 'case_spec_ref': None},
                      'media': {'audio': {'duration_ms': duration, 'file': None,
                                          'tracks': [{'track_ref': 'Channel 1', 'role': 'user'},
                                                     {'track_ref': 'Channel 2', 'role': 'assistant'}]}}},
        'static_context': {'system prompts': {}, 'memory': {},
                           'constraints': {'simulated': True, 'timing_status': 'planned', 'audio_status': 'none',
                                           'stream_step_ms': 400,
                                           'task_goal': b['note'][:200],
                                           'source': '《语音双工 - Explicit case》' + b['code'],
                                           'audio_note': '语音待生成；时间按文档示意值吸附到 400 ms 微轮次。'},
                           'tools': defs},
        'dynamic_context': {},
        'utterances': utterances,
        'events': ev,
        'fdx_annotation': [],
        'emotion_annotation': [],
        'paralinguistic_annotation': b['paras'],
        'custom_annotation': b['customs'],
    }
    def speech(kind, extra=()):
        """语音片段的时间在 case.json 里，分层要连同轨道上的其它片段一起算。"""
        picked = [{'kind': 'speech', 'utterance_id': u['id'],
                   'start_at_ms': u['start_at_ms'], 'end_at_ms': u['end_at_ms']}
                  for u in utterances if (u['speaker'] == 'assistant') == (kind == 'assistant')]
        merged = lanes(picked + [dict(c) for c in extra])
        return [{k: v for k, v in c.items() if not (c['kind'] == 'speech' and k.endswith('_at_ms'))}
                for c in sorted(merged, key=lambda c: (c['start_at_ms'], c.get('lane', 0)))]
    tracks = {
        'user': speech('user'),
        'control': lanes(b['controls']),
        'assistant': speech('assistant', [c for c in b['exprs'] if c.get('_track') == 'assistant']),
        'expression': lanes([dict(c) for c in b['exprs'] if c.get('_track') == 'expression']),
        'world': [],
        'reasoning': lanes(b['states']),
        'tools': [{k: v for k, v in c.items() if not (c['kind'] == 'tool' and k.endswith('_at_ms'))}
                  for c in lanes(tool_clips)],
    }
    for tr in tracks.values():
        for c in tr: c.pop('_track', None)
    timeline = {'schema_version': 1,
                'tracks': [{'id': k, 'clips': v} for k, v in tracks.items()],
                'response_links': [], 'interruptions': interruptions,
                'backchannels': [], 'checkpoints': [], 'tool_dependencies': []}
    return case, timeline, duration


def script_md(b, case, duration, aligned=False):
    fmt = lambda n: f'{n:,}'
    rows = ['| 时间（ms） | 用户音频轨道 | Assistant 音频轨道（实际播出） | 后台判断与反应 | AI 工具调用轨道 | AI 回复内容／表达控制 |',
            '|---|---|---|---|---|---|']
    for (a, z), r in zip(b['rows'], [dict(x) for x in b['rowsrc']]):
        cells = [f'{fmt(a)}–{fmt(z)}'] + [clean(r[k]).replace('|', '／') or '—'
                                          for k in ['user', 'assistant', 'reason', 'tool', 'expr']]
        rows.append('| ' + ' | '.join(c if c else '—' for c in cells) + ' |')
    return f"""# {b['title']}

{b['note']}

来源：《语音双工 - Explicit case》{b['code']}。{'语音已生成，下表时间按真实录音重排（台词依次落位，其余轨道按分段线性映射跟随）' if aligned else '语音尚未生成，时间为文档示意值，按 400 ms 微轮次吸附（原表整体偏移 ' + str(b['shift']) + ' ms，已减去）'}；
工具参数与返回按原文保留成文本，未虚构 API 字段。总时长 {fmt(duration)} ms，用户 {len([u for u in case['utterances'] if u['speaker'] != 'assistant'])} 段、
助手 {len([u for u in case['utterances'] if u['speaker'] == 'assistant'])} 段，工具调用 {len(case['events']) // 2} 次。

## 台词与时序

""" + '\n'.join(rows) + '\n'


def brief_md(b):
    return f"""# 需求：{b['title']}

## 要考察什么

{b['note']}

## 来源

《语音双工 - Explicit case》{b['code']}。本包由 `local/explicit-cases/import.py` 从原文档的六列双轨表生成：
台词、后台判断、工具调用与表达控制均按原文照搬，只把时间吸附到 400 ms 微轮次，
并把「打断」行落成真实的语音重叠（补一对 audio.stop）。语音待生成。
"""


def write(b):
    case, timeline, duration = emit(b)
    d = OUT / b['cid']
    (d / 'generation').mkdir(parents=True, exist_ok=True)
    (d / 'manifest.json').write_text(json.dumps({
        'schema_version': 1, 'case_id': b['cid'], 'title': b['title'], 'group': b['section'],
        'files': {'case': 'case.json', 'timeline': 'timeline.json',
                  'alignment': 'generation/alignment.json', 'brief': 'brief.md', 'script': 'script.md'}},
        ensure_ascii=False, indent=2) + '\n', 'utf-8')
    (d / 'case.json').write_text(json.dumps(case, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    (d / 'timeline.json').write_text(json.dumps(timeline, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    (d / 'generation/alignment.json').write_text(json.dumps(
        {'schema_version': 1, 'clips': []}, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    (d / 'brief.md').write_text(brief_md(b), 'utf-8')
    (d / 'script.md').write_text(script_md(b, case, duration), 'utf-8')
    return duration


def first_line(rows):
    for r in rows:
        q = quoted(clean(r['user']))
        if q: return q
    return ''


def split_tables(cases):
    """个别 case 在文档里给了两张表（同一段开场白重来一遍），拆成两个包。"""
    out = []
    for c in cases:
        rows, cut = c['rows'], None
        prev = -1
        for i, r in enumerate(rows):
            a, _ = spans(r)
            if a + 2000 < prev and first_line(rows[i:]) and first_line(rows[i:]) == first_line(rows):
                cut = i; break
            prev = a
        if cut is None: out.append(c); continue
        out.append({**c, 'title': c['title'] + '（表一）', 'rows': rows[:cut]})
        out.append({**c, 'id': c['id'] + 'B', 'title': c['title'] + '（表二）', 'rows': rows[cut:]})
        print(f"{c['id']}: 文档里有两张表，拆成 {c['id']} 与 {c['id']}B")
    return out


# 仓库里只保留 A 组，其余按需生成：parsed.json 留着全部 58 条，想要哪几条就传哪几条。
KEEP = ['A1', 'A2', 'A3']


def main():
    src = HERE / 'parsed.json'
    args = [a for a in sys.argv[1:] if not a.endswith('.pdf')]
    pdf = next((a for a in sys.argv[1:] if a.endswith('.pdf')), None)
    if pdf:
        subprocess.run([sys.executable, str(HERE / 'tables.py'), pdf, str(src)], check=True)
    want = [a.upper() for a in args] or KEEP
    cases = [c for c in split_tables(json.loads(src.read_text('utf-8')))
             if want == ['ALL'] or c['id'] in want]
    for c in cases:
        b = build(c)
        b['rowsrc'] = c['rows']
        dur = write(b)
        print(f"{b['cid']}: {len(b['users'])} 用户 / {len(b['assistants'])} 助手 / "
              f"{len(b['events'])} 工具 / {dur} ms")
    print(f'共 {len(cases)} 个 Case 包 → {OUT}')


if __name__ == '__main__':
    main()
