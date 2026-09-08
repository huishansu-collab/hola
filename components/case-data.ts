import baseMeta from './meta-data.json';
import type {Scenario} from '../app/page';
type ObjectData=Record<string,unknown>;
const object=(value:unknown):ObjectData=>value&&typeof value==='object'&&!Array.isArray(value)?value as ObjectData:{};
export function reconcileCase(id:string,s:Scenario):Scenario {
 const result=(eventId:string)=>s.inputEvents.find(e=>e.event_id===eventId&&e.results)?.results??{};
 const args:Record<string,ObjectData>=id==='weather'?{
  demo_weather_001:{district:'北京',date:'明天'},demo_reminder_001:{date:'明天',time:'08:00',text:'跑步'},demo_reminder_002:{id:result('demo_reminder_001').reminder_id,date:'明天',time:'09:00',text:'跑步'}
 }:id==='ride'?{
  ride_home:{key:'home'},ride_gps:{},ride_saved:{},ride_match:{gps:result('ride_gps'),saved_positions:(result('ride_saved').positions as string[]).map(label=>({label}))},ride_route:{origin:result('ride_gps').position_ref,destination:result('ride_home').address,mode:'driving'},ride_booking:{type:'快车',pickup:result('ride_match').confirmed_pickup,destination:result('ride_home').address},ride_card:{order:result('ride_booking')}
 }:{};
 const inputEvents=s.inputEvents.map(e=>{
  if(e.query===undefined||!e.tool_name)return e;
  let query=args[e.event_id];
  if(e.tool_name==='web_search')query={query:e.query};
  if(e.tool_name==='audio.play'){
   const clip=s.playableClips.find(c=>c.loop&&c.a===e.time_at_ms);
   if(!clip)throw new Error(`Missing audio region: ${id}/${e.event_id}`);
   query={sound:'loading',duration_ms:Math.round(clip.b-clip.a)};
  }
  return query?{...e,query:JSON.stringify(query)}:e;
 });
 // Expressions, not ordinary acknowledgements, define the annotation intervals.
 const controls={...s.controlAnnotations,fdx_annotation:s.controlAnnotations.fdx_annotation.flatMap(a=>{
  const clip=s.tracks.find(t=>t.name==='表达控制')?.clips.find(c=>Math.round(c.a)===a.start_at_ms);
  return clip?[{...a,end_at_ms:Math.round(clip.b)}]:[];
 })};
 return {...s,inputEvents,controlAnnotations:controls};
}
export function buildCaseData({caseId,caseTitle,durationMs,events,utterances,controls,metaOverride}:{caseId:string;caseTitle:string;durationMs:number;events:Scenario['inputEvents'];utterances:Scenario['utterances'];controls:Scenario['controlAnnotations'];metaOverride?:ObjectData}){
 const base=metaOverride??baseMeta,staticContext=object(base.static_context),metaData=object(base.meta_data),sample=object(metaData.sample),media=object(metaData.media),audio=object(media.audio);
 const registry=(staticContext.tools??baseMeta.static_context.tools) as typeof baseMeta.static_context.tools;
 const names=[...new Set(events.flatMap(e=>e.tool_name?[e.tool_name]:[]))];
 const tools=names.map(name=>{
  const tool=registry.find(t=>t.function.name===name)??baseMeta.static_context.tools.find(t=>t.function.name===name);
  if(!tool)throw new Error(`Missing tool definition: ${caseId}/${name}`);
  return tool;
 });
 const meta={...base,static_context:{...staticContext,tools,constraints:{...object(staticContext.constraints),simulated:true}},meta_data:{...metaData,sample:{...sample,case_id:caseId,case_name:caseTitle,source_type:'simulated_case'},media:{...media,audio:{...audio,duration_ms:durationMs,file:null,tracks:[{track_ref:'Channel 1',role:'user'},{track_ref:'Channel 2',role:'assistant'}]}}}};
 return {meta,document:{...meta,utterances,events,...controls}};
}
