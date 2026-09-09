#!/usr/bin/env python3
"""按真实录音重排 backchannel 的时间线。

    python3 local/retime_backchannel.py

附和的位置不是按固定偏移取整，而是落在用户真实的换气处：从母带算出用户那句话
的能量包络，找出句读/换气形成的低能量窗口，把附和的起声放进这个窗口里——起声
落在气口内、话音压过用户接下来的半句，才是顺口应一声的听感。

助手起点必须对齐 400 毫秒步长（Case 包 v1 的规定），因此在候选气口中挑取整后
仍落在气口窗口内、且尾部能留够 800 毫秒用户人声的那一个。
"""
import json, shutil, wave, array
from pathlib import Path

R = Path(__file__).resolve().parent.parent
C = R / 'case-packages/backchannel'
TAIL = 800          # 附和收声后用户至少还要说这么久，否则就是打断而不是附和
LEAD = 400          # 用户先说满这么久才轮得到第一次附和
NEAR = 200          # 起声可以略早于气口——压着换气进去照样自然，晚于气口就迟了

align = json.loads((R / 'local/backchannel/align.json').read_text('utf-8'))
cut = {c['utterance_id']: c for c in align['clips']}
dur = {k: v['source_end_ms'] - v['source_start_ms'] for k, v in cut.items()}
case = json.loads((C / 'case.json').read_text('utf-8'))
text = {u['id']: u['text'] for u in case['utterances']}
speaker = {u['id']: u['speaker'] for u in case['utterances']}

_f = wave.open(str(R / 'local/backchannel/audio/session-master.wav'))
RATE = _f.getframerate()
PCM = array.array('h'); PCM.frombytes(_f.readframes(_f.getnframes())); _f.close()


