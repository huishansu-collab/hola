import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import ts from 'typescript';
import {readZip,snapshotFromFiles,snapshotFiles,writeZip,jsonBytes} from '../lib/case-package/archive.ts';
import {decodeWav,wav} from '../lib/case-package/audio.ts';
const root=path.resolve('../Case Drafts/培训中低声点奶茶/revisions/v8');fs.mkdirSync(root+'/output',{recursive:true});
const old=readZip(fs.readFileSync('../Case Drafts/培训中低声点奶茶/revisions/v6/output/case.zip'));const snap=snapshotFromFiles(old),s=snap.scenario;
for(const t of s.tracks)for(const c of t.clips){c.a+=800;c.b+=800;}
for(const u of s.utterances){u.start_at_ms+=800;u.end_at_ms+=800;}
for(const e of s.inputEvents)e.time_at_ms+=800;
for(const list of Object.values(s.controlAnnotations))for(const x of list){if(typeof x.start_at_ms==='number')x.start_at_ms+=800;if(typeof x.end_at_ms==='number')x.end_at_ms+=800;}
s.END+=800;
const assistant=s.tracks.find(t=>t.name==='助手'),texts=s.utterances.filter(u=>u.speaker==='assistant').map(u=>({id:'text_'+u.id,role:'assistant',text:u.text,start_at_ms:u.start_at_ms,end_at_ms:u.end_at_ms,output_mode:'text'}));
assistant.en='纯文字输出';assistant.clips=assistant.clips.map((c,i)=>({a:c.a,b:c.b,label:c.label,outputMode:'text',messageId:texts[i].id,sub:'文字显示 · 悄悄话模式'}));
s.utterances=s.utterances.filter(u=>u.speaker!=='assistant');s.meta.dynamic_context={...s.meta.dynamic_context,text_messages:texts};s.controlAnnotations.fdx_annotation=[];s.tracks.find(t=>t.name==='表达控制').clips=[];
s.tracks.find(t=>t.name==='世界').clips.unshift({a:0,b:400,label:'双击 Living Edge · 进入悄悄话模式',sub:'living_edge.double_tap：助手仅显示文字，无语音或Loading'});
s.inputEvents.unshift({event_id:'enter_whisper_mode',event_type:'world_event',time_at_ms:0,name:'living_edge.double_tap',mode:'text_only',simulated:true});
s.meta.static_context.constraints={...s.meta.static_context.constraints,revision:'v8',assistant_output:'text_only',mode:'living_edge_double_tap',waiting_strategy:'文字模式无有声垫话、慢说或Loading'};
s.playableClips=s.tracks.flatMap(t=>t.clips).filter(c=>c.audioKey);const used=new Set(s.playableClips.map(c=>c.audioKey));snap.audio=Object.fromEntries(Object.entries(snap.audio).filter(([k])=>used.has(k)));assert(Object.keys(snap.audio).length===2);
const files=snapshotFiles(snap);
const code=fs.readFileSync('components/case-data.ts','utf8').replace("import baseMeta from './meta-data.json';",'const baseMeta='+fs.readFileSync('components/meta-data.json','utf8')+';');const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;const {buildCaseData}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
files['case.json']=jsonBytes(buildCaseData({caseId:snap.id,caseTitle:snap.title,durationMs:s.END,events:s.inputEvents,utterances:s.utterances,controls:s.controlAnnotations,metaOverride:s.meta}).document);
const left=new Float32Array(s.END*48),right=new Float32Array(s.END*48);
for(const c of s.playableClips){const a=snap.audio[c.audioKey],decoded=decodeWav(Buffer.from(a.src.split(',')[1],'base64'),true);left.set(decoded.samples.slice(Math.round(a.start*48000),Math.round(a.start*48000)+(c.b-c.a)*48),c.a*48);}
files['audio/combined.wav']=wav([left,right]);assert(right.every(x=>x===0));
for(const [name,bytes]of Object.entries(old))if(name.startsWith('source/audio/sources/user')||name==='source/generation/requests/user.json'||name==='notes/tool-variable-bindings.json')files[name]=bytes;
files['notes/text-messages.json']=jsonBytes(texts);
files['README.md']=new TextEncoder().encode('# v8 悄悄话模式\n\n0–0.4秒双击Living Edge世界信号，0.8秒用户耳语。助手全部为text片段，无音频引用、波形或Loading。保留用户音频，不创建静音助手WAV。文字区间是显示窗口。\n\n文本保留在助手轨道及case.dynamic_context.text_messages；utterances仅含用户语音。本包为可编辑snapshot/1；当前source/1仅支持语音，因此不伪造完整source/1清单，仅归档用户母带和生成请求。合成左声道为用户，右声道为空。用户听感沿用此前待复核状态。业务全部模拟。\n');
files['script.md']=new TextEncoder().encode('# 悄悄话点奶茶\n\n双击世界信号→用户耳语→助手文字确认与卡片→用户耳语确认→文字提示支付→模拟支付回调与查询→文字反馈。\n\n'+texts.map(x=>x.start_at_ms+'ms 文字：'+x.text).join('\n'));
const zip=writeZip(files);snapshotFromFiles(readZip(zip));fs.writeFileSync(root+'/output/case.zip',zip);fs.writeFileSync(root+'/output/audio.wav',files['audio/combined.wav']);console.log('Text snapshot:',s.END,'ms;',texts.length,'text messages; 2 user clips; assistant silent.');
