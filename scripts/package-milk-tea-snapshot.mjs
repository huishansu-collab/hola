import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {buildRuntime} from '../lib/case-package/index.ts';
import {snapshotFiles,sourceFiles,writeZip,readZip,snapshotFromFiles,jsonBytes} from '../lib/case-package/archive.ts';
import {packageToScenario} from '../components/package-scenario.ts';
const root=path.resolve('../Case Drafts/培训中低声点奶茶/revisions/v7');
const id='01a0856a-a172-76f2-b4c1-8b59d330d94f';
const pack=JSON.parse(fs.readFileSync(path.join(root,'build',id+'.case.json')));
const runtime=buildRuntime(pack),scenario=packageToScenario(runtime,'portable');
const audio=Object.fromEntries(Object.entries(runtime.audio).map(([key,value])=>['portable/'+key,value]));
const clips=scenario.tracks.find(t=>t.name==='工具调用').clips;
const argumentNames={
  'location.current':[],
  'memory.get':['strUserFrequentAddressesKey'],
  'location.match':['objCurrentLocation','arrUserFrequentAddresses'],
  'delivery.quote':['strMilkTeaProductName','strCompanyAddressId'],
  'delivery.create_order':['strMilkTeaQuoteId','strVoiceConfirmationEventId'],
  'tools.check_order_status':['strMilkTeaOrderId'],
};
const variableBindings=[];
const toolRefs=runtime.timeline.tracks.find(t=>t.id==='tools').clips;
for(let i=0;i<clips.length;i++){
 const event=pack.case.events.find(e=>e.event_id===toolRefs[i].event_id&&e.event_type==='tool_call');
 const args=JSON.parse(event.query);
 let names=argumentNames[event.tool_name];
 if(event.tool_name==='ui.show_card'){
  const subject=args.card_type==='payment_confirmation'?'Payment':args.card_type==='order_result'?'OrderResult':'OrderConfirmation';
  names=['str'+subject+'CardId','str'+subject+'CardType','str'+subject+'CardTitle','strSourceEventId','obj'+subject+'CardContent'];
 }
 assert(names&&names.length===Object.keys(args).length);
 names=names.map(name=>name.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase().replace(/^(str|obj|arr)_/,''));
 clips[i].label=event.tool_name+'('+names.join(', ')+')';
 variableBindings.push({event_id:event.event_id,tool_name:event.tool_name,parameters:Object.entries(args).map(([parameter,value],j)=>({parameter,variable:names[j],value}))});
 assert(names.every(n=>/^[a-z][a-z0-9_]*$/.test(n)));
}
assert(clips.some(c=>c.label==='memory.get(user_frequent_addresses_key)'));
assert(clips.some(c=>c.label==='location.match(current_location, user_frequent_addresses)'));
const get=(id,type)=>pack.case.events.find(e=>e.event_id===id&&e.event_type===type);
assert(get('memory','tool_result').time_at_ms<get('match','tool_call').time_at_ms);
assert.deepEqual(JSON.parse(get('match','tool_call').query).list,get('memory','tool_result').results.value);
const files=snapshotFiles({format:'interaction-case-snapshot/1',id,title:pack.manifest.title,scenario,audio});
Object.assign(files,sourceFiles(pack));
files["notes/cross-track-dependencies.json"]=new Uint8Array(fs.readFileSync(path.join(root,"generation/cross-track-dependencies.json")));
files["notes/tool-variable-bindings.json"]=jsonBytes(variableBindings);
const code=fs.readFileSync('components/case-data.ts','utf8').replace("import baseMeta from './meta-data.json';",'const baseMeta='+fs.readFileSync('components/meta-data.json','utf8')+';');
const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {buildCaseData}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
files['case.json']=jsonBytes(buildCaseData({caseId:id,caseTitle:pack.manifest.title,durationMs:scenario.END,events:scenario.inputEvents,utterances:scenario.utterances,controls:scenario.controlAnnotations,metaOverride:scenario.meta}).document);
files['audio/combined.wav']=new Uint8Array(fs.readFileSync(path.join(root,'build/audio.wav')));
for(const [dst,src] of [['README.md','brief.md'],['script.md','script.md']])files[dst]=new Uint8Array(fs.readFileSync(path.join(root,src)));
const zip=writeZip(files);assert.deepEqual(snapshotFromFiles(readZip(zip)).scenario.tracks,JSON.parse(JSON.stringify(scenario.tracks)));
fs.mkdirSync(path.join(root,'output'),{recursive:true});fs.writeFileSync(path.join(root,'output/case.zip'),zip);
console.log('Snapshot roundtrip, persisted labels and memory dependency: PASS');
