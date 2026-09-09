#!/usr/bin/env python3
"""按真实录音重排导入 Case 的时间线（planned → aligned）。

    python3 local/align_master.py explicit-a1 explicit-a2 ...      # 先对齐切点
    python3 local/explicit-cases/retime.py explicit-a1 ...         # 再重排时间线

文档给的是示意时长，真实录音每句长短都不一样。这里按录音重排：
台词按原顺序依次落位，句间保留文档写的间隔，助手起点仍对齐 400 ms 微轮次；
其余轨道（后台判断、工具、表达控制、用户控制）按「旧时间 → 新时间」的分段线性映射跟着走，
这样标注仍然贴在它原本对应的那句话上。

打断是唯一需要额外定夺的地方：文档只说「丢弃未播完的部分」，没写停在哪个字，
这里按录音时长的 80% 停声，并把这条写进 timeline.interruptions.timing_basis。
"""
import json, shutil, sys, importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
HERE = Path(__file__).resolve().parent
CUT = 0.8          # 被打断的那句播到录音的百分之多少
spec = importlib.util.spec_from_file_location('explicit_import', HERE / 'import.py')
imp = importlib.util.module_from_spec(spec); spec.loader.exec_module(imp)
grid = lambda t: -(-int(t) // 400) * 400


def mapper(anchors):
    """旧时间 → 新时间的分段线性映射。"""
    pts = sorted(set(anchors))
    def at(t):
        if t <= pts[0][0]: return pts[0][1] + (t - pts[0][0])
        if t >= pts[-1][0]: return pts[-1][1] + (t - pts[-1][0])
        for (a0, b0), (a1, b1) in zip(pts, pts[1:]):
            if a0 <= t <= a1:
                if a1 == a0: return b0
                return round(b0 + (b1 - b0) * (t - a0) / (a1 - a0))
        return t
    return at


def retime(cid):
    d = json.loads((ROOT / 'case-packages' / cid / 'case.json').read_text('utf-8'))
    t = json.loads((ROOT / 'case-packages' / cid / 'timeline.json').read_text('utf-8'))
    align = json.loads((ROOT / 'local' / cid / 'align.json').read_text('utf-8'))
    cut = {c['utterance_id']: c for c in align['clips']}
    dur = {k: v['source_end_ms'] - v['source_start_ms'] for k, v in cut.items()}
    old = sorted(d['utterances'], key=lambda u: (u['start_at_ms'], u['id']))
    stops = {i['assistant_id']: i for i in t.get('interruptions', [])}
    barge = {i['user_id']: i for i in t.get('interruptions', [])}
    place, cursor, prev_end = {}, 0, 0
    for u in old:
        gap = max(0, u['start_at_ms'] - prev_end)
        prev_end = max(prev_end, u['end_at_ms'])
        if u['id'] in barge:                       # 打断者：起点由被打断那句的停声点决定
            i = barge[u['id']]
            r = place[i['assistant_id']]
            a = max(r[0] + 400, r[2] - 400)
        else:
            a = cursor + gap
            if u['speaker'] == 'assistant': a = grid(a)
        length = dur[u['id']]
        if u['id'] in stops:                       # 被打断：只播到录音的 CUT，其余丢弃
            played = max(400, grid(length * CUT))
            place[u['id']] = (a, a + length, a + played)
            cursor = max(cursor, a + played)
        else:
            place[u['id']] = (a, a + length, a + length)
            cursor = max(cursor, a + length)
    anchors = [(0, 0)]
    for u in old:
        anchors.append((u['start_at_ms'], place[u['id']][0]))
        anchors.append((u['end_at_ms'], place[u['id']][2]))
    at = mapper(anchors)
    end_new = max(p[2] for p in place.values())
    duration = grid(end_new + 400)
    # 台词
    for u in d['utterances']:
        a, _, z = place[u['id']]
        u['start_at_ms'], u['end_at_ms'] = a, z
    d['utterances'].sort(key=lambda u: (u['start_at_ms'], u['id']))
    d['meta_data']['media']['audio']['duration_ms'] = duration
    d['static_context']['constraints'].update(
        timing_status='aligned', audio_status='generated',
        audio_note=('台词来自同一次整段对话生成，按语音识别对齐切分，原速播放；'
                    '其余轨道按旧时间到新时间的分段线性映射跟随。'))
    # 打断：停声点、audio.stop 回执
    for i in t.get('interruptions', []):
        a, full, z = place[i['assistant_id']]
        u0 = place[i['user_id']][0]
        i.update(detected_at_ms=u0, stop_command_at_ms=u0, fade_start_at_ms=u0, stop_at_ms=z,
                 timing_basis=f'文档只说丢弃未播完的部分，没写停在哪个字；这里播到录音时长的 {int(CUT * 100)}%')
    stop_events = {i['stop_at_ms']: i for i in t.get('interruptions', [])}
    # 其余轨道与事件
    for tr in t['tracks']:
        for c in tr['clips']:
            if 'start_at_ms' in c:
                a, z = at(c['start_at_ms']), at(c['end_at_ms'])
                if tr['id'] not in ('user', 'control', 'world'): a, z = grid(a), grid(z)
                if z <= a: z = a + 400
                c['start_at_ms'], c['end_at_ms'] = min(a, duration - 400), min(z, duration)
    for e in d['events']:
        e['time_at_ms'] = min(grid(at(e['time_at_ms'])), duration)
    for e in d['events']:                          # 打断的 audio.stop 必须落在真正的停声点上
        if e['tool_name'] == 'audio.stop':
            eid = e['event_id']
            pair = [x for x in d['events'] if x['event_id'] == eid]
            i = next((i for i in t.get('interruptions', []) if abs(i['stop_at_ms'] - pair[1]['time_at_ms']) < 4000), None)
            if not i: continue
            pair[0]['time_at_ms'] = i['stop_command_at_ms']
            pair[1]['time_at_ms'] = i['stop_at_ms']
            pair[1]['results'] = {'status': 'stopped', 'stopped_at_ms': i['stop_at_ms'], 'simulated': True}
    for a in d['paralinguistic_annotation'] + d['custom_annotation'] + d['fdx_annotation']:
        a['start_at_ms'], a['end_at_ms'] = at(a['start_at_ms']), at(a['end_at_ms'])
    d['events'].sort(key=lambda e: (e['time_at_ms'], e['event_id'], 'query' not in e))
    for tr in t['tracks']:
        imp.lanes([c for c in tr['clips'] if 'start_at_ms' in c])
    # 音频与切点
    sources = ROOT / 'case-packages' / cid / 'audio/sources'
    sources.mkdir(parents=True, exist_ok=True)
    shutil.copy(ROOT / 'local' / cid / 'audio/session-master.wav', sources / 'session-master.wav')
    clips = []
    for u in d['utterances']:
        c = cut[u['id']]
        clips.append({'utterance_id': u['id'], 'source': 'audio/sources/session-master.wav',
                      'source_start_ms': c['source_start_ms'],
                      'source_end_ms': c['source_start_ms'] + u['end_at_ms'] - u['start_at_ms']})
    (ROOT / 'case-packages' / cid / 'case.json').write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    (ROOT / 'case-packages' / cid / 'timeline.json').write_text(json.dumps(t, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    (ROOT / 'case-packages' / cid / 'generation/alignment.json').write_text(
        json.dumps({'schema_version': 1, 'clips': clips}, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    # script.md 的时序表跟着一起重排，否则包里两份时间对不上
    parsed = imp.split_tables(json.loads((HERE / 'parsed.json').read_text('utf-8')))
    code = cid[len('explicit-'):].upper()
    src = next((c for c in parsed if c['id'] == code), None)
    if src:
        b = imp.build(src); b['rowsrc'] = src['rows']
        b['rows'] = [(at(a), at(z)) for a, z in b['rows']]
        (ROOT / 'case-packages' / cid / 'script.md').write_text(
            imp.script_md(b, d, duration, aligned=True), 'utf-8')
    low = [c['utterance_id'] for c in align['clips'] if c.get('similarity', 1) < 0.5]
    print(f"{cid}: {len(d['utterances'])} 句 · {duration} ms"
          + (f' · 识别偏低 {" ".join(low)}' if low else ''))


if __name__ == '__main__':
    for cid in sys.argv[1:]: retime(cid)
