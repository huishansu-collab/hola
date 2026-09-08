import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const stream=Function(compile('components/streaming-case.ts')+';return streamingCase')();
const audio=Object.assign({},...['actor','ride'].map(c=>JSON.parse(fs.readFileSync(`components/audio/${c}-clips.json`))));
const shared=compile('components/loading-spacing.ts')+compile('components/scenario-utils.ts');
for(const name of ['actor','ride']){
 const raw=Function('audioClips',shared+compile(`components/${name}-case.ts`)+`;return create${name==='actor'?'Actor':'Ride'}Case()`)(audio);
 const s=stream(raw);
 assert.deepEqual(s.tracks.slice(0,3).map(t=>t.name),['用户','用户控制','助手']);
 assert.equal(s.tracks.filter(t=>t.name==='用户控制').length,1);
 assert.equal(s.tracks.find(t=>t.name==='用户控制').clips.length,0);
 assert(!s.tracks.some(t=>['回复计划','回复修订'].includes(t.name)));
 assert(!s.tracks.flatMap(t=>t.clips).some(c=>/\[丢弃：/.test(c.label)));
 assert(s.events.every(e=>!e.plan&&!e.drop));
 assert.deepEqual(s.playableClips.map(c=>[c.audioKey,c.a,c.b]),raw.playableClips.map(c=>[c.audioKey,c.a,c.b]));
 assert.deepEqual(s.utterances,raw.utterances);assert.deepEqual(s.inputEvents,raw.inputEvents);
}
console.log('PASS: streaming tracks, no inferred discarded text, unchanged audible clips and JSON history');
