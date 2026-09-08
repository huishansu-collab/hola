import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const audio=Object.assign({},...['actor','ride'].map(c=>JSON.parse(fs.readFileSync(`components/audio/${c}-clips.json`))));
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const spacing=ts.transpileModule(fs.readFileSync('components/loading-spacing.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const helper=compile('components/scenario-utils.ts');
for(const name of ['ride']){
 const s=Function('audioClips',spacing+helper+compile(`components/${name}-case.ts`)+`;return createRideCase()`)(audio);
 for(const t of s.tracks){const clips=t.clips.toSorted((a,b)=>a.a-b.a);for(let i=0;i<clips.length;i++){const c=clips[i];assert(c.b>c.a,`${name}/${t.name} nonpositive ${c.label}`);if(t.name!=='用户')assert.equal(c.a%400,0,`${name}/${t.name} off-grid ${c.label}`);for(let j=i+1;j<clips.length;j++)assert(clips[j].a>=c.b,`${name}/${t.name} overlap: ${c.label} / ${clips[j].label}`);if(c.audioKey&&!c.loop)assert(Math.abs(c.b-c.a-audio[c.audioKey].duration*1000)<1)}}
 const u=s.tracks[0].clips,a=s.tracks[1].clips;
 for(const event of s.events.filter(e=>e.overlap)){assert(event.overlap[1]>event.overlap[0]);assert.equal(event.t,event.overlap[0]);assert(grid(event.t)<event.overlap[1]);}
 assert(a[0].a>=u[0].b+400);
 const pairs=id=>s.inputEvents.filter(e=>e.event_id===id);
 const duration=id=>pairs(id)[1].time_at_ms-pairs(id)[0].time_at_ms;
 {
  assert.equal(duration('ride_route'),8000);assert.equal(duration('ride_booking'),10000);assert(a[3].a>=u[1].b+400);assert(pairs('ride_booking')[0].time_at_ms>=a[3].b);assert(a.at(-1).a>=pairs('ride_booking')[1].time_at_ms+400);assert.equal(s.playableClips.filter(c=>c.loop).length,2);assert(pairs('ride_loading_booking')[1].time_at_ms<=pairs('ride_booking')[1].time_at_ms);for(const load of s.playableClips.filter(c=>c.loop))for(const voice of a)assert(load.b<=voice.a-400||load.a>=voice.b+400);
 }
 assert.equal(s.utterances.length,u.length+a.length);
 assert(!s.controlAnnotations.fdx_annotation.some(x=>x.fdx_type==='打断'));
 console.log(name,'PASS',s.END,'ms',s.tracks.length,'tracks',s.utterances.length,'utterances');
 fs.writeFileSync(`/tmp/${name}-timeline.json`,JSON.stringify(s,(k,v)=>k==='src'?undefined:v,2));
}
function grid(t){return Math.ceil(t/400)*400}
