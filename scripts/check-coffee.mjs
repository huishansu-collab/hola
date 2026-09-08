import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const data=JSON.parse(fs.readFileSync('components/cases/coffee/case.json'));
const timeline=JSON.parse(fs.readFileSync('components/cases/coffee/timeline.json'));
const src=fs.readFileSync('components/coffee-case.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function');
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const spacing=ts.transpileModule(fs.readFileSync('components/loading-spacing.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const s=Function('data','timeline',spacing+js+';return createCoffeeCase()')(data,timeline);
assert.equal(s.END,36400);
assert.deepEqual(s.utterances,data.utterances);
assert.deepEqual(s.inputEvents,data.events);
assert.equal(s.utterances.length,8);
assert(!s.utterances.some(u=>u.text.includes('点击')));
for(const t of s.tracks){
 const lanes=new Map();
 for(const c of t.clips){assert(c.b>c.a);if(t.name!=='用户')assert.equal(c.a%400,0);const lane=c.lane??0;lanes.set(lane,[...(lanes.get(lane)??[]),c]);}
 for(const clips of lanes.values()){clips.sort((a,b)=>a.a-b.a);for(let i=1;i<clips.length;i++)assert(clips[i].a>=clips[i-1].b,`${t.name}: overlap`);}
}
const pair=id=>s.inputEvents.filter(e=>e.event_id===id);
assert.equal(pair('memory_1')[0].time_at_ms,pair('gps_1')[0].time_at_ms);
assert(pair('saved_1')[0].time_at_ms>=pair('gps_1')[1].time_at_ms);
assert(pair('location_1')[0].time_at_ms>=pair('saved_1')[1].time_at_ms);
assert.equal(pair('location_1')[0].tool_name,'position.match');
const hum=s.utterances.find(u=>u.text==='嗯……');
assert.equal(hum.end_at_ms-hum.start_at_ms,1150);
assert.equal(s.controlAnnotations.fdx_annotation[0].end_at_ms,hum.end_at_ms);
assert.equal(s.tracks.find(t=>t.name==='用户控制').clips.length,1);
assert(s.tracks.find(t=>t.name==='用户').clips.every(c=>c.wave&&c.audioKey));
assert.equal(pair('checkout_1')[0].event_type,'ui_event');
assert(pair('quote_1')[0].time_at_ms>=s.utterances.find(u=>u.id==='u004').end_at_ms+400);
assert(pair('status_1')[0].time_at_ms>=pair('paid_1')[0].time_at_ms+400);
assert(s.utterances.at(-1).start_at_ms>=pair('status_1')[1].time_at_ms+400);
const registry=s.meta.static_context.tools.map(t=>t.function.name).sort();
assert.deepEqual(registry,[...new Set(s.inputEvents.flatMap(e=>e.tool_name?[e.tool_name]:[]))].sort());
assert(!registry.some(name=>/pay|book/.test(name)));
assert(!s.controlAnnotations.fdx_annotation.some(a=>a.fdx_type==='打断'));
assert.equal(s.playableClips.length,9);
assert.deepEqual(s.playableClips.find(c=>c.loop).gainPoints.at(-1),[16400,0]);
assert.equal(s.meta.meta_data.media.audio.duration_ms,s.END);
console.log('coffee PASS: export, parallel lanes, confirmation, user payment and order dependencies');

assert.deepEqual(s.tracks.slice(0,3).map(t=>t.name),['用户','用户控制','助手']);

for(const clip of timeline.tracks.find(t=>t.id==='control').clips){assert.equal(data.events.find(e=>e.event_id===clip.event_ref).context.source,'user');}

assert.equal(timeline.tracks.find(t=>t.id==='control').clips[0].event_ref,'click_1');
assert(!data.events.some(e=>e.event_id==='confirm_payment_1'));

const audio=JSON.parse(fs.readFileSync('components/audio/coffee-clips.json'));
for(const clip of s.playableClips.filter(c=>!c.loop)){assert(Math.abs(clip.b-clip.a-audio[clip.audioKey].duration*1000)<1);assert(audio[clip.audioKey].peaks.some(p=>p>0));}

const ack=s.utterances.find(u=>u.text==='好的，这就定。');
assert(ack.start_at_ms>=s.utterances.find(u=>u.id==='u004').end_at_ms+400);
const loading=s.playableClips.find(c=>c.loop);
assert(loading.a>=ack.end_at_ms+400);
for(const voice of s.tracks.find(t=>t.name==='助手').clips)assert(loading.b<=voice.a-400||loading.a>=voice.b+400,'Loading must not overlap assistant speech');
