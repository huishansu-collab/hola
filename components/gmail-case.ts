import type {Scenario} from '../app/page';
import type {InputEvent} from './json-overlay';
import data from './cases/gmail/case.json';
import timeline from './cases/gmail/timeline.json';
export function createGmailCase():Scenario {
 const {utterances,events:inputEvents,fdx_annotation,emotion_annotation,paralinguistic_annotation,custom_annotation,...meta}=data;
 const colors:Record<string,string>={user:'green',control:'pink',assistant:'blue',expression:'purple',world:'teal',reasoning:'amber',tools:'teal'};
 const tracks=timeline.tracks.map(t=>({name:t.name,en:'',color:colors[t.id],clips:t.clips.map(c=>({a:c.start_at_ms,b:c.end_at_ms,label:c.label,sub:'sub' in c?c.sub:undefined,audioKey:'audio_key' in c?c.audio_key:undefined,wave:c.kind==='speech'}))}));
 const points=[{t:4800,end:5200,name:'检查绑定',title:'读取邮箱绑定记录',note:'未绑定邮箱，先发现可用连接能力。'},{t:12000,end:13900,name:'确认 Gmail',title:'用户选择 Gmail',note:'用户同意配置，邮箱尚未连接。'},{t:14400,end:14800,name:'配置卡片',title:'展示 Gmail 配置卡片',note:'等待用户按卡片指引完成配置后，再继续未读邮件摘要任务。'}];
 return {END:timeline.duration_ms,tracks,events:points.map((p,id)=>({...p,id,quote:'',tag:'交互节点',plan:'',heard:'',drop:'',actions:[p.note],tool:'模拟 Case',overlap:null})),expressions:[],utterances,inputEvents:inputEvents as InputEvent[],controlAnnotations:{fdx_annotation,emotion_annotation,paralinguistic_annotation,custom_annotation},playableClips:tracks.flatMap(t=>t.clips).filter(c=>c.audioKey),meta,timingStatus:'aligned'};
}
