import fs from 'node:fs';import assert from 'node:assert/strict';
import {loadCases,compile} from './load-cases.mjs';
const baseMeta=JSON.parse(fs.readFileSync('components/meta-data.json'));
const {reconcileCase}=Function('baseMeta',compile('components/case-data.ts')+';return {reconcileCase}')(baseMeta);
const planned=['interrupt','retry','clarify','preempt'];
const added=[...planned,'backchannel'];
const all=loadCases();
const cases=Object.fromEntries(added.map(id=>{assert(all[id],`${id} not registered in scripts/load-cases.mjs`);return [id,reconcileCase(id,all[id])]}));
const track=(s,name)=>s.tracks.find(t=>t.name===name);
const clip=(s,name,label)=>track(s,name).clips.find(c=>c.label===label);
const query=(s,id)=>JSON.parse(s.inputEvents.find(e=>e.event_id===id&&e.query!==undefined).query);
const result=(s,id)=>s.inputEvents.find(e=>e.event_id===id&&e.results).results;
const calls=(s,tool)=>[...new Set(s.inputEvents.filter(e=>e.tool_name===tool).map(e=>e.event_id))];
// 应用实际能播的 key，来自 components/audio/use-timeline-audio.ts 的注册表
const registered=new Set(Object.keys(Function('data','actorData','rideData','coffeeData','smsData','gmailRuntime','backchannelRuntime',
 compile('components/audio/use-timeline-audio.ts').replace(/export function useTimelineAudio[\s\S]*$/,'')+';return audioClips')(
 ...['clips','actor-clips','ride-clips','coffee-clips','sms-clips'].map(n=>JSON.parse(fs.readFileSync(`components/audio/${n}.json`))),
 ...['gmail','backchannel'].map(id=>JSON.parse(fs.readFileSync(`case-packages/${id}/build/runtime.json`))))));

