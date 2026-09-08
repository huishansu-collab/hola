import {separateLoading} from './loading-spacing';
import type {Clip,Scenario} from '../app/page';
import type {InputEvent,Controls} from './json-overlay';
import data from './cases/coffee/case.json';
import timeline from './cases/coffee/timeline.json';

// Speech boundaries and exports share reviewed, original-speed source cuts.
export function createCoffeeCase():Scenario {
 const {utterances,events:inputEvents,fdx_annotation,emotion_annotation,paralinguistic_annotation,custom_annotation,...meta}=data;
 const hum=utterances.find(u=>u.id==='u002')!;
 const question=utterances.find(u=>u.id==='u003')!,confirmation=utterances.find(u=>u.id==='u004')!;
 const loading=inputEvents.find(e=>e.event_id==='wait_quote'&&e.results)?.results;
 const colors:Record<string,string>={user:'green',assistant:'blue',expression:'purple',reasoning:'amber',playback:'pink',tools:'teal',plan:'purple',control:'pink'};
 const subtitles:Record<string,string>={user:'用户音频',assistant:'实际播出',expression:'拖音与垫句',reasoning:'意图与上下文',playback:'音效与播报',tools:'模拟请求与结果',plan:'完整回复内容',control:'站内操作'};
 const descriptions:Record<string,string>={run_memory_1:'读取历史咖啡偏好；本次选择待用户确认',run_gps_1:'并行读取当前位置（模拟）',run_saved_1:'读取已保存地点、公司标签与完整配送地址',run_location_1:'匹配公司位置；GPS 不替代收货地址',run_quote_1:'确认后查询库存与配送报价 · 总价 ¥21',run_show_quote:'展示商品、完整地址、费用与用户支付入口',run_status_1:'支付成功后只读查询 · 等待店家接单',run_show_order:'店家已接单 · 更新订单卡片'};
 const tracks:Scenario['tracks']=timeline.tracks.map(track=>({name:track.name,en:subtitles[track.id],color:colors[track.id],clips:track.clips.map(raw=>{
  const c:Clip={a:raw.start_at_ms,b:raw.end_at_ms,label:raw.label,lane:'lane' in raw?raw.lane:0,sub:descriptions[raw.id]};
  if(raw.kind==='speech'&&'audio_key' in raw){c.wave=true;c.audioKey=raw.audio_key;c.sub='完整对白生成 · 原速播放';}
  if(track.id==='expression'){c.expression=0;c.sub=data.static_context.constraints.audio_note;}
  if(raw.kind==='loading'){c.audioKey='actor_loading';c.loop=true;c.sub='回应结束后播放 · 下次播报前停止';c.gainPoints=loading?.gain_points as [number,number][];}
  return c;
 })}));
 const checkpoints=[
  {t:question.start_at_ms,end:question.end_at_ms,name:'核对偏好',title:'大杯冰美式，送到公司，对吧？',quote:'大杯冰美式，送到公司，对吧？',note:'历史偏好仅作为候选；当前位置与公司匹配后再询问。'},
  {t:confirmation.start_at_ms,end:confirmation.end_at_ms,name:'用户确认',title:'确认规格与配送地点',quote:'是的。',note:'这是对上一轮问题的确认，不是打断，也不代表支付授权。'},
  {t:24800,end:25200,name:'卡片支付',title:'用户点击并亲自完成支付',quote:'',note:'模拟用户操作。点击打开支付界面，不等于支付成功。'},
  {t:28000,end:28400,name:'支付回传',title:'支付已成功，接单状态待核对',quote:'',note:'模拟支付服务事件；确认店家接单后才播报。'}
 ];
 return separateLoading({END:timeline.duration_ms,tracks,events:checkpoints.map((e,id)=>({...e,id,tag:'交互节点',plan:e.title,heard:e.quote,drop:'',actions:[e.note],tool:'模拟 Case',overlap:null})),expressions:[{a:hum.start_at_ms,b:hum.end_at_ms,label:'平调拖音 · 战术性拖延',trigger:'读取记忆并核对位置',delivery:'嗯……',annotation:data.static_context.constraints.audio_note}],utterances,inputEvents:inputEvents as InputEvent[],controlAnnotations:{fdx_annotation,emotion_annotation,paralinguistic_annotation,custom_annotation} as Controls,playableClips:tracks.flatMap(t=>t.clips).filter(c=>c.audioKey),meta,timingStatus:'aligned'});
}
