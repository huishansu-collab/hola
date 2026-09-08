import {HighlightJson} from './highlight-json';
import {useEffect,useRef} from 'react';
import type {Scenario} from '../app/page';
import {caseTags,type CaseFile,type CaseTag} from './case-directory';
import {summarizeCase} from './case-info';
import {X} from './sf-symbols';
const seconds=(ms:number)=>`${(ms/1000).toLocaleString('en-US',{maximumFractionDigits:3})} 秒`;
export function CaseInfoOverlay({file,folder,scenario,onTags,onClose}:{file:CaseFile;folder:string;scenario?:Scenario;onTags:(tags:CaseTag[])=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{dialog.current?.showModal()},[]);
 const info=scenario?summarizeCase(scenario):null;
 return <dialog ref={dialog} className="case-info-overlay" aria-labelledby="case-info-title" onClose={onClose} onClick={e=>{if(e.target===dialog.current){const r=dialog.current!.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.current?.close()}}}>
 <header><div><small>{folder}</small><h2 id="case-info-title">{file.name}</h2></div><button autoFocus aria-label="关闭 Case 信息" onClick={()=>dialog.current?.close()}><X size={18}/></button></header>
 <div className="case-info-content">
 <section><label className="case-type-label" htmlFor="case-type-select">类型</label><select id="case-type-select" className="case-type-select" value={file.tags?.[0]??''} onChange={e=>onTags(e.target.value?[e.target.value as CaseTag]:[])}><option value="" disabled>请选择类型</option>{caseTags.map(tag=><option key={tag} value={tag}>{tag}</option>)}</select></section>
 {info&&scenario?<>
 <dl className="case-info-metrics">{[['时长',seconds(info.duration)],['对话轮次',info.rounds],['事件记录',info.events],['工具调用',info.toolCalls],['音频片段',info.utterances],['轨道',info.tracks]].map(([title,value])=><div key={title}><dt>{title}</dt><dd>{value}</dd></div>)}</dl>
 <p className="case-info-caption">{scenario.timingStatus==='planned'&&'时序为设计值，语音尚未生成。'}一轮以用户发言开始，连续同角色片段合并计算。请求和返回各计一条事件，同一工具调用合并计数。</p>
 <section><h3>工具 <small>{info.tools.length} 种</small></h3><div className="case-tool-tags">{info.tools.map(name=><span key={name}>{name}</span>)}</div></section>
 <section><h3>交互与表达</h3><dl className="case-info-facts"><div><dt>语音打断</dt><dd>{info.interruptions} 次</dd></div><div><dt>发言轮次</dt><dd>{info.speakerTurns} 次</dd></div><div><dt>表达标注</dt><dd>{[...new Set(scenario.controlAnnotations.fdx_annotation.map(a=>a.fdx_type))].join('、')||'无'}</dd></div><div><dt>轨道</dt><dd>{scenario.tracks.map(t=>t.name).join(' · ')}</dd></div></dl></section>
 <details className="case-info-details"><summary>完整对白 <span>{info.utterances}</span></summary><ol>{scenario.utterances.map(u=><li key={u.id}><small>{u.speaker==='user'?'用户':'助手'} · {seconds(u.start_at_ms)} — {seconds(u.end_at_ms)}</small><p>{u.text}</p></li>)}</ol></details>
 <details className="case-info-details"><summary>Events <span>{info.events}</span></summary><ol>{scenario.inputEvents.map((e,i)=><li key={`${e.event_id}-${i}`}><small>{seconds(e.time_at_ms)} · {e.event_type}</small><p>{e.tool_name??(e.event_type==='payment_event'?'支付状态回传':e.event_type==='world_event'?'世界信号':e.context?.source==='living_edge'?'设备操作':'界面事件')} · {e.query!==undefined?'请求':e.results!==undefined||e.result!==undefined?'返回':'状态变化'}</p><pre><HighlightJson value={e}/></pre></li>)}</ol></details>
 </>:<p className="case-info-empty">这个 Case 还没有时间线数据。</p>}
 </div></dialog>;
}
