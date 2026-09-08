import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const s=fs.readFileSync('app/page.tsx','utf8');
const code=ts.transpileModule(s.slice(s.indexOf('let END='),s.indexOf('function Wave(')),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText.replace(/export \{\};?/g,'');
const audio=JSON.parse(fs.readFileSync('components/audio/clips.json','utf8'));
const {tracks,events,expressions,END}=Function('audioClips',code+';return {tracks,events,expressions,END}')(audio);
for(const t of tracks)for(const c of t.clips){assert(c.b>c.a,`${t.name}: empty region ${c.label}`);assert(c.a>=0&&c.b<=END);if(t.name!=='用户')assert.equal(c.a%400,0,`${t.name}: off-grid ${c.label}`);if(c.audioKey&&!c.fadeMs)assert(Math.abs(c.b-c.a-audio[c.audioKey].duration*1000)<.01,'stretched audio');}
const users=['u0','u1','u1','u3','u4','u5'].map(key=>tracks[0].clips.find(c=>c.audioKey===key)),assistant=tracks[1].clips.filter(c=>c.audioKey&&c.audioKey!=='a7');
[1,2,5,8,11,13,17].forEach((i,j)=>{assert.equal(expressions[i].a,assistant[j].a);assert.equal(i===2?expressions[3].b:i===8?Math.min(expressions[9].b,assistant[j].b):expressions[i].b,assistant[j].b);});
for(const [ai,ui] of [[0,0],[2,2],[4,3],[5,4],[6,5]])assert(assistant[ai].a-users[ui].b>=400,'assistant speaks too early');
assert(users[4].a>=assistant[4].b,'reminder interrupts morning response');
assert(users[5].a-assistant[5].b>=600,'revision too close');
for(const [i,ai,ui] of [[0,1,1],[1,3,3]])assert.deepEqual(events[i].overlap,[users[ui].a,assistant[ai].b]);
const tools=tracks.find(t=>t.name==='工具调用').clips;assert.equal(tools[0].b-tools[0].a,8000);assert(tools[2].a<events[2].t&&tools[2].b>=users[5].b);const decision=tracks.find(t=>t.name==='后台判断').clips.find(c=>c.label.startsWith('确认新目标：'));assert(decision.a-users[5].b>=400);assert.equal(tools[3].a,decision.b);assert(decision.a>=tools[2].b);assert(assistant[6].a>=tools[3].b);
console.log('PASS: 8 tracks; positive intervals; 400ms starts; original-speed audio; speech/control alignment; response gaps; overlap windows; 8s weather request; reminder revision sequencing.');

const plans=tracks.find(t=>t.name==='回复计划').clips.slice().sort((a,b)=>a.a-b.a);
for(let i=1;i<plans.length;i++)assert(plans[i].a>=plans[i-1].b,`Overlapping response plans: ${plans[i-1].label} / ${plans[i].label}`);

// Check every pair, not just adjacent regions: a long region may hide several others.
for(const track of tracks){
 const sorted=track.clips.slice().sort((a,b)=>a.a-b.a);
 for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++){
  assert(sorted[j].a>=sorted[i].b||sorted[j].b<=sorted[i].a,`Same-track overlap: ${track.name}: ${sorted[i].label} / ${sorted[j].label}`);
 }
}
console.log('PASS: all region pairs across all 8 tracks have no within-track overlap.');

assert.equal(tracks.length,8);
assert(tracks.find(t=>t.name==='回复计划').clips.every(c=>!c.muted));
assert.equal(tracks.find(t=>t.name==='回复修订').clips.length,3);