// Shared shape: design-time fixtures with no generated speech.
for(const [id,s] of Object.entries(cases)){
 const voiced=!planned.includes(id);
 assert.equal(s.timingStatus,voiced?'aligned':'planned',`${id} timing status`);
 assert.equal(s.playableClips.length===0,!voiced,`${id} audio clips must match its timing status`);
 assert.equal(s.meta.static_context.constraints.audio_status,voiced?'generated':'none',`${id} audio_status`);
 assert(s.events.length,`${id} needs at least one checkpoint`);
 for(const t of s.tracks){
  const clips=t.clips.toSorted((a,b)=>a.a-b.a);
  for(let i=0;i<clips.length;i++){
   const c=clips[i];
   assert(c.b>c.a,`${id}/${t.name} nonpositive interval: ${c.label}`);
   // 400ms 网格约束在用户侧不成立：已配音 Case 的用户人声起止由录音决定。
   // 设计稿（planned）里全部人工排布，所以连用户轨也一并要求对齐。
   if(!voiced||!['用户','用户控制','世界'].includes(t.name)){
    assert.equal(c.a%400,0,`${id}/${t.name} off-grid start: ${c.label}`);
    if(!voiced)assert.equal(c.b%400,0,`${id}/${t.name} off-grid end: ${c.label}`);
   }
   assert(c.b<=s.END,`${id}/${t.name} runs past END: ${c.label}`);
   // The tools track deliberately stacks concurrent work on separate lanes.
   for(let j=i+1;j<clips.length;j++)if((c.lane??0)===(clips[j].lane??0))assert(clips[j].a>=c.b,`${id}/${t.name} overlap: ${c.label} / ${clips[j].label}`);
  }
 }
 if(!['backchannel','preempt'].includes(id))assert(track(s,'工具调用').clips.some(c=>c.playbackControl),`${id} missing playback control block`);
 // Every utterance of a voiced case must actually carry audio.
 if(voiced)for(const t of [track(s,'用户'),track(s,'助手')])for(const c of t.clips){
  assert(c.audioKey&&c.wave,`${id}/${c.label} 已配音 Case 的语音片段必须有音频`);
  // 数据对、注册漏，播放循环会静默跳过；这条断言把注册表也一起管住。
  assert(registered.has(c.audioKey),`${id}/${c.label} 的 audioKey ${c.audioKey} 未注册到 use-timeline-audio 的 audioClips`);
 }
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

// backchannel: speaking over the user without taking the floor.
{
 const s=cases.backchannel;
 const users=track(s,'用户').clips,assistant=track(s,'助手').clips;
 const spoken=id=>s.utterances.find(u=>u.id===id);
 const backchannels=assistant.filter(c=>s.controlAnnotations.fdx_annotation.some(a=>a.start_at_ms===Math.round(c.a)));
 assert.equal(backchannels.length,4,'backchannel: four annotated backchannel units');
 for(const c of backchannels){
  // The defining property: it lands inside a user clip and the user keeps going.
  const over=users.find(u=>u.a<c.a&&u.b>c.b);
  assert(over,`backchannel: ${c.label} must sit strictly inside a user clip`);
  assert(over.b-c.b>=800,`backchannel: user must keep talking after ${c.label}`);
  assert(!assistant.some(o=>o!==c&&o.a<c.b&&o.b>c.a),`backchannel: ${c.label} overlaps another assistant clip`);
 }
 const [particle,agree,sympathy,echo]=backchannels;
 assert.equal(particle.label,'嗐','backchannel: the particle is its own unit');
 assert(agree.a>=particle.b&&agree.a-particle.b<=400,'backchannel: 嗐 and the agreement it heads stay adjacent');
 assert.equal(agree.label,'是啊！');
 assert.equal(sympathy.label,'那真是够呛');
 assert(echo.label.startsWith('唉'));
 const types=s.controlAnnotations.fdx_annotation.map(a=>a.fdx_type);
 // Particles carry only tone; sentences carry a judgement about the situation.
 assert.deepEqual(types,['附和词','附和词','附和句','附和句'],'backchannel: tone-only and content units are typed apart');
 // 纯语气的附和词必须比带内容的附和句短——这条与录制时长无关，是两类的分野。
 const words=[particle,agree],sentences=[sympathy,echo];
 assert(Math.max(...words.map(c=>c.b-c.a))<Math.min(...sentences.map(c=>c.b-c.a)),
  'backchannel: 附和词必须短于附和句');
 for(const c of backchannels)assert(c.b-c.a<=2000,`backchannel: ${c.label} 过长，已经不像附和`);
 assert(!types.includes('打断'),'backchannel: a backchannel is never annotated as an interruption');
 // Spacing: the user gets whole segments with no assistant voice at all.
 const silent=users.filter(u=>!assistant.some(c=>c.a<u.b&&c.b>u.a));
 assert(silent.length>=5,`backchannel: at least five user segments must go unanswered, got ${silent.length}`);
 // Spacing is the point: never two answered segments in a row.
 const answered=users.flatMap((u,i)=>assistant.some(c=>c.a<u.b&&c.b>u.a)?[i]:[]);
 for(let i=1;i<answered.length;i++)assert(answered[i]-answered[i-1]>=2,`backchannel: leave a whole user segment between backchannels (${answered.join(',')})`);
 const vented=users.slice(1);
 assert(!assistant.some(c=>c.a<vented[0].b&&c.b>vented[0].a),'backchannel: the first vented segment gets no backchannel');
 assert(!assistant.some(c=>c.a<vented[1].b&&c.b>vented[1].a),'backchannel: the second vented segment gets no backchannel either');
 // Venting is not an instruction.
 assert.equal(calls(s,'calendar.update').length,1,'backchannel: exactly one calendar write');
 const write=s.inputEvents.find(e=>e.event_id==='cal_1'&&e.query!==undefined);
 assert(write.time_at_ms<=users[0].b,'backchannel: the write follows the only instruction, not the venting');
 assert(!s.inputEvents.some(e=>e.time_at_ms>vented[0].a),'backchannel: no tool call at all once venting starts');
 assert.equal(query(s,'cal_1').to,'明天 17:00');
 assert.equal(result(s,'cal_1').start_at,query(s,'cal_1').to,'backchannel: the result must echo the requested time');
 assert.equal(result(s,'cal_1').calendar_event_id,query(s,'cal_1').calendar_event_id,'backchannel: same event, not a new one');
 // Closing: one line, and nothing the user did not ask for.
 const close=assistant.at(-1);
 assert.equal(close.label,'好，别太烦。','backchannel: the case ends on one short line');
 assert(close.a>users.at(-1).b,'backchannel: the close waits for the user to finish');
 assert(!/五点|改好|要不要|需要/.test(close.label),'backchannel: the close neither restates the change nor offers more');
 assert(spoken(s.utterances.find(u=>u.text===close.label).id).speaker==='assistant');
}

// preempt: the assistant takes the floor because the user's words are moot.
{
 const s=cases.preempt;
 const users=track(s,'用户').clips,assistant=track(s,'助手').clips;
 const cut=users[2],barge=assistant[0];
 assert(barge.a>cut.a&&barge.a<cut.b,'preempt: the assistant must start speaking inside the user clip');
 assert(barge.b>cut.b,'preempt: the user stops first — the floor changed hands');
 const point=s.events.find(e=>e.overlap);
 assert.equal(point.tag,'助手打断');
 assert.deepEqual(point.overlap,[barge.a,cut.b],'preempt: the overlap runs from assistant onset to user stop');
 const evidence=s.inputEvents.find(e=>e.event_id==='train_1'&&e.results);
 assert(evidence.time_at_ms<barge.a,'preempt: the reason must exist before the assistant cuts in');
 assert(barge.a-evidence.time_at_ms<=1200,'preempt: cut in promptly, do not let the user finish for nothing');
 assert.equal(result(s,'train_1').available,false,'preempt: the interruption is only justified by a dead end');
 assert(barge.label.startsWith('打断一下'),'preempt: name the interruption, then give the reason');
 assert(assistant[1].label.includes('六点三十八'),'preempt: an interruption must carry an alternative');
 assert.equal(JSON.parse(fs.readFileSync('components/cases/preempt/case.json')).fdx_annotation.length,0,'preempt: an interruption never enters fdx_annotation');
 const [mark]=s.controlAnnotations.custom_annotation;
 assert.equal(mark.start_at_ms,barge.a);assert.equal(mark.end_at_ms,cut.b,'preempt: the custom mark spans the overlap');
 assert(!/[，。]/.test(cut.label.slice(-1)),'preempt: the cut-off line is left unfinished, not completed');
 // The floor goes back, and only the finished preference carries over.
 assert(users[3].a>assistant[1].b,'preempt: the user answers after the assistant finishes');
 const held=query(s,'hold_1');
 assert.equal(held.seat_preference,'靠窗','preempt: a preference stated in full carries over');
 assert.equal(held.trip_no,result(s,'train_1').next_available.trip_no,'preempt: book the alternative that was offered');
 assert.equal(held.seats,result(s,'train_1').next_available.seats_left);
 assert(!/车厢/.test(JSON.stringify(s.inputEvents)),'preempt: nothing from the interrupted half-sentence may reach a tool');
 assert.equal(result(s,'hold_1').paid,false,'preempt: holding is not paying');
 const card=s.inputEvents.find(e=>e.event_id==='card_1'&&e.query!==undefined);
 assert.equal(JSON.parse(card.query).hold_id,result(s,'hold_1').hold_id);
 assert(card.time_at_ms>s.inputEvents.find(e=>e.event_id==='hold_1'&&e.results).time_at_ms,'preempt: the card follows the hold');
 assert(assistant[2].a>s.inputEvents.find(e=>e.event_id==='card_1'&&e.results).time_at_ms,'preempt: report only after the card is up');
 assert(!/已购|已支付|出票/.test(assistant.map(c=>c.label).join('')),'preempt: never claim the ticket is bought');
}

for(const [id,s] of Object.entries(cases))console.log(`${id}: PASS / ${s.END} ms / ${s.utterances.length} utterances / ${s.inputEvents.length} events / ${planned.includes(id)?'planned timing, no generated audio':'aligned to real audio'}`);
