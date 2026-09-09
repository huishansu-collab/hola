import type {Scenario} from '../app/page';
import {createJsonCase,type RawCase} from './json-case';
import data from './cases/backchannel/case.json';
import timeline from './cases/backchannel/timeline.json';

// Backchannels sit on top of the user's voice. The user keeps talking through
// every one of them, so the floor never changes hands — that is what separates
// this case from a barge-in. Venting is not an instruction: eight vented
// segments produce no tool call at all.
export function createBackchannelCase():Scenario {
 return createJsonCase(data as unknown as RawCase,timeline,[
  {t:15200,end:17200,name:'首次附和',title:'嗐 + 老板都比较忙',tag:'助手附和',note:'连说三句后才给一次附和；压在用户人声上，用户没停。'},
  {t:26000,end:27200,name:'句中附和',title:'emmm…… 落在语义接缝',tag:'助手附和',note:'只表示在听，不切断句子，用户照常说完后半句。'},
  {t:39600,end:43200,name:'用户接管',title:'我看看怎么调整吧',note:'用户表示自己处理；不接活、不提议代劳、不复述改动。'},
 ],[
  {a:15200,b:15600,label:'附和词 · 嗐',trigger:'用户连说三句',delivery:'嗐',annotation:'四声短促气声；压在用户人声上，用户未停。'},
  {a:15600,b:17200,label:'附和句 · 老板都比较忙',trigger:'承接上一声附和',delivery:'老板都比较忙。',annotation:'轻带过，不评价老板本人；用户继续说完。'},
  {a:26000,b:27200,label:'附和词 · emmm……',trigger:'长句语义接缝',delivery:'emmm……',annotation:'鼻音犹豫，只表示在听，不切断句子。'},
  {a:36000,b:38000,label:'附和句 · 唉，光耗在这上头了',trigger:'情绪到顶',delivery:'唉，光耗在这上头了。',annotation:'顺用户原话收，不加码不升级。'},
 ]);
}
