'use client';
import { useEffect, useRef, useState } from 'react';
import { EXPRESSIONS, SOURCES, TOOL_GROUPS, availableTools, editableTrack, saveClip, toolEventOf, toolGroup } from './clip-edit';
import type { Scenario } from '../app/page';
import { X } from './sf-symbols';

// 片段配置：新建和修改用同一张表。轨道不同，要填的东西不同——
// 工具片段要选工具、填参数和模拟返回；表达控制要挑一句助手语音贴上去；
// 用户控制和世界要写来源和动作。填错了当场说是哪一项，不写进时间线。
export type ClipTarget = { ti: number; ci: number | null; at: number };
export function ClipEditor({ scenario, target, onSave, onClose, onDelete }: {
  scenario: Scenario;
  target: ClipTarget;
  onSave: (s: Scenario) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const track = scenario.tracks[target.ti];
  const clip = target.ci === null ? undefined : track.clips[target.ci];
  const tools = availableTools(scenario);
  const request = clip ? scenario.inputEvents.find((e) => e.event_id === toolEventOf(scenario, clip) && e.query !== undefined) : undefined;
  const [toolName, setToolName] = useState(request?.tool_name ?? 'memory.get');
  const tool = tools.find((t) => t.function.name === toolName);
  const [label, setLabel] = useState(clip?.label ?? '');
  const [sub, setSub] = useState(clip?.sub ?? '');
  const [from, setFrom] = useState(clip?.a ?? target.at);
  const [to, setTo] = useState(clip?.b ?? target.at + 400);
  const [args, setArgs] = useState<Record<string, string>>(() => {
    try {
      return Object.fromEntries(Object.entries(JSON.parse(request?.query ?? '{}'))
        .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    } catch { return {}; }
  });
  const [results, setResults] = useState(JSON.stringify(
    scenario.inputEvents.find((e) => e.event_id === request?.event_id && e.query === undefined)?.results ?? {}, null, 2));
  const event = clip ? scenario.inputEvents.find((e) => !e.tool_name && (clip.inputEventId ? e.event_id === clip.inputEventId : e.time_at_ms === clip.a)) : undefined;
  const [source, setSource] = useState(String(event?.context?.source ?? (track.name === '世界' ? 'sms' : 'card')));
  const [action, setAction] = useState(String(event?.context?.action ?? (track.name === '世界' ? 'received' : 'click')));
  const [context, setContext] = useState(JSON.stringify(event?.context ?? {}, null, 2));
  const replies = scenario.tracks.find((t) => t.name === '助手')?.clips ?? [];
  const [assistantIndex, setAssistantIndex] = useState(() =>
    Math.max(0, replies.findIndex((c) => (clip ? c.a === clip.a && c.b === clip.b : c.a >= target.at))));
  const [annotation, setAnnotation] = useState(
    clip?.label.includes('慢说') ? '慢说' : clip?.label.includes('仅文字') ? '仅文字回复' : '垫句');
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  // 参数备选：字典里常见的值，加上这个 Case 里同一个工具已经用过的值。
  const options = (key: string) => {
    const known: Record<string, string[]> = {
      key: ['preference', 'locations', 'home'], sound: ['loading'],
      color: ['yellow', 'white', 'blue', 'green', 'red'],
      card_id: ['gmail_binding', 'payment', 'order'],
      playback_event_id: scenario.inputEvents.filter((e) => e.tool_name === 'audio.play' && e.query !== undefined).map((e) => e.event_id),
    };
    const values = [...(known[key] ?? [])];
    for (const e of scenario.inputEvents)
      if (e.tool_name === toolName && e.query)
        try { const v = JSON.parse(e.query)[key]; if (typeof v === 'string') values.push(v); } catch { /* 不是 JSON 就跳过 */ }
    return [...new Set(values)];
  };
  const object = (text: string) => {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('请填写 JSON 对象');
    return value;
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const form: Parameters<typeof saveClip>[3] = { label, sub, a: from, b: to, source, action, assistantIndex, annotation };
      if (track.name === '表达控制') form.label = annotation;
      if (track.name === '工具调用') {
        form.tool = tool;
        form.args = {};
        form.results = object(results);
        for (const [key, schema] of Object.entries(tool?.function.parameters.properties ?? {}) as [string, any][]) {
          const raw = args[key] ?? '';
          if (!raw.trim()) {
            if (tool?.function.parameters.required?.includes(key)) throw Error(`请填写 ${key}`);
            continue;
          }
          let value: unknown = raw;
          if (['object', 'array'].includes(schema.type)) {
            value = JSON.parse(raw);
            if (schema.type === 'array' ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value))
              throw Error(`${key} 格式不正确`);
          }
          if (['number', 'integer'].includes(schema.type)) {
            value = Number(raw);
            if (!Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) throw Error(`${key} 需要有效数字`);
          }
          if (schema.type === 'boolean') value = raw === 'true';
          form.args[key] = value;
        }
      }
      if (['世界', '用户控制'].includes(track.name)) form.context = object(context);
      onSave(saveClip(scenario, target.ti, target.ci, form));
    } catch (e) {
      setError(e instanceof Error ? e.message : '请检查表单');
    }
  };
  return <dialog className="block-editor" ref={dialog} aria-labelledby="block-editor-title" onCancel={onClose}
    onClick={(e) => {
      if (e.target !== dialog.current) return;
      const r = dialog.current.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
    }}>
    <header>
      <h2 id="block-editor-title">{clip ? '配置片段' : '创建片段'} · {track.name}</h2>
      <button type="button" className="block-close" aria-label="关闭片段配置" onClick={onClose}><X size={16} /></button>
    </header>
    <form onSubmit={submit}>
      <div className="block-form-fields">
        {!editableTrack(track.name) && <p className="block-notice">用户和助手语音轨道不支持手动创建片段，请通过 Case 音频生成或导入添加。</p>}
        {editableTrack(track.name) && track.name !== '表达控制' && <div className="block-time-fields">
          <label>开始（ms）<input aria-label="开始时间" type="number" min="0" step="400" value={from} onChange={(e) => setFrom(Number(e.target.value))} /></label>
          <label>结束（ms）<input aria-label="结束时间" type="number" min={from + 400} step="400" value={to} onChange={(e) => setTo(Number(e.target.value))} /></label>
        </div>}
        {!editableTrack(track.name) ? null : track.name === '工具调用' ? <>
          <label>工具
            <select aria-label="工具" value={toolName} onChange={(e) => { setToolName(e.target.value); setArgs({}); }}>
              {TOOL_GROUPS.map((group) => <optgroup key={group} label={group}>
                {tools.filter((t) => toolGroup(t.function.name) === group).map((t) =>
                  <option key={t.function.name} value={t.function.name}>{t.function.name}</option>)}
              </optgroup>)}
            </select>
          </label>
          <p className="block-help">{tool?.function.description}</p>
          {(Object.entries(tool?.function.parameters.properties ?? {}) as [string, any][]).map(([key, schema]) =>
            <label key={toolName + key}>{key}{tool?.function.parameters.required?.includes(key) ? ' *' : ''}
              {schema.enum ? <select aria-label={key} value={args[key] ?? ''} onChange={(e) => setArgs((v) => ({ ...v, [key]: e.target.value }))}>
                <option value="">请选择</option>
                {schema.enum.map((v: string) => <option key={v}>{v}</option>)}
              </select>
              : schema.type === 'boolean' ? <select aria-label={key} value={args[key] ?? ''} onChange={(e) => setArgs((v) => ({ ...v, [key]: e.target.value }))}>
                <option value="">请选择</option><option value="true">是</option><option value="false">否</option>
              </select>
              : ['object', 'array'].includes(schema.type) ? <textarea aria-label={key} placeholder={schema.type === 'array' ? '[]' : '{}'}
                value={args[key] ?? ''} onChange={(e) => setArgs((v) => ({ ...v, [key]: e.target.value }))} />
              : <>
                <input list={`block-options-${key}`} aria-label={key} type={['number', 'integer'].includes(schema.type) ? 'number' : 'text'}
                  step={schema.type === 'integer' ? '1' : 'any'} placeholder={schema.description}
                  value={args[key] ?? ''} onChange={(e) => setArgs((v) => ({ ...v, [key]: e.target.value }))} />
                <datalist id={`block-options-${key}`}>{options(key).map((v) => <option key={v} value={v} />)}</datalist>
              </>}
            </label>)}
          <label>模拟返回（JSON）<textarea aria-label="工具返回" value={results} onChange={(e) => setResults(e.target.value)} /></label>
        </> : track.name === '表达控制' ? <>
          <label>对应助手回复
            <select aria-label="对应助手回复" value={assistantIndex} onChange={(e) => setAssistantIndex(Number(e.target.value))}>
              {replies.map((c, i) => <option key={i} value={i}>{c.a}–{c.b} ms · {c.label}</option>)}
            </select>
          </label>
          <label>表达方式
            <select aria-label="表达方式" value={annotation} onChange={(e) => setAnnotation(e.target.value)}>
              {EXPRESSIONS.map((v) => <option key={v}>{v}</option>)}
            </select>
          </label>
          <p className="block-help">起止时间与所选助手回复对齐。</p>
        </> : <label>片段名称<input aria-label="片段名称" value={label} onChange={(e) => setLabel(e.target.value)} /></label>}
        {['用户控制', '世界'].includes(track.name) && <>
          <label>来源
            <select aria-label="信号来源" value={source} onChange={(e) => setSource(e.target.value)}>
              {[...new Set([source, ...(SOURCES[track.name] ?? [])])].map((v) => <option key={v}>{v}</option>)}
            </select>
          </label>
          <label>动作<input aria-label="动作" value={action} onChange={(e) => setAction(e.target.value)} /></label>
          <label>内容（JSON）<textarea aria-label="事件内容" value={context} onChange={(e) => setContext(e.target.value)} /></label>
        </>}
        {editableTrack(track.name) && <label>说明<textarea aria-label="片段说明" value={sub} onChange={(e) => setSub(e.target.value)} /></label>}
        {error && <p role="alert" className="block-error">{error}</p>}
      </div>
      <footer>
        {clip && <button type="button" className="block-delete" onClick={onDelete}>删除片段</button>}
        <span />
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" className="block-save" disabled={!editableTrack(track.name)}>保存</button>
      </footer>
    </form>
  </dialog>;
}
