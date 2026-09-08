import type {Clip,Scenario} from '../app/page';
import type {InputEvent} from './json-overlay';
// Reserve one decision unit on both sides of every assistant utterance.
export function separateLoading(s:Scenario):Scenario {
 const speech=s.tracks.filter(t=>t.name==='助手').flatMap(t=>t.clips).filter(c=>c.wave||c.audioKey).sort((a,b)=>a.a-b.a);
 let inputEvents=[...s.inputEvents];
 const tracks=s.tracks.map(t=>({...t,clips:t.clips.flatMap(c=>{
  if(!c.loop||c.label!=='audio.play()')return [c];
  let windows:[[number,number]]|[number,number][]=[[c.a,c.b]];
  for(const voice of speech){const left=voice.a-400,right=voice.b+400;windows=windows.flatMap(([a,b])=>b<=left||a>=right?[[a,b]] as [number,number][]:([[a,Math.min(b,left)],[Math.max(a,right),b]] as [number,number][]).filter(([x,y])=>y>x));}
  windows=windows.map(([a,b])=>[Math.ceil(a/400)*400,b] as [number,number]).filter(([a,b])=>b-a>=400);
  if(windows.length===1&&windows[0][0]===c.a&&windows[0][1]===c.b)return [c];
  const original=inputEvents.find(e=>e.tool_name==='audio.play'&&e.query!==undefined&&e.time_at_ms===c.a);
  if(original)inputEvents=inputEvents.filter(e=>e.event_id!==original.event_id);
  return windows.map(([a,b],i)=>{
   const sample=(time:number)=>{const points=c.gainPoints??[[c.a,.35],[c.b,.35]];for(let j=1;j<points.length;j++){const [t,v]=points[j],[p,pv]=points[j-1];if(time<=t)return pv+(v-pv)*Math.max(0,(time-p)/(t-p));}return points.at(-1)![1];};
   const points=new Set([a,a+120,b-180,b,...(c.gainPoints??[]).map(p=>p[0]).filter(t=>t>a&&t<b)]);
   const gainPoints:[number,number][]=Array.from(points).sort((x,y)=>x-y).map(t=>[t,sample(t)*Math.max(0,Math.min(1,(t-a)/120,(b-t)/180))]);
   if(original){const event_id=windows.length===1?original.event_id:`${original.event_id}_${i+1}`;inputEvents.push({event_id,event_type:'function_call',tool_name:'audio.play',time_at_ms:a,query:`播放等待音效 ${(b-a).toFixed(0)} 毫秒；与助手人声前后至少间隔400毫秒`},{event_id,event_type:'function_call',tool_name:'audio.play',time_at_ms:b,results:{status:'completed',duration_ms:Math.round(b-a),gain_points:gainPoints}});}
   return {...c,a,b,gainPoints,sub:`Loading · ${(b-a)/1000} 秒 · 与助手人声间隔至少 400 毫秒`} satisfies Clip;
  });
 }).sort((a,b)=>a.a-b.a)}));
 return {...s,tracks,inputEvents:inputEvents.sort((a,b)=>a.time_at_ms-b.time_at_ms),playableClips:tracks.flatMap(t=>t.clips).filter(c=>c.audioKey)};
}
