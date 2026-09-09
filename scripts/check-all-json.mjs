import fs from 'node:fs';import assert from 'node:assert/strict';
import {loadCases,compile} from './load-cases.mjs';
const baseMeta=JSON.parse(fs.readFileSync('components/meta-data.json'));
const {reconcileCase,buildCaseData}=Function('baseMeta',compile('components/case-data.ts')+';return {reconcileCase,buildCaseData}')(baseMeta);
const names={weather:'北京天气 / 跑步提醒',actor:'演员名字 / 追问电视剧',ride:'回家路况 / 呼叫快车',coffee:'订咖啡 / 偏好与地址确认',sms:'手机欠费短信 / Living Edge 提醒',gmail:'新用户查 Gmail 邮件',interrupt:'播报中打断改口 / 高铁车次重查',retry:'路况服务超时 / 降级用历史记录',clarify:'指代不明 / 先澄清再发送',backchannel:'老板反复改周会 / 吐槽时附和',preempt:'订高铁票 / 查到无票主动打断'};
function schema(value,s,path){
 if(s.type==='object'){assert(value&&typeof value==='object'&&!Array.isArray(value),path);for(const k of s.required??[])assert(Object.hasOwn(value,k),`${path} missing ${k}`);for(const [k,v] of Object.entries(value))if(s.properties?.[k])schema(v,s.properties[k],`${path}.${k}`);}
 else if(s.type==='array'){assert(Array.isArray(value),path);for(const v of value)if(s.items)schema(v,s.items,path+'[]');}
 else if(s.type==='number'||s.type==='integer')assert(typeof value==='number'&&Number.isFinite(value)&&(s.type!=='integer'||Number.isInteger(value)),path);
 else if(s.type)assert.equal(typeof value,s.type,path);
}
for(const [id,raw] of Object.entries(loadCases())){
 const s=reconcileCase(id,raw);
 assert.deepEqual(s.tracks.map(t=>t.name),['用户','用户控制','助手','表达控制','世界','后台判断','工具调用']);
 const mergedTools=s.tracks.find(t=>t.name==='工具调用').clips;
 for(let i=0;i<mergedTools.length;i++)for(let j=i+1;j<mergedTools.length;j++){const a=mergedTools[i],b=mergedTools[j];if(a.lane===b.lane)assert(a.b<=b.a||b.b<=a.a,`${id} overlapping merged blocks`);}
 // Playback controls are required wherever the case emits non-speech output:
 // a loading region, or a device effect the assistant triggered.
 const emitsPlayback=s.playableClips.some(c=>c.loop)||s.inputEvents.some(e=>['audio.play','living_edge.light'].includes(e.tool_name));
 if(emitsPlayback)assert(mergedTools.some(c=>c.playbackControl),`${id} missing playback controls`);
 const {document:d}=buildCaseData({caseId:id,caseTitle:names[id],durationMs:s.END,events:s.inputEvents,utterances:s.utterances,controls:s.controlAnnotations,metaOverride:s.meta});
 assert.equal(d.meta_data.sample.case_id,id);assert.equal(d.meta_data.sample.case_name,names[id]);assert.equal(d.meta_data.media.audio.duration_ms,s.END);assert.equal(d.meta_data.media.audio.file,null);
 assert.deepEqual(d.meta_data.media.audio.tracks,[{track_ref:'Channel 1',role:'user'},{track_ref:'Channel 2',role:'assistant'}]);
 const tools=new Map(d.static_context.tools.map(t=>[t.function.name,t.function]));
 assert.equal(tools.size,d.static_context.tools.length);assert.deepEqual([...tools.keys()].sort(),[...new Set(d.events.flatMap(e=>e.tool_name?[e.tool_name]:[]))].sort());
 let last=-1;
 for(const e of d.events){assert(e.time_at_ms>=last&&e.time_at_ms<=s.END);last=e.time_at_ms;
  if(!e.tool_name){assert(['ui_event','payment_event','world_event'].includes(e.event_type));continue;}
  assert(tools.has(e.tool_name));
  if(e.query===undefined)continue;
  const params=JSON.parse(e.query);schema(params,tools.get(e.tool_name).parameters,`${id}/${e.event_id}`);
  const pair=d.events.filter(r=>r.event_id===e.event_id);assert.equal(pair.length,2);assert.equal(pair[1].tool_name,e.tool_name);assert(pair[1].time_at_ms>=e.time_at_ms);
  if(e.tool_name==='audio.play'){
   const clip=s.playableClips.find(c=>c.loop&&c.a===e.time_at_ms);assert(clip);
   const stops=d.events.filter(x=>x.tool_name==='audio.stop'&&x.query!==undefined&&JSON.parse(x.query).playback_event_id===e.event_id);assert.equal(stops.length,1);assert.equal(stops[0].time_at_ms,clip.b);assert(s.tracks.find(t=>t.name==='工具调用').clips.some(c=>c.label==='audio.stop()'&&c.a===clip.b&&c.b===clip.b+400));assert.equal(pair[1].time_at_ms,clip.b);assert.equal(params.duration_ms,Math.round(clip.b-clip.a));
   for(const voice of s.tracks.find(t=>t.name==='助手').clips)assert(clip.b<=voice.a-400||clip.a>=voice.b+400);
  }
 }
 for(const t of s.tracks.filter(t=>t.name==='用户'||t.name==='助手'))for(const c of t.clips){const u=d.utterances.find(u=>u.speaker===(t.name==='用户'?'user':'assistant')&&u.start_at_ms===Math.round(c.a));assert(u);assert.equal(u.end_at_ms,Math.round(c.b));assert.equal(u.text,c.label);assert(!('sample_seg_id' in u));}
 for(const a of d.fdx_annotation){assert.notEqual(a.fdx_type,'打断');const clip=s.tracks.find(t=>t.name==='表达控制').clips.find(c=>Math.round(c.a)===a.start_at_ms&&Math.round(c.b)===a.end_at_ms);assert(clip);assert(d.utterances.some(u=>u.speaker===a.role&&u.start_at_ms<=a.start_at_ms&&u.end_at_ms>=a.end_at_ms));}
 for(const c of s.tracks.find(t=>t.name==='工具调用').clips){if(c.playbackControl||c.label==='读取已有上午天气')continue;assert(d.events.some(e=>e.tool_name&&e.query!==undefined&&e.time_at_ms===c.a&&d.events.some(r=>r.event_id===e.event_id&&r.results&&r.time_at_ms===c.b)),`${id} unmapped tool block ${c.label}`);}
 if(id==='weather'){const query=JSON.parse(d.events.find(e=>e.tool_name==='reminder.update'&&e.query).query);assert.equal(query.id,d.events.find(e=>e.tool_name==='reminder.create'&&e.results).results.reminder_id);assert.equal(query.time,'09:00');}
 if(id==='ride'){const booking=d.events.find(e=>e.event_id==='ride_booking'&&e.results).results;assert.equal(booking.estimated_fare_cny,58);assert.deepEqual(JSON.parse(d.events.find(e=>e.event_id==='ride_card'&&e.query).query).order,booking);}
 if(id==='coffee'){assert(!tools.has('ride.book'));assert(!tools.has('weather.query'));const paid=d.events.find(e=>e.event_type==='payment_event');assert.equal(JSON.parse(d.events.find(e=>e.tool_name==='coffee.get_order_status'&&e.query).query).checkout_id,paid.context.checkout_id);}
 fs.mkdirSync('../Case Exports',{recursive:true});fs.writeFileSync(`../Case Exports/${id}.json`,JSON.stringify(d,null,2)+'\n');
 console.log(`${id}: PASS / ${s.END} ms / ${d.utterances.length} utterances / ${d.events.length} events / ${tools.size} tools / ${d.fdx_annotation.length} annotations`);
}
