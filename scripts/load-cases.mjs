import fs from 'node:fs';import ts from 'typescript';
export const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
export function loadCases(){
 const audio=Object.assign({},...['clips','actor-clips','ride-clips','coffee-clips'].map(n=>JSON.parse(fs.readFileSync(`components/audio/${n}.json`))));
 const page=fs.readFileSync('app/page.tsx','utf8');
 const weather=ts.transpileModule(page.slice(page.indexOf('let END='),page.indexOf('function Wave(')),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText.replace(/export \{\};?/g,'');
 const base=compile('components/loading-spacing.ts')+compile('components/scenario-utils.ts');
 const raw={weather:Function('audioClips',weather+';return weatherScenario')(audio),actor:Function('audioClips',base+compile('components/actor-case.ts')+';return createActorCase()')(audio),ride:Function('audioClips',base+compile('components/ride-case.ts')+';return createRideCase()')(audio),coffee:Function('data','timeline',compile('components/loading-spacing.ts')+compile('components/coffee-case.ts')+';return createCoffeeCase()')(JSON.parse(fs.readFileSync('components/cases/coffee/case.json')),JSON.parse(fs.readFileSync('components/cases/coffee/timeline.json')))};
 raw.sms=Function('data','timeline',compile('components/sms-case.ts')+';return createSmsCase()')(JSON.parse(fs.readFileSync('components/cases/sms/case.json')),JSON.parse(fs.readFileSync('components/cases/sms/timeline.json')));
 raw.gmail=Function('data','timeline',compile('components/gmail-case.ts')+';return createGmailCase()')(JSON.parse(fs.readFileSync('components/cases/gmail/case.json')),JSON.parse(fs.readFileSync('components/cases/gmail/timeline.json')));
 const stream=Function(compile('components/streaming-case.ts')+';return streamingCase')();
 return Object.fromEntries(Object.entries(raw).map(([id,s])=>[id,stream(s)]));
}
