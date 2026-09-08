import {separateLoading} from './loading-spacing';
import {audioClips} from './audio/use-timeline-audio';
import type {Clip,Scenario} from '../app/page';
import type {InputEvent,Controls} from './json-overlay';
export function createActorCase():Scenario{
 const grid=(t:number)=>Math.ceil(t/400)*400;
 const voice=(key:string,a:number,label:string,event?:number):Clip=>({a,b:a+audioClips[key].duration*1000,label,wave:true,audioKey:key,event});
 const u0=voice('actor_u0',0,'《延禧攻略》的那个女演员叫什么名字来着？');
 const intro=voice('actor_intro',grid(u0.b+400),'嗯，你稍等，我查一下。');intro.expression=0;
 const lookupAt=intro.a,lookupEnd=lookupAt+3000;
 const a0=voice('actor_a0',grid(Math.max(lookupEnd,intro.b)+400),'你说的是吴谨言吧。[丢弃：演魏璎珞的]',0);a0.fadeMs=120;
 const u1=voice('actor_u1',a0.b-400,'对，她最近演的那部电视剧叫什么来着？',0);
 const decisionAt=grid(u1.b+400),searchAt=decisionAt+400,searchEnd=searchAt+8000;
 const a1=voice('actor_a1',searchAt,'稍等，我来查一下。');a1.expression=1;
 const u2=voice('actor_u2',Math.max(a1.b+600,searchAt+3600),'男主好像叫王星越。');
 const a2=voice('actor_a2',grid(u2.b+400),'嗯，王星越。');
 const a3=voice('actor_a3',grid(Math.max(searchEnd+400,a2.b+400)),'你说的应该是《墨雨云间》，她和[丢弃：王星越主演的]',1);a3.fadeMs=120;
 const u3=voice('actor_u3',a3.b-400,'对对。',1);
 const users=[u0,u1,u2,u3],assistant=[intro,a0,a1,a2,a3];
 const waitSpeech=[a1,u2,a2];
 const waitTimes=new Set([searchAt,searchAt+120,searchEnd-180,searchEnd]);
 for(const c of waitSpeech)for(const t of [c.a,c.a+80,c.b,c.b+200])if(t>searchAt&&t<searchEnd)waitTimes.add(t);
 const waitGain:[number,number][]=Array.from(waitTimes).sort((a,b)=>a-b).map(t=>{
  const base=.35*Math.max(0,Math.min(1,(t-searchAt)/120,(searchEnd-t)/180));
  let duck=1;
  for(const c of waitSpeech){
   if(t>=c.a&&t<c.a+80)duck=Math.min(duck,1-.78*(t-c.a)/80);
   else if(t>=c.a+80&&t<=c.b)duck=Math.min(duck,.22);
   else if(t>c.b&&t<c.b+200)duck=Math.min(duck,.22+.78*(t-c.b)/200);
  }
  return [t,base*duck];
 });
 const expressions=[{a:intro.a,b:intro.b,label:'拖音 · 战术性垫句',trigger:'需要查询演员名字',delivery:'嗯，你稍等，我查一下。',annotation:'自然拖音，给查询留出时间。'},{a:a1.a,b:a1.b,label:'拖音 · 0.85 倍速 · 战术性垫句',trigger:'查询条件明确，搜索已启动',delivery:'“稍等，我来查一下。”；自然拖音，慢说，边说边听。',annotation:'标注整段表达边界，不把常规语速的确认单独放入表达控制。'}];
 const event=(id:number,u:Clip,a:Clip,title:string,plan:string,drop:string,actions:string[])=>({id,t:u.a,end:a.b,name:`打断 0${id+1}`,title,quote:u.label,tag:'用户打断',plan,heard:a.label.replace(/\[丢弃：[^\]]*\]/g,''),drop,actions,tool:id===0?'承接人物指代后搜索':'搜索已完成，不追加介绍',note:'区间是案例排布；微轮次不是实测打断延迟。',overlap:[u.a,a.b]});
 const events=[event(0,u1,a0,'确认人物并追问作品','你说的是吴谨言吧，演魏璎珞的。','演魏璎珞的',['检测用户起声','淡出后停止播报','承接“她”指代吴谨言','听完后确认搜索条件']),event(1,u3,a3,'确认剧名并结束介绍','你说的应该是《墨雨云间》，她和王星越主演的。','王星越主演的',['用户确认剧名','淡出后停止剩余介绍','听完肯定确认，不主动追加介绍','结束任务，不追加回复'])];
 const tracks:Scenario['tracks']=[
  {name:'用户',en:'音频',color:'green',clips:users},
  {name:'助手',en:'实际播出',color:'blue',clips:assistant},
  {name:'表达控制',en:'拖音与慢说',color:'purple',clips:expressions.map((e,i)=>({...e,expression:i,sub:e.delivery}))},
  {name:'后台判断',en:'意图与上下文',color:'amber',clips:[
   {a:400,b:grid(u0.b),label:'逐步提取剧名与人物指代'},
   {a:grid(u0.b),b:intro.a,label:'指代不明确 · 决定查询演员'},
   {a:grid(u1.a),b:grid(u1.b),label:'接收确认与追问 · 持续提取',event:0},
   {a:decisionAt,b:searchAt,label:'确认“她”指吴谨言 · 决定搜索近期作品'},
   {a:grid(u2.a+400),b:grid(u2.b+400),label:'收听补充 · 待确认搭档线索'},
   {a:grid(u2.b+400),b:grid(u2.b+400)+400,label:'记录搭档候选：王星越 · 不重新搜索'},
   {a:searchEnd,b:a3.a,label:'结合搭档线索匹配《墨雨云间》',sub:'案例候选结果；“近期”不代表实时最新作品'},
   {a:grid(u3.a),b:grid(u3.b),label:'收听确认 · 停止介绍',event:1},
   {a:grid(u3.b+400),b:grid(u3.b+400)+400,label:'已确认答案 · 不追加回复',event:1}
  ]},
  {name:'播报控制',en:'音效与播报',color:'pink',clips:[{a:searchAt,b:searchEnd,label:'audio.play()',sub:'Loading 音效 · 随搜索持续 8 秒 · 人声时压低，查询结束后停止',audioKey:'actor_loading',loop:true,gainPoints:waitGain},...[a0,a3].map((a,i)=>({a:grid(users[i===0?1:3].a),b:Math.max(grid(users[i===0?1:3].a)+400,grid(a.b)),label:'淡出 → 停止',sub:`控制窗口至少 400 毫秒；尾部淡出 120 毫秒，实际停止于 ${Math.round(a.b)} 毫秒`,event:i}))]},
  {name:'工具调用',en:'异步请求',color:'teal',clips:[{a:lookupAt,b:lookupEnd,label:'web_search(延禧攻略 女主角)',sub:'演员查询 · 3,000 毫秒 · 与战术性垫句同时开始'},{a:searchAt,b:searchEnd,label:'web_search(吴谨言 近期电视剧 作品)',sub:'请求 A · 8,000 毫秒 · 补充线索时继续查询'}]},
  {name:'回复计划',en:'完整回复内容',color:'purple',clips:[{a:intro.a,b:intro.b,label:intro.label},{a:a0.a,b:a0.b,label:events[0].plan,event:0},{a:a1.a,b:a1.b,label:a1.label},{a:a2.a,b:a2.b,label:a2.label},{a:a3.a,b:a3.b,label:events[1].plan,event:1}]},
  {name:'回复修订',en:'丢弃与抑制',color:'pink',clips:[{a:grid(a0.b),b:grid(a0.b)+400,label:'丢弃：演魏璎珞的',muted:true,event:0},{a:grid(a3.b),b:grid(a3.b)+400,label:'丢弃：王星越主演的',muted:true,event:1}]}
 ];
 const END=grid(Math.max(...tracks.flatMap(t=>t.clips.map(c=>c.b))));
 const utterances=tracks.slice(0,2).flatMap(t=>t.clips.map(c=>({c,speaker:t.name==='用户'?'user':'assistant'}))).sort((a,b)=>a.c.a-b.c.a).map(({c,speaker},i)=>({id:`u${String(i+1).padStart(3,'0')}`,speaker,speaker_id:speaker==='user'?'user_1':'assistant',text:c.label.replace(/\[丢弃：[^\]]*\]/g,''),start_at_ms:Math.round(c.a),end_at_ms:Math.round(c.b)}));
 const inputEvents:InputEvent[]=[{event_id:'demo_actor_lookup',event_type:'function_call',tool_name:'web_search',time_at_ms:lookupAt,query:'延禧攻略 女主角'},{event_id:'demo_actor_lookup',event_type:'function_call',tool_name:'web_search',time_at_ms:lookupEnd,results:{name:'吴谨言',character:'魏璎珞',note:'案例示意搜索结果'}},{event_id:'demo_actor_search_A',event_type:'function_call',tool_name:'web_search',time_at_ms:searchAt,query:'吴谨言 近期电视剧 作品'},{event_id:'demo_actor_search_A',event_type:'function_call',tool_name:'web_search',time_at_ms:searchEnd,results:{candidates:[{title:'墨雨云间',cast:['吴谨言','王星越']}],note:'案例示意搜索结果'}},{event_id:'demo_actor_loading_B',event_type:'function_call',tool_name:'audio.play',time_at_ms:searchAt,query:'播放 Loading 音效，持续 8000 毫秒；有人说话时压低音量'},{event_id:'demo_actor_loading_B',event_type:'function_call',tool_name:'audio.play',time_at_ms:searchEnd,results:{status:'completed',duration_ms:8000}}];
 const controlAnnotations:Controls={fdx_annotation:[{fdx_type:'垫句',role:'assistant',start_at_ms:intro.a,end_at_ms:Math.round(intro.b)},{fdx_type:'垫句',role:'assistant',start_at_ms:a1.a,end_at_ms:Math.round(a1.b)},{fdx_type:'慢说',role:'assistant',start_at_ms:a1.a,end_at_ms:Math.round(a1.b)}],emotion_annotation:[],paralinguistic_annotation:[],custom_annotation:[]};
 return separateLoading({END,events,tracks,expressions,playableClips:tracks.flatMap(t=>t.clips).filter(c=>c.audioKey),utterances,inputEvents,controlAnnotations});
}
