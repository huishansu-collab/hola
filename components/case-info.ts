import type {Scenario} from '../app/page';
export function summarizeCase(s:Scenario){
 const turns=s.utterances.slice().sort((a,b)=>a.start_at_ms-b.start_at_ms).filter((u,i,all)=>i===0||all[i-1].speaker!==u.speaker);
 const tools=[...new Set(s.inputEvents.flatMap(e=>e.tool_name?[e.tool_name]:[]))];
 return {duration:s.END,rounds:turns.filter(u=>u.speaker==='user').length,speakerTurns:turns.length,utterances:s.utterances.length,events:s.inputEvents.length,toolCalls:new Set(s.inputEvents.filter(e=>e.tool_name).map(e=>e.event_id)).size,interruptions:s.events.filter(e=>e.overlap).length,tools,tracks:s.tracks.length};
}