def breaths(uid, frame_ms=20, floor=0.12, least=60):
    """用户那句话里的换气窗口，返回相对句首的 [(起, 止)] 毫秒。"""
    c = cut[uid]
    seg = PCM[c['source_start_ms'] * RATE // 1000:c['source_end_ms'] * RATE // 1000]
    w = int(RATE * frame_ms / 1000)
    env = [max((abs(x) for x in seg[i:i + w]), default=0) for i in range(0, len(seg), w)]
    thr = max(env) * floor
    out, start = [], None
    for i, v in enumerate(env):
        if v <= thr:
            if start is None: start = i
        else:
            if start is not None and (i - start) * frame_ms >= least:
                out.append((start * frame_ms, i * frame_ms))
            start = None
    return out


grid = lambda t: -(-t // 400) * 400
place = {}


def put(uid, start):
    if speaker[uid] == 'assistant': assert start % 400 == 0, (uid, start)
    place[uid] = (start, start + dur[uid]); return place[uid][1]


end = put('u001', 0)
TOOL_A, TOOL_B = grid(end), grid(end) + 800
end = put('u002', grid(max(end + 400, TOOL_B + 400)))


def vent(uid, backs):
    """把附和放进用户这句话的换气处。

    候选是这句话里每一个 400 毫秒刻度：先按前后留白筛掉不合格的，再看起声压不压得住
    换气窗口。同样压得住时取更长的那个气口——长停顿才是真换气，短的多半只是塞音。
    """
    global end
    u0 = grid(end + 400); u1 = u0 + dur[uid]; place[uid] = (u0, u1)
    span = sum(dur[b] for b in backs)
    wins = breaths(uid)
    best, at = None, grid(u0 + LEAD)
    while True:
        spans, cursor = [], at
        for x in backs:
            cursor = grid(cursor); spans.append((x, cursor, cursor + dur[x])); cursor += dur[x]
        if spans[-1][2] + TAIL > u1: break
        off = spans[0][1] - u0
        hit = max(((b - a, a, b) for a, b in wins if a - NEAR <= off <= b), default=None)
        if hit and (best is None or (hit[0], off) > best[0]):
            best = ((hit[0], off), spans, hit[1:])
        at += 400
    if not best:
        raise SystemExit(f'{uid}: {dur[uid]} ms 的人声里没有能放下 {"+".join(backs)}'
                         f'（{span} ms）又留够 {TAIL} ms 尾部的气口——需要重录或换宿主句')
    (_, off), spans, window = best
    for x, s, e in spans: place[x] = (s, e)
    print(f"  {uid}: 附和起声 +{off} ms，气口 {window[0]}–{window[1]} ms"
          f"{'（落在气口内）' if window[0] <= off <= window[1] else '（压着气口起声）'}，"
          f"收声后用户还说 {u1-spans[-1][2]} ms")
    end = u1


end = put('u003', grid(end + 400))
vent('u005', ['u004'])            # 吐槽的第二句就先应一声，不用等到第三句
vent('u006', ['u007', 'u008'])
end = put('u009', grid(end + 400))
vent('u010', ['u011'])
end = put('u012', grid(end + 400))
vent('u013', ['u014'])
end = put('u015', grid(end + 400))
end = put('u016', grid(end + 400))
DURATION = grid(end)

order = sorted(place, key=lambda k: place[k][0])
case['utterances'] = [{'id': k, 'speaker': speaker[k],
                       'speaker_id': 'user_1' if speaker[k] == 'user' else 'assistant',
                       'text': text[k], 'start_at_ms': place[k][0], 'end_at_ms': place[k][1]}
                      for k in order]
case['meta_data']['media']['audio']['duration_ms'] = DURATION
case['static_context']['constraints'].update(timing_status='aligned', audio_status='generated')
case['static_context']['constraints']['audio_note'] = (
    '十六段台词来自同一次整段对话生成，按识别对齐切分，原速播放。'
    '附和的起声落在用户真实的换气处，助手起点仍对齐 400 毫秒步长。')
for e in case['events']:
    e['time_at_ms'] = TOOL_A if e.get('query') is not None else TOOL_B
case['fdx_annotation'] = [
    {'fdx_type': t, 'role': 'assistant', 'start_at_ms': place[b][0], 'end_at_ms': place[b][1]}
    for b, t in [('u004', '附和词'), ('u007', '附和词'), ('u008', '附和词'),
                 ('u011', '附和句'), ('u014', '附和句')]]

before = lambda t, label, desc: {'kind': 'state', 'label': label, 'description': desc,
                                 'start_at_ms': (t // 400) * 400 - 400,
                                 'end_at_ms': (t // 400) * 400}
reasoning = [
    before(TOOL_A, '新时间明确唯一 · 直接改', '不反问确认，也不追问为什么改'),
    before(place['u002'][0], '更新成功 · event_id 不变', '同一场会的第一次改动，不新建日程'),
    before(place['u003'][0], '宣泄开始 · 陈述不是指令', '整段吐槽都不触发工具'),
    before(place['u005'][0], '第一句先听着 · 这一句再应', '刚起头就附和会打断节奏'),
    before(place['u004'][0], '换气处应一声 · 只表示在听', '一声轻应，不接话也不问原因'),
    before(place['u007'][0], '情绪续上来 · 连着应两声', '压在人声上，用户不停即不算打断'),
    before(place['u009'][0], '刚附和过 · 本轮不再出声', '控制附和密度'),
    before(place['u011'][0], '长句出现语义接缝 · 只表示在听', '不接话、不给建议、不切断句子'),
    before(place['u012'][0], '客户会与方案都没让动', '不查日历、不改、不提议帮挪，也不建任务或提醒'),
    before(place['u014'][0], '情绪到顶 · 顺原话收', '不加码、不升级，不承诺替用户跟老板交涉'),
    before(place['u015'][0], '用户表示自己处理 · 不接活', '不追问怎么调，也不提出代劳'),
    before(place['u016'][0], '只回应情绪 · 不复述改动', '改动已确认过一次，重复确认属于话多'),
]
seen = set()
for r in reasoning:
    assert r['start_at_ms'] >= 0 and r['start_at_ms'] not in seen, r['label']
    seen.add(r['start_at_ms'])

detail = {'u004': ('用户开口吐槽', '嗯', '一声轻应，只表示在听；不接话、不问原因，用户继续说。'),
          'u007': ('用户换气', '嗐', '四声短促气声；起声落在气口，用户未停。'),
          'u008': ('承接上一声附和', '是啊！', '纯应和，不带内容也不评价老板；用户继续说完。'),
          'u011': ('长句语义接缝', '那真是够呛', '共情处境，不评判也不给建议，不切断句子。'),
          'u014': ('情绪到顶', '唉，光耗在这上头了。', '顺用户原话收，不加码不升级。')}
tl = json.loads((C / 'timeline.json').read_text('utf-8'))
for t in tl['tracks']:
    if t['id'] == 'expression':
        t['clips'] = [{'kind': 'expression', 'label': lab, 'start_at_ms': place[b][0],
                       'end_at_ms': place[b][1], 'description': detail[b][2],
                       'trigger': detail[b][0], 'delivery': detail[b][1],
                       'annotation': detail[b][2]}
                      for b, lab in [('u004', '附和词 · 嗯'), ('u007', '附和词 · 嗐'),
                                     ('u008', '附和词 · 是啊！'),
                                     ('u011', '附和句 · 那真是够呛'),
                                     ('u014', '附和句 · 唉，光耗在这上头了')]]
    elif t['id'] == 'reasoning':
        t['clips'] = reasoning
# 附和压在哪一段用户人声上由落点决定，别让声明和时间线各说各的。
users = [u for u in place if speaker[u] == 'user']
tl['backchannels'] = [{'assistant_id': b, 'over_user_id': next(
    u for u in users if place[u][0] < place[b][0] and place[b][1] < place[u][1])}
    for b in ['u004', 'u007', 'u008', 'u011', 'u014']]
# 气口窗口随数据一起发布，界面据此把可落点画出来，方便人工微调。
tl['breaths'] = [{'utterance_id': u, 'host_start_ms': place[u][0],
                  'windows': [list(w) for w in breaths(u)]}
                 for u in ['u003', 'u005', 'u006', 'u009', 'u010', 'u012', 'u013', 'u015']]
tl['checkpoints'] = [
    {'name': '首次附和', 'title': '嗯', 'tag': '助手附和',
     'start_at_ms': place['u004'][0], 'end_at_ms': place['u004'][1],
     'note': '用户开口吐槽的第一句就应一声；纯语气，压在人声上，用户没停。'},
    {'name': '连声附和', 'title': '嗐 + 是啊！', 'tag': '助手附和',
     'start_at_ms': place['u007'][0], 'end_at_ms': place['u008'][1],
     'note': '情绪续上来才给第二次，中间隔着一整段用户发言。'},
    {'name': '句中附和', 'title': '那真是够呛 落在语义接缝', 'tag': '助手附和',
     'start_at_ms': place['u011'][0], 'end_at_ms': place['u011'][1],
     'note': '只表示在听，不切断句子，用户照常说完后半句。'},
    {'name': '用户接管', 'title': '我看看怎么调整吧',
     'start_at_ms': place['u015'][0], 'end_at_ms': place['u015'][1],
     'note': '用户表示自己处理；不接活、不提议代劳、不复述改动。'},
]
(C / 'case.json').write_text(json.dumps(case, ensure_ascii=False, indent=2) + '\n', 'utf-8')
(C / 'timeline.json').write_text(json.dumps(tl, ensure_ascii=False, indent=2) + '\n', 'utf-8')
(C / 'audio/sources').mkdir(parents=True, exist_ok=True)
shutil.copy(R / 'local/backchannel/audio/session-master.wav',
            C / 'audio/sources/session-master.wav')
(C / 'generation/alignment.json').write_text(json.dumps(
    {'schema_version': 1, 'clips': [{'utterance_id': c['utterance_id'],
      'source': 'audio/sources/session-master.wav',
      'source_start_ms': c['source_start_ms'], 'source_end_ms': c['source_end_ms']}
     for c in align['clips']]}, ensure_ascii=False, indent=2) + '\n', 'utf-8')
print(f'总时长 {DURATION} ms')
