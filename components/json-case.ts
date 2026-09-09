import type {Clip,Scenario} from '../app/page';
import type {InputEvent,Controls} from './json-overlay';
type RawClip={id:string;kind:string;label:string;start_at_ms:number;end_at_ms:number;sub?:string;lane?:number;audio_key?:string};
type RawTimeline={duration_ms:number;tracks:{id:string;name:string;clips:RawClip[]}[]};
export type RawCase={utterances:Scenario['utterances'];events:InputEvent[]}&Controls&Record<string,unknown>;
export type Checkpoint={t:number;end:number;name:string;title:string;note:string;quote?:string;overlap?:[number,number];tag?:string};
const colors:Record<string,string>={user:'green',control:'pink',assistant:'blue',expression:'purple',playback:'pink',world:'teal',reasoning:'amber',tools:'teal'};
const subtitles:Record<string,string>={user:'用户音频',control:'设备与站内操作',assistant:'实际播出',expression:'语音表达',playback:'播报与音效控制',world:'外部信号与设备状态',reasoning:'决策与反应',tools:'模拟请求与结果'};
// Shared loader for cases whose timeline lives entirely in JSON. These fixtures
// carry no generated speech, so timings are design values, not measurements.
export function createJsonCase(data:RawCase,timeline:RawTimeline,checkpoints:Checkpoint[],expressions:Scenario['expressions']=[]):Scenario {
 const {utterances,events:inputEvents,fdx_annotation,emotion_annotation,paralinguistic_annotation,custom_annotation,...meta}=data;
 // Expression clips index into `expressions` so the inspector can open them.
 const tracks:Scenario['tracks']=timeline.tracks.map(t=>({name:t.name,en:subtitles[t.id],color:colors[t.id],clips:t.clips.map(c=>({a:c.start_at_ms,b:c.end_at_ms,label:c.label,sub:c.sub,lane:c.lane??0,...(t.id==='expression'?{expression:Math.max(0,expressions.findIndex(e=>e.a===c.start_at_ms))}:{}),...(c.audio_key?{audioKey:c.audio_key,wave:true}:{})} as Clip))}));
 const events=checkpoints.map((c,id)=>({...c,id,quote:c.quote??'',tag:c.tag??(c.overlap?'用户打断':'交互节点'),plan:'',heard:c.quote??'',drop:'',actions:[c.note],tool:'模拟 Case',overlap:c.overlap??null}));
 return {END:timeline.duration_ms,tracks,events,expressions,utterances,inputEvents,controlAnnotations:{fdx_annotation,emotion_annotation,paralinguistic_annotation,custom_annotation},playableClips:tracks.flatMap(t=>t.clips).filter(c=>c.audioKey),meta,timingStatus:'planned'};
}
