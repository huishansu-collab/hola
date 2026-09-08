import type {Scenario} from '../app/page';
import {createJsonCase,type RawCase} from './json-case';
import data from './cases/interrupt/case.json';
import timeline from './cases/interrupt/timeline.json';

// Barge-in: stopping playout and rewriting the request are separate decisions.
// No queue telemetry exists, so nothing is inferred about unspoken text.
export function createInterruptCase():Scenario {
 return createJsonCase(data as unknown as RawCase,timeline,[
  {t:9600,end:10400,name:'用户打断',title:'播报中途改口',quote:'等一下，不是明天，是后天，而且我要二等座。',note:'用户在播报中起声即判定打断；停止播报与改写查询分别判断。',overlap:[9600,10400]},
  {t:13600,end:14400,name:'重新查询',title:'按后天与二等座重查',note:'改口后重建完整查询条件，不沿用上一轮结果。'},
  {t:17200,end:24400,name:'确认改动',title:'先说明已改，再给结果',note:'先确认改口已生效，避免用户不清楚以哪一轮为准。'},
 ],[{a:17200,b:18000,label:'垫句 · 承接改口',trigger:'改口后重新查询完成',delivery:'改成后天了。',annotation:'时序为设计值，语音尚未生成；标注实际播出边界。'}]);
}
