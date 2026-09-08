import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const audio=JSON.parse(fs.readFileSync('components/audio/actor-clips.json'));
const source=fs.readFileSync('components/actor-case.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const spacing=ts.transpileModule(fs.readFileSync('components/loading-spacing.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const s=Function('audioClips',spacing+code+';return createActorCase()')(audio);
for(const t of s.tracks){const sorted=t.clips.toSorted((a,b)=>a.a-b.a);for(let i=0;i<sorted.length;i++){const c=sorted[i];assert(c.b>c.a,`${t.name}: empty ${c.label}`);if(t.name!=='用户')assert.equal(c.a%400,0);for(let j=i+1;j<sorted.length;j++)assert(sorted[j].a>=c.b,`${t.name}: overlaps`);if(c.audioKey&&!c.loop)assert(Math.abs(c.b-c.a-audio[c.audioKey].duration*1000)<1)}}
const u=s.tracks[0].clips,voices=s.tracks[1].clips,intro=voices[0],a=voices.slice(1);
for(let i=0;i<2;i++){assert(s.events[i].overlap[1]>s.events[i].overlap[0]);assert.equal(s.events[i].overlap[0],u[i===0?1:3].a)}
assert(a[0].a>=u[0].b+400);assert(a[1].a>=u[1].b+400);assert(a[2].a>=u[2].b+400);
const lookup=s.inputEvents.filter(e=>e.event_id==='demo_actor_lookup'),search=s.inputEvents.filter(e=>e.event_id==='demo_actor_search_A');
assert.equal(search[1].time_at_ms-search[0].time_at_ms,8000);assert(a[3].a>=search[1].time_at_ms+400);assert.equal(lookup[1].time_at_ms-lookup[0].time_at_ms,3000);
assert.equal(s.utterances.length,9);assert(!s.controlAnnotations.fdx_annotation.some(x=>x.fdx_type==='打断'));
console.log('Actor Case passed: 8 aligned tracks, original-speed audio, two interruptions, 8s search, JSON and no closing reply.');
console.log(JSON.stringify({END:s.END,utterances:s.utterances,events:s.inputEvents},null,2));

for(const load of s.playableClips.filter(c=>c.loop))for(const voice of voices)assert(load.b<=voice.a-400||load.a>=voice.b+400);
