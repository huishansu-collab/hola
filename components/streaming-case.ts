import type {Clip,Scenario} from '../app/page';
const stripUnspoken=(text:string)=>text.replace(/\[丢弃：[^\]]*\]/g,'');
// These fixtures have no generation-buffer telemetry. A scripted continuation
// is not evidence that text or audio was generated before an interruption.
export function streamingCase(s:Scenario):Scenario {
 const cleaned:Scenario['tracks']=s.tracks.filter(t=>!['回复计划','回复修订'].includes(t.name)).map(t=>({...t,clips:t.clips.filter(c=>!c.discardTail).map(c=>({...c,label:stripUnspoken(c.label),sub:t.name==='播报控制'&&c.label.includes('停止')?`${(c.sub??'').replace(/；?\s*丢弃[^；。]*/g,'')}；未记录待播队列，不推断丢弃文本`:c.sub}))}));
 const inputEvents=[...s.inputEvents];
 const stopClips:Clip[]=[];
 for(const play of s.inputEvents.filter(e=>e.tool_name==='audio.play'&&e.query!==undefined)){
  const clip=cleaned.flatMap(t=>t.clips).find(c=>c.loop&&c.audioKey&&c.a===play.time_at_ms);
  if(!clip)throw new Error(`Missing playback interval: ${play.event_id}`);
  const event_id=`${play.event_id}_stop`,at=clip.b;
  if(!inputEvents.some(e=>e.event_id===event_id)){
   inputEvents.push({event_id,event_type:'function_call',tool_name:'audio.stop',time_at_ms:at,query:JSON.stringify({playback_event_id:play.event_id})},{event_id,event_type:'function_call',tool_name:'audio.stop',time_at_ms:at+400,results:{status:'stopped',playback_event_id:play.event_id,stopped_at_ms:at}});
   stopClips.push({a:at,b:at+400,label:'audio.stop()',sub:'停止对应等待音效；400 毫秒为模拟工具确认窗口，音效结束点保持不变。'});
  }
 }
 inputEvents.sort((a,b)=>a.time_at_ms-b.time_at_ms);
 cleaned.push({name:'工具调用',en:'播放控制',color:'teal',clips:stopClips});
 // Playback actions share the tools track; overlapping intervals occupy separate rows.
 const merged=cleaned.filter(t=>t.name==='工具调用'||t.name==='播报控制').flatMap(t=>t.clips.map(c=>({...c,playbackControl:t.name==='播报控制'||c.playbackControl}))).sort((a,b)=>a.a-b.a||b.b-a.b);
 const laneEnds:number[]=[];
 const toolClips=merged.map(c=>{let lane=laneEnds.findIndex(end=>end<=c.a);if(lane<0)lane=laneEnds.length;laneEnds[lane]=c.b;return {...c,lane}});
 const layout=[
  ['用户','实际输入','green'],['用户控制','站内操作','pink'],
  ['助手','实际播出','blue'],['表达控制','语音表达','purple'],
  ['世界','外部输入与状态','teal'],
  ['后台判断','决策与反应','amber'],['工具调用','服务与播放控制','teal'],
 ];
 const tracks=layout.map(([name,en,color])=>name==='工具调用'?{name,en,color,clips:toolClips}:cleaned.find(t=>t.name===name)??{name,en,color,clips:[]});
 const expressions=s.expressions.map(e=>({...e,delivery:stripUnspoken(e.delivery).replace(/；?丢弃[^。]*。?/g,''),annotation:e.annotation.includes('完整计划')?'按当前输入逐步生成，标注实际播出边界。':e.annotation.replace('回复计划','生成决策')}));
 return {...s,END:Math.max(s.END,...stopClips.map(c=>Math.ceil(c.b/400)*400)),inputEvents,tracks,expressions,events:s.events.map(e=>({...e,plan:'',drop:'',actions:e.actions.map(a=>a.includes('丢弃')?'停止当前播报；若存在已生成待播内容则清空队列':a)})),playableClips:tracks.flatMap(t=>t.clips).filter(c=>c.audioKey)};
}
