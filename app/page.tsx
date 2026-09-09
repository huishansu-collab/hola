'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { audioClips, useTimelineAudio } from '@/components/audio/use-timeline-audio';
import {SynthesisPanel} from '@/components/synthesis-panel';
import { JsonOverlay, type InputEvent, type Controls } from '@/components/json-overlay';
import { createActorCase } from '@/components/actor-case';
import {createRideCase} from '@/components/ride-case';
import {packageRuntimes} from '@/components/case-packages';
import {packageToScenario} from '@/components/package-scenario';
import {backchannelUnits,resolve as resolveBackchannel,applyNudge,exportOffsets,type Nudge} from '@/components/backchannel-editor';
import {storedPackages,importPackage,importedScenario,type ImportedCase} from '@/components/case-package-store';
import {createSmsCase} from '@/components/sms-case';
import {createCoffeeCase} from '@/components/coffee-case';
import {createInterruptCase} from '@/components/interrupt-case';
import {createRetryCase} from '@/components/retry-case';
import {createClarifyCase} from '@/components/clarify-case';
import {createPreemptCase} from '@/components/preempt-case';
import {readViewports,resolveViewport,viewportStorageKey,type CaseViewport} from '@/components/case-viewport';
import {streamingCase} from '@/components/streaming-case';
import {reconcileCase} from '@/components/case-data';
import { FilesPanel, type CaseFile } from '@/components/files-panel';
import { Slider } from '@/components/ui/slider';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { Play, Pause, SkipBack, ZoomIn, ZoomOut, ScanLine, MousePointer2, ChevronRight, AudioLines, SlidersHorizontal, Flag, X, Crosshair, Clock3, PanelLeftClose, PanelLeftOpen, Check, ArrowRight, Info } from '@/components/sf-symbols';
function InspectorGroup({title,meta,children,defaultOpen=true,tone=''}:{title:string;meta?:ReactNode;children:ReactNode;defaultOpen?:boolean;tone?:string}){return <details className={'inspector-group '+tone} open={defaultOpen}><summary><ChevronRight size={12}/><span>{title}</span>{meta&&<small>{meta}</small>}</summary><div className="group-body">{children}</div></details>}
function InspectorSubsection({title,children}:{title:string;children:ReactNode}){return <section className="inspector-subsection"><h4>{title}</h4><div>{children}</div></section>}
let END=31600;
const fmt=(n:number)=>(n/1000).toFixed(3)+' 秒';
export type Clip={playbackControl?:boolean;lane?:number;a:number;b:number;label:string;sub?:string;event?:number;wave?:boolean;muted?:boolean;expression?:number;discardTail?:boolean;fadeOut?:boolean;audioKey?:string;fadeMs?:number;loop?:boolean;gainPoints?:[number,number][]};
const events=[
 {id:0,t:5500,end:5900,name:'打断 01',title:'等待中补充需求',quote:'“主要……看下午，我要出去跑步。”',tag:'用户打断',plan:'嗯……好的，你稍等一下，我来看看。',heard:'嗯……好的，你稍等一下……',drop:'我来看看',actions:['检测到用户起声，让出话权','先执行淡出包络，再调用 audio.stop() 停止播报','保持 weather.query 查询执行','补充下午时段和跑步用途'],tool:'查询执行中 · 无需重新请求',note:'当前查询包含逐小时天气。停止播报不会取消查询请求。',overlap:[5500,5660]},
 {id:1,t:13400,end:14200,name:'打断 02',title:'切换查询时段',quote:'“那上午呢？”',tag:'用户打断',plan:'明天下午三点左右有小雨，气温二十度，跑步可以……',heard:'明天下午三点左右有小雨……',drop:'气温二十度，跑步可以……',actions:['切换至上午，停止下午的播报','先执行淡出包络，再调用 audio.stop() 停止播报','从已有结果读取上午天气','结合跑步用途组织新的回复'],tool:'使用已有结果 · 无需调用 API',note:'上午天气回复在听完用户请求并留出响应空白后播出。',overlap:[13400,13560]},
 {id:2,t:22600,end:24000,name:'改口 03',title:'修改提醒时间',quote:'“还是九点吧。”',tag:'意图修改',plan:'创建明天 08:00 的跑步提醒，并核对结果是否符合最新意图。',heard:'行。／收到。',drop:'已过时的 08:00 提醒创建反馈',actions:['将最新目标时间更新为 09:00','等待 R1 返回已创建的 08:00 提醒','完成核对后调用 reminder.update(id, 09:00)','用“收到”确认接收改口；修改成功后再确认完成'],tool:'R1 → 修改提醒 → 成功',note:'用户说话时工具仍在执行。助手此时保持安静，不存在双方音频重叠。',overlap:null},
];
const expressions=[{"a": 0, "b": 2400, "label": "暂不发声", "trigger": "用户请求尚未说完", "delivery": "持续收听，等待地点和日期完整。", "annotation": "不抢话，不提前组织出声。"}, {"a": 2400, "b": 3900, "label": "轻声 · 拖音约 1.6 秒", "trigger": "信息完整，确认查询决策；3.200 秒发起 weather.query", "delivery": "“嗯……”；轻声起音，平缓拖长，尾音自然收住，约 1.6 秒（按 400 毫秒网格对齐）。", "annotation": "将工具请求启动与自然拖音对齐；音量、拖音实际边界待测。"}, {"a": 3900, "b": 5660, "label": "慢速回应 · 约 0.85×", "trigger": "天气查询执行中", "delivery": "“好的，你稍等一下……”；约常规语速的 0.85 倍，边说边听。", "annotation": "完整计划为“嗯……好的，你稍等一下，我来看看。”；区分计划和实播。"}, {"a": 5500, "b": 5900, "label": "打断① · 停播让话", "trigger": "用户起声“主要……”", "delivery": "先淡出正在播放的音频，再停止播报并继续收听；丢弃未播出的“我来看看”。", "annotation": "记录起声、检出、停播指令、实际停声；查询继续，音频边界单独测量。"}, {"a": 5900, "b": 7500, "label": "收听补充 · 不抢话", "trigger": "用户补充下午和跑步用途", "delivery": "保持安静，听完补充。", "annotation": "已有逐小时天气查询继续，无需重查。"}, {"a": 7500, "b": 10100, "label": "简短确认 · 自然语速", "trigger": "补充结束，查询仍未完成", "delivery": "“行，我看看下午适不适合跑步。”", "annotation": "确认接收补充后继续等待，不反复填充。"}, {"a": 10100, "b": 10400, "label": "安静等待 · 无填充", "trigger": "查询仍在执行，无新信息", "delivery": "保持安静，持续收听。", "annotation": "允许等待留白；不以话术填满 8,000 毫秒的 API 耗时。"}, {"a": 10400, "b": 10800, "label": "组织回复 · 暂不播出", "trigger": "查询结果返回", "delivery": "准备下午降雨、温度和跑步建议。", "annotation": "区分结果处理、回复计划和真正起播时间。"}, {"a": 10800, "b": 13560, "label": "结果播报 · 常规语速", "trigger": "下午天气回复已准备", "delivery": "“明天下午三点左右有小雨……”", "annotation": "播报同时持续收听。"}, {"a": 13400, "b": 14200, "label": "打断② · 停播切换", "trigger": "用户问“那上午呢？”", "delivery": "先淡出下午播报，再停止音频，丢弃未播出的下午建议。", "annotation": "让出话权；读取已有上午天气，无需再次调用 API。"}, {"a": 14200, "b": 14600, "label": "重组回复 · 暂不播出", "trigger": "关注时段切换至上午", "delivery": "结合跑步用途组织上午回复。", "annotation": "保留跑步上下文，避免播报过时内容。"}, {"a": 14600, "b": 19400, "label": "上午建议 · 常规语速", "trigger": "上午回复已准备", "delivery": "“上午多云，十七到十九度，比下午更适合跑步。”", "annotation": "常规语速，继续收听。"}, {"a": 19400, "b": 22200, "label": "正常接话 · 听完新请求", "trigger": "助手上午建议播报结束，用户提出提醒任务", "delivery": "保持安静，听完时间和事项。", "annotation": "任务信息完整后再发起创建。"}, {"a": 22200, "b": 22600, "label": "简短回应 · 不宣告成功", "trigger": "发起 reminder.create，R1 尚未完成", "delivery": "“行。”；仅确认收到。", "annotation": "接收确认与成功反馈分开，不能在工具完成前宣告设好。"}, {"a": 22600, "b": 24000, "label": "改口③ · 收听不抢话", "trigger": "R1 执行中，用户改为九点", "delivery": "保持安静，继续听取。", "annotation": "最新目标更新为 09:00；工具执行与用户音频重叠，助手没有同时发声。"}, {"a": 24000, "b": 24400, "label": "抑制过时结果", "trigger": "R1 返回 08:00 提醒，与最新意图不符", "delivery": "不播报过时创建结果，立即发起修改。", "annotation": "工具结果必须核对最新意图；不将旧结果直接转成语音。"}, {"a": 24400, "b": 24800, "label": "准备完成反馈", "trigger": "修改成功", "delivery": "准备最终成功反馈。", "annotation": "仅在确认修改成功后组织完成提示。"}, {"a": 24800, "b": 28400, "label": "成功确认 · 常规语速", "trigger": "09:00 提醒修改成功", "delivery": "“设好了，明天早上九点提醒你跑步。”", "annotation": "播报最新有效结果，任务完成后继续收听。"}];
const tracks:{name:string;en:string;color:string;clips:Clip[]}[]=[
 {name:'用户',en:'音频',color:'green',clips:[{a:0,b:2400,label:'帮我看看明天北京的天气。',wave:true},{a:5500,b:5900,label:'主要……',wave:true,event:0},{a:5900,b:7500,label:'看下午，我要出去跑步。',wave:true,event:0},{a:13400,b:14200,label:'那上午呢？',wave:true,event:1},{a:19400,b:22200,label:'那明天早上八点提醒我跑步。',sub:'新任务 · 正常接话 · 不打断助手',wave:true},{a:22600,b:24000,label:'还是九点吧。',wave:true,event:2}]},
 {name:'助手',en:'实际播出',color:'blue',clips:[{a:2400,b:3900,label:'嗯……',wave:true,event:0,sub:'轻声拖音约 1.6 秒 · 原型估计'},{a:3900,b:5660,label:'好的，你稍等一下……',wave:true,event:0,sub:'约 0.85 倍语速 · 打断尾音为示意'},{a:5660,b:6700,label:'我来看看',muted:true,discardTail:true,event:0,sub:'丢弃 · 未播出 · 计划延续'},{a:7500,b:10100,label:'行，我看看下午适不适合跑步。',wave:true},{a:10800,b:13560,label:'明天下午三点左右有小雨……',wave:true,event:1},{a:13560,b:14600,label:'气温二十度，跑步可以……',muted:true,discardTail:true,event:1,sub:'丢弃 · 未播出 · 计划延续'},{a:14600,b:19400,label:'上午多云，十七到十九度，比下午更适合跑步。',wave:true},{a:22200,b:22600,label:'行。',wave:true},{a:24800,b:28400,label:'设好了，明天早上九点提醒你跑步。',wave:true}]},
 {name:'表达控制',en:'语速、拖音与话权',color:'purple',clips:expressions.map((v,i)=>({...v,sub:v.delivery,expression:i}))},
 {name:'后台判断',en:'意图与上下文',color:'amber',clips:[{a:0,b:400,label:'开始收听',sub:'接收首个音频片段 · 尚未确认查询条件'},{a:400,b:2400,label:'开始增量提取 → 持续更新',sub:'起点 0.400 秒为原型估计 · 地点与日期逐步形成'},{a:5500,b:5900,label:'检测到用户起声 → 让出话权',event:0},{a:5900,b:7500,label:'收听补充 · 更新下午与跑步用途',event:0},{a:7500,b:10400,label:'下午时段 + 跑步用途 · 持续收听'},{a:10400,b:10800,label:'提取下午天气'},{a:13400,b:14200,label:'切换至上午 · 保留跑步用途',event:1},{a:14200,b:14600,label:'结合跑步用途组织上午回复',event:1},{a:19400,b:22200,label:'新任务：明天 08:00 提醒跑步'},{a:22600,b:24800,label:'最新目标 → 09:00',event:2}]},
 {name:'播报控制',en:'播报控制事件',color:'pink',clips:[{a:5500,b:5900,label:'淡出 → 停止',sub:'先降低增益，再 audio.stop() · 时长未实测',event:0},{a:13400,b:14200,label:'淡出 → 停止',sub:'先降低增益，再 audio.stop() · 丢弃剩余下午回复',event:1}]},
 {name:'工具调用',en:'异步请求',color:'teal',clips:[{a:2400,b:10400,label:'weather.query(Beijing, tomorrow)',sub:'8,000 毫秒 · 停播后查询继续',event:0},{a:13400,b:14600,label:'读取已有上午天气',event:1},{a:22200,b:24000,label:'R1 · create(08:00)',sub:'执行中用户改口',event:2},{a:24000,b:24800,label:'update(09:00)',sub:'成功后确认完成',event:2}]},
 {name:'回复计划',en:'回复计划与丢弃内容',color:'purple',clips:[{a:2400,b:5500,label:'嗯……好的，你稍等一下，我来看看。',event:0},{a:5500,b:5900,label:'丢弃：我来看看',muted:true,event:0},{a:10100,b:10400,label:'安静等待 · 不填充话术'},{a:10400,b:13400,label:'下午小雨、20°C，准备跑步建议',event:1},{a:13400,b:14200,label:'丢弃：下午跑步建议',muted:true,event:1},{a:14200,b:19400,label:'准备上午跑步建议'},{a:22600,b:24800,label:'不播报过时的 08:00 结果',muted:true,event:2},{a:24800,b:28400,label:'确认明天 09:00 提醒'}]},
];
// Audio placements are the source of truth. Decision starts use the 400 ms grid;
// natural audio ends stay sample-accurate and are never stretched to that grid.
const grid=(t:number)=>Math.ceil(t/400)*400;
const track=(name:string)=>tracks.find(t=>t.name===name)!;
const users=track('用户').clips;
const assistants=track('助手').clips.filter(c=>c.wave);
const place=(c:Clip,key:string,start:number,stop?:number)=>{c.audioKey=key;c.a=start;c.b=Math.min(start+audioClips[key].duration*1000,stop??Infinity);if(stop!==undefined)c.fadeMs=120;};
[0,5900,7110,15400,22140,26400].forEach((t,i)=>place(users[i],`u${i}`,t));
[2800,4400,10000,13600,17200,25200,29600].forEach((t,i)=>place(assistants[i],`a${i}`,t,i===1?6400:i===3?16000:undefined));
assistants[1].label='好的，你稍等一下。[丢弃：我来看看]';
assistants[3].label='明天下午三点左右有小雨。[丢弃：气温二十度，跑步可以……]';
users[1].label='主要，看下午，我要出去跑步。';
users[2].b=users[1].b;
const tails=track('助手').clips.filter(c=>c.discardTail);
[[6400,7200],[16000,17200]].forEach(([a,b],i)=>{Object.assign(tails[i],{a,b,fadeOut:false,sub:'已停止 · 剩余内容丢弃'});});
// Source-derived annotations share the exact speech interval.
const speechExpressionIndices=[1,2,5,8,11,13,17];
speechExpressionIndices.forEach((i,j)=>{expressions[i].a=assistants[j].a;expressions[i].b=assistants[j].b;});
expressions[2].b=6000;expressions[8].b=15600;
expressions[1].label=`轻声 · 自然拖音 ${audioClips.a0.duration.toFixed(2)} 秒`;
expressions[1].delivery='持续平调鼻音，音量轻而稳定，结尾减弱音量，为工具查询留出响应时间。';
expressions[2].label='0.85 倍速 · 战术性拖延';
expressions[2].annotation='标注目标语速为常规语速的 0.85 倍；通过自然放慢和停顿承接等待，用户介入时淡出并让出话权。';
expressions[2].delivery='“好的，你稍等一下……”；以常规语速的 0.85 倍自然放慢，为工具查询争取时间，同时持续收听用户。';
const windows:Record<number,[number,number]>={0:[0,grid(users[0].b)],3:[6000,6400],4:[6400,grid(users[2].b)],6:[0,0],7:[11200,11600],9:[15600,16000],10:[grid(users[3].b+400),17200],12:[grid(users[4].a),grid(users[4].b)],14:[26400,grid(users[5].b)],15:[28000,28400],16:[29200,29600]};
for(const [index,[a,b]] of Object.entries(windows)){expressions[Number(index)].a=a;expressions[Number(index)].b=b;}
// Expression control shows only non-default prosody; interruptions belong to playback control.
const expressionVisible=(index:number)=>[1,2].includes(index)&&expressions[index].b>expressions[index].a;
track('表达控制').clips=expressions.map((v,i)=>({...v,expression:i,sub:v.delivery})).filter(c=>expressionVisible(c.expression));
track('后台判断').clips=[
 {a:400,b:2400,label:'开始增量提取 → 持续更新',sub:'起点为原型估计，逐词识别时间未测量'},
 {a:2400,b:2800,label:'核对信息：北京 / 明天'},
 {a:2800,b:3200,label:'条件完整 · 确认查询决策'},
 {a:6000,b:6400,label:'检测到用户起声 → 让出话权',event:0},
 {a:6400,b:grid(users[2].b),label:'收听补充 · 逐步更新上下文',event:0},
 {a:grid(users[2].b),b:10000,label:'核对下午时段与跑步用途',event:0},
 {a:11200,b:11600,label:'查询返回 → 提取下午天气'},
 {a:11600,b:13200,label:'结果已就绪 · 等待当前回应结束'},
 {a:15600,b:16000,label:'识别时段切换 → 停止下午播报',event:1},
 {a:grid(users[3].b+400),b:17200,label:'读取上午天气 · 组织跑步建议',event:1},
 {a:grid(users[4].a),b:grid(users[4].b),label:'收听新任务 · 提取提醒时间'},
 {a:grid(users[4].b),b:25200,label:'核对明天 08:00 · 准备创建提醒'},
 {a:26400,b:27600,label:'收听改口 · 更新目标为 09:00',event:2},
 {a:28000,b:28400,label:'核对旧结果 · 确认修改为 09:00',event:2},{a:29200,b:29600,label:'修改成功 · 组织完成反馈',event:2}
];
track('播报控制').clips=[{a:6000,b:6400,label:'淡出 → 停止',sub:'真实音频尾部淡出 120 毫秒；停止于 6.400 秒',event:0},{a:15600,b:16000,label:'淡出 → 停止',sub:`真实音频尾部淡出 120 毫秒；停止于 ${fmt(assistants[3].b)}`,event:1}];
track('工具调用').clips=[{a:3200,b:11200,label:'weather.query(Beijing, tomorrow)',sub:'8,000 毫秒 · 打断播报不取消查询',event:0},{a:grid(users[3].b+400),b:17200,label:'读取已有上午天气',event:1},{a:25200,b:28000,label:'R1 · create(08:00)',sub:'用户改口时仍在执行',event:2},{a:28400,b:29200,label:'update(09:00)',sub:'修改成功后才确认完成',event:2}];
track('回复计划').clips=[{a:2800,b:6400,label:events[0].plan,event:0},{a:6400,b:7200,label:'丢弃：我来看看',muted:true,event:0},{a:11200,b:16000,label:events[1].plan,event:1},{a:16000,b:grid(users[3].b+400),label:'丢弃：下午跑步建议',muted:true,event:1},{a:grid(users[3].b+400),b:assistants[4].b,label:'上午多云，十七到十九度，比下午更适合跑步。',event:1},{a:28000,b:28400,label:'不播报过时的 08:00 结果',muted:true,event:2},{a:29600,b:assistants[6].b,label:'确认明天 09:00 提醒'}];
events[0].t=users[1].a;events[0].end=6400;events[0].overlap=[users[1].a,assistants[1].b];
events[1].t=users[3].a;events[1].end=16000;events[1].overlap=[users[3].a,assistants[3].b];
events[2].t=users[5].a;events[2].end=grid(users[5].b);events[2].overlap=null;
if(audioClips.a7){
 const received:Clip={a:28400,b:28400+audioClips.a7.duration*1000,label:'收到。',wave:true,audioKey:'a7',event:2};
 track('助手').clips.push(received);track('助手').clips.sort((a,b)=>a.a-b.a);
 const index=expressions.length;
 expressions.push({a:received.a,b:received.b,label:'确认收到 · 不宣告成功',trigger:'完成修改决策，启动 update(09:00)',delivery:'“收到。”；自然、简短，只确认接收改口。',annotation:'update 执行期间确认收到；成功反馈必须等待修改成功。'});
 if(expressionVisible(index))track('表达控制').clips.push({...received,wave:false,audioKey:undefined,expression:index,label:expressions[index].label,sub:expressions[index].delivery});
 track('回复计划').clips.push({a:received.a,b:received.b,label:'收到。',event:2});
}
track('助手').clips=track('助手').clips.filter(c=>!c.discardTail);
const replyPlans=track('回复计划');
const revisions=replyPlans.clips.filter(c=>c.muted).map(c=>({...c,b:c.a+400,sub:'修订处理窗口 · 不代表丢弃内容的音频时长'}));
replyPlans.clips=replyPlans.clips.filter(c=>!c.muted);
tracks.push({name:'回复修订',en:'丢弃与过时结果抑制',color:'pink',clips:revisions});
track('回复计划').clips.sort((a,b)=>a.a-b.a);
// Resolve the revised target only after the utterance and a full response step.
const revisionConfirmedAt=grid(users[5].b+400);
const revisionShift=Math.max(0,revisionConfirmedAt-28000);
const shifted=new Set<object>();
for(const item of [...tracks.flatMap(t=>t.clips),...expressions]){
 if(shifted.has(item))continue;shifted.add(item);
 if(item.a>=28000){item.a+=revisionShift;item.b+=revisionShift;}
}
const reasoning=track('后台判断');
reasoning.clips=reasoning.clips.filter(c=>c.label!=='收听改口 · 更新目标为 09:00');
reasoning.clips.push({a:26800,b:grid(users[5].b)+400,label:'收听改口 · 持续提取',sub:'用户尚在表达，暂不确认新的提醒时间',event:2});
const revisionDecision=reasoning.clips.find(c=>c.label==='核对旧结果 · 确认修改为 09:00');
if(revisionDecision){revisionDecision.label='确认新目标：09:00 · 核对旧结果';revisionDecision.sub='用户说完后等待至少 400 毫秒，再确认目标并决定修改';}
reasoning.clips.sort((a,b)=>a.a-b.a);
track('用户').clips=track('用户').clips.filter(c=>c.audioKey!=='u2');
END=grid(Math.max(...tracks.flatMap(t=>t.clips.map(c=>c.b))));
const playableClips=tracks.flatMap(t=>t.clips).filter(c=>c.audioKey);
const utterances=tracks.filter(t=>t.name==='用户'||t.name==='助手').flatMap(t=>t.clips.filter(c=>c.audioKey).map(c=>({clip:c,speaker:t.name==='用户'?'user':'assistant'}))).sort((a,b)=>a.clip.a-b.clip.a).map(({clip,speaker},i)=>({id:`u${String(i+1).padStart(3,'0')}`,speaker,speaker_id:speaker==='user'?'user_1':'assistant',text:clip.label.replace(/\[丢弃：[^\]]*\]/g,''),start_at_ms:Math.round(clip.a),end_at_ms:Math.round(clip.b)}));
// Scenario fixtures: request and response share a stable demo ID.
// Times come from the final tool layout, including revision offsets.
const toolEventDefinitions=[
 {event_id:'demo_weather_001',tool_name:'weather.query',match:'weather.query',query:'查询北京明天的逐小时天气。',results:{location:'北京',date:'明天',morning:{condition:'多云',temperature_min:17,temperature_max:19,temperature_unit:'centigrade'},afternoon:{time:'15:00',condition:'小雨',temperature:20,temperature_unit:'centigrade'}}},
 {event_id:'demo_reminder_001',tool_name:'reminder.create',match:'R1 · create',query:'创建明天早上 08:00 提醒跑步的提醒。',results:{status:'success',reminder_id:'demo_reminder_running',date:'明天',time:'08:00',text:'跑步'}},
 {event_id:'demo_reminder_002',tool_name:'reminder.update',match:'update(09:00)',query:'将提醒 demo_reminder_running 修改为明天早上 09:00，事项仍为跑步。',results:{status:'success',reminder_id:'demo_reminder_running',date:'明天',time:'09:00',text:'跑步'}}
];
const inputEvents:InputEvent[]=toolEventDefinitions.flatMap(def=>{
 const clip=track('工具调用').clips.find(c=>c.label.startsWith(def.match))!;
 return [{event_id:def.event_id,event_type:'function_call' as const,tool_name:def.tool_name,time_at_ms:Math.round(clip.a),query:def.query},{event_id:def.event_id,event_type:'function_call' as const,tool_name:def.tool_name,time_at_ms:Math.round(clip.b),results:def.results}];
}).sort((a,b)=>a.time_at_ms-b.time_at_ms);
// Full-duplex labels describe actual utterance intervals, not decision-grid blocks.
const fdxClip=(key:string)=>tracks.flatMap(t=>t.clips).find(c=>c.audioKey===key)!;
const fdxLabel=(key:string,fdx_type:string,role:'user'|'assistant')=>{
 const c=fdxClip(key);return {fdx_type,role,start_at_ms:Math.round(c.a),end_at_ms:Math.round(c.b)};
};
const controlAnnotations:Controls={
 fdx_annotation:[
  fdxLabel('a0','垫句','assistant'),
  fdxLabel('a1','垫句','assistant'),
  fdxLabel('a1','慢说','assistant'),
  fdxLabel('a2','垫句','assistant'),
  fdxLabel('a7','垫句','assistant')
 ].sort((a,b)=>a.start_at_ms-b.start_at_ms),
 emotion_annotation:[],
 paralinguistic_annotation:[],
 custom_annotation:[]
};
const weatherScenario={END,events,tracks,expressions,playableClips,utterances,inputEvents,controlAnnotations};
export type Scenario=typeof weatherScenario & {meta?:Record<string,unknown>;timingStatus?:'planned'|'aligned';breaths?:{utterance_id:string;host_start_ms:number;windows:[number,number][]}[]};
const trackHeight=(t:Scenario['tracks'][number])=>76*(1+Math.max(0,...t.clips.map(c=>c.lane??0)));
function Wave({width,audioKey}:{width:number;seed:number;audioKey?:string}){const peaks=audioKey?audioClips[audioKey]?.peaks:undefined;const n=Math.max(3,Math.floor(width/5));return <svg className="wave" width={width} height="32" aria-hidden="true">{Array.from({length:n},(_,i)=>{const h=peaks?Math.max(1,Math.sqrt(peaks[Math.min(peaks.length-1,Math.floor(i/n*peaks.length))])*29):1;return <line key={i} x1={i*5+2} x2={i*5+2} y1={(32-h)/2} y2={(32+h)/2}/>})}</svg>}
export default function Studio(){
 const [filesWidth,setFilesWidth]=useState(280);
 const [resizingFiles,setResizingFiles]=useState(false);
 const filesWidthRef=useRef(280);
 const resizeFiles=(width:number)=>{const next=Math.round(Math.max(180,Math.min(480,window.innerWidth-400,width)));filesWidthRef.current=next;setFilesWidth(next)};
 const saveFilesWidth=()=>{try{localStorage.setItem('track-studio-files-width',String(filesWidthRef.current))}catch{}};
 useEffect(()=>{try{const value=Number(localStorage.getItem('track-studio-files-width'));if(value>=180&&value<=480)resizeFiles(value)}catch{}},[]);
 const [activeCase,setActiveCase]=useState<CaseFile>({id:"weather",name:"北京天气 / 跑步提醒"});
 const [imported,setImported]=useState<Record<string,{item:ImportedCase;scenario:Scenario}>>({});
 const [packagesReady,setPackagesReady]=useState(false),[packageError,setPackageError]=useState('');
 useEffect(()=>{let live=true;storedPackages().then(items=>{if(live)setImported(Object.fromEntries(items.map(item=>[item.id,{item,scenario:importedScenario(item)}])))}).catch(()=>{if(live)setPackageError('已导入 Case 读取失败，请检查浏览器存储。')}).finally(()=>{if(live)setPackagesReady(true)});return()=>{live=false}},[]);
 const builtins=useMemo<Record<string,Scenario>>(()=>({...Object.fromEntries(packageRuntimes.map(r=>[String(r.manifest.case_id),packageToScenario(r,`package/${r.manifest.case_id}`)])),weather:reconcileCase('weather',streamingCase(weatherScenario)),actor:reconcileCase('actor',streamingCase(createActorCase())),ride:reconcileCase('ride',streamingCase(createRideCase())),coffee:reconcileCase('coffee',streamingCase(createCoffeeCase())),sms:reconcileCase('sms',streamingCase(createSmsCase())),interrupt:reconcileCase('interrupt',streamingCase(createInterruptCase())),retry:reconcileCase('retry',streamingCase(createRetryCase())),clarify:reconcileCase('clarify',streamingCase(createClarifyCase())),preempt:reconcileCase('preempt',streamingCase(createPreemptCase()))}),[]);
 const scenarios=useMemo(()=>({...builtins,...Object.fromEntries(Object.entries(imported).map(([id,v])=>[id,v.scenario]))}),[builtins,imported]);
 const isWeather=!!scenarios[activeCase.id];
 const baseScenario=scenarios[activeCase.id]??scenarios.weather;
 // 附和位置靠耳朵定，不靠猜:界面把换气窗口画出来,拖动的位移只存在 nudge 里,
 // 原始 case 不动,导出的落点再回写给 local/retime_backchannel.py。
 const [nudge,setNudge]=useState<Nudge>({});
 const [dragUnit,setDragUnit]=useState<string|null>(null);
 const bcDrag=useRef<{id:string;x:number;at:number}|null>(null);
 useEffect(()=>{setNudge({});setDragUnit(null)},[activeCase.id]);
 const scenario=useMemo(()=>applyNudge(baseScenario,nudge),[baseScenario,nudge]);
 const bcUnits=useMemo(()=>backchannelUnits(baseScenario),[baseScenario]);
 const bcHeads=bcUnits.filter(u=>u.id===u.group[0]);
 // 起声可以略早于气口——压着换气进去照样自然，判定与 local/retime_backchannel.py 的 NEAR 一致。
 const bcSpot=(u:typeof bcUnits[number])=>{
  const d=nudge[u.id]??0,host=(scenario.breaths??[]).find(b=>b.utterance_id===u.host);
  const off=u.a+d-(host?.host_start_ms??u.a),win=host?.windows.find(w=>off>=w[0]-200&&off<=w[1]);
  return {d,off,win,inBreath:!!win,exact:!!win&&off>=win[0]};
 };
 const bcMove=(u:typeof bcUnits[number],startMs:number)=>{
  const r=resolveBackchannel(baseScenario,u,startMs);
  if(!r)return;
  const assistant=baseScenario.tracks.find(t=>t.name==='助手')?.clips??[];
  setNudge(v=>{const out={...v};
   for(const [id,a] of r.spans){const clip=assistant.find(c=>c.audioKey?.endsWith('/'+id));if(clip)out[id]=a-clip.a}
   return out});
 };
 const importCase=async(file:File)=>{const item=await importPackage(file),scenario=importedScenario(item);setPlaying(false);setPos(0);setSelected(null);setRange([0,0]);setImported(v=>({...v,[item.id]:{item,scenario}}));return {id:item.id,name:item.title}};
 const importedFiles=useMemo(()=>Object.values(imported).map(v=>({id:v.item.id,name:v.item.title})),[imported]);
 const {END,events,tracks,expressions,playableClips,utterances,inputEvents,controlAnnotations}=scenario;
 const [scale,setScale]=useState(210),[pos,setPos]=useState(5900),[playing,setPlaying]=useState(false),[selected,setSelected]=useState<number|null>(0),[range,setRange]=useState<[number,number]>(()=>[events[0]?.t??0,events[0]?.end??0]);
 const audioError=useTimelineAudio(playableClips,pos,playing);
 const [expressionSelected,setExpressionSelected]=useState<number|null>(null);
 const [reasoningSelected,setReasoningSelected]=useState<Clip|null>(null);
 const [collapsedTracks,setCollapsedTracks]=useState<Record<string,boolean>>(()=>Object.fromEntries(tracks.map(t=>[t.name,t.clips.length===0])));
 useLayoutEffect(()=>{setCollapsedTracks(Object.fromEntries(tracks.map(t=>[t.name,t.clips.length===0])))},[activeCase.id,tracks]);
 const [inspectorOpen,setInspectorOpen]=useState(true);
 const [bcCopied,setBcCopied]=useState('');
 const [hovered,setHovered]=useState<string|null>(null);
 const inspector=useRef<HTMLElement>(null);
 const scaleRef=useRef(scale);scaleRef.current=scale;
 const scroller=useRef<HTMLDivElement>(null),drag=useRef<{x:number;t:number}|null>(null),moved=useRef(false),jump=useRef<number|null>(null);
 const [minScale,setMinScale]=useState(1);
 const minScaleRef=useRef(1);
 const [viewportRevision,setViewportRevision]=useState(0);
 const views=useRef<Record<string,CaseViewport>>({});
 const viewsLoaded=useRef(false),viewCase=useRef<string|null>(null),viewMode=useRef<CaseViewport['mode']>('custom');
 const persistViewport=()=>{
  const el=scroller.current,id=viewCase.current;if(!el||!id)return;
  views.current[id]={mode:viewMode.current,scale:scaleRef.current,scrollMs:viewMode.current==='fit'?0:jump.current??el.scrollLeft/scaleRef.current*1000};
  try{localStorage.setItem(viewportStorageKey,JSON.stringify(views.current))}catch{}
 };
 useLayoutEffect(()=>{
  if(!viewsLoaded.current){try{views.current=readViewports(localStorage.getItem(viewportStorageKey))}catch{}viewsLoaded.current=true;}
  const el=scroller.current;if(!el||!isWeather){viewCase.current=null;return;}
  const saved=views.current[activeCase.id];
  viewCase.current=activeCase.id;viewMode.current=saved?.mode??'custom';
  const update=(initial=false)=>{
   if(!el.clientWidth)return;
   const current=initial?saved:{mode:viewMode.current,scale:scaleRef.current,scrollMs:jump.current??el.scrollLeft/scaleRef.current*1000};
   const next=resolveViewport(current,el.clientWidth,END);
   minScaleRef.current=el.clientWidth/(END/1000);setMinScale(minScaleRef.current);
   viewMode.current=next.mode;scaleRef.current=next.scale;jump.current=next.scrollMs;setScale(next.scale);setViewportRevision(v=>v+1);
   // Apply immediately when the scale is unchanged; the layout effect below
   // applies again after React commits a changed timeline width.
   el.scrollLeft=next.scrollMs*next.scale/1000;
   views.current[activeCase.id]=next;
  };
  update(true);const observer=new ResizeObserver(()=>update());observer.observe(el);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const onScroll=()=>{clearTimeout(timer);timer=setTimeout(persistViewport,150)};
  el.addEventListener('scroll',onScroll);window.addEventListener('pagehide',persistViewport);
  return()=>{observer.disconnect();clearTimeout(timer);el.removeEventListener('scroll',onScroll);window.removeEventListener('pagehide',persistViewport)};
 },[activeCase.id,END,isWeather]);
 const width=END/1000*scale,e=selected===null?null:events[selected];
 const px=(t:number)=>t/1000*scale;
 useLayoutEffect(()=>{if(scale!==scaleRef.current)return;if(jump.current!==null&&scroller.current){scroller.current.scrollLeft=jump.current/1000*scaleRef.current;jump.current=null}persistViewport()},[scale,activeCase.id,viewportRevision]);
 useEffect(()=>{
 if(!playing)return;
 let previous=performance.now(),frame=0;
 const advance=(now:number)=>{const elapsed=now-previous;previous=now;setPos(p=>Math.min(END,p+elapsed));frame=requestAnimationFrame(advance)};
 frame=requestAnimationFrame(advance);
 return()=>cancelAnimationFrame(frame);
 },[playing]);
 useEffect(()=>{if(playing&&pos>=END)setPlaying(false)},[pos,playing]);
 useEffect(()=>{
 if(!playing||!scroller.current)return;
 const viewport=scroller.current;
 const playheadX=pos*scale/1000;
 const center=viewport.clientWidth/2;
 if(playheadX>=viewport.scrollLeft+center){
  viewport.scrollLeft=Math.min(Math.max(0,viewport.scrollWidth-viewport.clientWidth),playheadX-center);
 }
 },[pos,playing,scale]);
 const focusEvent=(i:number)=>{setReasoningSelected(null);setExpressionSelected(null);setInspectorOpen(true);setHovered(null);const v=events[i];setSelected(i);setRange([v.t,v.end]);setPos(v.t);setPlaying(false);const newScale=Math.max(minScale,i===2?210:420);viewMode.current='custom';scaleRef.current=newScale;jump.current=Math.max(0,v.t-800);setScale(newScale);if(newScale===scale&&scroller.current){scroller.current.scrollLeft=px(jump.current);jump.current=null}requestAnimationFrame(()=>{inspector.current?.scrollTo({top:0});inspector.current?.focus({preventScroll:true});if(window.innerWidth<=760)inspector.current?.scrollIntoView({block:"start",behavior:"smooth"})})};
 const zoom=(v:number)=>{viewMode.current='custom';const s=Math.max(minScaleRef.current,Math.min(Math.max(700,minScaleRef.current),v));const center=(scroller.current?.scrollLeft||0)/scale*1000+(scroller.current?.clientWidth||800)/scale*500;jump.current=Math.max(0,center-(scroller.current?.clientWidth||800)/s*500);scaleRef.current=s;setScale(s);if(s===scale){if(scroller.current)scroller.current.scrollLeft=jump.current*s/1000;jump.current=null;persistViewport()}};
 const fit=()=>{viewMode.current='fit';jump.current=0;const next=(scroller.current?.clientWidth||800)/(END/1000);scaleRef.current=next;setScale(next);if(scroller.current)scroller.current.scrollLeft=0;persistViewport()};
 const locatePlayhead=()=>{const el=scroller.current;if(!el)return;jump.current=null;el.scrollTo({left:Math.max(0,Math.min(el.scrollWidth-el.clientWidth,px(pos)-el.clientWidth/2)),behavior:playing||window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})};
 useEffect(()=>{const f=(ev:KeyboardEvent)=>{if(!isWeather||document.querySelector('dialog[open]'))return;if((ev.target as HTMLElement).closest('form,input,textarea,select,button,a,summary,[contenteditable="true"]'))return;if(ev.code==='Space'&&playableClips.length){ev.preventDefault();if(ev.repeat)return;setPos(p=>p>=END?0:p);setPlaying(p=>!p)}if(ev.code==='Enter'||ev.code==='NumpadEnter'){ev.preventDefault();if(ev.repeat)return;setPos(0);setPlaying(false);if(scroller.current)scroller.current.scrollLeft=0}if(ev.key==='Escape'){setSelected(null);setRange([0,0])}};window.addEventListener('keydown',f);return()=>window.removeEventListener('keydown',f)},[isWeather,END]);
 useEffect(()=>{const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:unknown)=>void|Promise<void>}}).modelContext;if(!context)return;const lifecycle=new AbortController();try{void Promise.resolve(context.registerTool({name:'focus_annotation_event',title:'Focus annotation event',description:'Focus and zoom an interruption or revision event and show its annotations.',inputSchema:{type:'object',properties:{eventIndex:{type:'integer',minimum:0,maximum:events.length-1}},required:['eventIndex'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:unknown)=>{const i=(input as {eventIndex?:number})?.eventIndex;if(!Number.isInteger(i)||i!<0||i!>=events.length)throw new Error('Invalid eventIndex');focusEvent(i!);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {eventIndex:i,title:events[i!].title,range:[events[i!].t,events[i!].end]}}},{signal:lifecycle.signal})).catch(()=>{});}catch{}return()=>lifecycle.abort()},[activeCase.id]);
 useEffect(()=>{
 const el=scroller.current;if(!el)return;
 let currentScale=scale;
 let gestureStartScale=scale;
 let gestureActive=false;
 const apply=(next:number,clientX:number)=>{
  const rect=el.getBoundingClientRect();
  const anchor=Math.max(0,Math.min(rect.width,clientX-rect.left));
  currentScale=scaleRef.current;
  const time=(el.scrollLeft+anchor)/currentScale;
  const bounded=Math.max(minScaleRef.current,Math.min(Math.max(700,minScaleRef.current),next));
  if(bounded===currentScale)return;
  jump.current=Math.max(0,(time-anchor/bounded)*1000);
  viewMode.current='custom';currentScale=bounded;scaleRef.current=bounded;
  setScale(bounded);
 };
 const wheel=(event:WheelEvent)=>{
  if(!event.ctrlKey)return;
  event.preventDefault();
  if(gestureActive)return;
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?el.clientHeight:1);
  apply(scaleRef.current*Math.exp(-Math.max(-100,Math.min(100,delta))*.01),event.clientX);
 };
 type PinchEvent=Event & {scale:number;clientX:number};
 const start=(event:Event)=>{event.preventDefault();gestureActive=true;gestureStartScale=scaleRef.current};
 const change=(event:Event)=>{event.preventDefault();const e=event as PinchEvent;if(Number.isFinite(e.scale)&&e.scale>0)apply(gestureStartScale*e.scale,Number.isFinite(e.clientX)?e.clientX:el.getBoundingClientRect().left+el.clientWidth/2)};
 const end=()=>{gestureActive=false};
 el.addEventListener('wheel',wheel,{passive:false});
 el.addEventListener('gesturestart',start,{passive:false});
 el.addEventListener('gesturechange',change,{passive:false});
 el.addEventListener('gestureend',end);
 return()=>{el.removeEventListener('wheel',wheel);el.removeEventListener('gesturestart',start);el.removeEventListener('gesturechange',change);el.removeEventListener('gestureend',end)};
 },[isWeather]);
 const timeAt=(ev:React.PointerEvent<HTMLDivElement>)=>{let t=(ev.clientX-ev.currentTarget.getBoundingClientRect().left)/scale*1000;t=Math.max(0,Math.min(END,t));return Math.round(t)};
 return <main className="studio">
 <header className="top"><div className="brand"><AudioLines size={21}/><b>交互模型数据合成管理平台</b><span className="divider"/><span className="project">{activeCase.id==='weather'?'天气查询 / 打断与改口':activeCase.name}</span></div><span className="prototype">本地会话</span></header>
 <div className="toolbar"><div className="transport"><button className={inspectorOpen?"inspector-toggle selected":"inspector-toggle"} aria-pressed={inspectorOpen} aria-label={inspectorOpen?"隐藏 Files":"显示 Files"} aria-expanded={inspectorOpen} aria-controls="event-inspector" onClick={()=>setInspectorOpen(v=>!v)}>{inspectorOpen?<PanelLeftClose size={17}/>:<PanelLeftOpen size={17}/>}</button><span className="divider"/><button title="回到起点 · Enter" aria-keyshortcuts="Enter" aria-label="回到起点 · 0 秒" onClick={()=>{setPos(0);setPlaying(false);if(scroller.current)scroller.current.scrollLeft=0}}><SkipBack size={18}/></button><button disabled={!isWeather||!playableClips.length} className={'play '+(playing?'active':'')} title={playing?'暂停播放 · Space':'播放时间线 · Space'} aria-keyshortcuts="Space" aria-label={playing?'暂停播放':'播放时间线'} onClick={()=>{if(pos>=END)setPos(0);setPlaying(v=>!v)}}>{playing?<Pause size={18}/>:<Play size={18}/>}</button><span className="timecode">{fmt(pos)} <small>/ {(END/1000).toFixed(3)}</small></span></div><div className="tool-right"><SynthesisPanel key={activeCase.id+':'+(imported[activeCase.id]?.item.revision??'builtin')} caseId={activeCase.id} caseTitle={activeCase.name} scenario={scenario} enabled={isWeather&&playableClips.length>0} timelinePlaying={playing} onOpen={()=>setPlaying(false)}/><JsonOverlay caseId={activeCase.id} caseTitle={activeCase.name} metaOverride={scenario.meta} durationMs={isWeather?END:0} utterances={isWeather?utterances:[]} events={isWeather?inputEvents:[]} controls={isWeather?controlAnnotations:{fdx_annotation:[],emotion_annotation:[],paralinguistic_annotation:[],custom_annotation:[]}} onOpen={()=>setPlaying(false)}/><span className="divider"/><button onClick={()=>zoom(scale/1.4)} disabled={scale<=minScale+.01} title="缩小" aria-label="缩小"><ZoomOut size={17}/></button><Slider aria-label="时间线缩放" className="zoomslider" min={minScale} max={Math.max(700,minScale)} value={[scale]} onValueChange={v=>zoom(Array.isArray(v)?v[0]:v)}/><button onClick={()=>zoom(scale*1.4)} title="放大" aria-label="放大"><ZoomIn size={17}/></button><button onClick={fit} aria-label="适应窗口" title="适应窗口"><ScanLine size={18}/></button><button onClick={locatePlayhead} disabled={!isWeather} aria-label="定位当前播放位置" title="定位当前播放位置"><Crosshair size={18}/></button></div></div>
 <div className={"body "+(!inspectorOpen?"inspector-collapsed":"")+(resizingFiles?" resizing-files":"")} style={{"--files-width":`${filesWidth}px`} as CSSProperties}><section className="editor">{isWeather?<><div className="eventbar"><span><Flag size={15}/>事件</span>{events.map((v,i)=><button key={i} className={selected===i?'current':''} onClick={()=>focusEvent(i)}>{v.name}<small>{fmt(v.t)}</small></button>)}</div>
 <div className="timeline-shell"><div className="track-headers"><div className="ruler-label">时间 / 秒</div>{tracks.map((t,i)=><div className={'track-name '+t.color+(collapsedTracks[t.name]?' track-collapsed':'')} style={{height:collapsedTracks[t.name]?24:trackHeight(t),minHeight:collapsedTracks[t.name]?24:trackHeight(t),maxHeight:collapsedTracks[t.name]?24:trackHeight(t)}} key={t.name}><button className="track-fold" aria-label={`${collapsedTracks[t.name]?'展开':'折叠'}${t.name}轨道`} aria-expanded={!collapsedTracks[t.name]} onClick={()=>setCollapsedTracks(v=>({...v,[t.name]:!v[t.name]}))}><ChevronRight size={11}/></button><span className="track-number">0{i+1}</span><div><b>{t.name}</b><small>{t.en}</small></div></div>)}</div>
 <div className="timeline-scroll" ref={scroller}><div className="timeline" style={{width}} onPointerDown={ev=>{if(ev.button!==0)return;moved.current=false;const t=timeAt(ev);drag.current={x:ev.clientX,t};setPlaying(false);setPos(t)}} onPointerMove={ev=>{if(!drag.current)return;if(Math.abs(ev.clientX-drag.current.x)>4){moved.current=true;ev.currentTarget.setPointerCapture(ev.pointerId);const t=timeAt(ev);setRange([Math.min(t,drag.current.t),Math.max(t,drag.current.t)])}}} onPointerUp={ev=>{if(!moved.current){const t=timeAt(ev);setPos(t)}drag.current=null;if(ev.currentTarget.hasPointerCapture(ev.pointerId))ev.currentTarget.releasePointerCapture(ev.pointerId)}}>
 <div className="ruler">{Array.from({length:Math.ceil(END/400)+1},(_,i)=>i*400).map(t=><div className="tick" key={t} style={{left:px(t)}}><span>{scale>140||t%2000===0?(t/1000).toFixed(1):''}</span></div>)}</div>
 <div className="selection" style={{left:px(range[0]),width:px(range[1]-range[0])}}><span>{range[1]>range[0]?`${Math.round(range[1]-range[0])} 毫秒`:''}</span></div>
 {events.filter(v=>v.overlap).map(v=><div className="overlap" key={v.id} style={{left:px(v.overlap![0]),width:px(v.overlap![1]-v.overlap![0]),height:tracks.slice(0,tracks.findIndex(t=>t.name==='助手')+1).reduce((sum,t)=>sum+(collapsedTracks[t.name]?24:trackHeight(t)),0)}}><span>重叠*</span></div>)}
 {tracks.map((t,ti)=><div className={'track '+t.color+(collapsedTracks[t.name]?' track-collapsed':'')} style={{height:collapsedTracks[t.name]?24:trackHeight(t),minHeight:collapsedTracks[t.name]?24:trackHeight(t),maxHeight:collapsedTracks[t.name]?24:trackHeight(t),backgroundSize:`${px(400)}px 100%`}} key={t.name}>{t.clips.map((c,ci)=><div key={ci} className={'region '+(c.expression===3||c.expression===9?'interruption-control':'')} style={{left:px(c.a),top:collapsedTracks[t.name]?8:7+(c.lane??0)*76,width:Math.max(5,px(c.b-c.a)-3)}}><button type="button" className={'clip '+(c.wave?'audio ':'')+(c.gainPoints?'loading-region ':'')+(c.muted?'discard ':'')+(c.discardTail?'discard-tail ':'')+(c.fadeOut?'fade-out ':'')+(c.event===selected||(c.expression!==undefined&&c.expression===expressionSelected)?'related':'')} aria-label={c.label} onClick={()=>{if(moved.current)return;setReasoningSelected(t.name==='后台判断'?c:null);if(t.name==='后台判断'){setInspectorOpen(true);requestAnimationFrame(()=>inspector.current?.scrollTo({top:0}))}setExpressionSelected(c.expression??null);if(c.expression!==undefined){setInspectorOpen(true);setSelected(null);setRange([c.a,c.b]);requestAnimationFrame(()=>inspector.current?.scrollTo({top:0}));return}if(c.event!==undefined){setSelected(c.event);setRange([events[c.event].t,events[c.event].end])}else{setSelected(null);setRange([c.a,c.b])}}}>{c.fadeMs&&<svg className="fade-envelope audible-fade" style={{left:Math.max(0,px(c.b-c.a-c.fadeMs)),width:px(c.fadeMs)}} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path className="fade-area" d="M 1 3 C 42 3 47 37 99 37 L 99 40 L 1 40 Z"/><path className="fade-curve" d="M 1 3 C 42 3 47 37 99 37"/></svg>}{c.gainPoints&&<svg className="loading-envelope" viewBox="0 0 1000 30" preserveAspectRatio="none" aria-label="Loading 音量曲线"><polyline points={c.gainPoints.map(([time,gain])=>`${(time-c.a)/(c.b-c.a)*1000},${28-gain/.6*24}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/></svg>}<span>{c.discardTail?`【${c.label}】`:c.label}</span>{c.wave?<Wave audioKey={c.audioKey} width={Math.max(5,px(c.b-c.a)-16)} seed={ci+ti*8}/>:<small>{c.sub|| (c.muted?'未播出 / 已丢弃':`${fmt(c.a)} — ${fmt(c.b)}`)}</small>}</button><HoverCard open={hovered===`${ti}-${ci}`} onOpenChange={open=>setHovered(open?`${ti}-${ci}`:null)}><HoverCardTrigger delay={160} closeDelay={180} render={<button type="button"/>} className="region-info" aria-label={`详情：${c.label}`} onPointerDown={ev=>ev.stopPropagation()} onPointerUp={ev=>ev.stopPropagation()} onClick={ev=>ev.stopPropagation()}><Info size={13}/></HoverCardTrigger><HoverCardContent className="clip-preview" side="top" sideOffset={9} align="start" onPointerDown={ev=>ev.stopPropagation()} onPointerMove={ev=>ev.stopPropagation()} onPointerUp={ev=>ev.stopPropagation()}><div className="preview-heading"><span>{t.name}</span><span>{c.wave?'音频':c.muted?'已丢弃':t.en}</span></div><p className="preview-transcript">{c.label}</p><dl className="preview-timing"><div><dt>开始</dt><dd>{fmt(c.a)}</dd></div><div><dt>结束</dt><dd>{fmt(c.b)}</dd></div><div><dt>时长</dt><dd>{(c.b-c.a).toLocaleString('en-US')} 毫秒</dd></div></dl>{c.sub&&<p className="preview-detail">{c.sub}</p>}{c.gainPoints&&<div className="preview-detail">{c.gainPoints.map(([time,gain])=><div key={time}>{fmt(time)} · 音量 {Math.round(gain*100)}%</div>)}</div>}{c.discardTail&&<p className="preview-detail">红色部分表示停止后丢弃的内容；淡出曲线位于前一段真实音频的尾部，对齐实际播放增益。</p>}{c.event!==undefined&&<div className="preview-event"><div>{events[c.event].name} · {events[c.event].title}</div><button onClick={()=>{if(c.event!==undefined)focusEvent(c.event)}}>查看事件 <ChevronRight size={13}/></button></div>}</HoverCardContent></HoverCard></div>)}</div>)}
 {bcHeads.length>0&&<div className="bc-layer" style={{height:(()=>{const t=tracks.find(x=>x.name==='用户');return t?(collapsedTracks['用户']?24:trackHeight(t)):0})()}}>
  {(scenario.breaths??[]).flatMap(b=>b.windows.map((w,i)=><div className="bc-breath" key={b.utterance_id+'-'+i} style={{left:px(b.host_start_ms+w[0]),width:Math.max(2,px(w[1]-w[0]))}}/>))}
  {bcHeads.map(u=>{
   const tail=bcUnits.filter(x=>x.host===u.host).slice(-1)[0],{d,inBreath}=bcSpot(u),end=tail.b+(nudge[tail.id]??0);
   return <button type="button" key={u.id} className={'bc-handle'+(dragUnit===u.id?' dragging':'')+(inBreath?'':' bad')}
    style={{left:px(u.a+d),width:Math.max(30,px(end-(u.a+d)))}}
    title={`拖动或用左右方向键调整附和「${u.label}」的起声时间`} aria-label={`附和「${u.label}」起声 ${Math.round(u.a+d)} 毫秒，左右方向键每次 400 毫秒`}
    onPointerDown={ev=>{ev.stopPropagation();ev.preventDefault();ev.currentTarget.setPointerCapture(ev.pointerId);bcDrag.current={id:u.id,x:ev.clientX,at:u.a+d};setDragUnit(u.id);setPlaying(false)}}
    onPointerMove={ev=>{const st=bcDrag.current;if(!st||st.id!==u.id)return;ev.stopPropagation();bcMove(u,st.at+(ev.clientX-st.x)/scale*1000)}}
    onPointerUp={ev=>{ev.stopPropagation();bcDrag.current=null;setDragUnit(null)}}
    onKeyDown={ev=>{if(ev.key==='ArrowLeft'){ev.preventDefault();bcMove(u,u.a+d-400)}if(ev.key==='ArrowRight'){ev.preventDefault();bcMove(u,u.a+d+400)}}}
   ><span>{bcUnits.filter(x=>x.host===u.host).map(x=>x.label).join(' ')}</span></button>;
  })}
 </div>}
 {events.map(v=><div className="eventline" key={v.id} style={{left:px(v.t)}}><button onClick={()=>focusEvent(v.id)}>{v.id+1}</button></div>)}<div className="playhead" style={{left:px(pos)}}><span/></div>
 </div></div></div>
 <div className="bottom"><span><MousePointer2 size={14}/>捏合缩放 · 双指滚动 · 拖动选区 · 空格播放 / 暂停 · Enter 回到起点</span><span>{range[1]>range[0]?`${fmt(range[0])} — ${fmt(range[1])}`:'未选择区域'}</span></div>
 {bcHeads.length>0&&<div className="bc-readout">
  <div className="bc-title"><b>附和落点</b><span>拖动用户轨上的手柄；浅色竖条是这句话里真实的换气口，按 400 毫秒微轮次吸附</span>
   <span className="bc-actions"><button onClick={()=>{setNudge({});setBcCopied('')}} disabled={!Object.keys(nudge).length}>复位</button><button onClick={()=>{const text=exportOffsets(baseScenario,bcUnits,nudge);void navigator.clipboard?.writeText(text).then(()=>setBcCopied('已复制落点，可回填 local/retime_backchannel.py'),()=>setBcCopied(text))}}>复制落点</button></span></div>
  {bcCopied&&<p className="bc-copied">{bcCopied}</p>}
  {bcHeads.map(u=>{
   const {d,off,inBreath,exact}=bcSpot(u),hostClip=(tracks.find(t=>t.name==='用户')?.clips??[]).find(c=>c.audioKey?.endsWith('/'+u.host));
   return <div className={'bc-item'+(inBreath?' in-breath':'')} key={u.id}>
    <button onClick={()=>{setPlaying(false);setPos(Math.max(0,(hostClip?.a??u.a)-500));setPlaying(true)}}>试听</button>
    <b>{bcUnits.filter(x=>x.host===u.host).map(x=>x.label).join(' / ')}</b>
    <span className="bc-host">{hostClip?.label??u.host}</span>
    <span className="bc-offset">起声 +{Math.round(off)} ms{d?`（原 +${Math.round(u.a-(hostClip?.a??0))}）`:''} · {exact?'落在换气口':inBreath?'压着换气口起声':'不在换气口'}</span>
   </div>;
  })}
 </div>}
 <div id="case-preview-dock"/>
 {scenario.timingStatus==='planned'&&<div className="notice">语音待生成 · 当前时间为设计估计</div>}
 {audioError&&<div className="notice" role="alert">{audioError}</div>}
 </>:<div className="empty-case"><h2>{activeCase.name}</h2><p>暂无音频和标注</p></div>}</section>
 {inspectorOpen&&<div className="files-resizer" role="separator" aria-label="调整 Files 宽度" aria-orientation="vertical" aria-valuemin={180} aria-valuemax={480} aria-valuenow={filesWidth} tabIndex={0} onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);setResizingFiles(true)}} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const left=e.currentTarget.parentElement!.getBoundingClientRect().left;resizeFiles(e.clientX-left)}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId)){e.currentTarget.releasePointerCapture(e.pointerId);setResizingFiles(false);saveFilesWidth()}}} onPointerCancel={()=>{setResizingFiles(false);saveFilesWidth()}} onLostPointerCapture={()=>setResizingFiles(false)} onDoubleClick={()=>{resizeFiles(280);saveFilesWidth()}} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();resizeFiles(filesWidth+(e.key==='ArrowRight'?10:-10));saveFilesWidth()}}}/>}
 {inspectorOpen&&<aside id="event-inspector" className="inspector files-panel" ref={inspector} aria-label="Files">{packagesReady?<FilesPanel importedFiles={importedFiles} onImport={importCase} getScenario={id=>scenarios[id]} onInspect={()=>setPlaying(false)} active={activeCase.id} onSelect={file=>{persistViewport();try{localStorage.setItem('track-studio-active-case-v1',file.id)}catch{}setActiveCase(file);setHovered(null);setExpressionSelected(null);setReasoningSelected(null);setPlaying(false);setPos(0);setSelected(null);setRange([0,0])}}/>:<p>正在读取 Case…</p>}{packageError&&<p role="alert">{packageError}</p>}</aside>}</div>
 </main>;
}
