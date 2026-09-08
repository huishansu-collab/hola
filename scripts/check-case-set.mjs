import fs from 'node:fs';import assert from 'node:assert/strict';
import {loadCases,compile} from './load-cases.mjs';
const baseMeta=JSON.parse(fs.readFileSync('components/meta-data.json'));
const {reconcileCase}=Function('baseMeta',compile('components/case-data.ts')+';return {reconcileCase}')(baseMeta);
const added=['interrupt','retry','clarify'];
const all=loadCases();
const cases=Object.fromEntries(added.map(id=>{assert(all[id],`${id} not registered in scripts/load-cases.mjs`);return [id,reconcileCase(id,all[id])]}));
const track=(s,name)=>s.tracks.find(t=>t.name===name);
const clip=(s,name,label)=>track(s,name).clips.find(c=>c.label===label);
const query=(s,id)=>JSON.parse(s.inputEvents.find(e=>e.event_id===id&&e.query!==undefined).query);
const result=(s,id)=>s.inputEvents.find(e=>e.event_id===id&&e.results).results;
const calls=(s,tool)=>[...new Set(s.inputEvents.filter(e=>e.tool_name===tool).map(e=>e.event_id))];

// Shared shape: design-time fixtures with no generated speech.
for(const [id,s] of Object.entries(cases)){
 assert.equal(s.timingStatus,'planned',`${id} must be marked planned until speech is generated`);
 assert.equal(s.playableClips.length,0,`${id} claims audio but no clips were generated`);
 assert.equal(s.meta.static_context.constraints.audio_status,'none',`${id} audio_status must stay none`);
 assert(s.events.length,`${id} needs at least one checkpoint`);
 for(const t of s.tracks){
  const clips=t.clips.toSorted((a,b)=>a.a-b.a);
  for(let i=0;i<clips.length;i++){
   const c=clips[i];
   assert(c.b>c.a,`${id}/${t.name} nonpositive interval: ${c.label}`);
   assert.equal(c.a%400,0,`${id}/${t.name} off-grid start: ${c.label}`);
   assert.equal(c.b%400,0,`${id}/${t.name} off-grid end: ${c.label}`);
   assert(c.b<=s.END,`${id}/${t.name} runs past END: ${c.label}`);
   // The tools track deliberately stacks concurrent work on separate lanes.
   for(let j=i+1;j<clips.length;j++)if((c.lane??0)===(clips[j].lane??0))assert(clips[j].a>=c.b,`${id}/${t.name} overlap: ${c.label} / ${clips[j].label}`);
  }
 }
 assert(track(s,'工具调用').clips.some(c=>c.playbackControl),`${id} missing playback control block`);
 for(const e of s.inputEvents)assert(!/实时|已下单|已支付/.test(JSON.stringify(e.results??{})),`${id} result claims more than the case delivers`);
}

