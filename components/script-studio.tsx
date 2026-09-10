'use client';
import { useMemo, useRef, useState } from 'react';
import { compileScript, speechMs } from './script-dsl';
import { buildRuntime } from '../lib/case-package/index.ts';
import baseMeta from './meta-data.json';
import milkTea from '../case-packages/meeting-milk-tea/script.dsl?raw';
import { ArrowRight, Check, Download, Flag, NewCase } from './sf-symbols';

// 流水线这一页：脚本在左边写，右边实时切轨。写完一键进时间线，再用手拖。
// 配音那一步在仓库里跑（要花钱、要 CI），页面只负责把闸门画清楚。
const STAGES = [
  { name: '写脚本', hint: '按 interaction-case-pipeline 写：谁说什么、后台在想什么、工具什么时候回来' },
  { name: '体检', hint: '编译 + 正式校验器：轨道、400 ms 网格、工具配对、打断与附和' },
  { name: '人 review', hint: '台词像不像人话；打断、附和、垫话该有的有没有；工具边界有没有越界' },
  { name: '切轨进时间线', hint: '自动分轨、自动分 lane，进来之后拖片段调时间' },
  { name: '配音与交付', hint: 'npm run ppl -- approve <id> --by 名字，然后 make：TTS、对齐、重排、构建' },
];
const TRACK_COLOR: Record<string, string> = {
  用户: 'green', 用户控制: 'pink', 助手: 'blue', 表达控制: 'purple',
  世界: 'gold', 后台判断: 'amber', 工具调用: 'teal',
};
const BLANK = `标题 新 Case
分组 未分组
目标 一句话说清：谁、在哪、要办什么
边界 这条 Case 到哪儿算结束

用户 帮我……
判断 听到了什么、准备干什么 [时长 800]
助手 嗯…… [垫句]
工具 q1: some.tool(key=值) => status=ok [时长 1200]
助手 好的，……。 [依赖 q1]
`;
const SAMPLES: { id: string; name: string; text: string }[] = [
  { id: 'milk-tea', name: '培训中低声点一杯奶茶', text: milkTea },
  { id: 'blank', name: '空白模板', text: BLANK },
];
const INSERTS = [
  ['用户', '用户 '],
  ['助手', '助手 '],
  ['垫句', '助手 嗯…… [垫句]'],
  ['附和', '助手 嗯。 [附和]'],
  ['打断', '用户 等下—— [打断]'],
  ['判断', '判断 '],
  ['工具', '工具 q1: some.tool(key=值) => status=ok [时长 1200]'],
  ['世界', '世界 '],
  ['控制', '控制 '],
];
const KEY = 'track-studio-script-draft-v1';
const fmt = (ms: number) => (ms / 1000).toFixed(1);

