import type {Clip,Scenario} from '../app/page';
import type {InputEvent} from './json-overlay';
import data from './cases/sms/case.json';
import timeline from './cases/sms/timeline.json';

export function createSmsCase():Scenario {
 const {utterances,events:inputEvents,fdx_annotation,emotion_annotation,paralinguistic_annotation,custom_annotation,...meta}=data;
 const colors:Record<string,string>={user:'green',control:'pink',assistant:'blue',expression:'purple',playback:'pink',world:'gold',reasoning:'amber',tools:'teal'};
 const subtitles:Record<string,string>={user:'用户音频',control:'设备操作',assistant:'实际播出',expression:'语音表达',playback:'音效与播报',world:'外部信号与设备状态',reasoning:'决策与反应',tools:'模拟请求与结果'};
 const tracks=timeline.tracks.map(t=>({name:t.name,en:subtitles[t.id],color:colors[t.id],clips:t.clips.map(c=>({a:c.start_at_ms,b:c.end_at_ms,label:c.label,sub:c.sub,...('audio_key' in c?{audioKey:c.audio_key,wave:true}:{})} as Clip))}));
 const checkpoints=[
  {t:0,end:400,name:'短信到达',title:'中国移动欠费预警',note:'世界信号进入，不等同于用户主动提问。'},
  {t:1600,end:6600,name:'黄灯提醒',title:'静默黄灯闪烁 5 秒',note:'设备确认非交互状态后提示关注；灯灭后通知仍待处理。'},
  {t:7200,end:7600,name:'用户触摸',title:'触摸 Living Edge 查看提醒',note:'用户设备操作触发激活，不推断为解锁手机或充值授权。'},
  {t:8400,end:12050,name:'播报短信',title:'激活后播报来源与内容',note:'本次生成音频原速播出 3.65 秒；保持原短信含义。'},
 ];
 return {END:timeline.duration_ms,tracks,events:checkpoints.map((c,id)=>({...c,id,quote:'',tag:'交互节点',plan:'',heard:'',drop:'',actions:[c.note],tool:'模拟 Case',overlap:null})),expressions:[],utterances,inputEvents:inputEvents as InputEvent[],controlAnnotations:{fdx_annotation,emotion_annotation,paralinguistic_annotation,custom_annotation},playableClips:tracks.flatMap(t=>t.clips).filter(c=>c.audioKey),meta,timingStatus:'aligned'};
}