// interrupt: barge-in stops playout; the rewrite is a separate decision.
{
 const s=cases.interrupt;
 const [,second]=track(s,'用户').clips,[cut,final]=track(s,'助手').clips;
 assert(second.a>cut.a&&second.a<cut.b,'interrupt: user must start speaking inside the assistant clip');
 const point=s.events.find(e=>e.overlap);
 assert.deepEqual(point.overlap,[second.a,cut.b],'interrupt: the checkpoint must span from the user onset to the actual stop');
 assert.equal(point.tag,'用户打断');
 const stop=s.inputEvents.filter(e=>e.event_id==='stop_1');
 assert(stop[0].time_at_ms>=second.a,'interrupt: the stop is decided after the user starts speaking');
 assert(stop[0].time_at_ms<cut.b,'interrupt: the stop must be issued before playout ends');
 assert.equal(stop[1].time_at_ms,cut.b,'interrupt: playout ends when the stop returns');
 assert.equal(result(s,'stop_1').queue_telemetry,null,'interrupt: no queue telemetry may be invented');
 assert(!/\[丢弃：/.test(JSON.stringify(s.tracks)),'interrupt: discarded text must not be inferred');
 const before=query(s,'train_1'),after=query(s,'train_2');
 assert.equal(before.date,'明天');assert.equal(after.date,'后天');
 assert.equal(before.seat_class,undefined,'interrupt: the first turn had no seat class');
 assert.equal(after.seat_class,'二等座','interrupt: the rewrite must carry both corrections');
 assert.equal(after.origin,before.origin);assert.equal(after.destination,before.destination);
 assert.equal(result(s,'train_1').date,before.date,'interrupt: the first result must echo the date it was asked for');
 assert.equal(result(s,'train_2').date,after.date,'interrupt: the rewritten result must echo the corrected date');
 assert.equal(result(s,'train_2').seat_class,after.seat_class);
 const trips=result(s,'train_2').trips.map(t=>t.trip_no);
 assert(trips.includes(query(s,'stock_1').trip_no),'interrupt: stock check must use a trip from the rewritten search');
 assert.equal(query(s,'stock_1').date,after.date);assert.equal(query(s,'stock_1').seat_class,after.seat_class);
 assert(s.inputEvents.find(e=>e.event_id==='stock_1'&&e.results).time_at_ms<=final.a,'interrupt: playout waits for the stock check');
 assert(final.label.includes('后天')&&final.label.includes('二等座'),'interrupt: the final playout must state the corrected request');
 const [fdx]=s.controlAnnotations.fdx_annotation;
 const filler=clip(s,'表达控制','垫句 · 承接改口');
 assert.equal(fdx.start_at_ms,filler.a);assert.equal(fdx.end_at_ms,filler.b,'interrupt: reconcile must close the fdx interval on the expression clip');
 assert(fdx.start_at_ms>=final.a&&fdx.end_at_ms<=final.b,'interrupt: the filler must sit inside the assistant utterance');
}

// retry: a timeout is an error, not an answer.
{
 const s=cases.retry;
 const attempts=calls(s,'traffic.query');
 assert.equal(attempts.length,2,'retry: exactly one retry, no more');
 const [a1,a2]=attempts.map(id=>result(s,id));
 assert.equal(a1.status,'error');assert.equal(a1.retryable,true);
 assert.equal(a2.status,'error');assert.equal(a2.retryable,false,'retry: a non-retryable error must end the loop');
 assert.equal(a2.attempt,2);
 assert(!s.inputEvents.some(e=>e.tool_name==='traffic.query'&&e.results?.status==='ok'),'retry: no attempt may succeed');
 const failed=s.inputEvents.find(e=>e.event_type==='world_event');
 assert.equal(failed.context.related_event_id,attempts[0],'retry: the world signal must point at the first attempt');
 const memory=s.inputEvents.find(e=>e.event_id==='memory_1'&&e.query!==undefined);
 assert(memory.time_at_ms>s.inputEvents.find(e=>e.event_id===attempts[1]&&e.results).time_at_ms,'retry: fall back only after retrying');
 assert.equal(result(s,'memory_1').source,'history');
 const [, answer]=track(s,'助手').clips;
 assert(answer.a>memory.time_at_ms,'retry: the answer waits for the fallback lookup');
 assert(answer.label.includes('超时')&&answer.label.includes('记录'),'retry: the playout must name the failure and the data source');
 assert(clip(s,'工具调用','降级播报 · 标注数据来源'),'retry: the degraded playout must be marked on the playback track');
 assert.equal(result(s,'memory_1').typical_minutes,38);
 assert(answer.label.includes('三十八分钟'),'retry: the spoken estimate must match the stored record');
}

// clarify: two ambiguous references, resolved by asking rather than guessing.
{
 const s=cases.clarify;
 const [ask,confirm]=track(s,'用户').clips,[question,report]=track(s,'助手').clips;
 assert.equal(calls(s,'message.send').length,1,'clarify: exactly one send');
 const send=s.inputEvents.find(e=>e.event_id==='send_1'&&e.query!==undefined);
 assert(send.time_at_ms>confirm.b,'clarify: nothing is sent before the user resolves both references');
 const files=result(s,'files_1').files,contacts=result(s,'contacts_1').contacts;
 assert(files.length>1&&contacts.length>1,'clarify: the case needs genuinely ambiguous candidates');
 const chosen=query(s,'send_1');
 assert(files.some(f=>f.id===chosen.file_id),'clarify: the sent file must come from the candidate list');
 assert(contacts.some(c=>c.id===chosen.contact_id),'clarify: the recipient must come from the candidate list');
 assert.equal(chosen.note,undefined,'clarify: no note may be invented');
 const sent=result(s,'send_1');
 assert.equal(sent.status,'sent');
 assert.equal(sent.contact_id,chosen.contact_id,'clarify: the send result must echo the requested recipient');
 assert.equal(sent.file_id,chosen.file_id,'clarify: the send result must echo the requested file');
 assert(report.label.includes(contacts.find(c=>c.id===sent.contact_id).name),'clarify: the report must name the actual recipient');
 for(const id of ['files_1','contacts_1'])assert(s.inputEvents.find(e=>e.event_id===id&&e.results).time_at_ms<question.a,'clarify: candidates are fetched before the question');
 assert.equal(track(s,'助手').clips.filter(c=>c.label.includes('？')).length,1,'clarify: both gaps are closed in one turn');
 for(const c of contacts)assert(question.label.includes(c.name),`clarify: the question must name candidate ${c.name}`);
 assert(question.a>ask.b);
 assert(report.a>s.inputEvents.find(e=>e.event_id==='send_1'&&e.results).time_at_ms,'clarify: report only after the send returns');
 assert(!report.label.includes('？'),'clarify: the closing turn is a result, not another question');
}

for(const [id,s] of Object.entries(cases))console.log(`${id}: PASS / ${s.END} ms / ${s.utterances.length} utterances / ${s.inputEvents.length} events / planned timing, no generated audio`);