export function ScriptStudio({ onImport, onOpenTimeline }: {
  onImport: (file: File) => Promise<{ id: string; name: string }>;
  onOpenTimeline: () => void;
}) {
  const [text, setText] = useState(() => {
    try { return localStorage.getItem(KEY) ?? milkTea; } catch { return milkTea; }
  });
  const [reviewer, setReviewer] = useState(() => {
    try { return localStorage.getItem(KEY + '-review') ?? ''; } catch { return ''; }
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const write = (value: string) => {
    setText(value);
    setStatus('');
    try { localStorage.setItem(KEY, value); } catch { /* 存不下就只在本次会话里有效 */ }
  };
  const result = useMemo(() => {
    const compiled = compileScript(text, { baseMeta: baseMeta as Record<string, unknown> });
    let checked = '';
    if (compiled.pack) {
      try { buildRuntime(compiled.pack); } catch (e) { checked = e instanceof Error ? e.message : String(e); }
    }
    return { ...compiled, checked };
  }, [text]);
  const ok = !result.errors.length && !result.checked;
  const stage = !ok ? 1 : reviewer ? 3 : 2;
  const caseId = result.pack?.manifest.case_id ?? 'script-draft';
  const insert = (snippet: string) => {
    const el = area.current;
    const at = el ? el.selectionStart : text.length;
    const before = text.slice(0, at), after = text.slice(at);
    const value = before.replace(/\n*$/, '\n') + snippet + (after.startsWith('\n') ? '' : '\n') + after;
    write(value);
    requestAnimationFrame(() => {
      if (!el) return;
      const caret = before.replace(/\n*$/, '\n').length + snippet.length;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(result.pack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${caseId}.case.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const load = async () => {
    if (!result.pack) return;
    setBusy(true);
    try {
      const file = new File([JSON.stringify(result.pack)], `${caseId}.case.json`, { type: 'application/json' });
      const added = await onImport(file);
      setStatus(`已切轨导入「${added.name}」`);
      onOpenTimeline();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '导入失败');
    } finally { setBusy(false); }
  };
  const prompt = () => {
    const goal = /^\s*(?:目标|goal)\s*[：:]?\s*(.+)$/m.exec(text)?.[1] ?? '（把场景写在这里：谁、在哪、要办什么）';
    return `用 interaction-case-pipeline 这个 skill，生成一个 case：${goal}

按下面这套一行一件事的脚本格式输出，不要输出 JSON：

标题/分组/目标/边界 各一行；正文每行以轨道词开头——
用户、助手、判断、表达、世界、控制、工具。

修饰写在方括号里：
[垫句] [慢说] 助手表达标注；[附和] 压在用户话里；[打断] 用户抢话；
[低语] 用户耳语；[依赖 q1,q2] 等这些工具返回；[并行] 与上一件后台的事同时开始；
[时长 1.2秒] 指定时长；[不等] 不等前面的后台动作；其余方括号当备注。

工具行写成：工具 q1: 名字(参数=值) => 结果=值 [时长 1.2秒]

规矩：助手起点按 400 ms 网格；跨轨道依赖前置结束后留 400 ms；
工具时间按 interaction.md 的执行窗口选；等待超过 2 秒要有垫句；
偏好没记录就如实返回，不编；口头同意不等于支付。`;
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt()); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setStatus('复制失败，手动选中下面的提示词吧'); }
  };
  const span = Math.max(1, result.stats.duration);
  return <div className="ppl">
    <section className="ppl-left">
      <div className="ppl-bar">
        <span className="small-label">脚本</span>
        <select aria-label="载入示例" value="" onChange={(e) => { const s = SAMPLES.find((x) => x.id === e.target.value); if (s) write(s.text); }}>
          <option value="">载入示例…</option>
          {SAMPLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={copy} title="复制一段提示词，拿去让模型按 skill 写脚本">
          {copied ? <Check size={14} /> : <NewCase size={14} />}{copied ? '已复制' : '要模型写'}
        </button>
      </div>
      <div className="ppl-insert">{INSERTS.map(([name, snippet]) =>
        <button key={name} onClick={() => insert(snippet)} title={`插入一行${name}`}>{name}</button>)}
      </div>
      <textarea ref={area} className="ppl-script" spellCheck={false} value={text}
        aria-label="脚本" onChange={(e) => write(e.target.value)} />
      <details className="ppl-prompt">
        <summary>给模型的提示词（「要模型写」复制的就是这段）</summary>
        <pre>{prompt()}</pre>
      </details>
      <p className="ppl-help">
        一行一件事，行首的词决定落在哪条轨道。时间不用写：台词按字数估，
        助手起点自动对齐 400 ms，<code>[依赖 q1]</code> 就等 q1 返回。
        估出来的是 planned 时间，配音之后按录音重排。
      </p>
    </section>
    <section className="ppl-right">
      <ol className="ppl-stages">{STAGES.map((s, i) =>
        <li key={s.name} className={i < stage ? 'done' : i === stage ? 'current' : ''}>
          <b>{i < stage ? <Check size={13} /> : i + 1}</b>
          <div><span>{s.name}</span><small>{s.hint}</small></div>
        </li>)}
      </ol>
      <div className={'ppl-check ' + (ok ? 'pass' : 'fail')}>
        <b>{ok ? '体检通过' : '还过不了'}</b>
        <span>{ok
          ? `${result.stats.user} 段用户 · ${result.stats.assistant} 段助手 · ${result.stats.tools} 次工具 · 约 ${fmt(result.stats.duration)} 秒 · ${caseId}`
          : '改完下面这些再导入'}</span>
      </div>
      {(result.errors.length > 0 || result.checked) && <ul className="ppl-issues">
        {result.errors.map((e, i) => <li key={i}><b>第 {e.line} 行</b>{e.message}</li>)}
        {result.checked && <li><b>校验器</b>{result.checked}</li>}
      </ul>}
      {result.warnings.length > 0 && <ul className="ppl-issues warn">
        {result.warnings.map((w, i) => <li key={i}><b>提醒</b>{w.message}</li>)}
      </ul>}
      <div className="ppl-review">
        <span><Flag size={13} />人 review 是配音前的闸</span>
        <p>{STAGES[2].hint}</p>
        <label>看过的人
          <input value={reviewer} placeholder="写个名字" maxLength={24}
            onChange={(e) => { setReviewer(e.target.value); try { localStorage.setItem(KEY + '-review', e.target.value); } catch { /* 记不住就算了 */ } }} />
        </label>
        <small>配音要花钱，命令在仓库里跑：<code>npm run ppl -- approve {caseId} --by 名字</code> 之后 <code>make</code>。</small>
      </div>
      <div className="ppl-actions">
        <button className="primary" disabled={!ok || busy} onClick={load}>
          <ArrowRight size={14} />切轨并导入时间线
        </button>
        <button disabled={!ok} onClick={download}><Download size={14} />下载 case.json</button>
      </div>
      {status && <p className="ppl-status" role="status">{status}</p>}
      <div className="ppl-preview">
        <div className="small-label">切轨预览<small>{result.rows.length} 个片段 · 拖动调整在时间线里做</small></div>
        {result.rows.map((r, i) => <div className={'ppl-row ' + TRACK_COLOR[r.track]} key={i}>
          <span className="ppl-track">{r.track}{r.lane ? ` #${r.lane + 1}` : ''}</span>
          <span className="ppl-time">{fmt(r.start)}–{fmt(r.end)}</span>
          <span className="ppl-gantt"><i style={{ left: `${(r.start / span) * 100}%`, width: `${Math.max(0.8, ((r.end - r.start) / span) * 100)}%` }} /></span>
          <span className="ppl-label" title={r.note || r.label}>{r.tag && <em>{r.tag}</em>}{r.label}</span>
        </div>)}
      </div>
    </section>
  </div>;
}
export { speechMs };
