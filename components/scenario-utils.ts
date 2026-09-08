import {separateLoading} from './loading-spacing';
import {audioClips} from './audio/use-timeline-audio';
import type {Clip,Scenario} from '../app/page';
import type {InputEvent,Controls} from './json-overlay';
export const grid=(t:number)=>Math.ceil(t/400)*400;
export const voice=(key:string,a:number,label:string,event?:number):Clip=>({a,b:a+audioClips[key].duration*1000,label,wave:true,audioKey:key,event});
export const block=(a:number,b:number,label:string,sub?:string,event?:number):Clip=>({a,b,label,sub,event});
export function interruption(id:number,u:Clip,a:Clip,plan:string,drop:string,actions:string[]):Scenario['events'][number]{
 return {id,t:u.a,end:a.b,name:`打断 0${id+1}`,title:actions[0],quote:u.label,tag:'用户打断',plan,heard:a.label.replace(/\[丢弃：[^\]]*\]/g,''),drop,actions,tool:'停止播报与取消任务分别判断',note:`案例排布：用户起声 ${u.a} 毫秒；检出与停播指令 ${grid(u.a)} 毫秒；实际停声 ${Math.round(a.b)} 毫秒。非实测系统延迟。`,overlap:[u.a,a.b]};
}
export const expression=(c:Clip,label:string,trigger:string)=>({a:c.a,b:c.b,label,trigger,delivery:c.label,annotation:'表达起止与实际音频对齐；默认语速无需另行标注。'});
export function sound(a:number,b:number,speech:Clip[]):Clip{
 const times=new Set([a,a+120,b-180,b]);
 for(const c of speech)for(const t of [c.a,c.a+80,c.b,c.b+200])if(t>a&&t<b)times.add(t);
 const gainPoints:[number,number][]=Array.from(times).sort((x,y)=>x-y).map(t=>{
  let duck=1;
  for(const c of speech){if(t>=c.a&&t<c.a+80)duck=Math.min(duck,1-.78*(t-c.a)/80);else if(t>=c.a+80&&t<=c.b)duck=Math.min(duck,.22);else if(t>c.b&&t<c.b+200)duck=Math.min(duck,.22+.78*(t-c.b)/200)}
  return [t,.35*Math.max(0,Math.min(1,(t-a)/120,(b-t)/180))*duck];
 });
 return {a,b,label:'audio.play()',sub:`Loading 音效 · ${(b-a)/1000} 秒 · 人声时压低，完成后停止`,audioKey:'actor_loading',loop:true,gainPoints};
}
export function toolPair(id:string,name:string,a:number,b:number,query:string,results:Record<string,unknown>):InputEvent[]{
 return [{event_id:id,event_type:'function_call',tool_name:name,time_at_ms:a,query},{event_id:id,event_type:'function_call',tool_name:name,time_at_ms:b,results}];
}
export function finish(tracks:Scenario['tracks'],events:Scenario['events'],expressions:Scenario['expressions'],inputEvents:InputEvent[]):Scenario{
 const utterances=tracks.slice(0,2).flatMap(t=>t.clips.map(c=>({c,speaker:t.name==='用户'?'user':'assistant'}))).sort((a,b)=>a.c.a-b.c.a).map(({c,speaker},i)=>({id:`u${String(i+1).padStart(3,'0')}`,speaker,speaker_id:speaker==='user'?'user_1':'assistant',text:c.label.replace(/\[丢弃：[^\]]*\]/g,''),start_at_ms:Math.round(c.a),end_at_ms:Math.round(c.b)}));
 const controlAnnotations:Controls={fdx_annotation:expressions.flatMap(e=>[{fdx_type:'垫句',role:'assistant' as const,start_at_ms:e.a,end_at_ms:Math.round(e.b)},...(e.label.includes('0.85')?[{fdx_type:'慢说',role:'assistant' as const,start_at_ms:e.a,end_at_ms:Math.round(e.b)}]:[])]),emotion_annotation:[],paralinguistic_annotation:[],custom_annotation:[]};
 return separateLoading({END:grid(Math.max(...tracks.flatMap(t=>t.clips.map(c=>c.b)))),tracks,events,expressions,utterances,inputEvents:inputEvents.sort((a,b)=>a.time_at_ms-b.time_at_ms),controlAnnotations,playableClips:tracks.flatMap(t=>t.clips).filter(c=>c.audioKey)});
}
