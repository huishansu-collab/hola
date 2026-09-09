#!/usr/bin/env python3
"""从《语音双工 - Explicit case》PDF 里抽出 58 张六列双轨表。

    python3 local/explicit-cases/tables.py 文档.pdf local/explicit-cases/parsed.json

pdftotext -layout 会把表格串成一团：列宽每张表都不一样，单元格换行、时间格被拆成
「1,600 / – / 5,600」三行、表格还跨页。所以走 -bbox-layout 拿每个词的坐标：
表头的词给出列锚点，词按 x 落列；行距众数给出行高，超过行高才算换行数据行，
同时用「上一行时间已完整、又冒出新数字」兜住行距不明显的表。
"""
import json, re, subprocess, sys
from collections import Counter
from pathlib import Path

NAMES = ['time', 'user', 'assistant', 'reason', 'tool', 'expr']
AUTHORS = '郑琛达|袁国真|杜博伟|秦浩文|楚明翰|黎一禾'
WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">(.*?)</word>')
CASE = re.compile(r'^(?:✅+\s*)?case\s*([A-Z]\d+)\s*[｜|](.+)$')
SECTION = re.compile(r'^\d+\.\s*([A-Z])\s*(\S.*)$')   # 「1.A查东西」——PDF 里中英之间没空格
FULL = re.compile(r'^\d[\d,]*\s*[–—-]\s*\d[\d,]*$')
unesc = lambda s: (s.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
                   .replace('&quot;', '"').replace('&#39;', "'").replace('​', ''))


def read_lines(pdf):
    xml = subprocess.run(['pdftotext', '-bbox-layout', str(pdf), '-'],
                         capture_output=True, check=True, text=True).stdout
    out = []
    for page, text in enumerate(xml.split('<page ')[1:]):
        rows = {}
        for m in WORD.finditer(text):
            x, y, w = float(m.group(1)), round(float(m.group(2)), 1), unesc(m.group(3))
            if w.strip(): rows.setdefault(y, []).append((x, w))
        for y in sorted(rows): out.append((page, y, sorted(rows[y])))
    return out


def join(ws):
    s = ''
    for _, w in ws:
        if s and re.match(r'[0-9A-Za-z]', s[-1]) and re.match(r'[0-9A-Za-z]', w[0]): s += ' '
        s += w
    return s


def anchors(ws):
    a = {}
    for i, (x, w) in enumerate(ws):
        nxt = ws[i + 1][1] if i + 1 < len(ws) else ''
        if w == '时间' or w.startswith('（ms'): a.setdefault('time', x)
        elif w.startswith('用户音频轨') or w == '用户': a.setdefault('user', x)
        elif w == 'Assistant': a.setdefault('assistant', x)
        elif w.startswith('后台判断与反'): a.setdefault('reason', x)
        elif w == 'AI' and nxt.startswith('工'): a.setdefault('tool', x)
        elif w == 'AI' and nxt.startswith('回复内容'): a.setdefault('expr', x)
        elif w.startswith('工具调用'): a.setdefault('tool', x)
        elif w.startswith('回复内容'): a.setdefault('expr', x)
    return a


def is_header(ws):
    # 正文里也会出现「时间」「工具调用」这种词，带标点的行一律不当表头，
    # 否则列锚点被带偏，整页的列都会错位。
    return len(anchors(ws)) >= 2 and not re.search(r'[“”，。；]', join(ws))


def colof(x, anc):
    best = None
    for name in NAMES:
        if name in anc and x >= anc[name] - 4 and (best is None or anc[name] > anc[best]): best = name
    return best or 'time'


def parse(pdf):
    blocks, cur, section = [], None, ''
    for page, y, ws in read_lines(pdf):
        t = join(ws).strip()
        m = CASE.match(t)
        if m:
            cur = {'id': m.group(1), 'title': m.group(2).strip(), 'section': section, 'lines': []}
            blocks.append(cur); continue
        m2 = SECTION.match(t)
        if m2:
            # 「1.A查东西郑琛达」——分组名跟着文档走，末尾的作者名不要
            section = f"{m2.group(1)} " + re.sub(rf'({AUTHORS})\s*$', '', m2.group(2)).strip()
        if cur is None: continue
        if SECTION.match(t) or (t.startswith('第') and '部分' in t): cur = None; continue
        if t.startswith('标注Policy'): cur = None; continue   # 文末的标注 Policy 附录不属于任何 case
        cur['lines'].append((page, y, ws))
    cases = []
    for b in blocks:
        anc, body, note = {}, [], ''
        for page, y, ws in b['lines']:
            if is_header(ws): anc.update(anchors(ws)); body.append(None); continue
            if anc: body.append((page, y, ws))
            else: note += join(ws).strip()
        steps, prev = Counter(), None
        for item in body:
            if item is None: prev = None; continue
            if prev and prev[0] == item[0]: steps[round(item[1] - prev[1])] += 1
            prev = item[:2]
        thr = (steps.most_common(1)[0][0] if steps else 18) + 4
        rows, prev = [], None
        for item in body:
            if item is None: prev = None; continue
            page, y, ws = item
            cells = {n: '' for n in NAMES}
            for x, w in ws: cells[colof(x, anc)] += w
            tc = cells['time'].strip(); star = tc.startswith('★'); t = tc.lstrip('★').strip()
            done = bool(rows) and bool(FULL.match(re.sub(r'[^\d,–—-]', '', rows[-1]['time'])))
            starts = bool(re.match(r'^\d', t)) and done
            filled = sum(1 for n in NAMES[1:] if cells[n].strip())
            if prev and prev[0] == page: new = star or (y - prev[1]) > thr or starts
            else: new = starts and filled >= 1
            prev = (page, y)
            if new or not rows: rows.append({'star': star, **{n: '' for n in NAMES}})
            rows[-1]['time'] += t
            for n in NAMES[1:]: rows[-1][n] += cells[n]
        while rows and not FULL.match(re.sub(r'[^\d,–—-]', '', rows[0]['time'])):
            head = rows.pop(0)
            note += ''.join(head[n] for n in NAMES).replace('（ms）', '')
        out = []
        for r in rows:                       # 时间格被拆行的,并回上一行
            if out and not FULL.match(re.sub(r'[^\d,–—-]', '', r['time'])):
                for n in NAMES: out[-1][n] += r[n]
            else: out.append(r)
        out = [r for r in out if any(r[n].strip() for n in NAMES)]
        if out:                              # 文末的「标注 Policy」附录不属于最后一行
            for n in NAMES: out[-1][n] = re.split(r'标注\s*Policy', out[-1][n])[0]
        cases.append({'id': b['id'], 'title': b['title'], 'section': b['section'],
                      'note': note.strip(), 'rows': out})
    return cases


if __name__ == '__main__':
    cases = parse(sys.argv[1])
    dst = Path(sys.argv[2] if len(sys.argv) > 2 else 'parsed.json')
    dst.write_text(json.dumps(cases, ensure_ascii=False, indent=1) + '\n', 'utf-8')
    print(f'{len(cases)} 个 case,{sum(len(c["rows"]) for c in cases)} 行 → {dst}')
