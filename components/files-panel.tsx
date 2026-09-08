import {CaseInfoOverlay} from './case-info-overlay';
import type {Scenario} from '../app/page';
import {useEffect,useRef,useState,type DragEvent} from 'react';
import {caseTags,moveCase,type CaseFile,type Directory,type CaseDrop} from './case-directory';
export type {CaseFile} from './case-directory';
import {Folder,FolderOpen,NewCase,Plus} from './sf-symbols';
const initial:Directory[]=[{id:'default',name:'我的案例',cases:[{id:'weather',name:'北京天气 / 跑步提醒'},{id:'actor',name:'演员名字 / 追问电视剧'},{id:'ride',name:'回家路况 / 呼叫快车'},{id:'coffee',name:'订咖啡 / 偏好与地址确认'},{id:'sms',name:'手机欠费短信 / Living Edge 提醒'},{id:'gmail',name:'新用户查 Gmail 邮件'}]}];
export function FilesPanel({active,onSelect,getScenario,onInspect}:{getScenario:(id:string)=>Scenario|undefined;onInspect:()=>void;active:string;onSelect:(file:CaseFile)=>void}){
 const [folders,setFolders]=useState(initial),[folder,setFolder]=useState('default'),[open,setOpen]=useState<Record<string,boolean>>({default:true});
 const [creating,setCreating]=useState<'folder'|'case'|null>(null),[name,setName]=useState(''),[error,setError]=useState('');
 const [infoId,setInfoId]=useState<string|null>(null);
 const infoTrigger=useRef<HTMLButtonElement|null>(null);
 const infoFolder=folders.find(f=>f.cases.some(c=>c.id===infoId));
 const infoFile=infoFolder?.cases.find(c=>c.id===infoId);
 const infoScenario=infoId?getScenario(infoId):undefined;
 const dragId=useRef<string|null>(null);
 const [dragging,setDragging]=useState<string|null>(null),[dropTarget,setDropTarget]=useState<CaseDrop|null>(null);
 const save=(next:Directory[])=>{setFolders(next);try{localStorage.setItem('track-studio-files-v1',JSON.stringify(next));setError('')}catch{setError('无法保存到本地，刷新后可能丢失。')}};
 const endDrag=()=>{dragId.current=null;setDragging(null);setDropTarget(null)};
 const dragOver=(e:DragEvent,target:CaseDrop)=>{
  if(!dragId.current)return;
  e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';setDropTarget(target);
 };
 const drop=(e:DragEvent,target:CaseDrop)=>{
  if(!dragId.current)return;
  e.preventDefault();e.stopPropagation();
  const next=moveCase(folders,dragId.current,target);
  if(next!==folders){save(next);setFolder(target.folderId);setOpen(v=>({...v,[target.folderId]:true}))}
  endDrag();
 };
 const rowTarget=(e:DragEvent,folderId:string,caseId:string):CaseDrop=>({folderId,caseId,edge:e.clientY<e.currentTarget.getBoundingClientRect().top+e.currentTarget.getBoundingClientRect().height/2?'before':'after'});
 useEffect(()=>{
  try{
   let directories=initial;
   const raw=localStorage.getItem('track-studio-files-v1');
   if(raw){
    const data=JSON.parse(raw);
    if(Array.isArray(data)&&data.length&&data.every(f=>typeof f.id==='string'&&typeof f.name==='string'&&Array.isArray(f.cases)&&f.cases.every((c:CaseFile)=>typeof c.id==='string'&&typeof c.name==='string'))){
     for(const builtin of initial[0].cases)if(!data.some(f=>f.cases.some((c:CaseFile)=>c.id===builtin.id)))data[0].cases.push({...builtin});
     directories=data.map((f:Directory)=>({...f,cases:f.cases.map(c=>({...c,tags:Array.isArray(c.tags)?c.tags.filter(tag=>caseTags.includes(tag)).slice(0,1):[]}))}));
    }
   }
   if(directories.some(f=>f.cases.some(c=>c.id==='flight'))){
    directories=directories.map(f=>({...f,cases:f.cases.filter(c=>c.id!=='flight')}));
    localStorage.setItem('track-studio-files-v1',JSON.stringify(directories));
   }
   if(localStorage.getItem('track-studio-active-case-v1')==='flight')localStorage.removeItem('track-studio-active-case-v1');
   setFolders(directories);
   const savedId=localStorage.getItem('track-studio-active-case-v1');
   const selectedFolder=directories.find(f=>f.cases.some(c=>c.id===savedId))??directories.find(f=>f.cases.some(c=>c.id===active))??directories[0];
   setFolder(selectedFolder.id);
   setOpen(v=>({...v,[selectedFolder.id]:true}));
   const savedCase=selectedFolder.cases.find(c=>c.id===savedId);
   if(savedCase&&savedCase.id!==active)onSelect(savedCase);
  }catch{setError('本地文件目录读取失败。')}
 },[]);
 const create=()=>{const title=name.trim();if(!title)return;const id=crypto.randomUUID();let next:Directory[];
 if(creating==='folder'){next=[...folders,{id,name:title,cases:[]}];setFolder(id);setOpen(v=>({...v,[id]:true}))}
 else{const file={id,name:title};next=folders.map(f=>f.id===folder?{...f,cases:[...f.cases,file]}:f);setOpen(v=>({...v,[folder]:true}));onSelect(file)}
 save(next);setCreating(null);setName('');
 };
 return <><div className="files-heading"><span>Files</span><div className="files-header-actions"><button title="新建 Case" aria-label="新建 Case" onClick={()=>{setCreating('case');setName('')}}><NewCase size={14}/></button><button title="新建文件夹" aria-label="新建文件夹" onClick={()=>{setCreating('folder');setName('')}}><Plus size={14}/></button></div></div>

 {creating&&<form className="files-create" onSubmit={e=>{e.preventDefault();create()}}><label>{creating==='folder'?'新建文件夹':'新建 Case'}<input autoFocus value={name} maxLength={80} onChange={e=>setName(e.target.value)} placeholder={creating==='folder'?'文件夹名称':'Case 名称'} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setCreating(null)}}}/></label><div><button type="button" onClick={()=>setCreating(null)}>取消</button><button disabled={!name.trim()} type="submit">创建</button></div></form>}
 <div className="files-list" onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setDropTarget(null)}}>{folders.map(f=><div key={f.id} onDragOver={e=>dragOver(e,{folderId:f.id})} onDrop={e=>drop(e,{folderId:f.id})}><button className={'folder-row '+(folder===f.id?'selected':'')+(dropTarget?.folderId===f.id&&!dropTarget.caseId?' drop-folder':'')} aria-expanded={!!open[f.id]} onClick={()=>{setFolder(f.id);setOpen(v=>({...v,[f.id]:!v[f.id]}))}}>{open[f.id]?<FolderOpen size={15}/>:<Folder size={15}/>}<span className="file-name">{f.name}</span><small aria-label={`${f.cases.length} 个 Case`}>{f.cases.length}</small></button>{open[f.id]&&<div className="case-list">{f.cases.map(c=><div key={c.id} draggable onDragStart={e=>{if((e.target as HTMLElement).closest('.case-more')){e.preventDefault();return}dragId.current=c.id;setDragging(c.id);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',c.name)}} onDragEnd={endDrag} onDragOver={e=>dragOver(e,rowTarget(e,f.id,c.id))} onDrop={e=>drop(e,rowTarget(e,f.id,c.id))} className={'case-row '+(active===c.id?'active':'')+(dragging===c.id?' dragging':'')+(dropTarget?.folderId===f.id&&dropTarget.caseId===c.id&&dragging!==c.id?' drop-'+dropTarget.edge:'')}  ><button className="case-select" aria-current={active===c.id?'page':undefined} title={c.name} onClick={()=>{setFolder(f.id);onSelect(c)}}><span className="file-name">{c.name}</span><span className="case-row-tags">{(c.tags??[]).slice(0,1).map(tag=><span className={'case-tag tag-'+tag} key={tag}>{tag}</span>)}</span></button><button className="case-more" aria-label={`更多：${c.name}`} aria-haspopup="dialog" title="Case 信息" onClick={e=>{e.stopPropagation();infoTrigger.current=e.currentTarget;onInspect();setInfoId(c.id)}}><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/></svg></button></div>)}{!f.cases.length&&<p>暂无 Case</p>}</div>}</div>)}</div>{error&&<p className="files-error" role="status">{error}</p>}{infoFile&&infoFolder&&<CaseInfoOverlay file={infoFile} folder={infoFolder.name} scenario={infoScenario} onTags={tags=>save(folders.map(f=>({...f,cases:f.cases.map(c=>c.id===infoFile.id?{...c,tags}:c)})))} onClose={()=>{setInfoId(null);requestAnimationFrame(()=>infoTrigger.current?.focus())}}/>}</>;
}
