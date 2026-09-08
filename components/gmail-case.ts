import type {Scenario} from '../app/page';
import type {InputEvent} from './json-overlay';
import data from './cases/gmail/case.json';
import timeline from './cases/gmail/timeline.json';
export function createGmailCase():Scenario {
 const {utterances,events:inputEvents,fdx_annotation,emotion_annotation,paralinguistic_annotation,custom_annotation,...meta}=data;
 const colors:Record<string,string>={user:'green',control:'pink',assistant:'blue',expression:'purple',world:'teal',reasoning:'amber',tools:'teal'};
 const tracks=timeline.tracks.map(t=>({name:t.name,en:t.id==='user'||t.id==='assistant'?'语音待生成':'',color:colors[t.id],clips:t.clips.map(c=>({a:c.start_at_ms,b:c.end_at_ms,label:c.label,sub:'sub' in c?c.sub:undefined}))}));
 const points=[{t:6400,end:6800,name:'检查绑定',title:'读取邮箱绑定记录',note:'未绑定邮箱，先发现可用连接能力。'},{t:16000,end:18400,name:'确认 Gmail',title:'用户选择 Gmail',note:'用户同意配置，邮箱尚未连接。'},{t:18800,end:19200,name:'配置卡片',title:'展示 Gmail 配置卡片',note:'等待用户按卡片指引完成配置后，再继续未读邮件摘要任务。'}];
 return {END:timeline.duration_ms,tracks,events:points.map((p,id)=>({...p,id,quote:'',tag:'交互节点',plan:'',heard:'',drop:'',actions:[p.note],tool:'模拟 Case',overlap:null})),expressions:[],utterances,inputEvents:inputEvents as InputEvent[],controlAnnotations:{fdx_annotation,emotion_annotation,paralinguistic_annotation,custom_annotation},playableClips:[],meta,timingStatus:'planned'};
}
