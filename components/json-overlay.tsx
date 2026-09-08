import {HighlightJson} from './highlight-json';
import {useRef,useState} from 'react';
import {buildCaseData} from './case-data';
import {Code,X,Download} from './sf-symbols';
type Utterance={id:string;speaker:string;speaker_id:string;text:string;start_at_ms:number;end_at_ms:number};
export type InputEvent={event_id:string;event_type:'function_call'|'backend_call'|'memory_call'|'memory_call_fast'|'ui_event'|'payment_event'|'world_event';tool_name?:string;time_at_ms:number;query?:string;results?:Record<string,unknown>;result?:string;context?:Record<string,unknown>;confidence?:number};
export type Controls={fdx_annotation:{fdx_type:string;role:'user'|'assistant';start_at_ms:number;end_at_ms:number}[];emotion_annotation:unknown[];paralinguistic_annotation:unknown[];custom_annotation:unknown[]};
const tabs=['Meta','Utterances','Events','Annotation'] as const;
export function JsonOverlay({utterances,events,controls,durationMs,onOpen,metaOverride,caseTitle,caseId}:{caseId:string;caseTitle:string;metaOverride?:Record<string,unknown>;utterances:Utterance[];events:InputEvent[];controls:Controls;durationMs:number;onOpen:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [tab,setTab]=useState<typeof tabs[number]>('Utterances');
 const {meta,document:caseDocument}=buildCaseData({caseId,caseTitle,durationMs,events,utterances,controls,metaOverride});
 const download=()=>{
  const blob=new Blob([JSON.stringify(caseDocument,null,2)+'\n'],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='case.json';dialog.current?.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const close=()=>{dialog.current?.close();trigger.current?.focus()};
 return <><button ref={trigger} title="查看 JSON 数据" aria-label="查看 JSON 数据" aria-haspopup="dialog" onClick={()=>{onOpen();dialog.current?.showModal()}}><Code size={18}/></button>
 <dialog ref={dialog} className="json-overlay" aria-labelledby="json-case-title" onClose={()=>trigger.current?.focus()} onClick={e=>{if(e.target===dialog.current){const r=dialog.current!.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()}}}>
 <header className="json-sheet-header">
 <h2 id="json-case-title" className="json-case-title" title={caseTitle}>{caseTitle}</h2>
 <div className="json-tabs" role="tablist" aria-label="数据分类">{tabs.map((name,i)=><button key={name} id={`json-tab-${name}`} role="tab" aria-selected={tab===name} aria-controls="json-panel" tabIndex={tab===name?0:-1} onClick={()=>setTab(name)} onKeyDown={e=>{let next=i;if(e.key==='ArrowRight')next=(i+1)%tabs.length;else if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;e.preventDefault();setTab(tabs[next]);document.getElementById(`json-tab-${tabs[next]}`)?.focus()}}>{name}</button>)}</div><button className="json-download" aria-label="下载完整 JSON" title="下载完整 JSON" onClick={download}><Download size={16}/></button><button className="json-close" aria-label="关闭 JSON 面板" title="关闭 · Esc" onClick={close}><X size={16}/></button></header>
 <section key={tab} id="json-panel" role="tabpanel" aria-labelledby={`json-tab-${tab}`} tabIndex={0}>{tab==='Meta'?<pre><HighlightJson value={meta}/></pre>:tab==='Utterances'?<pre><HighlightJson value={{utterances}}/></pre>:tab==='Events'?<pre><HighlightJson value={{events}}/></pre>:tab==='Annotation'?<pre><HighlightJson value={controls}/></pre>:null}</section>
 </dialog></>;
}
