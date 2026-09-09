import type {Scenario} from '../app/page';
export type Breath={utterance_id:string;host_start_ms:number;windows:[number,number][]};
export type Nudge=Record<string,number>;
export type Unit={id:string;host:string;a:number;b:number;label:string;group:string[]};
const TAIL=800,LEAD=400,STEP=400;
const idOf=(key?:string)=>key?key.split('/').pop()!:'';
/** 附和：助手语音落在某段用户人声内部。分组是因为「嗐 + 是啊！」要一起挪。 */
export function backchannelUnits(s:Scenario):Unit[]{
 const users=s.tracks.find(t=>t.name==='用户')?.clips??[],assistant=s.tracks.find(t=>t.name==='助手')?.clips??[];
 const inside=assistant.filter(c=>users.some(u=>u.a<c.a&&c.b<u.b));
 return inside.map(c=>{
  const host=users.find(u=>u.a<c.a&&c.b<u.b)!;
  const group=inside.filter(x=>users.find(u=>u.a<x.a&&x.b<u.b)===host).map(x=>idOf(x.audioKey));
  return {id:idOf(c.audioKey),host:idOf(host.audioKey),a:c.a,b:c.b,label:c.label,group};
 });
}
/** 一组附和整体平移后的落点；返回 null 表示这个位置不合法。 */
export function resolve(s:Scenario,unit:Unit,startMs:number):{spans:[string,number,number][];tail:number}|null{
 const users=s.tracks.find(t=>t.name==='用户')?.clips??[],assistant=s.tracks.find(t=>t.name==='助手')?.clips??[];
 const host=users.find(u=>idOf(u.audioKey)===unit.host);
 if(!host)return null;
 const at=Math.round(startMs/STEP)*STEP;
 let cursor=at;const spans:[string,number,number][]=[];
 for(const id of unit.group){
  const clip=assistant.find(c=>idOf(c.audioKey)===id)!;
  cursor=Math.ceil(cursor/STEP)*STEP;
  spans.push([id,cursor,cursor+(clip.b-clip.a)]);
  cursor+=clip.b-clip.a;
 }
 const tail=host.b-spans[spans.length-1][2];
 if(spans[0][1]<=host.a+LEAD||tail<TAIL)return null;
 return {spans,tail};
}
/** 把平移应用到助手语音与对应的表达控制片段上，音频与标注一起跟着走。 */
export function applyNudge(s:Scenario,nudge:Nudge):Scenario{
 if(!Object.keys(nudge).length)return s;
 const shifted=new Map<number,number>();
 const tracks=s.tracks.map(t=>{
  if(t.name!=='助手')return t;
  return {...t,clips:t.clips.map(c=>{
   const d=nudge[idOf(c.audioKey)];
   if(!d)return c;
   shifted.set(Math.round(c.a),d);
   return {...c,a:c.a+d,b:c.b+d};
  })};
 }).map(t=>t.name!=='表达控制'?t:{...t,clips:t.clips.map(c=>{
  const d=shifted.get(Math.round(c.a));
  return d?{...c,a:c.a+d,b:c.b+d}:c;
 })});
 return {...s,tracks,playableClips:tracks.flatMap(t=>t.clips).filter(c=>c.audioKey),
  utterances:s.utterances.map(u=>{const d=nudge[u.id];return d?{...u,start_at_ms:u.start_at_ms+d,end_at_ms:u.end_at_ms+d}:u}),
  controlAnnotations:{...s.controlAnnotations,fdx_annotation:s.controlAnnotations.fdx_annotation.map(a=>{
   const d=shifted.get(a.start_at_ms);return d?{...a,start_at_ms:a.start_at_ms+d,end_at_ms:a.end_at_ms+d}:a;
  })}};
}
/** 导出给 local/retime_backchannel.py 使用的落点，单位是距宿主句起声的毫秒。 */
export function exportOffsets(s:Scenario,units:Unit[],nudge:Nudge){
 const users=s.tracks.find(t=>t.name==='用户')?.clips??[];
 const first=units.filter(u=>u.id===u.group[0]);
 return JSON.stringify(Object.fromEntries(first.map(u=>{
  const host=users.find(c=>idOf(c.audioKey)===u.host)!;
  return [u.host,Math.round(u.a+(nudge[u.id]??0)-host.a)];
 })),null,1);
}
